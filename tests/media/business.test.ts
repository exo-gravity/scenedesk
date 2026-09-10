import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { grantMediaWorkerAccess, sqlIdentifier } from "@drama/database";
import {
  createScheduler,
  grantQueueAccess,
  installQueue,
  runInternalWorker,
  type StepEnvelope,
} from "@drama/queue";
import {
  createMediaProcessor,
  MediaFailure,
  repairMediaWork,
} from "@drama/media";
import { runMediaProcess } from "../../packages/media/src/sandbox.js";
import { businessFixture } from "../support/business.js";
import { storageFixture } from "../support/storage.js";

test(
  "media business: scoped upload, durable processing and immutable access",
  { timeout: 240_000 },
  async (t) => {
    const storage = await storageFixture(t);
    const suffix = randomBytes(5).toString("hex"),
      queueSchema = `scenedesk_queue_${suffix}`;
    const workerRole = `media_worker_${suffix}`,
      schedulerRole = `media_scheduler_${suffix}`;
    const roles: string[] = [],
      pools: Pool[] = [],
      close: (() => Promise<void>)[] = [];
    let admin: Pool | undefined,
      workerDb: Pool | undefined,
      schedulerDb: Pool | undefined;
    const errors: Error[] = [];
    try {
      const f = await businessFixture(t, async (db) => {
        admin = db.admin;
        for (const role of [workerRole, schedulerRole]) {
          const password = randomBytes(24).toString("hex");
          await db.admin.query(
            `CREATE ROLE ${sqlIdentifier(role)} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD '${password}'`,
          );
          roles.push(role);
          const url = new URL(process.env.DATABASE_URL!);
          url.username = role;
          url.password = password;
          const pool = new Pool({ connectionString: url.href, max: 4 });
          pools.push(pool);
          if (role === workerRole) workerDb = pool;
          else schedulerDb = pool;
        }
        await installQueue(db.admin, queueSchema);
        const grant = await db.admin.connect();
        try {
          await grantMediaWorkerAccess(
            grant,
            db.schema,
            workerRole,
            schedulerRole,
          );
          await grantQueueAccess(grant, queueSchema, db.apiRole, schedulerRole);
          await grantQueueAccess(grant, queueSchema, workerRole, schedulerRole);
        } finally {
          grant.release();
        }
        const producer = await createScheduler(db.runtime, {
          schema: queueSchema,
          onError: (error) => errors.push(error),
        });
        close.push(producer.close);
        return { media: { store: storage.api, schedule: producer.schedule } };
      });
      const path = `/v1/tenants/${f.tenant.id}`;
      const scope = sqlIdentifier(f.schema);
      const producer = await createScheduler(workerDb!, {
        schema: queueSchema,
        onError: (error) => errors.push(error),
      });
      close.push(producer.close);
      const processMedia = await createMediaProcessor({
        pool: workerDb!,
        schema: f.schema,
        store: storage.processing,
        schedule: producer.schedule,
      });
      const source = Buffer.from("女主：钥匙在哪里？\n她推开了旧公寓的门。\n");
      const hash = (bytes: Buffer) =>
        createHash("sha256").update(bytes).digest("hex");
      const upload = async (
        bytes: Buffer,
        extra: Record<string, unknown> = {},
      ) => {
        const body = {
          scope: "project",
          projectId: f.project.id,
          fileName: "旧钥匙.txt",
          mime: "text/plain",
          bytes: bytes.length,
          sha256: hash(bytes),
          ...extra,
        };
        const response = await f.request("POST", `${path}/uploads`, body);
        assert.equal(response.statusCode, 201, response.body);
        const intent = response.json();
        assert.equal(intent.method, "POST");
        const form = new FormData();
        for (const [key, value] of Object.entries(intent.formFields))
          form.append(key, String(value));
        form.append(
          "file",
          new Blob([new Uint8Array(bytes)]),
          String(body.fileName),
        );
        const saved = await fetch(intent.uploadUrl, {
          method: "POST",
          body: form,
        });
        assert.equal(saved.status, 204);
        return { intent, body };
      };
      const complete = async (record: Awaited<ReturnType<typeof upload>>) => {
        const response = await f.request(
          "POST",
          `${path}/uploads/${record.intent.id}/complete`,
          { bytes: record.body.bytes, sha256: record.body.sha256 },
        );
        assert.equal(response.statusCode, 202, response.body);
        return response.json();
      };
      const stepFor = (id: string, stepRevision = 1): StepEnvelope => ({
        taskKind: "media_probe",
        businessId: id,
        stepRevision,
        epoch: 1,
      });
      const run = (step: StepEnvelope) =>
        processMedia(step, {
          signal: new AbortController().signal,
          queueJobId: randomUUID(),
        });
      const read = async (mediaId: string) => {
        const response = await f.request("GET", `${path}/media/${mediaId}`);
        assert.equal(response.statusCode, 200, response.body);
        return response.json();
      };
      let acceptedId = "";
      await t.test(
        "actual queue worker accepts an authorized document and explicit variant access",
        async () => {
          const entry = await upload(source);
          const pending = await complete(entry);
          assert.equal(pending.status, "uploaded");
          assert.ok(pending.mediaId);
          acceptedId = pending.mediaId;
          const worker = await runInternalWorker(schedulerDb!, processMedia, {
            schema: queueSchema,
            onError: (error) => errors.push(error),
            concurrency: 1,
          });
          try {
            const deadline = Date.now() + 15_000;
            let media = await read(acceptedId);
            while (media.status === "processing" && Date.now() < deadline) {
              await new Promise((resolve) => setTimeout(resolve, 100));
              media = await read(acceptedId);
            }
            assert.equal(media.status, "ready", JSON.stringify(media));
            assert.equal(media.sha256, hash(source));
            assert.equal(media.bytes, source.length);
            assert.equal(media.kind, "document");
            assert.deepEqual(media.derivatives, []);
            assert.equal(media.immutableKey, undefined);
            assert.equal(media.storageVersionId, undefined);
            assert.equal(
              (
                await f.request("GET", `${path}/uploads/${entry.intent.id}`)
              ).json().status,
              "accepted",
            );
            const access = await f.request(
              "POST",
              `${path}/media/${acceptedId}/access`,
              { variant: "original", disposition: "inline" },
            );
            assert.equal(access.statusCode, 200, access.body);
            const original = await fetch(access.json().url);
            assert.match(
              original.headers.get("content-disposition")!,
              /^attachment/,
            );
            assert.deepEqual(Buffer.from(await original.arrayBuffer()), source);
            assert.equal(
              (
                await f.request("POST", `${path}/media/${acceptedId}/access`, {
                  variant: "proxy",
                  disposition: "inline",
                })
              ).statusCode,
              404,
            );
          } finally {
            await worker.close();
          }
          await run(stepFor(entry.intent.id));
          const count = await f.admin.query(
            `SELECT count(*)::int AS count FROM ${scope}.media WHERE source_upload_id=$1`,
            [entry.intent.id],
          );
          assert.equal(count.rows[0].count, 1);
        },
      );
      await t.test(
        "enqueue failure rolls back both completion and the new media root",
        async () => {
          const entry = await upload(source);
          await f.admin.query(
            `REVOKE INSERT ON ${queueSchema}.job_common FROM ${sqlIdentifier(f.apiRole)}`,
          );
          try {
            const response = await f.request(
              "POST",
              `${path}/uploads/${entry.intent.id}/complete`,
              { bytes: entry.body.bytes, sha256: entry.body.sha256 },
            );
            assert.equal(response.statusCode, 403);
            assert.equal(
              (
                await f.request("GET", `${path}/uploads/${entry.intent.id}`)
              ).json().status,
              "pending",
            );
            assert.equal(
              (
                await f.admin.query(
                  `SELECT count(*)::int AS count FROM ${scope}.media WHERE source_upload_id=$1`,
                  [entry.intent.id],
                )
              ).rows[0].count,
              0,
            );
          } finally {
            await f.admin.query(
              `GRANT INSERT ON ${queueSchema}.job_common TO ${sqlIdentifier(f.apiRole)}`,
            );
          }
          const pending = await complete(entry);
          await run({ ...stepFor(entry.intent.id), epoch: 2 });
          assert.equal((await read(pending.mediaId)).status, "processing");
          await run(stepFor(entry.intent.id));
          assert.equal((await read(pending.mediaId)).status, "ready");
        },
      );
      await t.test(
        "metadata CAS and archival retain accepted bytes and old access",
        async () => {
          const previous = await read(acceptedId);
          const updated = await f.request(
            "PATCH",
            `${path}/media/${acceptedId}`,
            { displayName: "正式剧本 · 旧钥匙", tags: ["剧本", "原稿"] },
            previous.revision,
          );
          assert.equal(updated.statusCode, 200, updated.body);
          assert.equal(updated.json().sha256, previous.sha256);
          const conflict = await f.request(
            "PATCH",
            `${path}/media/${acceptedId}`,
            { displayName: "过期覆盖", tags: [] },
            previous.revision,
          );
          assert.equal(conflict.statusCode, 412);
          const archived = await f.request(
            "POST",
            `${path}/media/${acceptedId}/archive`,
            undefined,
            updated.json().revision,
          );
          assert.equal(archived.statusCode, 201, archived.body);
          assert.equal(archived.json().status, "archived");
          assert.equal(
            (
              await f.request("POST", `${path}/media/${acceptedId}/access`, {
                variant: "original",
                disposition: "attachment",
              })
            ).statusCode,
            200,
          );
        },
      );
      await t.test(
        "retry reads the pinned upload version after the staging key is overwritten",
        async () => {
          const entry = await upload(source);
          const pending = await complete(entry);
          const download = storage.processing.download;
          storage.processing.download = async () => {
            throw new Error("Injected storage interruption");
          };
          try {
            await assert.rejects(
              run(stepFor(entry.intent.id)),
              /Injected storage interruption/,
            );
          } finally {
            storage.processing.download = download;
          }
          const fixed = (
            await f.admin.query(
              `SELECT staging_version_id,status,retryable FROM ${scope}.upload_intents WHERE id=$1`,
              [entry.intent.id],
            )
          ).rows[0];
          assert.ok(fixed.staging_version_id);
          assert.equal(fixed.status, "uploaded");
          assert.equal(fixed.retryable, true);
          const form = new FormData();
          for (const [key, value] of Object.entries(entry.intent.formFields))
            form.append(key, String(value));
          form.append(
            "file",
            new Blob([new Uint8Array(Buffer.alloc(source.length, 65))]),
            entry.body.fileName,
          );
          assert.equal(
            (
              await fetch(entry.intent.uploadUrl, {
                method: "POST",
                body: form,
              })
            ).status,
            204,
          );
          await run(stepFor(entry.intent.id));
          assert.equal((await read(pending.mediaId)).status, "ready");
          assert.equal((await read(pending.mediaId)).sha256, hash(source));
          const access = await f.request(
            "POST",
            `${path}/media/${pending.mediaId}/access`,
            { variant: "original", disposition: "attachment" },
          );
          assert.equal(access.statusCode, 200, access.body);
          assert.deepEqual(
            Buffer.from(await (await fetch(access.json().url)).arrayBuffer()),
            source,
          );
        },
      );
      await t.test(
        "invalid content is rejected and cannot be recovered as an accepted original",
        async () => {
          const entry = await upload(source, { sha256: "0".repeat(64) });
          const pending = await complete(entry);
          await run(stepFor(entry.intent.id));
          const rejected = await read(pending.mediaId);
          assert.equal(rejected.status, "rejected");
          assert.equal(rejected.issue.code, "FILE_INTEGRITY_MISMATCH");
          assert.equal(rejected.issue.retryable, false);
          assert.equal(
            (
              await f.request(
                "POST",
                `${path}/uploads/${entry.intent.id}/complete`,
                { bytes: entry.body.bytes, sha256: entry.body.sha256 },
              )
            ).statusCode,
            409,
          );
          assert.equal(
            (
              await f.request(
                "POST",
                `${path}/media/${pending.mediaId}/access`,
                { variant: "original", disposition: "attachment" },
              )
            ).statusCode,
            409,
          );
        },
      );
      await t.test(
        "poster failure and explicit recovery preserve the original image",
        async () => {
          const directory = await mkdtemp(
            join(tmpdir(), "scenedesk-business-image-"),
          );
          try {
            const file = join(directory, "image");
            await runMediaProcess(
              undefined,
              "/ffmpeg",
              [
                "-v",
                "error",
                "-nostdin",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=96x64",
                "-frames:v",
                "1",
                "-threads",
                "2",
                "-c:v",
                "png",
                "-f",
                "image2pipe",
                "pipe:1",
              ],
              { outputFile: file, maxBytes: 1024 * 1024 },
            );
            const bytes = await readFile(file);
            const entry = await upload(bytes, {
              mime: "image/png",
              fileName: "旧公寓.png",
            });
            const pending = await complete(entry);
            await run(stepFor(entry.intent.id));
            const original = await read(pending.mediaId);
            assert.equal(original.status, "ready");
            assert.equal(original.width, 96);
            assert.equal(original.height, 64);
            assert.equal(original.derivatives.length, 1);
            const derivativeId = original.derivatives[0].id;
            const step: StepEnvelope = {
              ...stepFor(derivativeId),
              taskKind: "media_derivative",
            };
            const publish = storage.processing.publish;
            storage.processing.publish = async () => {
              throw new MediaFailure(
                "MEDIA_RESOURCE_LIMIT",
                "模拟预览资源限制",
              );
            };
            try {
              await run(step);
            } finally {
              storage.processing.publish = publish;
            }
            const failed = await read(pending.mediaId);
            assert.equal(failed.status, "ready");
            assert.equal(failed.derivatives[0].status, "failed");
            assert.equal(failed.sha256, hash(bytes));
            const recovered = await f.request(
              "POST",
              `${path}/media/${pending.mediaId}/derivatives/recover`,
              { variant: "poster" },
            );
            assert.equal(recovered.statusCode, 202, recovered.body);
            assert.equal(recovered.json().derivatives[0].status, "queued");
            await run(step); // The failed step cannot consume the new recovery command.
            assert.equal(
              (await read(pending.mediaId)).derivatives[0].status,
              "queued",
            );
            await run({ ...step, stepRevision: 2 });
            const ready = await read(pending.mediaId);
            assert.equal(ready.derivatives[0].id, derivativeId);
            assert.equal(ready.derivatives[0].status, "ready");
            assert.equal(ready.sha256, original.sha256);
            assert.equal(ready.revision, original.revision);
            const access = await f.request(
              "POST",
              `${path}/media/${pending.mediaId}/access`,
              { variant: "poster", disposition: "inline" },
            );
            assert.equal(access.statusCode, 200, access.body);
            const preview = await fetch(access.json().url);
            assert.equal(preview.headers.get("content-type"), "image/jpeg");
            assert.equal(
              Buffer.from(await preview.arrayBuffer())
                .subarray(0, 2)
                .toString("hex"),
              "ffd8",
            );
          } finally {
            await rm(directory, { recursive: true, force: true });
          }
        },
      );
      await t.test(
        "scope authorization is rechecked for cached access and shared upload credentials",
        async () => {
          const who = await f.identity("media-editor");
          const invite = await f.ok("POST", `${path}/invitations`, {
            email: "media-editor@example.test",
            role: "member",
          });
          const token = new URLSearchParams(
            new URL(invite.invitationUrl).hash.split("?")[1],
          ).get("token");
          const joined = await f.request(
            "POST",
            "/v1/invitations/accept",
            { token },
            undefined,
            randomUUID(),
            who,
          );
          assert.equal(joined.statusCode, 201, joined.body);
          const membership = joined.json();
          const asMember = (
            method: "GET" | "POST",
            url: string,
            body?: unknown,
            key = randomUUID(),
          ) => f.request(method, url, body, undefined, key, who);
          assert.equal(
            (await asMember("GET", `${path}/media/${acceptedId}`)).statusCode,
            404,
          );
          await f.ok("POST", `${f.path}/members`, {
            membershipId: membership.id,
          });
          const key = randomUUID(),
            body = { variant: "original", disposition: "attachment" };
          assert.equal(
            (
              await asMember(
                "POST",
                `${path}/media/${acceptedId}/access`,
                body,
                key,
              )
            ).statusCode,
            200,
          );
          const projectMember = (
            await f.ok("GET", `${f.path}/members`)
          ).items.find((row: any) => row.membershipId === membership.id);
          await f.ok(
            "DELETE",
            `${f.path}/members/${membership.id}`,
            undefined,
            projectMember.revision,
          );
          assert.equal(
            (
              await asMember(
                "POST",
                `${path}/media/${acceptedId}/access`,
                body,
                key,
              )
            ).statusCode,
            404,
          );
          const shared = await upload(source, {
            scope: "shared",
            projectId: undefined,
          });
          const visible = await asMember(
            "GET",
            `${path}/uploads/${shared.intent.id}`,
          );
          assert.equal(visible.statusCode, 200, visible.body);
          assert.equal(visible.json().uploadUrl, undefined);
          assert.equal(visible.json().formFields, undefined);
          assert.equal(
            (
              await asMember(
                "POST",
                `${path}/uploads/${shared.intent.id}/complete`,
                { bytes: shared.body.bytes, sha256: shared.body.sha256 },
              )
            ).statusCode,
            403,
          );
          const pending = await complete(shared);
          await run(stepFor(shared.intent.id));
          assert.equal(
            (
              await asMember(
                "POST",
                `${path}/media/${pending.mediaId}/access`,
                body,
              )
            ).statusCode,
            200,
          );
          const listing = await asMember("GET", `${path}/media`);
          assert.equal(listing.statusCode, 200, listing.body);
          assert.deepEqual(
            listing.json().items.map((row: any) => row.id),
            [pending.mediaId],
          );
          const stranger = await f.identity("other-tenant");
          assert.equal(
            (
              await f.request(
                "GET",
                `${path}/media/${pending.mediaId}`,
                undefined,
                undefined,
                randomUUID(),
                stranger,
              )
            ).statusCode,
            404,
          );
        },
      );
      await t.test(
        "repair recreates lost hints and finite retries require explicit recovery",
        async () => {
          const entry = await upload(source);
          const pending = await complete(entry);
          await f.admin.query(
            `DELETE FROM ${queueSchema}.job_common WHERE data->>'businessId'=$1`,
            [entry.intent.id],
          );
          await f.admin.query(
            `UPDATE ${scope}.upload_intents SET updated_at=now()-interval '3 minutes',revision=revision+1 WHERE id=$1`,
            [entry.intent.id],
          );
          const count = await repairMediaWork({
            pool: schedulerDb!,
            schema: f.schema,
            schedule: producer.schedule,
          });
          assert.ok(count >= 1);
          const hint = (
            await f.admin.query(
              `SELECT data FROM ${queueSchema}.job_common WHERE data->>'businessId'=$1`,
              [entry.intent.id],
            )
          ).rows;
          assert.equal(hint.length, 1);
          assert.deepEqual(hint[0].data, stepFor(entry.intent.id));
          const download = storage.processing.download;
          storage.processing.download = async () => {
            throw new Error("Injected finite failure");
          };
          try {
            for (let attempt = 0; attempt < 6; attempt++)
              await assert.rejects(
                run(stepFor(entry.intent.id)),
                /Injected finite failure/,
              );
          } finally {
            storage.processing.download = download;
          }
          await f.admin.query(
            `UPDATE ${scope}.upload_intents SET updated_at=now()-interval '3 minutes',revision=revision+1 WHERE id=$1`,
            [entry.intent.id],
          );
          const scan = await schedulerDb!.query(
            `SELECT * FROM ${scope}.scan_media_work(100)`,
          );
          assert.equal(
            scan.rows.some((row) => row.business_id === entry.intent.id),
            false,
          );
          await run(stepFor(entry.intent.id));
          const exhausted = (
            await f.request("GET", `${path}/uploads/${entry.intent.id}`)
          ).json();
          assert.equal(exhausted.issue.code, "MEDIA_RETRIES_EXHAUSTED");
          assert.equal(exhausted.issue.retryable, true);
          await complete(entry);
          await run(stepFor(entry.intent.id));
          assert.equal((await read(pending.mediaId)).status, "processing");
          await run(stepFor(entry.intent.id, 2));
          assert.equal((await read(pending.mediaId)).status, "ready");
          assert.equal((await read(pending.mediaId)).sha256, hash(source));
        },
      );
      await t.test(
        "database identities cannot bypass scope or change accepted content",
        async () => {
          assert.equal(
            (await workerDb!.query(`SELECT * FROM ${scope}.media`)).rowCount,
            0,
          );
          assert.equal(
            (await workerDb!.query(`SELECT * FROM ${scope}.upload_intents`))
              .rowCount,
            0,
          );
          await assert.rejects(
            f.runtime.query(
              `SELECT * FROM ${scope}.resolve_media_work($1,'media_probe',1,1)`,
              [randomUUID()],
            ),
            /permission denied/,
          );
          await assert.rejects(
            schedulerDb!.query(`SELECT * FROM ${scope}.media`),
            /permission denied/,
          );
          await assert.rejects(
            f.runtime.query(`UPDATE ${scope}.media SET sha256=$1`, [
              "0".repeat(64),
            ]),
            /permission denied/,
          );
          await assert.rejects(
            f.admin.query(
              `UPDATE ${scope}.media SET sha256=$1,revision=revision+1 WHERE id=$2`,
              ["0".repeat(64), acceptedId],
            ),
            /immutable/,
          );
          const scan = await schedulerDb!.query(
            `SELECT * FROM ${scope}.scan_media_work(100)`,
          );
          for (const row of scan.rows)
            assert.deepEqual(Object.keys(row).sort(), [
              "business_id",
              "epoch",
              "step_revision",
              "task_kind",
            ]);
        },
      );
      assert.deepEqual(
        errors.map((error) => error.message),
        [],
      );
    } finally {
      for (const stop of close.reverse()) await stop();
      for (const pool of pools) await pool.end();
      if (admin) {
        await admin.query(
          `DROP SCHEMA IF EXISTS ${sqlIdentifier(queueSchema)} CASCADE`,
        );
        for (const role of roles) {
          await admin.query(`DROP OWNED BY ${sqlIdentifier(role)}`);
          await admin.query(`DROP ROLE ${sqlIdentifier(role)}`);
        }
      }
    }
  },
);

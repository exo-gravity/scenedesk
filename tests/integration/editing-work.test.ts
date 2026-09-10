import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { businessFixture } from "../support/business.js";
import { Database } from "../../apps/api/src/kernel/database.js";
import { editingCanonical } from "@drama/domain";
import { createHash } from "node:crypto";

test("shared unfinished Cut work is independently versioned and protects its fixed sources", async (t) => {
  const f = await businessFixture(t);
  const db = new Database(f.runtime, f.schema);
  const tx = (run: Parameters<Database["transaction"]>[2]) =>
    db.transaction(
      f.owner.token,
      { tenantId: f.tenant.id, projectId: f.project.id, write: true },
      run,
    );
  const cut = await f.ok("POST", `${f.path}/cuts`, { name: "门口第一稿" });
  const route = `${f.path}/cuts/${cut.id}/work-draft`;
  const read = () => f.ok("GET", route);
  const save = (document: unknown, revision: number, baseCutRevision = 1) =>
    f.ok("PUT", route, { baseCutRevision, document }, revision);
  const count = async (table: string) =>
    Number(
      (await f.admin.query(`SELECT count(*) FROM ${f.schema}.${table}`)).rows[0]
        .count,
    );
  let work: any;
  const original = structuredClone(cut);
  await t.test(
    "GET returns virtual revision zero without a write, independent of the Cut ETag",
    async () => {
      const response = await f.request("GET", route);
      assert.equal(response.statusCode, 200, response.body);
      work = response.json();
      assert.equal(response.headers.etag, '"0"');
      assert.equal(work.baseCutRevision, cut.revision);
      assert.equal(work.updatedBy, undefined);
      assert.equal(work.updatedAt, undefined);
      assert.equal(work.hasUnappliedChanges, false);
      assert.deepEqual(
        work.issues.map((i: any) => i.code),
        ["MAIN_VIDEO_REQUIRED"],
      );
      assert.equal(await count("cut_work_drafts"), 0);
      assert.equal(await count("edit_history_bodies"), 0);
      assert.deepEqual((await f.ok("GET", `${f.path}/cuts`)).items, [cut]);
      assert.equal(
        (
          await f.request(
            "PUT",
            route,
            { baseCutRevision: 1, document: work.document },
            1,
          )
        ).statusCode,
        412,
      );
    },
  );
  await t.test(
    "unfinished subtitle and missing clip binding diagnostics can be saved without confirming the Cut",
    async () => {
      work.document.timeline.tracks.push({
        id: randomUUID(),
        kind: "subtitle",
        muted: false,
        items: [
          {
            id: randomUUID(),
            kind: "subtitle",
            timelineStartUs: 3000000,
            durationUs: 0,
            text: "",
          },
        ],
      });
      work.document.unresolvedEdits.push({
        id: randomUUID(),
        kind: "sound_placement",
        clipIds: [],
        note: "等待人工补配音",
      });
      work = await save(work.document, 0);
      assert.equal(work.revision, 1);
      assert.equal(work.updatedBy, f.owner.userId);
      assert.equal(work.hasUnappliedChanges, true);
      assert.ok(work.issues.some((i: any) => i.code === "UNRESOLVED_EDIT"));
      assert.deepEqual(await f.ok("GET", `${f.path}/cuts/${cut.id}`), original);
      assert.deepEqual(await f.ok("GET", `${route}/revisions/1`), work);
      assert.equal(
        (await f.request("GET", `${route}/revisions/1e0`)).statusCode,
        422,
      );
      const history = await f.ok("GET", `${route}/revisions`);
      assert.deepEqual(
        history.items.map((i: any) => i.revision),
        [1],
      );
      assert.ok(history.items[0].retainedFor.includes("current"));
    },
  );
  await t.test(
    "CAS admits one racing writer and identical content does not create fake checkpoints",
    async () => {
      const a = structuredClone(work.document),
        b = structuredClone(work.document);
      a.unresolvedEdits[0].note = "甲继续配音";
      b.unresolvedEdits[0].note = "乙检查字幕";
      const responses = await Promise.all(
        [a, b].map((document) =>
          f.request("PUT", route, { baseCutRevision: 1, document }, 1),
        ),
      );
      assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 412]);
      work = await read();
      assert.equal(work.revision, 2);
      assert.deepEqual(await save(work.document, work.revision), work);
      assert.equal(await count("cut_work_draft_revisions"), 2);
      assert.equal(await count("edit_history_bodies"), 2);
      const draft = structuredClone(work.document);
      draft.unresolvedEdits[0].note = "新安排";
      assert.equal(
        (
          await f.request(
            "PUT",
            route,
            { baseCutRevision: 3, document: draft },
            2,
          )
        ).statusCode,
        409,
      );
      const history = await f.ok("GET", `${route}/revisions?limit=1`);
      assert.equal(history.items[0].revision, 2);
      assert.ok(history.nextCursor);
      assert.equal(
        (
          await f.ok(
            "GET",
            `${route}/revisions?limit=1&cursor=${encodeURIComponent(history.nextCursor)}`,
          )
        ).items[0].revision,
        1,
      );
      const second = await f.ok("POST", `${f.path}/cuts`, { name: "另一剪辑" });
      assert.equal(
        (
          await f.request(
            "GET",
            `${f.path}/cuts/${second.id}/work-draft/revisions?cursor=${encodeURIComponent(history.nextCursor)}`,
          )
        ).statusCode,
        422,
      );
      assert.equal(
        (await f.request("GET", `${route}/revisions/99`)).statusCode,
        404,
      );
    },
  );

  // Relational fixture only. The media test suite covers acceptance of real bytes.
  async function media(projectId: string | null = f.project.id) {
    const id = randomUUID(),
      upload = randomUUID(),
      scope = projectId ? "project" : "shared";
    await f.admin.query(
      `INSERT INTO ${f.schema}.upload_intents(id,tenant_id,project_id,scope,staging_key,expected_bytes,expected_sha256,safe_file_name,mime_hint,display_name,created_by,status,expires_at,staging_version_id,epoch)
      VALUES($1,$2,$3,$4,$5,64,$6,'fixture.mp4','video/mp4','关系测试',$7,'accepted',now()+interval '15 minutes','fixture-version',1)`,
      [
        upload,
        f.tenant.id,
        projectId,
        scope,
        `staging/${upload}`,
        "a".repeat(64),
        f.owner.userId,
      ],
    );
    await f.admin.query(
      `INSERT INTO ${f.schema}.media(id,tenant_id,project_id,scope,kind,status,display_name,safe_original_file_name,created_by,source_upload_id,immutable_key,storage_version_id,sha256,bytes,mime,width,height,has_audio,duration_us,fps_num,fps_den)
      VALUES($1,$2,$3,$4,'video','ready','关系测试','fixture.mp4',$5,$6,$7,'fixture-version',$8,64,'video/mp4',32,32,true,4000000,24,1)`,
      [
        id,
        f.tenant.id,
        projectId,
        scope,
        f.owner.userId,
        upload,
        `originals/${id}`,
        "a".repeat(64),
      ],
    );
    return id;
  }
  const video = await media();
  const clip = {
    id: randomUUID(),
    kind: "video",
    mediaId: video,
    timelineStartUs: 0,
    range: { inUs: 250001, outUs: 2000001 },
    gainDb: 0,
    muted: false,
    fit: "contain",
    streamSelection: "default",
  };
  await t.test(
    "ready media can be arranged and archived media retained only in its existing semantic slot",
    async () => {
      const document = structuredClone(work.document);
      document.timeline.tracks[0].items = [clip];
      work = await save(document, work.revision);
      assert.equal(await count("edit_history_media_refs"), 1);
      assert.equal(
        work.document.timeline.tracks[0].items[0].range.inUs,
        250001,
      );
      await tx(async ({ sql }) => {
        await sql.query(
          "UPDATE media SET status='archived',revision=revision+1 WHERE id=$1",
          [video],
        );
      });
      const archived = await read();
      assert.equal(archived.revision, work.revision);
      assert.equal(archived.documentHash, work.documentHash);
      assert.ok(
        archived.issues.some((i: any) => i.code === "MEDIA_UNAVAILABLE"),
      );
      const retained = structuredClone(work.document);
      retained.timeline.tracks[0].items[0].range.outUs = 3000001;
      work = await save(retained, work.revision);
      const newSlot = structuredClone(work.document);
      newSlot.timeline.tracks[0].items[0].id = randomUUID();
      assert.equal(
        (
          await f.request(
            "PUT",
            route,
            { baseCutRevision: 1, document: newSlot },
            work.revision,
          )
        ).statusCode,
        422,
      );
      const remove = structuredClone(work.document);
      remove.timeline.tracks[0].items = [];
      work = await save(remove, work.revision);
      // A previously deduplicated body is still a new reference when restored.
      assert.equal(
        (
          await f.request(
            "PUT",
            route,
            { baseCutRevision: 1, document: document },
            work.revision,
          )
        ).statusCode,
        422,
      );
      assert.deepEqual(await f.ok("GET", `${f.path}/cuts/${cut.id}`), original);
    },
  );
  await t.test(
    "wrong-scope media, missing sources, reversed ranges and unauthorized readers cannot bypass validation",
    async () => {
      const other = await f.createProject("隔离剪辑"),
        foreign = await media(other.id);
      for (const replacement of [
        { ...clip, mediaId: foreign },
        { ...clip, mediaId: randomUUID() },
        { ...clip, range: { inUs: 100, outUs: 99 } },
      ]) {
        const document = structuredClone(work.document);
        document.timeline.tracks[0].items = [replacement];
        const response = await f.request(
          "PUT",
          route,
          { baseCutRevision: 1, document },
          work.revision,
        );
        assert.equal(response.statusCode, 422, response.body);
      }
      const document = structuredClone(work.document);
      document.timeline.tracks[0].items = [clip, clip];
      assert.equal(
        (
          await f.request(
            "PUT",
            route,
            { baseCutRevision: 1, document },
            work.revision,
          )
        ).statusCode,
        422,
      );
      const stranger = await f.identity("stranger");
      assert.equal(
        (
          await f.request(
            "GET",
            route,
            undefined,
            undefined,
            randomUUID(),
            stranger,
          )
        ).statusCode,
        404,
      );
      assert.equal(
        (
          await f.request(
            "GET",
            `${route}/revisions/1`,
            undefined,
            undefined,
            randomUUID(),
            stranger,
          )
        ).statusCode,
        404,
      );
      assert.deepEqual((await read()).document, work.document);
    },
  );
  await t.test(
    "adoption reports actual dependent work without replacing any arranged source",
    async () => {
      const source = await media();
      const episode = await f.ok(
        "POST",
        `${f.path}/episodes`,
        { title: "第一集", position: 0, status: "active" },
        await f.next(),
      );
      const scene = await f.ok(
        "POST",
        `${f.path}/scenes`,
        {
          episodeId: episode.id,
          title: "门口",
          position: 0,
          status: "active",
          summary: "重逢",
          state: { characters: [], props: [], spatialNotes: "" },
        },
        await f.next(),
      );
      const shot = await f.ok(
        "POST",
        `${f.path}/shots`,
        {
          sceneId: scene.id,
          label: "A",
          position: 0,
          status: "active",
          spec: { intent: "停步", references: [] },
        },
        await f.next(),
      );
      const take = await f.ok("POST", `${f.path}/takes`, {
        shotId: shot.id,
        shotRevisionId: shot.specRevisionId,
        mediaId: source,
        range: { inUs: 0, outUs: 1000000 },
      });
      const selection = await f.ok(
        "PUT",
        `${f.path}/shots/${shot.id}/selection`,
        { takeId: take.id },
        shot.revision,
      );
      assert.deepEqual(selection.affectedCutIds, []);
      const document = structuredClone(work.document);
      document.timeline.tracks[0].items = [
        {
          ...clip,
          mediaId: source,
          takeId: take.id,
          selectionId: selection.id,
          range: take.range,
        },
      ];
      work = await save(document, work.revision);
      const before = structuredClone(work);
      const changed = await f.ok(
        "PUT",
        `${f.path}/shots/${shot.id}/selection`,
        { takeId: take.id, reason: "再次明确选择" },
        shot.revision + 1,
      );
      assert.deepEqual(changed.affectedCutIds, [cut.id]);
      assert.deepEqual(await read(), before);
      assert.deepEqual(await f.ok("GET", `${f.path}/cuts/${cut.id}`), original);
      const cleared = await f.request(
        "DELETE",
        `${f.path}/shots/${shot.id}/selection`,
        undefined,
        shot.revision + 2,
      );
      assert.equal(cleared.statusCode, 200, cleared.body);
      assert.deepEqual(cleared.json().affectedCutIds, [cut.id]);
      assert.deepEqual(await read(), before);
      document.timeline.tracks[0].items[0].selectionId = cleared.json().id;
      assert.equal(
        (
          await f.request(
            "PUT",
            route,
            { baseCutRevision: 1, document },
            work.revision,
          )
        ).statusCode,
        422,
      );
      const outside = structuredClone(work.document);
      outside.timeline.tracks[0].items[0].range.outUs = 1000001;
      work = await save(outside, work.revision);
      assert.ok(
        work.issues.some((i: any) => i.code === "SOURCE_RANGE_INVALID"),
        "unfinished draft marks the one-microsecond Take overrun",
      );
      const sceneCut = await f.ok("POST", `${f.path}/cuts`, {
        name: "门口按场次剪辑",
        sceneId: scene.id,
        episodeId: episode.id,
      });
      assert.equal(sceneCut.sceneId, scene.id);
      assert.equal(sceneCut.episodeId, episode.id);
      assert.deepEqual(
        (await f.ok("GET", `${f.path}/cuts?sceneId=${scene.id}`)).items.map(
          (c: any) => c.id,
        ),
        [sceneCut.id],
      );
      assert.deepEqual(
        (await f.ok("GET", `${f.path}/cuts?episodeId=${episode.id}`)).items.map(
          (c: any) => c.id,
        ),
        [sceneCut.id],
      );
    },
  );
  await t.test(
    "a missing clip may keep an authorized fixed dialogue and voice but cannot invent their relationship",
    async () => {
      const base = `/v1/tenants/${f.tenant.id}`;
      const asset = await f.ok("POST", `${base}/assets`, {
        scope: "project",
        projectId: f.project.id,
        kind: "voice",
        name: "人工声音说明",
      });
      const voice = await f.ok(
        "POST",
        `${base}/assets/${asset.id}/revisions`,
        { definition: { description: "轻声", references: [] } },
        1,
      );
      const tree = await f.tree(),
        dialogueId = randomUUID();
      const shot = await f.ok(
        "POST",
        `${f.path}/shots`,
        {
          sceneId: tree.scenes[0].id,
          label: "对白",
          position: 1,
          status: "active",
          spec: {
            intent: "门口对话",
            references: [],
            dialogue: [
              {
                id: dialogueId,
                text: "钥匙还在。",
                voiceAssetRevisionId: voice.id,
              },
            ],
          },
        },
        await f.next(),
      );
      const document = structuredClone(work.document);
      const binding = {
        id: randomUUID(),
        shotRevisionId: shot.specRevisionId,
        dialogueId,
        clipId: randomUUID(),
        usage: "dialogue",
        voiceAssetRevisionId: voice.id,
      };
      document.dramaBindings.push(binding);
      work = await save(document, work.revision);
      assert.ok(work.issues.some((i: any) => i.code === "BINDING_UNRESOLVED"));
      assert.equal(await count("edit_history_dialogue_refs"), 1);
      const bad = structuredClone(document);
      bad.dramaBindings[0].dialogueId = randomUUID();
      assert.ok(
        [409, 422].includes(
          (
            await f.request(
              "PUT",
              route,
              { baseCutRevision: 1, document: bad },
              work.revision,
            )
          ).statusCode,
        ),
      );
      await tx(async ({ sql }) => {
        await sql.query(
          "UPDATE assets SET status='archived',revision=revision+1 WHERE id=$1",
          [asset.id],
        );
      });
      document.dramaBindings[0].note = "保留原声音等待补录";
      work = await save(document, work.revision);
      document.dramaBindings[0].clipId = randomUUID();
      assert.equal(
        (
          await f.request(
            "PUT",
            route,
            { baseCutRevision: 1, document },
            work.revision,
          )
        ).statusCode,
        422,
      );
    },
  );
  await t.test(
    "quality references in work specifications are typed, bounded and authorized",
    async () => {
      const source = await media();
      const document = structuredClone(work.document);
      document.timeline.spec.qualityReferenceMediaIds = [source];
      work = await save(document, work.revision);
      assert.equal(await count("edit_history_spec_media_refs"), 1);
      await tx(async ({ sql }) => {
        await sql.query(
          "UPDATE media SET status='archived',revision=revision+1 WHERE id=$1",
          [source],
        );
      });
      const live = await read();
      assert.equal(live.documentHash, work.documentHash);
      assert.ok(live.issues.some((i: any) => i.code === "MEDIA_UNAVAILABLE"));
      document.timeline.spec.deliveryNotes = "保留现有质量参考";
      work = await save(document, work.revision);
      delete document.timeline.spec.qualityReferenceMediaIds;
      work = await save(document, work.revision);
      document.timeline.spec.qualityReferenceMediaIds = [source];
      assert.equal(
        (
          await f.request(
            "PUT",
            route,
            { baseCutRevision: 1, document },
            work.revision,
          )
        ).statusCode,
        422,
      );
    },
  );
  await t.test(
    "capacity failures preserve the shared document; canonical bytes permit legitimate payloads beyond one MiB",
    async () => {
      const oversized = structuredClone(work.document);
      oversized.timeline.tracks = Array.from({ length: 33 }, () => ({
        id: randomUUID(),
        kind: "video",
        muted: false,
        items: [],
      }));
      assert.equal(
        (
          await f.request(
            "PUT",
            route,
            { baseCutRevision: 1, document: oversized },
            work.revision,
          )
        ).statusCode,
        413,
      );
      oversized.timeline.tracks = [0, 1].map(() => ({
        id: randomUUID(),
        kind: "subtitle",
        muted: false,
        items: Array.from({ length: 2501 }, () => ({
          id: randomUUID(),
          kind: "subtitle",
          timelineStartUs: 0,
          durationUs: 0,
          text: "",
        })),
      }));
      assert.equal(
        (
          await f.request(
            "PUT",
            route,
            { baseCutRevision: 1, document: oversized },
            work.revision,
          )
        ).statusCode,
        413,
      );
      oversized.timeline.tracks = [
        {
          id: randomUUID(),
          kind: "subtitle",
          muted: false,
          items: Array.from({ length: 800 }, () => ({
            id: randomUUID(),
            kind: "subtitle",
            timelineStartUs: 0,
            durationUs: 0,
            text: "中".repeat(2000),
          })),
        },
      ];
      assert.equal(
        (
          await f.request(
            "PUT",
            route,
            { baseCutRevision: 1, document: oversized },
            work.revision,
          )
        ).statusCode,
        413,
      );
      assert.deepEqual((await read()).document, work.document);
      oversized.timeline.tracks[0].items.length = 200;
      const before = structuredClone(work.document);
      work = await save(oversized, work.revision);
      assert.ok(
        Buffer.byteLength(JSON.stringify(work.document), "utf8") > 1024 * 1024,
      );
      assert.equal(work.document.timeline.tracks[0].items.length, 200);
      // Keep the large transport test separate from the finite-history exercise.
      work = await save(before, work.revision);
    },
  );
  await t.test(
    "finite history deduplicates bodies, protects two heads and returns 410 for a pruned actual revision",
    async () => {
      const document = structuredClone(work.document);
      const startingRevision = work.revision;
      // Distinct notes create real edits; unchanged writes were tested above.
      for (let i = 0; i < 104; i++) {
        document.unresolvedEdits[0].note = `待处理 ${i}`;
        work = await save(document, work.revision);
      }
      assert.equal(work.revision, startingRevision + 104);
      const history = await f.ok("GET", `${route}/revisions?limit=100`);
      assert.equal(history.items[0].revision, work.revision);
      assert.ok(history.items[0].retainedFor.includes("current"));
      assert.ok(history.items[1].retainedFor.includes("previous"));
      const kept = await f.admin.query(
        `SELECT revision FROM ${f.schema}.cut_work_draft_revisions WHERE cut_id=$1`,
        [cut.id],
      );
      const keptNumbers = new Set(kept.rows.map((r) => Number(r.revision)));
      const expiredRevision = Array.from(
        { length: work.revision },
        (_, i) => i + 1,
      ).find((r) => !keptNumbers.has(r));
      assert.ok(expiredRevision);
      const expired = await f.request(
        "GET",
        `${route}/revisions/${expiredRevision}`,
      );
      assert.equal(expired.statusCode, 410, expired.body);
      assert.equal(expired.json().code, "EDIT_HISTORY_EXPIRED");
      const currentCount = await f.admin.query(
        `SELECT count(*)::int AS count FROM ${f.schema}.cut_work_draft_revisions WHERE cut_id=$1`,
        [cut.id],
      );
      assert.ok(
        currentCount.rows[0].count <= 103,
        "100 recent + real UTC checkpoints only",
      );
      assert.equal(
        (await f.request("GET", `${route}/revisions/${work.revision + 1}`))
          .statusCode,
        404,
      );
      assert.deepEqual((await read()).document, work.document);
    },
  );
  await t.test(
    "restricted SQL cannot overwrite retained content, forge projections or move the shared root backward",
    async () => {
      for (const sql of [
        "UPDATE cuts SET updated_at=now() WHERE id=$1",
        "UPDATE cut_work_drafts SET revision=1 WHERE cut_id=$1",
        "DELETE FROM cut_work_draft_revisions WHERE cut_id=$1",
        "DELETE FROM edit_history_bodies WHERE cut_id=$1",
        "UPDATE edit_history_bodies SET canonical_json='{}' WHERE cut_id=$1",
        "DELETE FROM edit_history_media_refs WHERE cut_id=$1",
      ])
        await assert.rejects(
          tx(async (t) => {
            await t.sql.query(sql, [cut.id]);
          }),
        );
      await assert.rejects(
        tx(async (t) => {
          await t.sql.query(
            "INSERT INTO edit_history_media_refs(tenant_id,project_id,cut_id,body_hash,clip_id,media_id) VALUES($1,$2,$3,$4,$5,$6)",
            [
              f.tenant.id,
              f.project.id,
              cut.id,
              work.documentHash,
              randomUUID(),
              video,
            ],
          );
        }),
      );
      assert.deepEqual((await read()).document, work.document);
      const actualHash = createHash("sha256")
        .update(editingCanonical(work.document))
        .digest("hex");
      assert.equal(actualHash, work.documentHash);
    },
  );
});

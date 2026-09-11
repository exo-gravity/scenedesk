import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:https";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import { sqlIdentifier } from "@drama/database";
import { databaseFixture } from "../../tests/support/database.js";
import { buildApp } from "../../apps/api/src/app.js";
import { issueSession } from "../../apps/api/src/modules/identity/sessions.js";
import {
  bootstrap,
  type BootstrapRecord,
  type Transport,
} from "../operator/bootstrap.js";
import { readPrivate, writePrivate } from "../operator/private-files.js";

test("private owner bootstrap follows real API authority and never resends an unknown createTenant", async (t) => {
  const db = await databaseFixture(t);
  const directory = await mkdtemp(join(tmpdir(), "scenedesk-owner-db-"));
  await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      "key.pem",
      "-out",
      "cert.pem",
      "-days",
      "1",
      "-subj",
      "/CN=SceneDesk operator test",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { cwd: directory, stdio: "ignore" },
  );
  let app: FastifyInstance;
  let networkPosts = 0;
  const server = createServer(
    {
      key: await readFile(join(directory, "key.pem")),
      cert: await readFile(join(directory, "cert.pem")),
    },
    async (request, response) => {
      if (request.method === "POST") networkPosts++;
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const result = await app.inject({
        method: request.method as "GET" | "POST",
        url: request.url!,
        headers: request.headers,
        ...(chunks.length ? { payload: Buffer.concat(chunks) } : {}),
      });
      response.writeHead(result.statusCode, result.headers);
      response.end(result.body);
    },
  );
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((done) => server.close(() => done()));
  });
  const origin = `https://127.0.0.1:${(server.address() as { port: number }).port}`;
  app = buildApp(db.runtime, {
    origin,
    secret: randomBytes(32).toString("base64url"),
    schema: db.schema,
  });
  t.after(() => app.close());
  await app.ready();
  const identity = (name: string) =>
    issueSession(
      db.auth,
      {
        issuer: "urn:scenedesk:operator-test",
        subject: name,
        email: `${name}@example.test`,
        emailVerified: true,
        displayName: name,
      },
      { schema: db.schema },
    );
  const apiTransport: Transport = async (path, request) => {
    const result = await app.inject({
      method: request.method,
      url: path,
      headers: request.headers,
      ...(request.body ? { payload: request.body } : {}),
    });
    return {
      status: result.statusCode,
      headers: Object.fromEntries(
        Object.entries(result.headers).map(([key, value]) => [
          key,
          String(value),
        ]),
      ),
      body: result.json(),
    };
  };
  const options = async (name: string) => {
    const user = await identity(name);
    return {
      config: {
        origin,
        expectedUserId: user.userId,
        name: `私有 ${name}`,
        currency: "CNY",
      },
      credentials: { origin, token: user.token },
      recordFile: join(directory, `${name}.json`),
      transport: apiTransport,
    };
  };
  const first = await options("first");
  await t.test(
    "default reads only; explicit apply establishes one owner; same-user new session rechecks without POST",
    async () => {
      let posts = 0;
      const transport: Transport = async (path, request) => {
        if (request.method === "POST") posts++;
        return apiTransport(path, request);
      };
      assert.equal(
        (await bootstrap({ ...first, transport })).status,
        "ready_for_explicit_apply",
      );
      assert.equal(posts, 0);
      assert.equal(await readPrivate(first.recordFile, true), undefined);
      const unconfirmed = {
        origin,
        name: first.config.name,
        currency: first.config.currency,
      };
      assert.equal(
        (await bootstrap({ ...first, config: unconfirmed, transport })).status,
        "ready_for_explicit_apply",
      );
      await assert.rejects(
        bootstrap({ ...first, config: unconfirmed, transport, apply: true }),
        /EXPECTED_USER_CONFIRMATION_REQUIRED/,
      );
      assert.equal(
        (await bootstrap({ ...first, transport, apply: true })).status,
        "created",
      );
      const record = (await readPrivate(first.recordFile)) as BootstrapRecord;
      const renewed = await identity("first");
      assert.equal(
        (
          await bootstrap({
            ...first,
            credentials: { origin, token: renewed.token },
            transport,
            apply: true,
          })
        ).status,
        "already_completed",
      );
      assert.equal(posts, 1);
      assert.equal(record.actorId, renewed.userId);
      const state = await readFile(first.recordFile, "utf8");
      assert.equal(state.includes(first.credentials.token), false);
      assert.equal(state.includes(renewed.token), false);
    },
  );
  const unknown = await options("unknown");
  let unknownTenant = "",
    unknownPosts = 0;
  await t.test(
    "lost committed response remains unknown across reload and expired receipt; explicit existing selection proves only current ownership",
    async () => {
      const transport: Transport = async (path, request) => {
        if (request.method !== "POST") return apiTransport(path, request);
        unknownPosts++;
        const before = (await readPrivate(
          unknown.recordFile,
        )) as BootstrapRecord;
        assert.equal(before.attempts[0]!.status, "unknown");
        assert.equal(
          before.attempts[0]!.key === request.headers["idempotency-key"],
          true,
        );
        const result = await apiTransport(path, request);
        assert.equal(result.status, 201);
        unknownTenant = (result.body as { id: string }).id;
        throw Error("Controlled response loss after database commit");
      };
      assert.equal(
        (await bootstrap({ ...unknown, transport, apply: true })).status,
        "original_request_unknown_no_resend",
      );
      await db.admin.query(
        `UPDATE ${sqlIdentifier(db.schema)}.idempotency_records SET expires_at=now()-interval '1 second' WHERE actor_id=$1`,
        [unknown.config.expectedUserId],
      );
      assert.equal(
        (await bootstrap({ ...unknown, transport, apply: true })).status,
        "original_request_unknown_no_resend",
      );
      assert.equal(
        (await bootstrap({ ...unknown, selectExisting: unknownTenant })).status,
        "owner_selected_original_request_unknown",
      );
      assert.equal(
        (await bootstrap({ ...unknown, transport, apply: true })).status,
        "original_request_unknown_no_resend",
      );
      assert.equal(unknownPosts, 1);
      const report = (await readPrivate(
        `${unknown.recordFile}.review.json`,
      )) as { originalReceiptProven: boolean };
      assert.equal(report.originalReceiptProven, false);
      assert.equal(
        ((await readPrivate(unknown.recordFile)) as BootstrapRecord)
          .attempts[0]!.status,
        "unknown",
      );
    },
  );
  await t.test(
    "actor/origin changes and non-owner existing selection cannot authorize bootstrap",
    async () => {
      await assert.rejects(
        bootstrap({ ...unknown, credentials: first.credentials, apply: true }),
        /ACTOR_MISMATCH/,
      );
      await assert.rejects(
        bootstrap({
          ...unknown,
          credentials: {
            ...unknown.credentials,
            origin: "https://different.example",
          },
          apply: true,
        }),
        /ORIGIN_MISMATCH/,
      );
      const session = await apiTransport("/v1/session", {
        method: "GET",
        headers: { cookie: `session=${unknown.credentials.token}` },
      });
      const invitation = await apiTransport(
        `/v1/tenants/${unknownTenant}/invitations`,
        {
          method: "POST",
          headers: {
            cookie: `session=${unknown.credentials.token}`,
            origin,
            "x-csrf-token": (session.body as { csrfToken: string }).csrfToken,
            "idempotency-key": randomUUID(),
            "content-type": "application/json",
          },
          body: JSON.stringify({ email: "first@example.test", role: "member" }),
        },
      );
      assert.equal(invitation.status, 201);
      const token = new URLSearchParams(
        new URL(
          (invitation.body as { invitationUrl: string }).invitationUrl,
        ).hash.split("?")[1],
      ).get("token");
      const current = await apiTransport("/v1/session", {
        method: "GET",
        headers: { cookie: `session=${first.credentials.token}` },
      });
      const accepted = await apiTransport("/v1/invitations/accept", {
        method: "POST",
        headers: {
          cookie: `session=${first.credentials.token}`,
          origin,
          "x-csrf-token": (current.body as { csrfToken: string }).csrfToken,
          "idempotency-key": randomUUID(),
          "content-type": "application/json",
        },
        body: JSON.stringify({ token }),
      });
      assert.equal(accepted.status, 201);
      await assert.rejects(
        bootstrap({ ...first, selectExisting: unknownTenant }),
        /ACTIVE_OWNER_REQUIRED/,
      );
      await assert.rejects(
        bootstrap({
          ...first,
          recordFile: join(directory, "other-first.json"),
          apply: true,
        }),
        /EXISTING_WORKSPACE_REQUIRES_SELECTION/,
      );
    },
  );
  await t.test(
    "known pre-business rejection permits explicit corrected input; generic proxy 4xx never does",
    async () => {
      const rejected = await options("rejected");
      let reject = true;
      const transport: Transport = (path, request) =>
        apiTransport(
          path,
          reject && request.method === "POST"
            ? {
                ...request,
                headers: {
                  ...request.headers,
                  origin: "https://wrong.example",
                },
              }
            : request,
        );
      assert.equal(
        (await bootstrap({ ...rejected, transport, apply: true })).status,
        "business_rejected_input_retained",
      );
      reject = false;
      assert.equal(
        (
          await bootstrap({
            ...rejected,
            config: { ...rejected.config, name: "明确改过的输入" },
            transport,
            apply: true,
          })
        ).status,
        "created",
      );
      assert.equal(
        ((await readPrivate(rejected.recordFile)) as BootstrapRecord).attempts
          .length,
        2,
      );
      const proxy = await options("proxy");
      let posts = 0;
      const proxyTransport: Transport = async (path, request) =>
        request.method === "POST"
          ? (posts++,
            {
              status: 403,
              headers: {},
              body: {
                code: "FORBIDDEN",
                message: "proxy rejected",
                requestId: "proxy-1",
              },
            })
          : apiTransport(path, request);
      assert.equal(
        (await bootstrap({ ...proxy, transport: proxyTransport, apply: true }))
          .status,
        "original_request_unknown_no_resend",
      );
      await bootstrap({ ...proxy, transport: proxyTransport, apply: true });
      assert.equal(posts, 1);
    },
  );
  await t.test(
    "operator command uses actual TLS API, private review output and a single explicit POST",
    async () => {
      const cli = await options("cli");
      const configFile = join(directory, "operator-config.json"),
        credentialsFile = join(directory, "operator-session.json");
      await writePrivate(configFile, cli.config);
      await writePrivate(credentialsFile, cli.credentials);
      const aliasCredentials = `${directory}/./aliased-record.review.json`;
      await writePrivate(aliasCredentials, cli.credentials);
      await assert.rejects(
        promisify(execFile)(
          process.execPath,
          [
            "--import",
            "tsx",
            "deploy/operator/owner-bootstrap.ts",
            "--config",
            configFile,
            "--credentials",
            aliasCredentials,
            "--record",
            join(directory, "aliased-record"),
          ],
          { cwd: resolve("."), timeout: 30000 },
        ),
        (error: unknown) => {
          assert.match(
            (error as { stderr: string }).stderr,
            /PRIVATE_PATHS_MUST_DIFFER/,
          );
          return true;
        },
      );
      assert.deepEqual(await readPrivate(aliasCredentials), cli.credentials);
      const caseCredentials = join(directory, "CASE-RECORD.review.json");
      await writePrivate(caseCredentials, cli.credentials);
      if (await readPrivate(join(directory, "case-record.review.json"), true)) {
        await assert.rejects(
          promisify(execFile)(
            process.execPath,
            [
              "--import",
              "tsx",
              "deploy/operator/owner-bootstrap.ts",
              "--config",
              configFile,
              "--credentials",
              caseCredentials,
              "--record",
              join(directory, "case-record"),
            ],
            { cwd: resolve("."), timeout: 30000 },
          ),
          (error: unknown) => {
            assert.match(
              (error as { stderr: string }).stderr,
              /PRIVATE_PATHS_MUST_DIFFER/,
            );
            return true;
          },
        );
        assert.deepEqual(await readPrivate(caseCredentials), cli.credentials);
      } else
        t.diagnostic(
          "Case-sensitive filesystem: distinct filename case does not alias; /./ rejection remains covered.",
        );
      const args = [
        "--import",
        "tsx",
        "deploy/operator/owner-bootstrap.ts",
        "--config",
        configFile,
        "--credentials",
        credentialsFile,
        "--record",
        cli.recordFile,
      ];
      const invoke = (apply = false) =>
        promisify(execFile)(
          process.execPath,
          [...args, ...(apply ? ["--apply"] : [])],
          {
            cwd: resolve("."),
            env: {
              ...process.env,
              NODE_EXTRA_CA_CERTS: join(directory, "cert.pem"),
            },
            timeout: 30000,
          },
        );
      const preflight = await invoke();
      assert.equal(
        JSON.parse(preflight.stdout).status,
        "ready_for_explicit_apply",
      );
      assert.equal(networkPosts, 0);
      const created = await invoke(true);
      assert.equal(JSON.parse(created.stdout).status, "created");
      assert.equal(
        (await invoke(true)).stdout.includes("already_completed"),
        true,
      );
      assert.equal(networkPosts, 1);
      for (const secret of [
        cli.credentials.token,
        cli.config.expectedUserId,
        "cli@example.test",
        cli.config.name,
      ])
        assert.equal(created.stdout.includes(secret), false);
      assert.equal(created.stderr, "");
    },
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { databaseFixture } from "../support/database.js";
import { oidcFixture } from "../support/oidc.js";
import { buildApp } from "../../apps/api/src/app.js";
import { discoverIssuer } from "../../apps/api/src/modules/identity/oidc.js";
import { sqlIdentifier } from "@drama/database";

test("OIDC validates signed identity and binds each callback to one browser handshake", async (t) => {
  const db = await databaseFixture(t),
    provider = await oidcFixture();
  t.after(() => provider.close());
  const config = await discoverIssuer({
    issuer: provider.issuer,
    clientId: "fixture-client",
    clientSecret: "fixture-secret",
    localIssuer: true,
  });
  const origin = "http://127.0.0.1:4311";
  const app = buildApp(db.runtime, {
    schema: db.schema,
    origin,
    secret: randomBytes(32).toString("base64url"),
    auth: { pool: db.auth, config },
  });
  t.after(() => app.close());
  await app.ready();
  async function begin(returnTo = "/#/projects") {
    const login = await app.inject(
      `/v1/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
    );
    assert.equal(login.statusCode, 302, login.body);
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const auth = await fetch(login.headers.location!, { redirect: "manual" });
    assert.equal(auth.status, 302);
    const callback = new URL(auth.headers.get("location")!);
    return { cookie, url: `${callback.pathname}${callback.search}` };
  }
  await t.test(
    "rejects unsafe redirect paths and foreign browser before exchanging a code",
    async () => {
      for (const path of [
        "//evil.example",
        "/\\evil.example",
        "https://evil.example",
        "/\n/evil.example",
      ])
        assert.equal(
          (
            await app.inject(
              `/v1/auth/login?returnTo=${encodeURIComponent(path)}`,
            )
          ).statusCode,
          422,
        );
      const login = await begin();
      const foreign = await app.inject({
        url: login.url,
        headers: { cookie: "login_browser=foreign" },
      });
      assert.equal(foreign.statusCode, 401);
      assert.equal(provider.state.exchanges, 0);
      const success = await app.inject({
        url: login.url,
        headers: { cookie: login.cookie },
      });
      assert.equal(success.statusCode, 302, success.body);
      assert.equal(success.headers.location, "/#/projects");
      const cookies = success.headers["set-cookie"] as string[];
      const session = cookies.find((c) => c.startsWith("session="))!;
      assert.match(session, /HttpOnly/);
      assert.match(session, /SameSite=Lax/);
      const current = await app.inject({
        url: "/v1/session",
        headers: { cookie: session.split(";")[0]! },
      });
      assert.equal(current.statusCode, 200, current.body);
      assert.equal(current.json().email, "fixture@example.test");
      const replay = await app.inject({
        url: login.url,
        headers: { cookie: login.cookie },
      });
      assert.equal(replay.statusCode, 401);
    },
  );
  await t.test(
    "rejects bad nonce, issuer, audience, expiry and signature without issuing sessions",
    async () => {
      const before = await db.admin.query(
        `SELECT count(*) FROM ${sqlIdentifier(db.schema)}.sessions`,
      );
      for (const claims of [
        { nonce: "wrong" },
        { iss: "https://evil.example" },
        { aud: "other-client" },
        { exp: 1 },
      ]) {
        provider.state.claims = claims;
        const login = await begin();
        const denied = await app.inject({
          url: login.url,
          headers: { cookie: login.cookie },
        });
        assert.equal(denied.statusCode, 401, JSON.stringify(claims));
      }
      provider.state.claims = {};
      provider.state.badSignature = true;
      const login = await begin();
      assert.equal(
        (
          await app.inject({
            url: login.url,
            headers: { cookie: login.cookie },
          })
        ).statusCode,
        401,
      );
      provider.state.badSignature = false;
      const after = await db.admin.query(
        `SELECT count(*) FROM ${sqlIdentifier(db.schema)}.sessions`,
      );
      assert.equal(after.rows[0].count, before.rows[0].count);
    },
  );
  await t.test(
    "parallel callbacks issue one session; expired handshakes cannot exchange",
    async () => {
      const login = await begin();
      const calls = await Promise.all(
        Array.from({ length: 3 }, () =>
          app.inject({ url: login.url, headers: { cookie: login.cookie } }),
        ),
      );
      assert.deepEqual(calls.map((r) => r.statusCode).sort(), [302, 401, 401]);
      const expired = await begin();
      await db.admin.query(
        `UPDATE ${sqlIdentifier(db.schema)}.oidc_handshakes SET expires_at=now()-interval '1 second' WHERE consumed_at IS NULL`,
      );
      assert.equal(
        (
          await app.inject({
            url: expired.url,
            headers: { cookie: expired.cookie },
          })
        ).statusCode,
        401,
      );
    },
  );
});

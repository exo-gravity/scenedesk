import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { sqlIdentifier } from "@drama/database";
import { businessFixture } from "../support/business.js";

test("content creation recovery preserves one object after receipt expiry and rechecks current project access", async (t) => {
  const f = await businessFixture(t),
    scope = sqlIdentifier(f.schema);
  let episodeId: string, sceneId: string;
  const cases = [
    {
      name: "episode",
      collection: "episodes",
      operation: "createEpisode",
      body: (position: number) => ({
        title: "原单集",
        position,
        status: "active",
      }),
    },
    {
      name: "scene",
      collection: "scenes",
      operation: "createScene",
      body: (position: number) => ({
        episodeId,
        title: "原场次",
        position,
        status: "active",
        summary: "固定创建输入",
        state: { spatialNotes: "门在左侧" },
        defaultAssetRevisionIds: [],
      }),
    },
    {
      name: "shot",
      collection: "shots",
      operation: "createShot",
      body: (position: number) => ({
        sceneId,
        label: "原镜头",
        position,
        status: "active",
        spec: {
          intent: "找到钥匙",
          action: "她推开左侧的门",
          dialogue: [{ id: randomUUID(), text: "钥匙就在这里。" }],
          references: [],
          plannedDurationUs: 2000000,
        },
      }),
    },
  ] as const;

  for (const kind of cases)
    await t.test(
      `${kind.name}: exact replay after the 24-hour receipt expires returns 412 without another object`,
      async () => {
        // Preserve the first body's generated IDs, original position, version and key.
        const body = kind.body(0),
          version = await f.next(),
          key = randomUUID(),
          path = `${f.path}/${kind.collection}`;
        const created = await f.request("POST", path, body, version, key);
        assert.equal(created.statusCode, 201, created.body);
        const original = created.json();
        if (kind.name === "episode") episodeId = original.id;
        if (kind.name === "scene") sceneId = original.id;
        const after = await f.tree();
        assert.equal(after[kind.collection].length, 1);
        assert.equal(after[kind.collection][0].id, original.id);
        assert.equal(after.revision, version + 1);

        // The pre-expiry replay actually returns its cached original despite the old If-Match.
        const cached = await f.request("POST", path, body, version, key);
        assert.equal(cached.statusCode, 201, cached.body);
        assert.deepEqual(cached.json(), original);
        assert.deepEqual(await f.tree(), after);

        // Advance only this isolated fixture's receipt deadline; no business row is changed.
        const expired = await f.admin.query(
          `UPDATE ${scope}.idempotency_records SET expires_at=now()-interval '1 second' WHERE actor_id=$1 AND scope_key=$2 AND operation_id=$3 AND request_path=$4 AND key=$5`,
          [f.owner.userId, `tenant:${f.tenant.id}`, kind.operation, path, key],
        );
        assert.equal(expired.rowCount, 1);
        const replay = await f.request("POST", path, body, version, key);
        assert.equal(replay.statusCode, 412, replay.body);
        assert.equal(replay.json().code, "VERSION_CONFLICT");
        // A public read proves both entity count and immutable shot requirements stay intact.
        assert.deepEqual(await f.tree(), after);
      },
    );

  const creator = await f.identity("receipt-creator");
  const invitation = await f.ok(
    "POST",
    `/v1/tenants/${f.tenant.id}/invitations`,
    { email: "receipt-creator@example.test", role: "member" },
  );
  const token = new URLSearchParams(
    new URL(invitation.invitationUrl).hash.split("?")[1],
  ).get("token");
  assert.ok(token);
  const accepted = await f.request(
    "POST",
    "/v1/invitations/accept",
    { token },
    undefined,
    randomUUID(),
    creator,
  );
  assert.equal(accepted.statusCode, 201, accepted.body);
  const membershipId = accepted.json().id;

  for (const kind of cases)
    await t.test(
      `${kind.name}: removing the creator's project access denies a still-valid cached receipt`,
      async () => {
        const membership = await f.ok("POST", `${f.path}/members`, {
          membershipId,
        });
        const body = kind.body(1),
          version = await f.next(),
          key = randomUUID(),
          path = `${f.path}/${kind.collection}`;
        const created = await f.request(
          "POST",
          path,
          body,
          version,
          key,
          creator,
        );
        assert.equal(created.statusCode, 201, created.body);
        const after = await f.tree();
        assert.equal(after[kind.collection].length, 2);
        const cached = await f.request(
          "POST",
          path,
          body,
          version,
          key,
          creator,
        );
        assert.equal(cached.statusCode, 201, cached.body);
        assert.deepEqual(cached.json(), created.json());

        await f.ok(
          "DELETE",
          `${f.path}/members/${membershipId}`,
          undefined,
          membership.revision,
        );
        // The same session remains valid and the actor remains a tenant member.
        for (const readPath of ["/v1/session", `/v1/tenants/${f.tenant.id}`]) {
          const readable = await f.request(
            "GET",
            readPath,
            undefined,
            undefined,
            randomUUID(),
            creator,
          );
          assert.equal(readable.statusCode, 200, readable.body);
        }
        const denied = await f.request(
          "POST",
          path,
          body,
          version,
          key,
          creator,
        );
        assert.equal(denied.statusCode, 404, denied.body);
        assert.equal(denied.json().code, "NOT_FOUND");
        assert.equal(denied.json().id, undefined);
        assert.deepEqual(await f.tree(), after);
      },
    );
});

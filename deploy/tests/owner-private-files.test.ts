import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalPrivatePath,
  PRIVATE_JSON_MAX_BYTES,
  readPrivate,
  writePrivate,
  withPrivateLock,
} from "../operator/private-files.js";
import {
  httpTransport,
  parseConfig,
  parseCredentials,
} from "../operator/bootstrap.js";

test("owner operator uses private durable files and refuses a concurrent writer or public files", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "scenedesk-owner-private-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await chmod(directory, 0o700);
  const record = join(directory, "record.json");
  await withPrivateLock(record, async () => {
    await assert.rejects(
      withPrivateLock(record, async () => {}),
      /BOOTSTRAP_LOCKED/,
    );
    await writePrivate(record, { status: "unknown" });
    assert.equal((await stat(record)).mode & 0o777, 0o600);
    assert.equal((await stat(`${record}.lock`)).mode & 0o777, 0o600);
    assert.deepEqual(await readPrivate(record), { status: "unknown" });
  });
  await assert.rejects(stat(`${record}.lock`), { code: "ENOENT" });
  await assert.rejects(
    writePrivate(record, { oversized: "字".repeat(PRIVATE_JSON_MAX_BYTES) }),
    /PRIVATE_JSON_TOO_LARGE/,
  );
  assert.deepEqual(await readPrivate(record), { status: "unknown" });
  const alias = join(directory, "alias");
  await symlink(directory, alias);
  assert.equal(
    await canonicalPrivatePath(`${directory}/./record.json`),
    await canonicalPrivatePath(record),
  );
  assert.equal(
    await canonicalPrivatePath(join(alias, "record.json")),
    await canonicalPrivatePath(record),
  );
  await chmod(record, 0o644);
  await assert.rejects(readPrivate(record), /PRIVATE_FILE_0600_REQUIRED/);
  await chmod(record, 0o600);
  await chmod(directory, 0o755);
  await assert.rejects(
    writePrivate(record, {}),
    /PRIVATE_DIRECTORY_0700_REQUIRED/,
  );
});

test("operator HTTPS reader cancels responses above its private JSON byte budget", async (t) => {
  let cancelled = false;
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new Uint8Array(65536));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  await assert.rejects(
    httpTransport("https://workspace.example")("/v1/session", {
      method: "GET",
      headers: {},
    }),
    /API_RESPONSE_TOO_LARGE/,
  );
  assert.equal(cancelled, true);
});

test("owner operator accepts only a pinned HTTPS origin and existing session credentials", () => {
  const input = {
    origin: "https://workspace.example",
    name: "私有创作",
    currency: "CNY",
  };
  assert.equal(parseConfig(input).origin, input.origin);
  for (const origin of [
    "http://localhost",
    "https://workspace.example/path",
    "https://workspace.example/",
    "https://name:secret@workspace.example",
  ])
    assert.throws(() => parseConfig({ ...input, origin }));
  assert.throws(() =>
    parseConfig({ ...input, expectedEmail: "owner@example.test" }),
  );
  assert.throws(() =>
    parseCredentials({
      origin: input.origin,
      token: "invalid",
      userId: "self-asserted",
    }),
  );
});

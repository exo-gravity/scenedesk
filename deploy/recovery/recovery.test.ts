import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, readFile, writeFile, chmod, stat, unlink, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Pool } from "pg";
import { setTimeout as delay } from "node:timers/promises";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { recoveryFixture, docker, privateJson } from "./smoke/fixture.js";
import { seedBusiness, verifyBusiness } from "./smoke/business.js";

async function cli(operation: "backup" | "restore" | "verify", config: string, bundle: string, secrets: string[]) {
  const child = spawn(process.execPath, ["--import", "tsx", "deploy/recovery/cli.ts", operation, "--config", config, "--bundle", bundle], {
    cwd: resolve("."), env: { PATH: process.env.PATH, ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}) }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const timer = setTimeout(() => child.kill("SIGKILL"), 600_000);
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
    if (Buffer.byteLength(output) > 64 * 1024) child.kill("SIGKILL");
  });
  const exitCode = await new Promise<number | null>((yes, no) => { child.once("error", no); child.once("close", yes); }).finally(() => clearTimeout(timer));
  for (const secret of secrets) assert.equal(output.includes(secret), false, "CLI output must not disclose fixture credentials or seal key");
  let result: { status?: string; code?: string; operation?: string; generationExecution?: string; fixedObjects?: number; modelRestartSafe?: boolean };
  try { result = JSON.parse(output.trim()); }
  catch { throw Error("RECOVERY_CLI_NON_STRUCTURED_OUTPUT"); }
  assert.equal(result.generationExecution, "disabled");
  if (exitCode === 0) assert.equal(result.status, "ok");
  else { assert.equal(result.status, "failed"); assert.match(result.code ?? "", /^[A-Z][A-Z0-9_]{1,100}$/); }
  return { exitCode, ...result };
}

test("private paired recovery preserves fixed media, history, authority and unresolved generation without execution", { timeout: 1_500_000 }, async t => {
  const fixture = await recoveryFixture();
  let admin: Pool | undefined;
  let cleanupStarted = false;
  const cleanup = async () => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    try { await admin?.end(); } finally { await fixture.close(); }
  };
  t.after(cleanup);
  const check = async (name: string, run: () => Promise<void>) => {
    let passed = false;
    await t.test(name, async () => { await run(); passed = true; });
    assert.ok(passed, `Stop recovery verification after failed stage: ${name}`);
  };
  const source = await fixture.create("source");
  t.diagnostic("Seeding only synthetic private resources through current APIs and restricted media/attempt functions");
  const seed = await seedBusiness(source);
  const target = await fixture.create("target");
  target.config.database.schema = seed.schema;
  const sourcePath = join(fixture.directory, "source.json"), targetPath = join(fixture.directory, "target.json"), bundle = join(fixture.directory, "bundle");
  await privateJson(sourcePath, source.config); await privateJson(targetPath, target.config);
  const seal = JSON.parse(await readFile(source.config.sealKeyFile, "utf8"));
  const secrets = [source.config.storage.accessKeyId, source.config.storage.secretAccessKey, new URL(source.url).password, seal.key, ...seed.poolCredentials.map(x => x.password)];
  const invoke = (operation: "backup" | "restore" | "verify", config = targetPath, location = bundle) => cli(operation, config, location, secrets);
  const results: Record<string, unknown> = { fixture: "synthetic_local_PG16_MinIO", generationExecutorStarted: false, originalProviderCalls: 0 };
  admin = new Pool({ connectionString: target.url, max: 1 });

  await check("a timed-out attached helper is actually stopped and removed from the daemon", async () => {
    const { runHelper } = await import("./host.js");
    const since = new Date().toISOString();
    let finished = false;
    const pending = runHelper(source.config, false, ["sleep", "30"], { timeout: 2000 }).then(() => undefined, error => error).finally(() => { finished = true; });
    let mounted = false;
    try {
      const deadline = Date.now() + 15_000;
      while (!mounted && !finished && Date.now() < deadline) {
        const id = await docker(["ps", "--all", "--quiet", "--no-trunc", "--filter", `label=io.scenedesk.recovery.run=${fixture.runId}`, "--filter", "name=scenedesk-recovery-helper-"]);
        if (id) {
          const [found] = JSON.parse(await docker(["inspect", id]));
          assert.deepEqual(found.Mounts.filter((mount: any) => mount.Type === "volume").map((mount: any) => ({ name: mount.Name, destination: mount.Destination })), [{ name: source.config.storage.volumeName, destination: "/recovery" }]);
          assert.ok(found.HostConfig.Tmpfs["/var/lib/postgresql/data"]);
          mounted = true;
        }
        if (!mounted) await delay(100);
      }
    } finally {
      assert.equal((await pending)?.code, "RECOVERY_COMMAND_TIMEOUT");
    }
    assert.equal(mounted, true, "Actual helper mounts were inspected before timeout");
    const remaining = await docker(["ps", "--all", "--quiet", "--filter", `label=io.scenedesk.recovery.run=${fixture.runId}`, "--filter", "name=scenedesk-recovery-helper-"]);
    assert.equal(remaining, "", "Killing the Docker client must not leave a helper container behind");
    const events = await docker(["events", "--since", since, "--until", new Date(Date.now() + 1000).toISOString(), "--filter", "type=container", "--filter", `label=io.scenedesk.recovery.run=${fixture.runId}`, "--format", "{{json .}}"]);
    const own = events.split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(event => event.Actor?.Attributes?.name?.startsWith("scenedesk-recovery-helper-"));
    assert.equal(own.filter(event => event.Action === "start").length, 1);
    assert.equal(own.filter(event => event.Action === "destroy").length, 1);
    results.helperTimeoutRemovedStartedContainer = true;
    results.helperCreatedNoAnonymousVolume = true;
  });
  await check("backup seals a matched database and cold storage archive and keeps original writers stopped", async () => {
    const result = await invoke("backup", sourcePath); assert.equal(result.exitCode, 0, result.code);
    assert.equal(result.operation, "backup"); assert.equal(result.modelRestartSafe, false); assert.ok((result.fixedObjects ?? 0) >= 3);
    for (const id of [source.config.database.containerId, source.config.storage.containerId, ...source.config.writers]) assert.equal(await docker(["inspect", "--format", "{{.State.Running}}", id]), "false");
    for (const file of ["manifest.json", "database.dump", "storage.tar"]) assert.equal((await stat(join(bundle, file))).mode & 0o777, 0o600);
    assert.equal((await stat(bundle)).mode & 0o777, 0o700);
    const manifestText = await readFile(join(bundle, "manifest.json"), "utf8");
    for (const secret of secrets) assert.equal(manifestText.includes(secret), false);
    const inventory = JSON.parse(manifestText).payload.storageVersions;
    assert.ok(inventory.some((entry: any) => entry.key === seed.marker.key && entry.versionId === seed.marker.versionId && entry.kind === "delete_marker"));
    assert.ok(inventory.some((entry: any) => entry.key === seed.reference.immutable_key && entry.versionId === seed.reference.storage_version_id && entry.latest === false));
    results.backup = result;
  });
  await check("rewriting both payload checksum and manifest cannot forge the independent seal", async () => {
    const altered = join(fixture.directory, "tampered"); await cp(bundle, altered, { recursive: true }); await chmod(altered, 0o700);
    const content = Buffer.from(await readFile(join(altered, "database.dump"))); content[content.length - 1]! ^= 1;
    await writeFile(join(altered, "database.dump"), content, { mode: 0o600 });
    const manifest = JSON.parse(await readFile(join(altered, "manifest.json"), "utf8"));
    manifest.payload.files[0].sha256 = createHash("sha256").update(content).digest("hex");
    await writeFile(join(altered, "manifest.json"), JSON.stringify(manifest), { mode: 0o600 });
    const result = await invoke("restore", targetPath, altered); assert.equal(result.exitCode, 1); assert.equal(result.code, "RECOVERY_BUNDLE_SEAL_MISMATCH");
    assert.equal(await docker(["inspect", "--format", "{{.State.Running}}", target.config.storage.containerId]), "false");
    results.forgedPairRejected = result.code;
  });
  await check("the seal key must remain outside the bundle even when its original signature is valid", async () => {
    const enclosed = join(fixture.directory, "bundled-credentials"); await cp(bundle, enclosed, { recursive: true }); await chmod(enclosed, 0o700);
    const keyPath = join(enclosed, "seal-key.json"); await cp(source.config.sealKeyFile, keyPath); await chmod(keyPath, 0o600);
    const configuration = join(fixture.directory, "bundled-key-target.json"); await privateJson(configuration, { ...target.config, sealKeyFile: keyPath });
    const result = await invoke("restore", configuration, enclosed); assert.equal(result.exitCode, 1); assert.equal(result.code, "RECOVERY_BUNDLE_CONTAINS_CREDENTIALS");
    assert.equal(await docker(["inspect", "--format", "{{.State.Running}}", target.config.storage.containerId]), "false");
    results.enclosedSealKeyRejected = result.code;
  });
  await check("a missing cold storage half cannot restore a database-only bundle", async () => {
    const incomplete = join(fixture.directory, "incomplete"); await cp(bundle, incomplete, { recursive: true }); await chmod(incomplete, 0o700);
    await unlink(join(incomplete, "storage.tar"));
    const result = await invoke("restore", targetPath, incomplete); assert.equal(result.exitCode, 1); assert.equal(result.code, "RECOVERY_OPERATION_FAILED");
    results.missingPairRejected = result.code;
  });
  await check("source container and volume identities cannot be restored in place", async () => {
    const result = await invoke("restore", sourcePath); assert.equal(result.exitCode, 1); assert.equal(result.code, "RECOVERY_SAME_SOURCE_TARGET");
    results.sourceAsTargetRejected = result.code;
  });
  await check("a nonempty target is rejected before touching its marker or starting storage", async () => {
    await admin!.query("CREATE SCHEMA recovery_existing; CREATE TABLE recovery_existing.marker(value text); INSERT INTO recovery_existing.marker VALUES ('must-survive-refusal')");
    const result = await invoke("restore"); assert.equal(result.exitCode, 1); assert.equal(result.code, "RECOVERY_TARGET_NOT_EMPTY");
    assert.deepEqual((await admin!.query("SELECT value FROM recovery_existing.marker")).rows, [{ value: "must-survive-refusal" }]);
    assert.equal(await docker(["inspect", "--format", "{{.State.Running}}", target.config.storage.containerId]), "false");
    await admin!.query("DROP SCHEMA recovery_existing CASCADE");
    results.nonemptyTargetUntouched = true;
  });
  await check("a new target restores and verifies the original fixed identities without starting an executor", async () => {
    const result = await invoke("restore"); assert.equal(result.exitCode, 0, result.code); assert.equal(result.operation, "restore");
    const checked = await invoke("verify"); assert.equal(checked.exitCode, 0, checked.code);
    // Repeating a completed restore is verification, never another pg_restore/tar mutation.
    const repeated = await invoke("restore"); assert.equal(repeated.exitCode, 0, repeated.code); assert.equal(repeated.operation, "verify");
    results.restore = result; results.verify = checked; results.repeatedRestoreIsReadOnly = true;
  });
  await check("restored restricted APIs expose exact original bytes and retained histories, keeping unknown and queued separate", async () => {
    results.business = await verifyBusiness(target, seed);
  });
  await check("loss of the referenced original version is detected despite a newer same-key version", async () => {
    // A separate fresh target avoids conflating deliberate API audit writes with
    // lost object bytes. No business/audit rows are deleted to fit a checksum.
    const broken = await fixture.create("target"); broken.config.database.schema = seed.schema;
    const brokenPath = join(fixture.directory, "missing-object-target.json"); await privateJson(brokenPath, broken.config);
    const restored = await invoke("restore", brokenPath); assert.equal(restored.exitCode, 0, restored.code);
    await broken.client.send(new DeleteObjectCommand({ Bucket: broken.config.storage.bucket, Key: seed.reference.immutable_key, VersionId: seed.reference.storage_version_id }));
    const result = await invoke("verify", brokenPath); assert.equal(result.exitCode, 1);
    assert.notEqual(result.code, "RECOVERY_DATABASE_SNAPSHOT_MISMATCH", "The database was untouched; only exact object loss caused this failure");
    assert.equal(result.code, "RECOVERY_FIXED_OBJECT_MISMATCH");
    results.missingOriginalVersionRejected = result.code;
  });
  await cleanup();
  results.namedFixtureResourcesRemoved = true;
  const parent = resolve("output/engineering/private-recovery"); await mkdir(parent, { recursive: true });
  const output = join(parent, fixture.runId); await mkdir(output);
  await writeFile(join(output, "results.json"), JSON.stringify({ status: "passed", ...results }, null, 2) + "\n", { flag: "wx" });
});

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  canonicalPrivatePath,
  privateDirectory,
  readPrivate,
  writePrivate,
  withPrivateLock,
  PRIVATE_JSON_MAX_BYTES,
} from "../operator/private-files.js";
import { docker, runHelper, inspect, psql, stopped } from "./host.js";
import {
  assertEmptyDatabase,
  restoreRoles,
  snapshot,
  storageReady,
} from "./snapshot.js";
import { storageSnapshot } from "./storage-snapshot.js";
import {
  MINIO_IMAGE,
  POSTGRES_IMAGE,
  RecoveryError,
  identifier,
  requireRecovery,
  type Configuration,
  type Payload,
} from "./types.js";

const strings = (value: unknown, names: string[]) =>
  value !== null &&
  typeof value === "object" &&
  names.every(
    (name) =>
      typeof (value as Record<string, unknown>)[name] === "string" &&
      ((value as Record<string, string>)[name]?.length ?? 0) > 0,
  );
export async function configuration(file: string): Promise<Configuration> {
  const config = (await readPrivate(
    await canonicalPrivatePath(file),
  )) as Configuration;
  requireRecovery(
    config?.version === 1 &&
      typeof config.runId === "string" &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        config.runId,
      ) &&
      ["source", "target"].includes(config.side) &&
      Array.isArray(config.writers) &&
      config.writers.length <= 16 &&
      config.writers.every((id) => typeof id === "string"),
    "RECOVERY_CONFIG_INVALID",
  );
  requireRecovery(
    strings(config.database, [
      "containerId",
      "volumeName",
      "database",
      "schema",
      "user",
    ]) &&
      strings(config.storage, [
        "containerId",
        "volumeName",
        "endpoint",
        "region",
        "bucket",
        "accessKeyId",
        "secretAccessKey",
      ]) &&
      typeof config.sealKeyFile === "string",
    "RECOVERY_CONFIG_INVALID",
  );
  requireRecovery(
    config.database.user === "postgres" &&
      /^(scenedesk|drama_recovery[a-z0-9_]*)$/.test(config.database.database),
    "RECOVERY_SYNTHETIC_DATABASE_REQUIRED",
  );
  identifier(config.database.schema);
  identifier(config.database.database);
  const configPath = await canonicalPrivatePath(file);
  const paths = await Promise.all(
    [
      configPath,
      config.sealKeyFile,
      `${configPath}.recovery.lock`,
      `${configPath}.restore-state.json`,
    ].map(canonicalPrivatePath),
  );
  requireRecovery(
    new Set(paths).size === paths.length,
    "RECOVERY_PRIVATE_PATH_COLLISION",
  );
  return config;
}
async function key(config: Configuration) {
  const value = (await readPrivate(
    await canonicalPrivatePath(config.sealKeyFile),
  )) as { version?: unknown; key?: unknown };
  requireRecovery(
    value?.version === 1 &&
      typeof value.key === "string" &&
      /^[A-Za-z0-9_-]{43}$/.test(value.key) &&
      Buffer.from(value.key, "base64url").length === 32,
    "RECOVERY_SEAL_KEY_INVALID",
  );
  return Buffer.from(value.key, "base64url");
}
async function digest(file: string, maximum: number) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    requireRecovery(
      info.isFile() &&
        (info.mode & 0o777) === 0o600 &&
        info.uid === process.getuid?.() &&
        info.size > 0 &&
        info.size <= maximum,
      "RECOVERY_BUNDLE_FILE_INVALID",
    );
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false }))
      hash.update(chunk);
    return { bytes: info.size, sha256: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}
async function bundleDirectory(path: string, create: boolean) {
  requireRecovery(isAbsolute(path), "RECOVERY_ABSOLUTE_BUNDLE_REQUIRED");
  await privateDirectory(path);
  const canonical = join(
    await realpath(dirname(path)),
    path.slice(path.lastIndexOf("/") + 1),
  );
  requireRecovery(
    canonical === resolve(path),
    "RECOVERY_CANONICAL_BUNDLE_REQUIRED",
  );
  if (create) {
    try {
      await mkdir(canonical, { mode: 0o700 });
      const parent = await open(dirname(canonical), "r");
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new RecoveryError("RECOVERY_BUNDLE_EXISTS");
      throw error;
    }
  }
  await privateDirectory(join(canonical, "manifest.json"));
  return canonical;
}
async function saveNew(file: string, value: unknown) {
  const encoded = JSON.stringify(value, null, 2) + "\n";
  requireRecovery(
    Buffer.byteLength(encoded) <= PRIVATE_JSON_MAX_BYTES,
    "RECOVERY_MANIFEST_SIZE_LIMIT",
  );
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(encoded);
    await handle.sync();
  } finally {
    await handle.close();
  }
  const directory = await open(dirname(file), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
async function manifest(
  config: Configuration,
  bundle: string,
): Promise<Payload> {
  const saved = (await readPrivate(join(bundle, "manifest.json"))) as {
    version?: number;
    payload?: Payload;
    hmacSha256?: string;
  };
  requireRecovery(
    saved?.version === 1 &&
      saved.payload &&
      typeof saved.hmacSha256 === "string" &&
      /^[a-f0-9]{64}$/.test(saved.hmacSha256),
    "RECOVERY_MANIFEST_INVALID",
  );
  const expected = createHmac("sha256", await key(config))
    .update(JSON.stringify(saved.payload))
    .digest();
  requireRecovery(
    timingSafeEqual(expected, Buffer.from(saved.hmacSha256, "hex")),
    "RECOVERY_BUNDLE_SEAL_MISMATCH",
  );
  const value = saved.payload;
  requireRecovery(
    value.format === "scenedesk-isolated-cold-recovery/1" &&
      value.runId === config.runId &&
      value.database === config.database.database &&
      value.schema === config.database.schema &&
      value.bucket === config.storage.bucket &&
      value.generationExecution === "disabled" &&
      value.images.postgres === POSTGRES_IMAGE &&
      value.images.minio === MINIO_IMAGE,
    "RECOVERY_BUNDLE_SCOPE_MISMATCH",
  );
  requireRecovery(
    value.files.length === 2 &&
      value.files[0]?.name === "database.dump" &&
      value.files[1]?.name === "storage.tar",
    "RECOVERY_BUNDLE_FILE_SET_INVALID",
  );
  for (const file of value.files) {
    const actual = await digest(
      join(bundle, file.name),
      file.name === "database.dump" ? 64 * 1024 * 1024 : 256 * 1024 * 1024,
    );
    requireRecovery(
      actual.bytes === file.bytes && actual.sha256 === file.sha256,
      "RECOVERY_BUNDLE_CHECKSUM_MISMATCH",
    );
  }
  return value;
}
function differentTarget(config: Configuration, payload: Payload) {
  requireRecovery(
    config.side === "target" &&
      ![
        payload.source.databaseContainer,
        payload.source.storageContainer,
      ].includes(config.database.containerId) &&
      ![
        payload.source.databaseContainer,
        payload.source.storageContainer,
      ].includes(config.storage.containerId) &&
      ![payload.source.databaseVolume, payload.source.storageVolume].includes(
        config.database.volumeName,
      ) &&
      ![payload.source.databaseVolume, payload.source.storageVolume].includes(
        config.storage.volumeName,
      ),
    "RECOVERY_SAME_SOURCE_TARGET",
  );
}
function report(payload: Payload, operation: string) {
  return {
    status: "ok",
    operation,
    scope: "isolated_synthetic_restore_only",
    generationExecution: "disabled",
    tables: payload.snapshot.tables.length,
    fixedObjects: payload.snapshot.objects.length,
    storageVersions: payload.storageVersions.length,
    generation: payload.snapshot.generation,
    modelRestartSafe: false,
  };
}
async function verify(config: Configuration, bundle: string, payload: Payload) {
  differentTarget(config, payload);
  const found = await inspect(config);
  requireRecovery(
    found.database.State.Running && found.storage.State.Running,
    "RECOVERY_TARGET_NOT_RUNNING",
  );
  const observed = await snapshot(config);
  requireRecovery(
    JSON.stringify(observed) === JSON.stringify(payload.snapshot),
    "RECOVERY_DATABASE_SNAPSHOT_MISMATCH",
  );
  requireRecovery(
    JSON.stringify(await storageSnapshot(config, payload.snapshot.objects)) ===
      JSON.stringify(payload.storageVersions),
    "RECOVERY_STORAGE_SNAPSHOT_MISMATCH",
  );
  return report(payload, "verify");
}
export async function recovery(
  operation: "backup" | "restore" | "verify",
  configFile: string,
  bundlePath: string,
) {
  const config = await configuration(configFile);
  const configPath = await canonicalPrivatePath(configFile);
  return withPrivateLock(`${configPath}.recovery`, async () => {
    if (operation === "backup") {
      requireRecovery(config.side === "source", "RECOVERY_SOURCE_REQUIRED");
      const found = await inspect(config);
      requireRecovery(
        found.database.State.Running && found.storage.State.Running,
        "RECOVERY_SOURCE_NOT_RUNNING",
      );
      const sealingKey = await key(config),
        bundle = await bundleDirectory(bundlePath, true);
      const startedAt = new Date().toISOString();
      await saveNew(join(bundle, "intent.json"), {
        version: 1,
        operation,
        runId: config.runId,
        generationExecution: "disabled",
        startedAt,
      });
      for (const writer of found.writers)
        if (writer.State.Running) await stopped(writer.Id);
      const writersStoppedAt = new Date().toISOString();
      requireRecovery(
        Number(
          (
            await psql(
              config,
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend';",
            )
          ).trim(),
        ) === 0,
        "RECOVERY_SOURCE_CLIENTS_STILL_CONNECTED",
      );
      const saved = await snapshot(config);
      const storageVersions = await storageSnapshot(config, saved.objects);
      await stopped(found.storage.Id);
      // Storage can no longer accept signed uploads. No database writer may remain.
      requireRecovery(
        JSON.stringify(await snapshot(config)) === JSON.stringify(saved),
        "RECOVERY_SOURCE_CHANGED_DURING_FREEZE",
      );
      await docker(
        [
          "exec",
          config.database.containerId,
          "pg_dump",
          "-Fc",
          "-U",
          config.database.user,
          "-d",
          config.database.database,
        ],
        { output: join(bundle, "database.dump"), maximum: 64 * 1024 * 1024 },
      );
      await stopped(found.database.Id);
      const databaseStoppedAt = new Date().toISOString();
      await runHelper(
        config,
        false,
        ["tar", "-C", "/recovery", "-cf", "-", "."],
        { output: join(bundle, "storage.tar"), maximum: 256 * 1024 * 1024 },
      );
      const payload: Payload = {
        format: "scenedesk-isolated-cold-recovery/1",
        runId: config.runId,
        database: config.database.database,
        schema: config.database.schema,
        bucket: config.storage.bucket,
        source: {
          databaseContainer: found.database.Id,
          storageContainer: found.storage.Id,
          databaseVolume: config.database.volumeName,
          storageVolume: config.storage.volumeName,
        },
        images: { postgres: POSTGRES_IMAGE, minio: MINIO_IMAGE },
        startedAt,
        writersStoppedAt,
        databaseStoppedAt,
        files: [
          {
            name: "database.dump",
            ...(await digest(join(bundle, "database.dump"), 64 * 1024 * 1024)),
          },
          {
            name: "storage.tar",
            ...(await digest(join(bundle, "storage.tar"), 256 * 1024 * 1024)),
          },
        ],
        snapshot: saved,
        storageVersions,
        generationExecution: "disabled",
      };
      await saveNew(join(bundle, "manifest.json"), {
        version: 1,
        payload,
        hmacSha256: createHmac("sha256", sealingKey)
          .update(JSON.stringify(payload))
          .digest("hex"),
      });
      return report(payload, "backup");
    }
    const bundle = await bundleDirectory(bundlePath, false),
      payload = await manifest(config, bundle);
    differentTarget(config, payload);
    if (operation === "verify") return verify(config, bundle, payload);
    const stateFile = `${configPath}.restore-state.json`;
    const binding = createHash("sha256")
      .update(
        JSON.stringify({
          payload,
          target: {
            database: config.database.containerId,
            storage: config.storage.containerId,
            databaseVolume: config.database.volumeName,
            storageVolume: config.storage.volumeName,
          },
        }),
      )
      .digest("hex");
    const previous = (await readPrivate(stateFile, true)) as
      { status?: string; bundle?: string; binding?: string } | undefined;
    if (previous) {
      requireRecovery(
        previous.status === "verified" &&
          previous.bundle === bundle &&
          previous.binding === binding,
        "RECOVERY_RESTORE_UNCERTAIN",
      );
      return verify(config, bundle, payload);
    }
    const found = await inspect(config);
    requireRecovery(
      found.database.State.Running && !found.storage.State.Running,
      "RECOVERY_EMPTY_TARGET_STATE_REQUIRED",
    );
    await assertEmptyDatabase(config);
    requireRecovery(
      !(
        await runHelper(config, false, [
          "find",
          "/recovery",
          "-mindepth",
          "1",
          "-print",
          "-quit",
        ])
      ).trim(),
      "RECOVERY_TARGET_NOT_EMPTY",
    );
    const archive = join(bundle, "storage.tar");
    const paths = (
      await runHelper(config, false, ["tar", "-tf", "-"], {
        input: archive,
      })
    )
      .trim()
      .split("\n");
    requireRecovery(
      paths.length > 0 &&
        paths.every(
          (name) => name.startsWith("./") && !name.split("/").includes(".."),
        ),
      "RECOVERY_ARCHIVE_PATH_INVALID",
    );
    const entries = (
      await runHelper(config, false, ["tar", "-tvf", "-"], {
        input: archive,
      })
    )
      .trim()
      .split("\n");
    requireRecovery(
      entries.every((entry) => /^[d-]/.test(entry)),
      "RECOVERY_ARCHIVE_LINK_REJECTED",
    );
    // An interrupted mutation cannot replay pg_restore or tar into an uncertain target.
    await saveNew(stateFile, {
      version: 1,
      status: "started",
      bundle,
      binding,
      at: new Date().toISOString(),
      generationExecution: "disabled",
    });
    await restoreRoles(config, payload.snapshot.roles);
    await docker(
      [
        "exec",
        "-i",
        config.database.containerId,
        "pg_restore",
        "--exit-on-error",
        "--single-transaction",
        "-U",
        config.database.user,
        "-d",
        config.database.database,
      ],
      { input: join(bundle, "database.dump") },
    );
    await runHelper(config, true, ["tar", "-C", "/recovery", "-xf", "-"], {
      input: archive,
    });
    await docker(["start", config.storage.containerId]);
    await storageReady(config);
    const result = await verify(config, bundle, payload);
    await writePrivate(stateFile, {
      version: 1,
      status: "verified",
      bundle,
      binding,
      at: new Date().toISOString(),
      generationExecution: "disabled",
    });
    return { ...result, operation: "restore" };
  });
}

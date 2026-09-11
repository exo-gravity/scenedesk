import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import {
  LABEL,
  MINIO_IMAGE,
  POSTGRES_IMAGE,
  RecoveryError,
  requireRecovery,
  type Configuration,
} from "./types.js";

/** No shell, inherited stdin or child diagnostics. Raw tools may contain secrets. */
export async function docker(
  args: string[],
  options: {
    input?: string | Buffer;
    output?: string;
    maximum?: number;
    timeout?: number;
  } = {},
) {
  const maximum = options.maximum ?? 4 * 1024 * 1024;
  const file = options.output
    ? await open(options.output, "wx", 0o600)
    : undefined;
  const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
  let output = "",
    bytes = 0,
    exceeded = false,
    timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, options.timeout ?? 120_000);
  const exited = once(child, "close");
  child.stderr.resume();
  const consume = (async () => {
    for await (const chunk of child.stdout) {
      bytes += chunk.length;
      if (bytes > maximum) {
        exceeded = true;
        child.kill("SIGKILL");
        continue;
      }
      if (file) await file.writeFile(chunk);
      else output += chunk.toString("utf8");
    }
  })();
  const feed =
    typeof options.input === "string"
      ? pipeline(createReadStream(options.input), child.stdin)
      : new Promise<void>((resolve, reject) => {
          child.stdin.on("error", reject);
          child.stdin.end(options.input, () => resolve());
        });
  try {
    const [result] = await Promise.all([exited, consume, feed]);
    requireRecovery(!timedOut, "RECOVERY_COMMAND_TIMEOUT");
    requireRecovery(!exceeded, "RECOVERY_SYNTHETIC_SIZE_LIMIT");
    requireRecovery(result[0] === 0, "RECOVERY_COMMAND_FAILED");
    await file?.sync();
    return output;
  } catch (error) {
    child.kill("SIGKILL");
    await Promise.allSettled([exited, consume, feed]);
    if (timedOut) throw new RecoveryError("RECOVERY_COMMAND_TIMEOUT");
    if (exceeded) throw new RecoveryError("RECOVERY_SYNTHETIC_SIZE_LIMIT");
    if (error instanceof RecoveryError) throw error;
    throw new RecoveryError("RECOVERY_COMMAND_FAILED");
  } finally {
    clearTimeout(timer);
    await file?.close();
  }
}
const labels = (
  value: Record<string, string> | undefined,
  config: Configuration,
) => {
  requireRecovery(
    value?.[`${LABEL}.run`] === config.runId &&
      value?.[`${LABEL}.side`] === config.side &&
      value?.[`${LABEL}.synthetic`] === "true",
    "RECOVERY_SYNTHETIC_IDENTITY_REQUIRED",
  );
};
async function container(id: string, config: Configuration) {
  requireRecovery(
    /^[a-f0-9]{64}$/.test(id),
    "RECOVERY_FULL_CONTAINER_ID_REQUIRED",
  );
  const [found] = JSON.parse(await docker(["container", "inspect", id]));
  requireRecovery(found?.Id === id, "RECOVERY_CONTAINER_IDENTITY_CHANGED");
  labels(found.Config?.Labels, config);
  requireRecovery(
    !found.HostConfig?.Privileged && found.HostConfig?.NetworkMode !== "host",
    "RECOVERY_CONTAINER_ISOLATION_REQUIRED",
  );
  return found;
}
async function volume(name: string, config: Configuration) {
  requireRecovery(
    /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}$/.test(name),
    "RECOVERY_VOLUME_NAME_INVALID",
  );
  const [found] = JSON.parse(await docker(["volume", "inspect", name]));
  labels(found?.Labels, config);
  requireRecovery(
    found?.Name === name &&
      found.Driver === "local" &&
      Object.keys(found.Options ?? {}).length === 0 &&
      found.Scope === "local",
    "RECOVERY_LOCAL_VOLUME_REQUIRED",
  );
}
export async function inspect(config: Configuration) {
  requireRecovery(
    config.database.containerId !== config.storage.containerId &&
      config.database.volumeName !== config.storage.volumeName,
    "RECOVERY_RESOURCES_MUST_DIFFER",
  );
  const database = await container(config.database.containerId, config),
    storage = await container(config.storage.containerId, config);
  requireRecovery(
    database.Config.Image === POSTGRES_IMAGE &&
      storage.Config.Image === MINIO_IMAGE,
    "RECOVERY_PINNED_IMAGE_REQUIRED",
  );
  for (const [found, name, destination] of [
    [database, config.database.volumeName, "/var/lib/postgresql/data"],
    [storage, config.storage.volumeName, "/data"],
  ] as const) {
    await volume(name, config);
    requireRecovery(
      found.Mounts.length === 1,
      "RECOVERY_SINGLE_VOLUME_REQUIRED",
    );
    requireRecovery(
      Object.values(found.HostConfig.PortBindings ?? {})
        .flat()
        .every((binding: any) => binding.HostIp === "127.0.0.1"),
      "RECOVERY_LOOPBACK_PORTS_REQUIRED",
    );
    requireRecovery(
      found.Mounts.some(
        (m: any) =>
          m.Type === "volume" &&
          m.Name === name &&
          m.Destination === destination &&
          m.RW,
      ),
      "RECOVERY_VOLUME_MOUNT_MISMATCH",
    );
  }
  requireRecovery(
    database.Config.Env.includes("PGDATA=/var/lib/postgresql/data") &&
      JSON.stringify(storage.Config.Cmd) ===
        JSON.stringify(["server", "/data"]),
    "RECOVERY_FIXED_DATA_DIRECTORY_REQUIRED",
  );
  const endpoint = new URL(config.storage.endpoint);
  requireRecovery(
    endpoint.protocol === "http:" &&
      endpoint.hostname === "127.0.0.1" &&
      !endpoint.username &&
      !endpoint.password &&
      !endpoint.search &&
      !endpoint.hash &&
      endpoint.pathname === "/",
    "RECOVERY_LOOPBACK_STORAGE_REQUIRED",
  );
  const bindings = storage.HostConfig.PortBindings?.["9000/tcp"] ?? [];
  requireRecovery(
    bindings.length === 1 &&
      bindings[0].HostIp === "127.0.0.1" &&
      bindings[0].HostPort === endpoint.port,
    "RECOVERY_STORAGE_ENDPOINT_MISMATCH",
  );
  const writers = [];
  requireRecovery(
    new Set(config.writers).size === config.writers.length,
    "RECOVERY_DUPLICATE_WRITER",
  );
  for (const id of config.writers) {
    requireRecovery(
      id !== database.Id && id !== storage.Id,
      "RECOVERY_WRITER_IDENTITY_INVALID",
    );
    writers.push(await container(id, config));
  }
  if (config.side === "target")
    requireRecovery(
      writers.every((w) => !w.State.Running),
      "RECOVERY_TARGET_WRITER_RUNNING",
    );
  return { database, storage, writers };
}
export const stopped = async (id: string) => {
  await docker(["stop", "--time", "15", id], { timeout: 40_000 });
};
function helper(
  config: Configuration,
  write: boolean,
  command: string[],
  name: string,
) {
  return [
    "create",
    "-i",
    "--name",
    name,
    "--pull",
    "never",
    "--network",
    "none",
    "--read-only",
    "--user",
    "0",
    "--cap-drop",
    "ALL",
    ...(write
      ? [
          "--cap-add",
          "CHOWN",
          "--cap-add",
          "FOWNER",
          "--cap-add",
          "DAC_OVERRIDE",
        ]
      : []),
    "--security-opt",
    "no-new-privileges",
    "--label",
    `${LABEL}.run=${config.runId}`,
    "--label",
    `${LABEL}.side=${config.side}`,
    "--label",
    `${LABEL}.synthetic=true`,
    "--mount",
    `type=volume,source=${config.storage.volumeName},target=/recovery${write ? "" : ",readonly"}`,
    "--entrypoint",
    command[0]!,
    POSTGRES_IMAGE,
    ...command.slice(1),
  ];
}
/** Creation/attachment are separate so a killed CLI never abandons a writing helper. */
export async function runHelper(
  config: Configuration,
  write: boolean,
  command: string[],
  options: Parameters<typeof docker>[1] = {},
) {
  const name = `scenedesk-recovery-helper-${randomUUID()}`;
  let id: string | undefined;
  try {
    id = (await docker(helper(config, write, command, name))).trim();
    requireRecovery(/^[a-f0-9]{64}$/.test(id), "RECOVERY_HELPER_ID_INVALID");
    return await docker(["start", "--attach", "--interactive", id], options);
  } finally {
    try {
      const [found] = JSON.parse(
        await docker(["container", "inspect", id ?? name]),
      );
      requireRecovery(
        found?.Name === `/${name}` && /^[a-f0-9]{64}$/.test(found?.Id),
        "RECOVERY_HELPER_ID_INVALID",
      );
      labels(found.Config?.Labels, config);
      await docker(["container", "rm", "--force", found.Id], {
        timeout: 40_000,
      });
    } catch {
      throw new RecoveryError("RECOVERY_HELPER_CLEANUP_UNCERTAIN");
    }
  }
}
export function psql(config: Configuration, sql: string) {
  return docker(
    [
      "exec",
      "-i",
      config.database.containerId,
      "psql",
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      config.database.user,
      "-d",
      config.database.database,
    ],
    { input: Buffer.from(sql) },
  );
}

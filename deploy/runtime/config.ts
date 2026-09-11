import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import {
  MediaFailure,
  MediaStore,
  type StoreConfiguration,
} from "@drama/media";

export class DeploymentError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export const fail = (code: string): never => {
  throw new DeploymentError(code);
};
export function record(
  value: unknown,
  code = "CONFIG_OBJECT_REQUIRED",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}
export function field(value: Record<string, unknown>, key: string): string {
  if (
    typeof value[key] !== "string" ||
    !value[key] ||
    /[\r\n\0]/.test(value[key])
  )
    fail(`CONFIG_${key.toUpperCase()}_REQUIRED`);
  return value[key] as string;
}
export function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    fail("CONFIG_UNKNOWN_FIELD");
}
export function httpsAddress(value: string, originOnly = false): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("CONFIG_HTTPS_URL_REQUIRED");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (originOnly && url.origin !== value)
  )
    fail("CONFIG_HTTPS_URL_REQUIRED");
  return value;
}
export function database(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
    decodeURIComponent(url.pathname);
  } catch {
    return fail("CONFIG_DATABASE_URL_INVALID");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.username ||
    !url.password ||
    !url.hostname ||
    !url.pathname ||
    url.pathname === "/" ||
    url.hash ||
    url.searchParams.get("sslmode") !== "verify-full" ||
    url.searchParams.getAll("sslmode").length !== 1 ||
    [...url.searchParams.keys()].some((key) => key !== "sslmode")
  )
    fail("CONFIG_DATABASE_TLS_VERIFY_FULL_REQUIRED");
  return value;
}
export function distinctConnections(values: string[]) {
  const urls = values.map((value) => new URL(database(value)));
  if (
    new Set(urls.map((url) => decodeURIComponent(url.username))).size !==
    values.length
  )
    fail("CONFIG_DATABASE_ROLES_MUST_DIFFER");
  if (
    new Set(
      urls.map(
        (url) =>
          `${url.hostname.toLowerCase()}:${url.port || "5432"}${decodeURIComponent(url.pathname)}`,
      ),
    ).size !== 1
  )
    fail("CONFIG_DATABASE_TARGETS_MUST_MATCH");
}
export function storage(input: unknown): StoreConfiguration {
  const value = record(input);
  keys(value, [
    "endpoint",
    "region",
    "bucket",
    "accessKeyId",
    "secretAccessKey",
    "sessionToken",
  ]);
  return {
    ...(value.endpoint
      ? { endpoint: httpsAddress(field(value, "endpoint"), true) }
      : {}),
    region: field(value, "region"),
    bucket: field(value, "bucket"),
    local: false,
    credentials: {
      accessKeyId: field(value, "accessKeyId"),
      secretAccessKey: field(value, "secretAccessKey"),
      ...(value.sessionToken
        ? { sessionToken: field(value, "sessionToken") }
        : {}),
    },
  };
}
export async function configuration() {
  // Runtime never falls back to developer dotenv files or ambient cloud/admin identities.
  for (const key of [
    "DATABASE_URL",
    "RUNTIME_DATABASE_URL",
    "AUTH_DATABASE_URL",
    "APP_SECRET",
    "MEDIA_WORKER_DATABASE_URL",
    "SCHEDULER_DATABASE_URL",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "OIDC_ALLOW_LOCAL",
  ]) {
    if (process.env[key]) fail("AMBIENT_CREDENTIALS_FORBIDDEN");
  }
  if (process.env.PROVIDER_MODE && process.env.PROVIDER_MODE !== "mock")
    fail("REAL_PROVIDER_NOT_IMPLEMENTED");
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0")
    fail("TLS_VERIFICATION_REQUIRED");
  let raw: unknown;
  try {
    raw = JSON.parse(
      await readFile(
        process.env.SCENEDESK_CONFIG_FILE ?? "/run/secrets/config.json",
        "utf8",
      ),
    );
  } catch {
    return fail("CONFIG_FILE_UNREADABLE_OR_INVALID_JSON");
  }
  return record(raw);
}
export function apiConfiguration(input: unknown) {
  const value = record(input);
  keys(value, [
    "origin",
    "databaseUrl",
    "authDatabaseUrl",
    "appSecret",
    "oidc",
    "media",
  ]);
  const oidc = record(value.oidc);
  keys(oidc, ["issuer", "clientId", "clientSecret"]);
  const secret = field(value, "appSecret");
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(secret) ||
    Buffer.from(secret, "base64url").length !== 32 ||
    Buffer.from(secret, "base64url").toString("base64url") !== secret
  )
    fail("CONFIG_APP_SECRET_32_BYTES_BASE64URL_REQUIRED");
  const clientId = field(oidc, "clientId");
  if (clientId === "fixture-client") fail("LOCAL_OIDC_FIXTURE_FORBIDDEN");
  const databaseUrl = database(field(value, "databaseUrl")),
    authDatabaseUrl = database(field(value, "authDatabaseUrl"));
  distinctConnections([databaseUrl, authDatabaseUrl]);
  return {
    origin: httpsAddress(field(value, "origin"), true),
    databaseUrl,
    authDatabaseUrl,
    secret,
    oidc: {
      issuer: httpsAddress(field(oidc, "issuer")),
      clientId,
      ...(oidc.clientSecret
        ? { clientSecret: field(oidc, "clientSecret") }
        : {}),
      localIssuer: false,
    },
    media: storage(value.media),
  };
}
export function workerConfiguration(input: unknown) {
  const value = record(input);
  keys(value, [
    "databaseUrl",
    "schedulerDatabaseUrl",
    "media",
    "exclusiveImportQueue",
    "dedicatedDecoderHost",
  ]);
  if (value.exclusiveImportQueue !== true)
    fail("IMPORT_QUEUE_EXCLUSIVITY_REQUIRED");
  if (value.dedicatedDecoderHost !== true)
    fail("DEDICATED_DECODER_HOST_REQUIRED");
  const databaseUrl = database(field(value, "databaseUrl")),
    schedulerDatabaseUrl = database(field(value, "schedulerDatabaseUrl"));
  distinctConnections([databaseUrl, schedulerDatabaseUrl]);
  return { databaseUrl, schedulerDatabaseUrl, media: storage(value.media) };
}
export const pool = (connectionString: string, max = 4) =>
  new Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
export const mediaStore = (config: StoreConfiguration) =>
  new MediaStore(config);
export function diagnostic(error: unknown, stage: string) {
  // Driver errors, stack traces and URLs may contain credentials. Only fixed diagnostics leave the process.
  console.error(
    JSON.stringify({
      status: "failed",
      stage,
      code:
        error instanceof DeploymentError || error instanceof MediaFailure
          ? error.code
          : "DEPENDENCY_CHECK_FAILED",
      paidProvidersEnabled: false,
    }),
  );
}

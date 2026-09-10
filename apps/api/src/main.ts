import { Pool } from "pg";
import { buildApp } from "./app.js";
import { discoverIssuer } from "./modules/identity/oidc.js";
import { mediaStoreFromEnvironment } from "@drama/media";
import { createScheduler } from "@drama/queue";
if (process.env.APP_ENV && process.env.APP_ENV !== "local")
  throw new Error("S0 scaffold supports APP_ENV=local only");
if (process.env.PROVIDER_MODE && process.env.PROVIDER_MODE !== "mock")
  throw new Error("Real providers are not implemented or enabled");
const host = process.env.HOST ?? "127.0.0.1";
if (host !== "127.0.0.1" && host !== "::1")
  throw new Error("S0 scaffold binds loopback only");
const port = Number(process.env.PORT ?? "4310");
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid local port");
const businessEnabled = !!process.env.RUNTIME_DATABASE_URL;
const pool =
  (process.env.RUNTIME_DATABASE_URL ?? process.env.DATABASE_URL)
    ? new Pool({
        connectionString:
          process.env.RUNTIME_DATABASE_URL ?? process.env.DATABASE_URL,
        max: 4,
        connectionTimeoutMillis: 3000,
      })
    : undefined;
const authPool =
  businessEnabled && process.env.AUTH_DATABASE_URL
    ? new Pool({
        connectionString: process.env.AUTH_DATABASE_URL,
        max: 2,
        connectionTimeoutMillis: 3000,
      })
    : undefined;
if (
  businessEnabled &&
  (!process.env.APP_SECRET ||
    !authPool ||
    !process.env.OIDC_ISSUER ||
    !process.env.OIDC_CLIENT_ID)
) {
  await pool?.end();
  await authPool?.end();
  throw new Error(
    "Business API requires APP_SECRET, AUTH_DATABASE_URL, OIDC_ISSUER and OIDC_CLIENT_ID",
  );
}
const config = businessEnabled
  ? await discoverIssuer({
      issuer: process.env.OIDC_ISSUER!,
      clientId: process.env.OIDC_CLIENT_ID!,
      ...(process.env.OIDC_CLIENT_SECRET
        ? { clientSecret: process.env.OIDC_CLIENT_SECRET }
        : {}),
      localIssuer:
        process.env.APP_ENV === "local" &&
        process.env.OIDC_ALLOW_LOCAL === "true",
    })
  : undefined;
const mediaStore = businessEnabled
  ? mediaStoreFromEnvironment(process.env)
  : undefined;
const mediaQueue = mediaStore
  ? await createScheduler(pool!, {
      schema: process.env.QUEUE_SCHEMA ?? "scenedesk_queue",
      onError: () =>
        console.error("Media scheduling service reported a failure"),
    })
  : undefined;
const app = buildApp(
  pool,
  businessEnabled
    ? {
        origin: process.env.APP_ORIGIN ?? "http://127.0.0.1:4311",
        secret: process.env.APP_SECRET!,
        schema: process.env.DATABASE_SCHEMA ?? "drama",
        auth: { pool: authPool!, config: config! },
        localIdentity: process.env.OIDC_ALLOW_LOCAL === "true",
        ...(mediaStore && mediaQueue
          ? { media: { store: mediaStore, schedule: mediaQueue.schedule } }
          : {}),
      }
    : undefined,
);
app.addHook("onClose", async () => {
  await mediaQueue?.close();
  mediaStore?.close();
  await pool?.end();
  await authPool?.end();
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close();
  });
try {
  await app.listen({ host, port });
  console.log(
    `SceneDesk API: http://${host}:${port}; ${businessEnabled ? "business services enabled" : "S0 bootstrap"}; media ${mediaStore ? "enabled" : "unconfigured"}; provider mode mock`,
  );
} catch (error) {
  await app.close();
  throw error;
}

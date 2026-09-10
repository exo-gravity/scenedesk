import { Pool } from "pg";
import { buildApp } from "./app.js";
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
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 4,
      connectionTimeoutMillis: 3000,
    })
  : undefined;
const app = buildApp(pool);
app.addHook("onClose", async () => {
  await pool?.end();
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close();
  });
try {
  await app.listen({ host, port });
  console.log(
    `S0 API: http://${host}:${port}; business routes and real generation disabled`,
  );
} catch (error) {
  await app.close();
  throw error;
}

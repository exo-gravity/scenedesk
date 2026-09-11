import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { grantGenerationWorkerAccess, sqlIdentifier } from "@drama/database";

if (process.env.APP_ENV !== "local" || !process.env.DATABASE_URL)
  throw new Error("Explicit local migration configuration is required");
const tenantId = process.argv[2];
if (!tenantId || !/^[0-9a-f-]{36}$/.test(tenantId))
  throw new Error(
    "Usage: setup-local-assistance-fixture.ts <existing tenant UUID>",
  );
const schema = process.env.DATABASE_SCHEMA ?? "drama",
  scope = sqlIdentifier(schema),
  admin = new Pool({ connectionString: process.env.DATABASE_URL });
const role = `generation_${randomBytes(6).toString("hex")}`,
  password = randomBytes(24).toString("hex"),
  connectionId = randomUUID(),
  connectionVersionId = randomUUID(),
  capabilityId = randomUUID();
const file = new URL("../.env.generation-worker", import.meta.url);
// Never overwrite an existing worker identity or secret file.
const workerUrl = new URL(process.env.DATABASE_URL);
workerUrl.username = role;
workerUrl.password = password;
const config = `APP_ENV=local\nGENERATION_ADAPTER=test_fixture\nDATABASE_SCHEMA=${schema}\nGENERATION_CONNECTION_VERSION_ID=${connectionVersionId}\nGENERATION_WORKER_DATABASE_URL=${workerUrl.href}\n`;
const client = await admin.connect();
let wrote = false;
try {
  await client.query("BEGIN");
  const exists = await client.query(
    `SELECT id FROM ${scope}.tenants WHERE id=$1 AND status='active'`,
    [tenantId],
  );
  if (!exists.rows[0]) throw new Error("An active local tenant is required");
  const configured = await client.query(
    `SELECT 1 FROM ${scope}.generation_runtime_identity`,
  );
  if (configured.rows[0])
    throw new Error(
      "Generation worker already configured; reuse the existing identity",
    );
  await client.query(
    `CREATE ROLE ${sqlIdentifier(role)} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${password}'`,
  );
  await grantGenerationWorkerAccess(client, schema, role);
  await client.query(
    `INSERT INTO ${scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'test_fixture',true,2,100)`,
    [
      capabilityId,
      tenantId,
      connectionId,
      connectionVersionId,
      {
        purpose: "script_analysis",
        modelVersion: "本地测试适配器（无真实模型）",
        mode: "structured_text_fixture",
        supportedPurposes: [],
        notes:
          "仅验证计划、耐久任务、建议与人工采纳；不代表真实 AI 质量或调用验收。",
      },
    ],
  );
  await writeFile(file, config, { encoding: "utf8", mode: 0o600, flag: "wx" });
  wrote = true;
  await client.query("COMMIT");
  console.log(
    JSON.stringify({
      configured: "test_fixture",
      capabilityId,
      connectionVersionId,
      paidProvidersEnabled: false,
      configurationFile: ".env.generation-worker",
    }),
  );
} catch (error) {
  await client.query("ROLLBACK");
  if (wrote)
    throw new Error(
      "Provisioning did not complete; the private worker config was retained for explicit recovery",
    );
  throw error;
} finally {
  client.release();
  await admin.end();
}

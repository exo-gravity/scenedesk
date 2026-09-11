import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { sqlIdentifier } from "@drama/database";

// Explicit local-only extension. Reuses the already provisioned worker and connection identities.
if (process.env.APP_ENV !== "local" || !process.env.DATABASE_URL)
  throw new Error("Explicit local migration configuration is required");
const [tenantId, analysisCapabilityId] = process.argv.slice(2);
if (
  !tenantId ||
  !analysisCapabilityId ||
  ![tenantId, analysisCapabilityId].every((id) => /^[0-9a-f-]{36}$/.test(id))
)
  throw new Error(
    "Usage: extend-local-prompt-fixture.ts <tenant UUID> <existing analysis fixture capability UUID>",
  );
const pool = new Pool({ connectionString: process.env.DATABASE_URL }),
  scope = sqlIdentifier(process.env.DATABASE_SCHEMA ?? "drama"),
  client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(
    `SELECT id FROM ${scope}.tenants WHERE id=$1 AND status='active' FOR UPDATE`,
    [tenantId],
  );
  const source = (
    await client.query(
      `SELECT c.* FROM ${scope}.generation_capabilities c WHERE c.tenant_id=$1 AND c.id=$2 AND c.execution_mode='test_fixture' AND c.enabled AND c.definition->>'purpose'='script_analysis' AND EXISTS(SELECT 1 FROM ${scope}.generation_runtime_identity)`,
      [tenantId, analysisCapabilityId],
    )
  ).rows[0];
  if (!source)
    throw new Error(
      "An enabled local analysis fixture and configured worker identity are required",
    );
  const profiles: Record<string, string> = {};
  for (const purpose of ["creative_assistance", "image"]) {
    const previous = (
      await client.query(
        `SELECT id FROM ${scope}.generation_capabilities WHERE tenant_id=$1 AND connection_version_id=$2 AND execution_mode='test_fixture' AND definition->>'purpose'=$3 AND enabled`,
        [tenantId, source.connection_version_id, purpose],
      )
    ).rows;
    if (previous.length > 1)
      throw new Error(
        "Multiple fixture profiles exist; choose and reconcile the existing profiles explicitly",
      );
    if (previous[0]) {
      profiles[purpose] = previous[0].id;
      continue;
    }
    const id = randomUUID();
    await client.query(
      `INSERT INTO ${scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'test_fixture',true,2,100)`,
      [
        id,
        tenantId,
        source.connection_id,
        source.connection_version_id,
        {
          purpose,
          modelVersion: "本地测试适配器（无真实模型）",
          mode:
            purpose === "image"
              ? "target_profile_fixture"
              : "structured_text_fixture",
          supportedPurposes:
            purpose === "image"
              ? [
                  "identity",
                  "look",
                  "location",
                  "action",
                  "composition",
                  "style",
                  "voice",
                  "start_frame",
                  "end_frame",
                  "prop",
                ]
              : [],
          notes:
            "仅验证固定提示建议与人工修订；目标图像能力为测试配置，不会生成媒体。",
        },
      ],
    );
    profiles[purpose] = id;
  }
  await client.query("COMMIT");
  console.log(
    JSON.stringify({
      configured: "test_fixture",
      profiles,
      connectionVersionId: source.connection_version_id,
      paidProvidersEnabled: false,
    }),
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}

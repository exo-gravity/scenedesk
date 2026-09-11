import assert from "node:assert/strict";
import { configuration, database, field, pool } from "../runtime/config.js";
const config = await configuration();
const admin = pool(database(field(config, "databaseUrl")), 1);
try {
  const allowed = await admin.query(
    `SELECT
    has_function_privilege($1,'drama.claim_generated_media(uuid,bigint,bigint,uuid)','EXECUTE') AS claim,
    has_function_privilege($1,'drama.finish_generated_media(uuid,uuid,jsonb,jsonb)','EXECUTE') AS finish,
    has_function_privilege($2,'drama.scan_generated_media(integer)','EXECUTE') AS scan,
    has_function_privilege($1,'drama.claim_generation_job(uuid,uuid)','EXECUTE') AS generation_submit`,
    [field(config, "mediaRole"), field(config, "schedulerRole")],
  );
  assert.deepEqual(allowed.rows[0], {
    claim: true,
    finish: true,
    scan: true,
    generation_submit: false,
  });
  console.log(
    '{"status":"ok","generatedMediaGrants":true,"mediaRoleCannotClaimGenerationSubmission":true}',
  );
} finally {
  await admin.end();
}

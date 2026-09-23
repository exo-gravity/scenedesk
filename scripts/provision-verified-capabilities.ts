import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { parseArgs, isDeepStrictEqual } from "node:util";
import { Pool } from "pg";
import { sqlIdentifier } from "@drama/database";
import {
  PROFILES,
  capabilityDefinition,
  parseGenerationVendors,
  VerifiedProfileError,
} from "@drama/provider";

// Writes capability rows derived from the code profiles. Never touches secrets; the
// config file is read only for connection identities. Enabling requires an explicit flag.
const { values } = parseArgs({
  options: {
    config: { type: "string" },
    tenant: { type: "string" },
    enable: { type: "string", multiple: true },
  },
});
if (
  !process.env.DATABASE_URL ||
  !values.config ||
  !values.tenant ||
  !/^[0-9a-f-]{36}$/.test(values.tenant)
)
  throw new Error(
    "Usage: DATABASE_URL=… provision-verified-capabilities.ts --config generation.json --tenant <uuid> [--enable <profileId>]",
  );
const raw = JSON.parse(await readFile(values.config, "utf8"));
const vendors = parseGenerationVendors({
  vendors: raw.vendors,
  connections: raw.connections,
});
const scope = sqlIdentifier(process.env.DATABASE_SCHEMA ?? "drama");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const sql = await pool.connect();
const summary: Record<string, string> = {};
try {
  await sql.query("BEGIN");
  const tenant = await sql.query(
    `SELECT id FROM ${scope}.tenants WHERE id=$1 AND status='active'`,
    [values.tenant],
  );
  if (!tenant.rows[0]) throw new Error("An active tenant is required");
  for (const profile of PROFILES) {
    const connection = vendors.connections.find(
      (c) => c.vendor === profile.vendor,
    );
    if (!connection) {
      summary[profile.id] = "skipped: vendor has no connection";
      continue;
    }
    const enable = values.enable?.includes(profile.id) ?? false;
    for (const mode of profile.modes) {
      const existing = await sql.query(
        `SELECT id,revision,definition,enabled,max_inflight FROM ${scope}.generation_capabilities WHERE tenant_id=$1 AND connection_version_id=$2 AND definition->>'modelVersion'=$3 AND definition->>'mode'=$4 ORDER BY revision DESC LIMIT 1`,
        [values.tenant, connection.connectionVersionId, profile.id, mode],
      );
      const latest = existing.rows[0];
      // Never re-stamp a verification that already happened; only mint a fresh one the
      // first time --enable names a profile that has never been verified before.
      const verifiedAt = latest?.definition?.verifiedAt
        ? latest.definition.verifiedAt
        : enable
          ? new Date().toISOString()
          : undefined;
      let definition;
      try {
        definition = capabilityDefinition(profile, mode, {
          ...(verifiedAt ? { verifiedAt } : {}),
        });
      } catch (error) {
        if (
          error instanceof VerifiedProfileError &&
          error.code === "OUTPUTS_UNMEASURED"
        ) {
          summary[`${profile.id}/${mode}`] = "skipped: outputs unmeasured";
          continue;
        }
        throw error;
      }
      const inflight =
        typeof profile.inflight === "number"
          ? profile.inflight
          : profile.inflight[
              vendors.vendors[profile.vendor]?.accountTier ?? "personal"
            ];
      const boundedInflight = Math.min(inflight, 8);
      // generation_capabilities rows are immutable identities: guard_generation_immutable
      // (packages/database/migrations/0042) lets an UPDATE move only the `enabled` column,
      // never `definition`/`revision`/`max_inflight`. So a real content change publishes a
      // new row (the next revision) instead of rewriting the old one in place, and the old
      // row's `enabled` is cleared so exactly one identity per model/mode stays live.
      if (!latest) {
        await sql.query(
          `INSERT INTO ${scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'verified_provider',$6,$7,200)`,
          [
            randomUUID(),
            values.tenant,
            connection.connectionId,
            connection.connectionVersionId,
            definition,
            enable,
            boundedInflight,
          ],
        );
        summary[`${profile.id}/${mode}`] = enable
          ? "inserted+enabled"
          : "inserted";
      } else if (
        isDeepStrictEqual(latest.definition, definition) &&
        latest.max_inflight === boundedInflight
      ) {
        if (enable && !latest.enabled) {
          await sql.query(
            `UPDATE ${scope}.generation_capabilities SET enabled=true WHERE id=$1`,
            [latest.id],
          );
          summary[`${profile.id}/${mode}`] = "enabled";
        } else {
          summary[`${profile.id}/${mode}`] = "unchanged";
        }
      } else {
        await sql.query(
          `INSERT INTO ${scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,$5,$6,'verified_provider',$7,$8,200)`,
          [
            randomUUID(),
            values.tenant,
            connection.connectionId,
            connection.connectionVersionId,
            Number(latest.revision) + 1,
            definition,
            enable,
            boundedInflight,
          ],
        );
        if (latest.enabled) {
          await sql.query(
            `UPDATE ${scope}.generation_capabilities SET enabled=false WHERE id=$1`,
            [latest.id],
          );
        }
        summary[`${profile.id}/${mode}`] = enable
          ? "republished+enabled"
          : "republished";
      }
    }
  }
  await sql.query("COMMIT");
} catch (error) {
  await sql.query("ROLLBACK");
  throw error;
} finally {
  sql.release();
  await pool.end();
}
console.log(JSON.stringify({ tenant: values.tenant, capabilities: summary }));

import { psql } from "./host.js";
import {
  identifier,
  requireRecovery,
  type Configuration,
  type FixedObject,
  type Role,
  type Snapshot,
} from "./types.js";

async function json(config: Configuration, sql: string) {
  return JSON.parse((await psql(config, sql)).trim());
}
export async function roles(config: Configuration): Promise<Role[]> {
  const found = await json(
    config,
    `SELECT coalesce(json_agg(json_build_object('name',rolname,'inherit',rolinherit,'login',rolcanlogin,'bypassRls',rolbypassrls,'connectionLimit',rolconnlimit,'unsafe',rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication) ORDER BY rolname),'[]') FROM pg_roles WHERE rolname !~ '^pg_' AND rolname<>'postgres';`,
  );
  for (const role of found) {
    identifier(role.name);
    requireRecovery(
      !role.unsafe && !(role.bypassRls && role.login),
      "RECOVERY_UNSUPPORTED_ROLE",
    );
    delete role.unsafe;
  }
  const membership = await psql(
    config,
    "SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member WHERE r.rolname !~ '^pg_' OR u.rolname !~ '^pg_';",
  );
  requireRecovery(
    Number(membership.trim()) === 0,
    "RECOVERY_ROLE_MEMBERSHIP_UNSUPPORTED",
  );
  return found;
}
export async function snapshot(config: Configuration): Promise<Snapshot> {
  const schema = identifier(config.database.schema);
  const version = Number(
    (await psql(config, "SHOW server_version_num;")).trim(),
  );
  requireRecovery(
    version >= 160000 && version < 170000,
    "RECOVERY_POSTGRES_16_REQUIRED",
  );
  const tables = await json(
    config,
    "SELECT coalesce(json_agg(json_build_object('schema',schemaname,'name',tablename) ORDER BY schemaname,tablename),'[]') FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema');",
  );
  requireRecovery(
    tables.length > 0 && tables.length <= 500,
    "RECOVERY_SYNTHETIC_TABLE_LIMIT",
  );
  const statements = tables.map((table: { schema: string; name: string }) => {
    const relation = `${identifier(table.schema)}.${identifier(table.name)}`;
    return `SELECT json_build_object('schema','${table.schema}','name','${table.name}','rows',count(*),'digest',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),''))) result FROM (SELECT * FROM ${relation} LIMIT 10001) t`;
  });
  // One read-only snapshot and one Docker round trip for all table contents.
  const summaries = await json(
    config,
    `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL timezone='UTC'; SELECT json_agg(result ORDER BY result->>'schema',result->>'name') FROM (${statements.join(" UNION ALL ")}) summaries; COMMIT;`,
  );
  for (const table of summaries)
    requireRecovery(table.rows <= 10_000, "RECOVERY_SYNTHETIC_ROW_LIMIT");
  const migrations = await json(
    config,
    `SELECT json_agg(json_build_object('name',name,'checksum',checksum) ORDER BY name) FROM ${schema}.schema_migrations;`,
  );
  const objects: FixedObject[] = await json(
    config,
    `SELECT coalesce(json_agg(o ORDER BY o->>'key',o->>'versionId'),'[]') FROM (
    SELECT DISTINCT jsonb_build_object('key',immutable_key,'versionId',storage_version_id,'bytes',bytes,'sha256',sha256) o FROM ${schema}.media WHERE status IN ('ready','archived')
    UNION SELECT jsonb_build_object('key',immutable_key,'versionId',storage_version_id,'bytes',bytes,'sha256',sha256) FROM ${schema}.media_derivatives WHERE status='ready'
    UNION SELECT jsonb_build_object('key',staging_key,'versionId',staging_version_id,'bytes',expected_bytes,'sha256',expected_sha256) FROM ${schema}.upload_intents WHERE staging_version_id IS NOT NULL
    UNION SELECT jsonb_build_object('key',source->'object'->>'key','versionId',source->'object'->>'versionId','bytes',(source->'object'->>'bytes')::bigint,'sha256',source->>'sha256') FROM ${schema}.generation_media_outputs
  ) fixed;`,
  );
  requireRecovery(objects.length <= 1000, "RECOVERY_SYNTHETIC_OBJECT_LIMIT");
  for (const object of objects)
    requireRecovery(
      typeof object.key === "string" &&
        typeof object.versionId === "string" &&
        Number.isSafeInteger(object.bytes) &&
        object.bytes > 0 &&
        object.bytes <= 16 * 1024 * 1024 &&
        /^[a-f0-9]{64}$/.test(object.sha256),
      "RECOVERY_FIXED_OBJECT_INVALID",
    );
  const generation = await json(
    config,
    `SELECT coalesce(json_agg(json_build_object('status',status,'count',n) ORDER BY status),'[]') FROM (SELECT status,count(*) n FROM ${schema}.generation_jobs GROUP BY status) j;`,
  );
  return {
    tables: summaries,
    migrations,
    roles: await roles(config),
    objects,
    generation,
  };
}
export async function assertEmptyDatabase(config: Configuration) {
  const count = await psql(
    config,
    "SELECT (SELECT count(*) FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname !~ '^pg_')+(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')+(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')+(SELECT count(*) FROM pg_extension WHERE extname<>'plpgsql');",
  );
  requireRecovery(
    Number(count.trim()) === 0 && (await roles(config)).length === 0,
    "RECOVERY_TARGET_NOT_EMPTY",
  );
}
export async function restoreRoles(config: Configuration, saved: Role[]) {
  for (const role of saved)
    await psql(
      config,
      `CREATE ROLE ${identifier(role.name)} ${role.login ? "LOGIN" : "NOLOGIN"} ${role.inherit ? "INHERIT" : "NOINHERIT"} ${role.bypassRls ? "BYPASSRLS" : "NOBYPASSRLS"} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT ${role.connectionLimit};`,
    );
}
export async function storageReady(config: Configuration) {
  // Readiness observation only, not retries of backup/restore or any business write.
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(
        `${config.storage.endpoint.replace(/\/$/, "")}/minio/health/ready`,
        { signal: AbortSignal.timeout(2000), redirect: "error" },
      );
      if (response.ok) return;
    } catch {
      /* bounded isolated service startup */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  requireRecovery(false, "RECOVERY_STORAGE_NOT_READY");
}

import type { PoolClient } from "pg";

const authorizationFunctions = [
  "tenant_role(uuid)",
  "member_email(uuid)",
  "project_role(uuid)",
  "authenticate_session(text)",
  "revoke_session(uuid)",
  "lock_tenant(uuid, boolean)",
  "lock_project(uuid, boolean)",
  "transfer_ownership(uuid,uuid,bigint)",
  "change_project_lead(uuid,uuid,bigint,uuid)",
  "accept_invitation(text,uuid)",
] as const;

export function sqlIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value))
    throw new Error("Invalid database identifier");
  return `"${value}"`;
}

/** Provision with the migration connection, never the running application's role. */
export async function grantRuntimeAccess(
  client: PoolClient,
  schema: string,
  role: string,
) {
  const scope = sqlIdentifier(schema),
    target = sqlIdentifier(role);
  await client.query(`GRANT USAGE ON SCHEMA ${scope} TO ${target}`);
  await client.query(
    `GRANT SELECT, INSERT ON ${["tenants", "memberships", "invitations", "projects", "project_memberships", "productions", "project_content_versions", "idempotency_records", "script_revisions", "episodes", "scenes", "shots", "shot_revisions", "shot_source_shots", "shot_source_scripts", "dialogue_lines", "analysis_proposals", "analysis_proposal_revisions", "proposal_applications"].map((t) => `${scope}.${t}`).join(", ")} TO ${target}`,
  );
  for (const [table, columns] of Object.entries({
    tenants: "name, revision, updated_at",
    memberships: "role, status, revision, updated_at",
    invitations: "status, accepted_by, revision, updated_at",
    projects: "name, spec, status, revision, updated_at",
    productions:
      "title, brief, default_asset_revision_ids, revision, updated_at",
    project_content_versions: "revision, current_script_revision_id",
    analysis_proposals: "revision, status, import_fingerprint, updated_at",
    episodes: "title, position, status, revision, updated_at",
    scenes:
      "episode_id, title, position, time_label, location_label, summary, state, default_asset_revision_ids, status, revision, updated_at",
    shots:
      "scene_id, label, position, current_revision_id, status, revision, updated_at",
  }))
    await client.query(
      `GRANT UPDATE (${columns}) ON ${scope}.${table} TO ${target}`,
    );
  await client.query(
    `GRANT DELETE ON ${scope}.project_memberships, ${scope}.idempotency_records TO ${target}`,
  );
  await client.query(
    `GRANT SELECT, INSERT ON ${scope}.audit_events TO ${target}`,
  );
  for (const signature of authorizationFunctions)
    await client.query(
      `GRANT EXECUTE ON FUNCTION ${scope}.${signature} TO ${target}`,
    );
}

export async function grantAuthAccess(
  client: PoolClient,
  schema: string,
  role: string,
) {
  const scope = sqlIdentifier(schema),
    target = sqlIdentifier(role);
  await client.query(`GRANT USAGE ON SCHEMA ${scope} TO ${target}`);
  await client.query(
    `GRANT SELECT, INSERT, UPDATE ON ${scope}.users, ${scope}.sessions, ${scope}.oidc_handshakes TO ${target}`,
  );
}

export async function verifyRuntimeRole(client: PoolClient, schema: string) {
  const result = await client.query<{ privileged: boolean }>(
    `
    SELECT r.rolsuper OR r.rolbypassrls OR r.rolcreaterole
      OR pg_has_role(r.oid,n.nspowner,'MEMBER')
      OR EXISTS (SELECT 1 FROM pg_roles privileged WHERE
        (privileged.rolsuper OR privileged.rolbypassrls OR privileged.rolcreaterole)
        AND pg_has_role(r.oid,privileged.oid,'MEMBER'))
      OR EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = n.oid AND pg_has_role(r.oid,c.relowner,'MEMBER'))
      OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles owner ON owner.oid=p.proowner
        WHERE p.pronamespace=n.oid AND p.prosecdef AND
          (owner.rolsuper OR owner.rolcanlogin OR
            NOT coalesce(array_to_string(p.proconfig,',') LIKE '%pg_temp%',false)))
      AS privileged
    FROM pg_roles r CROSS JOIN pg_namespace n
    WHERE r.rolname = current_user AND n.nspname = $1`,
    [schema],
  );
  if (result.rows.length !== 1 || result.rows[0]!.privileged)
    throw new Error(
      "Business API requires an unprivileged non-owner role and hardened NOLOGIN authorization functions",
    );
}

/** SECURITY DEFINER owners must never be the superuser that ran migrations.
 * This isolated NOLOGIN role can bypass RLS on explicitly granted tables only.
 * Neither API nor authentication login may be a member of it.
 */
export async function hardenAuthorizationFunctions(
  client: PoolClient,
  schema: string,
  role: string,
) {
  const scope = sqlIdentifier(schema),
    target = sqlIdentifier(role);
  const found = await client.query(
    "SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolinherit FROM pg_roles WHERE rolname=$1",
    [role],
  );
  const actual = found.rows[0];
  if (
    !actual ||
    actual.rolcanlogin ||
    actual.rolsuper ||
    !actual.rolbypassrls ||
    actual.rolcreaterole ||
    actual.rolcreatedb ||
    actual.rolinherit
  )
    throw new Error(
      "Authorization owner requires NOLOGIN NOINHERIT BYPASSRLS NOSUPERUSER NOCREATEROLE NOCREATEDB",
    );
  await client.query(`GRANT USAGE ON SCHEMA ${scope} TO ${target}`);
  await client.query(
    `GRANT SELECT ON ${["users", "sessions", "tenants", "memberships", "invitations", "projects", "project_memberships"].map((t) => `${scope}.${t}`).join(",")} TO ${target}`,
  );
  await client.query(`GRANT UPDATE(updated_at) ON ${scope}.users TO ${target}`);
  await client.query(
    `GRANT UPDATE ON ${["sessions", "tenants", "memberships", "invitations", "projects", "project_memberships"].map((t) => `${scope}.${t}`).join(",")} TO ${target}`,
  );
  await client.query(
    `GRANT INSERT ON ${scope}.memberships,${scope}.project_memberships TO ${target}`,
  );
  for (const signature of [
    ...authorizationFunctions,
    "enforce_tenant_owner()",
    "enforce_project_lead()",
  ]) {
    await client.query(
      `ALTER FUNCTION ${scope}.${signature} OWNER TO ${target}`,
    );
    await client.query(
      `ALTER FUNCTION ${scope}.${signature} SET search_path TO pg_catalog,${scope},pg_temp`,
    );
  }
}

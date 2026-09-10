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
const mediaAuthorizationFunctions = [
  "media_worker_login()",
  "resolve_media_work(uuid,text,bigint,bigint)",
  "scan_media_work(integer)",
] as const;
const mediaPolicyFunctions = [
  "media_scope_read(uuid,uuid)",
  "media_scope_write(uuid,uuid)",
  "media_worker_login()",
  "media_worker_row(uuid,uuid,text)",
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
    `GRANT SELECT, INSERT ON ${["tenants", "memberships", "invitations", "projects", "project_memberships", "productions", "project_content_versions", "idempotency_records", "script_revisions", "episodes", "scenes", "shots", "shot_revisions", "shot_source_shots", "shot_source_scripts", "dialogue_lines", "analysis_proposals", "analysis_proposal_revisions", "proposal_applications", "creative_subjects", "creative_basis_revisions", "creative_confirmations", "creative_current_confirmations", "production_tasks", "production_task_revisions"].map((t) => `${scope}.${t}`).join(", ")} TO ${target}`,
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
    creative_current_confirmations: "confirmation_id",
    production_tasks:
      "title, assignee_membership_id, scene_id, shot_id, stage, status, due_at, note, revision, updated_at",
    episodes: "title, position, status, revision, updated_at",
    scenes:
      "episode_id, title, position, time_label, location_label, summary, state, default_asset_revision_ids, status, revision, updated_at",
    shots:
      "scene_id, label, position, current_revision_id, current_selection_id, status, revision, updated_at",
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
  for (const signature of [
    "creative_canonical(jsonb)",
    "creative_id_set(jsonb)",
    "creative_payload(jsonb)",
    "capture_creative_basis(text,uuid)",
  ])
    await client.query(
      `GRANT EXECUTE ON FUNCTION ${scope}.${signature} TO ${target}`,
    );
  await client.query(
    `GRANT SELECT,INSERT ON ${["upload_intents", "media", "upload_provenance_evidence", "media_provenance_evidence"].map((table) => `${scope}.${table}`).join(",")} TO ${target}`,
  );
  await client.query(`GRANT SELECT ON ${scope}.media_derivatives TO ${target}`);
  await client.query(
    `GRANT SELECT(epoch) ON ${scope}.media_processing_state TO ${target}`,
  );
  await client.query(
    `GRANT UPDATE(status,step_revision,processing_attempts,issue,retryable,revision,updated_at) ON ${scope}.upload_intents TO ${target}`,
  );
  await client.query(
    `GRANT UPDATE(display_name,tags,provenance,status,issue,revision,updated_at) ON ${scope}.media TO ${target}`,
  );
  await client.query(
    `GRANT UPDATE(status,step_revision,epoch,processing_attempts,issue,revision,updated_at) ON ${scope}.media_derivatives TO ${target}`,
  );
  await client.query(
    `GRANT DELETE ON ${scope}.media_provenance_evidence TO ${target}`,
  );
  await client.query(
    `GRANT SELECT,INSERT ON ${["assets", "asset_revisions", "asset_looks", "asset_revision_looks", "asset_revision_media", "asset_revision_dependencies", "shared_imports"].map((table) => `${scope}.${table}`).join(",")} TO ${target}`,
  );
  await client.query(
    `GRANT UPDATE(name,description,tags,status,current_revision_id,revision,updated_at) ON ${scope}.assets TO ${target}`,
  );
  await client.query(
    `GRANT UPDATE(status,confirmed_by,revision,updated_at) ON ${scope}.asset_revisions TO ${target}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION ${scope}.asset_revision_usable(uuid,uuid,uuid,boolean) TO ${target}`,
  );
  await client.query(
    `GRANT SELECT,INSERT,DELETE ON ${["creative_references", "creative_asset_bindings", "project_quality_references"].map((table) => `${scope}.${table}`).join(",")} TO ${target}`,
  );
  for (const signature of [
    "creative_links(jsonb)",
    "asset_identity_usable(uuid,uuid,uuid,boolean)",
    "validate_creative_links(uuid,uuid,jsonb,jsonb)",
    "creative_owner_document(uuid,uuid,uuid)",
  ])
    await client.query(
      `GRANT EXECUTE ON FUNCTION ${scope}.${signature} TO ${target}`,
    );
  for (const signature of mediaPolicyFunctions)
    await client.query(
      `GRANT EXECUTE ON FUNCTION ${scope}.${signature} TO ${target}`,
    );
  await client.query(
    `GRANT SELECT,INSERT ON ${scope}.takes,${scope}.selections TO ${target}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION ${scope}.candidate_shot_active(uuid,uuid,uuid) TO ${target}`,
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
  await client.query(
    `GRANT SELECT ON ${["media_processing_state", "upload_intents", "media", "media_derivatives"].map((table) => `${scope}.${table}`).join(",")} TO ${target}`,
  );
  // Row locks in trusted context resolution require UPDATE, without a public mutation function.
  await client.query(
    `GRANT UPDATE ON ${scope}.upload_intents,${scope}.media_derivatives TO ${target}`,
  );
  await client.query(
    `GRANT UPDATE(epoch) ON ${scope}.media_processing_state TO ${target}`,
  );
  for (const signature of [
    ...authorizationFunctions,
    ...mediaAuthorizationFunctions,
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

export async function grantMediaWorkerAccess(
  client: PoolClient,
  schema: string,
  workerRole: string,
  schedulerRole: string,
) {
  if (workerRole === schedulerRole)
    throw new Error("Business and scheduling logins must be separate");
  const scope = sqlIdentifier(schema),
    worker = sqlIdentifier(workerRole),
    scheduler = sqlIdentifier(schedulerRole);
  const roles = await client.query(
    "SELECT rolname,rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=ANY($1::text[])",
    [[workerRole, schedulerRole]],
  );
  if (
    roles.rows.length !== 2 ||
    roles.rows.some(
      (r) =>
        !r.rolcanlogin ||
        r.rolsuper ||
        r.rolbypassrls ||
        r.rolcreaterole ||
        r.rolcreatedb,
    )
  )
    throw new Error("Media runtime requires unprivileged logins");
  await client.query(
    `GRANT USAGE ON SCHEMA ${scope} TO ${worker},${scheduler}`,
  );
  await client.query(
    `UPDATE ${scope}.media_processing_state SET worker_role=$1,scheduler_role=$2 WHERE singleton`,
    [workerRole, schedulerRole],
  );
  await client.query(
    `GRANT SELECT ON ${["upload_intents", "media", "media_derivatives", "upload_provenance_evidence"].map((table) => `${scope}.${table}`).join(",")} TO ${worker}`,
  );
  await client.query(
    `GRANT SELECT(epoch) ON ${scope}.media_processing_state TO ${worker}`,
  );
  await client.query(`GRANT INSERT ON ${scope}.media_derivatives TO ${worker}`);
  await client.query(
    `GRANT UPDATE(status,staging_version_id,step_revision,processing_attempts,issue,retryable,revision,updated_at) ON ${scope}.upload_intents TO ${worker}`,
  );
  await client.query(
    `GRANT UPDATE(kind,status,immutable_key,storage_version_id,sha256,bytes,mime,duration_us,width,height,fps_num,fps_den,has_audio,probe_metadata,issue,revision,updated_at) ON ${scope}.media TO ${worker}`,
  );
  await client.query(
    `GRANT UPDATE(status,immutable_key,storage_version_id,sha256,bytes,mime,duration_us,width,height,step_revision,processing_attempts,issue,revision,updated_at) ON ${scope}.media_derivatives TO ${worker}`,
  );
  for (const signature of [
    ...mediaPolicyFunctions,
    "tenant_role(uuid)",
    "project_role(uuid)",
    "resolve_media_work(uuid,text,bigint,bigint)",
  ])
    await client.query(
      `GRANT EXECUTE ON FUNCTION ${scope}.${signature} TO ${worker}`,
    );
  await client.query(
    `GRANT EXECUTE ON FUNCTION ${scope}.scan_media_work(integer) TO ${scheduler}`,
  );
}

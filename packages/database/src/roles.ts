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
const presenceFunctions = [
  "lock_editing_presence_target(uuid,text,uuid,boolean)",
  "editing_presence_member_valid(uuid,uuid,uuid,uuid)",
  "get_editing_presence(uuid,text,uuid)",
  "put_editing_presence(uuid,text,uuid,uuid,text,uuid)",
  "clear_revoked_editing_presence()",
] as const;
const mediaPolicyFunctions = [
  "media_scope_read(uuid,uuid)",
  "media_scope_write(uuid,uuid)",
  "media_worker_login()",
  "media_worker_row(uuid,uuid,text)",
] as const;
const productionFunctions = [
  "request_media_production(uuid,uuid,text)",
  "claim_media_production(uuid,bigint,bigint,uuid,uuid)",
  "assert_media_production_lease(uuid,uuid)",
  "heartbeat_media_production(uuid,uuid)",
  "reserve_media_production_artifact(uuid,uuid,text,bigint,text)",
  "journal_media_production(uuid,uuid,uuid,text,jsonb)",
  "finish_media_production(uuid,uuid,text)",
  "reserve_media_production_resource(uuid,uuid,text)",
  "release_media_production_resource(uuid,uuid)",
  "claim_media_production_cleanup(uuid,uuid,integer)",
  "assert_media_production_cleanup(uuid,uuid)",
  "finish_media_production_cleanup(uuid,uuid)",
  "read_media_production(uuid,uuid)",
  "scan_media_production(integer)",
  "yield_media_production(uuid,uuid,text)",
  "recover_media_production(uuid,uuid,text)",
] as const;
const generationFunctions = [
  "generation_worker_login()",
  "scan_generation_work(integer)",
  "claim_generation_job(uuid,uuid)",
  "record_generation_evidence(uuid,uuid,jsonb)",
  "read_generation_evidence(uuid)",
  "claim_generation_observation(uuid,uuid)",
  "release_generation_observation(uuid,uuid,integer,boolean)",
  "finish_generation_job(uuid,uuid,jsonb,text)",
  "read_generation_archive_envelope(uuid)",
] as const;
const productionTables = [
  "media_production_copies",
  "media_production_sources",
  "media_production_attempts",
  "media_production_artifacts",
  "media_production_parts",
  "media_production_resources",
  "media_production_cleanup",
];

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
  await client.query(
    `GRANT EXECUTE ON FUNCTION ${scope}.generation_worker_login(),${scope}.generation_submission_allowed(uuid),${scope}.request_generation_reconciliation(uuid),${scope}.request_generation_cancel(uuid) TO ${target}`,
  );
  await client.query(
    `GRANT SELECT ON ${scope}.generation_capabilities TO ${target}`,
  );
  await client.query(
    `GRANT SELECT,INSERT ON ${scope}.generation_plans,${scope}.generation_jobs TO ${target}`,
  );
  await client.query(
    `GRANT UPDATE(status,revision,updated_at) ON ${scope}.generation_plans TO ${target}`,
  );
  await client.query(
    `REVOKE UPDATE ON ${scope}.generation_jobs FROM ${target}; REVOKE UPDATE(status,error_code,revision,updated_at,recovery_epoch) ON ${scope}.generation_jobs FROM ${target}`,
  );
  await client.query(`GRANT INSERT ON ${scope}.generation_work TO ${target}`);
  await client.query(
    `GRANT SELECT ON ${scope}.generation_provider_bindings TO ${target}`,
  );
  await client.query(
    `GRANT SELECT,INSERT ON ${scope}.generation_canvas_origins,${scope}.generation_canvas_results TO ${target}`,
  );
  await client.query(
    `GRANT SELECT ON ${scope}.generation_media_outputs TO ${target}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION ${scope}.recover_generated_archive(uuid) TO ${target}`,
  );
  await client.query(
    `GRANT SELECT,INSERT ON ${scope}.generation_plan_shots,${scope}.assistance_artifact_revisions,${scope}.assistance_revision_refs TO ${target}`,
  );
  await client.query(
    `GRANT SELECT,INSERT ON ${scope}.generation_rework_inputs TO ${target}`,
  );
  await client.query(
    `GRANT SELECT,INSERT ON ${scope}.generation_canvas_contexts,${scope}.canvas_assistance_applications,${scope}.generation_assistance_scopes TO ${target}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION ${scope}.canvas_assistance_snapshot(uuid,uuid,jsonb,boolean),${scope}.canvas_assistance_access(uuid,uuid,jsonb),${scope}.discussion_canvas_scope(uuid,uuid,uuid,boolean),${scope}.canvas_discussion_history(uuid,uuid,jsonb) TO ${target}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION ${scope}.canvas_assistance_references_supported(uuid,uuid,jsonb,jsonb) TO ${target}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION ${scope}.canvas_assistance_direct_access(uuid,uuid,jsonb),${scope}.canvas_assistance_reply_snapshot(uuid,uuid,jsonb),${scope}.canvas_assistance_reply_access(uuid,uuid,jsonb) TO ${target}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION ${scope}.rework_input_hash(jsonb,jsonb,bigint,uuid),${scope}.rework_source_current(uuid) TO ${target}`,
  );
  await client.query(
    `GRANT SELECT ON ${scope}.assistance_artifacts TO ${target}`,
  );
  await client.query(
    `GRANT UPDATE(revision,updated_at) ON ${scope}.assistance_artifacts TO ${target}`,
  );
  await client.query(`GRANT USAGE ON SCHEMA ${scope} TO ${target}`);
  await client.query(
    `GRANT SELECT ON ${scope}.reviews,${scope}.review_comments,${scope}.review_comment_revisions TO ${target}`,
  );
  await client.query(
    `GRANT INSERT(id,tenant_id,project_id,take_id,number,opened_by) ON ${scope}.reviews TO ${target}`,
  );
  await client.query(
    `GRANT INSERT(id,tenant_id,project_id,review_id,author_id,body,start_us,end_us,parent_comment_id) ON ${scope}.review_comments TO ${target}`,
  );
  await client.query(
    `GRANT UPDATE(body,resolved,revision) ON ${scope}.review_comments TO ${target}`,
  );
  await client.query(
    `GRANT SELECT ON ${scope}.project_creation_requests TO ${target}`,
  );
  await client.query(
    `GRANT INSERT(tenant_id,actor_id,creation_request_id,request_hash,project_id) ON ${scope}.project_creation_requests TO ${target}`,
  );
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
  await client.query(
    `GRANT SELECT,INSERT ON ${["cuts", "edit_history_bodies", "cut_work_drafts", "cut_work_draft_revisions", "edit_history_media_refs", "edit_history_dialogue_refs", "cut_spec_media_refs", "edit_history_spec_media_refs"].map((table) => `${scope}.${table}`).join(",")} TO ${target}`,
  );
  // Column privilege permits the object's row lock; the Cut trigger rejects
  // mutations until the normalized-result transition is implemented.
  await client.query(`GRANT UPDATE(updated_at) ON ${scope}.cuts TO ${target}`);
  await client.query(
    `GRANT UPDATE(revision) ON ${scope}.cut_work_drafts TO ${target}`,
  );
  await client.query(
    `GRANT DELETE ON ${scope}.cut_work_draft_revisions,${scope}.edit_history_bodies TO ${target}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION ${scope}.work_media_items(jsonb) TO ${target}`,
  );
  await client.query(
    `GRANT SELECT ON ${scope}.media_production_copies,${scope}.media_production_sources TO ${target}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION ${scope}.request_media_production(uuid,uuid,text) TO ${target}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION ${scope}.recover_media_production(uuid,uuid,text) TO ${target}`,
  );
  await client.query(
    `GRANT SELECT,INSERT ON ${["canvases", "canvas_history_bodies", "canvas_revisions", "scene_canvas_links", "canvas_node_index", "canvas_media_refs", "canvas_subject_refs", "canvas_outbox", "scene_workspace_preferences"].map((t) => `${scope}.${t}`).join(",")} TO ${target}`,
  );
  await client.query(
    `GRANT UPDATE(revision,updated_at) ON ${scope}.canvases TO ${target}`,
  );
  await client.query(
    `GRANT UPDATE(revision,preference) ON ${scope}.scene_workspace_preferences TO ${target}`,
  );
  await client.query(
    `GRANT DELETE ON ${scope}.canvas_revisions,${scope}.canvas_history_bodies TO ${target}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION ${scope}.validate_canvas_shape(jsonb),${scope}.validate_canvas_current_references(uuid) TO ${target}`,
  );
  await client.query(
    `GRANT SELECT,INSERT,DELETE ON ${scope}.node_shot_bindings TO ${target}`,
  );
  await client.query(
    `GRANT SELECT,INSERT ON ${scope}.canvas_upload_placements TO ${target}`,
  );
  await client.query(
    `GRANT UPDATE(dismissed) ON ${scope}.canvas_upload_placements TO ${target}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION ${scope}.get_editing_presence(uuid,text,uuid),${scope}.put_editing_presence(uuid,text,uuid,uuid,text,uuid) TO ${target}`,
  );
  await client.query(
    `GRANT SELECT ON ${scope}.project_events,${scope}.project_event_heads TO ${target}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION ${scope}.relay_project_events(uuid) TO ${target}`,
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
  await client.query(
    `GRANT SELECT ON ${scope}.assets,${scope}.asset_revisions,${scope}.asset_revision_media,${scope}.shared_imports TO ${target}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION ${scope}.asset_revision_usable(uuid,uuid,uuid,boolean),${scope}.asset_identity_usable(uuid,uuid,uuid,boolean) TO ${target}`,
  );
  await client.query(`GRANT UPDATE(updated_at) ON ${scope}.users TO ${target}`);
  await client.query(
    `GRANT UPDATE ON ${["sessions", "tenants", "memberships", "invitations", "projects", "project_memberships"].map((t) => `${scope}.${t}`).join(",")} TO ${target}`,
  );
  await client.query(
    `GRANT INSERT ON ${scope}.memberships,${scope}.project_memberships TO ${target}`,
  );
  await client.query(
    `GRANT INSERT ON ${scope}.review_comment_revisions TO ${target}`,
  );
  await client.query(
    `GRANT SELECT ON ${scope}.reviews,${scope}.review_comments,${scope}.review_comment_revisions,${scope}.takes TO ${target}`,
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
  await client.query(
    `GRANT SELECT,INSERT,UPDATE ON ${productionTables.map((t) => `${scope}.${t}`).join(",")} TO ${target}`,
  );
  await client.query(
    `GRANT SELECT ON ${scope}.edit_history_media_refs TO ${target}`,
  );
  await client.query(`GRANT UPDATE(updated_at) ON ${scope}.media TO ${target}`);
  await client.query(
    `GRANT SELECT ON ${["canvases", "scene_canvas_links", "scenes", "episodes", "cuts"].map((t) => `${scope}.${t}`).join(",")} TO ${target}`,
  );
  await client.query(
    `GRANT SELECT ON ${scope}.canvas_upload_placements,${scope}.canvas_node_index TO ${target}`,
  );
  await client.query(
    `GRANT SELECT,INSERT,UPDATE,DELETE ON ${scope}.editing_presence TO ${target}`,
  );
  await client.query(
    `GRANT SELECT,DELETE ON ${scope}.canvas_outbox TO ${target}`,
  );
  await client.query(
    `GRANT SELECT,INSERT,UPDATE,DELETE ON ${scope}.project_event_outbox,${scope}.project_event_heads,${scope}.project_events TO ${target}`,
  );
  await client.query(
    `GRANT SELECT ON ${["generation_capabilities", "generation_plans", "generation_jobs"].map((t) => `${scope}.${t}`).join(",")} TO ${target}`,
  );
  await client.query(
    `GRANT SELECT ON ${scope}.generation_rework_inputs,${scope}.shots TO ${target}`,
  );
  await client.query(
    `GRANT SELECT ON ${scope}.generation_canvas_contexts,${scope}.canvas_assistance_applications,${scope}.generation_assistance_scopes TO ${target}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION ${scope}.canvas_assistance_access(uuid,uuid,jsonb),${scope}.discussion_canvas_scope(uuid,uuid,uuid,boolean),${scope}.canvas_discussion_history(uuid,uuid,jsonb) TO ${target}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION ${scope}.canvas_assistance_direct_access(uuid,uuid,jsonb),${scope}.canvas_assistance_reply_snapshot(uuid,uuid,jsonb),${scope}.canvas_assistance_reply_access(uuid,uuid,jsonb) TO ${target}`,
  );
  await client.query(
    `GRANT EXECUTE ON FUNCTION ${scope}.rework_input_hash(jsonb,jsonb,bigint,uuid),${scope}.rework_source_current(uuid),${scope}.creative_canonical(jsonb) TO ${target}`,
  );
  await client.query(
    `GRANT UPDATE(enabled) ON ${scope}.generation_capabilities TO ${target}`,
  );
  await client.query(
    `GRANT UPDATE(status,proposal_id,assistance_artifact_id,result_media_id,error_code,revision,updated_at,cancel_status,cancel_requested_at) ON ${scope}.generation_jobs TO ${target}`,
  );
  await client.query(
    `GRANT SELECT,INSERT,DELETE ON ${scope}.generation_work TO ${target}`,
  );
  await client.query(
    `GRANT SELECT,INSERT ON ${["generation_attempts", "generation_submission_evidence", "analysis_proposals", "analysis_proposal_revisions"].map((t) => `${scope}.${t}`).join(",")} TO ${target}`,
  );
  await client.query(
    `GRANT SELECT ON ${scope}.generation_runtime_identity TO ${target}`,
  );
  await client.query(
    `GRANT SELECT,INSERT ON ${scope}.assistance_artifacts,${scope}.assistance_artifact_revisions,${scope}.assistance_revision_refs TO ${target}`,
  );
  await client.query(
    `GRANT SELECT,INSERT,UPDATE ON ${scope}.generation_media_outputs TO ${target}`,
  );
  await client.query(
    `GRANT SELECT,INSERT ON ${scope}.media,${scope}.media_derivatives TO ${target}`,
  );
  await client.query(
    `GRANT UPDATE(kind,status,immutable_key,storage_version_id,sha256,bytes,mime,width,height,duration_us,fps_num,fps_den,has_audio,probe_metadata,issue,revision,updated_at) ON ${scope}.media TO ${target}`,
  );
  await client.query(
    `GRANT SELECT,INSERT ON ${scope}.generation_provider_bindings TO ${target}`,
  );
  await client.query(
    `GRANT SELECT,INSERT,UPDATE ON ${scope}.generation_observation_control TO ${target}`,
  );
  await client.query(
    `GRANT SELECT,INSERT ON ${scope}.generation_applied_observations TO ${target}`,
  );
  for (const signature of [
    ...authorizationFunctions,
    ...generationFunctions,
    "generation_submission_allowed(uuid)",
    "request_generation_reconciliation(uuid)",
    "request_generation_cancel(uuid)",
    "finish_generation_output(uuid,uuid,jsonb,text)",
    "finish_script_analysis_job(uuid,uuid,jsonb,text)",
    "finish_text_assistance_job(uuid,uuid,jsonb,text)",
    "validate_media_source()",
    "claim_generated_media(uuid,bigint,bigint,uuid)",
    "finish_generated_media(uuid,uuid,jsonb,jsonb)",
    "recover_generated_archive(uuid)",
    "scan_generated_media(integer)",
    ...mediaAuthorizationFunctions,
    ...productionFunctions,
    ...presenceFunctions,
    "record_project_invalidation()",
    "snapshot_review_comment()",
    "guard_canvas_upload_node_identity()",
    "relay_project_events(uuid)",
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
    "claim_generated_media(uuid,bigint,bigint,uuid)",
    "finish_generated_media(uuid,uuid,jsonb,jsonb)",
  ])
    await client.query(
      `GRANT EXECUTE ON FUNCTION ${scope}.${signature} TO ${worker}`,
    );
  await client.query(
    `GRANT EXECUTE ON FUNCTION ${scope}.scan_media_work(integer),${scope}.scan_generated_media(integer) TO ${scheduler}`,
  );
  for (const signature of productionFunctions.filter(
    (s) =>
      !s.startsWith("request_") &&
      !s.startsWith("scan_") &&
      !s.startsWith("recover_"),
  ))
    await client.query(
      `GRANT EXECUTE ON FUNCTION ${scope}.${signature} TO ${worker}`,
    );
  await client.query(
    `GRANT EXECUTE ON FUNCTION ${scope}.scan_media_production(integer) TO ${scheduler}`,
  );
}

/** Isolated text worker receives function access only, never API/session or arbitrary project reads. */
export async function grantGenerationWorkerAccess(
  client: PoolClient,
  schema: string,
  role: string,
) {
  const scope = sqlIdentifier(schema),
    target = sqlIdentifier(role);
  const found = await client.query(
    "SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=$1",
    [role],
  );
  if (
    !found.rows[0]?.rolcanlogin ||
    found.rows[0].rolsuper ||
    found.rows[0].rolbypassrls ||
    found.rows[0].rolcreaterole ||
    found.rows[0].rolcreatedb
  )
    throw new Error("Generation worker requires a restricted login");
  await client.query(`GRANT USAGE ON SCHEMA ${scope} TO ${target}`);
  await client.query(
    `INSERT INTO ${scope}.generation_runtime_identity(singleton,worker_role) VALUES(true,$1) ON CONFLICT(singleton) DO NOTHING`,
    [role],
  );
  const identity = await client.query(
    `SELECT worker_role FROM ${scope}.generation_runtime_identity WHERE singleton`,
  );
  if (identity.rows[0]?.worker_role !== role)
    throw new Error(
      "An existing generation worker identity cannot be replaced without explicit recovery",
    );
  await client.query(
    `REVOKE EXECUTE ON FUNCTION ${scope}.finish_generation_output(uuid,uuid,jsonb,text) FROM ${target}`,
  );
  for (const signature of generationFunctions)
    await client.query(
      `GRANT EXECUTE ON FUNCTION ${scope}.${signature} TO ${target}`,
    );
}

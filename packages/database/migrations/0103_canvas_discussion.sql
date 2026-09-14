-- Discussion owns a real canvas scope even with zero explicit node attachments.
ALTER TABLE generation_plans DROP CONSTRAINT generation_plans_input_check;
ALTER TABLE generation_plans ADD CONSTRAINT generation_plans_input_check CHECK(((input->>'purpose'='script_analysis' AND input->'proposalTarget'->>'mode'='append_to_scene') OR (input->>'purpose'='creative_assistance' AND ((input->'assistance'->>'kind' IN ('prepare_prompt','prepare_rework') AND (jsonb_array_length(input->'shotSources') BETWEEN 1 AND 100 OR (input->'assistance'->>'kind'='prepare_prompt' AND jsonb_array_length(input->'canvasSources') BETWEEN 1 AND 20))) OR (input->'assistance'->>'kind'='discuss' AND jsonb_array_length(input->'shotSources')=0 AND jsonb_array_length(input->'canvasSources') BETWEEN 0 AND 20))) OR input->>'purpose' IN ('image','video','audio')) IS TRUE);
CREATE TABLE generation_assistance_scopes (
 tenant_id uuid NOT NULL, project_id uuid NOT NULL, plan_id uuid PRIMARY KEY, canvas_id uuid NOT NULL, scene_id uuid NOT NULL,
 FOREIGN KEY(tenant_id,project_id,plan_id) REFERENCES generation_plans(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,canvas_id) REFERENCES canvases(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,scene_id) REFERENCES scenes(tenant_id,project_id,id)
);
ALTER TABLE generation_assistance_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_assistance_scopes FORCE ROW LEVEL SECURITY;
CREATE POLICY discussion_scope ON generation_assistance_scopes USING(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL) WITH CHECK(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL);
CREATE TRIGGER discussion_scope_fixed BEFORE UPDATE OR DELETE ON generation_assistance_scopes FOR EACH ROW EXECUTE FUNCTION protect_content_revision();
CREATE FUNCTION discussion_canvas_scope(t uuid,p uuid,canvas uuid,current_only boolean) RETURNS jsonb LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT jsonb_build_object('canvasId',c.id,'sceneId',s.id) FROM canvases c
 JOIN scene_canvas_links l ON l.canvas_id=c.id JOIN scenes s ON s.id=l.scene_id JOIN episodes e ON e.id=s.episode_id
 WHERE c.tenant_id=t AND c.project_id=p AND c.id=canvas AND (NOT current_only OR (s.status='active' AND e.status='active'))
$$;
CREATE FUNCTION guard_discussion_scope() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM generation_plans p WHERE p.id=NEW.plan_id AND p.tenant_id=NEW.tenant_id AND p.project_id=NEW.project_id
  AND p.input->'assistance'->>'kind'='discuss' AND p.resolved_input->'canvasScope'=jsonb_build_object('canvasId',NEW.canvas_id,'sceneId',NEW.scene_id)
  AND discussion_canvas_scope(NEW.tenant_id,NEW.project_id,NEW.canvas_id,true)=p.resolved_input->'canvasScope')
 THEN RAISE EXCEPTION 'Discussion scope must preserve the validated real canvas' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER discussion_scope_valid BEFORE INSERT ON generation_assistance_scopes FOR EACH ROW EXECUTE FUNCTION guard_discussion_scope();
CREATE FUNCTION guard_discussion_scope_ready() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF (SELECT count(*) FROM generation_assistance_scopes WHERE plan_id=NEW.id)<>(CASE WHEN NEW.input->'assistance'->>'kind'='discuss' THEN 1 ELSE 0 END)
 THEN RAISE EXCEPTION 'Discussion scope projection missing' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER discussion_scope_ready AFTER INSERT ON generation_plans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_discussion_scope_ready();


CREATE OR REPLACE FUNCTION canvas_assistance_reply_snapshot(t uuid,p uuid,source jsonb) RETURNS jsonb LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT CASE WHEN plan.input->'assistance'->>'kind'='discuss' THEN jsonb_build_object('kind','discuss','canvasId',plan.input->'assistance'->'canvasId') ELSE '{}'::jsonb END || jsonb_build_object('body',r.body,'instruction',plan.input->'prompt',
  'targetCapabilityId',(plan.input->'assistance'->>'targetCapabilityId')::uuid,
  'targetCapabilityRevision',(plan.input->'assistance'->>'targetCapabilityRevision')::bigint,
  'dependency',jsonb_build_object('kind','assistance_artifact','objectId',a.id,'revision',r.number,'tracking','fixed',
   'contentHash',encode(sha256(convert_to(creative_canonical(jsonb_build_object('artifactId',a.id,'revision',r.number,'instruction',plan.input->'prompt','body',r.body)),'UTF8')),'hex')))
 FROM assistance_artifacts a JOIN assistance_artifact_revisions r ON r.artifact_id=a.id
 JOIN generation_jobs j ON j.id=a.generation_job_id JOIN generation_plans plan ON plan.id=j.plan_id
 WHERE a.tenant_id=t AND a.project_id=p AND a.id=(source->>'artifactId')::uuid AND r.number=(source->>'revision')::bigint
  AND j.status='succeeded' AND plan.input ? 'canvasSources' AND plan.input->'assistance'->>'kind' IN ('prepare_prompt','discuss')
$$;

CREATE OR REPLACE FUNCTION canvas_assistance_reply_access(t uuid,p uuid,source jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
DECLARE wanted jsonb:=source; previous record; visited text[]:='{}'; identity text; advice_refs jsonb;
BEGIN
 WHILE wanted IS NOT NULL LOOP
  identity:=(wanted->>'artifactId')||':'||(wanted->>'revision');
  IF identity IS NULL OR identity=ANY(visited) THEN RETURN false;END IF;
  visited:=array_append(visited,identity);
  SELECT r.body,plan.input,plan.resolved_input,j.status INTO previous
   FROM assistance_artifacts a JOIN assistance_artifact_revisions r ON r.artifact_id=a.id
   JOIN generation_jobs j ON j.id=a.generation_job_id JOIN generation_plans plan ON plan.id=j.plan_id
   WHERE a.tenant_id=t AND a.project_id=p AND a.id=(wanted->>'artifactId')::uuid AND r.number=(wanted->>'revision')::bigint;
  IF NOT FOUND THEN RETURN false;END IF;
  IF previous.status<>'succeeded' OR NOT previous.input ? 'canvasSources' OR previous.input->'assistance'->>'kind' NOT IN ('prepare_prompt','discuss')
   OR (previous.input->'assistance'->>'kind'='discuss' AND discussion_canvas_scope(t,p,(previous.input->'assistance'->>'canvasId')::uuid,false) IS NULL)
   OR NOT canvas_assistance_direct_access(t,p,previous.resolved_input) THEN RETURN false;END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('reference',r)),'[]') INTO advice_refs FROM jsonb_array_elements(previous.body->'referenceSuggestions') r;
  IF NOT canvas_assistance_direct_access(t,p,jsonb_build_object('references',advice_refs)) THEN RETURN false;END IF;
  wanted:=previous.input->'assistanceSource';
 END LOOP;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION canvas_assistance_access(t uuid,p uuid,resolved jsonb) RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT (NOT resolved ? 'canvasScope' OR coalesce(discussion_canvas_scope(t,p,(resolved->'canvasScope'->>'canvasId')::uuid,false)=resolved->'canvasScope',false)) AND canvas_assistance_direct_access(t,p,resolved) AND NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(resolved->'dependencies') d WHERE d->>'kind'='assistance_artifact'
   AND NOT canvas_assistance_reply_access(t,p,jsonb_build_object('artifactId',d->'objectId','revision',d->'revision')))
$$;

CREATE OR REPLACE FUNCTION guard_canvas_assistance_plan() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE reply jsonb; source jsonb; fixed jsonb; expected jsonb:='[]'; refs jsonb:='[]'; deps jsonb:='[]'; shot jsonb; reference_value jsonb; target generation_capabilities; actual generation_capabilities;
BEGIN
 IF NEW.input->'assistance'->>'kind'='discuss' THEN RETURN NEW;END IF;
 IF NEW.resolved_input ? 'canvasScope' OR NEW.input->'assistance' ? 'canvasId' THEN RAISE EXCEPTION 'Scope is only explicit discussion data' USING ERRCODE='23514';END IF;
 IF NOT NEW.input ? 'canvasSources' THEN
  IF NEW.resolved_input ? 'canvasSnapshots' OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.resolved_input->'dependencies') d WHERE d->>'kind'='canvas_node') THEN RAISE EXCEPTION 'Canvas sources must be explicit' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF NEW.input->>'purpose' IS DISTINCT FROM 'creative_assistance' OR NEW.input->'assistance'->>'kind' IS DISTINCT FROM 'prepare_prompt'
  OR jsonb_array_length(NEW.input->'canvasSources') NOT BETWEEN 1 AND 20 OR coalesce(NEW.input->'contextSources','[]')<>'[]'
  OR NEW.input->'additionalReferences'<>'[]' OR NEW.input->'referenceOverrides'<>'[]'
  OR NEW.resolved_input->>'resolverVersion' IS DISTINCT FROM 'canvas-assistance/1' OR NEW.resolved_input->'contextSnapshots' IS DISTINCT FROM '[]'::jsonb
  OR NEW.resolved_input->'prompt' IS DISTINCT FROM NEW.input->'prompt' OR NEW.resolved_input->'assistanceRequest' IS DISTINCT FROM NEW.input->'assistance'
 THEN RAISE EXCEPTION 'Unsupported canvas assistance input' USING ERRCODE='23514';END IF;
 FOR shot IN SELECT value FROM jsonb_array_elements(NEW.input->'shotSources') LOOP
  FOR reference_value IN SELECT value FROM shot_revisions sr CROSS JOIN LATERAL jsonb_array_elements(sr.spec->'references') WHERE sr.tenant_id=NEW.tenant_id AND sr.project_id=NEW.project_id AND sr.id=(shot->>'shotRevisionId')::uuid AND sr.shot_id=(shot->>'shotId')::uuid LOOP
   refs:=refs||jsonb_build_array(jsonb_build_object('sourceLevel','shot','sourceObjectId',(shot->>'shotRevisionId')::uuid,'shotId',(shot->>'shotId')::uuid,'reference',reference_value));
  END LOOP;
 END LOOP;
 FOR source IN SELECT value FROM jsonb_array_elements(NEW.input->'canvasSources') LOOP
  fixed:=canvas_assistance_snapshot(NEW.tenant_id,NEW.project_id,source,true);
  IF fixed IS NULL THEN RAISE EXCEPTION 'Canvas source is not current or valid' USING ERRCODE='23514';END IF;
  expected:=expected||jsonb_build_array(fixed);
  deps:=deps||jsonb_build_array(jsonb_build_object('kind','canvas_node','objectId',source->'nodeId','revision',source->'canvasRevision','tracking','current','contentHash',fixed->'contentHash'));
  IF fixed->'content'->>'type'='media' THEN
   refs:=refs||jsonb_build_array(jsonb_build_object('sourceLevel','attempt','sourceObjectId',source->'nodeId','reference',jsonb_strip_nulls(jsonb_build_object('mediaId',fixed->'content'->'mediaId','assetRevisionId',fixed->'content'->'assetRevisionId','purpose',source->'purpose'))));
  END IF;
 END LOOP;
 IF NEW.input ? 'assistanceSource' THEN
  reply:=canvas_assistance_reply_snapshot(NEW.tenant_id,NEW.project_id,NEW.input->'assistanceSource');
  IF reply IS NULL OR NOT canvas_assistance_reply_access(NEW.tenant_id,NEW.project_id,NEW.input->'assistanceSource')
   OR (reply->>'targetCapabilityId')::uuid IS DISTINCT FROM (NEW.input->'assistance'->>'targetCapabilityId')::uuid
   OR reply->'targetCapabilityRevision' IS DISTINCT FROM NEW.input->'assistance'->'targetCapabilityRevision'
   OR NEW.resolved_input->'assistanceSnapshot' IS DISTINCT FROM reply->'body'
   OR NEW.resolved_input->'assistanceInstruction' IS DISTINCT FROM reply->'instruction'
   OR (SELECT coalesce(jsonb_agg(d ORDER BY ord),'[]') FROM jsonb_array_elements(NEW.resolved_input->'dependencies') WITH ORDINALITY v(d,ord) WHERE d->>'kind'='assistance_artifact') IS DISTINCT FROM jsonb_build_array(reply->'dependency')
  THEN RAISE EXCEPTION 'Reply requires its exact authorized prior turn and target' USING ERRCODE='23514';END IF;
 ELSIF NEW.resolved_input ?| ARRAY['assistanceSnapshot','assistanceInstruction'] OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.resolved_input->'dependencies') d WHERE d->>'kind'='assistance_artifact') THEN
  RAISE EXCEPTION 'Reply history must be explicitly selected' USING ERRCODE='23514';
 END IF;
 SELECT * INTO target FROM generation_capabilities WHERE tenant_id=NEW.tenant_id AND id=(NEW.input->'assistance'->>'targetCapabilityId')::uuid;
 SELECT * INTO actual FROM generation_capabilities WHERE tenant_id=NEW.tenant_id AND id=NEW.capability_id;
 IF target.id IS NULL OR NOT target.enabled OR target.definition->>'purpose' NOT IN ('image','video','audio') OR target.revision<>(NEW.input->'assistance'->>'targetCapabilityRevision')::bigint
  OR NEW.created_by IS DISTINCT FROM actor_id() OR actual.definition->>'purpose' IS DISTINCT FROM 'creative_assistance'
  OR (NEW.input->>'capabilityId')::uuid IS DISTINCT FROM actual.id OR (NEW.input->>'connectionId')::uuid IS DISTINCT FROM actual.connection_id
  OR NEW.capability_revision IS DISTINCT FROM actual.revision OR NEW.execution_mode IS DISTINCT FROM actual.execution_mode
  OR (NEW.status='ready' AND (NOT actual.enabled OR actual.execution_mode<>'test_fixture'))
  OR NEW.resolved_input-ARRAY['resolverVersion','prompt','references','shots','dependencies','contextSnapshots','canvasSnapshots','assistanceRequest','targetCapabilitySnapshot','targetConnectionVersionId','assistanceSnapshot','assistanceInstruction']<>'{}'::jsonb
  OR NEW.resolved_input->>'targetConnectionVersionId' IS DISTINCT FROM target.connection_version_id::text
  OR NEW.resolved_input->'targetCapabilitySnapshot' IS DISTINCT FROM (target.definition||jsonb_build_object('id',target.id,'connectionId',target.connection_id,'revision',target.revision,'enabled',target.enabled,'executionMode',target.execution_mode))
  OR NEW.resolved_input->'canvasSnapshots' IS DISTINCT FROM expected OR NEW.resolved_input->'references' IS DISTINCT FROM refs
  OR (SELECT coalesce(jsonb_agg(d ORDER BY ord),'[]') FROM jsonb_array_elements(NEW.resolved_input->'dependencies') WITH ORDINALITY v(d,ord) WHERE d->>'kind'='canvas_node') IS DISTINCT FROM deps
  OR NOT canvas_assistance_access(NEW.tenant_id,NEW.project_id,NEW.resolved_input)
  OR NOT canvas_assistance_references_supported(NEW.tenant_id,NEW.project_id,refs,target.definition)
  OR NOT canvas_assistance_references_supported(NEW.tenant_id,NEW.project_id,refs,actual.definition)
  OR NEW.input_hash IS DISTINCT FROM rework_input_hash(NEW.input,NEW.resolved_input,NEW.capability_revision,NEW.connection_version_id)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(refs) r WHERE NOT (target.definition->'supportedPurposes' ? (r->'reference'->>'purpose')) OR NOT (actual.definition->'supportedPurposes' ? (r->'reference'->>'purpose')))
  OR jsonb_array_length(refs)>coalesce((target.definition->>'maxReferences')::integer,100)
  OR jsonb_array_length(refs)>coalesce((actual.definition->>'maxReferences')::integer,100)
 THEN RAISE EXCEPTION 'Fixed canvas snapshot, input hash, authority or target differs' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION guard_discussion_plan() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE actual generation_capabilities; source jsonb; fixed jsonb; refs jsonb:='[]'; deps jsonb:='[]'; snapshots jsonb:='[]'; expected jsonb; scope jsonb; reply jsonb;
BEGIN
 IF NEW.input->'assistance'->>'kind' IS DISTINCT FROM 'discuss' THEN RETURN NEW;END IF;
 scope:=discussion_canvas_scope(NEW.tenant_id,NEW.project_id,(NEW.input->'assistance'->>'canvasId')::uuid,true);
 SELECT * INTO actual FROM generation_capabilities WHERE tenant_id=NEW.tenant_id AND id=NEW.capability_id;
 IF scope IS NULL OR NEW.input->>'purpose' IS DISTINCT FROM 'creative_assistance'
  OR NEW.input->'assistance' IS DISTINCT FROM jsonb_build_object('kind','discuss','canvasId',scope->'canvasId')
  OR NEW.input->'shotSources' IS DISTINCT FROM '[]'::jsonb OR coalesce(NEW.input->'contextSources','[]')<>'[]'::jsonb
  OR NEW.input->'additionalReferences' IS DISTINCT FROM '[]'::jsonb OR NEW.input->'referenceOverrides' IS DISTINCT FROM '[]'::jsonb
  OR NEW.input->'output' IS DISTINCT FROM '{}'::jsonb OR NEW.input ?| ARRAY['sourceScriptRevisionId','scriptRange','proposalTarget']
  OR jsonb_typeof(NEW.input->'canvasSources') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.input->'canvasSources') NOT BETWEEN 0 AND 20
  OR jsonb_typeof(NEW.input->'prompt') IS DISTINCT FROM 'string' OR length(btrim(NEW.input->>'prompt')) NOT BETWEEN 1 AND 20000
  OR NEW.created_by IS DISTINCT FROM actor_id() OR actual.id IS NULL OR actual.definition->>'purpose' IS DISTINCT FROM 'creative_assistance'
  OR (NEW.input->>'capabilityId')::uuid IS DISTINCT FROM actual.id OR (NEW.input->>'connectionId')::uuid IS DISTINCT FROM actual.connection_id
  OR NEW.capability_revision IS DISTINCT FROM actual.revision OR NEW.connection_version_id IS DISTINCT FROM actual.connection_version_id OR NEW.execution_mode IS DISTINCT FROM actual.execution_mode
  OR (NEW.status='ready' AND (NOT actual.enabled OR actual.execution_mode<>'test_fixture'))
 THEN RAISE EXCEPTION 'Discussion requires explicit valid text and canvas scope' USING ERRCODE='23514';END IF;
 FOR source IN SELECT value FROM jsonb_array_elements(NEW.input->'canvasSources') LOOP
  fixed:=canvas_assistance_snapshot(NEW.tenant_id,NEW.project_id,source,true);
  IF fixed IS NULL OR (source->>'canvasId')::uuid IS DISTINCT FROM (scope->>'canvasId')::uuid
  THEN RAISE EXCEPTION 'Discussion attachment is not a current node in this canvas' USING ERRCODE='23514';END IF;
  snapshots:=snapshots||jsonb_build_array(fixed);
  deps:=deps||jsonb_build_array(jsonb_build_object('kind','canvas_node','objectId',source->'nodeId','revision',source->'canvasRevision','tracking','current','contentHash',fixed->'contentHash'));
  IF fixed->'content'->>'type'='media' THEN
   refs:=refs||jsonb_build_array(jsonb_build_object('sourceLevel','attempt','sourceObjectId',source->'nodeId','reference',jsonb_strip_nulls(jsonb_build_object('mediaId',fixed->'content'->'mediaId','assetRevisionId',fixed->'content'->'assetRevisionId','purpose',source->'purpose'))));
  END IF;
 END LOOP;
 expected:=jsonb_build_object('resolverVersion','canvas-discussion/1','prompt',NEW.input->'prompt','references',refs,'shots','[]'::jsonb,'dependencies',deps,'contextSnapshots','[]'::jsonb,'canvasSnapshots',snapshots,'assistanceRequest',NEW.input->'assistance','canvasScope',scope);
 IF NEW.input ? 'assistanceSource' THEN
  reply:=canvas_assistance_reply_snapshot(NEW.tenant_id,NEW.project_id,NEW.input->'assistanceSource');
  IF reply IS NULL OR reply->>'kind' IS DISTINCT FROM 'discuss' OR reply->'canvasId' IS DISTINCT FROM scope->'canvasId'
   OR NOT canvas_assistance_reply_access(NEW.tenant_id,NEW.project_id,NEW.input->'assistanceSource')
  THEN RAISE EXCEPTION 'Discussion prior turn must be the exact authorized version in this canvas' USING ERRCODE='23514';END IF;
  expected:=expected||jsonb_build_object('assistanceSnapshot',reply->'body','assistanceInstruction',reply->'instruction','dependencies',deps||jsonb_build_array(reply->'dependency'));
 END IF;
 IF NEW.resolved_input IS DISTINCT FROM expected OR length(expected::text)>110000
  OR NOT canvas_assistance_access(NEW.tenant_id,NEW.project_id,expected)
  OR NOT canvas_assistance_references_supported(NEW.tenant_id,NEW.project_id,refs,actual.definition)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(refs) r WHERE NOT (actual.definition->'supportedPurposes' ? (r->'reference'->>'purpose')))
  OR jsonb_array_length(refs)>coalesce((actual.definition->>'maxReferences')::integer,100)
  OR NEW.input_hash IS DISTINCT FROM rework_input_hash(NEW.input,NEW.resolved_input,NEW.capability_revision,NEW.connection_version_id)
 THEN RAISE EXCEPTION 'Discussion fixed projection or hash differs' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER discussion_plan BEFORE INSERT ON generation_plans FOR EACH ROW EXECUTE FUNCTION guard_discussion_plan();


CREATE OR REPLACE FUNCTION guard_canvas_assistance_job() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE p generation_plans; s jsonb;
BEGIN
 SELECT * INTO p FROM generation_plans WHERE id=NEW.plan_id;
 IF NOT p.input ? 'canvasSources' THEN RETURN NEW;END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p.resolved_input->'canvasSnapshots') LOOP
  IF canvas_assistance_snapshot(p.tenant_id,p.project_id,s->'source',false) IS DISTINCT FROM s THEN RAISE EXCEPTION 'Canvas selected contents changed before execution' USING ERRCODE='23514';END IF;
 END LOOP;
 IF p.input->'assistance'->>'kind'='discuss' THEN
  IF discussion_canvas_scope(p.tenant_id,p.project_id,(p.input->'assistance'->>'canvasId')::uuid,true) IS DISTINCT FROM p.resolved_input->'canvasScope' OR NOT canvas_assistance_access(p.tenant_id,p.project_id,p.resolved_input) THEN RAISE EXCEPTION 'Discussion sources unavailable before execution' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF NOT canvas_assistance_access(p.tenant_id,p.project_id,p.resolved_input) OR NOT EXISTS(SELECT 1 FROM generation_capabilities c WHERE c.id=p.target_capability_id AND c.enabled AND c.revision=(p.input->'assistance'->>'targetCapabilityRevision')::bigint AND c.connection_version_id=(p.resolved_input->>'targetConnectionVersionId')::uuid) THEN RAISE EXCEPTION 'Canvas context or target unavailable before execution' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION claim_generation_job(wanted uuid, token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE j generation_jobs; p generation_plans; c generation_capabilities; a generation_attempts; prior_actor text; prior_tenant text;
BEGIN
 IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Worker access required' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM generation_jobs WHERE id=wanted;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- Same tenant -> project lock order as permission changes and API mutations.
 PERFORM 1 FROM tenants WHERE id=j.tenant_id FOR SHARE;
 PERFORM 1 FROM projects WHERE id=j.project_id FOR SHARE;
 SELECT * INTO j FROM generation_jobs WHERE id=wanted FOR UPDATE;
 SELECT * INTO p FROM generation_plans WHERE id=j.plan_id;
 SELECT * INTO c FROM generation_capabilities WHERE id=p.capability_id FOR UPDATE;
 IF j.status <> 'queued' THEN
  IF j.status='dispatching' AND EXISTS(SELECT 1 FROM generation_attempts WHERE job_id=j.id AND deadline<now()) THEN
   UPDATE generation_jobs SET status='submission_unknown',error_code='SUBMISSION_UNKNOWN',revision=revision+1,updated_at=now() WHERE id=j.id;
  END IF;
  RETURN NULL;
 END IF;
 prior_actor:=current_setting('app.user_id',true); prior_tenant:=current_setting('app.tenant_id',true);
 PERFORM set_config('app.user_id',j.created_by::text,true),set_config('app.tenant_id',j.tenant_id::text,true);
 IF project_role(j.project_id) IS NULL OR NOT EXISTS(SELECT 1 FROM projects WHERE id=j.project_id AND status='active') OR NOT c.enabled OR c.revision<>p.capability_revision OR c.connection_version_id<>p.connection_version_id THEN
  UPDATE generation_jobs SET status='cancelled',error_code='EXECUTION_AUTHORITY_CHANGED',revision=revision+1,updated_at=now() WHERE id=j.id;
  DELETE FROM generation_work WHERE job_id=j.id;
  PERFORM set_config('app.user_id',coalesce(prior_actor,''),true),set_config('app.tenant_id',coalesce(prior_tenant,''),true);
  RETURN NULL;
 END IF;
 IF p.input ? 'canvasSources' AND (NOT canvas_assistance_access(j.tenant_id,j.project_id,p.resolved_input) OR CASE WHEN p.input->'assistance'->>'kind'='discuss' THEN discussion_canvas_scope(j.tenant_id,j.project_id,(p.input->'assistance'->>'canvasId')::uuid,true) IS DISTINCT FROM p.resolved_input->'canvasScope' ELSE NOT EXISTS(SELECT 1 FROM generation_capabilities target WHERE target.id=p.target_capability_id AND target.enabled AND target.revision=(p.input->'assistance'->>'targetCapabilityRevision')::bigint AND target.connection_version_id=(p.resolved_input->>'targetConnectionVersionId')::uuid) END) THEN
  UPDATE generation_jobs SET status='cancelled',error_code='EXECUTION_SOURCE_UNAVAILABLE',revision=revision+1,updated_at=now() WHERE id=j.id;
  DELETE FROM generation_work WHERE job_id=j.id;
  PERFORM set_config('app.user_id',coalesce(prior_actor,''),true),set_config('app.tenant_id',coalesce(prior_tenant,''),true);
  RETURN NULL;
 END IF;
 IF p.input->'assistance'->>'kind'='prepare_rework' AND NOT rework_source_current(p.id) THEN
  UPDATE generation_jobs SET status='cancelled',error_code='REWORK_SOURCE_CHANGED',revision=revision+1,updated_at=now() WHERE id=j.id;
  DELETE FROM generation_work WHERE job_id=j.id;
  PERFORM set_config('app.user_id',coalesce(prior_actor,''),true),set_config('app.tenant_id',coalesce(prior_tenant,''),true);
  RETURN NULL;
 END IF;
 IF p.input->>'purpose' IN ('image','video','audio') AND (EXISTS(
  SELECT 1 FROM jsonb_array_elements(p.resolved_input->'references') item LEFT JOIN media m ON m.id=(item->'reference'->>'mediaId')::uuid AND m.tenant_id=j.tenant_id
  WHERE m.id IS NULL OR m.status<>'ready' OR (m.project_id IS NOT NULL AND m.project_id<>j.project_id)
   OR (item->'reference' ? 'assetRevisionId' AND (NOT asset_revision_usable(j.tenant_id,j.project_id,(item->'reference'->>'assetRevisionId')::uuid,false) OR NOT EXISTS(SELECT 1 FROM asset_revision_media arm WHERE arm.tenant_id=j.tenant_id AND arm.asset_revision_id=(item->'reference'->>'assetRevisionId')::uuid AND arm.media_id=m.id)))
   OR (item->'reference' ? 'subjectAssetId' AND NOT asset_identity_usable(j.tenant_id,j.project_id,(item->'reference'->>'subjectAssetId')::uuid,false))
 ) OR (p.input->>'purpose'='audio' AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.resolved_input->'dependencies') dep WHERE dep->>'kind'='asset_revision' AND NOT asset_revision_usable(j.tenant_id,j.project_id,(dep->>'objectId')::uuid,false)))) THEN
  UPDATE generation_jobs SET status='cancelled',error_code='EXECUTION_SOURCE_UNAVAILABLE',revision=revision+1,updated_at=now() WHERE id=j.id;
  DELETE FROM generation_work WHERE job_id=j.id;
  PERFORM set_config('app.user_id',coalesce(prior_actor,''),true),set_config('app.tenant_id',coalesce(prior_tenant,''),true);
  RETURN NULL;
 END IF;
 PERFORM set_config('app.user_id',coalesce(prior_actor,''),true),set_config('app.tenant_id',coalesce(prior_tenant,''),true);
 -- Unknown attempts count against the cap indefinitely; timeout never frees a paid slot.
 IF (SELECT count(*) FROM generation_jobs x JOIN generation_plans xp ON xp.id=x.plan_id WHERE xp.capability_id=c.id AND x.status IN ('dispatching','submission_unknown','provider_pending','provider_running','cancel_requested','reconciliation_required')) >= c.max_inflight THEN RETURN NULL; END IF;
 INSERT INTO generation_attempts(id,job_id,connection_version_id,request_hash,dispatch_token) VALUES(token,j.id,p.connection_version_id,p.input_hash,token) RETURNING * INTO a;
 UPDATE generation_jobs SET status='dispatching',revision=revision+1,updated_at=now() WHERE id=j.id;
 RETURN jsonb_build_object('attemptId',a.id,'jobId',j.id,'connectionVersionId',p.connection_version_id,'requestHash',p.input_hash,'input',p.input,'resolvedInput',p.resolved_input,'executionMode',p.execution_mode);
END $$;

CREATE OR REPLACE FUNCTION guard_canvas_assistance_application() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE p generation_plans; advice jsonb; before_doc jsonb; after_doc jsonb; node jsonb; expected jsonb; desired text; target generation_capabilities; s jsonb; source_node jsonb;
BEGIN
 SELECT plan.* INTO p FROM generation_plans plan JOIN generation_jobs j ON j.plan_id=plan.id JOIN assistance_artifacts a ON a.generation_job_id=j.id JOIN assistance_artifact_revisions r ON r.artifact_id=a.id
  WHERE a.tenant_id=NEW.tenant_id AND a.project_id=NEW.project_id AND a.id=NEW.artifact_id AND r.number=NEW.artifact_revision AND j.status='succeeded';
 SELECT r.body INTO advice FROM assistance_artifact_revisions r WHERE r.tenant_id=NEW.tenant_id AND r.project_id=NEW.project_id AND r.artifact_id=NEW.artifact_id AND r.number=NEW.artifact_revision;
 IF p.id IS NULL OR p.input->'assistance'->>'kind' IS DISTINCT FROM 'prepare_prompt' OR NOT p.input ? 'canvasSources' OR NEW.created_by IS DISTINCT FROM actor_id() OR NOT canvas_assistance_access(NEW.tenant_id,NEW.project_id,p.resolved_input) THEN RAISE EXCEPTION 'Application requires authorized fixed assistance' USING ERRCODE='23514';END IF;
 -- A first application rechecks every explicitly selected source. Receipt reads
 -- and replays remain historical and never re-enter this INSERT trigger.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p.resolved_input->'shots') fixed
  WHERE NOT EXISTS(SELECT 1 FROM shots shot JOIN shot_revisions revision ON revision.shot_id=shot.id
   JOIN scenes scene ON scene.id=shot.scene_id JOIN episodes episode ON episode.id=scene.episode_id
   WHERE shot.tenant_id=NEW.tenant_id AND shot.project_id=NEW.project_id
    AND shot.id=(fixed->>'shotId')::uuid AND revision.id=(fixed->>'shotRevisionId')::uuid
    AND shot.status='active' AND scene.status='active' AND episode.status='active'))
 THEN RAISE EXCEPTION 'Selected shot source is unavailable before application' USING ERRCODE='23514';END IF;
 SELECT * INTO target FROM generation_capabilities WHERE id=p.target_capability_id;
 SELECT b.document INTO before_doc FROM canvas_revisions r JOIN canvas_history_bodies b ON b.canvas_id=r.canvas_id AND b.hash=r.body_hash WHERE r.canvas_id=NEW.canvas_id AND r.revision=NEW.base_revision;
 SELECT b.document INTO after_doc FROM canvases c JOIN canvas_revisions r ON r.canvas_id=c.id AND r.revision=c.revision JOIN canvas_history_bodies b ON b.canvas_id=r.canvas_id AND b.hash=r.body_hash WHERE c.tenant_id=NEW.tenant_id AND c.project_id=NEW.project_id AND c.id=NEW.canvas_id AND c.revision=NEW.result_revision;
 SELECT n INTO node FROM jsonb_array_elements(before_doc->'nodes') n WHERE (n->>'id')::uuid=NEW.node_id;
 -- The target has already been appended. For sources in that canvas compare the
 -- declared base, and for other canvases compare their current selected contents.
 FOR s IN SELECT value FROM jsonb_array_elements(p.resolved_input->'canvasSnapshots') LOOP
  IF (s->'source'->>'canvasId')::uuid=NEW.canvas_id THEN
   SELECT n INTO source_node FROM jsonb_array_elements(before_doc->'nodes') n WHERE (n->>'id')::uuid=(s->'source'->>'nodeId')::uuid;
   IF source_node IS NULL OR source_node->'kind' IS DISTINCT FROM s->'kind' OR source_node->'content' IS DISTINCT FROM s->'content' THEN RAISE EXCEPTION 'Selected canvas source changed before application' USING ERRCODE='23514';END IF;
  ELSIF canvas_assistance_snapshot(NEW.tenant_id,NEW.project_id,s->'source',false) IS DISTINCT FROM s THEN RAISE EXCEPTION 'Selected canvas source changed before application' USING ERRCODE='23514';END IF;
 END LOOP;
 desired:=CASE NEW.mode WHEN 'replace' THEN advice->>'prompt' ELSE concat_ws(E'\n\n',nullif(NEW.before_prompt,''),nullif(advice->>'prompt','')) END;
 SELECT jsonb_set(before_doc,'{nodes}',jsonb_agg(CASE WHEN (n->>'id')::uuid=NEW.node_id THEN jsonb_set(n,'{content,prompt}',to_jsonb(desired)) ELSE n END ORDER BY ord)) INTO expected FROM jsonb_array_elements(before_doc->'nodes') WITH ORDINALITY v(n,ord);
 IF before_doc IS NULL OR after_doc IS NULL OR node IS NULL OR node->'content'->>'type'<>'draft' OR node->'content'->>'prompt' IS DISTINCT FROM NEW.before_prompt
  OR NEW.after_prompt IS DISTINCT FROM desired OR after_doc IS DISTINCT FROM expected OR NOT target.enabled
  OR target.revision<>(p.input->'assistance'->>'targetCapabilityRevision')::bigint OR target.connection_version_id<>(p.resolved_input->>'targetConnectionVersionId')::uuid
  OR node->>'kind' IS DISTINCT FROM target.definition->>'purpose' OR (node->'content'->>'capabilityId')::uuid IS DISTINCT FROM target.id OR (node->'content'->>'connectionId')::uuid IS DISTINCT FROM target.connection_id
 THEN RAISE EXCEPTION 'Application must preserve exact base and change only the target prompt' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION guard_discussion_artifact() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE kind text;
BEGIN
 SELECT p.input->'assistance'->>'kind' INTO kind FROM assistance_artifacts a JOIN generation_jobs j ON j.id=a.generation_job_id JOIN generation_plans p ON p.id=j.plan_id WHERE a.id=NEW.artifact_id;
 IF kind='discuss' THEN
  IF NEW.number<>1 OR NEW.edited_by IS NOT NULL OR jsonb_typeof(NEW.body->'message') IS DISTINCT FROM 'string'
   OR length(btrim(NEW.body->>'message')) NOT BETWEEN 1 AND 20000
   OR NEW.body IS DISTINCT FROM jsonb_build_object('message',NEW.body->'message','prompt','','notes','','referenceSuggestions','[]'::jsonb,'retain','[]'::jsonb,'change','[]'::jsonb)
  THEN RAISE EXCEPTION 'Discussion is an immutable text reply, not applied media instructions' USING ERRCODE='23514';END IF;
 ELSIF NEW.body ? 'message' THEN RAISE EXCEPTION 'Only discussion has a message body' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER discussion_artifact BEFORE INSERT ON assistance_artifact_revisions FOR EACH ROW EXECUTE FUNCTION guard_discussion_artifact();
REVOKE ALL ON generation_assistance_scopes FROM PUBLIC;
REVOKE ALL ON FUNCTION discussion_canvas_scope(uuid,uuid,uuid,boolean),guard_discussion_scope(),guard_discussion_scope_ready(),guard_discussion_plan(),guard_discussion_artifact() FROM PUBLIC;

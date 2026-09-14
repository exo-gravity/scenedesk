-- Explicit canvas node context does not invent a shot or implicitly traverse edges.
ALTER TABLE generation_plans DROP CONSTRAINT generation_plans_input_check;
ALTER TABLE generation_plans ADD CONSTRAINT generation_plans_input_check CHECK(((input->>'purpose'='script_analysis' AND input->'proposalTarget'->>'mode'='append_to_scene') OR (input->>'purpose'='creative_assistance' AND input->'assistance'->>'kind' IN ('prepare_prompt','prepare_rework') AND (jsonb_array_length(input->'shotSources') BETWEEN 1 AND 100 OR (input->'assistance'->>'kind'='prepare_prompt' AND jsonb_array_length(input->'canvasSources') BETWEEN 1 AND 20))) OR input->>'purpose' IN ('image','video','audio')) IS TRUE);

CREATE TABLE generation_canvas_contexts (
 tenant_id uuid NOT NULL,project_id uuid NOT NULL,plan_id uuid NOT NULL,position integer NOT NULL CHECK(position BETWEEN 0 AND 19),
 canvas_id uuid NOT NULL,node_id uuid NOT NULL,canvas_revision bigint NOT NULL CHECK(canvas_revision>0),snapshot jsonb NOT NULL,
 media_id uuid GENERATED ALWAYS AS ((snapshot->'content'->>'mediaId')::uuid) STORED,
 asset_revision_id uuid GENERATED ALWAYS AS ((snapshot->'content'->>'assetRevisionId')::uuid) STORED,
 PRIMARY KEY(plan_id,position),UNIQUE(plan_id,node_id),
 FOREIGN KEY(tenant_id,project_id,plan_id) REFERENCES generation_plans(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,canvas_id,node_id) REFERENCES canvas_node_index(tenant_id,project_id,canvas_id,node_id),
 FOREIGN KEY(tenant_id,media_id) REFERENCES media(tenant_id,id),
 FOREIGN KEY(tenant_id,asset_revision_id) REFERENCES asset_revisions(tenant_id,id)
);
ALTER TABLE generation_canvas_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_canvas_contexts FORCE ROW LEVEL SECURITY;
CREATE POLICY canvas_context_scope ON generation_canvas_contexts USING(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL) WITH CHECK(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL);
CREATE TRIGGER canvas_context_fixed BEFORE UPDATE OR DELETE ON generation_canvas_contexts FOR EACH ROW EXECUTE FUNCTION protect_content_revision();

-- A snapshot outlives finite canvas history. Its original revision is evidence, not a history pin.
CREATE FUNCTION canvas_assistance_snapshot(t uuid,p uuid,source jsonb,check_version boolean) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
DECLARE c canvases; node jsonb; contents jsonb;
BEGIN
 SELECT canvas.* INTO c FROM canvases canvas JOIN scene_canvas_links l ON l.canvas_id=canvas.id JOIN scenes s ON s.id=l.scene_id JOIN episodes e ON e.id=s.episode_id
 WHERE canvas.tenant_id=t AND canvas.project_id=p AND canvas.id=(source->>'canvasId')::uuid AND s.status='active' AND e.status='active';
 IF c.id IS NULL OR (check_version AND c.revision<>(source->>'canvasRevision')::bigint) THEN RETURN NULL;END IF;
 SELECT n INTO node FROM canvas_revisions r JOIN canvas_history_bodies b ON b.canvas_id=r.canvas_id AND b.hash=r.body_hash CROSS JOIN LATERAL jsonb_array_elements(b.document->'nodes') n
 WHERE r.canvas_id=c.id AND r.revision=c.revision AND (n->>'id')::uuid=(source->>'nodeId')::uuid;
 IF node IS NULL OR (node->'content'->>'type'='media' AND (NOT source ? 'purpose' OR source->>'purpose' NOT IN ('identity','look','location','action','composition','style','voice','start_frame','end_frame','prop')))
 OR (node->'content'->>'type'<>'media' AND source ? 'purpose') THEN RETURN NULL;END IF;
 contents:=jsonb_build_object('kind',node->'kind','content',node->'content');
 RETURN contents || jsonb_build_object('source',source,'contentHash',encode(sha256(convert_to(creative_canonical(contents),'UTF8')),'hex'));
END $$;

CREATE FUNCTION canvas_assistance_access(t uuid,p uuid,resolved jsonb) RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(resolved->'canvasSnapshots','[]')) s
  WHERE NOT EXISTS(SELECT 1 FROM canvases c WHERE c.tenant_id=t AND c.project_id=p AND c.id=(s->'source'->>'canvasId')::uuid)
   OR (s->'content'->>'type'='media' AND NOT EXISTS(SELECT 1 FROM media m WHERE m.tenant_id=t AND m.id=(s->'content'->>'mediaId')::uuid AND m.status='ready' AND (m.project_id IS NULL OR m.project_id=p)
    AND (NOT s->'content' ? 'assetRevisionId' OR (asset_revision_usable(t,p,(s->'content'->>'assetRevisionId')::uuid,false) AND EXISTS(SELECT 1 FROM asset_revision_media a WHERE a.tenant_id=t AND a.asset_revision_id=(s->'content'->>'assetRevisionId')::uuid AND a.media_id=m.id))))))
$$;

CREATE FUNCTION guard_canvas_assistance_plan() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE source jsonb; fixed jsonb; expected jsonb:='[]'; refs jsonb:='[]'; deps jsonb:='[]'; shot jsonb; r jsonb; target generation_capabilities; actual generation_capabilities;
BEGIN
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
  FOR r IN SELECT value FROM shot_revisions sr CROSS JOIN LATERAL jsonb_array_elements(sr.spec->'references') WHERE sr.tenant_id=NEW.tenant_id AND sr.project_id=NEW.project_id AND sr.id=(shot->>'shotRevisionId')::uuid AND sr.shot_id=(shot->>'shotId')::uuid LOOP
   refs:=refs||jsonb_build_array(jsonb_build_object('sourceLevel','shot','sourceObjectId',(shot->>'shotRevisionId')::uuid,'shotId',(shot->>'shotId')::uuid,'reference',r));
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
 SELECT * INTO target FROM generation_capabilities WHERE tenant_id=NEW.tenant_id AND id=NEW.target_capability_id;
 SELECT * INTO actual FROM generation_capabilities WHERE tenant_id=NEW.tenant_id AND id=NEW.capability_id;
 IF target.id IS NULL OR NOT target.enabled OR target.definition->>'purpose' NOT IN ('image','video','audio') OR target.revision<>(NEW.input->'assistance'->>'targetCapabilityRevision')::bigint
  OR NEW.resolved_input->>'targetConnectionVersionId' IS DISTINCT FROM target.connection_version_id::text
  OR NEW.resolved_input->'targetCapabilitySnapshot' IS DISTINCT FROM (target.definition||jsonb_build_object('id',target.id,'connectionId',target.connection_id,'revision',target.revision,'enabled',target.enabled,'executionMode',target.execution_mode))
  OR NEW.resolved_input->'canvasSnapshots' IS DISTINCT FROM expected OR NEW.resolved_input->'references' IS DISTINCT FROM refs
  OR (SELECT coalesce(jsonb_agg(d ORDER BY ord),'[]') FROM jsonb_array_elements(NEW.resolved_input->'dependencies') WITH ORDINALITY v(d,ord) WHERE d->>'kind'='canvas_node') IS DISTINCT FROM deps
  OR NOT canvas_assistance_access(NEW.tenant_id,NEW.project_id,NEW.resolved_input)
  OR NEW.input_hash IS DISTINCT FROM rework_input_hash(NEW.input,NEW.resolved_input,NEW.capability_revision,NEW.connection_version_id)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(refs) r WHERE NOT (target.definition->'supportedPurposes' ? (r->'reference'->>'purpose')) OR NOT (actual.definition->'supportedPurposes' ? (r->'reference'->>'purpose')))
  OR jsonb_array_length(refs)>coalesce((target.definition->>'maxReferences')::integer,100)
  OR jsonb_array_length(refs)>coalesce((actual.definition->>'maxReferences')::integer,100)
 THEN RAISE EXCEPTION 'Fixed canvas snapshot, input hash, authority or target differs' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER canvas_assistance_plan BEFORE INSERT ON generation_plans FOR EACH ROW EXECUTE FUNCTION guard_canvas_assistance_plan();
CREATE FUNCTION guard_canvas_assistance_projection() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM generation_plans p WHERE p.id=NEW.plan_id AND p.tenant_id=NEW.tenant_id AND p.project_id=NEW.project_id
  AND p.resolved_input->'canvasSnapshots'->NEW.position=NEW.snapshot
  AND (NEW.snapshot->'source'->>'canvasId')::uuid=NEW.canvas_id AND (NEW.snapshot->'source'->>'nodeId')::uuid=NEW.node_id
  AND (NEW.snapshot->'source'->>'canvasRevision')::bigint=NEW.canvas_revision) THEN RAISE EXCEPTION 'Canvas source projection differs' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER canvas_assistance_projection BEFORE INSERT ON generation_canvas_contexts FOR EACH ROW EXECUTE FUNCTION guard_canvas_assistance_projection();
CREATE FUNCTION guard_canvas_assistance_ready() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF (SELECT count(*) FROM generation_canvas_contexts WHERE plan_id=NEW.id)<>jsonb_array_length(coalesce(NEW.input->'canvasSources','[]')) THEN RAISE EXCEPTION 'Canvas source projection missing' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER canvas_assistance_ready AFTER INSERT ON generation_plans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_canvas_assistance_ready();
CREATE FUNCTION guard_canvas_assistance_job() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE p generation_plans; s jsonb;
BEGIN
 SELECT * INTO p FROM generation_plans WHERE id=NEW.plan_id;
 IF NOT p.input ? 'canvasSources' THEN RETURN NEW;END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p.resolved_input->'canvasSnapshots') LOOP
  IF canvas_assistance_snapshot(p.tenant_id,p.project_id,s->'source',false) IS DISTINCT FROM s THEN RAISE EXCEPTION 'Canvas selected contents changed before execution' USING ERRCODE='23514';END IF;
 END LOOP;
 IF NOT canvas_assistance_access(p.tenant_id,p.project_id,p.resolved_input) OR NOT EXISTS(SELECT 1 FROM generation_capabilities c WHERE c.id=p.target_capability_id AND c.enabled AND c.revision=(p.input->'assistance'->>'targetCapabilityRevision')::bigint AND c.connection_version_id=(p.resolved_input->>'targetConnectionVersionId')::uuid) THEN RAISE EXCEPTION 'Canvas context or target unavailable before execution' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER canvas_assistance_job BEFORE INSERT ON generation_jobs FOR EACH ROW EXECUTE FUNCTION guard_canvas_assistance_job();

CREATE TABLE canvas_assistance_applications (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,project_id uuid NOT NULL,canvas_id uuid NOT NULL,node_id uuid NOT NULL,
 artifact_id uuid NOT NULL,artifact_revision bigint NOT NULL,mode text NOT NULL CHECK(mode IN ('replace','append')),
 base_revision bigint NOT NULL CHECK(base_revision>0),result_revision bigint NOT NULL CHECK(result_revision=base_revision+1),
 before_prompt text NOT NULL CHECK(length(before_prompt)<=20000),after_prompt text NOT NULL CHECK(length(after_prompt)<=20000),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id,canvas_id,node_id) REFERENCES canvas_node_index(tenant_id,project_id,canvas_id,node_id),
 FOREIGN KEY(tenant_id,project_id,artifact_id,artifact_revision) REFERENCES assistance_artifact_revisions(tenant_id,project_id,artifact_id,number)
);
ALTER TABLE canvas_assistance_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_assistance_applications FORCE ROW LEVEL SECURITY;
CREATE POLICY canvas_application_scope ON canvas_assistance_applications USING(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL) WITH CHECK(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL);
CREATE TRIGGER canvas_application_fixed BEFORE UPDATE OR DELETE ON canvas_assistance_applications FOR EACH ROW EXECUTE FUNCTION protect_content_revision();
CREATE FUNCTION guard_canvas_assistance_application() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE p generation_plans; advice jsonb; before_doc jsonb; after_doc jsonb; node jsonb; expected jsonb; desired text; target generation_capabilities; s jsonb; source_node jsonb;
BEGIN
 SELECT plan.* INTO p FROM generation_plans plan JOIN generation_jobs j ON j.plan_id=plan.id JOIN assistance_artifacts a ON a.generation_job_id=j.id JOIN assistance_artifact_revisions r ON r.artifact_id=a.id
  WHERE a.tenant_id=NEW.tenant_id AND a.project_id=NEW.project_id AND a.id=NEW.artifact_id AND r.number=NEW.artifact_revision AND j.status='succeeded';
 SELECT r.body INTO advice FROM assistance_artifact_revisions r WHERE r.tenant_id=NEW.tenant_id AND r.project_id=NEW.project_id AND r.artifact_id=NEW.artifact_id AND r.number=NEW.artifact_revision;
 IF p.id IS NULL OR NOT p.input ? 'canvasSources' OR NEW.created_by IS DISTINCT FROM actor_id() OR NOT canvas_assistance_access(NEW.tenant_id,NEW.project_id,p.resolved_input) THEN RAISE EXCEPTION 'Application requires authorized fixed assistance' USING ERRCODE='23514';END IF;
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
CREATE TRIGGER canvas_application_valid BEFORE INSERT ON canvas_assistance_applications FOR EACH ROW EXECUTE FUNCTION guard_canvas_assistance_application();
REVOKE ALL ON generation_canvas_contexts,canvas_assistance_applications FROM PUBLIC;
REVOKE ALL ON FUNCTION canvas_assistance_snapshot(uuid,uuid,jsonb,boolean),canvas_assistance_access(uuid,uuid,jsonb),guard_canvas_assistance_plan(),guard_canvas_assistance_projection(),guard_canvas_assistance_ready(),guard_canvas_assistance_job(),guard_canvas_assistance_application() FROM PUBLIC;

-- Fixed text survives editing after execute; current media/asset access still gates first dispatch.
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
 IF p.input ? 'canvasSources' AND (NOT canvas_assistance_access(j.tenant_id,j.project_id,p.resolved_input) OR NOT EXISTS(SELECT 1 FROM generation_capabilities target WHERE target.id=p.target_capability_id AND target.enabled AND target.revision=(p.input->'assistance'->>'targetCapabilityRevision')::bigint AND target.connection_version_id=(p.resolved_input->>'targetConnectionVersionId')::uuid)) THEN
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

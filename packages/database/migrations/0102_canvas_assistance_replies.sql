-- Explicit prior assistant turns are immutable context, never an automatic reference merge.
CREATE FUNCTION canvas_assistance_direct_access(t uuid,p uuid,resolved jsonb) RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(resolved->'canvasSnapshots','[]')) s WHERE NOT EXISTS(SELECT 1 FROM canvases c WHERE c.tenant_id=t AND c.project_id=p AND c.id=(s->'source'->>'canvasId')::uuid))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(resolved->'references') r WHERE NOT EXISTS(SELECT 1 FROM media m WHERE m.tenant_id=t AND m.id=(r->'reference'->>'mediaId')::uuid AND m.status='ready' AND (m.project_id IS NULL OR m.project_id=p)
  AND (NOT r->'reference' ? 'assetRevisionId' OR (asset_revision_usable(t,p,(r->'reference'->>'assetRevisionId')::uuid,false) AND EXISTS(SELECT 1 FROM asset_revision_media a WHERE a.tenant_id=t AND a.asset_revision_id=(r->'reference'->>'assetRevisionId')::uuid AND a.media_id=m.id)))
  AND (NOT r->'reference' ? 'subjectAssetId' OR asset_identity_usable(t,p,(r->'reference'->>'subjectAssetId')::uuid,false))))
$$;

CREATE FUNCTION canvas_assistance_reply_snapshot(t uuid,p uuid,source jsonb) RETURNS jsonb LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT jsonb_build_object('body',r.body,'instruction',plan.input->'prompt',
  'targetCapabilityId',(plan.input->'assistance'->>'targetCapabilityId')::uuid,
  'targetCapabilityRevision',(plan.input->'assistance'->>'targetCapabilityRevision')::bigint,
  'dependency',jsonb_build_object('kind','assistance_artifact','objectId',a.id,'revision',r.number,'tracking','fixed',
   'contentHash',encode(sha256(convert_to(creative_canonical(jsonb_build_object('artifactId',a.id,'revision',r.number,'instruction',plan.input->'prompt','body',r.body)),'UTF8')),'hex')))
 FROM assistance_artifacts a JOIN assistance_artifact_revisions r ON r.artifact_id=a.id
 JOIN generation_jobs j ON j.id=a.generation_job_id JOIN generation_plans plan ON plan.id=j.plan_id
 WHERE a.tenant_id=t AND a.project_id=p AND a.id=(source->>'artifactId')::uuid AND r.number=(source->>'revision')::bigint
  AND j.status='succeeded' AND plan.input ? 'canvasSources' AND plan.input->'assistance'->>'kind'='prepare_prompt'
$$;

-- Follow immutable reply identities without upgrading revisions. Each historic
-- source retains its current media/asset permissions, including earlier turns.
CREATE FUNCTION canvas_assistance_reply_access(t uuid,p uuid,source jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
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
  IF previous.status<>'succeeded' OR NOT previous.input ? 'canvasSources' OR previous.input->'assistance'->>'kind'<>'prepare_prompt'
   OR NOT canvas_assistance_direct_access(t,p,previous.resolved_input) THEN RETURN false;END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('reference',r)),'[]') INTO advice_refs FROM jsonb_array_elements(previous.body->'referenceSuggestions') r;
  IF NOT canvas_assistance_direct_access(t,p,jsonb_build_object('references',advice_refs)) THEN RETURN false;END IF;
  wanted:=previous.input->'assistanceSource';
 END LOOP;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION canvas_assistance_access(t uuid,p uuid,resolved jsonb) RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT canvas_assistance_direct_access(t,p,resolved) AND NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(resolved->'dependencies') d WHERE d->>'kind'='assistance_artifact'
   AND NOT canvas_assistance_reply_access(t,p,jsonb_build_object('artifactId',d->'objectId','revision',d->'revision')))
$$;

CREATE OR REPLACE FUNCTION guard_canvas_assistance_plan() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE reply jsonb; source jsonb; fixed jsonb; expected jsonb:='[]'; refs jsonb:='[]'; deps jsonb:='[]'; shot jsonb; reference_value jsonb; target generation_capabilities; actual generation_capabilities;
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
REVOKE ALL ON FUNCTION guard_canvas_assistance_plan() FROM PUBLIC;

REVOKE ALL ON FUNCTION canvas_assistance_direct_access(uuid,uuid,jsonb),canvas_assistance_reply_snapshot(uuid,uuid,jsonb),canvas_assistance_reply_access(uuid,uuid,jsonb) FROM PUBLIC;

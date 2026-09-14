-- Preserve every explicitly linked prior exchange; never silently summarize or truncate.
CREATE FUNCTION canvas_discussion_history(t uuid,p uuid,source jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
DECLARE wanted jsonb:=source; previous record; turns jsonb:='[]'; deps jsonb:='[]'; visited uuid[]:='{}'; selected_canvas uuid; identity uuid; fixed jsonb;
BEGIN
 WHILE wanted IS NOT NULL LOOP
  IF jsonb_array_length(turns)>=20 THEN RETURN jsonb_build_object('limitExceeded',true);END IF;
  identity:=(wanted->>'artifactId')::uuid;
  IF identity IS NULL OR identity=ANY(visited) THEN RETURN NULL;END IF;
  visited:=array_append(visited,identity);
  SELECT plan.input,plan.resolved_input,a.id,r.number,r.body INTO previous FROM assistance_artifacts a
   JOIN assistance_artifact_revisions r ON r.artifact_id=a.id JOIN generation_jobs j ON j.id=a.generation_job_id JOIN generation_plans plan ON plan.id=j.plan_id
   WHERE a.tenant_id=t AND a.project_id=p AND a.id=identity AND r.number=(wanted->>'revision')::bigint
    AND j.status='succeeded' AND plan.input->'assistance'->>'kind'='discuss';
  IF NOT FOUND THEN RETURN NULL;END IF;
  IF selected_canvas IS NULL THEN selected_canvas:=(previous.input->'assistance'->>'canvasId')::uuid;END IF;
  IF (previous.input->'assistance'->>'canvasId')::uuid IS DISTINCT FROM selected_canvas THEN RETURN NULL;END IF;
  fixed:=canvas_assistance_reply_snapshot(t,p,wanted);
  IF fixed IS NULL THEN RETURN NULL;END IF;
  turns:=jsonb_build_array(jsonb_build_object('source',jsonb_build_object('artifactId',previous.id,'revision',previous.number),'instruction',previous.input->'prompt','message',previous.body->'message'))||turns;
  deps:=jsonb_build_array(fixed->'dependency')||deps;
  wanted:=previous.input->'assistanceSource';
 END LOOP;
 RETURN jsonb_build_object('turns',turns,'dependencies',deps);
END $$;

CREATE OR REPLACE FUNCTION guard_discussion_plan() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE actual generation_capabilities; source jsonb; fixed jsonb; refs jsonb:='[]'; deps jsonb:='[]'; snapshots jsonb:='[]'; expected jsonb; scope jsonb; reply jsonb; history jsonb;
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
  history:=canvas_discussion_history(NEW.tenant_id,NEW.project_id,NEW.input->'assistanceSource');
  IF history IS NULL OR history->>'limitExceeded'='true' THEN RAISE EXCEPTION 'Discussion history exceeds its explicit bound' USING ERRCODE='23514';END IF;
  expected:=expected||jsonb_build_object('assistanceSnapshot',reply->'body','assistanceInstruction',reply->'instruction','assistanceHistory',history->'turns','dependencies',deps||(history->'dependencies'));
 END IF;
 IF NEW.resolved_input IS DISTINCT FROM expected OR octet_length(convert_to(creative_canonical(expected),'UTF8'))>100000
  OR NOT canvas_assistance_access(NEW.tenant_id,NEW.project_id,expected)
  OR NOT canvas_assistance_references_supported(NEW.tenant_id,NEW.project_id,refs,actual.definition)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(refs) r WHERE NOT (actual.definition->'supportedPurposes' ? (r->'reference'->>'purpose')))
  OR jsonb_array_length(refs)>coalesce((actual.definition->>'maxReferences')::integer,100)
  OR NEW.input_hash IS DISTINCT FROM rework_input_hash(NEW.input,NEW.resolved_input,NEW.capability_revision,NEW.connection_version_id)
 THEN RAISE EXCEPTION 'Discussion fixed projection or hash differs' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION canvas_discussion_history(uuid,uuid,jsonb),guard_discussion_plan() FROM PUBLIC;

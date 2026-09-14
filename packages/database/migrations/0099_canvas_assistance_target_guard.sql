-- BEFORE INSERT reads the input: generated target columns are not populated yet.
-- The local reference variable must not shadow the JSON element alias.
CREATE OR REPLACE FUNCTION guard_canvas_assistance_plan() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE source jsonb; fixed jsonb; expected jsonb:='[]'; refs jsonb:='[]'; deps jsonb:='[]'; shot jsonb; reference_value jsonb; target generation_capabilities; actual generation_capabilities;
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
 SELECT * INTO target FROM generation_capabilities WHERE tenant_id=NEW.tenant_id AND id=(NEW.input->'assistance'->>'targetCapabilityId')::uuid;
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
REVOKE ALL ON FUNCTION guard_canvas_assistance_plan() FROM PUBLIC;

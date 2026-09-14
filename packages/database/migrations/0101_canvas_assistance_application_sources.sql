-- Keep mixed canvas/shot applications consistent with the original fixed-input freshness check.
CREATE OR REPLACE FUNCTION guard_canvas_assistance_application() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE p generation_plans; advice jsonb; before_doc jsonb; after_doc jsonb; node jsonb; expected jsonb; desired text; target generation_capabilities; s jsonb; source_node jsonb;
BEGIN
 SELECT plan.* INTO p FROM generation_plans plan JOIN generation_jobs j ON j.plan_id=plan.id JOIN assistance_artifacts a ON a.generation_job_id=j.id JOIN assistance_artifact_revisions r ON r.artifact_id=a.id
  WHERE a.tenant_id=NEW.tenant_id AND a.project_id=NEW.project_id AND a.id=NEW.artifact_id AND r.number=NEW.artifact_revision AND j.status='succeeded';
 SELECT r.body INTO advice FROM assistance_artifact_revisions r WHERE r.tenant_id=NEW.tenant_id AND r.project_id=NEW.project_id AND r.artifact_id=NEW.artifact_id AND r.number=NEW.artifact_revision;
 IF p.id IS NULL OR NOT p.input ? 'canvasSources' OR NEW.created_by IS DISTINCT FROM actor_id() OR NOT canvas_assistance_access(NEW.tenant_id,NEW.project_id,p.resolved_input) THEN RAISE EXCEPTION 'Application requires authorized fixed assistance' USING ERRCODE='23514';END IF;
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
REVOKE ALL ON FUNCTION guard_canvas_assistance_application() FROM PUBLIC;

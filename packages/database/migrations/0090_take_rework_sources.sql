-- A rework plan fixes a real Take comment revision. It never changes that comment or Take.
ALTER TABLE generation_plans DROP CONSTRAINT generation_plans_input_check;
ALTER TABLE generation_plans ADD CONSTRAINT generation_plans_input_check CHECK(((input->>'purpose'='script_analysis' AND input->'proposalTarget'->>'mode'='append_to_scene') OR (input->>'purpose'='creative_assistance' AND input->'assistance'->>'kind' IN ('prepare_prompt','prepare_rework') AND jsonb_array_length(input->'shotSources') BETWEEN 1 AND 100) OR (input->>'purpose' IN ('image','video','audio'))) IS TRUE);

CREATE TABLE generation_rework_inputs (
 tenant_id uuid NOT NULL, project_id uuid NOT NULL, plan_id uuid PRIMARY KEY,
 review_id uuid NOT NULL, comment_id uuid NOT NULL, comment_revision bigint NOT NULL,
 take_id uuid NOT NULL, shot_id uuid NOT NULL, shot_revision_id uuid NOT NULL,
 FOREIGN KEY(tenant_id,project_id,plan_id) REFERENCES generation_plans(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,review_id,comment_id,comment_revision) REFERENCES review_comment_revisions(tenant_id,project_id,review_id,comment_id,number),
 FOREIGN KEY(tenant_id,project_id,take_id) REFERENCES takes(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,shot_id,shot_revision_id) REFERENCES shot_revisions(tenant_id,project_id,shot_id,id)
);
ALTER TABLE generation_rework_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_rework_inputs FORCE ROW LEVEL SECURITY;
CREATE POLICY generation_rework_scope ON generation_rework_inputs USING(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL) WITH CHECK(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL);
CREATE TRIGGER generation_rework_fixed BEFORE UPDATE OR DELETE ON generation_rework_inputs FOR EACH ROW EXECUTE FUNCTION protect_content_revision();

-- Only creative-rework/1 uses this canonical JSONB serializer. Existing plan hashes stay unchanged.
CREATE FUNCTION rework_input_hash(input jsonb,resolved jsonb,capability_revision bigint,connection_version_id uuid) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path FROM CURRENT AS $$
 SELECT encode(sha256(convert_to(creative_canonical(jsonb_build_object('input',input,'resolved',resolved,'capabilityRevision',capability_revision,'connectionVersionId',connection_version_id)),'UTF8')),'hex')
$$;

CREATE FUNCTION rework_source_current(wanted uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
 SELECT EXISTS(SELECT 1 FROM generation_plans p
  JOIN generation_rework_inputs source ON source.plan_id=p.id AND source.tenant_id=p.tenant_id AND source.project_id=p.project_id
  JOIN reviews r ON r.id=source.review_id AND r.take_id=source.take_id
  JOIN review_comments c ON c.id=source.comment_id AND c.review_id=r.id AND c.revision=source.comment_revision AND NOT c.resolved
  JOIN takes t ON t.id=source.take_id AND t.shot_id=source.shot_id AND t.shot_revision_id=source.shot_revision_id
  JOIN media m ON m.id=t.media_id AND m.tenant_id=p.tenant_id AND m.status='ready' AND m.kind='video' AND (m.project_id IS NULL OR m.project_id=p.project_id)
  JOIN shots s ON s.id=source.shot_id AND s.status='active'
  JOIN scenes scene ON scene.id=s.scene_id AND scene.status='active'
  JOIN episodes episode ON episode.id=scene.episode_id AND episode.status='active'
  JOIN generation_capabilities target ON target.id=p.target_capability_id AND target.tenant_id=p.tenant_id AND target.enabled AND target.revision=(p.input->'assistance'->>'targetCapabilityRevision')::bigint AND target.connection_version_id=(p.resolved_input->>'targetConnectionVersionId')::uuid
  WHERE p.id=wanted AND p.input->'assistance'->>'kind'='prepare_rework')
$$;

CREATE FUNCTION guard_rework_plan() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE fixed jsonb; dependency jsonb; candidate takes; req jsonb:=NEW.input->'assistance';
BEGIN
 IF req->>'kind'='prepare_rework' AND NEW.input->>'purpose' IS DISTINCT FROM 'creative_assistance' THEN RAISE EXCEPTION 'Rework requires creative assistance purpose' USING ERRCODE='23514'; END IF;
 IF NEW.input->>'purpose'<>'creative_assistance' OR req->>'kind' IS DISTINCT FROM 'prepare_rework' THEN
  IF NEW.resolved_input ? 'feedbackSnapshot' OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.resolved_input->'dependencies') d WHERE d->>'kind'='review_comment') THEN RAISE EXCEPTION 'Feedback requires an explicit rework input' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NOT (req ? 'sourceTakeId' AND req->'feedback' ?& ARRAY['reviewId','commentId','commentRevision']) OR req ? 'sourceCutRevisionId' OR NEW.input ? 'assistanceSource' OR jsonb_array_length(NEW.input->'shotSources')<>1 THEN RAISE EXCEPTION 'Rework requires exactly one fixed Take and comment version' USING ERRCODE='23514'; END IF;
 SELECT * INTO candidate FROM takes WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND id=(req->>'sourceTakeId')::uuid;
 IF candidate.id IS NULL OR (NEW.input->'shotSources'->0->>'shotId')::uuid IS DISTINCT FROM candidate.shot_id OR (NEW.input->'shotSources'->0->>'shotRevisionId')::uuid IS DISTINCT FROM candidate.shot_revision_id OR jsonb_array_length(NEW.resolved_input->'shots')<>1 OR (NEW.resolved_input->'shots'->0->>'shotId')::uuid IS DISTINCT FROM candidate.shot_id OR (NEW.resolved_input->'shots'->0->>'shotRevisionId')::uuid IS DISTINCT FROM candidate.shot_revision_id THEN RAISE EXCEPTION 'Rework Take and fixed shot differ' USING ERRCODE='23514'; END IF;
 SELECT jsonb_strip_nulls(jsonb_build_object('reviewId',r.id,'commentId',c.id,'commentRevision',v.number,'body',v.body,'subject',jsonb_build_object('takeId',r.take_id),'startUs',c.start_us,'endUs',c.end_us)) INTO fixed
  FROM reviews r JOIN review_comments c ON c.review_id=r.id AND c.tenant_id=r.tenant_id AND c.project_id=r.project_id JOIN review_comment_revisions v ON v.comment_id=c.id AND v.review_id=r.id AND v.tenant_id=r.tenant_id AND v.project_id=r.project_id
  WHERE r.tenant_id=NEW.tenant_id AND r.project_id=NEW.project_id AND r.take_id=candidate.id AND r.id=(req->'feedback'->>'reviewId')::uuid AND c.id=(req->'feedback'->>'commentId')::uuid AND v.number=(req->'feedback'->>'commentRevision')::bigint;
 dependency:=jsonb_build_object('kind','review_comment','objectId',fixed->'commentId','revision',fixed->'commentRevision','tracking','fixed','contentHash',encode(sha256(convert_to(creative_canonical(fixed),'UTF8')),'hex'));
 IF fixed IS NULL OR NEW.resolved_input->'feedbackSnapshot' IS DISTINCT FROM fixed OR NEW.resolved_input->'assistanceRequest' IS DISTINCT FROM req OR NEW.resolved_input->>'resolverVersion' IS DISTINCT FROM 'creative-rework/1'
  OR (SELECT count(*) FROM jsonb_array_elements(NEW.resolved_input->'dependencies') d WHERE d->>'kind'='review_comment')<>1
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.resolved_input->'dependencies') d WHERE d=dependency)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.resolved_input->'contextSnapshots') s WHERE s->'source'->>'kind'='review_comment')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.input->'contextSources') s WHERE s->>'kind'='review_comment')
  OR NEW.input_hash IS DISTINCT FROM rework_input_hash(NEW.input,NEW.resolved_input,NEW.capability_revision,NEW.connection_version_id)
 THEN RAISE EXCEPTION 'Rework snapshot, dependency or hash differs from fixed source' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rework_plan_source BEFORE INSERT ON generation_plans FOR EACH ROW EXECUTE FUNCTION guard_rework_plan();

CREATE FUNCTION guard_rework_projection() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM generation_plans p WHERE p.id=NEW.plan_id AND p.tenant_id=NEW.tenant_id AND p.project_id=NEW.project_id AND p.input->'assistance'->>'kind'='prepare_rework'
  AND (p.input->'assistance'->>'sourceTakeId')::uuid=NEW.take_id
  AND (p.input->'assistance'->'feedback'->>'reviewId')::uuid=NEW.review_id AND (p.input->'assistance'->'feedback'->>'commentId')::uuid=NEW.comment_id AND (p.input->'assistance'->'feedback'->>'commentRevision')::bigint=NEW.comment_revision
  AND (p.input->'shotSources'->0->>'shotId')::uuid=NEW.shot_id AND (p.input->'shotSources'->0->>'shotRevisionId')::uuid=NEW.shot_revision_id) THEN RAISE EXCEPTION 'Rework projection differs from fixed plan' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rework_projection_valid BEFORE INSERT ON generation_rework_inputs FOR EACH ROW EXECUTE FUNCTION guard_rework_projection();
CREATE FUNCTION guard_rework_ready() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NEW.input->'assistance'->>'kind'='prepare_rework' AND NOT rework_source_current(NEW.id) THEN RAISE EXCEPTION 'Rework source is no longer current or projection is missing' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER rework_plan_ready AFTER INSERT ON generation_plans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_rework_ready();
CREATE FUNCTION guard_rework_job() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM generation_plans WHERE id=NEW.plan_id AND input->'assistance'->>'kind'='prepare_rework') AND NOT rework_source_current(NEW.plan_id) THEN RAISE EXCEPTION 'Rework feedback or source changed before submission' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rework_job_source BEFORE INSERT ON generation_jobs FOR EACH ROW EXECUTE FUNCTION guard_rework_job();
CREATE FUNCTION guard_rework_artifact() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM assistance_artifacts a JOIN generation_jobs j ON j.id=a.generation_job_id JOIN generation_plans p ON p.id=j.plan_id WHERE a.id=NEW.artifact_id AND p.input->'assistance'->>'kind'='prepare_rework') THEN
  IF NOT EXISTS(SELECT 1 FROM assistance_artifacts a JOIN generation_jobs j ON j.id=a.generation_job_id JOIN generation_rework_inputs r ON r.plan_id=j.plan_id WHERE a.id=NEW.artifact_id)
   OR jsonb_typeof(NEW.body->'retain') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.body->'change') IS DISTINCT FROM 'array'
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.body->'retain') v WHERE jsonb_typeof(v)<>'string')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.body->'change') v WHERE jsonb_typeof(v)<>'string') THEN RAISE EXCEPTION 'Rework artifact requires its fixed source and retain/change result' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rework_artifact_source BEFORE INSERT ON assistance_artifact_revisions FOR EACH ROW EXECUTE FUNCTION guard_rework_artifact();
REVOKE ALL ON generation_rework_inputs FROM PUBLIC;
REVOKE ALL ON FUNCTION rework_input_hash(jsonb,jsonb,bigint,uuid),rework_source_current(uuid),guard_rework_plan(),guard_rework_projection(),guard_rework_ready(),guard_rework_job(),guard_rework_artifact() FROM PUBLIC;

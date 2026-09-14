-- A discussion is context for discussion, not a prepared media prompt or an
-- implicit way around the history/source permissions of the conversation.
CREATE FUNCTION guard_discussion_media_source() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 IF NEW.input->>'purpose' IN ('image','video','audio') AND NEW.input ? 'assistanceSource' AND EXISTS(
  SELECT 1 FROM assistance_artifact_revisions r JOIN assistance_artifacts a ON a.id=r.artifact_id
  JOIN generation_jobs j ON j.id=a.generation_job_id JOIN generation_plans p ON p.id=j.plan_id
  WHERE r.tenant_id=NEW.tenant_id AND r.project_id=NEW.project_id
   AND r.artifact_id=(NEW.input->'assistanceSource'->>'artifactId')::uuid AND r.number=(NEW.input->'assistanceSource'->>'revision')::bigint
   AND p.input->'assistance'->>'kind'='discuss')
 THEN RAISE EXCEPTION 'Discussion cannot be a prepared media prompt source' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER discussion_media_source BEFORE INSERT ON generation_plans FOR EACH ROW EXECUTE FUNCTION guard_discussion_media_source();
REVOKE ALL ON FUNCTION guard_discussion_media_source() FROM PUBLIC;

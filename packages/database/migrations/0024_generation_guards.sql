-- Generated projection columns are filled after BEFORE UPDATE triggers.
CREATE OR REPLACE FUNCTION guard_generation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='generation_plans' THEN
  IF (to_jsonb(NEW)-ARRAY['status','revision','updated_at','source_script_revision_id','target_scene_id','target_episode_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','revision','updated_at','source_script_revision_id','target_scene_id','target_episode_id']) OR OLD.status NOT IN ('ready','blocked') OR NEW.status NOT IN ('consumed','expired') OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Fixed plan cannot change' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='analysis_proposals' THEN
  IF NEW.source_script_revision_id IS DISTINCT FROM OLD.source_script_revision_id OR NEW.script_range IS DISTINCT FROM OLD.script_range OR NEW.source_generation_job_id IS DISTINCT FROM OLD.source_generation_job_id THEN RAISE EXCEPTION 'AI provenance cannot change' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='generation_capabilities' THEN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-'enabled') IS DISTINCT FROM (to_jsonb(OLD)-'enabled') THEN RAISE EXCEPTION 'Publish a new immutable capability identity' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'Execution evidence is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER generation_capability_fixed BEFORE UPDATE OR DELETE ON generation_capabilities FOR EACH ROW EXECUTE FUNCTION guard_generation_immutable();
ALTER TABLE project_event_outbox DROP CONSTRAINT project_event_outbox_resource_kind_check;
ALTER TABLE project_event_outbox ADD CHECK(resource_kind IN ('project','content','shot','asset','media','take','selection','task','proposal','cut','cut_work_draft','generation_job'));
CREATE TRIGGER project_invalidation AFTER INSERT OR UPDATE OF revision ON generation_jobs FOR EACH ROW EXECUTE FUNCTION record_project_invalidation('generation_job','id','revision');

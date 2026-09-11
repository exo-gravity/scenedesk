-- Prompt assistance consumes the same fixed-plan/unique-attempt protocol, never a chat endpoint.
ALTER TABLE generation_plans DROP CONSTRAINT generation_plans_check;
ALTER TABLE generation_plans DROP CONSTRAINT generation_plans_check1;
ALTER TABLE generation_plans ADD CHECK(input->>'scope'='project' AND (input->>'projectId')::uuid=project_id AND input->>'purpose' IN ('script_analysis','creative_assistance'));
ALTER TABLE generation_plans ADD CHECK((input->>'purpose'='script_analysis' AND input->'proposalTarget'->>'mode'='append_to_scene') OR (input->>'purpose'='creative_assistance' AND input->'assistance'->>'kind'='prepare_prompt' AND jsonb_array_length(input->'shotSources') BETWEEN 1 AND 100));
ALTER TABLE generation_plans ADD COLUMN target_capability_id uuid GENERATED ALWAYS AS ((input->'assistance'->>'targetCapabilityId')::uuid) STORED;
ALTER TABLE generation_plans ADD FOREIGN KEY(tenant_id,target_capability_id) REFERENCES generation_capabilities(tenant_id,id);
CREATE TABLE generation_plan_shots (
 tenant_id uuid NOT NULL,project_id uuid NOT NULL,plan_id uuid NOT NULL,position integer NOT NULL CHECK(position BETWEEN 0 AND 99),
 shot_id uuid NOT NULL,shot_revision_id uuid NOT NULL,
 PRIMARY KEY(plan_id,position),UNIQUE(plan_id,shot_id),
 FOREIGN KEY(tenant_id,project_id,plan_id) REFERENCES generation_plans(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,shot_id,shot_revision_id) REFERENCES shot_revisions(tenant_id,project_id,shot_id,id)
);
CREATE TABLE assistance_artifacts (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,project_id uuid NOT NULL,generation_job_id uuid NOT NULL UNIQUE,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision BETWEEN 1 AND 9007199254740991),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,generation_job_id) REFERENCES generation_jobs(tenant_id,project_id,id)
);
CREATE TABLE assistance_artifact_revisions (
 tenant_id uuid NOT NULL,project_id uuid NOT NULL,artifact_id uuid NOT NULL,number bigint NOT NULL CHECK(number BETWEEN 1 AND 9007199254740991),
 body jsonb NOT NULL CHECK(jsonb_typeof(body)='object' AND body ?& ARRAY['prompt','referenceSuggestions','retain','change','notes'] AND octet_length(body::text)<=524288),
 edited_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(artifact_id,number),UNIQUE(tenant_id,project_id,artifact_id,number),
 FOREIGN KEY(tenant_id,project_id,artifact_id) REFERENCES assistance_artifacts(tenant_id,project_id,id),
 CHECK((number=1)=(edited_by IS NULL))
);
ALTER TABLE assistance_artifacts ADD FOREIGN KEY(tenant_id,project_id,id,revision) REFERENCES assistance_artifact_revisions(tenant_id,project_id,artifact_id,number) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE assistance_revision_refs (
 tenant_id uuid NOT NULL,project_id uuid NOT NULL,artifact_id uuid NOT NULL,number bigint NOT NULL,position integer NOT NULL CHECK(position BETWEEN 0 AND 99),media_id uuid NOT NULL,asset_revision_id uuid,
 PRIMARY KEY(artifact_id,number,position),
 FOREIGN KEY(tenant_id,project_id,artifact_id,number) REFERENCES assistance_artifact_revisions(tenant_id,project_id,artifact_id,number),
 FOREIGN KEY(tenant_id,media_id) REFERENCES media(tenant_id,id),FOREIGN KEY(tenant_id,asset_revision_id) REFERENCES asset_revisions(tenant_id,id)
);
ALTER TABLE generation_jobs ADD COLUMN assistance_artifact_id uuid;
ALTER TABLE generation_jobs ADD FOREIGN KEY(tenant_id,project_id,assistance_artifact_id) REFERENCES assistance_artifacts(tenant_id,project_id,id);
ALTER TABLE generation_jobs DROP CONSTRAINT generation_jobs_check;
ALTER TABLE generation_jobs ADD CHECK((status='succeeded' AND num_nonnulls(proposal_id,assistance_artifact_id)=1) OR (status='reconciliation_required' AND num_nonnulls(proposal_id,assistance_artifact_id)<=1) OR (status NOT IN ('succeeded','reconciliation_required') AND num_nonnulls(proposal_id,assistance_artifact_id)=0));
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['generation_plan_shots','assistance_artifacts','assistance_artifact_revisions','assistance_revision_refs'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY assistance_scope ON %I USING(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL) WITH CHECK(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL)',t);
 END LOOP;
END $$;
CREATE TRIGGER assistance_revision_immutable BEFORE UPDATE OR DELETE ON assistance_artifact_revisions FOR EACH ROW EXECUTE FUNCTION protect_content_revision();
CREATE TRIGGER assistance_refs_immutable BEFORE UPDATE OR DELETE ON assistance_revision_refs FOR EACH ROW EXECUTE FUNCTION protect_content_revision();
CREATE TRIGGER generation_plan_shots_immutable BEFORE UPDATE OR DELETE ON generation_plan_shots FOR EACH ROW EXECUTE FUNCTION protect_content_revision();
CREATE FUNCTION guard_assistance_artifact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Artifact requires worker evidence' USING ERRCODE='42501'; END IF;
 ELSIF (to_jsonb(NEW)-ARRAY['revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revision','updated_at']) OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Artifact source is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER assistance_artifact_guard BEFORE INSERT OR UPDATE ON assistance_artifacts FOR EACH ROW EXECUTE FUNCTION guard_assistance_artifact();
CREATE FUNCTION project_assistance_references() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reference jsonb; offset_number integer:=0;
BEGIN
 IF NEW.number=1 THEN
  IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Original artifact requires execution evidence' USING ERRCODE='42501'; END IF;
 ELSIF NEW.edited_by IS DISTINCT FROM actor_id() OR NEW.number<>(SELECT revision+1 FROM assistance_artifacts WHERE id=NEW.artifact_id) THEN RAISE EXCEPTION 'Assistance edit must append under current actor' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(NEW.body->'referenceSuggestions')<>'array' OR jsonb_array_length(NEW.body->'referenceSuggestions')>100 THEN RAISE EXCEPTION 'Invalid assistance references' USING ERRCODE='23514'; END IF;
 FOR reference IN SELECT value FROM jsonb_array_elements(NEW.body->'referenceSuggestions') LOOP
  IF NOT EXISTS(SELECT 1 FROM media m WHERE m.tenant_id=NEW.tenant_id AND m.id=(reference->>'mediaId')::uuid AND (m.project_id IS NULL OR m.project_id=NEW.project_id)) THEN RAISE EXCEPTION 'Reference outside project' USING ERRCODE='23514'; END IF;
  INSERT INTO assistance_revision_refs(tenant_id,project_id,artifact_id,number,position,media_id,asset_revision_id) VALUES(NEW.tenant_id,NEW.project_id,NEW.artifact_id,NEW.number,offset_number,(reference->>'mediaId')::uuid,(reference->>'assetRevisionId')::uuid);
  offset_number:=offset_number+1;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER assistance_reference_projection AFTER INSERT ON assistance_artifact_revisions FOR EACH ROW EXECUTE FUNCTION project_assistance_references();
-- Projected shot identities must exactly describe the fixed public input and resolved original specs.
CREATE FUNCTION guard_prompt_plan_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source jsonb; saved jsonb; pos integer:=0;
BEGIN
 IF NEW.input->>'purpose'<>'creative_assistance' THEN RETURN NULL; END IF;
 IF (SELECT count(*) FROM generation_plan_shots WHERE plan_id=NEW.id)<>jsonb_array_length(NEW.input->'shotSources') THEN RAISE EXCEPTION 'Fixed shot projection missing' USING ERRCODE='23514'; END IF;
 FOR source IN SELECT value FROM jsonb_array_elements(NEW.input->'shotSources') LOOP
  IF NOT EXISTS(SELECT 1 FROM generation_plan_shots WHERE plan_id=NEW.id AND position=pos AND shot_id=(source->>'shotId')::uuid AND shot_revision_id=(source->>'shotRevisionId')::uuid) THEN RAISE EXCEPTION 'Fixed shot projection differs' USING ERRCODE='23514'; END IF;
  SELECT spec INTO saved FROM shot_revisions WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND shot_id=(source->>'shotId')::uuid AND id=(source->>'shotRevisionId')::uuid;
  IF NEW.resolved_input->'shots'->pos->'spec' IS DISTINCT FROM saved THEN RAISE EXCEPTION 'Fixed shot spec differs' USING ERRCODE='23514'; END IF;
  pos:=pos+1;
 END LOOP;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER prompt_plan_sources AFTER INSERT ON generation_plans DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_prompt_plan_sources();
-- The script excerpt guard has no script to validate for a legal prompt-assistance input.
CREATE OR REPLACE FUNCTION guard_generation_plan_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_text text; selected text; first_offset integer; last_offset integer;
BEGIN
 IF NEW.input->>'purpose'='creative_assistance' THEN
  IF NEW.input ? 'sourceScriptRevisionId' OR NEW.input ? 'scriptRange' OR NEW.resolved_input ? 'sourceExcerpt' THEN RAISE EXCEPTION 'Prompt assistance selects fixed shot and explicit context sources' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT text INTO source_text FROM script_revisions WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND id=(NEW.input->>'sourceScriptRevisionId')::uuid;
 first_offset:=(NEW.input->'scriptRange'->>'startOffset')::integer;last_offset:=(NEW.input->'scriptRange'->>'endOffset')::integer;
 selected:=substring(source_text FROM first_offset+1 FOR greatest(0,last_offset-first_offset));
 IF source_text IS NULL OR first_offset<0 OR last_offset<=first_offset OR last_offset>length(source_text) OR NEW.resolved_input->'sourceExcerpt'->>'scriptRevisionId' IS DISTINCT FROM NEW.input->>'sourceScriptRevisionId' OR NEW.resolved_input->'sourceExcerpt'->'range' IS DISTINCT FROM NEW.input->'scriptRange' OR NEW.resolved_input->'sourceExcerpt'->>'quote' IS DISTINCT FROM selected THEN RAISE EXCEPTION 'Fixed script source does not match' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER generation_plan_source ON generation_plans;
CREATE TRIGGER generation_plan_source BEFORE INSERT ON generation_plans FOR EACH ROW EXECUTE FUNCTION guard_generation_plan_source();
CREATE OR REPLACE FUNCTION guard_generation_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'queued' OR num_nonnulls(NEW.proposal_id,NEW.assistance_artifact_id)>0 OR NEW.created_by<>actor_id() OR NOT EXISTS(SELECT 1 FROM generation_plans p WHERE p.id=NEW.plan_id AND p.status='ready' AND p.expires_at>now()) THEN RAISE EXCEPTION 'Job must consume a ready fixed plan' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','proposal_id','assistance_artifact_id','error_code','revision','updated_at','recovery_epoch']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','proposal_id','assistance_artifact_id','error_code','revision','updated_at','recovery_epoch']) OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Job identity is immutable' USING ERRCODE='23514'; END IF;
  IF NOT generation_worker_login() AND NOT (OLD.status='queued' AND NEW.status='cancelled' AND num_nonnulls(NEW.proposal_id,NEW.assistance_artifact_id)=0 AND NEW.error_code='CANCELLED_BEFORE_DISPATCH' AND NEW.recovery_epoch=OLD.recovery_epoch) THEN RAISE EXCEPTION 'Worker evidence is required' USING ERRCODE='42501'; END IF;
 END IF;RETURN NEW;
END $$;
ALTER FUNCTION finish_generation_job(uuid,uuid,jsonb,text) RENAME TO finish_script_analysis_job;
CREATE FUNCTION finish_generation_job(wanted uuid,evidence_id uuid,output jsonb,failure text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE j generation_jobs;p generation_plans;e generation_submission_evidence;reference jsonb;terminal_count integer;
BEGIN
 IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Worker access required' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM generation_jobs WHERE id=wanted FOR UPDATE;IF NOT FOUND THEN RETURN;END IF;
 SELECT * INTO p FROM generation_plans WHERE id=j.plan_id;
 IF p.input->>'purpose'='script_analysis' THEN PERFORM finish_script_analysis_job(wanted,evidence_id,output,failure);RETURN;END IF;
 SELECT ev.* INTO e FROM generation_submission_evidence ev JOIN generation_attempts a ON a.id=ev.attempt_id WHERE ev.id=evidence_id AND a.job_id=j.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Evidence does not belong to attempt' USING ERRCODE='23514';END IF;
 SELECT count(*) INTO terminal_count FROM generation_submission_evidence WHERE attempt_id=e.attempt_id AND body->>'kind' IN ('completed','rejected');
 IF terminal_count>1 OR j.status IN ('succeeded','failed','cancelled') THEN RETURN; END IF;
 IF e.body->>'kind'='unknown' THEN UPDATE generation_jobs SET status='submission_unknown',error_code='SUBMISSION_UNKNOWN',revision=revision+1,updated_at=now() WHERE id=j.id AND status<>'submission_unknown'; RETURN;END IF;
 IF failure IS NOT NULL OR e.body->>'kind'='rejected' THEN UPDATE generation_jobs SET status='failed',error_code=coalesce(failure,'PROVIDER_REJECTED'),revision=revision+1,updated_at=now() WHERE id=j.id;DELETE FROM generation_work WHERE job_id=j.id;RETURN;END IF;
 IF output IS DISTINCT FROM e.body->'output' THEN RAISE EXCEPTION 'Artifact must preserve original output' USING ERRCODE='23514'; END IF;
 FOR reference IN SELECT value FROM jsonb_array_elements(output->'referenceSuggestions') LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.resolved_input->'references') r WHERE (r->'reference'-'note')=(reference-'note')) THEN RAISE EXCEPTION 'Model reference was not selected in plan' USING ERRCODE='23514';END IF;
 END LOOP;
 INSERT INTO assistance_artifacts(id,tenant_id,project_id,generation_job_id) VALUES(j.id,j.tenant_id,j.project_id,j.id);
 INSERT INTO assistance_artifact_revisions(tenant_id,project_id,artifact_id,number,body) VALUES(j.tenant_id,j.project_id,j.id,1,output);
 UPDATE generation_jobs SET status='succeeded',assistance_artifact_id=j.id,error_code=NULL,revision=revision+1,updated_at=now() WHERE id=j.id;
 DELETE FROM generation_work WHERE job_id=j.id;
END $$;
ALTER TABLE project_event_outbox DROP CONSTRAINT project_event_outbox_resource_kind_check;
ALTER TABLE project_event_outbox ADD CHECK(resource_kind IN ('project','content','shot','asset','media','take','selection','task','proposal','cut','cut_work_draft','generation_job','assistance_artifact'));
CREATE TRIGGER project_invalidation AFTER INSERT OR UPDATE OF revision ON assistance_artifacts FOR EACH ROW EXECUTE FUNCTION record_project_invalidation('assistance_artifact','id','revision');
REVOKE ALL ON FUNCTION guard_assistance_artifact(),project_assistance_references(),guard_prompt_plan_sources(),guard_generation_plan_source(),finish_generation_job(uuid,uuid,jsonb,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION guard_generation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='generation_plans' THEN
  IF (to_jsonb(NEW)-ARRAY['status','revision','updated_at','source_script_revision_id','target_scene_id','target_episode_id','target_capability_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','revision','updated_at','source_script_revision_id','target_scene_id','target_episode_id','target_capability_id']) OR OLD.status NOT IN ('ready','blocked') OR NEW.status NOT IN ('consumed','expired') OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Fixed plan cannot change' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='analysis_proposals' THEN
  IF NEW.source_script_revision_id IS DISTINCT FROM OLD.source_script_revision_id OR NEW.script_range IS DISTINCT FROM OLD.script_range OR NEW.source_generation_job_id IS DISTINCT FROM OLD.source_generation_job_id THEN RAISE EXCEPTION 'AI provenance cannot change' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='generation_capabilities' THEN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-'enabled') IS DISTINCT FROM (to_jsonb(OLD)-'enabled') THEN RAISE EXCEPTION 'Publish a new immutable capability identity' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'Execution evidence is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

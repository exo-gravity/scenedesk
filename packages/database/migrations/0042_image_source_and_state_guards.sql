-- Extend existing guards while preserving applied upload/text migrations.
CREATE OR REPLACE FUNCTION guard_generation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='generation_plans' THEN
  IF (to_jsonb(NEW)-ARRAY['status','revision','updated_at','source_script_revision_id','target_scene_id','target_episode_id','target_capability_id','assistance_artifact_id','assistance_artifact_revision']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','revision','updated_at','source_script_revision_id','target_scene_id','target_episode_id','target_capability_id','assistance_artifact_id','assistance_artifact_revision']) OR OLD.status NOT IN ('ready','blocked') OR NEW.status NOT IN ('consumed','expired') OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Fixed plan cannot change' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='analysis_proposals' THEN
  IF NEW.source_script_revision_id IS DISTINCT FROM OLD.source_script_revision_id OR NEW.script_range IS DISTINCT FROM OLD.script_range OR NEW.source_generation_job_id IS DISTINCT FROM OLD.source_generation_job_id THEN RAISE EXCEPTION 'AI provenance cannot change' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='generation_capabilities' THEN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-'enabled') IS DISTINCT FROM (to_jsonb(OLD)-'enabled') THEN RAISE EXCEPTION 'Publish a new immutable capability identity' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'Execution evidence is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_prompt_plan_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source jsonb; saved jsonb; pos integer:=0;
BEGIN
 IF NEW.input->>'purpose' NOT IN ('creative_assistance','image') THEN RETURN NULL; END IF;
 IF (SELECT count(*) FROM generation_plan_shots WHERE plan_id=NEW.id)<>jsonb_array_length(coalesce(NEW.input->'shotSources','[]'::jsonb)) THEN RAISE EXCEPTION 'Fixed shot projection missing' USING ERRCODE='23514'; END IF;
 FOR source IN SELECT value FROM jsonb_array_elements(coalesce(NEW.input->'shotSources','[]'::jsonb)) LOOP
  IF NOT EXISTS(SELECT 1 FROM generation_plan_shots WHERE plan_id=NEW.id AND position=pos AND shot_id=(source->>'shotId')::uuid AND shot_revision_id=(source->>'shotRevisionId')::uuid) THEN RAISE EXCEPTION 'Fixed shot projection differs' USING ERRCODE='23514'; END IF;
  SELECT spec INTO saved FROM shot_revisions WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND shot_id=(source->>'shotId')::uuid AND id=(source->>'shotRevisionId')::uuid;
  IF NEW.resolved_input->'shots'->pos->'spec' IS DISTINCT FROM saved THEN RAISE EXCEPTION 'Fixed shot spec differs' USING ERRCODE='23514'; END IF;
  pos:=pos+1;
 END LOOP;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION protect_media_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.scope<>OLD.scope
    OR NEW.source_upload_id IS DISTINCT FROM OLD.source_upload_id OR NEW.source_job_id IS DISTINCT FROM OLD.source_job_id OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at
    OR NEW.safe_original_file_name<>OLD.safe_original_file_name OR NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'Media identity is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status IN ('ready','archived') AND (NEW.kind,NEW.immutable_key,NEW.storage_version_id,NEW.sha256,NEW.bytes,NEW.mime,NEW.duration_us,NEW.width,NEW.height,NEW.fps_num,NEW.fps_den,NEW.has_audio,NEW.probe_metadata)
    IS DISTINCT FROM (OLD.kind,OLD.immutable_key,OLD.storage_version_id,OLD.sha256,OLD.bytes,OLD.mime,OLD.duration_us,OLD.width,OLD.height,OLD.fps_num,OLD.fps_den,OLD.has_audio,OLD.probe_metadata) THEN
    RAISE EXCEPTION 'Accepted media bytes and probe evidence are immutable' USING ERRCODE='23514';
  END IF;
  IF (OLD.status='archived' AND NEW.status<>'archived') OR (OLD.status='ready' AND NEW.status NOT IN ('ready','archived')) OR (OLD.status='rejected' AND NEW.status<>'rejected') THEN
    RAISE EXCEPTION 'Invalid media state transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION validate_media_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE source upload_intents;generated generation_media_outputs;
BEGIN
  IF NEW.source_job_id IS NOT NULL THEN
    IF TG_OP='INSERT' AND NOT generation_worker_login() THEN RAISE EXCEPTION 'Generated media requires worker receipt' USING ERRCODE='42501';END IF;
    IF NOT EXISTS(SELECT 1 FROM generation_jobs j JOIN generation_plans p ON p.id=j.plan_id WHERE j.id=NEW.source_job_id AND j.tenant_id=NEW.tenant_id AND j.project_id=NEW.project_id AND j.created_by=NEW.created_by AND p.input->>'purpose'='image') OR NEW.scope<>'project' OR NEW.kind<>'image' THEN RAISE EXCEPTION 'Generated media must match its actual image job' USING ERRCODE='23514';END IF;
    IF NEW.status IN ('ready','archived') THEN
      SELECT * INTO generated FROM generation_media_outputs WHERE job_id=NEW.source_job_id AND media_id=NEW.id;
      IF generated.id IS NULL OR NEW.bytes IS DISTINCT FROM (generated.source->'object'->>'bytes')::bigint OR NEW.sha256 IS DISTINCT FROM generated.source->>'sha256' THEN RAISE EXCEPTION 'Generated media must match fixed verified source' USING ERRCODE='23514';END IF;
    END IF;RETURN NEW;
  END IF;
  SELECT * INTO source FROM upload_intents WHERE tenant_id=NEW.tenant_id AND id=NEW.source_upload_id;
  IF source.id IS NULL OR source.project_id IS DISTINCT FROM NEW.project_id OR source.scope<>NEW.scope
    OR source.created_by<>NEW.created_by OR source.safe_file_name<>NEW.safe_original_file_name THEN
    RAISE EXCEPTION 'Media must match its actual upload source' USING ERRCODE='23514';
  END IF;
  IF NEW.status IN ('ready','archived') AND (NEW.bytes<>source.expected_bytes OR NEW.sha256<>source.expected_sha256 OR source.staging_version_id IS NULL) THEN
    RAISE EXCEPTION 'Accepted media must match the verified upload declaration' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_generation_plan_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_text text; selected text; first_offset integer; last_offset integer;
BEGIN
 IF NEW.input->>'purpose'='image' THEN
  IF NEW.input ? 'sourceScriptRevisionId' OR NEW.input ? 'scriptRange' OR NEW.input ? 'assistance' OR NEW.resolved_input ? 'sourceExcerpt' OR NOT EXISTS(SELECT 1 FROM generation_capabilities WHERE id=NEW.capability_id AND execution_mode='test_fixture' AND definition->>'mode'='image_fixture_v1') THEN RAISE EXCEPTION 'Image requires a distinct executable capability and explicit source' USING ERRCODE='23514';END IF;RETURN NEW;
 END IF;
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

CREATE OR REPLACE FUNCTION guard_generation_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE archive_actor boolean; archive_recovery boolean;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'queued' OR num_nonnulls(NEW.proposal_id,NEW.assistance_artifact_id,NEW.result_media_id)>0 OR NEW.created_by<>actor_id() OR NOT EXISTS(SELECT 1 FROM generation_plans p WHERE p.id=NEW.plan_id AND p.status='ready' AND p.expires_at>now()) THEN RAISE EXCEPTION 'Job must consume a ready fixed plan' USING ERRCODE='23514';END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','proposal_id','assistance_artifact_id','result_media_id','error_code','revision','updated_at','recovery_epoch']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','proposal_id','assistance_artifact_id','result_media_id','error_code','revision','updated_at','recovery_epoch']) OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Job identity is immutable' USING ERRCODE='23514';END IF;
  archive_actor:=media_worker_login() AND current_setting('app.generation_archive_job_id',true)=NEW.id::text AND NEW.status IN ('archiving','archive_failed','succeeded');
  archive_recovery:=OLD.status='archive_failed' AND NEW.status='archiving' AND NEW.error_code IS NULL AND num_nonnulls(NEW.proposal_id,NEW.assistance_artifact_id,NEW.result_media_id)=0 AND EXISTS(SELECT 1 FROM generation_media_outputs WHERE job_id=NEW.id AND status='queued' AND processing_attempts=0 AND issue IS NULL);
  IF NOT generation_worker_login() AND NOT coalesce(archive_actor,false) AND NOT archive_recovery AND NOT (OLD.status='queued' AND NEW.status='cancelled' AND num_nonnulls(NEW.proposal_id,NEW.assistance_artifact_id,NEW.result_media_id)=0 AND NEW.error_code='CANCELLED_BEFORE_DISPATCH' AND NEW.recovery_epoch=OLD.recovery_epoch) THEN RAISE EXCEPTION 'Worker evidence is required' USING ERRCODE='42501';END IF;
 END IF;RETURN NEW;
END $$;

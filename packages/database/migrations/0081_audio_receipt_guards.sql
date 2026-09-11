-- Keep typed provenance and existing immutable media/job boundaries.
CREATE OR REPLACE FUNCTION guard_prompt_plan_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source jsonb; saved jsonb; pos integer:=0;
BEGIN
 IF NEW.input->>'purpose' NOT IN ('creative_assistance','image','video','audio') THEN RETURN NULL; END IF;
 IF (SELECT count(*) FROM generation_plan_shots WHERE plan_id=NEW.id)<>jsonb_array_length(coalesce(NEW.input->'shotSources','[]'::jsonb)) THEN RAISE EXCEPTION 'Fixed shot projection missing' USING ERRCODE='23514'; END IF;
 FOR source IN SELECT value FROM jsonb_array_elements(coalesce(NEW.input->'shotSources','[]'::jsonb)) LOOP
  IF NOT EXISTS(SELECT 1 FROM generation_plan_shots WHERE plan_id=NEW.id AND position=pos AND shot_id=(source->>'shotId')::uuid AND shot_revision_id=(source->>'shotRevisionId')::uuid) THEN RAISE EXCEPTION 'Fixed shot projection differs' USING ERRCODE='23514'; END IF;
  SELECT spec INTO saved FROM shot_revisions WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND shot_id=(source->>'shotId')::uuid AND id=(source->>'shotRevisionId')::uuid;
  IF NEW.resolved_input->'shots'->pos->'spec' IS DISTINCT FROM saved THEN RAISE EXCEPTION 'Fixed shot spec differs' USING ERRCODE='23514'; END IF;
  pos:=pos+1;
 END LOOP;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION validate_media_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE source upload_intents;generated generation_media_outputs;
BEGIN
  IF NEW.source_job_id IS NOT NULL THEN
    IF TG_OP='INSERT' AND NOT generation_worker_login() THEN RAISE EXCEPTION 'Generated media requires worker receipt' USING ERRCODE='42501';END IF;
    IF NOT EXISTS(SELECT 1 FROM generation_jobs j JOIN generation_plans p ON p.id=j.plan_id WHERE j.id=NEW.source_job_id AND j.tenant_id=NEW.tenant_id AND j.project_id=NEW.project_id AND j.created_by=NEW.created_by AND p.input->>'purpose'=NEW.kind AND p.input->>'purpose' IN ('image','video','audio')) OR NEW.scope<>'project' OR NEW.kind NOT IN ('image','video','audio') THEN RAISE EXCEPTION 'Generated media must match its actual media job' USING ERRCODE='23514';END IF;
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
 IF NEW.input->>'purpose' IN ('image','video','audio') THEN
  IF NEW.input ? 'sourceScriptRevisionId' OR NEW.input ? 'scriptRange' OR NEW.input ? 'assistance' OR NEW.resolved_input ? 'sourceExcerpt' OR NOT EXISTS(SELECT 1 FROM generation_capabilities WHERE id=NEW.capability_id AND execution_mode='test_fixture' AND definition->>'mode'=(NEW.input->>'purpose')||'_fixture_v1' AND definition->>'purpose'=NEW.input->>'purpose') THEN RAISE EXCEPTION 'Media generation requires a distinct executable capability and explicit source' USING ERRCODE='23514';END IF;RETURN NEW;
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

CREATE OR REPLACE FUNCTION guard_generation_media_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT generation_worker_login() OR NOT EXISTS(SELECT 1 FROM generation_jobs j JOIN generation_plans p ON p.id=j.plan_id JOIN media m ON m.source_job_id=j.id JOIN generation_submission_evidence e ON e.id=NEW.evidence_id JOIN generation_attempts a ON a.id=e.attempt_id AND a.job_id=j.id WHERE j.id=NEW.job_id AND j.tenant_id=NEW.tenant_id AND j.project_id=NEW.project_id AND m.id=NEW.media_id AND p.input->>'purpose' IN ('image','video','audio') AND NEW.source=e.body->'output'->(CASE p.input->>'purpose' WHEN 'video' THEN 'videos' WHEN 'audio' THEN 'audios' ELSE 'images' END)->0 AND ((p.input->>'purpose'='image' AND NEW.source->>'mime' IN ('image/png','image/jpeg','image/webp')) OR (p.input->>'purpose'='video' AND NEW.source->>'mime'='video/mp4') OR (p.input->>'purpose'='audio' AND NEW.source->>'mime'='audio/wav')) AND NEW.output_options=p.resolved_input->'output') THEN RAISE EXCEPTION 'Image source requires original attempt evidence' USING ERRCODE='23514';END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','step_revision','epoch','processing_attempts','lease_token','lease_expires_at','issue','revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','step_revision','epoch','processing_attempts','lease_token','lease_expires_at','issue','revision','updated_at']) OR NEW.revision<>OLD.revision+1 OR OLD.status='accepted' THEN RAISE EXCEPTION 'Fixed generation output source is immutable' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;

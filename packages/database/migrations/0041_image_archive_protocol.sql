-- Generation only records the provider source. The isolated media worker verifies and archives bytes.
ALTER FUNCTION finish_generation_job(uuid,uuid,jsonb,text) RENAME TO finish_text_assistance_job;
CREATE FUNCTION finish_generation_job(wanted uuid,evidence_id uuid,output jsonb,failure text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE j generation_jobs;p generation_plans;e generation_submission_evidence;current_epoch bigint;image_source jsonb;file_name text;
BEGIN
 IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Worker access required' USING ERRCODE='42501';END IF;
 SELECT * INTO j FROM generation_jobs WHERE id=wanted FOR UPDATE;IF NOT FOUND THEN RETURN;END IF;
 SELECT * INTO p FROM generation_plans WHERE id=j.plan_id;
 IF p.input->>'purpose'<>'image' THEN PERFORM finish_text_assistance_job(wanted,evidence_id,output,failure);RETURN;END IF;
 SELECT ev.* INTO e FROM generation_submission_evidence ev JOIN generation_attempts a ON a.id=ev.attempt_id WHERE ev.id=evidence_id AND a.job_id=j.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Evidence does not belong to attempt' USING ERRCODE='23514';END IF;
 IF (SELECT count(*) FROM generation_submission_evidence WHERE attempt_id=e.attempt_id AND body->>'kind' IN ('completed','rejected'))>1 OR j.status IN ('archiving','archive_failed','succeeded','failed','cancelled') THEN RETURN;END IF;
 IF e.body->>'kind'='unknown' THEN UPDATE generation_jobs SET status='submission_unknown',error_code='SUBMISSION_UNKNOWN',revision=revision+1,updated_at=now() WHERE id=j.id AND status<>'submission_unknown';RETURN;END IF;
 IF failure IS NOT NULL OR e.body->>'kind'='rejected' THEN UPDATE generation_jobs SET status='failed',error_code=coalesce(failure,'PROVIDER_REJECTED'),revision=revision+1,updated_at=now() WHERE id=j.id;DELETE FROM generation_work WHERE job_id=j.id;RETURN;END IF;
 IF output IS DISTINCT FROM e.body->'output' OR jsonb_array_length(output->'images')<>1 OR p.execution_mode<>'test_fixture' THEN RAISE EXCEPTION 'Image requires exact fixed original receipt' USING ERRCODE='23514';END IF;
 SELECT epoch INTO current_epoch FROM media_processing_state WHERE singleton AND worker_role IS NOT NULL AND scheduler_role IS NOT NULL;
 IF current_epoch IS NULL THEN RAISE EXCEPTION 'Media processing must be configured' USING ERRCODE='55000';END IF;
 image_source:=output->'images'->0;
 file_name:=CASE image_source->>'mime' WHEN 'image/png' THEN 'generation.png' WHEN 'image/jpeg' THEN 'generation.jpg' ELSE 'generation.webp' END;
 INSERT INTO media(id,tenant_id,project_id,scope,kind,status,display_name,safe_original_file_name,created_by,source_job_id,mime) VALUES(j.id,j.tenant_id,j.project_id,'project','image','processing','生成图片（显式技术测试）',file_name,j.created_by,j.id,image_source->>'mime');
 INSERT INTO generation_media_outputs(id,tenant_id,project_id,job_id,media_id,evidence_id,source,output_options,epoch) VALUES(j.id,j.tenant_id,j.project_id,j.id,j.id,e.id,image_source,p.resolved_input->'output',current_epoch);
 UPDATE generation_jobs SET status='archiving',error_code=NULL,revision=revision+1,updated_at=now() WHERE id=j.id;
 DELETE FROM generation_work WHERE job_id=j.id;
END $$;
CREATE FUNCTION read_generation_archive_envelope(wanted uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE result jsonb;
BEGIN
 IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Worker access required' USING ERRCODE='42501';END IF;
 SELECT jsonb_build_object('taskKind','media_generation','businessId',id,'stepRevision',step_revision,'epoch',epoch) INTO result FROM generation_media_outputs WHERE job_id=wanted AND status IN ('queued','processing');RETURN result;
END $$;
CREATE FUNCTION claim_generated_media(wanted uuid,expected_step bigint,expected_epoch bigint,token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE s generation_media_outputs;j generation_jobs;current_epoch bigint;
BEGIN
 IF NOT media_worker_login() THEN RAISE EXCEPTION 'Media worker required' USING ERRCODE='42501';END IF;
 SELECT * INTO s FROM generation_media_outputs WHERE id=wanted;IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT epoch INTO current_epoch FROM media_processing_state WHERE singleton FOR SHARE;IF current_epoch<>expected_epoch THEN RETURN NULL;END IF;
 PERFORM id FROM tenants WHERE id=s.tenant_id AND status='active' FOR SHARE;IF NOT FOUND THEN RETURN NULL;END IF;
 -- A project may have been archived after submission; the already purchased result still needs archival.
 PERFORM id FROM projects WHERE tenant_id=s.tenant_id AND id=s.project_id FOR SHARE;IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO j FROM generation_jobs WHERE id=s.job_id FOR UPDATE;
 SELECT * INTO s FROM generation_media_outputs WHERE id=wanted FOR UPDATE;
 IF s.step_revision<>expected_step OR s.epoch<>expected_epoch OR s.status NOT IN ('queued','processing') OR (s.status='processing' AND s.lease_expires_at>now()) THEN RETURN NULL;END IF;
 PERFORM set_config('app.generation_archive_job_id',j.id::text,true);
 IF s.processing_attempts>=6 THEN
  UPDATE generation_media_outputs SET status='failed',issue='{"code":"MEDIA_RETRIES_EXHAUSTED","message":"自动归档次数已用完，可核对后重试原文件归档。","retryable":true}',revision=revision+1,updated_at=now() WHERE id=s.id;
  IF j.status<>'reconciliation_required' THEN UPDATE generation_jobs SET status='archive_failed',error_code='MEDIA_RETRIES_EXHAUSTED',revision=revision+1,updated_at=now() WHERE id=j.id;END IF;RETURN NULL;
 END IF;
 UPDATE generation_media_outputs SET status='processing',processing_attempts=processing_attempts+1,lease_token=token,lease_expires_at=now()+interval '2 minutes',issue=NULL,revision=revision+1,updated_at=now() WHERE id=s.id RETURNING * INTO s;
 RETURN jsonb_build_object('id',s.id,'mediaId',s.media_id,'tenantId',s.tenant_id,'projectId',s.project_id,'source',s.source,'output',s.output_options,'token',s.lease_token);
END $$;
CREATE FUNCTION finish_generated_media(wanted uuid,token uuid,result jsonb,failure jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE s generation_media_outputs;j generation_jobs;p generation_plans;variant uuid;retry boolean;current_epoch bigint;
BEGIN
 IF NOT media_worker_login() THEN RAISE EXCEPTION 'Media worker required' USING ERRCODE='42501';END IF;
 SELECT * INTO s FROM generation_media_outputs WHERE id=wanted;IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT epoch INTO current_epoch FROM media_processing_state WHERE singleton FOR SHARE;
 PERFORM id FROM tenants WHERE id=s.tenant_id AND status='active' FOR SHARE;IF NOT FOUND THEN RETURN NULL;END IF;
 PERFORM id FROM projects WHERE tenant_id=s.tenant_id AND id=s.project_id FOR SHARE;IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO j FROM generation_jobs WHERE id=s.job_id FOR UPDATE;
 SELECT * INTO s FROM generation_media_outputs WHERE id=wanted FOR UPDATE;
 IF s.status<>'processing' OR s.lease_token IS DISTINCT FROM token OR s.lease_expires_at<=now() OR s.epoch<>current_epoch THEN RETURN NULL;END IF;
 PERFORM set_config('app.generation_archive_job_id',j.id::text,true);
 IF failure IS NOT NULL THEN
  retry:=coalesce((failure->>'retryable')::boolean,false);
  UPDATE generation_media_outputs SET status=CASE WHEN retry AND processing_attempts<6 THEN 'queued' WHEN retry THEN 'failed' ELSE 'rejected' END,issue=failure,lease_token=NULL,lease_expires_at=NULL,revision=revision+1,updated_at=now() WHERE id=s.id;
  UPDATE media SET status=CASE WHEN retry THEN 'processing' ELSE 'rejected' END,issue=failure,revision=revision+1,updated_at=now() WHERE id=s.media_id AND status='processing';
  IF j.status<>'reconciliation_required' THEN UPDATE generation_jobs SET status=CASE WHEN retry AND s.processing_attempts<6 THEN 'archiving' ELSE 'archive_failed' END,error_code=failure->>'code',revision=revision+1,updated_at=now() WHERE id=j.id;END IF;RETURN NULL;
 END IF;
 IF result->'object'->>'sha256' IS DISTINCT FROM s.source->>'sha256' OR (result->'object'->>'bytes')::bigint IS DISTINCT FROM (s.source->'object'->>'bytes')::bigint OR result->'probe'->>'kind'<>'image' OR result->'probe'->>'mime' IS DISTINCT FROM s.source->>'mime' OR (result->'probe'->>'width')||'x'||(result->'probe'->>'height') IS DISTINCT FROM s.output_options->>'resolution' THEN RAISE EXCEPTION 'Archived result differs from fixed image source or output' USING ERRCODE='23514';END IF;
 UPDATE media SET status='ready',kind='image',immutable_key=result->'object'->>'key',storage_version_id=result->'object'->>'versionId',sha256=result->'object'->>'sha256',bytes=(result->'object'->>'bytes')::bigint,mime=result->'probe'->>'mime',width=(result->'probe'->>'width')::integer,height=(result->'probe'->>'height')::integer,has_audio=false,probe_metadata=result->'probe',issue=NULL,revision=revision+1,updated_at=now() WHERE id=s.media_id AND status='processing';
 IF NOT FOUND THEN RAISE EXCEPTION 'Media result no longer current' USING ERRCODE='23514';END IF;
 UPDATE generation_media_outputs SET status='accepted',lease_token=NULL,lease_expires_at=NULL,issue=NULL,step_revision=step_revision+1,revision=revision+1,updated_at=now() WHERE id=s.id;
 IF j.status<>'reconciliation_required' THEN UPDATE generation_jobs SET status='succeeded',result_media_id=s.media_id,error_code=NULL,revision=revision+1,updated_at=now() WHERE id=j.id;END IF;
 variant:=gen_random_uuid();INSERT INTO media_derivatives(id,tenant_id,media_id,kind,profile_revision,epoch) VALUES(variant,s.tenant_id,s.media_id,'poster',1,s.epoch);
 RETURN jsonb_build_object('taskKind','media_derivative','businessId',variant,'stepRevision',1,'epoch',s.epoch);
END $$;
CREATE FUNCTION recover_generated_archive(wanted uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE j generation_jobs;s generation_media_outputs;current_epoch bigint;
BEGIN
 SELECT * INTO j FROM generation_jobs WHERE id=wanted AND tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Job unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO s FROM generation_media_outputs WHERE job_id=j.id FOR UPDATE;
 IF j.status<>'archive_failed' OR s.status<>'failed' OR NOT coalesce((s.issue->>'retryable')::boolean,false) THEN RETURN NULL;END IF;
 SELECT epoch INTO current_epoch FROM media_processing_state WHERE singleton;
 PERFORM set_config('app.generation_archive_job_id',j.id::text,true);
 UPDATE generation_media_outputs SET status='queued',epoch=current_epoch,processing_attempts=0,step_revision=step_revision+1,lease_token=NULL,lease_expires_at=NULL,issue=NULL,revision=revision+1,updated_at=now() WHERE id=s.id RETURNING * INTO s;
 UPDATE generation_jobs SET status='archiving',error_code=NULL,revision=revision+1,updated_at=now() WHERE id=j.id;
 RETURN jsonb_build_object('taskKind','media_generation','businessId',s.id,'stepRevision',s.step_revision,'epoch',s.epoch);
END $$;
CREATE FUNCTION scan_generated_media(batch_size integer) RETURNS TABLE(task_kind text,business_id uuid,step_revision bigint,epoch bigint) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF batch_size NOT BETWEEN 1 AND 100 OR NOT EXISTS(SELECT 1 FROM media_processing_state WHERE scheduler_role=session_user) THEN RAISE EXCEPTION 'Restricted scheduler required' USING ERRCODE='42501';END IF;
 RETURN QUERY SELECT 'media_generation'::text,s.id,s.step_revision,s.epoch FROM generation_media_outputs s JOIN tenants t ON t.id=s.tenant_id AND t.status='active' CROSS JOIN media_processing_state ms WHERE s.epoch=ms.epoch AND ((s.status='queued' AND s.updated_at<now()-interval '2 minutes') OR (s.status='processing' AND s.lease_expires_at<=now())) ORDER BY s.updated_at,s.id LIMIT batch_size;
END $$;
REVOKE ALL ON FUNCTION finish_generation_job(uuid,uuid,jsonb,text),read_generation_archive_envelope(uuid),claim_generated_media(uuid,bigint,bigint,uuid),finish_generated_media(uuid,uuid,jsonb,jsonb),recover_generated_archive(uuid),scan_generated_media(integer) FROM PUBLIC;

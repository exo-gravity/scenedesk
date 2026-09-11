-- A late conflict keeps the first verified output inspectable without declaring success.
CREATE OR REPLACE FUNCTION finish_generated_media(wanted uuid,token uuid,result jsonb,failure jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
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
 UPDATE generation_jobs SET status=CASE WHEN status='reconciliation_required' THEN status ELSE 'succeeded' END,result_media_id=s.media_id,error_code=CASE WHEN status='reconciliation_required' THEN error_code ELSE NULL END,revision=revision+1,updated_at=now() WHERE id=j.id;
 variant:=gen_random_uuid();INSERT INTO media_derivatives(id,tenant_id,media_id,kind,profile_revision,epoch) VALUES(variant,s.tenant_id,s.media_id,'poster',1,s.epoch);
 RETURN jsonb_build_object('taskKind','media_derivative','businessId',variant,'stepRevision',1,'epoch',s.epoch);
END $$;

CREATE OR REPLACE FUNCTION guard_generation_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE archive_actor boolean; archive_recovery boolean;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'queued' OR num_nonnulls(NEW.proposal_id,NEW.assistance_artifact_id,NEW.result_media_id)>0 OR NEW.created_by<>actor_id() OR NOT EXISTS(SELECT 1 FROM generation_plans p WHERE p.id=NEW.plan_id AND p.status='ready' AND p.expires_at>now()) THEN RAISE EXCEPTION 'Job must consume a ready fixed plan' USING ERRCODE='23514';END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','proposal_id','assistance_artifact_id','result_media_id','error_code','revision','updated_at','recovery_epoch']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','proposal_id','assistance_artifact_id','result_media_id','error_code','revision','updated_at','recovery_epoch']) OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Job identity is immutable' USING ERRCODE='23514';END IF;
  archive_actor:=media_worker_login() AND current_setting('app.generation_archive_job_id',true)=NEW.id::text AND (NEW.status IN ('archiving','archive_failed','succeeded') OR (OLD.status='reconciliation_required' AND NEW.status='reconciliation_required' AND NEW.error_code IS NOT DISTINCT FROM OLD.error_code AND EXISTS(SELECT 1 FROM generation_media_outputs WHERE job_id=NEW.id AND media_id=NEW.result_media_id AND status='accepted')));
  archive_recovery:=OLD.status='archive_failed' AND NEW.status='archiving' AND NEW.error_code IS NULL AND num_nonnulls(NEW.proposal_id,NEW.assistance_artifact_id,NEW.result_media_id)=0 AND EXISTS(SELECT 1 FROM generation_media_outputs WHERE job_id=NEW.id AND status='queued' AND processing_attempts=0 AND issue IS NULL);
  IF NOT generation_worker_login() AND NOT coalesce(archive_actor,false) AND NOT archive_recovery AND NOT (OLD.status='queued' AND NEW.status='cancelled' AND num_nonnulls(NEW.proposal_id,NEW.assistance_artifact_id,NEW.result_media_id)=0 AND NEW.error_code='CANCELLED_BEFORE_DISPATCH' AND NEW.recovery_epoch=OLD.recovery_epoch) THEN RAISE EXCEPTION 'Worker evidence is required' USING ERRCODE='42501';END IF;
 END IF;RETURN NEW;
END $$;

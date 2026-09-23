-- Real video providers round the delivered clip to whole frames of their own choosing: Seedance returned
-- 4.0417 s (97 frames) and 4.096 s for 4 s requests, MiniMax 5.17 s for 5 s. The one-frame container
-- tolerance from 0083 rejected every real clip at the archive step (each retry surfaced only as
-- MEDIA_SERVICE_UNAVAILABLE), so the video rule now allows one second either way, the same bound
-- packages/media/src/generated-output.ts applies before the row is written. Audio and image rules are unchanged.
CREATE OR REPLACE FUNCTION finish_generated_media(wanted uuid,token uuid,result jsonb,failure jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE s generation_media_outputs;j generation_jobs;p generation_plans;variant uuid;retry boolean;current_epoch bigint;media_kind text;proxy_id uuid;envelope jsonb;
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
 media_kind:=CASE s.source->>'mime' WHEN 'audio/wav' THEN 'audio' WHEN 'video/mp4' THEN 'video' ELSE 'image' END;
 IF result->'object'->>'sha256' IS DISTINCT FROM s.source->>'sha256' OR (result->'object'->>'bytes')::bigint IS DISTINCT FROM (s.source->'object'->>'bytes')::bigint OR result->'probe'->>'kind' IS DISTINCT FROM media_kind OR result->'probe'->>'mime' IS DISTINCT FROM s.source->>'mime' OR (media_kind<>'audio' AND (result->'probe'->>'width')||'x'||(result->'probe'->>'height') IS DISTINCT FROM s.output_options->>'resolution') THEN RAISE EXCEPTION 'Archived result differs from fixed image source or output' USING ERRCODE='23514';END IF;
 IF media_kind='video' AND ((result->'probe'->>'durationUs')::bigint>0 AND (result->'probe'->>'fpsNum')::bigint>0 AND (result->'probe'->>'fpsDen')::bigint>0 AND (result->'probe'->>'hasAudio')::boolean=(s.output_options->>'withAudio')::boolean AND abs((result->'probe'->>'durationUs')::numeric-(s.output_options->>'durationSeconds')::numeric*1000000)<=1000000) IS NOT TRUE THEN RAISE EXCEPTION 'Video duration, audio or frame evidence differs from fixed request' USING ERRCODE='23514';END IF;
 IF media_kind='audio' AND ((result->'probe'->>'hasAudio')::boolean=true AND NOT (result->'probe' ?| ARRAY['width','height','fpsNum','fpsDen']) AND (result->'probe'->>'durationUs')::bigint>0 AND (result->'probe'->'timing'->>'audioSampleRate')::bigint>0 AND abs((result->'probe'->>'durationUs')::numeric-(s.output_options->>'durationSeconds')::numeric*1000000)*(result->'probe'->'timing'->>'audioSampleRate')::numeric<=1000000) IS NOT TRUE THEN RAISE EXCEPTION 'Audio sample timing differs from fixed request' USING ERRCODE='23514';END IF;
 UPDATE media SET status='ready',kind=media_kind,immutable_key=result->'object'->>'key',storage_version_id=result->'object'->>'versionId',sha256=result->'object'->>'sha256',bytes=(result->'object'->>'bytes')::bigint,mime=result->'probe'->>'mime',width=(result->'probe'->>'width')::integer,height=(result->'probe'->>'height')::integer,has_audio=(result->'probe'->>'hasAudio')::boolean,duration_us=(result->'probe'->>'durationUs')::bigint,fps_num=(result->'probe'->>'fpsNum')::bigint,fps_den=(result->'probe'->>'fpsDen')::bigint,probe_metadata=result->'probe',issue=NULL,revision=revision+1,updated_at=now() WHERE id=s.media_id AND status='processing';
 IF NOT FOUND THEN RAISE EXCEPTION 'Media result no longer current' USING ERRCODE='23514';END IF;
 UPDATE generation_media_outputs SET status='accepted',lease_token=NULL,lease_expires_at=NULL,issue=NULL,step_revision=step_revision+1,revision=revision+1,updated_at=now() WHERE id=s.id;
 UPDATE generation_jobs SET status=CASE WHEN status='reconciliation_required' THEN status ELSE 'succeeded' END,result_media_id=s.media_id,error_code=CASE WHEN status='reconciliation_required' THEN error_code ELSE NULL END,revision=revision+1,updated_at=now() WHERE id=j.id;
 IF media_kind='audio' THEN proxy_id:=gen_random_uuid();INSERT INTO media_derivatives(id,tenant_id,media_id,kind,profile_revision,epoch) VALUES(proxy_id,s.tenant_id,s.media_id,'proxy',1,s.epoch);RETURN jsonb_build_object('taskKind','media_derivative','businessId',proxy_id,'stepRevision',1,'epoch',s.epoch);END IF;
 variant:=gen_random_uuid();INSERT INTO media_derivatives(id,tenant_id,media_id,kind,profile_revision,epoch) VALUES(variant,s.tenant_id,s.media_id,'poster',1,s.epoch);
 envelope:=jsonb_build_object('taskKind','media_derivative','businessId',variant,'stepRevision',1,'epoch',s.epoch);
 IF media_kind='video' THEN proxy_id:=gen_random_uuid();INSERT INTO media_derivatives(id,tenant_id,media_id,kind,profile_revision,epoch) VALUES(proxy_id,s.tenant_id,s.media_id,'proxy',1,s.epoch);RETURN jsonb_build_array(envelope,jsonb_build_object('taskKind','media_derivative','businessId',proxy_id,'stepRevision',1,'epoch',s.epoch));END IF;
 RETURN envelope;
END $$;


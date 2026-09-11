CREATE OR REPLACE FUNCTION finish_generation_job(wanted uuid,evidence_id uuid,output jsonb,failure text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE j generation_jobs;p generation_plans;e generation_submission_evidence;current_epoch bigint;image_source jsonb;file_name text;media_kind text;collection text;
BEGIN
 IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Worker access required' USING ERRCODE='42501';END IF;
 SELECT * INTO j FROM generation_jobs WHERE id=wanted FOR UPDATE;IF NOT FOUND THEN RETURN;END IF;
 SELECT * INTO p FROM generation_plans WHERE id=j.plan_id;
 IF p.input->>'purpose' NOT IN ('image','video','audio') THEN PERFORM finish_text_assistance_job(wanted,evidence_id,output,failure);RETURN;END IF;
 SELECT ev.* INTO e FROM generation_submission_evidence ev JOIN generation_attempts a ON a.id=ev.attempt_id WHERE ev.id=evidence_id AND a.job_id=j.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Evidence does not belong to attempt' USING ERRCODE='23514';END IF;
 IF (SELECT count(*) FROM generation_submission_evidence WHERE attempt_id=e.attempt_id AND body->>'kind' IN ('completed','rejected'))>1 OR j.status IN ('archiving','archive_failed','succeeded','failed','cancelled') THEN RETURN;END IF;
 IF e.body->>'kind'='unknown' THEN UPDATE generation_jobs SET status='submission_unknown',error_code='SUBMISSION_UNKNOWN',revision=revision+1,updated_at=now() WHERE id=j.id AND status<>'submission_unknown';RETURN;END IF;
 IF failure IS NOT NULL OR e.body->>'kind'='rejected' THEN UPDATE generation_jobs SET status='failed',error_code=coalesce(failure,'PROVIDER_REJECTED'),revision=revision+1,updated_at=now() WHERE id=j.id;DELETE FROM generation_work WHERE job_id=j.id;RETURN;END IF;
 media_kind:=p.input->>'purpose';collection:=CASE media_kind WHEN 'video' THEN 'videos' WHEN 'audio' THEN 'audios' ELSE 'images' END;
 IF output IS DISTINCT FROM e.body->'output' OR jsonb_array_length(output->collection)<>1 OR p.execution_mode<>'test_fixture' THEN RAISE EXCEPTION 'Image requires exact fixed original receipt' USING ERRCODE='23514';END IF;
 SELECT epoch INTO current_epoch FROM media_processing_state WHERE singleton AND worker_role IS NOT NULL AND scheduler_role IS NOT NULL;
 IF current_epoch IS NULL THEN RAISE EXCEPTION 'Media processing must be configured' USING ERRCODE='55000';END IF;
 image_source:=output->collection->0;
 file_name:=CASE image_source->>'mime' WHEN 'audio/wav' THEN 'generation.wav' WHEN 'video/mp4' THEN 'generation.mp4' WHEN 'image/png' THEN 'generation.png' WHEN 'image/jpeg' THEN 'generation.jpg' ELSE 'generation.webp' END;
 INSERT INTO media(id,tenant_id,project_id,scope,kind,status,display_name,safe_original_file_name,created_by,source_job_id,mime) VALUES(j.id,j.tenant_id,j.project_id,'project',media_kind,'processing',CASE media_kind WHEN 'audio' THEN '生成音频（显式技术测试）' WHEN 'video' THEN '生成视频（显式技术测试）' ELSE '生成图片（显式技术测试）' END,file_name,j.created_by,j.id,image_source->>'mime');
 INSERT INTO generation_media_outputs(id,tenant_id,project_id,job_id,media_id,evidence_id,source,output_options,epoch) VALUES(j.id,j.tenant_id,j.project_id,j.id,j.id,e.id,image_source,p.resolved_input->'output',current_epoch);
 UPDATE generation_jobs SET status='archiving',error_code=NULL,revision=revision+1,updated_at=now() WHERE id=j.id;
 DELETE FROM generation_work WHERE job_id=j.id;
END $$;

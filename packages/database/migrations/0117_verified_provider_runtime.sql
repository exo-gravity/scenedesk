-- Verified providers hand back the same private-object receipt as fixtures; the
-- one-object, receipt-equality and media-processing checks are unchanged.
CREATE OR REPLACE FUNCTION finish_generation_output(wanted uuid,evidence_id uuid,output jsonb,failure text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE j generation_jobs;p generation_plans;e generation_submission_evidence;current_epoch bigint;image_source jsonb;file_name text;media_kind text;collection text;
BEGIN
 IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Worker access required' USING ERRCODE='42501';END IF;
 SELECT * INTO j FROM generation_jobs WHERE id=wanted FOR UPDATE;IF NOT FOUND THEN RETURN;END IF;
 SELECT * INTO p FROM generation_plans WHERE id=j.plan_id;
 IF p.input->>'purpose' NOT IN ('image','video','audio') THEN PERFORM finish_text_assistance_job(wanted,evidence_id,output,failure);RETURN;END IF;
 SELECT ev.* INTO e FROM generation_submission_evidence ev JOIN generation_attempts a ON a.id=ev.attempt_id WHERE ev.id=evidence_id AND a.job_id=j.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Evidence does not belong to attempt' USING ERRCODE='23514';END IF;
 IF (SELECT count(DISTINCT (body-'usage')) FROM generation_submission_evidence WHERE attempt_id=e.attempt_id AND body->>'kind' IN ('completed','rejected'))>1 OR j.status IN ('archiving','archive_failed','succeeded','failed','cancelled') THEN RETURN;END IF;
 IF e.body->>'kind'='unknown' THEN UPDATE generation_jobs SET status='submission_unknown',error_code='SUBMISSION_UNKNOWN',revision=revision+1,updated_at=now() WHERE id=j.id AND status<>'submission_unknown';RETURN;END IF;
 IF failure IS NOT NULL OR e.body->>'kind'='rejected' THEN UPDATE generation_jobs SET status='failed',error_code=coalesce(failure,'PROVIDER_REJECTED'),revision=revision+1,updated_at=now() WHERE id=j.id;DELETE FROM generation_work WHERE job_id=j.id;RETURN;END IF;
 media_kind:=p.input->>'purpose';collection:=CASE media_kind WHEN 'video' THEN 'videos' WHEN 'audio' THEN 'audios' ELSE 'images' END;
 IF output IS DISTINCT FROM e.body->'output' OR jsonb_array_length(output->collection)<>1 OR p.execution_mode NOT IN ('test_fixture','verified_provider') THEN RAISE EXCEPTION 'Image requires exact fixed original receipt' USING ERRCODE='23514';END IF;
 SELECT epoch INTO current_epoch FROM media_processing_state WHERE singleton AND worker_role IS NOT NULL AND scheduler_role IS NOT NULL;
 IF current_epoch IS NULL THEN RAISE EXCEPTION 'Media processing must be configured' USING ERRCODE='55000';END IF;
 image_source:=output->collection->0;
 file_name:=CASE image_source->>'mime' WHEN 'audio/wav' THEN 'generation.wav' WHEN 'video/mp4' THEN 'generation.mp4' WHEN 'image/png' THEN 'generation.png' WHEN 'image/jpeg' THEN 'generation.jpg' ELSE 'generation.webp' END;
 INSERT INTO media(id,tenant_id,project_id,scope,kind,status,display_name,safe_original_file_name,created_by,source_job_id,mime) VALUES(j.id,j.tenant_id,j.project_id,'project',media_kind,'processing',CASE WHEN p.execution_mode='verified_provider' THEN CASE media_kind WHEN 'audio' THEN '生成音频' WHEN 'video' THEN '生成视频' ELSE '生成图片' END ELSE CASE media_kind WHEN 'audio' THEN '生成音频（显式技术测试）' WHEN 'video' THEN '生成视频（显式技术测试）' ELSE '生成图片（显式技术测试）' END END,file_name,j.created_by,j.id,image_source->>'mime');
 INSERT INTO generation_media_outputs(id,tenant_id,project_id,job_id,media_id,evidence_id,source,output_options,epoch) VALUES(j.id,j.tenant_id,j.project_id,j.id,j.id,e.id,image_source,p.resolved_input->'output',current_epoch);
 UPDATE generation_jobs SET status='archiving',error_code=NULL,revision=revision+1,updated_at=now() WHERE id=j.id;
 DELETE FROM generation_work WHERE job_id=j.id;
END $$;

-- Result downloads happen inside the observation; give one executor 180 seconds.
CREATE OR REPLACE FUNCTION claim_generation_observation(wanted uuid,token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE j generation_jobs; ctl generation_observation_control; action text; provider_id text; prior_failures integer;
BEGIN
 IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Worker access required' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM generation_jobs WHERE id=wanted FOR UPDATE;
 IF NOT FOUND OR j.status NOT IN ('submission_unknown','provider_pending','provider_running','cancel_requested','reconciliation_required') OR j.error_code IN ('CONFLICTING_SUBMISSION_EVIDENCE','CONFLICTING_PROVIDER_ID') THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM generation_attempts WHERE job_id=j.id) THEN RETURN NULL; END IF;
 INSERT INTO generation_observation_control(job_id) VALUES(j.id) ON CONFLICT(job_id) DO NOTHING;
 SELECT * INTO ctl FROM generation_observation_control WHERE job_id=j.id FOR UPDATE;
 IF ctl.next_observation_at>now() OR ctl.lease_until>now() THEN RETURN NULL; END IF;
 SELECT provider_job_id INTO provider_id FROM generation_provider_bindings WHERE job_id=j.id;
 action:=CASE WHEN provider_id IS NULL THEN 'recover' WHEN j.cancel_requested_at IS NOT NULL AND NOT ctl.cancel_attempted THEN 'cancel' ELSE 'query' END;
 prior_failures:=ctl.observation_failures;
 UPDATE generation_observation_control SET lease_token=token,lease_until=now()+interval '180 seconds',observation_failures=least(observation_failures+1,1000000),cancel_attempted=cancel_attempted OR action='cancel' WHERE job_id=j.id;
 IF action='query' AND ctl.cancel_attempted AND j.cancel_status='requested' AND NOT EXISTS(SELECT 1 FROM generation_submission_evidence e JOIN generation_attempts a ON a.id=e.attempt_id WHERE a.job_id=j.id AND e.body->>'kind' IN ('cancel_requested','cancel_unsupported','cancel_unknown','cancelled')) THEN UPDATE generation_jobs SET cancel_status='unknown',revision=revision+1,updated_at=now() WHERE id=j.id; END IF;
 RETURN read_generation_evidence(j.id)||jsonb_build_object('action',action,'leaseToken',token,'observationFailures',prior_failures);
END $$;

-- The executor never reads media directly: only the fixed plan's own references, only ready originals.
CREATE FUNCTION read_generation_media_sources(wanted uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE result jsonb;
BEGIN
 IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Worker access required' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'kind',m.kind,'mime',m.mime,'bytes',m.bytes,'sha256',m.sha256,'width',m.width,'height',m.height,'object',jsonb_build_object('key',m.immutable_key,'versionId',m.storage_version_id)) ORDER BY r.ordinality),'[]'::jsonb) INTO result
 FROM generation_jobs j JOIN generation_plans p ON p.id=j.plan_id
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.resolved_input->'references','[]'::jsonb)) WITH ORDINALITY AS r(value,ordinality)
 JOIN media m ON m.tenant_id=j.tenant_id AND m.id=(r.value->'reference'->>'mediaId')::uuid AND m.status='ready' AND m.immutable_key IS NOT NULL
 WHERE j.id=wanted;
 RETURN coalesce(result,'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION read_generation_media_sources(uuid) FROM PUBLIC;

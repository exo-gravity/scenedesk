-- Usage observations may arrive after identical creative output. Keep every raw receipt,
-- but compare terminal generation facts independently of the optional usage measurement.
-- Provider identity, terminal kind, output and failure code still participate in conflict checks.
CREATE OR REPLACE FUNCTION record_generation_evidence(attempt uuid,evidence_id uuid,receipt jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE saved uuid; target uuid; kind text; conflicting boolean;
BEGIN
 IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Worker access required' USING ERRCODE='42501'; END IF;
 kind:=receipt->>'kind';
 IF jsonb_typeof(receipt)<>'object' OR kind IS NULL OR kind NOT IN ('completed','rejected','unknown','accepted','pending','running','failed','cancelled','unavailable','cancel_requested','cancel_unsupported','cancel_unknown') OR receipt->>'correlation' IS DISTINCT FROM attempt::text THEN RAISE EXCEPTION 'Evidence must bind its durable attempt correlation' USING ERRCODE='23514'; END IF;
 IF (kind IN ('accepted','pending','running','failed','cancelled','cancel_requested','cancel_unsupported','cancel_unknown') AND NOT receipt ? 'providerJobId') OR (receipt ? 'providerJobId' AND (jsonb_typeof(receipt->'providerJobId')<>'string' OR length(receipt->>'providerJobId') NOT BETWEEN 1 AND 512 OR receipt->>'providerJobId' ~ '[[:cntrl:]]')) THEN RAISE EXCEPTION 'Provider evidence requires an exact bounded task identity' USING ERRCODE='23514'; END IF;
 IF kind IN ('rejected','failed','unavailable') AND (jsonb_typeof(receipt->'code') IS DISTINCT FROM 'string' OR length(receipt->>'code') NOT BETWEEN 1 AND 200) THEN RAISE EXCEPTION 'Provider failure requires a code' USING ERRCODE='23514'; END IF;
 SELECT job_id INTO target FROM generation_attempts WHERE id=attempt;
 IF target IS NULL THEN RAISE EXCEPTION 'Unknown attempt' USING ERRCODE='23514'; END IF;
 PERFORM id FROM generation_jobs WHERE id=target FOR UPDATE;
 INSERT INTO generation_submission_evidence(id,attempt_id,body) VALUES(evidence_id,attempt,receipt) ON CONFLICT(attempt_id,body_hash) DO NOTHING;
 SELECT id INTO saved FROM generation_submission_evidence WHERE attempt_id=attempt AND body=receipt;
 IF saved IS NULL THEN RAISE EXCEPTION 'Conflicting receipt digest' USING ERRCODE='23514'; END IF;
 SELECT count(DISTINCT body->>'providerJobId')>1 INTO conflicting FROM generation_submission_evidence WHERE attempt_id=attempt;
 conflicting:=conflicting OR (SELECT count(DISTINCT (body-'usage'))>1 FROM generation_submission_evidence WHERE attempt_id=attempt AND body->>'kind' IN ('completed','rejected','failed','cancelled'));
 conflicting:=conflicting OR (EXISTS(SELECT 1 FROM generation_submission_evidence WHERE attempt_id=attempt AND body ? 'providerJobId') AND EXISTS(SELECT 1 FROM generation_submission_evidence WHERE attempt_id=attempt AND (body->>'kind'='rejected' OR (body->>'kind'='completed' AND NOT body ? 'providerJobId'))));
 IF conflicting THEN UPDATE generation_jobs SET status='reconciliation_required',error_code='CONFLICTING_SUBMISSION_EVIDENCE',revision=revision+1,updated_at=now() WHERE id=target AND (status<>'reconciliation_required' OR error_code IS DISTINCT FROM 'CONFLICTING_SUBMISSION_EVIDENCE'); END IF;
 INSERT INTO generation_work(job_id) VALUES(target) ON CONFLICT(job_id) DO NOTHING;
 RETURN saved;
END $$;

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

CREATE OR REPLACE FUNCTION finish_text_assistance_job(wanted uuid,evidence_id uuid,output jsonb,failure text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE j generation_jobs;p generation_plans;e generation_submission_evidence;reference jsonb;terminal_count integer;
BEGIN
 IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Worker access required' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM generation_jobs WHERE id=wanted FOR UPDATE;IF NOT FOUND THEN RETURN;END IF;
 SELECT * INTO p FROM generation_plans WHERE id=j.plan_id;
 IF p.input->>'purpose'='script_analysis' THEN PERFORM finish_script_analysis_job(wanted,evidence_id,output,failure);RETURN;END IF;
 SELECT ev.* INTO e FROM generation_submission_evidence ev JOIN generation_attempts a ON a.id=ev.attempt_id WHERE ev.id=evidence_id AND a.job_id=j.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Evidence does not belong to attempt' USING ERRCODE='23514';END IF;
 SELECT count(DISTINCT (body-'usage')) INTO terminal_count FROM generation_submission_evidence WHERE attempt_id=e.attempt_id AND body->>'kind' IN ('completed','rejected');
 IF terminal_count>1 OR j.status IN ('succeeded','failed','cancelled') THEN RETURN; END IF;
 IF e.body->>'kind'='unknown' THEN UPDATE generation_jobs SET status='submission_unknown',error_code='SUBMISSION_UNKNOWN',revision=revision+1,updated_at=now() WHERE id=j.id AND status<>'submission_unknown'; RETURN;END IF;
 IF failure IS NOT NULL OR e.body->>'kind'='rejected' THEN UPDATE generation_jobs SET status='failed',error_code=coalesce(failure,'PROVIDER_REJECTED'),revision=revision+1,updated_at=now() WHERE id=j.id;DELETE FROM generation_work WHERE job_id=j.id;RETURN;END IF;
 IF output IS DISTINCT FROM e.body->'output' THEN RAISE EXCEPTION 'Artifact must preserve original output' USING ERRCODE='23514'; END IF;
 FOR reference IN SELECT value FROM jsonb_array_elements(output->'referenceSuggestions') LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.resolved_input->'references') r WHERE ((r->'reference')-'note')=(reference-'note')) THEN RAISE EXCEPTION 'Model reference was not selected in plan' USING ERRCODE='23514';END IF;
 END LOOP;
 INSERT INTO assistance_artifacts(id,tenant_id,project_id,generation_job_id) VALUES(j.id,j.tenant_id,j.project_id,j.id);
 INSERT INTO assistance_artifact_revisions(tenant_id,project_id,artifact_id,number,body) VALUES(j.tenant_id,j.project_id,j.id,1,output);
 UPDATE generation_jobs SET status='succeeded',assistance_artifact_id=j.id,error_code=NULL,revision=revision+1,updated_at=now() WHERE id=j.id;
 DELETE FROM generation_work WHERE job_id=j.id;
END $$;

CREATE OR REPLACE FUNCTION finish_script_analysis_job(wanted uuid, evidence_id uuid, operations jsonb, failure text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE j generation_jobs; p generation_plans; e generation_submission_evidence; proposal uuid; target jsonb; op jsonb; terminal_count integer;
BEGIN
 IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Worker access required' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM generation_jobs WHERE id=wanted FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT * INTO p FROM generation_plans WHERE id=j.plan_id;
 SELECT ev.* INTO e FROM generation_submission_evidence ev JOIN generation_attempts a ON a.id=ev.attempt_id WHERE ev.id=evidence_id AND a.job_id=j.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Evidence does not belong to this attempt' USING ERRCODE='23514'; END IF;
 SELECT count(DISTINCT (ev.body-'usage')) INTO terminal_count FROM generation_submission_evidence ev WHERE ev.attempt_id=e.attempt_id AND ev.body->>'kind' IN ('completed','rejected');
 IF terminal_count>1 THEN
  IF j.status NOT IN ('succeeded','failed','cancelled') THEN UPDATE generation_jobs SET status='reconciliation_required',error_code='CONFLICTING_SUBMISSION_EVIDENCE',revision=revision+1,updated_at=now() WHERE id=j.id; END IF;
  RETURN;
 END IF;
 IF j.status IN ('succeeded','failed','cancelled') THEN RETURN; END IF;
 IF e.body->>'kind'='unknown' THEN
  UPDATE generation_jobs SET status='submission_unknown',error_code='SUBMISSION_UNKNOWN',revision=revision+1,updated_at=now() WHERE id=j.id AND status<>'submission_unknown'; RETURN;
 END IF;
 IF failure IS NOT NULL OR e.body->>'kind'='rejected' THEN
  UPDATE generation_jobs SET status='failed',error_code=coalesce(failure,'PROVIDER_REJECTED'),revision=revision+1,updated_at=now() WHERE id=j.id;
  DELETE FROM generation_work WHERE job_id=j.id; RETURN;
 END IF;
 target:=p.input->'proposalTarget';
 IF jsonb_typeof(operations)<>'array' OR jsonb_array_length(operations) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid proposal output' USING ERRCODE='23514'; END IF;
 FOR op IN SELECT value FROM jsonb_array_elements(operations) LOOP
  IF op->>'action'<>'create' OR op->>'kind'<>'shot' OR op->'proposed'->>'sceneId'<>target->>'sceneId' OR op->'proposed'->>'status'<>'active'
   OR op->'sourceExcerpts'<>jsonb_build_array(p.resolved_input->'sourceExcerpt') OR op->'proposed'->'spec'->'references'<>'[]' THEN RAISE EXCEPTION 'Output escaped fixed target' USING ERRCODE='23514'; END IF;
 END LOOP;
 proposal:=j.id;
 INSERT INTO analysis_proposals(id,tenant_id,project_id,source_kind,source_hash,import_fingerprint,source_script_revision_id,script_range,source_generation_job_id)
 VALUES(proposal,j.tenant_id,j.project_id,'ai_analysis',p.input_hash,md5(j.id::text)||md5(p.input_hash),(p.input->>'sourceScriptRevisionId')::uuid,p.input->'scriptRange',j.id);
 INSERT INTO analysis_proposal_revisions(tenant_id,project_id,proposal_id,number,base_content_revision,base_content_snapshot,target,target_scene_id,target_episode_id,operations)
 VALUES(j.tenant_id,j.project_id,proposal,1,(p.base_content_snapshot->>'revision')::bigint,p.base_content_snapshot,target,(target->>'sceneId')::uuid,(target->>'episodeId')::uuid,operations);
 UPDATE generation_jobs SET status='succeeded',proposal_id=proposal,error_code=NULL,revision=revision+1,updated_at=now() WHERE id=j.id;
 DELETE FROM generation_work WHERE job_id=j.id;
END $$;

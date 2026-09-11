-- Parenthesize JSON extraction before reference identity subtraction.
CREATE OR REPLACE FUNCTION finish_generation_job(wanted uuid,evidence_id uuid,output jsonb,failure text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
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
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.resolved_input->'references') r WHERE ((r->'reference')-'note')=(reference-'note')) THEN RAISE EXCEPTION 'Model reference was not selected in plan' USING ERRCODE='23514';END IF;
 END LOOP;
 INSERT INTO assistance_artifacts(id,tenant_id,project_id,generation_job_id) VALUES(j.id,j.tenant_id,j.project_id,j.id);
 INSERT INTO assistance_artifact_revisions(tenant_id,project_id,artifact_id,number,body) VALUES(j.tenant_id,j.project_id,j.id,1,output);
 UPDATE generation_jobs SET status='succeeded',assistance_artifact_id=j.id,error_code=NULL,revision=revision+1,updated_at=now() WHERE id=j.id;
 DELETE FROM generation_work WHERE job_id=j.id;
END $$;

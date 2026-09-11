-- Late receipts are evidence, even after a prior completion. Conflicts never rewrite a proposal.
ALTER TABLE generation_jobs DROP CONSTRAINT generation_jobs_check;
ALTER TABLE generation_jobs ADD CHECK((status='succeeded' AND proposal_id IS NOT NULL) OR (status='reconciliation_required') OR (status NOT IN ('succeeded','reconciliation_required') AND proposal_id IS NULL));
CREATE OR REPLACE FUNCTION record_generation_evidence(attempt uuid, evidence_id uuid, receipt jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE saved uuid; target uuid; distinct_terminal integer;
BEGIN
 IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Worker access required' USING ERRCODE='42501'; END IF;
 IF receipt->>'kind' NOT IN ('completed','rejected','unknown') OR NOT receipt ? 'kind' OR receipt->>'correlation' IS DISTINCT FROM attempt::text THEN RAISE EXCEPTION 'Evidence must bind its durable attempt correlation' USING ERRCODE='23514'; END IF;
 SELECT job_id INTO target FROM generation_attempts WHERE id=attempt;
 IF target IS NULL THEN RAISE EXCEPTION 'Unknown attempt' USING ERRCODE='23514'; END IF;
 PERFORM id FROM generation_jobs WHERE id=target FOR UPDATE;
 INSERT INTO generation_submission_evidence(id,attempt_id,body) VALUES(evidence_id,attempt,receipt) ON CONFLICT(attempt_id,body_hash) DO NOTHING;
 SELECT id INTO saved FROM generation_submission_evidence WHERE attempt_id=attempt AND body=receipt;
 IF saved IS NULL THEN RAISE EXCEPTION 'Conflicting receipt digest' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO distinct_terminal FROM generation_submission_evidence WHERE attempt_id=attempt AND body->>'kind' IN ('completed','rejected');
 IF distinct_terminal>1 THEN
  UPDATE generation_jobs SET status='reconciliation_required',error_code='CONFLICTING_SUBMISSION_EVIDENCE',revision=revision+1,updated_at=now() WHERE id=target AND status<>'reconciliation_required';
 END IF;
 INSERT INTO generation_work(job_id) VALUES(target) ON CONFLICT(job_id) DO NOTHING;
 RETURN saved;
END $$;
-- Generated columns already provide project-local source FKs. Verify the selected bytes too.
CREATE FUNCTION guard_generation_plan_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_text text; selected text; first_offset integer; last_offset integer;
BEGIN
 SELECT text INTO source_text FROM script_revisions WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND id=(NEW.input->>'sourceScriptRevisionId')::uuid;
 first_offset:=(NEW.input->'scriptRange'->>'startOffset')::integer;
 last_offset:=(NEW.input->'scriptRange'->>'endOffset')::integer;
 selected:=substring(source_text FROM first_offset+1 FOR greatest(0,last_offset-first_offset));
 IF source_text IS NULL OR first_offset<0 OR last_offset<=first_offset OR last_offset>length(source_text)
  OR NEW.resolved_input->'sourceExcerpt'->>'scriptRevisionId' IS DISTINCT FROM NEW.input->>'sourceScriptRevisionId'
  OR NEW.resolved_input->'sourceExcerpt'->'range' IS DISTINCT FROM NEW.input->'scriptRange'
  OR NEW.resolved_input->'sourceExcerpt'->>'quote' IS DISTINCT FROM selected THEN RAISE EXCEPTION 'Fixed script source does not match' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER generation_plan_source BEFORE INSERT ON generation_plans FOR EACH ROW EXECUTE FUNCTION guard_generation_plan_source();
REVOKE ALL ON FUNCTION guard_generation_plan_source() FROM PUBLIC;

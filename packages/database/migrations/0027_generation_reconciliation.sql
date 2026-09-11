-- Users may request a hint only for an accessible unresolved job; queue identities remain private.
CREATE FUNCTION request_generation_reconciliation(wanted uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE j generation_jobs;
BEGIN
 SELECT * INTO j FROM generation_jobs WHERE id=wanted AND tenant_id=tenant_scope();
 IF NOT FOUND OR tenant_role(j.tenant_id) NOT IN ('owner','admin') OR project_role(j.project_id) IS NULL THEN RAISE EXCEPTION 'Job unavailable' USING ERRCODE='P0002'; END IF;
 IF j.status NOT IN ('dispatching','submission_unknown','reconciliation_required') THEN RAISE EXCEPTION 'No unresolved submission' USING ERRCODE='23514'; END IF;
 INSERT INTO generation_work(job_id) VALUES(j.id) ON CONFLICT(job_id) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION request_generation_reconciliation(uuid) FROM PUBLIC;

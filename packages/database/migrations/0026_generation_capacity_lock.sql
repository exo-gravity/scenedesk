-- Capability limits aggregate all authorized projects and are serialized on the shared root.
CREATE OR REPLACE FUNCTION generation_submission_allowed(wanted uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE c generation_capabilities; daily integer; pending integer;
BEGIN
 SELECT * INTO c FROM generation_capabilities WHERE id=wanted AND tenant_id=tenant_scope() FOR UPDATE;
 IF NOT FOUND OR tenant_role(c.tenant_id) IS NULL OR NOT c.enabled THEN RETURN false; END IF;
 SELECT count(*) FILTER(WHERE j.created_at>now()-interval '24 hours'),count(*) FILTER(WHERE j.status IN ('queued','dispatching','submission_unknown','reconciliation_required')) INTO daily,pending
 FROM generation_jobs j JOIN generation_plans p ON p.id=j.plan_id WHERE p.capability_id=c.id;
 RETURN daily<c.max_daily_jobs AND pending<100;
END $$;

-- Durable asynchronous provider observations. No real provider capability is enabled.
ALTER TABLE generation_jobs DROP CONSTRAINT generation_jobs_status_check;
ALTER TABLE generation_jobs ADD CHECK(status IN ('queued','dispatching','submission_unknown','provider_pending','provider_running','archiving','archive_failed','succeeded','failed','cancel_requested','cancelled','reconciliation_required'));
ALTER TABLE generation_jobs ADD COLUMN cancel_status text NOT NULL DEFAULT 'not_requested' CHECK(cancel_status IN ('not_requested','requested','unsupported','unknown','confirmed'));
ALTER TABLE generation_jobs ADD COLUMN cancel_requested_at timestamptz;
ALTER TABLE generation_jobs ADD CHECK((cancel_status='not_requested')=(cancel_requested_at IS NULL));

CREATE TABLE generation_provider_bindings (
 attempt_id uuid PRIMARY KEY REFERENCES generation_attempts(id),
 job_id uuid NOT NULL UNIQUE REFERENCES generation_jobs(id),
 tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 connection_version_id uuid NOT NULL,
 provider_job_id text NOT NULL CHECK(length(provider_job_id) BETWEEN 1 AND 512 AND provider_job_id !~ '[[:cntrl:]]'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,connection_version_id,provider_job_id),
 FOREIGN KEY(tenant_id,project_id,job_id) REFERENCES generation_jobs(tenant_id,project_id,id)
);
CREATE FUNCTION guard_generation_provider_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Provider identity is immutable' USING ERRCODE='23514'; END IF;
 IF NOT generation_worker_login() OR NOT EXISTS(SELECT 1 FROM generation_attempts a JOIN generation_jobs j ON j.id=a.job_id WHERE a.id=NEW.attempt_id AND a.job_id=NEW.job_id AND a.connection_version_id=NEW.connection_version_id AND j.tenant_id=NEW.tenant_id AND j.project_id=NEW.project_id) THEN RAISE EXCEPTION 'Provider identity must bind its original attempt' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER generation_provider_binding_fixed BEFORE INSERT OR UPDATE OR DELETE ON generation_provider_bindings FOR EACH ROW EXECUTE FUNCTION guard_generation_provider_binding();
ALTER TABLE generation_provider_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_provider_bindings FORCE ROW LEVEL SECURITY;
CREATE POLICY generation_provider_binding_scope ON generation_provider_bindings USING(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL) WITH CHECK(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL);

-- The isolated worker can only access this mutable scheduling projection through functions.
CREATE TABLE generation_observation_control (
 job_id uuid PRIMARY KEY REFERENCES generation_jobs(id),
 next_observation_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid, lease_until timestamptz,
 observation_failures integer NOT NULL DEFAULT 0 CHECK(observation_failures BETWEEN 0 AND 1000000),
 cancel_attempted boolean NOT NULL DEFAULT false,
 CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
ALTER TABLE generation_observation_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_observation_control FORCE ROW LEVEL SECURITY;

CREATE TABLE generation_applied_observations (
 evidence_id uuid PRIMARY KEY REFERENCES generation_submission_evidence(id),
 job_id uuid NOT NULL REFERENCES generation_jobs(id),
 applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE generation_applied_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_applied_observations FORCE ROW LEVEL SECURITY;

CREATE FUNCTION guard_generation_initial_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status<>'queued' OR NEW.cancel_status<>'not_requested' OR NEW.cancel_requested_at IS NOT NULL OR NEW.proposal_id IS NOT NULL OR NEW.assistance_artifact_id IS NOT NULL OR NEW.result_media_id IS NOT NULL THEN RAISE EXCEPTION 'A new job must start before dispatch without provider facts' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER generation_initial_job BEFORE INSERT ON generation_jobs FOR EACH ROW EXECUTE FUNCTION guard_generation_initial_job();

CREATE OR REPLACE FUNCTION read_generation_evidence(wanted uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE j generation_jobs; p generation_plans; a generation_attempts; provider_id text; failures integer;
BEGIN
 IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Worker access required' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM generation_jobs WHERE id=wanted;
 SELECT * INTO p FROM generation_plans WHERE id=j.plan_id;
 SELECT * INTO a FROM generation_attempts WHERE job_id=j.id;
 IF a.id IS NULL THEN RETURN NULL; END IF;
 SELECT provider_job_id INTO provider_id FROM generation_provider_bindings WHERE job_id=j.id;
 SELECT observation_failures INTO failures FROM generation_observation_control WHERE job_id=j.id;
 RETURN jsonb_build_object('jobId',j.id,'attemptId',a.id,'status',j.status,'connectionVersionId',p.connection_version_id,'requestHash',p.input_hash,'input',p.input,'resolvedInput',p.resolved_input,'executionMode',p.execution_mode,'cancelStatus',j.cancel_status,'observationFailures',coalesce(failures,0),'evidence',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'body',e.body) ORDER BY e.created_at,e.id) FROM generation_submission_evidence e WHERE e.attempt_id=a.id),'[]'))
  || CASE WHEN provider_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('providerJobId',provider_id) END
  || CASE WHEN j.cancel_requested_at IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('cancelRequestedAt',j.cancel_requested_at) END;
END $$;

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
 conflicting:=conflicting OR (SELECT count(*)>1 FROM generation_submission_evidence WHERE attempt_id=attempt AND body->>'kind' IN ('completed','rejected','failed','cancelled'));
 conflicting:=conflicting OR (EXISTS(SELECT 1 FROM generation_submission_evidence WHERE attempt_id=attempt AND body ? 'providerJobId') AND EXISTS(SELECT 1 FROM generation_submission_evidence WHERE attempt_id=attempt AND (body->>'kind'='rejected' OR (body->>'kind'='completed' AND NOT body ? 'providerJobId'))));
 IF conflicting THEN UPDATE generation_jobs SET status='reconciliation_required',error_code='CONFLICTING_SUBMISSION_EVIDENCE',revision=revision+1,updated_at=now() WHERE id=target AND (status<>'reconciliation_required' OR error_code IS DISTINCT FROM 'CONFLICTING_SUBMISSION_EVIDENCE'); END IF;
 INSERT INTO generation_work(job_id) VALUES(target) ON CONFLICT(job_id) DO NOTHING;
 RETURN saved;
END $$;

-- Keep existing typed text/media output validation and the separate media archival transaction.
ALTER FUNCTION finish_generation_job(uuid,uuid,jsonb,text) RENAME TO finish_generation_output;
DO $$ DECLARE role_name name; BEGIN
 SELECT worker_role INTO role_name FROM generation_runtime_identity WHERE singleton;
 IF role_name IS NOT NULL THEN EXECUTE format('REVOKE EXECUTE ON FUNCTION finish_generation_output(uuid,uuid,jsonb,text) FROM %I',role_name); END IF;
END $$;
CREATE FUNCTION finish_generation_job(wanted uuid,evidence_id uuid,output jsonb,failure text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE j generation_jobs; a generation_attempts; e generation_submission_evidence; k text; next_status text; provider_id text; bound generation_provider_bindings; next_cancel text; applied uuid;
BEGIN
 IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Worker access required' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM generation_jobs WHERE id=wanted FOR UPDATE; IF NOT FOUND THEN RETURN; END IF;
 SELECT * INTO a FROM generation_attempts WHERE job_id=j.id;
 SELECT * INTO e FROM generation_submission_evidence WHERE id=evidence_id AND attempt_id=a.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Evidence does not belong to attempt' USING ERRCODE='23514'; END IF;
 INSERT INTO generation_applied_observations(evidence_id,job_id) VALUES(e.id,j.id) ON CONFLICT ON CONSTRAINT generation_applied_observations_pkey DO NOTHING RETURNING generation_applied_observations.evidence_id INTO applied;
 IF applied IS NULL OR j.error_code IN ('CONFLICTING_SUBMISSION_EVIDENCE','CONFLICTING_PROVIDER_ID') THEN RETURN; END IF;
 k:=e.body->>'kind'; provider_id:=e.body->>'providerJobId';
 IF provider_id IS NOT NULL THEN
  INSERT INTO generation_provider_bindings(attempt_id,job_id,tenant_id,project_id,connection_version_id,provider_job_id) VALUES(a.id,j.id,j.tenant_id,j.project_id,a.connection_version_id,provider_id) ON CONFLICT DO NOTHING;
  SELECT * INTO bound FROM generation_provider_bindings WHERE attempt_id=a.id;
  IF bound.attempt_id IS NULL OR bound.provider_job_id<>provider_id THEN
   UPDATE generation_jobs SET status='reconciliation_required',error_code='CONFLICTING_PROVIDER_ID',revision=revision+1,updated_at=now() WHERE id=j.id; RETURN;
  END IF;
 END IF;
 IF k IN ('cancel_requested','cancel_unsupported','cancel_unknown') THEN
  IF j.cancel_status='not_requested' OR NOT EXISTS(SELECT 1 FROM generation_observation_control WHERE job_id=j.id AND cancel_attempted) THEN RAISE EXCEPTION 'Cancellation receipt requires the original durable cancellation attempt' USING ERRCODE='23514'; END IF;
  IF j.cancel_status='confirmed' OR j.status IN ('succeeded','failed','cancelled','archiving','archive_failed') THEN RETURN; END IF;
  next_cancel:=CASE k WHEN 'cancel_requested' THEN 'requested' WHEN 'cancel_unsupported' THEN 'unsupported' ELSE 'unknown' END;
  -- Late unconfirmed cancellation observations cannot replace a stronger recorded acknowledgement.
  IF (j.cancel_status='unsupported' AND next_cancel IN ('requested','unknown')) OR (j.cancel_status='unknown' AND next_cancel='requested' AND EXISTS(SELECT 1 FROM generation_submission_evidence WHERE attempt_id=a.id AND body->>'kind'='cancel_unsupported')) THEN RETURN; END IF;
  IF j.cancel_status<>next_cancel THEN UPDATE generation_jobs SET cancel_status=next_cancel,revision=revision+1,updated_at=now() WHERE id=j.id; END IF;
  RETURN;
 END IF;
 IF j.status IN ('succeeded','failed','cancelled','archiving','archive_failed') THEN RETURN; END IF;
 IF k IN ('accepted','pending','running') THEN
  next_status:=CASE WHEN j.cancel_status<>'not_requested' THEN 'cancel_requested' WHEN k='running' OR j.status='provider_running' THEN 'provider_running' ELSE 'provider_pending' END;
  IF j.status<>next_status THEN UPDATE generation_jobs SET status=next_status,error_code=NULL,revision=revision+1,updated_at=now() WHERE id=j.id; END IF;
  INSERT INTO generation_observation_control(job_id) VALUES(j.id) ON CONFLICT(job_id) DO NOTHING;
 ELSIF k='unknown' THEN
  IF NOT EXISTS(SELECT 1 FROM generation_provider_bindings WHERE job_id=j.id) AND j.status='dispatching' THEN UPDATE generation_jobs SET status='submission_unknown',error_code='SUBMISSION_UNKNOWN',revision=revision+1,updated_at=now() WHERE id=j.id; END IF;
 ELSIF k='unavailable' THEN
  -- No result or billing inference from 404/429/timeouts. Retain original task identity.
  NULL;
 ELSIF k IN ('failed','cancelled') THEN
  UPDATE generation_jobs SET status=CASE k WHEN 'failed' THEN 'failed' ELSE 'cancelled' END,error_code=CASE k WHEN 'failed' THEN e.body->>'code' ELSE 'PROVIDER_CANCELLED' END,cancel_status=CASE WHEN k='cancelled' AND cancel_requested_at IS NOT NULL THEN 'confirmed' ELSE cancel_status END,revision=revision+1,updated_at=now() WHERE id=j.id;
  DELETE FROM generation_work WHERE job_id=j.id;
 ELSE
  PERFORM finish_generation_output(wanted,evidence_id,output,failure);
 END IF;
END $$;

CREATE FUNCTION request_generation_cancel(wanted uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE j generation_jobs;
BEGIN
 SELECT * INTO j FROM generation_jobs WHERE id=wanted AND tenant_id=tenant_scope();
 IF NOT FOUND OR project_role(j.project_id) IS NULL THEN RAISE EXCEPTION 'Job unavailable' USING ERRCODE='P0002'; END IF;
 PERFORM 1 FROM tenants WHERE id=j.tenant_id FOR SHARE;
 PERFORM 1 FROM projects WHERE id=j.project_id FOR SHARE;
 SELECT * INTO j FROM generation_jobs WHERE id=wanted FOR UPDATE;
 IF project_role(j.project_id) IS NULL THEN RAISE EXCEPTION 'Job unavailable' USING ERRCODE='P0002'; END IF;
 IF j.status IN ('succeeded','failed','cancelled','archiving','archive_failed') OR j.cancel_requested_at IS NOT NULL THEN RETURN; END IF;
 IF j.status='queued' THEN
  UPDATE generation_jobs SET status='cancelled',cancel_status='confirmed',cancel_requested_at=now(),error_code='CANCELLED_BEFORE_DISPATCH',revision=revision+1,updated_at=now() WHERE id=j.id;
  DELETE FROM generation_work WHERE job_id=j.id;
 ELSE
  UPDATE generation_jobs SET cancel_status='requested',cancel_requested_at=now(),status=CASE WHEN status IN ('provider_pending','provider_running') THEN 'cancel_requested' ELSE status END,revision=revision+1,updated_at=now() WHERE id=j.id;
  INSERT INTO generation_work(job_id) VALUES(j.id) ON CONFLICT(job_id) DO NOTHING;
  INSERT INTO generation_observation_control(job_id) VALUES(j.id) ON CONFLICT(job_id) DO UPDATE SET next_observation_at=least(generation_observation_control.next_observation_at,now());
 END IF;
END $$;

CREATE FUNCTION claim_generation_observation(wanted uuid,token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
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
 UPDATE generation_observation_control SET lease_token=token,lease_until=now()+interval '60 seconds',observation_failures=least(observation_failures+1,1000000),cancel_attempted=cancel_attempted OR action='cancel' WHERE job_id=j.id;
 -- A worker crash after this commit cannot cause a second cancellation request.
 IF action='query' AND ctl.cancel_attempted AND j.cancel_status='requested' AND NOT EXISTS(SELECT 1 FROM generation_submission_evidence e JOIN generation_attempts a ON a.id=e.attempt_id WHERE a.job_id=j.id AND e.body->>'kind' IN ('cancel_requested','cancel_unsupported','cancel_unknown','cancelled')) THEN UPDATE generation_jobs SET cancel_status='unknown',revision=revision+1,updated_at=now() WHERE id=j.id; END IF;
 RETURN read_generation_evidence(j.id)||jsonb_build_object('action',action,'leaseToken',token,'observationFailures',prior_failures);
END $$;
CREATE FUNCTION release_generation_observation(wanted uuid,token uuid,delay_seconds integer,failed boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE changed integer;
BEGIN
 IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Worker access required' USING ERRCODE='42501'; END IF;
 IF delay_seconds IS NULL OR delay_seconds NOT BETWEEN 1 AND 300 OR failed IS NULL THEN RAISE EXCEPTION 'Bounded observation delay required' USING ERRCODE='23514'; END IF;
 UPDATE generation_observation_control SET lease_token=NULL,lease_until=NULL,next_observation_at=now()+make_interval(secs=>delay_seconds),observation_failures=CASE WHEN failed THEN observation_failures ELSE 0 END WHERE job_id=wanted AND lease_token=token AND lease_until>now();
 GET DIAGNOSTICS changed=ROW_COUNT; RETURN changed=1;
END $$;
CREATE OR REPLACE FUNCTION scan_generation_work(n integer) RETURNS SETOF uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Worker access required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT w.job_id FROM generation_work w JOIN generation_jobs j ON j.id=w.job_id LEFT JOIN generation_observation_control c ON c.job_id=j.id
 WHERE j.status IN ('queued','dispatching','submission_unknown','provider_pending','provider_running','cancel_requested','reconciliation_required')
 AND (j.status IN ('queued','dispatching') OR ((c.next_observation_at IS NULL OR c.next_observation_at<=now()) AND (c.lease_until IS NULL OR c.lease_until<=now())))
 AND coalesce(j.error_code,'') NOT IN ('CONFLICTING_SUBMISSION_EVIDENCE','CONFLICTING_PROVIDER_ID') ORDER BY w.requested_at,w.job_id LIMIT greatest(1,least(n,100));
END $$;

-- Retain all image/video/audio checks. Rework freshness applies only before the first durable attempt.
CREATE OR REPLACE FUNCTION claim_generation_job(wanted uuid, token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE j generation_jobs; p generation_plans; c generation_capabilities; a generation_attempts; prior_actor text; prior_tenant text;
BEGIN
 IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Worker access required' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM generation_jobs WHERE id=wanted;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- Same tenant -> project lock order as permission changes and API mutations.
 PERFORM 1 FROM tenants WHERE id=j.tenant_id FOR SHARE;
 PERFORM 1 FROM projects WHERE id=j.project_id FOR SHARE;
 SELECT * INTO j FROM generation_jobs WHERE id=wanted FOR UPDATE;
 SELECT * INTO p FROM generation_plans WHERE id=j.plan_id;
 SELECT * INTO c FROM generation_capabilities WHERE id=p.capability_id FOR UPDATE;
 IF j.status <> 'queued' THEN
  IF j.status='dispatching' AND EXISTS(SELECT 1 FROM generation_attempts WHERE job_id=j.id AND deadline<now()) THEN
   UPDATE generation_jobs SET status='submission_unknown',error_code='SUBMISSION_UNKNOWN',revision=revision+1,updated_at=now() WHERE id=j.id;
  END IF;
  RETURN NULL;
 END IF;
 prior_actor:=current_setting('app.user_id',true); prior_tenant:=current_setting('app.tenant_id',true);
 PERFORM set_config('app.user_id',j.created_by::text,true),set_config('app.tenant_id',j.tenant_id::text,true);
 IF project_role(j.project_id) IS NULL OR NOT EXISTS(SELECT 1 FROM projects WHERE id=j.project_id AND status='active') OR NOT c.enabled OR c.revision<>p.capability_revision OR c.connection_version_id<>p.connection_version_id THEN
  UPDATE generation_jobs SET status='cancelled',error_code='EXECUTION_AUTHORITY_CHANGED',revision=revision+1,updated_at=now() WHERE id=j.id;
  DELETE FROM generation_work WHERE job_id=j.id;
  PERFORM set_config('app.user_id',coalesce(prior_actor,''),true),set_config('app.tenant_id',coalesce(prior_tenant,''),true);
  RETURN NULL;
 END IF;
 IF p.input->'assistance'->>'kind'='prepare_rework' AND NOT rework_source_current(p.id) THEN
  UPDATE generation_jobs SET status='cancelled',error_code='REWORK_SOURCE_CHANGED',revision=revision+1,updated_at=now() WHERE id=j.id;
  DELETE FROM generation_work WHERE job_id=j.id;
  PERFORM set_config('app.user_id',coalesce(prior_actor,''),true),set_config('app.tenant_id',coalesce(prior_tenant,''),true);
  RETURN NULL;
 END IF;
 IF p.input->>'purpose' IN ('image','video','audio') AND (EXISTS(
  SELECT 1 FROM jsonb_array_elements(p.resolved_input->'references') item LEFT JOIN media m ON m.id=(item->'reference'->>'mediaId')::uuid AND m.tenant_id=j.tenant_id
  WHERE m.id IS NULL OR m.status<>'ready' OR (m.project_id IS NOT NULL AND m.project_id<>j.project_id)
   OR (item->'reference' ? 'assetRevisionId' AND (NOT asset_revision_usable(j.tenant_id,j.project_id,(item->'reference'->>'assetRevisionId')::uuid,false) OR NOT EXISTS(SELECT 1 FROM asset_revision_media arm WHERE arm.tenant_id=j.tenant_id AND arm.asset_revision_id=(item->'reference'->>'assetRevisionId')::uuid AND arm.media_id=m.id)))
   OR (item->'reference' ? 'subjectAssetId' AND NOT asset_identity_usable(j.tenant_id,j.project_id,(item->'reference'->>'subjectAssetId')::uuid,false))
 ) OR (p.input->>'purpose'='audio' AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.resolved_input->'dependencies') dep WHERE dep->>'kind'='asset_revision' AND NOT asset_revision_usable(j.tenant_id,j.project_id,(dep->>'objectId')::uuid,false)))) THEN
  UPDATE generation_jobs SET status='cancelled',error_code='EXECUTION_SOURCE_UNAVAILABLE',revision=revision+1,updated_at=now() WHERE id=j.id;
  DELETE FROM generation_work WHERE job_id=j.id;
  PERFORM set_config('app.user_id',coalesce(prior_actor,''),true),set_config('app.tenant_id',coalesce(prior_tenant,''),true);
  RETURN NULL;
 END IF;
 PERFORM set_config('app.user_id',coalesce(prior_actor,''),true),set_config('app.tenant_id',coalesce(prior_tenant,''),true);
 -- Unknown attempts count against the cap indefinitely; timeout never frees a paid slot.
 IF (SELECT count(*) FROM generation_jobs x JOIN generation_plans xp ON xp.id=x.plan_id WHERE xp.capability_id=c.id AND x.status IN ('dispatching','submission_unknown','provider_pending','provider_running','cancel_requested','reconciliation_required')) >= c.max_inflight THEN RETURN NULL; END IF;
 INSERT INTO generation_attempts(id,job_id,connection_version_id,request_hash,dispatch_token) VALUES(token,j.id,p.connection_version_id,p.input_hash,token) RETURNING * INTO a;
 UPDATE generation_jobs SET status='dispatching',revision=revision+1,updated_at=now() WHERE id=j.id;
 RETURN jsonb_build_object('attemptId',a.id,'jobId',j.id,'connectionVersionId',p.connection_version_id,'requestHash',p.input_hash,'input',p.input,'resolvedInput',p.resolved_input,'executionMode',p.execution_mode);
END $$;

-- Capability limits aggregate all authorized projects and are serialized on the shared root.
CREATE OR REPLACE FUNCTION generation_submission_allowed(wanted uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE c generation_capabilities; daily integer; pending integer;
BEGIN
 SELECT * INTO c FROM generation_capabilities WHERE id=wanted AND tenant_id=tenant_scope() FOR UPDATE;
 IF NOT FOUND OR tenant_role(c.tenant_id) IS NULL OR NOT c.enabled THEN RETURN false; END IF;
 SELECT count(*) FILTER(WHERE j.created_at>now()-interval '24 hours'),count(*) FILTER(WHERE j.status IN ('queued','dispatching','submission_unknown','provider_pending','provider_running','cancel_requested','reconciliation_required')) INTO daily,pending
 FROM generation_jobs j JOIN generation_plans p ON p.id=j.plan_id WHERE p.capability_id=c.id;
 RETURN daily<c.max_daily_jobs AND pending<100;
END $$;

REVOKE ALL ON generation_provider_bindings,generation_observation_control,generation_applied_observations FROM PUBLIC;
REVOKE ALL ON FUNCTION guard_generation_provider_binding(),guard_generation_initial_job(),request_generation_cancel(uuid),claim_generation_observation(uuid,uuid),release_generation_observation(uuid,uuid,integer,boolean),finish_generation_output(uuid,uuid,jsonb,text),finish_generation_job(uuid,uuid,jsonb,text) FROM PUBLIC;

-- Fixed text-assistance execution. No provider is enabled by this migration.
CREATE TABLE generation_capabilities (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 connection_id uuid NOT NULL, connection_version_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision > 0), definition jsonb NOT NULL,
 execution_mode text NOT NULL CHECK(execution_mode IN ('test_fixture','verified_provider')),
 enabled boolean NOT NULL DEFAULT false,
 max_inflight integer NOT NULL CHECK(max_inflight BETWEEN 1 AND 8),
 max_daily_jobs integer NOT NULL CHECK(max_daily_jobs BETWEEN 1 AND 1000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,id,connection_version_id)
);
CREATE TABLE generation_plans (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 capability_id uuid NOT NULL, connection_version_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), input jsonb NOT NULL,
 resolved_input jsonb NOT NULL, input_hash text NOT NULL CHECK(input_hash ~ '^[0-9a-f]{64}$'),
 capability_revision bigint NOT NULL CHECK(capability_revision > 0),
 base_content_snapshot jsonb NOT NULL,
 cost_estimate jsonb, blocking_reasons jsonb NOT NULL DEFAULT '[]',
 execution_mode text NOT NULL CHECK(execution_mode IN ('test_fixture','verified_provider')),
 status text NOT NULL CHECK(status IN ('ready','blocked','consumed','expired')),
 revision bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 UNIQUE(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY(tenant_id,capability_id,connection_version_id) REFERENCES generation_capabilities(tenant_id,id,connection_version_id),
 CHECK(input->>'purpose'='script_analysis' AND input->>'scope'='project' AND (input->>'projectId')::uuid=project_id),
 CHECK(input->'proposalTarget'->>'mode'='append_to_scene'),
 CHECK(status <> 'ready' OR (cost_estimate IS NOT NULL AND blocking_reasons='[]'))
);
CREATE TABLE generation_jobs (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 plan_id uuid NOT NULL UNIQUE, created_by uuid NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','dispatching','submission_unknown','succeeded','failed','cancelled','reconciliation_required')),
 proposal_id uuid, error_code text, revision bigint NOT NULL DEFAULT 1,
 recovery_epoch bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,plan_id) REFERENCES generation_plans(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,proposal_id) REFERENCES analysis_proposals(tenant_id,project_id,id),
 CHECK((status='succeeded')=(proposal_id IS NOT NULL))
);
CREATE TABLE generation_attempts (
 id uuid PRIMARY KEY, job_id uuid NOT NULL UNIQUE REFERENCES generation_jobs(id),
 connection_version_id uuid NOT NULL, request_hash text NOT NULL,
 dispatch_token uuid NOT NULL UNIQUE, started_at timestamptz NOT NULL DEFAULT now(),
 deadline timestamptz NOT NULL DEFAULT now()+interval '2 minutes'
);
CREATE TABLE generation_submission_evidence (
 id uuid PRIMARY KEY, attempt_id uuid NOT NULL REFERENCES generation_attempts(id),
 body jsonb NOT NULL CHECK(jsonb_typeof(body)='object' AND octet_length(body::text)<=524288),
 created_at timestamptz NOT NULL DEFAULT now(),
 body_hash text GENERATED ALWAYS AS (md5(body::text)) STORED,
 UNIQUE(attempt_id,body_hash)
);
CREATE TABLE generation_work (
 job_id uuid PRIMARY KEY REFERENCES generation_jobs(id), requested_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE generation_runtime_identity (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), worker_role name NOT NULL);
ALTER TABLE analysis_proposals DROP CONSTRAINT analysis_proposals_source_kind_check;
ALTER TABLE analysis_proposals ADD CHECK(source_kind IN ('csv_import','ai_analysis'));
ALTER TABLE analysis_proposals ALTER COLUMN source_csv_text DROP NOT NULL;
ALTER TABLE analysis_proposals ADD COLUMN source_script_revision_id uuid;
ALTER TABLE analysis_proposals ADD COLUMN script_range jsonb;
ALTER TABLE analysis_proposals ADD COLUMN source_generation_job_id uuid;
ALTER TABLE analysis_proposals ADD FOREIGN KEY(tenant_id,project_id,source_script_revision_id) REFERENCES script_revisions(tenant_id,project_id,id);
ALTER TABLE analysis_proposals ADD FOREIGN KEY(tenant_id,project_id,source_generation_job_id) REFERENCES generation_jobs(tenant_id,project_id,id);
ALTER TABLE analysis_proposals ADD UNIQUE(source_generation_job_id);
ALTER TABLE analysis_proposals ADD CHECK((source_kind='csv_import' AND source_csv_text IS NOT NULL AND source_script_revision_id IS NULL AND script_range IS NULL AND source_generation_job_id IS NULL)
 OR (source_kind='ai_analysis' AND source_csv_text IS NULL AND source_script_revision_id IS NOT NULL AND script_range IS NOT NULL AND source_generation_job_id IS NOT NULL));
CREATE FUNCTION guard_generation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='generation_plans' THEN
  IF (to_jsonb(NEW)-ARRAY['status','revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','revision','updated_at']) OR OLD.status NOT IN ('ready','blocked') OR NEW.status NOT IN ('consumed','expired') OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Fixed plan cannot change' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='analysis_proposals' THEN
  IF NEW.source_script_revision_id IS DISTINCT FROM OLD.source_script_revision_id OR NEW.script_range IS DISTINCT FROM OLD.script_range OR NEW.source_generation_job_id IS DISTINCT FROM OLD.source_generation_job_id THEN RAISE EXCEPTION 'AI provenance cannot change' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'Execution evidence is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER generation_plan_fixed BEFORE UPDATE ON generation_plans FOR EACH ROW EXECUTE FUNCTION guard_generation_immutable();
CREATE TRIGGER generation_attempt_fixed BEFORE UPDATE OR DELETE ON generation_attempts FOR EACH ROW EXECUTE FUNCTION guard_generation_immutable();
CREATE TRIGGER generation_evidence_fixed BEFORE UPDATE OR DELETE ON generation_submission_evidence FOR EACH ROW EXECUTE FUNCTION guard_generation_immutable();
CREATE TRIGGER ai_proposal_source_fixed BEFORE UPDATE ON analysis_proposals FOR EACH ROW EXECUTE FUNCTION guard_generation_immutable();
ALTER TABLE generation_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_capabilities FORCE ROW LEVEL SECURITY;
CREATE POLICY generation_capability_read ON generation_capabilities FOR SELECT USING(tenant_id=tenant_scope() AND tenant_role(tenant_id) IS NOT NULL);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['generation_plans','generation_jobs'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY generation_project_scope ON %I USING(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL) WITH CHECK(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL)',t);
 END LOOP;
END $$;
CREATE FUNCTION generation_worker_login() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT EXISTS(SELECT 1 FROM generation_runtime_identity WHERE worker_role=session_user)
$$;
CREATE FUNCTION scan_generation_work(n integer) RETURNS SETOF uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Worker access required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT w.job_id FROM generation_work w JOIN generation_jobs j ON j.id=w.job_id WHERE j.status IN ('queued','dispatching','submission_unknown','reconciliation_required') ORDER BY w.requested_at LIMIT greatest(1,least(n,100));
END $$;
CREATE FUNCTION claim_generation_job(wanted uuid, token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
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
 PERFORM set_config('app.user_id',coalesce(prior_actor,''),true),set_config('app.tenant_id',coalesce(prior_tenant,''),true);
 -- Unknown attempts count against the cap indefinitely; timeout never frees a paid slot.
 IF (SELECT count(*) FROM generation_jobs x JOIN generation_plans xp ON xp.id=x.plan_id WHERE xp.capability_id=c.id AND x.status IN ('dispatching','submission_unknown','reconciliation_required')) >= c.max_inflight THEN RETURN NULL; END IF;
 INSERT INTO generation_attempts(id,job_id,connection_version_id,request_hash,dispatch_token) VALUES(token,j.id,p.connection_version_id,p.input_hash,token) RETURNING * INTO a;
 UPDATE generation_jobs SET status='dispatching',revision=revision+1,updated_at=now() WHERE id=j.id;
 RETURN jsonb_build_object('attemptId',a.id,'jobId',j.id,'connectionVersionId',p.connection_version_id,'requestHash',p.input_hash,'input',p.input,'resolvedInput',p.resolved_input,'executionMode',p.execution_mode);
END $$;
CREATE FUNCTION record_generation_evidence(attempt uuid, evidence_id uuid, receipt jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE saved uuid;
BEGIN
 IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Worker access required' USING ERRCODE='42501'; END IF;
 IF receipt->>'kind' NOT IN ('completed','rejected','unknown') OR NOT receipt ? 'kind' THEN RAISE EXCEPTION 'Invalid evidence' USING ERRCODE='23514'; END IF;
 INSERT INTO generation_submission_evidence(id,attempt_id,body) VALUES(evidence_id,attempt,receipt) ON CONFLICT(attempt_id,body_hash) DO NOTHING;
 SELECT id INTO saved FROM generation_submission_evidence WHERE attempt_id=attempt AND body=receipt;
 RETURN saved;
END $$;
CREATE FUNCTION read_generation_evidence(wanted uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE j generation_jobs; p generation_plans; a generation_attempts;
BEGIN
 IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Worker access required' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM generation_jobs WHERE id=wanted;
 SELECT * INTO p FROM generation_plans WHERE id=j.plan_id;
 SELECT * INTO a FROM generation_attempts WHERE job_id=j.id;
 IF a.id IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('jobId',j.id,'attemptId',a.id,'status',j.status,'connectionVersionId',p.connection_version_id,'requestHash',p.input_hash,'input',p.input,'resolvedInput',p.resolved_input,'executionMode',p.execution_mode,'evidence',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'body',e.body) ORDER BY e.created_at,e.id) FROM generation_submission_evidence e WHERE e.attempt_id=a.id),'[]'));
END $$;
-- Only the isolated worker can persist validated output. No user/session endpoint invokes this function.
CREATE FUNCTION finish_generation_job(wanted uuid, evidence_id uuid, operations jsonb, failure text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE j generation_jobs; p generation_plans; e generation_submission_evidence; proposal uuid; target jsonb; op jsonb; terminal_count integer;
BEGIN
 IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Worker access required' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM generation_jobs WHERE id=wanted FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT * INTO p FROM generation_plans WHERE id=j.plan_id;
 SELECT ev.* INTO e FROM generation_submission_evidence ev JOIN generation_attempts a ON a.id=ev.attempt_id WHERE ev.id=evidence_id AND a.job_id=j.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Evidence does not belong to this attempt' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO terminal_count FROM generation_submission_evidence ev WHERE ev.attempt_id=e.attempt_id AND ev.body->>'kind' IN ('completed','rejected');
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
REVOKE ALL ON FUNCTION guard_generation_immutable(),generation_worker_login(),scan_generation_work(integer),claim_generation_job(uuid,uuid),record_generation_evidence(uuid,uuid,jsonb),read_generation_evidence(uuid),finish_generation_job(uuid,uuid,jsonb,text) FROM PUBLIC;
ALTER TABLE generation_plans ADD COLUMN source_script_revision_id uuid GENERATED ALWAYS AS ((input->>'sourceScriptRevisionId')::uuid) STORED;
ALTER TABLE generation_plans ADD COLUMN target_scene_id uuid GENERATED ALWAYS AS ((input->'proposalTarget'->>'sceneId')::uuid) STORED;
ALTER TABLE generation_plans ADD COLUMN target_episode_id uuid GENERATED ALWAYS AS ((input->'proposalTarget'->>'episodeId')::uuid) STORED;
ALTER TABLE generation_plans ADD FOREIGN KEY(tenant_id,project_id,source_script_revision_id) REFERENCES script_revisions(tenant_id,project_id,id);
ALTER TABLE generation_plans ADD FOREIGN KEY(tenant_id,project_id,target_scene_id) REFERENCES scenes(tenant_id,project_id,id);
ALTER TABLE generation_plans ADD FOREIGN KEY(tenant_id,project_id,target_episode_id) REFERENCES episodes(tenant_id,project_id,id);
CREATE FUNCTION guard_generation_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'queued' OR NEW.proposal_id IS NOT NULL OR NEW.created_by<>actor_id() OR NOT EXISTS(SELECT 1 FROM generation_plans p WHERE p.id=NEW.plan_id AND p.status='ready' AND p.expires_at>now()) THEN RAISE EXCEPTION 'Job must consume a ready fixed plan' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','proposal_id','error_code','revision','updated_at','recovery_epoch']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','proposal_id','error_code','revision','updated_at','recovery_epoch']) OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Job identity is immutable' USING ERRCODE='23514'; END IF;
  IF NOT generation_worker_login() AND NOT (OLD.status='queued' AND NEW.status='cancelled' AND NEW.proposal_id IS NULL AND NEW.error_code='CANCELLED_BEFORE_DISPATCH' AND NEW.recovery_epoch=OLD.recovery_epoch) THEN RAISE EXCEPTION 'Worker evidence is required' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER generation_job_guard BEFORE INSERT OR UPDATE ON generation_jobs FOR EACH ROW EXECUTE FUNCTION guard_generation_job();
CREATE FUNCTION generation_submission_allowed(wanted uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE c generation_capabilities; daily integer; pending integer;
BEGIN
 SELECT * INTO c FROM generation_capabilities WHERE id=wanted AND tenant_id=tenant_scope();
 IF NOT FOUND OR tenant_role(c.tenant_id) IS NULL THEN RETURN false; END IF;
 SELECT count(*) FILTER(WHERE j.created_at>now()-interval '24 hours'),count(*) FILTER(WHERE j.status IN ('queued','dispatching','submission_unknown','reconciliation_required')) INTO daily,pending
 FROM generation_jobs j JOIN generation_plans p ON p.id=j.plan_id WHERE p.capability_id=c.id;
 RETURN daily<c.max_daily_jobs AND pending<100;
END $$;
REVOKE ALL ON FUNCTION guard_generation_job(),generation_submission_allowed(uuid) FROM PUBLIC;

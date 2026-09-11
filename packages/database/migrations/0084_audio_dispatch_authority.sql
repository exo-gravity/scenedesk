-- Check fixed reference availability just before first dispatch, never current canvas content.
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
 IF (SELECT count(*) FROM generation_jobs x JOIN generation_plans xp ON xp.id=x.plan_id WHERE xp.capability_id=c.id AND x.status IN ('dispatching','submission_unknown','reconciliation_required')) >= c.max_inflight THEN RETURN NULL; END IF;
 INSERT INTO generation_attempts(id,job_id,connection_version_id,request_hash,dispatch_token) VALUES(token,j.id,p.connection_version_id,p.input_hash,token) RETURNING * INTO a;
 UPDATE generation_jobs SET status='dispatching',revision=revision+1,updated_at=now() WHERE id=j.id;
 RETURN jsonb_build_object('attemptId',a.id,'jobId',j.id,'connectionVersionId',p.connection_version_id,'requestHash',p.input_hash,'input',p.input,'resolvedInput',p.resolved_input,'executionMode',p.execution_mode);
END $$;

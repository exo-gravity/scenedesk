-- Preserve fixed job identity while accepting one authorized cancellation intent.
CREATE OR REPLACE FUNCTION guard_generation_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE archive_actor boolean; archive_recovery boolean; cancellation_intent boolean;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'queued' OR num_nonnulls(NEW.proposal_id,NEW.assistance_artifact_id,NEW.result_media_id)>0 OR NEW.created_by<>actor_id() OR NOT EXISTS(SELECT 1 FROM generation_plans p WHERE p.id=NEW.plan_id AND p.status='ready' AND p.expires_at>now()) THEN RAISE EXCEPTION 'Job must consume a ready fixed plan' USING ERRCODE='23514';END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','proposal_id','assistance_artifact_id','result_media_id','error_code','revision','updated_at','recovery_epoch','cancel_status','cancel_requested_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','proposal_id','assistance_artifact_id','result_media_id','error_code','revision','updated_at','recovery_epoch','cancel_status','cancel_requested_at']) OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Job identity is immutable' USING ERRCODE='23514';END IF;
  IF OLD.cancel_requested_at IS NOT NULL AND NEW.cancel_requested_at IS DISTINCT FROM OLD.cancel_requested_at THEN RAISE EXCEPTION 'Original cancellation intent is immutable' USING ERRCODE='23514'; END IF;
  cancellation_intent:=OLD.cancel_status='not_requested' AND NEW.cancel_requested_at IS NOT NULL AND NEW.tenant_id=tenant_scope() AND project_role(NEW.project_id) IS NOT NULL
   AND NEW.proposal_id IS NOT DISTINCT FROM OLD.proposal_id AND NEW.assistance_artifact_id IS NOT DISTINCT FROM OLD.assistance_artifact_id AND NEW.result_media_id IS NOT DISTINCT FROM OLD.result_media_id AND NEW.recovery_epoch=OLD.recovery_epoch
   AND ((OLD.status='queued' AND NEW.status='cancelled' AND NEW.cancel_status='confirmed' AND NEW.error_code='CANCELLED_BEFORE_DISPATCH')
    OR (OLD.status IN ('dispatching','submission_unknown','provider_pending','provider_running','reconciliation_required') AND NEW.status=CASE WHEN OLD.status IN ('provider_pending','provider_running') THEN 'cancel_requested' ELSE OLD.status END AND NEW.cancel_status='requested' AND NEW.error_code IS NOT DISTINCT FROM OLD.error_code));
  archive_actor:=media_worker_login() AND current_setting('app.generation_archive_job_id',true)=NEW.id::text AND (NEW.status IN ('archiving','archive_failed','succeeded') OR (OLD.status='reconciliation_required' AND NEW.status='reconciliation_required' AND NEW.error_code IS NOT DISTINCT FROM OLD.error_code AND EXISTS(SELECT 1 FROM generation_media_outputs WHERE job_id=NEW.id AND media_id=NEW.result_media_id AND status='accepted')));
  archive_recovery:=OLD.status='archive_failed' AND NEW.status='archiving' AND NEW.error_code IS NULL AND num_nonnulls(NEW.proposal_id,NEW.assistance_artifact_id,NEW.result_media_id)=0 AND EXISTS(SELECT 1 FROM generation_media_outputs WHERE job_id=NEW.id AND status='queued' AND processing_attempts=0 AND issue IS NULL);
  IF NOT generation_worker_login() AND NOT coalesce(archive_actor,false) AND NOT archive_recovery AND NOT coalesce(cancellation_intent,false) AND NOT (OLD.status='queued' AND NEW.status='cancelled' AND num_nonnulls(NEW.proposal_id,NEW.assistance_artifact_id,NEW.result_media_id)=0 AND NEW.error_code='CANCELLED_BEFORE_DISPATCH' AND NEW.recovery_epoch=OLD.recovery_epoch) THEN RAISE EXCEPTION 'Worker evidence is required' USING ERRCODE='42501';END IF;
 END IF;RETURN NEW;
END $$;

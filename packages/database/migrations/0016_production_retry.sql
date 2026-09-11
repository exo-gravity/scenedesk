-- Retryable execution yields its lease while retaining exact artifact receipts.
CREATE FUNCTION yield_media_production(target uuid,attempt uuid,failure_code text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
  PERFORM assert_media_production_lease(target,attempt);
  IF failure_code IS NULL OR failure_code !~ '^[A-Z][A-Z0-9_]{0,159}$' THEN
    RAISE EXCEPTION 'Invalid failure code' USING ERRCODE='22023';
  END IF;
  UPDATE media_production_attempts SET status='expired',lease_expires_at=clock_timestamp(),updated_at=now() WHERE id=attempt;
  UPDATE media_production_copies SET issue=failure_code,updated_at=now() WHERE id=target;
END $$;

-- A new saved-work request may explicitly retry after revalidating its actual source.
CREATE FUNCTION recover_media_production(target uuid,target_media uuid,fixed_profile text) RETURNS media_production_copies
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE previous media_production_copies; result media_production_copies; current_epoch bigint;
BEGIN
  SELECT * INTO previous FROM media_production_copies WHERE id=target AND tenant_id=tenant_scope();
  IF previous.id IS NULL THEN RAISE EXCEPTION 'Production unavailable' USING ERRCODE='42501'; END IF;
  IF lock_tenant(tenant_scope(),false) IS NULL OR lock_project(previous.project_id,false) IS NULL THEN
    RAISE EXCEPTION 'Production project access required' USING ERRCODE='42501';
  END IF;
  IF fixed_profile::jsonb IS DISTINCT FROM previous.profile THEN
    RAISE EXCEPTION 'Recovery profile differs' USING ERRCODE='23514';
  END IF;
  SELECT epoch INTO current_epoch FROM media_processing_state WHERE singleton FOR SHARE;
  SELECT * INTO result FROM media_production_copies WHERE id=target FOR UPDATE;
  previous:=request_media_production(result.project_id,target_media,result.canonical_profile);
  IF previous.id<>target THEN RAISE EXCEPTION 'Recovery source differs' USING ERRCODE='23514'; END IF;
  IF result.status='failed' OR (result.status='processing' AND result.epoch<>current_epoch) THEN
    UPDATE media_production_attempts SET status='expired',lease_expires_at=clock_timestamp(),updated_at=now()
      WHERE id=result.current_attempt_id AND status='leased';
    UPDATE media_production_artifacts SET retired=true WHERE copy_id=target AND step_revision=result.step_revision;
    UPDATE media_production_copies SET status='processing',step_revision=step_revision+1,epoch=current_epoch,
      current_attempt_id=NULL,attempts=0,issue=NULL,updated_at=now() WHERE id=target RETURNING * INTO result;
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION yield_media_production(uuid,uuid,text),recover_media_production(uuid,uuid,text) FROM PUBLIC;

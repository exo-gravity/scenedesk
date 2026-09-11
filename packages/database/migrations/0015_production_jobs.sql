-- Production identities and receipts survive queue delivery and worker leases.
ALTER TABLE media ADD CONSTRAINT media_production_source UNIQUE (tenant_id,id,sha256);
CREATE TABLE media_production_copies (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  source_media_id uuid NOT NULL, source_sha256 text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('video','audio')), has_audio boolean NOT NULL,
  canonical_profile text NOT NULL CHECK (octet_length(canonical_profile) BETWEEN 2 AND 65536),
  profile jsonb GENERATED ALWAYS AS (canonical_profile::jsonb) STORED,
  profile_hash text NOT NULL CHECK (profile_hash=encode(sha256(convert_to(canonical_profile,'UTF8')),'hex')),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','ready','failed')),
  step_revision bigint NOT NULL DEFAULT 1 CHECK (step_revision BETWEEN 1 AND 9007199254740991),
  epoch bigint NOT NULL CHECK (epoch BETWEEN 1 AND 9007199254740991),
  current_attempt_id uuid, attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 6),
  issue text CHECK (length(issue) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,project_id,id), UNIQUE (tenant_id,project_id,id,source_sha256), UNIQUE (tenant_id,project_id,source_sha256,profile_hash),
  FOREIGN KEY (tenant_id,project_id) REFERENCES projects(tenant_id,id),
  FOREIGN KEY (tenant_id,source_media_id,source_sha256) REFERENCES media(tenant_id,id,sha256),
  CHECK (jsonb_typeof(profile)='object' AND profile->>'kind'=kind),
  CHECK (kind<>'audio' OR has_audio)
);
CREATE INDEX production_repair ON media_production_copies(status,updated_at,id);
-- A cache hit still records and validates the caller's actual source identity.
CREATE TABLE media_production_sources (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, copy_id uuid NOT NULL,
  media_id uuid NOT NULL, source_sha256 text NOT NULL,
  PRIMARY KEY (copy_id,media_id),
  FOREIGN KEY (tenant_id,project_id,copy_id,source_sha256) REFERENCES media_production_copies(tenant_id,project_id,id,source_sha256),
  FOREIGN KEY (tenant_id,media_id,source_sha256) REFERENCES media(tenant_id,id,sha256)
);
CREATE TABLE media_production_attempts (
  id uuid PRIMARY KEY, copy_id uuid NOT NULL REFERENCES media_production_copies(id),
  step_revision bigint NOT NULL, host_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'leased' CHECK (status IN ('leased','expired','ready','failed')),
  lease_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(copy_id,id)
);
ALTER TABLE media_production_copies ADD CONSTRAINT production_current_attempt
  FOREIGN KEY (id,current_attempt_id) REFERENCES media_production_attempts(copy_id,id);
CREATE TABLE media_production_artifacts (
  id uuid PRIMARY KEY, copy_id uuid NOT NULL REFERENCES media_production_copies(id), step_revision bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('video','video_map','audio','audio_map')),
  bytes bigint NOT NULL CHECK (bytes BETWEEN 0 AND 8589934592),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  phase text NOT NULL DEFAULT 'reserved' CHECK (phase IN ('reserved','uploading','completing','verified')),
  upload_id text CHECK (length(upload_id) BETWEEN 1 AND 1024 AND upload_id<>'null'),
  storage_version_id text CHECK (length(storage_version_id) BETWEEN 1 AND 1024 AND storage_version_id<>'null'),
  retired boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(copy_id,step_revision,kind), UNIQUE(copy_id,id),
  CHECK ((phase='verified')=(storage_version_id IS NOT NULL)),
  CHECK (kind='audio' OR bytes>0), CHECK (kind<>'audio' OR bytes%16=0),
  CHECK (kind NOT IN ('video_map','audio_map') OR bytes<=268435456)
);
CREATE TABLE media_production_parts (
  artifact_id uuid NOT NULL REFERENCES media_production_artifacts(id), number integer NOT NULL CHECK (number BETWEEN 1 AND 128),
  bytes integer NOT NULL CHECK (bytes BETWEEN 1 AND 67108864),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'), etag text NOT NULL CHECK (length(etag) BETWEEN 1 AND 1024),
  PRIMARY KEY(artifact_id,number)
);
-- Names are derived from these IDs; database rows never authorize arbitrary paths.
CREATE TABLE media_production_resources (
  id uuid PRIMARY KEY, attempt_id uuid NOT NULL REFERENCES media_production_attempts(id),
  kind text NOT NULL CHECK (kind IN ('container','directory')),
  released boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Tombstones remain after a sweep, including for a delayed Docker/MPU create.
CREATE TABLE media_production_cleanup (
  id uuid PRIMARY KEY, artifact_id uuid UNIQUE REFERENCES media_production_artifacts(id),
  resource_id uuid UNIQUE REFERENCES media_production_resources(id),
  claim_id uuid, lease_expires_at timestamptz, last_swept_at timestamptz,
  CHECK (num_nonnulls(artifact_id,resource_id)=1),
  CHECK ((claim_id IS NULL)=(lease_expires_at IS NULL))
);

CREATE FUNCTION production_identity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF TG_TABLE_NAME='media_production_copies' THEN
    IF ROW(NEW.id,NEW.tenant_id,NEW.project_id,NEW.source_media_id,NEW.source_sha256,NEW.kind,NEW.has_audio,NEW.canonical_profile,NEW.profile_hash)
      IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.project_id,OLD.source_media_id,OLD.source_sha256,OLD.kind,OLD.has_audio,OLD.canonical_profile,OLD.profile_hash)
      OR (OLD.status='ready' AND NEW IS DISTINCT FROM OLD) THEN
      RAISE EXCEPTION 'Production identity or ready content is immutable' USING ERRCODE='23514';
    END IF;
  ELSE
    IF ROW(NEW.id,NEW.copy_id,NEW.step_revision,NEW.kind,NEW.bytes,NEW.sha256)
      IS DISTINCT FROM ROW(OLD.id,OLD.copy_id,OLD.step_revision,OLD.kind,OLD.bytes,OLD.sha256)
      OR (OLD.storage_version_id IS NOT NULL AND NEW.storage_version_id IS DISTINCT FROM OLD.storage_version_id)
      OR (OLD.retired AND NOT NEW.retired) THEN
      RAISE EXCEPTION 'Production artifact identity is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER production_copy_identity BEFORE UPDATE ON media_production_copies FOR EACH ROW EXECUTE FUNCTION production_identity_guard();
CREATE TRIGGER production_artifact_identity BEFORE UPDATE ON media_production_artifacts FOR EACH ROW EXECUTE FUNCTION production_identity_guard();

CREATE FUNCTION request_media_production(target_project uuid,target_media uuid,fixed_profile text)
RETURNS media_production_copies LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE source media; result media_production_copies; config jsonb; current_epoch bigint;
BEGIN
  IF lock_tenant(tenant_scope(),false) IS NULL OR lock_project(target_project,false) IS NULL THEN
    RAISE EXCEPTION 'Production project access required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO source FROM media WHERE id=target_media AND tenant_id=tenant_scope()
    AND (project_id=target_project OR scope='shared') FOR SHARE;
  IF source.id IS NULL OR source.kind NOT IN ('video','audio') OR source.sha256 IS NULL OR
    (source.status<>'ready' AND NOT (source.status='archived' AND EXISTS (
      SELECT 1 FROM edit_history_media_refs WHERE project_id=target_project AND media_id=source.id))) THEN
    RAISE EXCEPTION 'Production source is not available in this project' USING ERRCODE='42501';
  END IF;
  IF octet_length(fixed_profile) NOT BETWEEN 2 AND 65536 THEN RAISE EXCEPTION 'Invalid production profile' USING ERRCODE='22023'; END IF;
  config:=fixed_profile::jsonb;
  IF jsonb_typeof(config) IS DISTINCT FROM 'object' OR config->>'kind' IS DISTINCT FROM source.kind
    OR config->>'normalizationVersion' IS DISTINCT FROM 'normalization-v1'
    OR config->>'audioProfile' IS DISTINCT FROM 'stereo-f64le-swr-v1'
    OR config->>'zero' IS DISTINCT FROM (CASE WHEN source.kind='video' THEN 'first-video-pts' ELSE 'first-audio-sample' END)
    OR coalesce(config->>'rendererVersion','') !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$'
    OR coalesce(config->>'imageId','') !~ '^sha256:[a-f0-9]{64}$'
    OR coalesce(config->>'platform','') NOT IN ('linux/amd64','linux/arm64')
    OR (source.kind='video' AND (config->>'videoProfile' IS DISTINCT FROM 'native-ffv1-nut-v1'
      OR coalesce(config->>'rate','') NOT IN ('24/1','25/1','30/1','24000/1001','30000/1001'))) THEN
    RAISE EXCEPTION 'Unsupported production profile' USING ERRCODE='22023';
  END IF;
  IF config - ARRAY['kind','normalizationVersion','audioProfile','zero','rendererVersion','imageId','platform']
      - (CASE WHEN source.kind='video' THEN ARRAY['videoProfile','rate'] ELSE ARRAY[]::text[] END) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Unknown production profile parameter' USING ERRCODE='22023';
  END IF;
  fixed_profile:=config::text;
  SELECT epoch INTO current_epoch FROM media_processing_state WHERE singleton FOR SHARE;
  INSERT INTO media_production_copies(id,tenant_id,project_id,source_media_id,source_sha256,kind,has_audio,canonical_profile,profile_hash,epoch)
    VALUES(gen_random_uuid(),source.tenant_id,target_project,source.id,source.sha256,source.kind,source.has_audio,fixed_profile,
      encode(sha256(convert_to(fixed_profile,'UTF8')),'hex'),current_epoch)
    ON CONFLICT (tenant_id,project_id,source_sha256,profile_hash) DO NOTHING;
  SELECT * INTO result FROM media_production_copies WHERE tenant_id=source.tenant_id AND project_id=target_project
    AND source_sha256=source.sha256 AND profile_hash=encode(sha256(convert_to(fixed_profile,'UTF8')),'hex') FOR SHARE;
  IF result.canonical_profile IS DISTINCT FROM fixed_profile OR result.kind<>source.kind OR result.has_audio<>source.has_audio THEN
    RAISE EXCEPTION 'Production cache identity conflicts' USING ERRCODE='23514';
  END IF;
  INSERT INTO media_production_sources VALUES(source.tenant_id,target_project,result.id,source.id,source.sha256) ON CONFLICT DO NOTHING;
  RETURN result;
END $$;

CREATE FUNCTION claim_media_production(target uuid,expected_step bigint,expected_epoch bigint,host uuid,attempt uuid)
RETURNS media_production_copies LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE result media_production_copies; previous media_production_attempts; current_epoch bigint;
BEGIN
  IF NOT media_worker_login() THEN RAISE EXCEPTION 'Registered worker required' USING ERRCODE='42501'; END IF;
  IF expected_step IS NULL OR expected_step<1 OR expected_epoch IS NULL OR expected_epoch<1 OR host IS NULL OR attempt IS NULL THEN
    RAISE EXCEPTION 'Complete production claim required' USING ERRCODE='22023';
  END IF;
  SELECT epoch INTO current_epoch FROM media_processing_state WHERE singleton FOR SHARE;
  SELECT * INTO result FROM media_production_copies WHERE id=target;
  IF result.id IS NULL THEN RETURN NULL; END IF;
  PERFORM t.id FROM tenants t WHERE t.id=result.tenant_id AND status='active' FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM p.id FROM projects p WHERE p.id=result.project_id AND p.status='active' FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO result FROM media_production_copies WHERE id=target FOR UPDATE;
  IF result.status<>'processing' OR result.step_revision<>expected_step OR result.epoch<>expected_epoch OR current_epoch<>expected_epoch THEN RETURN NULL; END IF;
  SELECT * INTO previous FROM media_production_attempts WHERE id=result.current_attempt_id FOR UPDATE;
  IF previous.status='leased' AND previous.lease_expires_at>clock_timestamp() THEN
    IF previous.id=attempt AND previous.host_id=host THEN RETURN result; END IF;
    RETURN NULL;
  END IF;
  IF previous.id IS NOT NULL AND previous.status='leased' THEN
    UPDATE media_production_attempts SET status='expired',updated_at=now() WHERE id=previous.id;
  END IF;
  IF result.attempts>=6 THEN
    UPDATE media_production_copies SET status='failed',issue='MEDIA_RETRIES_EXHAUSTED',updated_at=now() WHERE id=target;
    UPDATE media_production_artifacts SET retired=true WHERE copy_id=target AND step_revision=expected_step;
    RETURN NULL;
  END IF;
  INSERT INTO media_production_attempts(id,copy_id,step_revision,host_id,lease_expires_at)
    VALUES(attempt,target,expected_step,host,clock_timestamp()+interval '60 seconds');
  UPDATE media_production_copies SET current_attempt_id=attempt,attempts=attempts+1,updated_at=now() WHERE id=target RETURNING * INTO result;
  RETURN result;
END $$;

CREATE FUNCTION assert_media_production_lease(target uuid,attempt uuid)
RETURNS media_production_copies LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE result media_production_copies; current_epoch bigint;
BEGIN
  IF NOT media_worker_login() THEN RAISE EXCEPTION 'Registered worker required' USING ERRCODE='42501'; END IF;
  SELECT epoch INTO current_epoch FROM media_processing_state WHERE singleton FOR SHARE;
  SELECT * INTO result FROM media_production_copies WHERE id=target;
  PERFORM t.id FROM tenants t WHERE t.id=result.tenant_id AND status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Production tenant is unavailable' USING ERRCODE='P0430'; END IF;
  PERFORM p.id FROM projects p WHERE p.id=result.project_id AND status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Production project is unavailable' USING ERRCODE='P0430'; END IF;
  SELECT c.* INTO result FROM media_production_copies c JOIN media_production_attempts a ON a.id=c.current_attempt_id
    WHERE c.id=target AND c.epoch=current_epoch AND c.status='processing' AND a.id=attempt AND a.status='leased'
      AND a.step_revision=c.step_revision AND a.lease_expires_at>clock_timestamp() FOR UPDATE OF c,a;
  IF result.id IS NULL THEN RAISE EXCEPTION 'Production lease expired or superseded' USING ERRCODE='P0430'; END IF;
  RETURN result;
END $$;
CREATE FUNCTION heartbeat_media_production(target uuid,attempt uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
  PERFORM assert_media_production_lease(target,attempt);
  UPDATE media_production_attempts SET lease_expires_at=clock_timestamp()+interval '60 seconds',updated_at=now() WHERE id=attempt;
END $$;

CREATE FUNCTION claim_media_production_cleanup(host uuid,claim uuid,batch_size integer) RETURNS SETOF jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE item record;
BEGIN
  IF NOT media_worker_login() THEN RAISE EXCEPTION 'Registered worker required' USING ERRCODE='42501'; END IF;
  IF host IS NULL OR claim IS NULL OR batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid cleanup claim' USING ERRCODE='22023';
  END IF;
  FOR item IN SELECT j.id,j.artifact_id,j.resource_id FROM media_production_cleanup j
    LEFT JOIN media_production_artifacts a ON a.id=j.artifact_id
    LEFT JOIN media_production_copies c ON c.id=a.copy_id
    LEFT JOIN media_production_resources r ON r.id=j.resource_id
    LEFT JOIN media_production_attempts p ON p.id=r.attempt_id
    WHERE (j.lease_expires_at IS NULL OR j.lease_expires_at<=clock_timestamp())
      AND (j.last_swept_at IS NULL OR j.last_swept_at<clock_timestamp()-interval '1 minute')
      AND ((a.id IS NOT NULL AND (a.retired OR (a.phase='verified' AND c.status='ready')))
        OR (r.id IS NOT NULL AND p.host_id=host AND (r.released OR p.status<>'leased' OR p.lease_expires_at<=clock_timestamp())))
    ORDER BY j.last_swept_at NULLS FIRST,j.id LIMIT batch_size FOR UPDATE OF j SKIP LOCKED
  LOOP
    UPDATE media_production_cleanup SET claim_id=claim,lease_expires_at=clock_timestamp()+interval '60 seconds' WHERE id=item.id;
    IF item.artifact_id IS NOT NULL THEN
      RETURN NEXT jsonb_build_object('id',item.id,'claimId',claim,'artifact',
        (SELECT to_jsonb(a) FROM media_production_artifacts a WHERE id=item.artifact_id));
    ELSE
      RETURN NEXT jsonb_build_object('id',item.id,'claimId',claim,'resource',
        (SELECT to_jsonb(r) FROM media_production_resources r WHERE id=item.resource_id));
    END IF;
  END LOOP;
END $$;
CREATE FUNCTION assert_media_production_cleanup(target uuid,claim uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT media_worker_login() THEN RAISE EXCEPTION 'Registered worker required' USING ERRCODE='42501'; END IF;
  PERFORM id FROM media_production_cleanup WHERE id=target AND claim_id=claim AND lease_expires_at>clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cleanup lease expired or superseded' USING ERRCODE='P0430'; END IF;
END $$;
CREATE FUNCTION finish_media_production_cleanup(target uuid,claim uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
  PERFORM assert_media_production_cleanup(target,claim);
  UPDATE media_production_cleanup SET claim_id=NULL,lease_expires_at=NULL,last_swept_at=now() WHERE id=target;
END $$;

CREATE FUNCTION reserve_media_production_artifact(target uuid,attempt uuid,artifact_kind text,artifact_bytes bigint,artifact_sha text)
RETURNS media_production_artifacts LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE root media_production_copies; result media_production_artifacts;
BEGIN
  root:=assert_media_production_lease(target,attempt);
  IF artifact_kind NOT IN ('video','video_map','audio','audio_map') OR
    (artifact_kind IN ('video','video_map') AND root.kind<>'video') OR
    (artifact_kind IN ('audio','audio_map') AND NOT root.has_audio) THEN
    RAISE EXCEPTION 'Unexpected production artifact kind' USING ERRCODE='22023';
  END IF;
  INSERT INTO media_production_artifacts(id,copy_id,step_revision,kind,bytes,sha256)
    VALUES(gen_random_uuid(),target,root.step_revision,artifact_kind,artifact_bytes,artifact_sha)
    ON CONFLICT (copy_id,step_revision,kind) DO NOTHING;
  SELECT * INTO result FROM media_production_artifacts WHERE copy_id=target AND step_revision=root.step_revision AND kind=artifact_kind;
  IF result.bytes IS DISTINCT FROM artifact_bytes OR result.sha256 IS DISTINCT FROM artifact_sha OR result.retired THEN
    RAISE EXCEPTION 'Production recomputation differs from reserved content' USING ERRCODE='23514';
  END IF;
  INSERT INTO media_production_cleanup(id,artifact_id) VALUES(gen_random_uuid(),result.id) ON CONFLICT DO NOTHING;
  RETURN result;
END $$;

CREATE FUNCTION journal_media_production(target uuid,attempt uuid,artifact uuid,event text,receipt jsonb DEFAULT '{}')
RETURNS media_production_artifacts LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE root media_production_copies; result media_production_artifacts; part_no integer; part_bytes integer; old_part media_production_parts;
BEGIN
  root:=assert_media_production_lease(target,attempt);
  SELECT * INTO result FROM media_production_artifacts WHERE copy_id=target AND id=artifact AND step_revision=root.step_revision AND NOT retired FOR UPDATE;
  IF result.id IS NULL THEN RAISE EXCEPTION 'Artifact is not owned by this production step' USING ERRCODE='42501'; END IF;
  IF event='load' THEN RETURN result;
  ELSIF event='started' THEN
    IF result.bytes<=67108864 OR result.phase NOT IN ('reserved','uploading') OR
      (result.upload_id IS NOT NULL AND result.upload_id IS DISTINCT FROM receipt->>'uploadId') THEN
      RAISE EXCEPTION 'Conflicting multipart identity' USING ERRCODE='23514';
    END IF;
    UPDATE media_production_artifacts SET upload_id=receipt->>'uploadId',phase='uploading',updated_at=now() WHERE id=artifact;
    IF receipt->>'uploadId' IS NULL THEN RAISE EXCEPTION 'Upload identity required' USING ERRCODE='23514'; END IF;
  ELSIF event='part' THEN
    part_no:=(receipt->>'number')::integer; part_bytes:=(receipt->>'bytes')::integer;
    IF result.phase NOT IN ('uploading','completing') OR result.upload_id IS NULL OR part_no IS NULL OR
      part_bytes IS DISTINCT FROM least(67108864,result.bytes-(part_no::bigint-1)*67108864) OR part_bytes<=0 THEN
      RAISE EXCEPTION 'Invalid multipart receipt' USING ERRCODE='23514';
    END IF;
    SELECT * INTO old_part FROM media_production_parts WHERE artifact_id=artifact AND number=part_no;
    IF old_part.artifact_id IS NOT NULL AND (old_part.sha256 IS DISTINCT FROM receipt->>'sha256' OR old_part.bytes<>part_bytes) THEN
      RAISE EXCEPTION 'Part content changed' USING ERRCODE='23514';
    END IF;
    INSERT INTO media_production_parts VALUES(artifact,part_no,part_bytes,receipt->>'sha256',receipt->>'etag')
      ON CONFLICT (artifact_id,number) DO UPDATE SET etag=EXCLUDED.etag;
  ELSIF event='completing' THEN
    IF result.phase='verified' OR (result.bytes>67108864 AND
      (SELECT coalesce(sum(bytes),0) FROM media_production_parts WHERE artifact_id=artifact)<>result.bytes) THEN
      RAISE EXCEPTION 'Incomplete production upload' USING ERRCODE='23514';
    END IF;
    UPDATE media_production_artifacts SET phase='completing',updated_at=now() WHERE id=artifact;
  ELSIF event='verified' THEN
    IF result.phase NOT IN ('completing','verified') OR receipt->>'key' IS DISTINCT FROM 'productions/'||artifact::text
      OR receipt->>'sha256' IS DISTINCT FROM result.sha256 OR (receipt->>'bytes')::bigint IS DISTINCT FROM result.bytes
      OR receipt->>'versionId' IS NULL OR (result.storage_version_id IS NOT NULL AND result.storage_version_id IS DISTINCT FROM receipt->>'versionId') THEN
      RAISE EXCEPTION 'Invalid verified production receipt' USING ERRCODE='23514';
    END IF;
    UPDATE media_production_artifacts SET phase='verified',storage_version_id=receipt->>'versionId',updated_at=now() WHERE id=artifact;
  ELSE RAISE EXCEPTION 'Unknown production receipt' USING ERRCODE='22023'; END IF;
  SELECT * INTO result FROM media_production_artifacts WHERE id=artifact;
  RETURN result;
END $$;

CREATE FUNCTION finish_media_production(target uuid,attempt uuid,failure_code text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE root media_production_copies; expected integer;
BEGIN
  root:=assert_media_production_lease(target,attempt);
  IF failure_code IS NOT NULL THEN
    IF failure_code !~ '^[A-Z][A-Z0-9_]{0,159}$' THEN RAISE EXCEPTION 'Invalid failure code' USING ERRCODE='22023'; END IF;
    UPDATE media_production_copies SET status='failed',issue=failure_code,updated_at=now() WHERE id=target;
    UPDATE media_production_artifacts SET retired=true WHERE copy_id=target AND step_revision=root.step_revision;
    UPDATE media_production_attempts SET status='failed',updated_at=now() WHERE id=attempt;
  ELSE
    expected:=(CASE WHEN root.kind='video' THEN 2 ELSE 0 END)+(CASE WHEN root.has_audio THEN 2 ELSE 0 END);
    IF (SELECT count(*) FROM media_production_artifacts WHERE copy_id=target AND step_revision=root.step_revision AND phase='verified' AND NOT retired)<>expected THEN
      RAISE EXCEPTION 'All production artifacts must be verified' USING ERRCODE='23514';
    END IF;
    UPDATE media_production_attempts SET status='ready',updated_at=now() WHERE id=attempt;
    UPDATE media_production_copies SET status='ready',issue=NULL,updated_at=now() WHERE id=target;
  END IF;
END $$;

CREATE FUNCTION reserve_media_production_resource(target uuid,attempt uuid,resource_kind text) RETURNS media_production_resources
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE result media_production_resources;
BEGIN
  PERFORM assert_media_production_lease(target,attempt);
  IF (SELECT count(*) FROM media_production_resources WHERE attempt_id=attempt)>=1024 THEN
    RAISE EXCEPTION 'Production resource count exceeds limit' USING ERRCODE='54000';
  END IF;
  INSERT INTO media_production_resources(id,attempt_id,kind) VALUES(gen_random_uuid(),attempt,resource_kind) RETURNING * INTO result;
  INSERT INTO media_production_cleanup(id,resource_id) VALUES(gen_random_uuid(),result.id);
  RETURN result;
END $$;

CREATE FUNCTION read_media_production(target uuid,attempt uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE root media_production_copies;
BEGIN
  IF NOT media_worker_login() THEN RAISE EXCEPTION 'Registered worker required' USING ERRCODE='42501'; END IF;
  IF attempt IS NOT NULL THEN root:=assert_media_production_lease(target,attempt);
  ELSE
    SELECT c.* INTO root FROM media_production_copies c JOIN projects p ON p.id=c.project_id AND p.status='active'
      JOIN tenants t ON t.id=c.tenant_id AND t.status='active' WHERE c.id=target AND c.status='ready';
    IF root.id IS NULL THEN RAISE EXCEPTION 'Ready production unavailable' USING ERRCODE='42501'; END IF;
  END IF;
  RETURN jsonb_build_object('copy',to_jsonb(root),'source',
    (SELECT jsonb_build_object('id',m.id,'key',m.immutable_key,'versionId',m.storage_version_id,'sha256',m.sha256,'bytes',m.bytes,'mime',m.mime)
      FROM media m WHERE m.id=root.source_media_id AND m.tenant_id=root.tenant_id AND m.sha256=root.source_sha256),
    'artifacts',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.kind),'[]') FROM media_production_artifacts a
      WHERE a.copy_id=target AND a.step_revision=root.step_revision));
END $$;
CREATE FUNCTION release_media_production_resource(attempt uuid,resource uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT media_worker_login() THEN RAISE EXCEPTION 'Registered worker required' USING ERRCODE='42501'; END IF;
  UPDATE media_production_resources SET released=true WHERE id=resource AND attempt_id=attempt;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resource ownership differs' USING ERRCODE='42501'; END IF;
END $$;

CREATE FUNCTION scan_media_production(batch_size integer) RETURNS TABLE(task_kind text,business_id uuid,step_revision bigint,epoch bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
  IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 100 OR NOT EXISTS (SELECT 1 FROM media_processing_state WHERE scheduler_role=session_user) THEN
    RAISE EXCEPTION 'Registered scheduler required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT 'media_production'::text,c.id,c.step_revision,c.epoch FROM media_production_copies c
    JOIN media_processing_state s ON s.singleton AND s.epoch=c.epoch
    JOIN tenants t ON t.id=c.tenant_id AND t.status='active' JOIN projects p ON p.id=c.project_id AND p.status='active'
    LEFT JOIN media_production_attempts a ON a.id=c.current_attempt_id
    WHERE c.status='processing' AND (a.id IS NULL OR a.status<>'leased' OR a.lease_expires_at<=clock_timestamp())
    ORDER BY c.updated_at,c.id LIMIT batch_size;
END $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['media_production_copies','media_production_sources','media_production_attempts','media_production_artifacts','media_production_parts','media_production_resources','media_production_cleanup'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  END LOOP;
END $$;
CREATE POLICY production_user_read ON media_production_copies FOR SELECT USING (media_scope_read(tenant_id,project_id));
CREATE POLICY production_source_user_read ON media_production_sources FOR SELECT USING (media_scope_read(tenant_id,project_id));
-- Runtime users never receive raw storage/lease rows; workers use checked functions.
REVOKE ALL ON FUNCTION production_identity_guard(),request_media_production(uuid,uuid,text),
 claim_media_production(uuid,bigint,bigint,uuid,uuid),assert_media_production_lease(uuid,uuid),heartbeat_media_production(uuid,uuid),
 reserve_media_production_artifact(uuid,uuid,text,bigint,text),journal_media_production(uuid,uuid,uuid,text,jsonb),
 finish_media_production(uuid,uuid,text),reserve_media_production_resource(uuid,uuid,text),
 release_media_production_resource(uuid,uuid),scan_media_production(integer),claim_media_production_cleanup(uuid,uuid,integer),
 assert_media_production_cleanup(uuid,uuid),finish_media_production_cleanup(uuid,uuid),read_media_production(uuid,uuid) FROM PUBLIC;

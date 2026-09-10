-- Media bytes are immutable. Upload and derivative roots hold their own work state;
-- the component queue only carries their IDs and expected step/epoch.
CREATE TABLE media_processing_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  epoch bigint NOT NULL DEFAULT 1 CHECK (epoch BETWEEN 1 AND 9007199254740991),
  worker_role name,
  scheduler_role name
);
INSERT INTO media_processing_state(singleton) VALUES (true);

CREATE TABLE upload_intents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid,
  scope text NOT NULL CHECK (scope IN ('project','shared')),
  staging_key text NOT NULL UNIQUE CHECK (staging_key='staging/'||id::text),
  expected_bytes bigint NOT NULL CHECK (expected_bytes BETWEEN 1 AND 268435456),
  expected_sha256 text NOT NULL CHECK (expected_sha256 ~ '^[a-f0-9]{64}$'),
  safe_file_name text NOT NULL CHECK (length(safe_file_name) BETWEEN 1 AND 160),
  mime_hint text NOT NULL,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 160),
  tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags)<=50),
  provenance jsonb NOT NULL DEFAULT '{"status":"unknown"}' CHECK (jsonb_typeof(provenance)='object'),
  created_by uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','uploaded','verifying','accepted','rejected','expired')),
  expires_at timestamptz NOT NULL,
  staging_version_id text,
  step_revision bigint NOT NULL DEFAULT 1 CHECK (step_revision BETWEEN 1 AND 9007199254740991),
  processing_attempts integer NOT NULL DEFAULT 0 CHECK (processing_attempts BETWEEN 0 AND 6),
  epoch bigint NOT NULL CHECK (epoch BETWEEN 1 AND 9007199254740991),
  issue jsonb CHECK (issue IS NULL OR jsonb_typeof(issue)='object'),
  retryable boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,project_id) REFERENCES projects(tenant_id,id),
  CHECK ((scope='project')=(project_id IS NOT NULL)),
  CHECK (staging_version_id IS NULL OR (length(staging_version_id) BETWEEN 1 AND 1024 AND staging_version_id<>'null')),
  CHECK (status NOT IN ('accepted') OR staging_version_id IS NOT NULL)
);
CREATE INDEX upload_work_repair ON upload_intents(status,updated_at,id);

CREATE TABLE media (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  project_id uuid,
  scope text NOT NULL CHECK (scope IN ('project','shared')),
  kind text NOT NULL CHECK (kind IN ('image','video','audio','document')),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','ready','rejected','archived')),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 160),
  safe_original_file_name text NOT NULL CHECK (length(safe_original_file_name) BETWEEN 1 AND 160),
  tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags)<=50),
  provenance jsonb NOT NULL DEFAULT '{"status":"unknown"}' CHECK (jsonb_typeof(provenance)='object'),
  created_by uuid NOT NULL REFERENCES users(id),
  -- Later provider/render/shared-copy migrations add their typed sources and expand
  -- the exactly-one constraint in the same migration; no unbound source IDs exist.
  source_upload_id uuid NOT NULL UNIQUE,
  immutable_key text UNIQUE CHECK (immutable_key ~ '^originals/[a-f0-9-]{36}$'),
  storage_version_id text CHECK (length(storage_version_id) BETWEEN 1 AND 1024 AND storage_version_id<>'null'),
  sha256 text CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  bytes bigint CHECK (bytes BETWEEN 1 AND 268435456),
  mime text NOT NULL,
  duration_us bigint CHECK (duration_us BETWEEN 1 AND 7200000000),
  width integer CHECK (width BETWEEN 1 AND 8192),
  height integer CHECK (height BETWEEN 1 AND 8192),
  fps_num bigint CHECK (fps_num BETWEEN 1 AND 9007199254740991),
  fps_den bigint CHECK (fps_den BETWEEN 1 AND 9007199254740991),
  has_audio boolean,
  probe_metadata jsonb CHECK (probe_metadata IS NULL OR jsonb_typeof(probe_metadata)='object'),
  issue jsonb CHECK (issue IS NULL OR jsonb_typeof(issue)='object'),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id) REFERENCES projects(tenant_id,id),
  FOREIGN KEY (tenant_id,source_upload_id) REFERENCES upload_intents(tenant_id,id),
  CHECK ((scope='project')=(project_id IS NOT NULL)),
  CHECK ((fps_num IS NULL)=(fps_den IS NULL)),
  CHECK (status NOT IN ('ready','archived') OR (immutable_key IS NOT NULL AND storage_version_id IS NOT NULL AND sha256 IS NOT NULL AND bytes IS NOT NULL AND has_audio IS NOT NULL)),
  CHECK (status NOT IN ('ready','archived') OR kind NOT IN ('image','video') OR (width IS NOT NULL AND height IS NOT NULL)),
  CHECK (status NOT IN ('ready','archived') OR kind NOT IN ('video','audio') OR duration_us IS NOT NULL),
  CHECK (status NOT IN ('ready','archived') OR kind<>'video' OR fps_num IS NOT NULL)
);
CREATE INDEX media_scope_browse ON media(tenant_id,scope,project_id,status,created_at,id);
CREATE INDEX media_kind_browse ON media(tenant_id,kind,created_at,id);

CREATE TABLE media_derivatives (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  media_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('poster','proxy')),
  profile_revision integer NOT NULL CHECK (profile_revision=1),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','ready','failed')),
  immutable_key text UNIQUE CHECK (immutable_key ~ '^derivatives/[a-f0-9-]{36}$'),
  storage_version_id text CHECK (length(storage_version_id) BETWEEN 1 AND 1024 AND storage_version_id<>'null'),
  sha256 text CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  bytes bigint CHECK (bytes BETWEEN 1 AND 268435456),
  mime text,
  duration_us bigint CHECK (duration_us BETWEEN 1 AND 7200000000),
  width integer CHECK (width BETWEEN 1 AND 8192),
  height integer CHECK (height BETWEEN 1 AND 8192),
  step_revision bigint NOT NULL DEFAULT 1 CHECK (step_revision BETWEEN 1 AND 9007199254740991),
  processing_attempts integer NOT NULL DEFAULT 0 CHECK (processing_attempts BETWEEN 0 AND 6),
  epoch bigint NOT NULL CHECK (epoch BETWEEN 1 AND 9007199254740991),
  issue jsonb CHECK (issue IS NULL OR jsonb_typeof(issue)='object'),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (media_id,kind,profile_revision),
  FOREIGN KEY (tenant_id,media_id) REFERENCES media(tenant_id,id),
  CHECK (status<>'ready' OR (immutable_key IS NOT NULL AND storage_version_id IS NOT NULL AND sha256 IS NOT NULL AND bytes IS NOT NULL AND mime IS NOT NULL))
);
CREATE INDEX derivative_work_repair ON media_derivatives(status,updated_at,id);

CREATE TABLE upload_provenance_evidence (
  tenant_id uuid NOT NULL,
  upload_id uuid NOT NULL,
  evidence_media_id uuid NOT NULL,
  PRIMARY KEY (upload_id,evidence_media_id),
  FOREIGN KEY (tenant_id,upload_id) REFERENCES upload_intents(tenant_id,id),
  FOREIGN KEY (tenant_id,evidence_media_id) REFERENCES media(tenant_id,id)
);
CREATE INDEX upload_evidence_retention ON upload_provenance_evidence(evidence_media_id);
CREATE TABLE media_provenance_evidence (
  tenant_id uuid NOT NULL,
  media_id uuid NOT NULL,
  evidence_media_id uuid NOT NULL,
  PRIMARY KEY (media_id,evidence_media_id),
  CHECK (media_id<>evidence_media_id),
  FOREIGN KEY (tenant_id,media_id) REFERENCES media(tenant_id,id),
  FOREIGN KEY (tenant_id,evidence_media_id) REFERENCES media(tenant_id,id)
);
CREATE INDEX media_evidence_retention ON media_provenance_evidence(evidence_media_id);

CREATE FUNCTION protect_media_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.scope<>OLD.scope
    OR NEW.source_upload_id<>OLD.source_upload_id OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at
    OR NEW.safe_original_file_name<>OLD.safe_original_file_name OR NEW.revision<>OLD.revision+1 THEN
    RAISE EXCEPTION 'Media identity is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status IN ('ready','archived') AND (NEW.kind,NEW.immutable_key,NEW.storage_version_id,NEW.sha256,NEW.bytes,NEW.mime,NEW.duration_us,NEW.width,NEW.height,NEW.fps_num,NEW.fps_den,NEW.has_audio,NEW.probe_metadata)
    IS DISTINCT FROM (OLD.kind,OLD.immutable_key,OLD.storage_version_id,OLD.sha256,OLD.bytes,OLD.mime,OLD.duration_us,OLD.width,OLD.height,OLD.fps_num,OLD.fps_den,OLD.has_audio,OLD.probe_metadata) THEN
    RAISE EXCEPTION 'Accepted media bytes and probe evidence are immutable' USING ERRCODE='23514';
  END IF;
  IF (OLD.status='archived' AND NEW.status<>'archived') OR (OLD.status='ready' AND NEW.status NOT IN ('ready','archived')) OR (OLD.status='rejected' AND NEW.status<>'rejected') THEN
    RAISE EXCEPTION 'Invalid media state transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER media_identity_immutable BEFORE UPDATE ON media FOR EACH ROW EXECUTE FUNCTION protect_media_identity();
REVOKE ALL ON FUNCTION protect_media_identity() FROM PUBLIC;

CREATE FUNCTION protect_upload_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revision<>OLD.revision+1 OR (NEW.id,NEW.tenant_id,NEW.project_id,NEW.scope,NEW.staging_key,NEW.expected_bytes,NEW.expected_sha256,NEW.safe_file_name,NEW.mime_hint,NEW.display_name,NEW.tags,NEW.provenance,NEW.created_by,NEW.expires_at,NEW.epoch,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.project_id,OLD.scope,OLD.staging_key,OLD.expected_bytes,OLD.expected_sha256,OLD.safe_file_name,OLD.mime_hint,OLD.display_name,OLD.tags,OLD.provenance,OLD.created_by,OLD.expires_at,OLD.epoch,OLD.created_at)
    OR (OLD.staging_version_id IS NOT NULL AND NEW.staging_version_id IS DISTINCT FROM OLD.staging_version_id)
    OR OLD.status IN ('accepted','rejected','expired') THEN
    RAISE EXCEPTION 'Upload declaration and accepted version are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER upload_identity_immutable BEFORE UPDATE ON upload_intents FOR EACH ROW EXECUTE FUNCTION protect_upload_identity();
REVOKE ALL ON FUNCTION protect_upload_identity() FROM PUBLIC;

CREATE FUNCTION protect_derivative_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revision<>OLD.revision+1 OR (NEW.id,NEW.tenant_id,NEW.media_id,NEW.kind,NEW.profile_revision,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.media_id,OLD.kind,OLD.profile_revision,OLD.created_at) OR OLD.status='ready' THEN
    RAISE EXCEPTION 'Derivative identity and ready output are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER derivative_identity_immutable BEFORE UPDATE ON media_derivatives FOR EACH ROW EXECUTE FUNCTION protect_derivative_identity();
REVOKE ALL ON FUNCTION protect_derivative_identity() FROM PUBLIC;

CREATE FUNCTION validate_media_source() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE source upload_intents;
BEGIN
  SELECT * INTO source FROM upload_intents WHERE tenant_id=NEW.tenant_id AND id=NEW.source_upload_id;
  IF source.id IS NULL OR source.project_id IS DISTINCT FROM NEW.project_id OR source.scope<>NEW.scope
    OR source.created_by<>NEW.created_by OR source.safe_file_name<>NEW.safe_original_file_name THEN
    RAISE EXCEPTION 'Media must match its actual upload source' USING ERRCODE='23514';
  END IF;
  IF NEW.status IN ('ready','archived') AND (NEW.bytes<>source.expected_bytes OR NEW.sha256<>source.expected_sha256 OR source.staging_version_id IS NULL) THEN
    RAISE EXCEPTION 'Accepted media must match the verified upload declaration' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER media_source_scope BEFORE INSERT OR UPDATE ON media FOR EACH ROW EXECUTE FUNCTION validate_media_source();
REVOKE ALL ON FUNCTION validate_media_source() FROM PUBLIC;

CREATE FUNCTION validate_provenance_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE parent_project uuid; parent_scope text; previous_upload uuid; evidence media;
BEGIN
  SELECT * INTO evidence FROM media WHERE tenant_id=NEW.tenant_id AND id=NEW.evidence_media_id;
  IF TG_TABLE_NAME='upload_provenance_evidence' THEN
    SELECT project_id,scope INTO parent_project,parent_scope FROM upload_intents WHERE tenant_id=NEW.tenant_id AND id=NEW.upload_id;
  ELSE
    SELECT project_id,scope,source_upload_id INTO parent_project,parent_scope,previous_upload FROM media WHERE tenant_id=NEW.tenant_id AND id=NEW.media_id;
  END IF;
  IF parent_scope IS NULL OR evidence.id IS NULL OR (evidence.scope='project' AND (parent_scope='shared' OR evidence.project_id IS DISTINCT FROM parent_project)) THEN
    RAISE EXCEPTION 'Provenance evidence must have the same authorized scope' USING ERRCODE='23514';
  END IF;
  IF evidence.status<>'ready' AND NOT (evidence.status='archived' AND previous_upload IS NOT NULL AND EXISTS (
    SELECT 1 FROM upload_provenance_evidence WHERE tenant_id=NEW.tenant_id AND upload_id=previous_upload AND evidence_media_id=evidence.id
  )) THEN
    RAISE EXCEPTION 'New provenance evidence must be ready and active' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER upload_evidence_scope BEFORE INSERT ON upload_provenance_evidence FOR EACH ROW EXECUTE FUNCTION validate_provenance_evidence();
CREATE TRIGGER media_evidence_scope BEFORE INSERT ON media_provenance_evidence FOR EACH ROW EXECUTE FUNCTION validate_provenance_evidence();
REVOKE ALL ON FUNCTION validate_provenance_evidence() FROM PUBLIC;

CREATE FUNCTION media_scope_read(target_tenant uuid,target_project uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT target_tenant=tenant_scope() AND CASE WHEN target_project IS NULL THEN tenant_role(target_tenant) IS NOT NULL ELSE project_role(target_project) IS NOT NULL END
$$;
CREATE FUNCTION media_scope_write(target_tenant uuid,target_project uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT target_tenant=tenant_scope() AND CASE WHEN target_project IS NULL THEN tenant_role(target_tenant) IN ('owner','admin') ELSE project_role(target_project) IS NOT NULL END
$$;

-- This role check cannot be forged by setting GUCs. Only provisioning can register
-- a runtime login, and the helper is owned by the hardened NOLOGIN authorizer.
CREATE FUNCTION media_worker_login() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
  SELECT EXISTS (SELECT 1 FROM media_processing_state WHERE worker_role=session_user)
$$;
CREATE FUNCTION media_worker_row(target_tenant uuid,target_id uuid,root_kind text) RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT media_worker_login() AND target_tenant=tenant_scope()
    AND target_id::text=current_setting('app.media_'||root_kind||'_id',true)
$$;

ALTER TABLE media_processing_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_processing_state FORCE ROW LEVEL SECURITY;
CREATE POLICY media_epoch_read ON media_processing_state FOR SELECT USING (true);
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['upload_intents','media'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY user_media_read ON %I FOR SELECT USING (media_scope_read(tenant_id,project_id))',t);
    EXECUTE format('CREATE POLICY user_media_insert ON %I FOR INSERT WITH CHECK (media_scope_write(tenant_id,project_id))',t);
    EXECUTE format('CREATE POLICY user_media_update ON %I FOR UPDATE USING (media_scope_write(tenant_id,project_id)) WITH CHECK (media_scope_write(tenant_id,project_id))',t);
  END LOOP;
END $$;
CREATE POLICY worker_upload_read ON upload_intents FOR SELECT USING (media_worker_row(tenant_id,id,'upload'));
CREATE POLICY worker_upload_update ON upload_intents FOR UPDATE USING (media_worker_row(tenant_id,id,'upload')) WITH CHECK (media_worker_row(tenant_id,id,'upload'));
CREATE POLICY worker_media_read ON media FOR SELECT USING (media_worker_row(tenant_id,id,'media'));
CREATE POLICY worker_media_update ON media FOR UPDATE USING (media_worker_row(tenant_id,id,'media')) WITH CHECK (media_worker_row(tenant_id,id,'media'));

ALTER TABLE media_derivatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_derivatives FORCE ROW LEVEL SECURITY;
CREATE POLICY derivative_user_read ON media_derivatives FOR SELECT USING (EXISTS (SELECT 1 FROM media WHERE media.id=media_id AND media_scope_read(tenant_id,project_id)));
CREATE POLICY derivative_user_update ON media_derivatives FOR UPDATE USING (EXISTS (SELECT 1 FROM media WHERE media.id=media_id AND media_scope_write(tenant_id,project_id))) WITH CHECK (EXISTS (SELECT 1 FROM media WHERE media.id=media_id AND media_scope_write(tenant_id,project_id)));
CREATE POLICY derivative_worker_read ON media_derivatives FOR SELECT USING (media_worker_row(tenant_id,id,'derivative') OR media_worker_row(tenant_id,media_id,'media'));
CREATE POLICY derivative_worker_insert ON media_derivatives FOR INSERT WITH CHECK (media_worker_row(tenant_id,media_id,'media'));
CREATE POLICY derivative_worker_update ON media_derivatives FOR UPDATE USING (media_worker_row(tenant_id,id,'derivative')) WITH CHECK (media_worker_row(tenant_id,id,'derivative'));

ALTER TABLE upload_provenance_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE upload_provenance_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY upload_evidence_read ON upload_provenance_evidence FOR SELECT USING (EXISTS (SELECT 1 FROM upload_intents WHERE id=upload_id));
CREATE POLICY upload_evidence_insert ON upload_provenance_evidence FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM upload_intents WHERE id=upload_id AND media_scope_write(tenant_id,project_id)));
ALTER TABLE media_provenance_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_provenance_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY media_evidence_read ON media_provenance_evidence FOR SELECT USING (EXISTS (SELECT 1 FROM media WHERE id=media_id));
CREATE POLICY media_evidence_insert ON media_provenance_evidence FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM media WHERE id=media_id AND media_scope_write(tenant_id,project_id)));
CREATE POLICY media_evidence_delete ON media_provenance_evidence FOR DELETE USING (EXISTS (SELECT 1 FROM media WHERE id=media_id AND media_scope_write(tenant_id,project_id)));

REVOKE ALL ON FUNCTION media_scope_read(uuid,uuid),media_scope_write(uuid,uuid),media_worker_login(),media_worker_row(uuid,uuid,text) FROM PUBLIC;

CREATE FUNCTION resolve_media_work(target uuid,task_kind text,expected_step bigint,expected_epoch bigint)
RETURNS TABLE(tenant_id uuid,project_id uuid,scope text,media_id uuid,upload_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE current_epoch bigint; target_tenant uuid; target_project uuid; target_scope text; target_media uuid; target_upload uuid; actual_step bigint; actual_epoch bigint;
BEGIN
  IF NOT media_worker_login() THEN RAISE EXCEPTION 'Media worker login required' USING ERRCODE='42501'; END IF;
  SELECT s.epoch INTO current_epoch FROM media_processing_state s WHERE singleton FOR SHARE;
  IF expected_epoch<>current_epoch THEN RETURN; END IF;
  IF task_kind='media_probe' THEN
    SELECT u.tenant_id,u.project_id,u.scope,m.id,u.id INTO target_tenant,target_project,target_scope,target_media,target_upload
      FROM upload_intents u LEFT JOIN media m ON m.source_upload_id=u.id WHERE u.id=target;
  ELSIF task_kind='media_derivative' THEN
    SELECT m.tenant_id,m.project_id,m.scope,m.id,m.source_upload_id INTO target_tenant,target_project,target_scope,target_media,target_upload
      FROM media_derivatives d JOIN media m ON m.id=d.media_id WHERE d.id=target;
  ELSE RAISE EXCEPTION 'Unknown media step' USING ERRCODE='22023'; END IF;
  IF target_tenant IS NULL THEN RETURN; END IF;
  PERFORM t.id FROM tenants t WHERE t.id=target_tenant AND t.status='active' FOR SHARE;
  IF NOT FOUND THEN RETURN; END IF;
  IF target_project IS NOT NULL THEN
    PERFORM p.id FROM projects p WHERE p.id=target_project AND p.tenant_id=target_tenant AND p.status='active' FOR SHARE;
    IF NOT FOUND THEN RETURN; END IF;
  END IF;
  IF task_kind='media_probe' THEN
    SELECT u.step_revision,u.epoch INTO actual_step,actual_epoch FROM upload_intents u WHERE u.id=target FOR UPDATE;
  ELSE
    SELECT d.step_revision,d.epoch INTO actual_step,actual_epoch FROM media_derivatives d WHERE d.id=target FOR UPDATE;
  END IF;
  IF actual_step IS DISTINCT FROM expected_step OR actual_epoch IS DISTINCT FROM expected_epoch THEN RETURN; END IF;
  PERFORM set_config('app.user_id','',true),set_config('app.tenant_id',target_tenant::text,true),
    set_config('app.media_upload_id',target_upload::text,true),set_config('app.media_media_id',coalesce(target_media::text,''),true),
    set_config('app.media_derivative_id',CASE WHEN task_kind='media_derivative' THEN target::text ELSE '' END,true);
  RETURN QUERY SELECT target_tenant,target_project,target_scope,target_media,target_upload;
END $$;
REVOKE ALL ON FUNCTION resolve_media_work(uuid,text,bigint,bigint) FROM PUBLIC;

CREATE FUNCTION scan_media_work(batch_size integer)
RETURNS TABLE(task_kind text,business_id uuid,step_revision bigint,epoch bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
  IF batch_size NOT BETWEEN 1 AND 100 OR NOT EXISTS (SELECT 1 FROM media_processing_state WHERE scheduler_role=session_user) THEN
    RAISE EXCEPTION 'Restricted media scheduler required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT work.task_kind,work.business_id,work.step_revision,work.epoch FROM (
    SELECT 'media_probe'::text AS task_kind,u.id AS business_id,u.step_revision,u.epoch,u.tenant_id,u.project_id,u.updated_at
    FROM upload_intents u
    WHERE ((u.status='pending' AND u.expires_at<clock_timestamp()) OR
      (u.status='uploaded' AND u.processing_attempts<6 AND u.updated_at<clock_timestamp()-interval '2 minutes') OR
      (u.status='verifying' AND u.updated_at<clock_timestamp()-interval '15 minutes'))
    UNION ALL
    SELECT 'media_derivative'::text,d.id,d.step_revision,d.epoch,m.tenant_id,m.project_id,d.updated_at
    FROM media_derivatives d JOIN media m ON m.id=d.media_id
    WHERE (d.status='queued' AND d.updated_at<clock_timestamp()-interval '2 minutes') OR
      (d.status='processing' AND d.updated_at<clock_timestamp()-interval '15 minutes')
  ) work JOIN tenants t ON t.id=work.tenant_id AND t.status='active'
    LEFT JOIN projects p ON p.id=work.project_id AND p.tenant_id=work.tenant_id
    CROSS JOIN media_processing_state s
  WHERE work.epoch=s.epoch AND (work.project_id IS NULL OR p.status='active')
  ORDER BY work.updated_at,work.business_id LIMIT batch_size;
END $$;
REVOKE ALL ON FUNCTION scan_media_work(integer) FROM PUBLIC;

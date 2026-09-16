CREATE TABLE feishu_script_imports (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  source_url text NOT NULL CHECK(length(source_url) BETWEEN 1 AND 2048),
  source_kind text NOT NULL CHECK(source_kind IN ('docx','wiki')),
  source_token text NOT NULL,
  binding_hash text NOT NULL CHECK(binding_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK(state IN ('pending','creating','exporting','ready','failed','unknown')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
  document_id text,
  title text,
  observed_revision bigint,
  ticket text,
  lease_token uuid,
  lease_until timestamptz,
  next_poll_at timestamptz NOT NULL DEFAULT now(),
  error_code text,
  error_message text,
  bytes bytea CHECK(octet_length(bytes) BETWEEN 1 AND 4194304),
  text text,
  document jsonb,
  file_name text,
  sha256 text CHECK(sha256 ~ '^[0-9a-f]{64}$'),
  fetched_at timestamptz,
  FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
  CHECK((lease_token IS NULL)=(lease_until IS NULL)),
  CHECK(state<>'exporting' OR (ticket IS NOT NULL AND document_id IS NOT NULL)),
  CHECK((state='ready')=(bytes IS NOT NULL)),
  CHECK(bytes IS NULL OR (text IS NOT NULL AND document IS NOT NULL AND file_name IS NOT NULL AND fetched_at IS NOT NULL AND sha256 IS NOT NULL AND encode(sha256(bytes),'hex')=sha256 AND document_id IS NOT NULL AND title IS NOT NULL AND observed_revision IS NOT NULL AND observed_revision>0))
);
CREATE INDEX feishu_import_owner ON feishu_script_imports(project_id,actor_id,expires_at);
ALTER TABLE feishu_script_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE feishu_script_imports FORCE ROW LEVEL SECURITY;
CREATE POLICY feishu_import_scope ON feishu_script_imports USING(actor_id=current_setting('app.user_id',true)::uuid AND project_role(project_id) IS NOT NULL)
WITH CHECK(tenant_id=tenant_scope() AND actor_id=current_setting('app.user_id',true)::uuid AND project_role(project_id) IS NOT NULL);
CREATE FUNCTION protect_feishu_preview() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF (NEW.id,NEW.tenant_id,NEW.project_id,NEW.actor_id,NEW.source_url,NEW.source_kind,NEW.source_token,NEW.binding_hash,NEW.created_at,NEW.expires_at)
    IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.project_id,OLD.actor_id,OLD.source_url,OLD.source_kind,OLD.source_token,OLD.binding_hash,OLD.created_at,OLD.expires_at)
    OR (OLD.state='ready' AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'Fixed import identity and ready preview are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER feishu_preview_immutable BEFORE UPDATE ON feishu_script_imports FOR EACH ROW EXECUTE FUNCTION protect_feishu_preview();
REVOKE ALL ON FUNCTION protect_feishu_preview() FROM PUBLIC;
ALTER TABLE script_revisions ADD COLUMN source jsonb;
ALTER TABLE script_revisions ADD CHECK(source IS NULL OR (source_format='docx' AND jsonb_typeof(source)='object' AND source ?& ARRAY['provider','previewId','sourceUrl','sourceKind','documentId','title','observedRevision','fetchedAt','permissionCheckedAt','accessMode'] AND NOT jsonb_path_exists(source, '$.* ? (@ == null)') AND source->>'provider'='feishu' AND source->>'previewId' ~ '^[0-9a-f-]{36}$' AND source->>'accessMode'='team_application'));
CREATE UNIQUE INDEX feishu_script_once ON script_revisions(project_id,(source->>'previewId')) WHERE source IS NOT NULL;
CREATE FUNCTION verify_feishu_script_source() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE p feishu_script_imports;
BEGIN
  IF NEW.source IS NOT NULL THEN
    SELECT * INTO p FROM feishu_script_imports WHERE id=(NEW.source->>'previewId')::uuid;
    IF p.id IS NULL OR p.state<>'ready' OR (NEW.tenant_id,NEW.project_id,NEW.imported_by,NEW.sha256,NEW.text,NEW.document,NEW.file_name)
      IS DISTINCT FROM (p.tenant_id,p.project_id,p.actor_id,p.sha256,p.text,p.document,p.file_name)
      OR NEW.source->>'provider' IS DISTINCT FROM 'feishu' OR NEW.source->>'accessMode' IS DISTINCT FROM 'team_application'
      OR NEW.source->>'permissionCheckedAt' IS NULL OR (NEW.source->>'permissionCheckedAt')::timestamptz < p.fetched_at
      OR NEW.source->>'sourceUrl' IS DISTINCT FROM p.source_url OR NEW.source->>'sourceKind' IS DISTINCT FROM p.source_kind
      OR NEW.source->>'documentId' IS DISTINCT FROM p.document_id OR NEW.source->>'title' IS DISTINCT FROM p.title
      OR (NEW.source->>'fetchedAt')::timestamptz IS DISTINCT FROM p.fetched_at
      OR (NEW.source->>'observedRevision')::bigint IS DISTINCT FROM p.observed_revision THEN
      RAISE EXCEPTION 'Feishu revision must preserve its authorized fixed preview' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER feishu_script_source AFTER INSERT ON script_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_feishu_script_source();
REVOKE ALL ON FUNCTION verify_feishu_script_source() FROM PUBLIC;

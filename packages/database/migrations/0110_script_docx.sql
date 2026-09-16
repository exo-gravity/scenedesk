ALTER TABLE script_revisions DROP CONSTRAINT script_revisions_source_format_check;
ALTER TABLE script_revisions ADD CHECK (source_format IN ('plain_text','docx'));
ALTER TABLE script_revisions ADD COLUMN document jsonb;
ALTER TABLE script_revisions ADD COLUMN file_name text;
ALTER TABLE script_revisions ADD COLUMN sha256 text;
ALTER TABLE script_revisions ADD COLUMN import_request_id uuid;
ALTER TABLE script_revisions ADD COLUMN import_base_version bigint;
ALTER TABLE script_revisions ADD COLUMN imported_by uuid REFERENCES users(id);
ALTER TABLE script_revisions ADD CHECK (
  (source_format='plain_text' AND document IS NULL AND file_name IS NULL AND sha256 IS NULL AND import_request_id IS NULL AND imported_by IS NULL AND import_base_version IS NULL)
  OR (source_format='docx' AND document IS NOT NULL AND file_name IS NOT NULL AND sha256 IS NOT NULL AND import_base_version IS NOT NULL AND jsonb_typeof(document)='object' AND document->>'format'='docx_v1' AND length(file_name) BETWEEN 1 AND 160 AND sha256 ~ '^[0-9a-f]{64}$' AND import_request_id IS NOT NULL AND imported_by IS NOT NULL AND import_base_version > 0)
);
CREATE UNIQUE INDEX script_import_request ON script_revisions(project_id,import_request_id) WHERE import_request_id IS NOT NULL;
CREATE TABLE script_originals (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 4194304),
  FOREIGN KEY(tenant_id,project_id,id) REFERENCES script_revisions(tenant_id,project_id,id)
);
ALTER TABLE script_originals ENABLE ROW LEVEL SECURITY;
ALTER TABLE script_originals FORCE ROW LEVEL SECURITY;
CREATE POLICY script_original_scope ON script_originals USING(project_role(project_id) IS NOT NULL) WITH CHECK(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL);
CREATE TRIGGER script_original_immutable BEFORE UPDATE OR DELETE ON script_originals FOR EACH ROW EXECUTE FUNCTION protect_content_revision();

CREATE FUNCTION verify_script_original() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE r script_revisions; original bytea;
BEGIN
  SELECT * INTO r FROM script_revisions WHERE id=NEW.id;
  SELECT bytes INTO original FROM script_originals WHERE id=NEW.id;
  IF (r.source_format='docx' AND (original IS NULL OR encode(sha256(original),'hex') IS DISTINCT FROM r.sha256))
    OR (r.source_format='plain_text' AND original IS NOT NULL) THEN
    RAISE EXCEPTION 'Script original must match its immutable document revision' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER script_original_complete AFTER INSERT ON script_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_script_original();
CREATE CONSTRAINT TRIGGER script_original_matches AFTER INSERT ON script_originals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_script_original();
REVOKE ALL ON FUNCTION verify_script_original() FROM PUBLIC;

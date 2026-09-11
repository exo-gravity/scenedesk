-- BEFORE INSERT runs before ON CONFLICT. Advance an existing work root with an
-- explicit UPDATE so its INSERT-only revision-one guard remains meaningful.
CREATE OR REPLACE FUNCTION advance_work_head() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  UPDATE cut_work_drafts SET revision=NEW.revision WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND cut_id=NEW.cut_id;
  IF NOT FOUND THEN
    INSERT INTO cut_work_drafts(tenant_id,project_id,cut_id,revision) VALUES(NEW.tenant_id,NEW.project_id,NEW.cut_id,NEW.revision);
  END IF;
  RETURN NEW;
END $$;

-- The output specification includes fixed quality-reference media. Those
-- references need the same retention and scope protection as timeline clips.
CREATE TABLE cut_spec_media_refs (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, cut_id uuid NOT NULL, media_id uuid NOT NULL,
  PRIMARY KEY (cut_id,media_id),
  FOREIGN KEY (tenant_id,project_id,cut_id) REFERENCES cuts(tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,media_id) REFERENCES media(tenant_id,id)
);
CREATE INDEX cut_spec_media_retention ON cut_spec_media_refs(media_id);
CREATE TABLE edit_history_spec_media_refs (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, cut_id uuid NOT NULL, body_hash text NOT NULL, media_id uuid NOT NULL,
  PRIMARY KEY (cut_id,body_hash,media_id),
  FOREIGN KEY (tenant_id,project_id,cut_id,body_hash) REFERENCES edit_history_bodies(tenant_id,project_id,cut_id,hash) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,media_id) REFERENCES media(tenant_id,id)
);
CREATE INDEX editing_spec_media_retention ON edit_history_spec_media_refs(media_id);

-- Backfill any already created roots/bodies without silently changing their
-- fixed input. Existing archive state does not invalidate an existing reference.
INSERT INTO cut_spec_media_refs(tenant_id,project_id,cut_id,media_id)
  SELECT c.tenant_id,c.project_id,c.id,m.value::uuid FROM cuts c,
    jsonb_array_elements_text(c.timeline->'spec'->'qualityReferenceMediaIds') m;
INSERT INTO edit_history_spec_media_refs(tenant_id,project_id,cut_id,body_hash,media_id)
  SELECT b.tenant_id,b.project_id,b.cut_id,b.hash,m.value::uuid FROM edit_history_bodies b,
    jsonb_array_elements_text(b.document->'timeline'->'spec'->'qualityReferenceMediaIds') m;

CREATE FUNCTION project_editing_spec() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE spec jsonb; media_id uuid;
BEGIN
  IF TG_TABLE_NAME='cuts' THEN spec:=NEW.timeline->'spec'; ELSE spec:=NEW.document->'timeline'->'spec'; END IF;
  FOR media_id IN SELECT value::uuid FROM jsonb_array_elements_text(spec->'qualityReferenceMediaIds') LOOP
    IF TG_TABLE_NAME='cuts' THEN
      INSERT INTO cut_spec_media_refs(tenant_id,project_id,cut_id,media_id) VALUES(NEW.tenant_id,NEW.project_id,NEW.id,media_id);
    ELSE
      INSERT INTO edit_history_spec_media_refs(tenant_id,project_id,cut_id,body_hash,media_id) VALUES(NEW.tenant_id,NEW.project_id,NEW.cut_id,NEW.hash,media_id);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE FUNCTION validate_editing_spec_projection() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE spec jsonb; source media;
BEGIN
  IF TG_TABLE_NAME='cut_spec_media_refs' THEN
    SELECT timeline->'spec' INTO spec FROM cuts WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND id=NEW.cut_id;
  ELSE
    SELECT document->'timeline'->'spec' INTO spec FROM edit_history_bodies WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND cut_id=NEW.cut_id AND hash=NEW.body_hash;
  END IF;
  SELECT * INTO source FROM media WHERE tenant_id=NEW.tenant_id AND id=NEW.media_id FOR SHARE;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(spec->'qualityReferenceMediaIds') m WHERE m.value::uuid=NEW.media_id)
    OR source.id IS NULL OR (source.project_id IS NOT NULL AND source.project_id<>NEW.project_id)
    OR source.kind NOT IN ('image','video') OR (TG_TABLE_NAME='cut_spec_media_refs' AND source.status<>'ready') THEN
    RAISE EXCEPTION 'Output spec reference must match the fixed authorized document' USING ERRCODE='P0424';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION validate_work_spec_sources() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE spec jsonb; previous jsonb; source media; target uuid;
BEGIN
  PERFORM 1 FROM cuts WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND id=NEW.cut_id FOR UPDATE;
  SELECT b.document->'timeline'->'spec' INTO spec FROM edit_history_bodies b WHERE b.cut_id=NEW.cut_id AND b.hash=NEW.body_hash;
  SELECT b.document->'timeline'->'spec' INTO previous FROM cut_work_drafts w JOIN cut_work_draft_revisions r ON r.cut_id=w.cut_id AND r.revision=w.revision
    JOIN edit_history_bodies b ON b.cut_id=r.cut_id AND b.hash=r.body_hash WHERE w.cut_id=NEW.cut_id;
  IF previous IS NULL THEN SELECT timeline->'spec' INTO previous FROM cuts WHERE id=NEW.cut_id; END IF;
  FOR target IN SELECT value::uuid FROM jsonb_array_elements_text(spec->'qualityReferenceMediaIds') ORDER BY value::uuid LOOP
    SELECT * INTO source FROM media WHERE tenant_id=NEW.tenant_id AND id=target FOR SHARE;
    IF source.id IS NULL OR (source.project_id IS NOT NULL AND source.project_id<>NEW.project_id)
      OR source.kind NOT IN ('image','video') OR (source.status<>'ready' AND NOT (source.status='archived' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(previous->'qualityReferenceMediaIds') old WHERE old.value::uuid=target))) THEN
      RAISE EXCEPTION 'New quality reference must be available in the current scope' USING ERRCODE='P0424';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER cut_spec_projection AFTER INSERT ON cuts FOR EACH ROW EXECUTE FUNCTION project_editing_spec();
CREATE TRIGGER work_spec_projection AFTER INSERT ON edit_history_bodies FOR EACH ROW EXECUTE FUNCTION project_editing_spec();
CREATE TRIGGER cut_spec_projection_valid BEFORE INSERT ON cut_spec_media_refs FOR EACH ROW EXECUTE FUNCTION validate_editing_spec_projection();
CREATE TRIGGER work_spec_projection_valid BEFORE INSERT ON edit_history_spec_media_refs FOR EACH ROW EXECUTE FUNCTION validate_editing_spec_projection();
CREATE TRIGGER work_spec_sources BEFORE INSERT ON cut_work_draft_revisions FOR EACH ROW EXECUTE FUNCTION validate_work_spec_sources();
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['cut_spec_media_refs','edit_history_spec_media_refs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY editing_project_scope ON %I USING (tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL) WITH CHECK (tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL)',t);
    EXECUTE format('CREATE TRIGGER editing_spec_immutable BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION protect_content_revision()',t);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION project_editing_spec(),validate_editing_spec_projection(),validate_work_spec_sources() FROM PUBLIC;

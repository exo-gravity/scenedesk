-- OLD is a trigger record, not a safe table alias inside a trigger function.
CREATE OR REPLACE FUNCTION validate_work_spec_sources() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
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
        SELECT 1 FROM jsonb_array_elements_text(previous->'qualityReferenceMediaIds') retained_ref WHERE retained_ref.value::uuid=target))) THEN
      RAISE EXCEPTION 'New quality reference must be available in the current scope' USING ERRCODE='P0424';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE INDEX work_history_body_references ON cut_work_draft_revisions(cut_id,body_hash);

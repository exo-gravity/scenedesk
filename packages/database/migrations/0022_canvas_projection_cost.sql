-- Preserve direct-write integrity while avoiding repeated full-document scans
-- for the trusted body projection. Keep deployed migrations unchanged.
CREATE OR REPLACE FUNCTION validate_canvas_projection() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE doc jsonb;
BEGIN
  -- The sole nested writer is project_canvas_body: its rows are taken directly
  -- from the validated immutable NEW document. Re-reading and scanning the whole
  -- body for each of those rows makes this path quadratic. Runtime roles cannot
  -- install triggers; direct INSERTs still require the exact membership check.
  IF pg_trigger_depth()=2 THEN RETURN NEW; END IF;
  SELECT document INTO doc FROM canvas_history_bodies WHERE canvas_id=NEW.canvas_id AND hash=NEW.body_hash;
  IF TG_TABLE_NAME='canvas_media_refs' THEN
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(doc->'nodes') n WHERE (n->>'id')::uuid=NEW.node_id
      AND (n->'content'->>'mediaId')::uuid=NEW.media_id
      AND (n->'content'->>'assetRevisionId')::uuid IS NOT DISTINCT FROM NEW.asset_revision_id) THEN
      RAISE EXCEPTION 'Forged canvas media projection' USING ERRCODE='P0425';
    END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(doc->'edges') e WHERE (e->>'id')::uuid=NEW.edge_id
    AND (e->>'subjectAssetId')::uuid=NEW.asset_id) THEN
    RAISE EXCEPTION 'Forged canvas subject projection' USING ERRCODE='P0425';
  END IF;
  RETURN NEW;
END $$;

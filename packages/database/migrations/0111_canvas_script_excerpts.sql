-- Fixed script text is part of a canvas node's permanent identity, including tombstones.
-- Existing RLS and table grants cover this additional projected column.
ALTER TABLE canvas_node_index ADD COLUMN source_excerpt jsonb;
ALTER TABLE canvas_node_index ADD COLUMN script_revision_id uuid GENERATED ALWAYS AS ((source_excerpt->>'scriptRevisionId')::uuid) STORED;
ALTER TABLE canvas_node_index ADD FOREIGN KEY(tenant_id,project_id,script_revision_id) REFERENCES script_revisions(tenant_id,project_id,id);
CREATE OR REPLACE FUNCTION validate_canvas_revision() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE root canvases; doc jsonb; previous jsonb; previous_nodes jsonb; item jsonb; identity canvas_node_index; source media; keep_existing boolean; excerpt jsonb; script_text text; start_offset bigint; end_offset bigint;
BEGIN
  SELECT * INTO root FROM canvases WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND id=NEW.canvas_id FOR UPDATE;
  IF root.id IS NULL OR NEW.revision<>root.revision+1 OR NEW.updated_by IS DISTINCT FROM actor_id()
    OR NOT EXISTS(SELECT 1 FROM projects WHERE tenant_id=NEW.tenant_id AND id=NEW.project_id AND status='active') THEN
    RAISE EXCEPTION 'Canvas append conflict' USING ERRCODE='P0414';
  END IF;
  SELECT document INTO doc FROM canvas_history_bodies WHERE canvas_id=NEW.canvas_id AND hash=NEW.body_hash;
  SELECT b.document INTO previous FROM canvas_revisions r JOIN canvas_history_bodies b ON b.canvas_id=r.canvas_id AND b.hash=r.body_hash
    WHERE r.canvas_id=NEW.canvas_id AND r.revision=root.revision;
  SELECT jsonb_object_agg(lower(n->>'id'),true) INTO previous_nodes FROM jsonb_array_elements(previous->'nodes') n;
  FOR item IN SELECT * FROM jsonb_array_elements(doc->'nodes') ORDER BY (value->>'id')::uuid LOOP
    SELECT * INTO identity FROM canvas_node_index WHERE node_id=(item->>'id')::uuid;
    IF identity.node_id IS NOT NULL AND (identity.canvas_id<>NEW.canvas_id OR identity.kind<>item->>'kind'
      OR identity.content_type<>item->'content'->>'type'
      OR identity.media_id IS DISTINCT FROM (item->'content'->>'mediaId')::uuid
      OR identity.asset_revision_id IS DISTINCT FROM (item->'content'->>'assetRevisionId')::uuid
      OR identity.source_excerpt IS DISTINCT FROM item->'content'->'sourceExcerpt') THEN
      RAISE EXCEPTION 'Node identity is immutable, including tombstones' USING ERRCODE='P0425';
    END IF;
    excerpt:=item->'content'->'sourceExcerpt';
    IF excerpt IS NOT NULL THEN
      IF (item->>'kind'='text' AND item->'content'->>'type'='text'
        AND jsonb_typeof(excerpt)='object' AND jsonb_typeof(excerpt->'range')='object'
        AND (excerpt-ARRAY['scriptRevisionId','range','quote'])='{}'::jsonb
        AND ((excerpt->'range')-ARRAY['startOffset','endOffset'])='{}'::jsonb
        AND jsonb_typeof(excerpt->'quote')='string'
        AND excerpt->>'quote'=item->'content'->>'text'
        AND excerpt->'range'->>'startOffset' ~ '^[0-9]{1,16}$'
        AND excerpt->'range'->>'endOffset' ~ '^[0-9]{1,16}$') IS DISTINCT FROM true
      THEN RAISE EXCEPTION 'Invalid fixed script excerpt' USING ERRCODE='P0425';END IF;
      start_offset:=(excerpt->'range'->>'startOffset')::bigint;
      end_offset:=(excerpt->'range'->>'endOffset')::bigint;
      SELECT text INTO script_text FROM script_revisions WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND id=(excerpt->>'scriptRevisionId')::uuid;
      IF script_text IS NULL OR start_offset>=end_offset OR end_offset>char_length(script_text)
      THEN RAISE EXCEPTION 'Invalid fixed script range or authority' USING ERRCODE='P0425';END IF;
      IF substring(script_text FROM start_offset::integer+1 FOR (end_offset-start_offset)::integer) IS DISTINCT FROM excerpt->>'quote'
      THEN RAISE EXCEPTION 'Fixed script quote does not match its revision' USING ERRCODE='P0425';END IF;
    END IF;
    keep_existing:=coalesce(previous_nodes ? lower(item->>'id'),false);
    IF item->'content'->>'type'='media' THEN
      SELECT * INTO source FROM media WHERE tenant_id=NEW.tenant_id AND id=(item->'content'->>'mediaId')::uuid FOR SHARE;
      IF source.id IS NULL OR (source.project_id IS NOT NULL AND source.project_id<>NEW.project_id)
        OR source.kind<>item->>'kind' OR (source.status<>'ready' AND NOT(source.status='archived' AND keep_existing)) THEN
        RAISE EXCEPTION 'Canvas media must be authorized and ready, or retained in the current body' USING ERRCODE='P0425';
      END IF;
      IF item->'content' ? 'assetRevisionId' AND (
        NOT asset_revision_usable(NEW.tenant_id,NEW.project_id,(item->'content'->>'assetRevisionId')::uuid,keep_existing)
        OR NOT EXISTS(SELECT 1 FROM asset_revision_media WHERE tenant_id=NEW.tenant_id
          AND asset_revision_id=(item->'content'->>'assetRevisionId')::uuid AND media_id=source.id)) THEN
        RAISE EXCEPTION 'Media does not belong to the fixed authorized asset revision' USING ERRCODE='P0425';
      END IF;
    END IF;
    IF identity.node_id IS NULL THEN
      INSERT INTO canvas_node_index(tenant_id,project_id,canvas_id,node_id,kind,content_type,media_id,asset_revision_id,source_excerpt)
        VALUES(NEW.tenant_id,NEW.project_id,NEW.canvas_id,(item->>'id')::uuid,item->>'kind',item->'content'->>'type',
          (item->'content'->>'mediaId')::uuid,(item->'content'->>'assetRevisionId')::uuid,excerpt);
    END IF;
  END LOOP;
  FOR item IN SELECT * FROM jsonb_array_elements(doc->'edges') WHERE value ? 'subjectAssetId' LOOP
    keep_existing:=EXISTS(SELECT 1 FROM jsonb_array_elements(previous->'edges') e WHERE (e->>'id')::uuid=(item->>'id')::uuid
      AND (e->>'subjectAssetId')::uuid=(item->>'subjectAssetId')::uuid);
    IF NOT asset_identity_usable(NEW.tenant_id,NEW.project_id,(item->>'subjectAssetId')::uuid,keep_existing) THEN
      RAISE EXCEPTION 'Reference subject is not authorized' USING ERRCODE='P0425';
    END IF;
  END LOOP;
  NEW.created_at:=transaction_timestamp();
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION validate_canvas_revision() FROM PUBLIC;

-- Shared unfinished editing is independent of the confirmed Cut. Only retained
-- history is immutable; current/previous heads are protected during pruning.
CREATE TABLE cuts (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  episode_id uuid, scene_id uuid,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  editing_mode text NOT NULL DEFAULT 'timeline' CHECK (editing_mode='timeline'),
  timeline jsonb NOT NULL, drama_bindings jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,project_id,id),
  CHECK (num_nonnulls(episode_id,scene_id)<=1),
  FOREIGN KEY (tenant_id,project_id) REFERENCES projects(tenant_id,id),
  FOREIGN KEY (tenant_id,project_id,episode_id) REFERENCES episodes(tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id,scene_id) REFERENCES scenes(tenant_id,project_id,id)
);
CREATE INDEX cuts_browse ON cuts(tenant_id,project_id,created_at,id);

-- canonical_json is the exact UTF-8 hashing input; JSONB is the queryable view.
-- Both are TOAST-able. Budgets count canonical bytes, never compressed bytes.
-- A canvas owner will be added with an exclusive typed FK when canvas lands.
CREATE TABLE edit_history_bodies (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, cut_id uuid NOT NULL,
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  hash_version text NOT NULL DEFAULT 'editing-json-v1' CHECK (hash_version='editing-json-v1'),
  canonical_json text NOT NULL CHECK (octet_length(canonical_json)<=4194304),
  canonical_bytes integer GENERATED ALWAYS AS (octet_length(canonical_json)) STORED,
  document jsonb GENERATED ALWAYS AS (canonical_json::jsonb) STORED,
  PRIMARY KEY (cut_id,hash), UNIQUE (tenant_id,project_id,cut_id,hash),
  CHECK (hash=encode(sha256(convert_to(canonical_json,'UTF8')),'hex')),
  FOREIGN KEY (tenant_id,project_id,cut_id) REFERENCES cuts(tenant_id,project_id,id)
);
CREATE TABLE cut_work_draft_revisions (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, cut_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  base_cut_revision bigint NOT NULL CHECK (base_cut_revision BETWEEN 1 AND 9007199254740991),
  body_hash text NOT NULL, updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cut_id,revision), UNIQUE (tenant_id,project_id,cut_id,revision),
  FOREIGN KEY (tenant_id,project_id,cut_id,body_hash) REFERENCES edit_history_bodies(tenant_id,project_id,cut_id,hash)
);
CREATE TABLE cut_work_drafts (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, cut_id uuid PRIMARY KEY,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  UNIQUE (tenant_id,project_id,cut_id),
  FOREIGN KEY (tenant_id,project_id,cut_id,revision) REFERENCES cut_work_draft_revisions(tenant_id,project_id,cut_id,revision)
);
ALTER TABLE selections ADD CONSTRAINT selection_work_scope UNIQUE (tenant_id,project_id,take_id,id);
CREATE TABLE edit_history_media_refs (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, cut_id uuid NOT NULL, body_hash text NOT NULL,
  clip_id uuid NOT NULL, media_id uuid NOT NULL, take_id uuid, selection_id uuid,
  PRIMARY KEY (cut_id,body_hash,clip_id),
  FOREIGN KEY (tenant_id,project_id,cut_id,body_hash) REFERENCES edit_history_bodies(tenant_id,project_id,cut_id,hash) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,media_id) REFERENCES media(tenant_id,id),
  FOREIGN KEY (tenant_id,project_id,media_id,take_id) REFERENCES takes(tenant_id,project_id,media_id,id),
  FOREIGN KEY (tenant_id,project_id,take_id,selection_id) REFERENCES selections(tenant_id,project_id,take_id,id),
  CHECK (selection_id IS NULL OR take_id IS NOT NULL)
);
CREATE INDEX editing_media_retention ON edit_history_media_refs(media_id);
CREATE INDEX editing_take_usage ON edit_history_media_refs(take_id,cut_id);
CREATE INDEX editing_selection_retention ON edit_history_media_refs(selection_id);
CREATE TABLE edit_history_dialogue_refs (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, cut_id uuid NOT NULL, body_hash text NOT NULL,
  binding_id uuid NOT NULL, shot_revision_id uuid NOT NULL, dialogue_id uuid NOT NULL,
  voice_asset_revision_id uuid,
  PRIMARY KEY (cut_id,body_hash,binding_id),
  FOREIGN KEY (tenant_id,project_id,cut_id,body_hash) REFERENCES edit_history_bodies(tenant_id,project_id,cut_id,hash) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,project_id,shot_revision_id,dialogue_id) REFERENCES dialogue_lines(tenant_id,project_id,shot_revision_id,dialogue_id),
  FOREIGN KEY (tenant_id,voice_asset_revision_id) REFERENCES asset_revisions(tenant_id,id)
);
CREATE INDEX editing_dialogue_retention ON edit_history_dialogue_refs(shot_revision_id,dialogue_id);
CREATE INDEX editing_voice_retention ON edit_history_dialogue_refs(voice_asset_revision_id);

CREATE FUNCTION work_media_items(document jsonb) RETURNS SETOF jsonb LANGUAGE sql IMMUTABLE SET search_path FROM CURRENT AS $$
  SELECT clip FROM jsonb_array_elements(document->'timeline'->'tracks') track,
    jsonb_array_elements(track->'items') clip WHERE clip->>'kind' IN ('video','audio')
$$;
CREATE FUNCTION validate_cut_creation() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE project_spec jsonb;
BEGIN
  SELECT spec INTO project_spec FROM projects WHERE tenant_id=NEW.tenant_id AND id=NEW.project_id AND status='active';
  IF project_spec IS NULL OR NEW.created_by IS DISTINCT FROM actor_id() OR NEW.revision<>1 OR NEW.status<>'active'
    OR NEW.drama_bindings<>'[]' OR NEW.timeline->'spec' IS DISTINCT FROM project_spec
    OR NEW.timeline->>'schemaVersion' IS DISTINCT FROM '1'
    OR jsonb_typeof(NEW.timeline->'tracks') IS DISTINCT FROM 'array'
    OR jsonb_array_length(NEW.timeline->'tracks')<>1
    OR NEW.timeline->'tracks'->0->>'kind' IS DISTINCT FROM 'video'
    OR NEW.timeline->'tracks'->0->'items' IS DISTINCT FROM '[]'
    OR (NEW.episode_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM episodes WHERE id=NEW.episode_id AND status='active'))
    OR (NEW.scene_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM scenes s JOIN episodes e ON e.id=s.episode_id
      WHERE s.id=NEW.scene_id AND s.status='active' AND e.status='active')) THEN
    RAISE EXCEPTION 'A new Cut must be empty and scoped to active content' USING ERRCODE='P0424';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cut_creation BEFORE INSERT ON cuts FOR EACH ROW EXECUTE FUNCTION validate_cut_creation();
-- E05 will replace this guard with normalized-result-only transitions. This
-- migration exposes no direct timeline write or pretend renderable content.
CREATE TRIGGER cut_confirmed_guard BEFORE UPDATE OR DELETE ON cuts FOR EACH ROW EXECUTE FUNCTION protect_content_revision();

CREATE FUNCTION project_work_body() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE doc jsonb; item jsonb;
BEGIN
  doc:=NEW.document;
  IF jsonb_typeof(doc->'timeline'->'tracks') IS DISTINCT FROM 'array'
    OR jsonb_typeof(doc->'dramaBindings') IS DISTINCT FROM 'array'
    OR jsonb_typeof(doc->'unresolvedEdits') IS DISTINCT FROM 'array'
    OR jsonb_typeof(doc->'timingOrigins') IS DISTINCT FROM 'array'
    OR jsonb_array_length(doc->'timeline'->'tracks')>32
    OR jsonb_array_length(doc->'dramaBindings')>5000
    OR jsonb_array_length(doc->'unresolvedEdits')>500
    OR jsonb_array_length(doc->'timingOrigins')<>0
    OR (SELECT count(*)>5000 FROM jsonb_array_elements(doc->'timeline'->'tracks') t,jsonb_array_elements(t->'items') c) THEN
    RAISE EXCEPTION 'Invalid bounded work document or nonexistent exact timing source' USING ERRCODE='P0424';
  END IF;
  FOR item IN SELECT * FROM work_media_items(doc) LOOP
    INSERT INTO edit_history_media_refs(tenant_id,project_id,cut_id,body_hash,clip_id,media_id,take_id,selection_id)
      VALUES(NEW.tenant_id,NEW.project_id,NEW.cut_id,NEW.hash,(item->>'id')::uuid,(item->>'mediaId')::uuid,
        (item->>'takeId')::uuid,(item->>'selectionId')::uuid);
  END LOOP;
  FOR item IN SELECT * FROM jsonb_array_elements(doc->'dramaBindings') LOOP
    INSERT INTO edit_history_dialogue_refs(tenant_id,project_id,cut_id,body_hash,binding_id,shot_revision_id,dialogue_id,voice_asset_revision_id)
      VALUES(NEW.tenant_id,NEW.project_id,NEW.cut_id,NEW.hash,(item->>'id')::uuid,(item->>'shotRevisionId')::uuid,
        (item->>'dialogueId')::uuid,(item->>'voiceAssetRevisionId')::uuid);
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER work_body_projection AFTER INSERT ON edit_history_bodies FOR EACH ROW EXECUTE FUNCTION project_work_body();
CREATE TRIGGER work_body_immutable BEFORE UPDATE ON edit_history_bodies FOR EACH ROW EXECUTE FUNCTION protect_content_revision();

CREATE FUNCTION validate_work_projection() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE doc jsonb;
BEGIN
  SELECT document INTO doc FROM edit_history_bodies WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND cut_id=NEW.cut_id AND hash=NEW.body_hash;
  IF TG_TABLE_NAME='edit_history_media_refs' THEN
    IF NOT EXISTS (SELECT 1 FROM media WHERE tenant_id=NEW.tenant_id AND id=NEW.media_id
      AND (project_id IS NULL OR project_id=NEW.project_id)) OR
      NOT EXISTS (SELECT 1 FROM work_media_items(doc) c WHERE (c->>'id')::uuid=NEW.clip_id
      AND (c->>'mediaId')::uuid=NEW.media_id AND (c->>'takeId')::uuid IS NOT DISTINCT FROM NEW.take_id
      AND (c->>'selectionId')::uuid IS NOT DISTINCT FROM NEW.selection_id) OR
      (NEW.selection_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM selections WHERE tenant_id=NEW.tenant_id
        AND project_id=NEW.project_id AND id=NEW.selection_id AND take_id=NEW.take_id)) THEN
      RAISE EXCEPTION 'Media projection must match the actual fixed work source' USING ERRCODE='P0424';
    END IF;
  ELSE
    IF (NEW.voice_asset_revision_id IS NOT NULL AND NOT asset_revision_usable(NEW.tenant_id,NEW.project_id,NEW.voice_asset_revision_id,true)) OR
      NOT EXISTS (SELECT 1 FROM jsonb_array_elements(doc->'dramaBindings') b WHERE (b->>'id')::uuid=NEW.binding_id
      AND (b->>'shotRevisionId')::uuid=NEW.shot_revision_id AND (b->>'dialogueId')::uuid=NEW.dialogue_id
      AND (b->>'voiceAssetRevisionId')::uuid IS NOT DISTINCT FROM NEW.voice_asset_revision_id) THEN
      RAISE EXCEPTION 'Dialogue projection must match the actual fixed binding' USING ERRCODE='P0424';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER work_media_projection_valid BEFORE INSERT ON edit_history_media_refs FOR EACH ROW EXECUTE FUNCTION validate_work_projection();
CREATE TRIGGER work_dialogue_projection_valid BEFORE INSERT ON edit_history_dialogue_refs FOR EACH ROW EXECUTE FUNCTION validate_work_projection();
CREATE TRIGGER work_media_projection_immutable BEFORE UPDATE ON edit_history_media_refs FOR EACH ROW EXECUTE FUNCTION protect_content_revision();
CREATE TRIGGER work_dialogue_projection_immutable BEFORE UPDATE ON edit_history_dialogue_refs FOR EACH ROW EXECUTE FUNCTION protect_content_revision();

CREATE FUNCTION validate_work_revision() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE root cuts; head cut_work_draft_revisions; doc jsonb; previous jsonb; item jsonb; old_item jsonb;
  source media; keep_existing boolean;
BEGIN
  SELECT * INTO root FROM cuts WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND id=NEW.cut_id FOR UPDATE;
  SELECT r.* INTO head FROM cut_work_drafts w JOIN cut_work_draft_revisions r ON r.cut_id=w.cut_id AND r.revision=w.revision
    WHERE w.cut_id=NEW.cut_id FOR UPDATE OF w;
  IF root.id IS NULL OR root.status<>'active' OR NEW.updated_by IS DISTINCT FROM actor_id()
    OR NEW.revision<>coalesce(head.revision,0)+1 THEN
    RAISE EXCEPTION 'Work revision must append with the actual actor' USING ERRCODE='P0413';
  END IF;
  IF NEW.base_cut_revision<>root.revision AND NEW.base_cut_revision IS DISTINCT FROM head.base_cut_revision THEN
    RAISE EXCEPTION 'Work base must be current or its explicitly retained original base' USING ERRCODE='P0408';
  END IF;
  SELECT document INTO doc FROM edit_history_bodies WHERE cut_id=NEW.cut_id AND hash=NEW.body_hash;
  SELECT document INTO previous FROM edit_history_bodies WHERE cut_id=NEW.cut_id AND hash=head.body_hash;
  -- Depend on the current semantic slot, not merely any historical reference.
  FOR item IN SELECT c FROM work_media_items(doc) c ORDER BY (c->>'mediaId')::uuid LOOP
    SELECT c INTO old_item FROM work_media_items(previous) c WHERE (c->>'id')::uuid=(item->>'id')::uuid;
    keep_existing:=old_item IS NOT NULL AND
      (old_item->>'mediaId')::uuid=(item->>'mediaId')::uuid AND old_item->>'kind'=item->>'kind'
      AND old_item->>'streamSelection'=item->>'streamSelection'
      AND (old_item->>'takeId')::uuid IS NOT DISTINCT FROM (item->>'takeId')::uuid
      AND (old_item->>'selectionId')::uuid IS NOT DISTINCT FROM (item->>'selectionId')::uuid;
    SELECT * INTO source FROM media WHERE tenant_id=NEW.tenant_id AND id=(item->>'mediaId')::uuid FOR SHARE;
    IF source.id IS NULL OR (source.project_id IS NOT NULL AND source.project_id<>NEW.project_id)
      OR (source.status<>'ready' AND NOT (source.status='archived' AND keep_existing))
      OR (item->>'kind'='video' AND (source.kind<>'video' OR item->>'streamSelection'<>'default'))
      OR (item->>'kind'='audio' AND NOT ((item->>'streamSelection'='default' AND source.kind='audio')
        OR (item->>'streamSelection'='embedded_audio' AND source.kind='video' AND source.has_audio))) THEN
      RAISE EXCEPTION 'Work requires an authorized ready source of the selected kind' USING ERRCODE='P0424';
    END IF;
  END LOOP;
  FOR item IN SELECT * FROM jsonb_array_elements(doc->'dramaBindings') ORDER BY value->>'voiceAssetRevisionId' LOOP
    IF item ? 'voiceAssetRevisionId' THEN
      SELECT b INTO old_item FROM jsonb_array_elements(previous->'dramaBindings') b WHERE (b->>'id')::uuid=(item->>'id')::uuid;
      keep_existing:=old_item IS NOT NULL AND (old_item - 'note' - 'sourceRange')=(item - 'note' - 'sourceRange');
      IF NOT asset_revision_usable(NEW.tenant_id,NEW.project_id,(item->>'voiceAssetRevisionId')::uuid,keep_existing)
        OR NOT EXISTS (SELECT 1 FROM asset_revisions ar JOIN assets a ON a.id=ar.asset_id
          WHERE ar.tenant_id=NEW.tenant_id AND ar.id=(item->>'voiceAssetRevisionId')::uuid AND a.kind='voice') THEN
        RAISE EXCEPTION 'Dialogue requires an authorized fixed voice version' USING ERRCODE='P0424';
      END IF;
    END IF;
  END LOOP;
  NEW.created_at:=transaction_timestamp();
  RETURN NEW;
END $$;
CREATE FUNCTION advance_work_head() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  INSERT INTO cut_work_drafts(tenant_id,project_id,cut_id,revision) VALUES(NEW.tenant_id,NEW.project_id,NEW.cut_id,NEW.revision)
    ON CONFLICT(cut_id) DO UPDATE SET revision=excluded.revision;
  RETURN NEW;
END $$;
CREATE FUNCTION protect_work_head() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.revision IS DISTINCT FROM (SELECT max(revision) FROM cut_work_draft_revisions WHERE cut_id=NEW.cut_id)
    OR (TG_OP='UPDATE' AND (NEW.tenant_id<>OLD.tenant_id OR NEW.project_id<>OLD.project_id OR NEW.cut_id<>OLD.cut_id OR NEW.revision<>OLD.revision+1))
    OR (TG_OP='INSERT' AND NEW.revision<>1) THEN
    RAISE EXCEPTION 'Work root must follow the appended history' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION protect_work_history() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE head bigint;
BEGIN
  PERFORM 1 FROM cuts WHERE tenant_id=OLD.tenant_id AND project_id=OLD.project_id AND id=OLD.cut_id FOR UPDATE;
  SELECT revision INTO head FROM cut_work_drafts WHERE cut_id=OLD.cut_id;
  IF TG_OP='UPDATE' OR OLD.revision>=head-1 THEN
    RAISE EXCEPTION 'Retained bodies are immutable and current/previous cannot be pruned' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER work_revision_valid BEFORE INSERT ON cut_work_draft_revisions FOR EACH ROW EXECUTE FUNCTION validate_work_revision();
CREATE TRIGGER work_revision_head AFTER INSERT ON cut_work_draft_revisions FOR EACH ROW EXECUTE FUNCTION advance_work_head();
CREATE TRIGGER work_revision_retention BEFORE UPDATE OR DELETE ON cut_work_draft_revisions FOR EACH ROW EXECUTE FUNCTION protect_work_history();
CREATE TRIGGER work_head_guard BEFORE INSERT OR UPDATE ON cut_work_drafts FOR EACH ROW EXECUTE FUNCTION protect_work_head();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['cuts','edit_history_bodies','cut_work_draft_revisions','cut_work_drafts','edit_history_media_refs','edit_history_dialogue_refs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY editing_project_scope ON %I USING (tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL) WITH CHECK (tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL)',t);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION work_media_items(jsonb),validate_cut_creation(),project_work_body(),validate_work_projection(),validate_work_revision(),advance_work_head(),protect_work_head(),protect_work_history() FROM PUBLIC;

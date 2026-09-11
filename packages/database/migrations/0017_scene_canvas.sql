-- Canvas owns its history independently of Cut. Both owners use the same
-- editing-json-v1 encoding and retention policy; typed bodies avoid polymorphic
-- foreign keys and do not rewrite the already deployed Cut history.
CREATE TABLE canvases (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version=1),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
CREATE TABLE canvas_history_bodies (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, canvas_id uuid NOT NULL,
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  hash_version text NOT NULL DEFAULT 'editing-json-v1' CHECK (hash_version='editing-json-v1'),
  canonical_json text NOT NULL CHECK (octet_length(canonical_json)<=4194304),
  canonical_bytes integer GENERATED ALWAYS AS (octet_length(canonical_json)) STORED,
  document jsonb GENERATED ALWAYS AS (canonical_json::jsonb) STORED,
  PRIMARY KEY(canvas_id,hash), UNIQUE(tenant_id,project_id,canvas_id,hash),
  CHECK (hash=encode(sha256(convert_to(canonical_json,'UTF8')),'hex')),
  FOREIGN KEY(tenant_id,project_id,canvas_id) REFERENCES canvases(tenant_id,project_id,id)
);
CREATE TABLE canvas_revisions (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, canvas_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  body_hash text NOT NULL, updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(canvas_id,revision), UNIQUE(tenant_id,project_id,canvas_id,revision),
  FOREIGN KEY(tenant_id,project_id,canvas_id,body_hash) REFERENCES canvas_history_bodies(tenant_id,project_id,canvas_id,hash)
);
ALTER TABLE canvases ADD CONSTRAINT canvas_current_revision
  FOREIGN KEY(tenant_id,project_id,id,revision) REFERENCES canvas_revisions(tenant_id,project_id,canvas_id,revision)
  DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE scene_canvas_links (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, scene_id uuid PRIMARY KEY, canvas_id uuid NOT NULL UNIQUE,
  FOREIGN KEY(tenant_id,project_id,scene_id) REFERENCES scenes(tenant_id,project_id,id),
  FOREIGN KEY(tenant_id,project_id,canvas_id) REFERENCES canvases(tenant_id,project_id,id)
);
-- Tombstones keep node identities after document/history removal. Active is
-- derived from the current body, so deleting a presentation never erases identity.
CREATE TABLE canvas_node_index (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, canvas_id uuid NOT NULL, node_id uuid PRIMARY KEY,
  kind text NOT NULL CHECK(kind IN ('text','image','video','audio')),
  content_type text NOT NULL CHECK(content_type IN ('text','media','draft')),
  media_id uuid, asset_revision_id uuid,
  UNIQUE(tenant_id,project_id,canvas_id,node_id),
  CHECK ((kind='text')=(content_type='text')),
  CHECK ((content_type='media')=(media_id IS NOT NULL)),
  CHECK (asset_revision_id IS NULL OR content_type='media'),
  FOREIGN KEY(tenant_id,project_id,canvas_id) REFERENCES canvases(tenant_id,project_id,id),
  FOREIGN KEY(tenant_id,media_id) REFERENCES media(tenant_id,id),
  FOREIGN KEY(tenant_id,asset_revision_id) REFERENCES asset_revisions(tenant_id,id)
);
CREATE TABLE canvas_media_refs (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, canvas_id uuid NOT NULL, body_hash text NOT NULL,
  node_id uuid NOT NULL, media_id uuid NOT NULL, asset_revision_id uuid,
  PRIMARY KEY(canvas_id,body_hash,node_id),
  FOREIGN KEY(tenant_id,project_id,canvas_id,body_hash) REFERENCES canvas_history_bodies(tenant_id,project_id,canvas_id,hash) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,media_id) REFERENCES media(tenant_id,id),
  FOREIGN KEY(tenant_id,asset_revision_id) REFERENCES asset_revisions(tenant_id,id)
);
CREATE INDEX canvas_media_retention ON canvas_media_refs(media_id,canvas_id);
CREATE TABLE canvas_subject_refs (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, canvas_id uuid NOT NULL, body_hash text NOT NULL,
  edge_id uuid NOT NULL, asset_id uuid NOT NULL,
  PRIMARY KEY(canvas_id,body_hash,edge_id),
  FOREIGN KEY(tenant_id,project_id,canvas_id,body_hash) REFERENCES canvas_history_bodies(tenant_id,project_id,canvas_id,hash) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,asset_id) REFERENCES assets(tenant_id,id)
);
-- A durable invalidation receipt, not a replacement for revision/CAS reads.
-- Consumer delivery is added with the editor event stream.
CREATE TABLE canvas_outbox (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, canvas_id uuid NOT NULL, revision bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(canvas_id,revision),
  FOREIGN KEY(tenant_id,project_id,canvas_id) REFERENCES canvases(tenant_id,project_id,id)
);
CREATE TABLE scene_workspace_preferences (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, scene_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id), revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  preference jsonb NOT NULL CHECK(octet_length(preference::text)<=262144),
  PRIMARY KEY(user_id,scene_id),
  FOREIGN KEY(tenant_id,project_id,scene_id) REFERENCES scenes(tenant_id,project_id,id)
);

CREATE FUNCTION validate_canvas_shape(doc jsonb) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE item jsonb; source jsonb; target jsonb; nodes jsonb; groups jsonb;
BEGIN
  IF jsonb_typeof(doc) IS DISTINCT FROM 'object'
    OR jsonb_typeof(doc->'nodes') IS DISTINCT FROM 'array'
    OR jsonb_typeof(doc->'edges') IS DISTINCT FROM 'array'
    OR jsonb_typeof(doc->'groups') IS DISTINCT FROM 'array'
    OR (doc - ARRAY['nodes','edges','groups'])<>'{}' THEN
    RAISE EXCEPTION 'Invalid canvas document' USING ERRCODE='P0425';
  END IF;
  IF jsonb_array_length(doc->'nodes')>2000 OR jsonb_array_length(doc->'edges')>5000 OR jsonb_array_length(doc->'groups')>200 THEN
    RAISE EXCEPTION 'Canvas capacity exceeded' USING ERRCODE='P0415';
  END IF;
  IF EXISTS(SELECT (x->>'id')::uuid FROM jsonb_array_elements((doc->'nodes')||(doc->'edges')||(doc->'groups')) x
    GROUP BY (x->>'id')::uuid HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Duplicate canvas identity' USING ERRCODE='P0425';
  END IF;
  SELECT jsonb_object_agg(lower(n->>'id'),n) INTO nodes FROM jsonb_array_elements(doc->'nodes') n;
  SELECT jsonb_object_agg(lower(g->>'id'),true) INTO groups FROM jsonb_array_elements(doc->'groups') g;
  FOR item IN SELECT * FROM jsonb_array_elements(doc->'nodes') LOOP
    IF item->>'kind' NOT IN ('text','image','video','audio') OR item->'content'->>'type' NOT IN ('text','media','draft')
      OR ((item->>'kind'='text') IS DISTINCT FROM (item->'content'->>'type'='text'))
      OR NOT ((item->'position'->>'x')::numeric BETWEEN -1000000 AND 1000000)
      OR NOT ((item->'position'->>'y')::numeric BETWEEN -1000000 AND 1000000)
      OR NOT ((item->>'width')::numeric BETWEEN 120 AND 1600)
      OR (item ? 'groupId' AND NOT coalesce(groups ? lower(item->>'groupId'),false)) THEN
      RAISE EXCEPTION 'Invalid node or group' USING ERRCODE='P0425';
    END IF;
  END LOOP;
  FOR item IN SELECT * FROM jsonb_array_elements(doc->'edges') LOOP
    source:=nodes->lower(item->>'sourceNodeId');
    target:=nodes->lower(item->>'targetNodeId');
    IF source IS NULL OR target IS NULL OR (source->>'id')::uuid=(target->>'id')::uuid
      OR source->'content'->>'type'='draft' OR target->'content'->>'type'<>'draft'
      OR (source->'content'->>'type'='text' AND item->>'purpose'<>'prompt') THEN
      RAISE EXCEPTION 'Invalid reference edge' USING ERRCODE='P0425';
    END IF;
  END LOOP;
END $$;
CREATE FUNCTION project_canvas_body() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE item jsonb;
BEGIN
  PERFORM validate_canvas_shape(NEW.document);
  FOR item IN SELECT * FROM jsonb_array_elements(NEW.document->'nodes') WHERE value->'content'->>'type'='media' LOOP
    INSERT INTO canvas_media_refs(tenant_id,project_id,canvas_id,body_hash,node_id,media_id,asset_revision_id)
      VALUES(NEW.tenant_id,NEW.project_id,NEW.canvas_id,NEW.hash,(item->>'id')::uuid,
        (item->'content'->>'mediaId')::uuid,(item->'content'->>'assetRevisionId')::uuid);
  END LOOP;
  FOR item IN SELECT * FROM jsonb_array_elements(NEW.document->'edges') WHERE value ? 'subjectAssetId' LOOP
    INSERT INTO canvas_subject_refs(tenant_id,project_id,canvas_id,body_hash,edge_id,asset_id)
      VALUES(NEW.tenant_id,NEW.project_id,NEW.canvas_id,NEW.hash,(item->>'id')::uuid,(item->>'subjectAssetId')::uuid);
  END LOOP;
  RETURN NEW;
END $$;
CREATE FUNCTION validate_canvas_revision() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE root canvases; doc jsonb; previous jsonb; previous_nodes jsonb; item jsonb; identity canvas_node_index; source media; keep_existing boolean;
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
      OR identity.asset_revision_id IS DISTINCT FROM (item->'content'->>'assetRevisionId')::uuid) THEN
      RAISE EXCEPTION 'Node identity is immutable, including tombstones' USING ERRCODE='P0425';
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
      INSERT INTO canvas_node_index(tenant_id,project_id,canvas_id,node_id,kind,content_type,media_id,asset_revision_id)
        VALUES(NEW.tenant_id,NEW.project_id,NEW.canvas_id,(item->>'id')::uuid,item->>'kind',item->'content'->>'type',
          (item->'content'->>'mediaId')::uuid,(item->'content'->>'assetRevisionId')::uuid);
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
CREATE FUNCTION advance_canvas_head() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  UPDATE canvases SET revision=NEW.revision,updated_at=NEW.created_at WHERE id=NEW.canvas_id;
  INSERT INTO canvas_outbox(tenant_id,project_id,canvas_id,revision) VALUES(NEW.tenant_id,NEW.project_id,NEW.canvas_id,NEW.revision);
  RETURN NEW;
END $$;
CREATE FUNCTION validate_canvas_current_references(target_canvas uuid) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE root canvases; item record;
BEGIN
  SELECT * INTO root FROM canvases WHERE id=target_canvas FOR UPDATE;
  IF root.id IS NULL THEN RAISE EXCEPTION 'Canvas missing' USING ERRCODE='P0002'; END IF;
  FOR item IN SELECT ref.* FROM canvas_media_refs ref JOIN canvas_revisions r ON r.canvas_id=ref.canvas_id AND r.body_hash=ref.body_hash
    WHERE r.canvas_id=root.id AND r.revision=root.revision LOOP
    IF NOT EXISTS(SELECT 1 FROM media WHERE tenant_id=root.tenant_id AND id=item.media_id
      AND (project_id IS NULL OR project_id=root.project_id) AND status IN ('ready','archived'))
      OR (item.asset_revision_id IS NOT NULL AND NOT asset_revision_usable(root.tenant_id,root.project_id,item.asset_revision_id,true)) THEN
      RAISE EXCEPTION 'Canvas reference access changed' USING ERRCODE='P0425';
    END IF;
  END LOOP;
  FOR item IN SELECT ref.* FROM canvas_subject_refs ref JOIN canvas_revisions r ON r.canvas_id=ref.canvas_id AND r.body_hash=ref.body_hash
    WHERE r.canvas_id=root.id AND r.revision=root.revision LOOP
    IF NOT asset_identity_usable(root.tenant_id,root.project_id,item.asset_id,true) THEN
      RAISE EXCEPTION 'Canvas subject access changed' USING ERRCODE='P0425';
    END IF;
  END LOOP;
END $$;
CREATE FUNCTION protect_canvas_node_creation() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  -- Only validate_canvas_revision's nested projection may establish identity.
  -- Runtime INSERT privilege is needed by that invoker trigger, not by callers.
  IF pg_trigger_depth()<>2 THEN RAISE EXCEPTION 'Node identity must come from a saved revision' USING ERRCODE='P0425'; END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION protect_canvas_head() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.revision<>0 OR NEW.created_by IS DISTINCT FROM actor_id() THEN RAISE EXCEPTION 'Invalid initial canvas' USING ERRCODE='23514'; END IF;
  ELSIF (NEW.id,NEW.tenant_id,NEW.project_id,NEW.schema_version,NEW.created_by,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.project_id,OLD.schema_version,OLD.created_by,OLD.created_at)
    OR NEW.revision<>OLD.revision+1 OR NEW.revision IS DISTINCT FROM (SELECT max(revision) FROM canvas_revisions WHERE canvas_id=NEW.id) THEN
    RAISE EXCEPTION 'Canvas root must follow its appended revision' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION protect_canvas_history() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE head bigint;
BEGIN
  SELECT revision INTO head FROM canvases WHERE id=OLD.canvas_id FOR UPDATE;
  IF TG_OP='UPDATE' OR OLD.revision>=head-1 THEN RAISE EXCEPTION 'Current and previous history are protected' USING ERRCODE='23514'; END IF;
  RETURN OLD;
END $$;
CREATE FUNCTION validate_canvas_projection() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE doc jsonb;
BEGIN
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
CREATE FUNCTION validate_scene_canvas_link() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  PERFORM 1 FROM scenes WHERE id=NEW.scene_id AND tenant_id=NEW.tenant_id AND project_id=NEW.project_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM scenes s JOIN episodes e ON e.id=s.episode_id WHERE s.id=NEW.scene_id AND s.status='active' AND e.status='active') THEN
    RAISE EXCEPTION 'Cannot create a canvas for archived content' USING ERRCODE='P0425';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION validate_scene_preference() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE p jsonb;
BEGIN
  p:=NEW.preference;
  IF NEW.user_id IS DISTINCT FROM actor_id() OR (TG_OP='INSERT' AND NEW.revision<>1)
    OR (TG_OP='UPDATE' AND ((NEW.tenant_id,NEW.project_id,NEW.scene_id,NEW.user_id) IS DISTINCT FROM (OLD.tenant_id,OLD.project_id,OLD.scene_id,OLD.user_id) OR NEW.revision<>OLD.revision+1)) THEN
    RAISE EXCEPTION 'Private preference version conflict' USING ERRCODE='P0412';
  END IF;
  IF p->>'mode' NOT IN ('storyboard','canvas') OR jsonb_typeof(p->'selectedNodeIds') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p->'selectedNodeIds')>2000
    OR NOT ((p->'viewport'->>'zoom')::numeric BETWEEN 0.1 AND 4)
    OR NOT ((p->'viewport'->>'x')::numeric BETWEEN -1000000 AND 1000000)
    OR NOT ((p->'viewport'->>'y')::numeric BETWEEN -1000000 AND 1000000)
    OR (p->>'selectedShotId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM shots WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND scene_id=NEW.scene_id AND id=(p->>'selectedShotId')::uuid)) THEN
    RAISE EXCEPTION 'Invalid scene preference' USING ERRCODE='P0425';
  END IF;
  -- A selection may reference a not-yet-saved local node. It carries no authority.
  RETURN NEW;
END $$;
CREATE TRIGGER canvas_body_project AFTER INSERT ON canvas_history_bodies FOR EACH ROW EXECUTE FUNCTION project_canvas_body();
CREATE TRIGGER canvas_body_immutable BEFORE UPDATE ON canvas_history_bodies FOR EACH ROW EXECUTE FUNCTION protect_content_revision();
CREATE TRIGGER canvas_append BEFORE INSERT ON canvas_revisions FOR EACH ROW EXECUTE FUNCTION validate_canvas_revision();
CREATE TRIGGER canvas_advance AFTER INSERT ON canvas_revisions FOR EACH ROW EXECUTE FUNCTION advance_canvas_head();
CREATE TRIGGER canvas_head_guard BEFORE INSERT OR UPDATE ON canvases FOR EACH ROW EXECUTE FUNCTION protect_canvas_head();
CREATE TRIGGER canvas_history_guard BEFORE UPDATE OR DELETE ON canvas_revisions FOR EACH ROW EXECUTE FUNCTION protect_canvas_history();
CREATE TRIGGER canvas_node_immutable BEFORE UPDATE OR DELETE ON canvas_node_index FOR EACH ROW EXECUTE FUNCTION protect_content_revision();
CREATE TRIGGER canvas_node_valid BEFORE INSERT ON canvas_node_index FOR EACH ROW EXECUTE FUNCTION protect_canvas_node_creation();
CREATE TRIGGER canvas_link_valid BEFORE INSERT ON scene_canvas_links FOR EACH ROW EXECUTE FUNCTION validate_scene_canvas_link();
CREATE TRIGGER canvas_link_immutable BEFORE UPDATE OR DELETE ON scene_canvas_links FOR EACH ROW EXECUTE FUNCTION protect_content_revision();
CREATE TRIGGER canvas_media_valid BEFORE INSERT ON canvas_media_refs FOR EACH ROW EXECUTE FUNCTION validate_canvas_projection();
CREATE TRIGGER canvas_subject_valid BEFORE INSERT ON canvas_subject_refs FOR EACH ROW EXECUTE FUNCTION validate_canvas_projection();
CREATE TRIGGER canvas_preference_valid BEFORE INSERT OR UPDATE ON scene_workspace_preferences FOR EACH ROW EXECUTE FUNCTION validate_scene_preference();
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['canvases','canvas_history_bodies','canvas_revisions','scene_canvas_links','canvas_node_index','canvas_media_refs','canvas_subject_refs','canvas_outbox','scene_workspace_preferences'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY canvas_scope ON %I USING (tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL) WITH CHECK (tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL)',t);
  END LOOP;
END $$;
CREATE POLICY own_scene_preference ON scene_workspace_preferences AS RESTRICTIVE USING(user_id=actor_id()) WITH CHECK(user_id=actor_id());
REVOKE ALL ON FUNCTION validate_canvas_shape(jsonb),project_canvas_body(),validate_canvas_revision(),advance_canvas_head(),protect_canvas_head(),protect_canvas_history(),validate_canvas_projection(),validate_scene_canvas_link(),validate_scene_preference() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_canvas_current_references(uuid),protect_canvas_node_creation() FROM PUBLIC;

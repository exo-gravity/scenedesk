-- Upload progress has an identity and landing point independent of the canvas
-- document. The existing permanent node index proves first placement even after
-- undo/removal; no worker writes a user's canvas or advances its revision.
CREATE TABLE canvas_upload_placements (
  upload_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  canvas_id uuid NOT NULL,
  node_id uuid NOT NULL UNIQUE,
  client_request_id uuid NOT NULL,
  x double precision NOT NULL CHECK(x BETWEEN -1000000 AND 1000000),
  y double precision NOT NULL CHECK(y BETWEEN -1000000 AND 1000000),
  dismissed boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(canvas_id,created_by,client_request_id),
  FOREIGN KEY(tenant_id,project_id,canvas_id) REFERENCES canvases(tenant_id,project_id,id),
  FOREIGN KEY(tenant_id,upload_id) REFERENCES upload_intents(tenant_id,id)
);
CREATE INDEX canvas_upload_pending ON canvas_upload_placements(tenant_id,project_id,canvas_id,created_at,upload_id) WHERE NOT dismissed;

CREATE FUNCTION validate_canvas_upload_placement() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE source upload_intents; root canvases;
BEGIN
  SELECT * INTO root FROM canvases WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND id=NEW.canvas_id FOR UPDATE;
  IF root.id IS NULL OR NOT EXISTS(SELECT 1 FROM projects WHERE tenant_id=NEW.tenant_id AND id=NEW.project_id AND status='active') THEN
    RAISE EXCEPTION 'Upload target must be an active authorized canvas' USING ERRCODE='P0425';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-'dismissed') IS DISTINCT FROM (to_jsonb(OLD)-'dismissed') OR NOT NEW.dismissed
      OR EXISTS(SELECT 1 FROM canvas_node_index WHERE node_id=OLD.node_id) THEN
      RAISE EXCEPTION 'Upload identity is immutable; placed nodes use document removal' USING ERRCODE='P0425';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO source FROM upload_intents WHERE tenant_id=NEW.tenant_id AND id=NEW.upload_id;
  IF source.id IS NULL OR source.project_id IS DISTINCT FROM NEW.project_id OR source.scope<>'project'
    OR source.status<>'pending' OR source.created_by IS DISTINCT FROM actor_id() OR NEW.created_by IS DISTINCT FROM actor_id()
    OR source.mime_hint NOT LIKE ALL(ARRAY['image/%','video/%','audio/%']) OR NEW.dismissed THEN
    RAISE EXCEPTION 'Canvas upload requires its new project media declaration and actual actor' USING ERRCODE='P0425';
  END IF;
  IF (SELECT count(*) FROM canvas_upload_placements p WHERE p.canvas_id=NEW.canvas_id AND NOT p.dismissed
    AND NOT EXISTS(SELECT 1 FROM canvas_node_index n WHERE n.node_id=p.node_id))>=100 THEN
    RAISE EXCEPTION 'Canvas pending upload limit exceeded' USING ERRCODE='P0415';
  END IF;
  NEW.created_at:=transaction_timestamp();
  RETURN NEW;
END $$;

-- A narrow integrity check must see reservations across project RLS boundaries,
-- so a known reserved UUID cannot be claimed by another project. It only checks
-- trigger rows and cannot be called as a general read or mutation endpoint.
CREATE FUNCTION guard_canvas_upload_node_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE reservation canvas_upload_placements; source media; accepted boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('canvas-node:'||NEW.node_id::text,0));
  IF TG_TABLE_NAME='canvas_upload_placements' THEN
    IF EXISTS(SELECT 1 FROM canvas_node_index WHERE node_id=NEW.node_id) THEN
      RAISE EXCEPTION 'Canvas upload identity already exists' USING ERRCODE='P0425';
    END IF;
  ELSE
    SELECT * INTO reservation FROM canvas_upload_placements WHERE node_id=NEW.node_id;
    IF reservation.upload_id IS NOT NULL THEN
      SELECT * INTO source FROM media WHERE source_upload_id=reservation.upload_id;
      SELECT status='accepted' INTO accepted FROM upload_intents WHERE id=reservation.upload_id;
      IF reservation.tenant_id<>NEW.tenant_id OR reservation.project_id<>NEW.project_id OR reservation.canvas_id<>NEW.canvas_id
        OR reservation.dismissed OR NEW.content_type<>'media' OR NEW.asset_revision_id IS NOT NULL
        OR source.id IS NULL OR NOT coalesce(accepted,false) OR source.status<>'ready'
        OR NEW.media_id IS DISTINCT FROM source.id OR NEW.kind<>source.kind THEN
        RAISE EXCEPTION 'Canvas upload node must use its accepted fixed media' USING ERRCODE='P0425';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER canvas_upload_01_valid BEFORE INSERT OR UPDATE ON canvas_upload_placements FOR EACH ROW EXECUTE FUNCTION validate_canvas_upload_placement();
CREATE TRIGGER canvas_upload_02_identity BEFORE INSERT ON canvas_upload_placements FOR EACH ROW EXECUTE FUNCTION guard_canvas_upload_node_identity();
CREATE TRIGGER canvas_node_upload_identity BEFORE INSERT ON canvas_node_index FOR EACH ROW EXECUTE FUNCTION guard_canvas_upload_node_identity();
ALTER TABLE canvas_upload_placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_upload_placements FORCE ROW LEVEL SECURITY;
CREATE POLICY canvas_upload_scope ON canvas_upload_placements
  USING(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL)
  WITH CHECK(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL);
REVOKE ALL ON FUNCTION validate_canvas_upload_placement(),guard_canvas_upload_node_identity() FROM PUBLIC;

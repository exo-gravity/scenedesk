-- Short-drama adapter facts stay outside the generic canvas document. Removing
-- a presentation preserves bindings; explicit unlink preserves Take/selection.
CREATE TABLE node_shot_bindings (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  canvas_id uuid NOT NULL, node_id uuid NOT NULL,
  shot_id uuid NOT NULL, shot_revision_id uuid NOT NULL,
  role text NOT NULL CHECK(role IN ('reference','candidate')),
  take_id uuid,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(canvas_id,node_id,shot_id,role),
  CHECK((role='candidate')=(take_id IS NOT NULL)),
  FOREIGN KEY(tenant_id,project_id,canvas_id,node_id) REFERENCES canvas_node_index(tenant_id,project_id,canvas_id,node_id),
  FOREIGN KEY(tenant_id,project_id,shot_id,shot_revision_id) REFERENCES shot_revisions(tenant_id,project_id,shot_id,id),
  FOREIGN KEY(tenant_id,project_id,shot_id,take_id) REFERENCES takes(tenant_id,project_id,shot_id,id)
);
CREATE INDEX node_shot_bindings_lookup ON node_shot_bindings(tenant_id,project_id,shot_id);
CREATE INDEX node_shot_bindings_take ON node_shot_bindings(take_id);

CREATE FUNCTION validate_node_shot_binding() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE binding node_shot_bindings; scene_id uuid; root canvases; node canvas_node_index; source media; candidate takes; doc jsonb; actual_shot shots;
BEGIN
  IF TG_OP='DELETE' THEN binding:=OLD; ELSE binding:=NEW; END IF;
  SELECT link.scene_id INTO scene_id FROM scene_canvas_links link
    WHERE link.tenant_id=binding.tenant_id AND link.project_id=binding.project_id AND link.canvas_id=binding.canvas_id;
  IF scene_id IS NULL THEN RAISE EXCEPTION 'Canvas does not belong to a scene' USING ERRCODE='P0425'; END IF;
  PERFORM id FROM scenes WHERE id=scene_id FOR UPDATE;
  SELECT * INTO root FROM canvases WHERE tenant_id=binding.tenant_id AND project_id=binding.project_id AND id=binding.canvas_id FOR UPDATE;
  IF root.id IS NULL THEN RAISE EXCEPTION 'Canvas is not accessible' USING ERRCODE='P0425'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  SELECT * INTO actual_shot FROM shots WHERE tenant_id=binding.tenant_id AND project_id=binding.project_id AND id=binding.shot_id FOR UPDATE;
  IF actual_shot.id IS NULL OR actual_shot.scene_id<>scene_id OR binding.created_by IS DISTINCT FROM actor_id()
    OR NOT candidate_shot_active(binding.tenant_id,binding.project_id,binding.shot_id) THEN
    RAISE EXCEPTION 'Binding requires an active shot from this scene and actual actor' USING ERRCODE='P0425';
  END IF;
  IF (SELECT count(*) FROM node_shot_bindings WHERE canvas_id=binding.canvas_id)>=10000 THEN
    RAISE EXCEPTION 'Canvas binding limit exceeded' USING ERRCODE='P0415';
  END IF;
  SELECT * INTO node FROM canvas_node_index WHERE tenant_id=binding.tenant_id AND project_id=binding.project_id AND canvas_id=binding.canvas_id AND node_id=binding.node_id;
  SELECT b.document INTO doc FROM canvas_revisions r JOIN canvas_history_bodies b ON b.canvas_id=r.canvas_id AND b.hash=r.body_hash
    WHERE r.canvas_id=root.id AND r.revision=root.revision;
  IF node.node_id IS NULL OR node.content_type<>'media' OR NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(doc->'nodes') n WHERE (n->>'id')::uuid=binding.node_id) THEN
    RAISE EXCEPTION 'Only a current fixed media node can be linked' USING ERRCODE='P0425';
  END IF;
  SELECT * INTO source FROM media WHERE tenant_id=binding.tenant_id AND id=node.media_id FOR SHARE;
  IF source.id IS NULL OR source.status<>'ready' OR (source.project_id IS NOT NULL AND source.project_id<>binding.project_id) THEN
    RAISE EXCEPTION 'New binding requires available authorized media' USING ERRCODE='P0425';
  END IF;
  IF node.asset_revision_id IS NOT NULL AND NOT asset_revision_usable(binding.tenant_id,binding.project_id,node.asset_revision_id,false) THEN
    RAISE EXCEPTION 'Fixed asset version is unavailable' USING ERRCODE='P0425';
  END IF;
  IF binding.role='candidate' THEN
    SELECT * INTO candidate FROM takes WHERE tenant_id=binding.tenant_id AND project_id=binding.project_id AND id=binding.take_id;
    IF source.kind<>'video' OR candidate.id IS NULL OR candidate.shot_id<>binding.shot_id
      OR candidate.shot_revision_id<>binding.shot_revision_id OR candidate.media_id<>node.media_id
      OR candidate.in_us<0 OR candidate.out_us<=candidate.in_us OR candidate.out_us>source.duration_us THEN
      RAISE EXCEPTION 'Candidate does not match fixed node and shot requirements' USING ERRCODE='P0425';
    END IF;
  END IF;
  RETURN NEW;
END $$;
-- Every binding change advances the shared canvas CAS and emits the normal
-- outbox entry, including restricted SQL writers. The same body is reused.
CREATE FUNCTION advance_canvas_binding_revision() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE binding node_shot_bindings; root canvases; current_hash text;
BEGIN
  IF TG_OP='DELETE' THEN binding:=OLD; ELSE binding:=NEW; END IF;
  SELECT * INTO root FROM canvases WHERE id=binding.canvas_id FOR UPDATE;
  SELECT body_hash INTO current_hash FROM canvas_revisions WHERE canvas_id=root.id AND revision=root.revision;
  INSERT INTO canvas_revisions(tenant_id,project_id,canvas_id,revision,body_hash,updated_by)
    VALUES(binding.tenant_id,binding.project_id,binding.canvas_id,root.revision+1,current_hash,actor_id());
  RETURN NULL;
END $$;
CREATE TRIGGER node_shot_binding_valid BEFORE INSERT OR DELETE ON node_shot_bindings FOR EACH ROW EXECUTE FUNCTION validate_node_shot_binding();
CREATE TRIGGER node_shot_binding_immutable BEFORE UPDATE ON node_shot_bindings FOR EACH ROW EXECUTE FUNCTION protect_content_revision();
CREATE TRIGGER node_shot_binding_revision AFTER INSERT OR DELETE ON node_shot_bindings FOR EACH ROW EXECUTE FUNCTION advance_canvas_binding_revision();
ALTER TABLE node_shot_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE node_shot_bindings FORCE ROW LEVEL SECURITY;
CREATE POLICY node_shot_binding_scope ON node_shot_bindings
  USING(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL)
  WITH CHECK(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL);
REVOKE ALL ON FUNCTION validate_node_shot_binding(),advance_canvas_binding_revision() FROM PUBLIC;

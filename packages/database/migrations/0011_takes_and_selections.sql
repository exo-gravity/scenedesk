-- Candidates are immutable source intervals. A shot's preference is a separate
-- append-only decision history; neither fact is an edit or a review approval.
CREATE TABLE takes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  shot_id uuid NOT NULL, shot_revision_id uuid NOT NULL, media_id uuid NOT NULL,
  in_us bigint NOT NULL CHECK (in_us BETWEEN 0 AND 9007199254740991),
  out_us bigint NOT NULL CHECK (out_us BETWEEN 1 AND 9007199254740991),
  source_take_id uuid, note text CHECK (length(note)<=20000),
  created_by uuid NOT NULL REFERENCES users(id),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision=1),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (in_us<out_us), CHECK (source_take_id IS DISTINCT FROM id),
  UNIQUE (shot_revision_id,media_id,in_us,out_us),
  UNIQUE (tenant_id,project_id,id),
  UNIQUE (tenant_id,project_id,shot_id,id),
  UNIQUE (tenant_id,project_id,media_id,id),
  FOREIGN KEY (tenant_id,project_id,shot_id,shot_revision_id) REFERENCES shot_revisions(tenant_id,project_id,shot_id,id),
  FOREIGN KEY (tenant_id,media_id) REFERENCES media(tenant_id,id),
  FOREIGN KEY (tenant_id,project_id,media_id,source_take_id) REFERENCES takes(tenant_id,project_id,media_id,id)
);
CREATE INDEX takes_shot_history ON takes(tenant_id,project_id,shot_id,created_at,id);
CREATE INDEX takes_media_retention ON takes(media_id);
CREATE INDEX takes_source_lineage ON takes(source_take_id);

CREATE TABLE selections (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, shot_id uuid NOT NULL,
  number bigint NOT NULL CHECK (number BETWEEN 1 AND 9007199254740991),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision=1),
  take_id uuid, selected_by uuid NOT NULL REFERENCES users(id),
  reason text CHECK (length(reason)<=20000), supersedes_selection_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shot_id,number), UNIQUE (tenant_id,project_id,shot_id,id),
  CHECK (supersedes_selection_id IS DISTINCT FROM id),
  FOREIGN KEY (tenant_id,project_id,shot_id) REFERENCES shots(tenant_id,project_id,id),
  FOREIGN KEY (tenant_id,project_id,shot_id,take_id) REFERENCES takes(tenant_id,project_id,shot_id,id),
  FOREIGN KEY (tenant_id,project_id,shot_id,supersedes_selection_id) REFERENCES selections(tenant_id,project_id,shot_id,id)
);
CREATE INDEX selections_history ON selections(tenant_id,project_id,shot_id,created_at,id);
CREATE INDEX selections_take_retention ON selections(take_id);
ALTER TABLE shots ADD COLUMN current_selection_id uuid,
  ADD CONSTRAINT shot_current_selection_scope FOREIGN KEY (tenant_id,project_id,id,current_selection_id)
    REFERENCES selections(tenant_id,project_id,shot_id,id);

CREATE FUNCTION candidate_shot_active(target_tenant uuid,target_project uuid,target_shot uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT EXISTS (SELECT 1 FROM shots s JOIN scenes c ON c.id=s.scene_id JOIN episodes e ON e.id=c.episode_id JOIN projects p ON p.id=s.project_id
    WHERE s.tenant_id=target_tenant AND s.project_id=target_project AND s.id=target_shot
      AND s.status='active' AND c.status='active' AND e.status='active' AND p.status='active')
$$;
CREATE FUNCTION validate_take() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE source media;
BEGIN
  IF NEW.created_by IS DISTINCT FROM actor_id() OR NOT candidate_shot_active(NEW.tenant_id,NEW.project_id,NEW.shot_id) THEN
    RAISE EXCEPTION 'Candidate requires an active authorized shot and actual actor' USING ERRCODE='P0423';
  END IF;
  SELECT * INTO source FROM media WHERE tenant_id=NEW.tenant_id AND id=NEW.media_id FOR SHARE;
  IF source.id IS NULL OR source.kind<>'video' OR source.status<>'ready'
    OR (source.project_id IS NOT NULL AND source.project_id<>NEW.project_id)
    OR source.duration_us IS NULL OR NEW.in_us<0 OR NEW.out_us<=NEW.in_us OR NEW.out_us>source.duration_us THEN
    RAISE EXCEPTION 'Candidate interval requires an authorized ready video and accepted duration' USING ERRCODE='P0423';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM shot_revisions WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id
    AND shot_id=NEW.shot_id AND id=NEW.shot_revision_id) OR
    (NEW.source_take_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM takes WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id
      AND id=NEW.source_take_id AND media_id=NEW.media_id)) THEN
    RAISE EXCEPTION 'Candidate requirements or source lineage do not match' USING ERRCODE='P0423';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER take_valid BEFORE INSERT ON takes FOR EACH ROW EXECUTE FUNCTION validate_take();
CREATE TRIGGER take_immutable BEFORE UPDATE OR DELETE ON takes FOR EACH ROW EXECUTE FUNCTION protect_content_revision();

CREATE FUNCTION validate_selection() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE root shots; previous_number bigint; candidate takes; source_status text;
BEGIN
  SELECT * INTO root FROM shots WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND id=NEW.shot_id FOR UPDATE;
  IF root.id IS NULL OR NEW.selected_by IS DISTINCT FROM actor_id()
    OR NOT candidate_shot_active(NEW.tenant_id,NEW.project_id,NEW.shot_id) THEN
    RAISE EXCEPTION 'Selection requires an active authorized shot and actual actor' USING ERRCODE='P0423';
  END IF;
  SELECT number INTO previous_number FROM selections WHERE id=root.current_selection_id;
  IF NEW.supersedes_selection_id IS DISTINCT FROM root.current_selection_id OR NEW.number<>coalesce(previous_number,0)+1 THEN
    RAISE EXCEPTION 'Selection must append to the current decision' USING ERRCODE='P0412';
  END IF;
  IF NEW.take_id IS NOT NULL THEN
    SELECT * INTO candidate FROM takes WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND shot_id=NEW.shot_id AND id=NEW.take_id;
    IF candidate.id IS NULL THEN RAISE EXCEPTION 'Candidate does not belong to this shot' USING ERRCODE='P0423'; END IF;
    IF candidate.shot_revision_id<>root.current_revision_id THEN
      RAISE EXCEPTION 'Reuse the old candidate explicitly under current requirements before selection' USING ERRCODE='P0409';
    END IF;
    SELECT status INTO source_status FROM media WHERE tenant_id=NEW.tenant_id AND id=candidate.media_id FOR SHARE;
    IF source_status IS DISTINCT FROM 'ready' THEN
      RAISE EXCEPTION 'Archived media cannot become a new selection' USING ERRCODE='P0423';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION project_selection() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  UPDATE shots SET current_selection_id=NEW.id,revision=revision+1,updated_at=now() WHERE id=NEW.shot_id;
  UPDATE project_content_versions SET revision=revision+1 WHERE project_id=NEW.project_id;
  RETURN NEW;
END $$;
CREATE FUNCTION protect_selection_pointer() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE expected uuid;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.current_selection_id IS NOT NULL THEN RAISE EXCEPTION 'New shot cannot inherit a selection' USING ERRCODE='23514'; END IF;
  ELSIF NEW.current_selection_id IS DISTINCT FROM OLD.current_selection_id THEN
    SELECT id INTO expected FROM selections WHERE tenant_id=NEW.tenant_id AND project_id=NEW.project_id AND shot_id=NEW.id ORDER BY number DESC LIMIT 1;
    IF NEW.current_selection_id IS DISTINCT FROM expected OR NEW.revision<>OLD.revision+1 THEN
      RAISE EXCEPTION 'Shot pointer must follow the latest appended selection' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER selection_valid BEFORE INSERT ON selections FOR EACH ROW EXECUTE FUNCTION validate_selection();
CREATE TRIGGER selection_project AFTER INSERT ON selections FOR EACH ROW EXECUTE FUNCTION project_selection();
CREATE TRIGGER selection_immutable BEFORE UPDATE OR DELETE ON selections FOR EACH ROW EXECUTE FUNCTION protect_content_revision();
CREATE TRIGGER shot_selection_guard BEFORE INSERT OR UPDATE OF current_selection_id ON shots FOR EACH ROW EXECUTE FUNCTION protect_selection_pointer();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['takes','selections'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY candidate_project_scope ON %I USING (tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL) WITH CHECK (tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL)',t);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION candidate_shot_active(uuid,uuid,uuid),validate_take(),validate_selection(),project_selection(),protect_selection_pointer() FROM PUBLIC;

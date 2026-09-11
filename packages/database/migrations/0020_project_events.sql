-- Resource hints contain only identities and revisions. Relay cursors are
-- allocated after producer commit, independently from content transactions.
CREATE TABLE project_event_outbox (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  resource_kind text NOT NULL CHECK(resource_kind IN ('project','content','shot','asset','media','take','selection','task','proposal','cut','cut_work_draft')),
  resource_id uuid NOT NULL, resource_revision bigint NOT NULL CHECK(resource_revision BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(project_id,resource_kind,resource_id),
  FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
CREATE TABLE project_event_heads (
  tenant_id uuid NOT NULL, project_id uuid PRIMARY KEY,
  seq bigint NOT NULL DEFAULT 0 CHECK(seq>=0), pruned_seq bigint NOT NULL DEFAULT 0 CHECK(pruned_seq BETWEEN 0 AND seq),
  FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
CREATE TABLE project_events (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL, seq bigint NOT NULL CHECK(seq>0),
  resource_kind text NOT NULL, resource_id uuid NOT NULL,
  resource_revision bigint NOT NULL CHECK(resource_revision BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(project_id,seq),
  FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
CREATE INDEX project_events_expiry ON project_events(project_id,created_at,seq);
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['project_event_outbox','project_event_heads','project_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',name);
    EXECUTE format('CREATE POLICY project_event_scope ON %I USING(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL) WITH CHECK(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL)',name);
  END LOOP;
END $$;

CREATE FUNCTION record_project_invalidation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE row_data jsonb:=to_jsonb(NEW); target_project uuid; revision_value bigint;
BEGIN
  target_project:=(row_data->>CASE WHEN TG_TABLE_NAME='projects' THEN 'id' ELSE 'project_id' END)::uuid;
  IF target_project IS NULL THEN RETURN NULL; END IF;
  revision_value:=(row_data->>TG_ARGV[2])::bigint;
  IF TG_OP='UPDATE' AND revision_value<=(to_jsonb(OLD)->>TG_ARGV[2])::bigint THEN RETURN NULL; END IF;
  INSERT INTO project_event_outbox(tenant_id,project_id,resource_kind,resource_id,resource_revision)
    VALUES((row_data->>'tenant_id')::uuid,target_project,TG_ARGV[0],(row_data->>TG_ARGV[1])::uuid,revision_value)
    ON CONFLICT(project_id,resource_kind,resource_id) DO UPDATE SET resource_revision=greatest(project_event_outbox.resource_revision,excluded.resource_revision),created_at=clock_timestamp();
  RETURN NULL;
END $$;
DO $$ DECLARE item text[]; BEGIN
  FOREACH item SLICE 1 IN ARRAY ARRAY[
    ['projects','project','id','revision'],['project_content_versions','content','project_id','revision'],
    ['shots','shot','id','revision'],['assets','asset','id','revision'],['media','media','id','revision'],
    ['takes','take','id','revision'],['selections','selection','shot_id','number'],
    ['production_tasks','task','id','revision'],['analysis_proposals','proposal','id','revision'],
    ['cuts','cut','id','revision'],['cut_work_drafts','cut_work_draft','cut_id','revision']
  ] LOOP
    EXECUTE format('CREATE TRIGGER project_invalidation AFTER INSERT OR UPDATE OF %I ON %I FOR EACH ROW EXECUTE FUNCTION record_project_invalidation(%L,%L,%L)',item[4],item[1],item[2],item[3],item[4]);
  END LOOP;
END $$;

CREATE FUNCTION validate_canvas_invalidation() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM canvas_revisions r WHERE r.tenant_id=NEW.tenant_id AND r.project_id=NEW.project_id
    AND r.canvas_id=NEW.canvas_id AND r.revision=NEW.revision) THEN
    RAISE EXCEPTION 'Canvas invalidation requires an actual revision' USING ERRCODE='P0425';
  END IF;
  NEW.created_at:=clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER canvas_invalidation_valid BEFORE INSERT ON canvas_outbox FOR EACH ROW EXECUTE FUNCTION validate_canvas_invalidation();

CREATE FUNCTION relay_project_events(target uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE item record; cursor_value bigint; floor_value bigint; own_xid xid;
BEGIN
  IF lock_tenant(tenant_scope(),false) IS NULL OR lock_project(target,false) IS NULL THEN
    RAISE EXCEPTION 'Project events are unavailable' USING ERRCODE='P0002';
  END IF;
  INSERT INTO project_event_heads(tenant_id,project_id) VALUES(tenant_scope(),target) ON CONFLICT(project_id) DO NOTHING;
  PERFORM project_id FROM project_event_heads WHERE tenant_id=tenant_scope() AND project_id=target FOR UPDATE;
  own_xid:=pg_current_xact_id()::text::xid;
  -- Ignore this transaction's own writes even when called directly through SQL.
  FOR item IN
    SELECT 'canvas'::text AS kind,c.canvas_id AS id,max(c.revision) AS revision FROM canvas_outbox c
      WHERE c.tenant_id=tenant_scope() AND c.project_id=target AND c.xmin<>own_xid GROUP BY c.canvas_id
    UNION ALL
    SELECT p.resource_kind,p.resource_id,p.resource_revision FROM project_event_outbox p
      WHERE p.tenant_id=tenant_scope() AND p.project_id=target AND p.xmin<>own_xid
    ORDER BY kind,id LIMIT 200
  LOOP
    UPDATE project_event_heads SET seq=seq+1 WHERE project_id=target RETURNING seq INTO cursor_value;
    INSERT INTO project_events(tenant_id,project_id,seq,resource_kind,resource_id,resource_revision)
      VALUES(tenant_scope(),target,cursor_value,item.kind,item.id,item.revision);
    IF item.kind='canvas' THEN
      DELETE FROM canvas_outbox WHERE project_id=target AND canvas_id=item.id AND revision<=item.revision AND xmin<>own_xid;
    ELSE
      DELETE FROM project_event_outbox WHERE project_id=target AND resource_kind=item.kind AND resource_id=item.id AND resource_revision<=item.revision AND xmin<>own_xid;
    END IF;
  END LOOP;
  SELECT coalesce(max(e.seq),0) INTO floor_value FROM project_events e JOIN project_event_heads h ON h.project_id=e.project_id
    WHERE e.project_id=target AND (e.seq<=h.seq-10000 OR e.created_at<clock_timestamp()-interval '24 hours');
  UPDATE project_event_heads SET pruned_seq=greatest(pruned_seq,floor_value) WHERE project_id=target;
  DELETE FROM project_events WHERE project_id=target AND seq<=floor_value;
END $$;
REVOKE ALL ON FUNCTION record_project_invalidation(),validate_canvas_invalidation(),relay_project_events(uuid) FROM PUBLIC;

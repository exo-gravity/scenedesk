-- Ephemeral viewing/editing hints have typed owners and never advance content CAS.
CREATE TABLE editing_presence (
  tenant_id uuid NOT NULL, project_id uuid NOT NULL,
  canvas_id uuid, cut_id uuid,
  target_kind text GENERATED ALWAYS AS (CASE WHEN canvas_id IS NOT NULL THEN 'canvas' ELSE 'cut_work_draft' END) STORED,
  object_id uuid GENERATED ALWAYS AS (coalesce(canvas_id,cut_id)) STORED,
  membership_id uuid NOT NULL, session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  client_session_id uuid NOT NULL, activity text NOT NULL CHECK(activity IN ('viewing','editing')),
  last_seen_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  PRIMARY KEY(target_kind,object_id,membership_id,client_session_id),
  CHECK(num_nonnulls(canvas_id,cut_id)=1),
  CHECK(expires_at=last_seen_at+interval '90 seconds'),
  FOREIGN KEY(tenant_id,project_id,canvas_id) REFERENCES canvases(tenant_id,project_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,project_id,cut_id) REFERENCES cuts(tenant_id,project_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,membership_id) REFERENCES memberships(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX editing_presence_expiry ON editing_presence(project_id,expires_at);
CREATE INDEX editing_presence_session ON editing_presence(session_id);
CREATE INDEX editing_presence_member ON editing_presence(membership_id,project_id);
ALTER TABLE editing_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE editing_presence FORCE ROW LEVEL SECURITY;
CREATE POLICY editing_presence_scope ON editing_presence
  USING(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL)
  WITH CHECK(tenant_id=tenant_scope() AND project_role(project_id) IS NOT NULL);

CREATE FUNCTION lock_editing_presence_target(target_project uuid,kind text,target_object uuid,editing boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE editable boolean; found_object uuid;
BEGIN
  IF lock_tenant(tenant_scope(),false) IS NULL OR lock_project(target_project,false) IS NULL THEN
    RAISE EXCEPTION 'Editing target is unavailable' USING ERRCODE='P0002';
  END IF;
  IF kind='canvas' THEN
    SELECT c.id,p.status='active' AND (l.scene_id IS NULL OR (s.status='active' AND e.status='active'))
      INTO found_object,editable FROM canvases c JOIN projects p ON p.id=c.project_id
      LEFT JOIN scene_canvas_links l ON l.canvas_id=c.id LEFT JOIN scenes s ON s.id=l.scene_id LEFT JOIN episodes e ON e.id=s.episode_id
      WHERE c.tenant_id=tenant_scope() AND c.project_id=target_project AND c.id=target_object;
  ELSIF kind='cut_work_draft' THEN
    SELECT c.id,p.status='active' AND c.status='active' AND (c.scene_id IS NULL OR s.status='active')
        AND (coalesce(c.episode_id,s.episode_id) IS NULL OR e.status='active')
      INTO found_object,editable FROM cuts c JOIN projects p ON p.id=c.project_id
      LEFT JOIN scenes s ON s.id=c.scene_id LEFT JOIN episodes e ON e.id=coalesce(c.episode_id,s.episode_id)
      WHERE c.tenant_id=tenant_scope() AND c.project_id=target_project AND c.id=target_object;
  END IF;
  IF found_object IS NULL THEN RAISE EXCEPTION 'Editing target is unavailable' USING ERRCODE='P0002'; END IF;
  IF editing AND editable IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Archived target cannot be actively edited' USING ERRCODE='P0426';
  END IF;
  -- A short hint lock serializes capacity checks, never the lifetime of an editor.
  PERFORM pg_advisory_xact_lock(hashtextextended('editing-presence:'||kind||':'||target_object::text,0));
END $$;

CREATE FUNCTION editing_presence_member_valid(target_tenant uuid,target_project uuid,member uuid,login uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
  SELECT EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id JOIN sessions s ON s.user_id=u.id
    JOIN tenants t ON t.id=m.tenant_id
    WHERE m.id=member AND m.tenant_id=target_tenant AND m.status='active' AND t.status='active' AND u.status='active'
      AND s.id=login AND s.revoked_at IS NULL AND s.expires_at>statement_timestamp()
      AND (m.role IN ('owner','admin') OR EXISTS(SELECT 1 FROM project_memberships pm WHERE pm.project_id=target_project AND pm.membership_id=m.id)))
$$;

CREATE FUNCTION get_editing_presence(target_project uuid,kind text,target_object uuid)
RETURNS TABLE(membership_id uuid,client_session_id uuid,activity text,last_seen_at timestamptz,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
  PERFORM lock_editing_presence_target(target_project,kind,target_object,false);
  DELETE FROM editing_presence p WHERE p.project_id=target_project AND p.tenant_id=tenant_scope()
    AND p.target_kind=kind AND p.object_id=target_object AND (p.expires_at<=clock_timestamp()
      OR NOT editing_presence_member_valid(p.tenant_id,p.project_id,p.membership_id,p.session_id));
  RETURN QUERY SELECT p.membership_id,p.client_session_id,p.activity,p.last_seen_at,p.expires_at
    FROM editing_presence p WHERE p.tenant_id=tenant_scope() AND p.project_id=target_project
      AND p.target_kind=kind AND p.object_id=target_object AND p.expires_at>clock_timestamp()
    ORDER BY p.last_seen_at DESC,p.membership_id,p.client_session_id LIMIT 500;
END $$;

CREATE FUNCTION put_editing_presence(target_project uuid,kind text,target_object uuid,client uuid,activity_value text,login uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE member uuid; touched timestamptz;
BEGIN
  IF client IS NULL OR activity_value IS NULL OR activity_value NOT IN ('viewing','editing') THEN
    RAISE EXCEPTION 'Invalid editing activity' USING ERRCODE='22023';
  END IF;
  PERFORM id FROM sessions WHERE id=login AND user_id=actor_id() AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current actor session required' USING ERRCODE='42501'; END IF;
  PERFORM lock_editing_presence_target(target_project,kind,target_object,activity_value='editing');
  SELECT id INTO member FROM memberships WHERE tenant_id=tenant_scope() AND user_id=actor_id() AND status='active';
  PERFORM * FROM get_editing_presence(target_project,kind,target_object);
  IF EXISTS(SELECT 1 FROM editing_presence p JOIN sessions previous ON previous.id=p.session_id JOIN sessions current_login ON current_login.id=login
    WHERE p.target_kind=kind AND p.object_id=target_object AND p.membership_id=member AND p.client_session_id=client
      AND (previous.created_at,previous.id)>(current_login.created_at,current_login.id)) THEN
    RAISE EXCEPTION 'A newer login owns this client activity' USING ERRCODE='P0427';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM editing_presence p WHERE p.target_kind=kind AND p.object_id=target_object
      AND p.membership_id=member AND p.client_session_id=client) THEN
    IF (SELECT count(*) FROM editing_presence p WHERE p.target_kind=kind AND p.object_id=target_object AND p.membership_id=member)>=5
      OR (SELECT count(*) FROM editing_presence p WHERE p.target_kind=kind AND p.object_id=target_object)>=500 THEN
      RAISE EXCEPTION 'Editing presence client limit reached' USING ERRCODE='P0429';
    END IF;
  END IF;
  touched:=clock_timestamp();
  INSERT INTO editing_presence(tenant_id,project_id,canvas_id,cut_id,membership_id,session_id,client_session_id,activity,last_seen_at,expires_at)
    VALUES(tenant_scope(),target_project,CASE WHEN kind='canvas' THEN target_object END,CASE WHEN kind='cut_work_draft' THEN target_object END,
      member,login,client,activity_value,touched,touched+interval '90 seconds')
    ON CONFLICT(target_kind,object_id,membership_id,client_session_id) DO UPDATE
      SET session_id=excluded.session_id,activity=excluded.activity,last_seen_at=excluded.last_seen_at,expires_at=excluded.expires_at;
END $$;

CREATE FUNCTION clear_revoked_editing_presence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
  IF TG_TABLE_NAME='sessions' THEN DELETE FROM editing_presence WHERE session_id=NEW.id;
  ELSIF TG_TABLE_NAME='memberships' THEN DELETE FROM editing_presence WHERE membership_id=NEW.id;
  ELSIF TG_TABLE_NAME='project_memberships' THEN DELETE FROM editing_presence WHERE project_id=OLD.project_id AND membership_id=OLD.membership_id;
  ELSIF TG_TABLE_NAME='users' THEN DELETE FROM editing_presence WHERE membership_id IN (SELECT id FROM memberships WHERE user_id=NEW.id);
  ELSIF TG_TABLE_NAME='tenants' THEN DELETE FROM editing_presence WHERE tenant_id=NEW.id;
  ELSIF TG_TABLE_NAME='projects' THEN DELETE FROM editing_presence WHERE project_id=NEW.id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER session_presence_revoked AFTER UPDATE OF revoked_at,expires_at ON sessions FOR EACH ROW
  WHEN(OLD.revoked_at IS DISTINCT FROM NEW.revoked_at OR OLD.expires_at IS DISTINCT FROM NEW.expires_at) EXECUTE FUNCTION clear_revoked_editing_presence();
CREATE TRIGGER member_presence_revoked AFTER UPDATE OF role,status ON memberships FOR EACH ROW
  WHEN(OLD.role IS DISTINCT FROM NEW.role OR OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION clear_revoked_editing_presence();
CREATE TRIGGER project_member_presence_revoked AFTER DELETE ON project_memberships FOR EACH ROW EXECUTE FUNCTION clear_revoked_editing_presence();
CREATE TRIGGER user_presence_revoked AFTER UPDATE OF status ON users FOR EACH ROW WHEN(OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION clear_revoked_editing_presence();
CREATE TRIGGER tenant_presence_revoked AFTER UPDATE OF status ON tenants FOR EACH ROW WHEN(OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION clear_revoked_editing_presence();
CREATE TRIGGER project_presence_archived AFTER UPDATE OF status ON projects FOR EACH ROW WHEN(OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION clear_revoked_editing_presence();
REVOKE ALL ON FUNCTION lock_editing_presence_target(uuid,text,uuid,boolean),editing_presence_member_valid(uuid,uuid,uuid,uuid),
  get_editing_presence(uuid,text,uuid),put_editing_presence(uuid,text,uuid,uuid,text,uuid),clear_revoked_editing_presence() FROM PUBLIC;

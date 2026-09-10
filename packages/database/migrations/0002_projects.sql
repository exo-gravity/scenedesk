CREATE TABLE projects (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  kind text NOT NULL DEFAULT 'drama' CHECK (kind = 'drama'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  lead_membership_id uuid NOT NULL,
  spec jsonb NOT NULL CHECK (jsonb_typeof(spec) = 'object'),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, lead_membership_id) REFERENCES memberships(tenant_id, id)
);
CREATE INDEX projects_tenant ON projects(tenant_id, id);
CREATE INDEX projects_lead ON projects(lead_membership_id);

CREATE TABLE project_memberships (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('lead', 'collaborator')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  FOREIGN KEY (tenant_id, membership_id) REFERENCES memberships(tenant_id, id),
  UNIQUE (project_id, membership_id)
);
CREATE UNIQUE INDEX projects_one_lead ON project_memberships(project_id) WHERE role = 'lead';
CREATE INDEX project_memberships_member ON project_memberships(tenant_id, membership_id);

CREATE TABLE productions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL UNIQUE,
  title text NOT NULL,
  brief text NOT NULL DEFAULT '',
  default_asset_revision_ids jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(default_asset_revision_ids) = 'array'),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  UNIQUE (tenant_id, project_id, id)
);

CREATE TABLE project_content_versions (
  tenant_id uuid NOT NULL,
  project_id uuid PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  current_script_revision_id uuid,
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES users(id),
  tenant_id uuid REFERENCES tenants(id),
  project_id uuid,
  operation_id text NOT NULL,
  object_id uuid,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id),
  CHECK (project_id IS NULL OR tenant_id IS NOT NULL)
);
CREATE INDEX audit_scope ON audit_events(tenant_id, project_id, created_at);

CREATE FUNCTION project_role(target uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
  SELECT CASE WHEN m.role IN ('owner', 'admin') THEN 'admin' ELSE pm.role END
  FROM projects p JOIN tenants t ON t.id = p.tenant_id
  JOIN memberships m ON m.tenant_id = p.tenant_id AND m.user_id = actor_id()
  LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.membership_id = m.id
  WHERE p.id = target AND p.tenant_id = tenant_scope()
    AND m.status = 'active' AND t.status = 'active'
$$;

CREATE FUNCTION enforce_project_lead() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE target_project uuid; target_member uuid;
BEGIN
  IF TG_TABLE_NAME = 'projects' THEN target_project := NEW.id;
  ELSIF TG_TABLE_NAME = 'project_memberships' THEN target_project := COALESCE(NEW.project_id, OLD.project_id);
  ELSE target_member := NEW.id; END IF;
  IF EXISTS (SELECT 1 FROM projects p WHERE
    (p.id = target_project OR p.lead_membership_id = target_member) AND
    NOT EXISTS (SELECT 1 FROM project_memberships pm JOIN memberships m ON m.id = pm.membership_id
      WHERE pm.project_id = p.id AND pm.membership_id = p.lead_membership_id
        AND pm.role = 'lead' AND m.status = 'active'))
  THEN RAISE EXCEPTION 'Project must retain an active lead' USING ERRCODE = '23514'; END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION lock_project(target uuid, exclusive_lock boolean) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
  IF project_role(target) IS NULL THEN RETURN NULL; END IF;
  IF exclusive_lock THEN PERFORM id FROM projects WHERE id = target FOR UPDATE;
  ELSE PERFORM id FROM projects WHERE id = target FOR SHARE; END IF;
  RETURN project_role(target);
END $$;
CREATE CONSTRAINT TRIGGER project_lead_integrity AFTER INSERT OR UPDATE ON projects
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_project_lead();
CREATE CONSTRAINT TRIGGER project_membership_lead_integrity AFTER INSERT OR UPDATE OR DELETE ON project_memberships
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_project_lead();
CREATE CONSTRAINT TRIGGER active_lead_integrity AFTER UPDATE ON memberships
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_project_lead();

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
-- A newly inserted project is not visible to the STABLE project_role lookup
-- during INSERT RETURNING. Managers' access follows the row's tenant directly.
CREATE POLICY projects_read ON projects FOR SELECT USING
  (tenant_id = tenant_scope() AND
    (tenant_role(tenant_id) IN ('owner', 'admin') OR project_role(id) IS NOT NULL));
CREATE POLICY projects_create ON projects FOR INSERT WITH CHECK
  (tenant_id = tenant_scope() AND tenant_role(tenant_id) IN ('owner', 'admin'));
CREATE POLICY projects_change ON projects FOR UPDATE USING
  (project_role(id) IN ('admin', 'lead')) WITH CHECK
  (tenant_id = tenant_scope() AND project_role(id) IN ('admin', 'lead'));

ALTER TABLE project_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY project_memberships_read ON project_memberships FOR SELECT USING (project_role(project_id) IS NOT NULL);
CREATE POLICY project_memberships_create ON project_memberships FOR INSERT WITH CHECK
  (tenant_id = tenant_scope() AND project_role(project_id) IN ('admin', 'lead'));
CREATE POLICY project_memberships_remove ON project_memberships FOR DELETE USING
  (role = 'collaborator' AND project_role(project_id) IN ('admin', 'lead'));

ALTER TABLE productions ENABLE ROW LEVEL SECURITY;
ALTER TABLE productions FORCE ROW LEVEL SECURITY;
CREATE POLICY productions_access ON productions USING (project_role(project_id) IS NOT NULL)
  WITH CHECK (tenant_id = tenant_scope() AND project_role(project_id) IS NOT NULL);
ALTER TABLE project_content_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_content_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY content_access ON project_content_versions USING (project_role(project_id) IS NOT NULL)
  WITH CHECK (tenant_id = tenant_scope() AND project_role(project_id) IS NOT NULL);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_insert ON audit_events FOR INSERT WITH CHECK
  (actor_id = actor_id() AND (tenant_id IS NULL OR tenant_id = tenant_scope()));
CREATE POLICY audit_read ON audit_events FOR SELECT USING
  (tenant_id = tenant_scope() AND tenant_role(tenant_id) IN ('owner', 'admin'));

REVOKE ALL ON FUNCTION project_role(uuid), lock_project(uuid, boolean), enforce_project_lead() FROM PUBLIC;

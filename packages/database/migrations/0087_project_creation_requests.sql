-- Durable per-actor creation identity. HTTP response caches remain finite and separate.
CREATE TABLE project_creation_requests (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  creation_request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  project_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, actor_id, creation_request_id),
  FOREIGN KEY (tenant_id, project_id) REFERENCES projects(tenant_id, id)
);
ALTER TABLE project_creation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_creation_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY project_creation_request_read ON project_creation_requests FOR SELECT USING (
  tenant_id=tenant_scope() AND actor_id=actor_id() AND tenant_role(tenant_id) IN ('owner','admin')
);
CREATE POLICY project_creation_request_insert ON project_creation_requests FOR INSERT WITH CHECK (
  tenant_id=tenant_scope() AND actor_id=actor_id() AND tenant_role(tenant_id) IN ('owner','admin')
);
CREATE TRIGGER project_creation_request_immutable BEFORE UPDATE OR DELETE ON project_creation_requests
FOR EACH ROW EXECUTE FUNCTION protect_content_revision();
REVOKE ALL ON project_creation_requests FROM PUBLIC;

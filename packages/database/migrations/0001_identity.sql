CREATE TABLE users (
  id uuid PRIMARY KEY,
  auth_issuer text NOT NULL,
  auth_subject text NOT NULL,
  verified_email text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (auth_issuer, auth_subject)
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  csrf_secret_ref text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE oidc_handshakes (
  state_hash text PRIMARY KEY,
  browser_hash text NOT NULL,
  nonce_hash text NOT NULL,
  pkce_secret_ref text NOT NULL,
  return_path text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  owner_user_id uuid NOT NULL REFERENCES users(id),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id),
  UNIQUE (tenant_id, id),
  CHECK (role <> 'owner' OR status = 'active')
);
CREATE UNIQUE INDEX memberships_one_owner ON memberships(tenant_id) WHERE role = 'owner';
CREATE INDEX memberships_user ON memberships(user_id, tenant_id);
ALTER TABLE tenants ADD CONSTRAINT tenant_owner_membership
  FOREIGN KEY (id, owner_user_id) REFERENCES memberships(tenant_id, user_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE invitations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_by uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_tenant ON invitations(tenant_id, id);

CREATE TABLE idempotency_records (
  actor_id uuid NOT NULL REFERENCES users(id),
  scope_key text NOT NULL,
  operation_id text NOT NULL,
  request_path text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  response_ciphertext text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, scope_key, operation_id, request_path, key)
);
CREATE INDEX idempotency_expiry ON idempotency_records(expires_at);

CREATE FUNCTION actor_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
CREATE FUNCTION tenant_scope() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

-- These read-only authorization functions avoid recursive membership RLS. Their
-- search_path is pinned to the migration schema; PUBLIC cannot execute them.
CREATE FUNCTION tenant_role(target uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
  SELECT m.role FROM memberships m JOIN tenants t ON t.id = m.tenant_id
  WHERE m.tenant_id = target AND m.user_id = actor_id()
    AND m.status = 'active' AND t.status = 'active'
$$;
CREATE FUNCTION member_email(target uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
  SELECT u.verified_email FROM users u JOIN memberships m ON m.user_id = u.id
  WHERE m.id = target AND m.tenant_id = tenant_scope()
    AND tenant_role(m.tenant_id) IS NOT NULL
$$;

-- A business transaction derives the actor from the server-held session token.
-- Share locks serialize a successful request before concurrent revocation.
CREATE FUNCTION authenticate_session(digest text)
RETURNS TABLE(id uuid, user_id uuid, email text, display_name text,
  email_verified boolean, revision bigint, created_at timestamptz,
  updated_at timestamptz, csrf_secret_ref text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path FROM CURRENT AS $$
  SELECT s.id, u.id, u.verified_email, u.display_name, u.email_verified,
    s.revision, s.created_at, s.updated_at, s.csrf_secret_ref
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = digest AND s.expires_at > clock_timestamp()
    AND s.revoked_at IS NULL AND u.status = 'active'
  FOR SHARE OF s, u
$$;
CREATE FUNCTION revoke_session(target uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path FROM CURRENT AS $$
  UPDATE sessions SET revoked_at = now(), revision = revision + 1, updated_at = now()
  WHERE id = target AND user_id = actor_id() AND revoked_at IS NULL
$$;

CREATE FUNCTION lock_tenant(target uuid, exclusive_lock boolean) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
  IF tenant_role(target) IS NULL THEN RETURN NULL; END IF;
  IF exclusive_lock THEN PERFORM id FROM tenants WHERE id = target FOR UPDATE;
  ELSE PERFORM id FROM tenants WHERE id = target FOR SHARE; END IF;
  RETURN tenant_role(target);
END $$;

CREATE FUNCTION enforce_tenant_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE target uuid;
BEGIN
  IF TG_TABLE_NAME = 'tenants' THEN target := NEW.id;
  ELSE target := COALESCE(NEW.tenant_id, OLD.tenant_id); END IF;
  IF EXISTS (SELECT 1 FROM tenants t WHERE t.id = target AND NOT EXISTS (
    SELECT 1 FROM memberships m WHERE m.tenant_id = t.id
      AND m.user_id = t.owner_user_id AND m.role = 'owner' AND m.status = 'active'
  )) THEN RAISE EXCEPTION 'Tenant must retain its active owner' USING ERRCODE = '23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER tenant_owner_integrity AFTER INSERT OR UPDATE ON tenants
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_tenant_owner();
CREATE CONSTRAINT TRIGGER membership_owner_integrity AFTER INSERT OR UPDATE OR DELETE ON memberships
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_tenant_owner();

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_read ON tenants FOR SELECT USING
  (tenant_role(id) IS NOT NULL OR owner_user_id = actor_id());
CREATE POLICY tenants_create ON tenants FOR INSERT WITH CHECK
  (owner_user_id = actor_id() AND status = 'active');
CREATE POLICY tenants_change ON tenants FOR UPDATE USING
  (id = tenant_scope() AND tenant_role(id) IN ('owner', 'admin'))
  WITH CHECK (id = tenant_scope() AND tenant_role(id) IN ('owner', 'admin'));

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_read ON memberships FOR SELECT USING
  (user_id = actor_id() OR (tenant_id = tenant_scope() AND tenant_role(tenant_id) IS NOT NULL));
CREATE POLICY memberships_create ON memberships FOR INSERT WITH CHECK (
  (tenant_id = tenant_scope() AND tenant_role(tenant_id) IN ('owner', 'admin')
    AND (role = 'member' OR (role = 'admin' AND tenant_role(tenant_id) = 'owner')))
  OR (role = 'owner' AND user_id = actor_id() AND EXISTS (
    SELECT 1 FROM tenants t WHERE t.id = tenant_id AND t.owner_user_id = actor_id()))
);
CREATE POLICY memberships_change ON memberships FOR UPDATE USING
  (tenant_id = tenant_scope() AND role <> 'owner'
    AND (tenant_role(tenant_id) = 'owner' OR (tenant_role(tenant_id) = 'admin' AND role = 'member')))
  WITH CHECK (tenant_id = tenant_scope() AND role <> 'owner'
    AND (tenant_role(tenant_id) = 'owner' OR (tenant_role(tenant_id) = 'admin' AND role = 'member')));

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY invitations_admin ON invitations USING
  (tenant_id = tenant_scope() AND tenant_role(tenant_id) IN ('owner', 'admin'))
  WITH CHECK (tenant_id = tenant_scope()
    AND (tenant_role(tenant_id) = 'owner' OR (tenant_role(tenant_id) = 'admin' AND role = 'member')));

ALTER TABLE idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_records FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_actor ON idempotency_records USING
  (actor_id = actor_id() AND (scope_key = 'user:' || actor_id()::text
    OR scope_key = 'tenant:' || tenant_scope()::text))
  WITH CHECK (actor_id = actor_id() AND (scope_key = 'user:' || actor_id()::text
    OR scope_key = 'tenant:' || tenant_scope()::text));

REVOKE ALL ON FUNCTION tenant_role(uuid), member_email(uuid),
  authenticate_session(text), revoke_session(uuid), lock_tenant(uuid, boolean), enforce_tenant_owner() FROM PUBLIC;

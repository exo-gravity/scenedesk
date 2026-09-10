-- Narrow commands own the multi-row role transitions. The runtime has no direct
-- UPDATE grant on owner_user_id, lead_membership_id or project membership roles.
CREATE FUNCTION transfer_ownership(target uuid, next_member uuid, expected bigint)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE next_user uuid; current_version bigint;
BEGIN
  IF target <> tenant_scope() OR tenant_role(target) IS DISTINCT FROM 'owner'
    THEN RAISE EXCEPTION 'Owner required' USING ERRCODE = '42501'; END IF;
  SELECT revision INTO current_version FROM tenants WHERE id=target FOR UPDATE;
  IF tenant_role(target) IS DISTINCT FROM 'owner'
    THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501'; END IF;
  IF current_version <> expected THEN RAISE EXCEPTION 'Stale version' USING ERRCODE='P0412'; END IF;
  SELECT user_id INTO next_user FROM memberships
    WHERE id=next_member AND tenant_id=target AND status='active' AND role <> 'owner';
  IF next_user IS NULL THEN RAISE EXCEPTION 'Active successor required' USING ERRCODE='23514'; END IF;
  UPDATE memberships SET role='admin',revision=revision+1,updated_at=now()
    WHERE tenant_id=target AND role='owner';
  UPDATE memberships SET role='owner',revision=revision+1,updated_at=now() WHERE id=next_member;
  UPDATE tenants SET owner_user_id=next_user,revision=revision+1,updated_at=now() WHERE id=target;
END $$;

CREATE FUNCTION change_project_lead(target uuid, next_member uuid, expected bigint, new_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE target_tenant uuid; current_version bigint; project_status text;
BEGIN
  SELECT tenant_id INTO target_tenant FROM projects WHERE id=target AND tenant_id=tenant_scope();
  IF target_tenant IS NULL OR tenant_role(target_tenant) NOT IN ('owner','admin')
    OR tenant_role(target_tenant) IS NULL
    THEN RAISE EXCEPTION 'Manager required' USING ERRCODE='42501'; END IF;
  PERFORM id FROM tenants WHERE id=target_tenant FOR SHARE;
  SELECT revision,status INTO current_version,project_status FROM projects WHERE id=target FOR UPDATE;
  IF tenant_role(target_tenant) IS NULL OR tenant_role(target_tenant) NOT IN ('owner','admin')
    THEN RAISE EXCEPTION 'Manager required' USING ERRCODE='42501'; END IF;
  IF current_version <> expected THEN RAISE EXCEPTION 'Stale version' USING ERRCODE='P0412'; END IF;
  IF project_status <> 'active' OR NOT EXISTS (SELECT 1 FROM memberships
    WHERE id=next_member AND tenant_id=target_tenant AND status='active')
    THEN RAISE EXCEPTION 'Active project and successor required' USING ERRCODE='23514'; END IF;
  UPDATE project_memberships SET role='collaborator',revision=revision+1,updated_at=now()
    WHERE project_id=target AND role='lead' AND membership_id<>next_member;
  INSERT INTO project_memberships(id,tenant_id,project_id,membership_id,role)
    VALUES(new_id,target_tenant,target,next_member,'lead')
    ON CONFLICT(project_id,membership_id) DO UPDATE SET role='lead',
      revision=project_memberships.revision+1,updated_at=now();
  UPDATE projects SET lead_membership_id=next_member,revision=revision+1,updated_at=now() WHERE id=target;
END $$;

CREATE FUNCTION accept_invitation(invite_digest text, new_member uuid)
RETURNS TABLE(tenant_id uuid, membership_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path FROM CURRENT AS $$
DECLARE invite invitations%ROWTYPE; verified text; target_tenant uuid;
BEGIN
  SELECT verified_email INTO verified FROM users WHERE id=actor_id() AND email_verified AND status='active';
  SELECT i.tenant_id INTO target_tenant FROM invitations i
    WHERE i.token_hash=invite_digest AND lower(i.email)=lower(verified);
  IF target_tenant IS NULL THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
  PERFORM id FROM tenants WHERE id=target_tenant AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
  SELECT * INTO invite FROM invitations i WHERE i.token_hash=invite_digest FOR UPDATE;
  IF invite.status <> 'pending' OR invite.expires_at<=clock_timestamp()
    THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='23514'; END IF;
  -- Existing or suspended membership must be changed by an authorized manager,
  -- never silently promoted or reactivated by an old invitation.
  IF EXISTS(SELECT 1 FROM memberships m WHERE m.tenant_id=target_tenant AND m.user_id=actor_id())
    THEN RAISE EXCEPTION 'Membership already exists' USING ERRCODE='23514'; END IF;
  INSERT INTO memberships(id,tenant_id,user_id,role) VALUES(new_member,target_tenant,actor_id(),invite.role);
  UPDATE invitations SET status='accepted',accepted_by=actor_id(),revision=revision+1,updated_at=now()
    WHERE id=invite.id;
  RETURN QUERY SELECT target_tenant,new_member;
END $$;

REVOKE ALL ON FUNCTION transfer_ownership(uuid,uuid,bigint),
  change_project_lead(uuid,uuid,bigint,uuid), accept_invitation(text,uuid) FROM PUBLIC;

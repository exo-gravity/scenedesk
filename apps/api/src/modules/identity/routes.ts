import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { components } from "@drama/contracts";
import { registerAction } from "../../kernel/routes.js";
import type { ApiContext } from "../../kernel/routes.js";
import { record } from "../../kernel/database.js";
import { page, searchPattern } from "../../kernel/pages.js";
import { requireThat, versionMatches } from "../../kernel/errors.js";

type Tenant = components["schemas"]["Tenant"];
type Membership = components["schemas"]["Membership"];
export function identityRoutes(app: FastifyInstance, context: ApiContext) {
  registerAction(app, context, "getSession", async (tx, input) => {
    const { id, userId, email, displayName, revision, createdAt, updatedAt } =
      tx.session;
    return {
      body: {
        id,
        userId,
        email,
        displayName,
        revision,
        createdAt,
        updatedAt,
        csrfToken: input.csrfToken,
      },
    };
  });
  registerAction(app, context, "logout", async (tx) => {
    await tx.sql.query("SELECT revoke_session($1)", [tx.session.id]);
    return { clearSession: true };
  });
  registerAction(app, context, "listTenants", async (tx, input) => ({
    body: await page<Tenant>(
      tx,
      context.secrets,
      "listTenants",
      input.query,
      "SELECT t.* FROM tenants t JOIN memberships m ON m.tenant_id=t.id WHERE m.user_id=$1 AND m.status='active' AND t.status='active' AND t.name ILIKE $2",
      [tx.session.userId, searchPattern(input.query)],
    ),
  }));
  registerAction(app, context, "createTenant", async (tx, input) => {
    const body = input.body as components["schemas"]["CreateTenant"];
    const id = randomUUID();
    const created = await tx.sql.query(
      "INSERT INTO tenants (id,name,owner_user_id,currency) VALUES ($1,$2,$3,$4) RETURNING *",
      [id, body.name, tx.session.userId, body.currency],
    );
    await tx.sql.query("SELECT set_config('app.tenant_id',$1,true)", [id]);
    await tx.sql.query(
      "INSERT INTO memberships (id,tenant_id,user_id,role) VALUES ($1,$2,$3,'owner')",
      [randomUUID(), id, tx.session.userId],
    );
    tx.tenantId = id;
    tx.tenantRole = "owner";
    return {
      body: record<Tenant>(created.rows[0]!),
      etag: 1,
      accessTenantId: id,
    };
  });
  registerAction(app, context, "getTenant", async (tx) => {
    const found = await tx.sql.query("SELECT * FROM tenants WHERE id=$1", [
      tx.tenantId,
    ]);
    const tenant = record<Tenant>(found.rows[0]!);
    return { body: tenant, etag: tenant.revision };
  });
  registerAction(app, context, "renameTenant", async (tx, input) => {
    const found = await tx.sql.query(
      "SELECT revision FROM tenants WHERE id=$1",
      [tx.tenantId],
    );
    versionMatches(Number(found.rows[0]!.revision), input.version);
    const changed = await tx.sql.query(
      "UPDATE tenants SET name=$1,revision=revision+1,updated_at=now() WHERE id=$2 RETURNING *",
      [input.body.name, tx.tenantId],
    );
    const tenant = record<Tenant>(changed.rows[0]!);
    return { body: tenant, etag: tenant.revision };
  });
  registerAction(app, context, "listMembers", async (tx, input) => ({
    body: await page<Membership>(
      tx,
      context.secrets,
      "listMembers",
      input.query,
      "SELECT id,revision,user_id,role,status,created_at,updated_at,member_email(id) AS email FROM memberships WHERE tenant_id=$1 AND member_email(id) ILIKE $2",
      [tx.tenantId, searchPattern(input.query)],
    ),
  }));
  registerAction(app, context, "changeMember", async (tx, input) => {
    const found = await tx.sql.query(
      "SELECT * FROM memberships WHERE tenant_id=$1 AND id=$2",
      [tx.tenantId, input.params.membershipId],
    );
    const member = found.rows[0];
    requireThat(member, 404, "NOT_FOUND", "成员不存在。");
    versionMatches(Number(member.revision), input.version);
    requireThat(
      member.role !== "owner",
      409,
      "OWNER_TRANSFER_REQUIRED",
      "请先交接工作室所有权。",
    );
    requireThat(
      tx.tenantRole === "owner" ||
        (member.role === "member" && input.body.role === "member"),
      403,
      "FORBIDDEN",
      "只有工作室所有者可以任免管理员。",
    );
    if (input.body.status === "suspended") {
      const leading = await tx.sql.query(
        "SELECT id FROM projects WHERE tenant_id=$1 AND lead_membership_id=$2 LIMIT 1",
        [tx.tenantId, member.id],
      );
      requireThat(
        leading.rows.length === 0,
        409,
        "PROJECT_LEAD_TRANSFER_REQUIRED",
        "请先交接该成员负责的项目。",
      );
    }
    const changed = await tx.sql.query(
      "UPDATE memberships SET role=$1,status=$2,revision=revision+1,updated_at=now() WHERE tenant_id=$3 AND id=$4 RETURNING id,revision,user_id,role,status,created_at,updated_at,member_email(id) AS email",
      [input.body.role, input.body.status, tx.tenantId, member.id],
    );
    const result = record<Membership>(changed.rows[0]!);
    return { body: result, etag: result.revision };
  });
  registerAction(app, context, "transferOwnership", async (tx, input) => {
    await tx.sql.query("SELECT transfer_ownership($1,$2,$3)", [
      tx.tenantId,
      input.body.membershipId,
      input.version,
    ]);
    const found = await tx.sql.query("SELECT * FROM tenants WHERE id=$1", [
      tx.tenantId,
    ]);
    const tenant = record<Tenant>(found.rows[0]!);
    return { body: tenant, etag: tenant.revision };
  });
}

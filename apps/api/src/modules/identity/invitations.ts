import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { components } from "@drama/contracts";
import { registerAction, type ApiContext } from "../../kernel/routes.js";
import { record } from "../../kernel/database.js";
import { page, searchPattern } from "../../kernel/pages.js";
import { digest, token } from "../../kernel/crypto.js";
import { requireThat, versionMatches } from "../../kernel/errors.js";

type Invitation = components["schemas"]["Invitation"];
const fields =
  "id,revision,created_at,updated_at,email,role,CASE WHEN status='pending' AND expires_at<=now() THEN 'expired' ELSE status END AS status,expires_at";

export function invitationRoutes(app: FastifyInstance, context: ApiContext) {
  registerAction(app, context, "listInvitations", async (tx, input) => ({
    body: await page<Invitation>(
      tx,
      context.secrets,
      "listInvitations",
      input.query,
      `SELECT ${fields} FROM invitations WHERE tenant_id=$1 AND email ILIKE $2`,
      [tx.tenantId, searchPattern(input.query)],
    ),
  }));
  registerAction(app, context, "inviteMember", async (tx, input) => {
    const email = (input.body.email as string).toLowerCase();
    const existing = await tx.sql.query(
      "SELECT id FROM memberships WHERE tenant_id=$1 AND lower(member_email(id))=$2",
      [tx.tenantId, email],
    );
    requireThat(
      !existing.rows.length,
      409,
      "MEMBERSHIP_EXISTS",
      "该邮箱已有工作室成员身份，请直接管理成员。",
    );
    const invitationToken = token();
    const created = await tx.sql.query(
      `INSERT INTO invitations(id,tenant_id,email,role,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '7 days') RETURNING ${fields}`,
      [
        randomUUID(),
        tx.tenantId,
        email,
        input.body.role,
        digest(invitationToken),
      ],
    );
    const invitation = record<Invitation>(created.rows[0]!);
    // A fragment keeps the secret out of HTTP access logs and Referer headers.
    // The application exchanges it through the authenticated POST accept route.
    invitation.invitationUrl = `${context.origin}/#/invitation?token=${invitationToken}`;
    return { body: invitation, etag: invitation.revision };
  });
  registerAction(app, context, "revokeInvitation", async (tx, input) => {
    const found = await tx.sql.query(
      `SELECT ${fields} FROM invitations WHERE tenant_id=$1 AND id=$2`,
      [tx.tenantId, input.params.invitationId],
    );
    requireThat(found.rows[0], 404, "NOT_FOUND", "邀请不存在。");
    const invitation = record<Invitation>(found.rows[0]);
    versionMatches(invitation.revision, input.version);
    requireThat(
      invitation.status === "pending",
      409,
      "INVITATION_CLOSED",
      "邀请已结束，不能再次撤销。",
    );
    requireThat(
      tx.tenantRole === "owner" || invitation.role === "member",
      403,
      "FORBIDDEN",
      "只有工作室所有者可以管理管理员邀请。",
    );
    const changed = await tx.sql.query(
      `UPDATE invitations SET status='revoked',revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING ${fields}`,
      [tx.tenantId, invitation.id],
    );
    const result = record<Invitation>(changed.rows[0]!);
    return { body: result, etag: result.revision };
  });
  registerAction(app, context, "acceptInvitation", async (tx, input) => {
    const accepted = await tx.sql.query(
      "SELECT * FROM accept_invitation($1,$2)",
      [digest(input.body.token), randomUUID()],
    );
    const { tenant_id: tenantId, membership_id: membershipId } =
      accepted.rows[0]!;
    await tx.sql.query("SELECT set_config('app.tenant_id',$1,true)", [
      tenantId,
    ]);
    tx.tenantId = tenantId;
    const found = await tx.sql.query(
      "SELECT id,revision,created_at,updated_at,user_id,role,status,member_email(id) AS email FROM memberships WHERE tenant_id=$1 AND id=$2",
      [tenantId, membershipId],
    );
    const membership = record<components["schemas"]["Membership"]>(
      found.rows[0]!,
    );
    return {
      body: membership,
      etag: membership.revision,
      accessTenantId: tenantId,
    };
  });
}

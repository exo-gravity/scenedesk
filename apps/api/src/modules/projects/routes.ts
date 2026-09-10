import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { components } from "@drama/contracts";
import { registerAction } from "../../kernel/routes.js";
import type { ApiContext } from "../../kernel/routes.js";
import { record } from "../../kernel/database.js";
import { page, searchPattern } from "../../kernel/pages.js";
import { requireThat, versionMatches } from "../../kernel/errors.js";

type Project = components["schemas"]["Project"];
type Production = components["schemas"]["Production"];
export function projectRoutes(app: FastifyInstance, context: ApiContext) {
  registerAction(app, context, "listProjects", async (tx, input) => ({
    body: await page<Project>(
      tx,
      context.secrets,
      "listProjects",
      input.query,
      "SELECT * FROM projects WHERE tenant_id=$1 AND name ILIKE $2 AND ($3::uuid IS NULL OR id=$3)",
      [tx.tenantId, searchPattern(input.query), input.query.projectId ?? null],
    ),
  }));
  registerAction(app, context, "createProject", async (tx, input) => {
    const body = input.body as components["schemas"]["CreateProject"];
    const lead = await tx.sql.query(
      "SELECT id FROM memberships WHERE tenant_id=$1 AND id=$2 AND status='active'",
      [tx.tenantId, body.leadMembershipId],
    );
    requireThat(
      lead.rows[0],
      422,
      "INVALID_PROJECT_LEAD",
      "负责人必须是本工作室的有效成员。",
    );
    const id = randomUUID();
    const created = await tx.sql.query(
      "INSERT INTO projects (id,tenant_id,name,lead_membership_id,spec) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [id, tx.tenantId, body.name, body.leadMembershipId, body.spec],
    );
    await tx.sql.query(
      "INSERT INTO project_memberships (id,tenant_id,project_id,membership_id,role) VALUES ($1,$2,$3,$4,'lead')",
      [randomUUID(), tx.tenantId, id, body.leadMembershipId],
    );
    await tx.sql.query(
      "INSERT INTO productions (id,tenant_id,project_id,title) VALUES ($1,$2,$3,$4)",
      [randomUUID(), tx.tenantId, id, body.name],
    );
    await tx.sql.query(
      "INSERT INTO project_content_versions (tenant_id,project_id) VALUES ($1,$2)",
      [tx.tenantId, id],
    );
    return { body: record<Project>(created.rows[0]!), etag: 1 };
  });
  registerAction(app, context, "getProject", async (tx) => {
    const result = await tx.sql.query(
      "SELECT * FROM projects WHERE tenant_id=$1 AND id=$2",
      [tx.tenantId, tx.projectId],
    );
    const project = record<Project>(result.rows[0]!);
    return { body: project, etag: project.revision };
  });
  registerAction(app, context, "changeProject", async (tx, input) => {
    const result = await tx.sql.query(
      "SELECT revision,status FROM projects WHERE tenant_id=$1 AND id=$2",
      [tx.tenantId, tx.projectId],
    );
    requireThat(
      result.rows[0]!.status === "active",
      409,
      "PROJECT_ARCHIVED",
      "项目已归档，请先恢复。",
    );
    versionMatches(Number(result.rows[0]!.revision), input.version);
    const changed = await tx.sql.query(
      "UPDATE projects SET name=$1,spec=$2,revision=revision+1,updated_at=now() WHERE tenant_id=$3 AND id=$4 RETURNING *",
      [input.body.name, input.body.spec, tx.tenantId, tx.projectId],
    );
    const project = record<Project>(changed.rows[0]!);
    return { body: project, etag: project.revision };
  });
  for (const operation of ["archiveProject", "restoreProject"] as const)
    registerAction(app, context, operation, async (tx, input) => {
      const result = await tx.sql.query(
        "SELECT revision FROM projects WHERE tenant_id=$1 AND id=$2",
        [tx.tenantId, tx.projectId],
      );
      versionMatches(Number(result.rows[0]!.revision), input.version);
      const changed = await tx.sql.query(
        "UPDATE projects SET status=$1,revision=revision+1,updated_at=now() WHERE tenant_id=$2 AND id=$3 RETURNING *",
        [
          operation === "archiveProject" ? "archived" : "active",
          tx.tenantId,
          tx.projectId,
        ],
      );
      const project = record<Project>(changed.rows[0]!);
      return { body: project, etag: project.revision };
    });
  registerAction(app, context, "getProduction", async (tx) => {
    const result = await tx.sql.query(
      "SELECT id,revision,created_at,updated_at,project_id,title,brief,default_asset_revision_ids FROM productions WHERE tenant_id=$1 AND project_id=$2",
      [tx.tenantId, tx.projectId],
    );
    const production = record<Production>(result.rows[0]!);
    return { body: production, etag: production.revision };
  });
  registerAction(app, context, "changeLead", async (tx, input) => {
    await tx.sql.query("SELECT change_project_lead($1,$2,$3,$4)", [
      tx.projectId,
      input.body.membershipId,
      input.version,
      randomUUID(),
    ]);
    const found = await tx.sql.query(
      "SELECT * FROM projects WHERE tenant_id=$1 AND id=$2",
      [tx.tenantId, tx.projectId],
    );
    const project = record<Project>(found.rows[0]!);
    return { body: project, etag: project.revision };
  });
  registerAction(app, context, "changeProduction", async (tx, input) => {
    const found = await tx.sql.query(
      "SELECT revision FROM productions WHERE tenant_id=$1 AND project_id=$2",
      [tx.tenantId, tx.projectId],
    );
    versionMatches(Number(found.rows[0]!.revision), input.version);
    const changed = await tx.sql.query(
      "UPDATE productions SET title=$1,brief=$2,default_asset_revision_ids=$3,revision=revision+1,updated_at=now() WHERE tenant_id=$4 AND project_id=$5 RETURNING id,revision,created_at,updated_at,project_id,title,brief,default_asset_revision_ids",
      [
        input.body.title,
        input.body.brief,
        JSON.stringify(input.body.defaultAssetRevisionIds),
        tx.tenantId,
        tx.projectId,
      ],
    );
    const production = record<Production>(changed.rows[0]!);
    return { body: production, etag: production.revision };
  });
  registerAction(app, context, "listProjectMembers", async (tx, input) => ({
    body: await page(
      tx,
      context.secrets,
      "listProjectMembers",
      input.query,
      "SELECT id,revision,created_at,updated_at,membership_id,role FROM project_memberships WHERE tenant_id=$1 AND project_id=$2",
      [tx.tenantId, tx.projectId],
    ),
  }));
  registerAction(app, context, "addProjectMember", async (tx, input) => {
    const project = await tx.sql.query(
      "SELECT status FROM projects WHERE tenant_id=$1 AND id=$2",
      [tx.tenantId, tx.projectId],
    );
    requireThat(
      project.rows[0]!.status === "active",
      409,
      "PROJECT_ARCHIVED",
      "项目已归档，请先恢复。",
    );
    const member = await tx.sql.query(
      "SELECT id FROM memberships WHERE tenant_id=$1 AND id=$2 AND status='active'",
      [tx.tenantId, input.body.membershipId],
    );
    requireThat(
      member.rows[0],
      422,
      "INVALID_PROJECT_MEMBER",
      "协作者必须是本工作室的有效成员。",
    );
    await tx.sql.query(
      "INSERT INTO project_memberships (id,tenant_id,project_id,membership_id,role) VALUES ($1,$2,$3,$4,'collaborator') ON CONFLICT (project_id,membership_id) DO NOTHING",
      [randomUUID(), tx.tenantId, tx.projectId, input.body.membershipId],
    );
    const result = await tx.sql.query(
      "SELECT id,revision,created_at,updated_at,membership_id,role FROM project_memberships WHERE tenant_id=$1 AND project_id=$2 AND membership_id=$3",
      [tx.tenantId, tx.projectId, input.body.membershipId],
    );
    const membership = record<{ revision: number }>(result.rows[0]!);
    return { body: membership, etag: membership.revision };
  });
  registerAction(app, context, "removeProjectMember", async (tx, input) => {
    const result = await tx.sql.query(
      "SELECT role,revision FROM project_memberships WHERE tenant_id=$1 AND project_id=$2 AND membership_id=$3",
      [tx.tenantId, tx.projectId, input.params.membershipId],
    );
    requireThat(result.rows[0], 404, "NOT_FOUND", "项目成员不存在。");
    versionMatches(Number(result.rows[0].revision), input.version);
    requireThat(
      result.rows[0].role !== "lead",
      409,
      "PROJECT_LEAD_TRANSFER_REQUIRED",
      "请先交接项目负责人。",
    );
    await tx.sql.query(
      "DELETE FROM project_memberships WHERE tenant_id=$1 AND project_id=$2 AND membership_id=$3",
      [tx.tenantId, tx.projectId, input.params.membershipId],
    );
    return {};
  });
}

import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { registerAction, type ApiContext } from "../../kernel/routes.js";
import { page, searchPattern } from "../../kernel/pages.js";
import { canonical } from "../../kernel/crypto.js";
import { requireThat, versionMatches } from "../../kernel/errors.js";
import {
  assetRecord,
  assetScope,
  assetTags,
  assetText,
  definitionInput,
  findAsset,
  findRevision,
  type Schema,
} from "./model.js";

export function assetRoutes(app: FastifyInstance, context: ApiContext) {
  registerAction(
    app,
    context,
    "createAsset",
    async (tx, { body: input }) => {
      const body = input as Schema<"AssetInput">;
      const result = await tx.sql.query(
        `INSERT INTO assets(id,tenant_id,project_id,scope,kind,name,description,tags) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          randomUUID(),
          tx.tenantId,
          tx.projectId ?? null,
          body.scope,
          body.kind,
          assetText(body.name, "资产名称", 160),
          assetText(body.description ?? "", "检索说明", 20000, true),
          assetTags(body.tags ?? []),
        ],
      );
      return { body: assetRecord<Schema<"Asset">>(result.rows[0]), etag: 1 };
    },
    { authorizeScope: assetScope("input", true) },
  );
  registerAction(
    app,
    context,
    "listAssets",
    async (tx, { query }) => ({
      body: await page(
        tx,
        context.secrets,
        "listAssets",
        query,
        `SELECT * FROM assets WHERE tenant_id=$1 AND ($2::uuid IS NULL OR project_id=$2) AND ($3::text IS NULL OR scope=$3) AND ($4::text IS NULL OR kind=$4) AND ($5::text IS NULL OR status=$5) AND ($6::text IS NULL OR $6=ANY(tags)) AND (name ILIKE $7 OR description ILIKE $7 OR array_to_string(tags,' ') ILIKE $7)`,
        [
          tx.tenantId,
          tx.projectId ?? null,
          query.scope ?? null,
          query.kind ?? null,
          query.status ?? null,
          query.tag ?? null,
          searchPattern(query),
        ],
        assetRecord<Schema<"Asset">>,
      ),
    }),
    { authorizeScope: assetScope("list", false) },
  );
  registerAction(
    app,
    context,
    "getAsset",
    async (tx, { params }) => {
      const row = await findAsset(tx, params.assetId!);
      return {
        body: assetRecord<Schema<"Asset">>(row),
        etag: Number(row.revision),
      };
    },
    { authorizeScope: assetScope("asset", false) },
  );
  registerAction(
    app,
    context,
    "changeAssetMetadata",
    async (tx, { params, body: input, version }) => {
      const previous = await findAsset(tx, params.assetId!);
      versionMatches(Number(previous.revision), version);
      const body = input as Schema<"AssetMetadataChange">,
        name = assetText(body.name, "资产名称", 160),
        description = assetText(body.description, "检索说明", 20000, true),
        tags = assetTags(body.tags);
      if (
        name !== previous.name ||
        description !== previous.description ||
        canonical(tags) !== canonical(previous.tags)
      )
        await tx.sql.query(
          "UPDATE assets SET name=$3,description=$4,tags=$5,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [tx.tenantId, previous.id, name, description, tags],
        );
      const row = await findAsset(tx, previous.id);
      return {
        body: assetRecord<Schema<"Asset">>(row),
        etag: Number(row.revision),
      };
    },
    { authorizeScope: assetScope("asset", true) },
  );
  registerAction(
    app,
    context,
    "listAssetRevisions",
    async (tx, { params, query }) => ({
      body: await page(
        tx,
        context.secrets,
        `listAssetRevisions:${params.assetId}`,
        query,
        `SELECT * FROM asset_revisions WHERE tenant_id=$1 AND asset_id=$2 AND definition->>'description' ILIKE $3`,
        [tx.tenantId, params.assetId, searchPattern(query)],
        assetRecord<Schema<"AssetRevision">>,
      ),
    }),
    { authorizeScope: assetScope("asset", false) },
  );
  registerAction(
    app,
    context,
    "getAssetRevision",
    async (tx, { params }) => {
      const row = await findRevision(tx, undefined, params.revisionId!);
      return {
        body: assetRecord<Schema<"AssetRevision">>(row),
        etag: Number(row.revision),
      };
    },
    { authorizeScope: assetScope("revision", false) },
  );
  registerAction(
    app,
    context,
    "reviseAsset",
    async (tx, { params, body: input, version }) => {
      const root = await findAsset(tx, params.assetId!);
      versionMatches(Number(root.revision), version);
      requireThat(
        root.status === "active",
        409,
        "ASSET_ARCHIVED",
        "资产已归档，不能新增设定修订。",
      );
      const body = input as Schema<"AssetRevisionInput">,
        definition = definitionInput(body.definition, root.kind);
      const parentId =
        body.parentRevisionId?.toLowerCase() ?? root.current_revision_id;
      if (parentId) await findRevision(tx, root.id, parentId);
      const number = (
        await tx.sql.query(
          "SELECT coalesce(max(number),0)+1 AS number FROM asset_revisions WHERE tenant_id=$1 AND asset_id=$2",
          [tx.tenantId, root.id],
        )
      ).rows[0].number;
      const result = await tx.sql.query(
        "INSERT INTO asset_revisions(id,tenant_id,asset_id,number,definition,parent_revision_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
        [
          randomUUID(),
          tx.tenantId,
          root.id,
          number,
          definition,
          parentId ?? null,
        ],
      );
      await tx.sql.query(
        "UPDATE assets SET current_revision_id=$3,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [tx.tenantId, root.id, result.rows[0].id],
      );
      return {
        body: assetRecord<Schema<"AssetRevision">>(result.rows[0]),
        etag: 1,
      };
    },
    { authorizeScope: assetScope("asset", true) },
  );
  registerAction(
    app,
    context,
    "confirmAssetRevision",
    async (tx, { params, version }) => {
      const root = await findAsset(tx, params.assetId!),
        previous = await findRevision(tx, root.id, params.revisionId!);
      versionMatches(Number(previous.revision), version);
      requireThat(
        root.status === "active",
        409,
        "ASSET_ARCHIVED",
        "资产已归档，不能新增设定确认。",
      );
      if (previous.status === "draft")
        await tx.sql.query(
          `UPDATE asset_revisions SET status='confirmed',confirmed_by=$3,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
          [tx.tenantId, previous.id, tx.session.userId],
        );
      const row = await findRevision(tx, root.id, previous.id);
      return {
        body: assetRecord<Schema<"AssetRevision">>(row),
        etag: Number(row.revision),
      };
    },
    { authorizeScope: assetScope("asset", true) },
  );
  registerAction(
    app,
    context,
    "archiveAsset",
    async (tx, { params, version }) => {
      const root = await findAsset(tx, params.assetId!);
      versionMatches(Number(root.revision), version);
      if (root.status === "active")
        await tx.sql.query(
          `UPDATE assets SET status='archived',revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
          [tx.tenantId, root.id],
        );
      const row = await findAsset(tx, root.id);
      return {
        body: assetRecord<Schema<"Asset">>(row),
        etag: Number(row.revision),
      };
    },
    { authorizeScope: assetScope("asset", true) },
  );
  registerAction(app, context, "listSharedImports", async (tx, { query }) => ({
    body: await page(
      tx,
      context.secrets,
      "listSharedImports",
      query,
      "SELECT i.* FROM shared_imports i JOIN asset_revisions r ON r.id=i.asset_revision_id JOIN assets a ON a.id=r.asset_id WHERE i.tenant_id=$1 AND i.project_id=$2 AND a.name ILIKE $3",
      [tx.tenantId, tx.projectId, searchPattern(query)],
      assetRecord<Schema<"SharedImport">>,
    ),
  }));
  registerAction(app, context, "importSharedAsset", async (tx, { body }) => {
    const existing = await tx.sql.query(
      "SELECT * FROM shared_imports WHERE tenant_id=$1 AND project_id=$2 AND asset_revision_id=$3",
      [tx.tenantId, tx.projectId, body.assetRevisionId],
    );
    if (existing.rows[0])
      return {
        body: assetRecord<Schema<"SharedImport">>(existing.rows[0]),
        etag: 1,
      };
    const target = await tx.sql.query(
      `SELECT r.id FROM asset_revisions r JOIN assets a ON a.id=r.asset_id WHERE r.tenant_id=$1 AND r.id=$2 AND a.scope='shared' AND a.status='active'`,
      [tx.tenantId, body.assetRevisionId],
    );
    requireThat(
      target.rows[0],
      422,
      "SHARED_ASSET_UNAVAILABLE",
      "请选择仍可引入的固定共享资产版本。",
    );
    await tx.sql.query(
      `INSERT INTO shared_imports(id,tenant_id,project_id,asset_revision_id,imported_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(project_id,asset_revision_id) DO NOTHING`,
      [
        randomUUID(),
        tx.tenantId,
        tx.projectId,
        body.assetRevisionId,
        tx.session.userId,
      ],
    );
    const row = (
      await tx.sql.query(
        "SELECT * FROM shared_imports WHERE tenant_id=$1 AND project_id=$2 AND asset_revision_id=$3",
        [tx.tenantId, tx.projectId, body.assetRevisionId],
      )
    ).rows[0];
    return { body: assetRecord<Schema<"SharedImport">>(row), etag: 1 };
  });
  registerAction(
    app,
    context,
    "getAssetUsages",
    async (tx, { params, query }) => ({
      body: await page(
        tx,
        context.secrets,
        `getAssetUsages:${params.assetId}`,
        query,
        `SELECT r.id,r.created_at,'asset_revision' AS kind,r.id AS object_id,a.project_id,left(a.name||' · v'||r.number::text,160) AS label FROM asset_revisions r JOIN assets a ON a.id=r.asset_id WHERE r.tenant_id=$1 AND ($3::uuid IS NULL OR a.project_id=$3) AND (EXISTS (SELECT 1 FROM asset_revision_dependencies d JOIN asset_revisions target ON target.id=d.referenced_asset_revision_id WHERE d.tenant_id=$1 AND d.asset_revision_id=r.id AND target.asset_id=$2) OR EXISTS (SELECT 1 FROM asset_revision_media m WHERE m.tenant_id=$1 AND m.asset_revision_id=r.id AND m.subject_asset_id=$2)) AND a.name ILIKE $4`,
        [
          tx.tenantId,
          params.assetId,
          query.projectId ?? null,
          searchPattern(query),
        ],
        (row) =>
          ({
            kind: "asset_revision",
            objectId: row.object_id,
            ...(row.project_id ? { projectId: row.project_id } : {}),
            label: row.label,
          }) as Schema<"UsageLocation">,
      ),
    }),
    { authorizeScope: assetScope("asset", false) },
  );
}

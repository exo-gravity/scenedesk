import type { FastifyInstance } from "fastify";
import { validateContract } from "@drama/contracts/validation";
import type { Transaction } from "../../kernel/database.js";
import { canonical } from "../../kernel/crypto.js";
import { requireThat, versionMatches, Problem } from "../../kernel/errors.js";
import { page, searchPattern } from "../../kernel/pages.js";
import { registerAction, type ApiContext } from "../../kernel/routes.js";
import type { Schema } from "../content/model.js";
import { assertPromptCurrent, validateReference } from "./prompt-input.js";

const identity = (reference: Schema<"Reference">) => {
  const { note: _note, ...value } = reference;
  return canonical(value);
};
export function assistanceBody(
  raw: unknown,
  input?: Schema<"ResolvedInput">,
): Schema<"AssistanceBody"> {
  requireThat(
    validateContract("AssistanceBody", raw).valid,
    422,
    "INVALID_ASSISTANCE_OUTPUT",
    "建议结构无效，不能保存为可用产物。",
  );
  const body = raw as Schema<"AssistanceBody">,
    serialized = JSON.stringify(body);
  requireThat(
    Buffer.byteLength(serialized) <= 480000 &&
      [
        body.prompt,
        body.notes,
        ...body.retain,
        ...body.change,
        ...body.referenceSuggestions.map((r) => r.note ?? ""),
      ].every(
        (value) =>
          !Array.from(value).some(
            (c) =>
              c === "\0" ||
              (c.codePointAt(0)! >= 0xd800 && c.codePointAt(0)! <= 0xdfff),
          ),
      ),
    422,
    "INVALID_ASSISTANCE_OUTPUT",
    "建议内容超过限制或包含无效字符。",
  );
  if (input) {
    const allowed = new Set(input.references.map((r) => identity(r.reference)));
    requireThat(
      body.referenceSuggestions.every((r) => allowed.has(identity(r))),
      422,
      "INVALID_ASSISTANCE_OUTPUT",
      "模型只能建议计划中明确选择的参考，不能加入未授权素材。",
    );
  }
  return body;
}
const select = `SELECT a.*,r.number,r.body,r.edited_by,r.created_at AS revision_created_at,p.input,p.resolved_input,p.execution_mode FROM assistance_artifacts a JOIN assistance_artifact_revisions r ON r.artifact_id=a.id JOIN generation_jobs j ON j.id=a.generation_job_id JOIN generation_plans p ON p.id=j.plan_id`;
async function serialize(
  tx: Transaction,
  row: Record<string, any>,
): Promise<Schema<"AssistanceArtifact">> {
  let outdated = false;
  try {
    await assertPromptCurrent(tx, row);
  } catch (error) {
    if (
      error instanceof Problem &&
      [404, 409, 412, 422, 503].includes(error.status)
    )
      outdated = true;
    else throw error;
  }
  return {
    id: row.id,
    revision: Number(row.number),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.revision_created_at.toISOString(),
    projectId: row.project_id,
    generationJobId: row.generation_job_id,
    request: row.input.assistance,
    shotSources: row.input.shotSources,
    resolvedInput: row.resolved_input,
    body: row.body,
    inputOutdated: outdated,
    executionMode: row.execution_mode,
    ...(row.edited_by ? { editedBy: row.edited_by } : {}),
  };
}
async function read(tx: Transaction, id: string, number?: number) {
  const row = (
    await tx.sql.query(
      `${select} WHERE a.tenant_id=$1 AND a.project_id=$2 AND a.id=$3 AND r.number=coalesce($4::bigint,a.revision)`,
      [tx.tenantId, tx.projectId, id, number ?? null],
    )
  ).rows[0];
  requireThat(row, 404, "NOT_FOUND", "创作建议或该修订不存在或无访问权限。");
  return row;
}
export function assistanceArtifactRoutes(
  app: FastifyInstance,
  context: ApiContext,
) {
  registerAction(app, context, "getAssistanceArtifact", async (tx, input) => {
    const body = await serialize(tx, await read(tx, input.params.artifactId!));
    return { body, etag: body.revision };
  });
  registerAction(app, context, "getAssistanceRevision", async (tx, input) => {
    const body = await serialize(
      tx,
      await read(
        tx,
        input.params.artifactId!,
        Number(input.params.revisionNumber),
      ),
    );
    return { body, etag: body.revision };
  });
  registerAction(app, context, "listAssistanceArtifacts", async (tx, input) => {
    const result = await page(
      tx,
      context.secrets,
      "listAssistanceArtifacts",
      input.query,
      `${select} WHERE a.tenant_id=$1 AND a.project_id=$2 AND r.number=a.revision AND ($3::text IS NULL OR p.input->'assistance'->>'kind'=$3) AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM generation_plan_shots s WHERE s.plan_id=p.id AND s.shot_id=$4)) AND r.body->>'prompt' ILIKE $5`,
      [
        tx.tenantId,
        tx.projectId,
        input.query.kind ?? null,
        input.query.shotId ?? null,
        searchPattern(input.query),
      ],
      (row) => row,
    );
    return {
      body: {
        ...result,
        items: await Promise.all(result.items.map((row) => serialize(tx, row))),
      },
    };
  });
  registerAction(app, context, "editAssistanceArtifact", async (tx, input) => {
    const previous = await read(tx, input.params.artifactId!);
    versionMatches(Number(previous.revision), input.version);
    const body = assistanceBody(input.body.body);
    const existing = new Set(
      (previous.body as Schema<"AssistanceBody">).referenceSuggestions.map(
        identity,
      ),
    );
    for (const reference of body.referenceSuggestions)
      if (!existing.has(identity(reference)))
        await validateReference(tx, reference);
    await tx.sql.query(
      "INSERT INTO assistance_artifact_revisions(tenant_id,project_id,artifact_id,number,body,edited_by) VALUES($1,$2,$3,$4,$5,$6)",
      [
        tx.tenantId,
        tx.projectId,
        previous.id,
        Number(previous.revision) + 1,
        body,
        tx.session.userId,
      ],
    );
    await tx.sql.query(
      "UPDATE assistance_artifacts SET revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND project_id=$2 AND id=$3",
      [tx.tenantId, tx.projectId, previous.id],
    );
    const artifact = await serialize(tx, await read(tx, previous.id));
    return { body: artifact, etag: artifact.revision };
  });
}

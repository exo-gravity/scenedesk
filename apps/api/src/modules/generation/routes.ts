import { services, type MediaContext } from "../media/model.js";
import { parseEnvelope } from "@drama/queue";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { bindResourceProject } from "../../kernel/database.js";
import { requireThat } from "../../kernel/errors.js";
import { page, searchPattern } from "../../kernel/pages.js";
import { registerAction } from "../../kernel/routes.js";
import {
  assertAnalysisCurrent,
  createPlan,
  generationScope,
  getJob,
  getPlan,
  serializeJob,
  jobSelect,
  planRecord,
} from "./model.js";

export function generationRoutes(app: FastifyInstance, context: MediaContext) {
  registerAction(
    app,
    context,
    "listCapabilities",
    async (tx, input) => ({
      body: await page(
        tx,
        context.secrets,
        "listCapabilities",
        input.query,
        `SELECT * FROM generation_capabilities WHERE tenant_id=$1 AND enabled AND ($2::uuid IS NULL OR connection_id=$2) AND ($3::text IS NULL OR definition->>'purpose'=$3) AND definition->>'modelVersion' ILIKE $4`,
        [
          tx.tenantId,
          input.query.connectionId ?? null,
          input.query.purpose ?? null,
          searchPattern(input.query),
        ],
        (row) => ({
          ...(row.definition as object),
          id: row.id,
          connectionId: row.connection_id,
          revision: Number(row.revision),
          enabled: row.enabled,
          executionMode: row.execution_mode,
        }),
      ),
    }),
    {
      authorizeScope: async (tx, input) => {
        if (input.query.projectId)
          await bindResourceProject(tx, String(input.query.projectId), false);
      },
    },
  );
  registerAction(
    app,
    context,
    "createGenerationPlan",
    async (tx, input) => {
      if (["image", "video", "audio"].includes(input.body.purpose))
        services(context);
      return { body: await createPlan(tx, input.body) };
    },
    { authorizeScope: generationScope("input", true) },
  );
  registerAction(
    app,
    context,
    "getGenerationPlan",
    async (tx, input) => ({
      body: planRecord(await getPlan(tx, input.params.planId!)),
    }),
    { authorizeScope: generationScope("plan", false) },
  );
  registerAction(
    app,
    context,
    "executeGenerationPlan",
    async (tx, input) => {
      const plan = await getPlan(tx, input.body.planId);
      const existing = (
        await tx.sql.query(
          `${jobSelect} WHERE j.tenant_id=$1 AND j.plan_id=$2`,
          [tx.tenantId, plan.id],
        )
      ).rows[0];
      if (existing) return { body: await serializeJob(tx, existing) };
      requireThat(
        plan.status === "ready",
        409,
        "PLAN_NOT_READY",
        "计划不可执行，请核对阻断原因或重新准备。",
      );
      requireThat(
        plan.expires_at.getTime() > Date.now(),
        409,
        "PLAN_EXPIRED",
        "计划已过期，请重新核对输入并准备。",
      );
      const cap = (
        await tx.sql.query(
          "SELECT * FROM generation_capabilities WHERE tenant_id=$1 AND id=$2",
          [tx.tenantId, plan.capability_id],
        )
      ).rows[0];
      requireThat(
        cap?.enabled &&
          cap.revision === plan.capability_revision &&
          cap.connection_version_id === plan.connection_version_id,
        409,
        "CAPABILITY_CHANGED",
        "能力版本或启用状态已变化，请重新准备计划。",
      );
      requireThat(
        plan.execution_mode === "test_fixture",
        503,
        "REAL_PROVIDER_ACCEPTANCE_REQUIRED",
        "真实服务尚未完成接入验证，不能提交生成。",
      );
      await assertAnalysisCurrent(tx, plan);
      const allowed = (
        await tx.sql.query(
          "SELECT generation_submission_allowed($1) AS allowed",
          [cap.id],
        )
      ).rows[0]?.allowed;
      requireThat(
        allowed,
        429,
        "GENERATION_USAGE_LIMIT",
        "已达到模型任务上限，请等待现有任务完成或核对未决提交。",
      );
      const id = randomUUID();
      await tx.sql.query(
        "INSERT INTO generation_jobs(id,tenant_id,project_id,plan_id,created_by) VALUES($1,$2,$3,$4,$5)",
        [id, tx.tenantId, tx.projectId, plan.id, tx.session.userId],
      );
      await tx.sql.query(
        "UPDATE generation_plans SET status='consumed',revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [tx.tenantId, plan.id],
      );
      // Durable queue hint and business consumption commit with the API's encrypted replay record.
      await tx.sql.query("INSERT INTO generation_work(job_id) VALUES($1)", [
        id,
      ]);
      return { body: await serializeJob(tx, await getJob(tx, id)) };
    },
    { authorizeScope: generationScope("plan", true) },
  );
  registerAction(
    app,
    context,
    "getGenerationJob",
    async (tx, input) => ({
      body: await serializeJob(tx, await getJob(tx, input.params.jobId!)),
    }),
    { authorizeScope: generationScope("job", false) },
  );
  registerAction(
    app,
    context,
    "listGenerationJobs",
    async (tx, input) => {
      const result = await page(
        tx,
        context.secrets,
        "listGenerationJobs",
        input.query,
        `${jobSelect} WHERE j.tenant_id=$1 AND j.project_id=$2 AND ($3::text IS NULL OR j.status=$3) AND ($4::uuid IS NULL OR j.plan_id=$4) AND p.input->>'prompt' ILIKE $5`,
        [
          tx.tenantId,
          tx.projectId,
          input.query.status ?? null,
          input.query.planId ?? null,
          searchPattern(input.query),
        ],
        (row) => row,
      );
      return {
        body: {
          ...result,
          items: await Promise.all(
            result.items.map((row) => serializeJob(tx, row)),
          ),
        },
      };
    },
    { authorizeScope: generationScope("list", false) },
  );
  registerAction(
    app,
    context,
    "cancelGenerationJob",
    async (tx, input) => {
      const job = await getJob(tx, input.params.jobId!);
      await tx.sql.query("SELECT request_generation_cancel($1)", [job.id]);
      return { body: await serializeJob(tx, await getJob(tx, job.id)) };
    },
    { authorizeScope: generationScope("job", true) },
  );
  registerAction(
    app,
    context,
    "recoverJobArchive",
    async (tx, input) => {
      await getJob(tx, input.params.jobId!);
      const envelope = (
        await tx.sql.query("SELECT recover_generated_archive($1) AS envelope", [
          input.params.jobId,
        ])
      ).rows[0]?.envelope;
      requireThat(
        envelope,
        409,
        "ARCHIVE_RECOVERY_UNAVAILABLE",
        "原文件归档不可恢复或不需要重试；不会再次调用模型。",
      );
      await services(context).schedule(tx.sql, parseEnvelope(envelope));
      return {
        body: await serializeJob(tx, await getJob(tx, input.params.jobId!)),
      };
    },
    { authorizeScope: generationScope("job", true) },
  );
  registerAction(
    app,
    context,
    "requestJobReconciliation",
    async (tx, input) => {
      const job = await getJob(tx, input.params.jobId!);
      requireThat(
        [
          "submission_unknown",
          "reconciliation_required",
          "dispatching",
        ].includes(job.status),
        409,
        "RECONCILIATION_NOT_NEEDED",
        "此任务无需核对未知提交。",
      );
      await tx.sql.query("SELECT request_generation_reconciliation($1)", [
        job.id,
      ]);
      return { body: await serializeJob(tx, job) };
    },
    { authorizeScope: generationScope("job", true) },
  );
}

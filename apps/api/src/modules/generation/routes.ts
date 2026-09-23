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
  executePlanOnce,
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
    async (tx, input) => ({
      body: await executePlanOnce(tx, input.body.planId, {
        generationExecutor: context.generationExecutor === true,
      }),
    }),
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

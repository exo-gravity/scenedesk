import type { components } from "@drama/contracts";
import {
  assertCancellationJob,
  canRequestCancellation,
  type CancellationRequest,
  type CancellationTarget,
  type AsyncGenerationJob,
} from "./generation-lifecycle.js";
type Schema<T extends keyof components["schemas"]> = components["schemas"][T];

export type AssistantDraft = {
  scriptId: string;
  range?: Schema<"TextRange"> | undefined;
  quote: string;
  prompt: string;
  capabilityId: string;
  modelLabel: string;
  target: Extract<Schema<"ProposalTarget">, { mode: "append_to_scene" }>;
  context: {
    source: Schema<"ContextSourceInput">;
    label: string;
    text: string;
  }[];
};
export type AssistantRecord<
  Draft = AssistantDraft,
  Request = Schema<"PlanInput">,
> = {
  schemaVersion: 1;
  draft: Draft;
  planRequest?: { key: string; input: Request };
  planId?: string;
  execution?: { key: string; planId: string; jobId?: string };
  cancellation?: CancellationRequest;
  previous: { planId: string; jobId?: string }[];
};
export type AssistantState<
  Draft = AssistantDraft,
  Request = Schema<"PlanInput">,
> = {
  record?: AssistantRecord<Draft, Request> | undefined;
  plan?: Schema<"GenerationPlan"> | undefined;
  job?: Schema<"GenerationJob"> | undefined;
  busy: boolean;
  draftSaved: boolean;
  access: "checking" | "ready" | "error" | "forbidden";
  error?: string | undefined;
};
export type AssistantTransport<Request = Schema<"PlanInput">> = {
  checkAccess(): Promise<void>;
  createPlan(input: Request, key: string): Promise<Schema<"GenerationPlan">>;
  getPlan(id: string): Promise<Schema<"GenerationPlan">>;
  execute(planId: string, key: string): Promise<Schema<"GenerationJob">>;
  cancelJob(jobId: string, key: string): Promise<AsyncGenerationJob>;
  getJob(id: string): Promise<Schema<"GenerationJob">>;
  findJob(planId: string): Promise<Schema<"GenerationJob"> | undefined>;
};
export type AssistantStorage<
  Draft = AssistantDraft,
  Request = Schema<"PlanInput">,
> = {
  read(): Promise<AssistantRecord<Draft, Request> | undefined>;
  write(record: AssistantRecord<Draft, Request>): Promise<void>;
  clear(): Promise<void>;
};
export const jobStatusLabel: Record<Schema<"GenerationJob">["status"], string> =
  {
    queued: "排队中",
    dispatching: "正在提交",
    submission_unknown: "提交待核对",
    provider_pending: "模型已接收",
    provider_running: "正在生成",
    archiving: "正在保存结果",
    archive_failed: "结果保存需恢复",
    succeeded: "结果已就绪",
    failed: "生成失败",
    cancel_requested: "原任务结果待核对",
    cancelled: "已取消",
    reconciliation_required: "需要核对结果",
  };
export function jobFinished(job?: Schema<"GenerationJob">) {
  return !!job && ["succeeded", "failed", "cancelled"].includes(job.status);
}
/** A confirmed original job stays recoverable in history while the next draft is edited. */
export function canContinueCreation(job?: Schema<"GenerationJob">) {
  return (
    !!job &&
    ["queued", "provider_pending", "provider_running", "archiving"].includes(
      job.status,
    )
  );
}
export function selectedRange(text: string, start: number, end: number) {
  // Browser text selection offsets use UTF-16; the API uses Unicode code points.
  const points = Array.from(text),
    boundaries = [0];
  for (const point of points)
    boundaries.push(boundaries[boundaries.length - 1]! + point.length);
  const a = boundaries.indexOf(start),
    b = boundaries.indexOf(end);
  if (a < 0 || b <= a) throw new Error("请选择完整的原文片段。");
  return {
    range: { startOffset: a, endOffset: b },
    quote: points.slice(a, b).join(""),
  };
}
export function planForDraft(
  draft: AssistantDraft,
  projectId: string,
  capability: Schema<"Capability">,
): Schema<"PlanInput"> {
  if (!draft.scriptId || !draft.range || !draft.quote.trim())
    throw new Error("请先选择要分析的剧本片段。");
  if (
    capability.id !== draft.capabilityId ||
    !capability.enabled ||
    capability.purpose !== "script_analysis"
  )
    throw new Error("请选择当前可用的分镜分析能力。");
  return {
    scope: "project",
    projectId,
    connectionId: capability.connectionId,
    capabilityId: capability.id,
    purpose: "script_analysis",
    prompt: draft.prompt.trim(),
    output: {},
    additionalReferences: [],
    referenceOverrides: [],
    promptPolicy: "append",
    sourceScriptRevisionId: draft.scriptId,
    scriptRange: draft.range,
    proposalTarget: draft.target,
    contextSources: draft.context.map((c) => c.source),
  };
}

/** One scene's durable intent. Recovery reads never purchase a new job. */
export class AssistantSession<
  Draft = AssistantDraft,
  Request = Schema<"PlanInput">,
> {
  private state: AssistantState<Draft, Request> = {
    busy: false,
    draftSaved: false,
    access: "checking",
  };
  private listeners = new Set<() => void>();
  private queue = Promise.resolve();
  private active = false;
  private epoch = 0;
  private initial?: Draft;
  private retired = false;
  private hiddenRecord?: AssistantRecord<Draft, Request> | undefined;
  private accessCheck: { promise: Promise<void>; resolve(): void } | undefined;
  constructor(
    private storage: AssistantStorage<Draft, Request>,
    private transport: AssistantTransport<Request>,
  ) {}
  getSnapshot = () => this.state;
  /** Hidden UI state is separate from whether accepted local input is durable. */
  hasUnretainedDraft = () =>
    !this.state.draftSaved && !!(this.state.record ?? this.hiddenRecord);
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(change: Partial<AssistantState<Draft, Request>>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((listener) => listener());
  }
  private assertCurrent(epoch: number) {
    if (epoch !== this.epoch || this.retired)
      throw new Error("ASSISTANT_SESSION_RETIRED");
  }
  private async persist(
    record: AssistantRecord<Draft, Request>,
    epoch: number,
  ) {
    this.assertCurrent(epoch);
    const write = this.queue.then(async () => {
      this.assertCurrent(epoch);
      await this.storage.write(structuredClone(record));
    });
    this.queue = write.catch(() => {});
    await write;
    this.assertCurrent(epoch);
    this.publish({ record, draftSaved: true });
  }
  private action(run: (epoch: number) => Promise<void>, allowChecking = false) {
    if (
      this.retired ||
      this.active ||
      (!allowChecking && this.state.access !== "ready")
    )
      return Promise.resolve();
    const epoch = this.epoch;
    this.active = true;
    this.publish({ busy: true, error: undefined });
    return run(epoch)
      .catch(async (error) => {
        if (epoch !== this.epoch || this.retired) return;
        const status =
          error && typeof error === "object"
            ? (error as { status?: number }).status
            : undefined;
        if ([401, 403, 404].includes(status ?? 0)) {
          // A command error is only a hint. Recheck current session/project GET
          // before destroying this scene's local content.
          this.suspend();
          await this.verify();
          return;
        }
        this.publish({
          error:
            error instanceof Error
              ? error.message
              : "暂时无法完成，请保留当前内容。",
        });
      })
      .finally(() => {
        if (epoch === this.epoch && !this.retired) {
          this.active = false;
          this.publish({ busy: false });
        }
      });
  }
  suspend() {
    const accessCheck = this.accessCheck;
    this.accessCheck = undefined;
    this.hiddenRecord = this.state.record ?? this.hiddenRecord;
    this.epoch++;
    this.active = false;
    this.publish({
      record: undefined,
      plan: undefined,
      job: undefined,
      busy: false,
      access: "checking",
      error: undefined,
    });
    accessCheck?.resolve();
  }
  settle() {
    return this.queue;
  }
  /** Observe the current check only; never start an authorization or command request. */
  settleAccess = () => this.accessCheck?.promise;
  async retire() {
    this.suspend();
    this.retired = true;
    this.hiddenRecord = undefined;
    await this.queue;
    await this.storage.clear();
    this.publish({ access: "forbidden", error: "当前会话已结束。" });
  }
  async verify() {
    if (this.retired || this.active) return;
    const epoch = this.epoch;
    let resolve!: () => void;
    const accessCheck = {
      promise: new Promise<void>((done) => {
        resolve = done;
      }),
      resolve: () => resolve(),
    };
    this.accessCheck = accessCheck;
    this.active = true;
    this.publish({ access: "checking", busy: true });
    try {
      await this.transport.checkAccess();
      this.assertCurrent(epoch);
      await this.queue;
      this.assertCurrent(epoch);
      const stored = await this.storage.read();
      this.assertCurrent(epoch);
      const record =
        this.hiddenRecord ??
        stored ??
        (this.initial
          ? { schemaVersion: 1 as const, draft: this.initial, previous: [] }
          : undefined);
      this.assertCurrent(epoch);
      this.publish({
        record,
        draftSaved: !this.hiddenRecord,
        access: "ready",
        error: undefined,
      });
      if (this.hiddenRecord && record) {
        await this.persist(record, epoch);
        this.hiddenRecord = undefined;
      }
      if (record?.planId) {
        const plan = await this.transport.getPlan(record.planId);
        this.assertCurrent(epoch);
        this.publish({ plan });
      }
      if (record?.execution) await this.recoverExecution(epoch);
    } catch (error) {
      if (epoch !== this.epoch || this.retired) return;
      const status =
        error && typeof error === "object"
          ? (error as { status?: number }).status
          : undefined;
      // The authorization GET above is authoritative. A missing old plan/job
      // after successful authorization preserves local recovery for inspection.
      if (
        this.state.access !== "ready" &&
        [401, 403, 404].includes(status ?? 0)
      ) {
        try {
          await this.queue;
          this.assertCurrent(epoch);
          await this.storage.clear();
          this.assertCurrent(epoch);
          this.hiddenRecord = undefined;
          this.publish({
            record: undefined,
            plan: undefined,
            job: undefined,
            access: "forbidden",
            error: "当前无法访问本场次，已清理本机助手内容。",
          });
        } catch {
          if (epoch === this.epoch && !this.retired)
            this.publish({
              record: undefined,
              plan: undefined,
              job: undefined,
              access: "forbidden",
              error:
                "当前不可访问，本机内容清理尚未完成。请重新核对以继续清理。",
            });
        }
      } else if (this.state.access !== "ready") {
        this.publish({
          record: undefined,
          plan: undefined,
          job: undefined,
          access: "error",
          error: "暂时无法恢复助手内容。本机副本仍保留，请联网后重试。",
        });
      } else
        this.publish({
          error:
            error instanceof Error
              ? error.message
              : "任务记录尚未读到，请重试核对。",
        });
    } finally {
      if (epoch === this.epoch && !this.retired) {
        this.active = false;
        this.publish({ busy: false });
      }
      if (this.accessCheck === accessCheck) this.accessCheck = undefined;
      accessCheck.resolve();
    }
  }
  load(initial: Draft) {
    this.initial = initial;
    return this.verify();
  }
  updateDraft(draft: Draft, preserveFixedPlan = false) {
    if (
      !this.state.record ||
      this.active ||
      this.state.access !== "ready" ||
      (!preserveFixedPlan &&
        (this.state.record.planRequest || this.state.record.planId))
    )
      return;
    const record = { ...this.state.record, draft },
      epoch = this.epoch;
    this.publish({ record, error: undefined, draftSaved: false });
    const write = this.queue.then(async () => {
      this.assertCurrent(epoch);
      await this.storage.write(structuredClone(record));
    });
    this.queue = write
      .then(() => {
        if (
          epoch === this.epoch &&
          !this.retired &&
          this.state.record === record
        )
          this.publish({ draftSaved: true });
      })
      .catch((error) => {
        if (epoch === this.epoch && !this.retired)
          this.publish({
            error:
              error instanceof Error
                ? error.message
                : "本机保存失败，请保留当前内容。",
          });
      });
  }
  commitDraft(
    expected: Draft,
    next: Draft,
    finish?: (prepared: Draft, checkCurrent: () => void) => Promise<Draft>,
  ) {
    return this.action(async (epoch) => {
      await this.queue;
      this.assertCurrent(epoch);
      const record = this.state.record;
      if (!record || JSON.stringify(record.draft) !== JSON.stringify(expected))
        throw new Error("输入已改变，请重新核对本次操作。");
      await this.persist({ ...record, draft: next }, epoch);
      if (finish) {
        const completed = await finish(structuredClone(next), () =>
          this.assertCurrent(epoch),
        );
        this.assertCurrent(epoch);
        await this.persist({ ...record, draft: completed }, epoch);
      }
    });
  }
  private async prepareCurrent(input: Request, epoch: number) {
    await this.queue;
    this.assertCurrent(epoch);
    const record = this.state.record;
    if (!record || record.execution || record.planId) return;
    const request = record.planRequest ?? {
      key: crypto.randomUUID(),
      input: structuredClone(input),
    };
    await this.persist({ ...record, planRequest: request }, epoch);
    this.assertCurrent(epoch);
    const plan = await this.transport.createPlan(request.input, request.key);
    this.assertCurrent(epoch);
    this.publish({ plan });
    await this.persist({ ...record, planId: plan.id }, epoch);
  }
  prepare(input: Request) {
    return this.action((epoch) => this.prepareCurrent(input, epoch));
  }
  prepareFrom(expected: Draft, resolve: () => Promise<Request>) {
    return this.action(async (epoch) => {
      await this.queue;
      this.assertCurrent(epoch);
      if (
        !this.state.record ||
        JSON.stringify(this.state.record.draft) !== JSON.stringify(expected)
      )
        throw new Error("输入已改变，请重新核对本次操作。");
      const request = this.state.record.planRequest?.input ?? (await resolve());
      this.assertCurrent(epoch);
      await this.prepareCurrent(request, epoch);
    });
  }
  /** One explicit user action; durable plan and execution intents remain separate.
   * Recovery never calls this method automatically. */
  generateFrom(expected: Draft, resolve: () => Promise<Request>) {
    return this.action(async (epoch) => {
      await this.queue;
      this.assertCurrent(epoch);
      const record = this.state.record;
      if (!record || JSON.stringify(record.draft) !== JSON.stringify(expected))
        throw new Error("输入已改变，请重新核对本次操作。");
      if (record.execution) return;
      if (!record.planId) {
        const request = record.planRequest?.input ?? (await resolve());
        this.assertCurrent(epoch);
        await this.prepareCurrent(request, epoch);
      }
      await this.executeCurrent(epoch);
    });
  }
  openExisting(
    planId: string,
    validate: (plan: Schema<"GenerationPlan">) => void,
  ) {
    return this.action(async (epoch) => {
      await this.queue;
      this.assertCurrent(epoch);
      const record = this.state.record;
      if (!record) return;
      if (record.planId === planId) {
        await this.recoverExecution(epoch);
        return;
      }
      if (record.execution && !jobFinished(this.state.job))
        throw new Error("请先核对当前任务，再打开其他任务。");
      const plan = await this.transport.getPlan(planId);
      this.assertCurrent(epoch);
      validate(plan);
      const job = await this.transport.findJob(planId);
      this.assertCurrent(epoch);
      const previous =
        record.planId &&
        !record.previous.some((item) => item.planId === record.planId)
          ? [
              ...record.previous,
              {
                planId: record.planId,
                ...(record.execution?.jobId
                  ? { jobId: record.execution.jobId }
                  : {}),
              },
            ]
          : record.previous;
      await this.persist(
        {
          schemaVersion: 1,
          draft: record.draft,
          planId,
          previous,
          ...(job
            ? { execution: { planId, jobId: job.id, key: crypto.randomUUID() } }
            : {}),
        },
        epoch,
      );
      this.publish({ plan, job });
    });
  }
  private async executeCurrent(epoch: number) {
    const record = this.state.record;
    if (!record?.planId || record.execution) return;
    const plan = await this.transport.getPlan(record.planId);
    this.assertCurrent(epoch);
    this.publish({ plan });
    if (plan.status !== "ready" || Date.parse(plan.expiresAt) <= Date.now())
      throw new Error("这次生成暂不可执行，请查看详情并核对输入。");
    const execution = { key: crypto.randomUUID(), planId: record.planId };
    await this.persist({ ...record, execution }, epoch);
    this.assertCurrent(epoch);
    const job = await this.transport.execute(record.planId, execution.key);
    this.assertCurrent(epoch);
    this.publish({ job });
    await this.persist(
      { ...record, execution: { ...execution, jobId: job.id } },
      epoch,
    );
  }
  execute() {
    return this.action((epoch) => this.executeCurrent(epoch));
  }
  resumeSubmission() {
    return this.action(async (epoch) => {
      const record = this.state.record;
      if (!record?.execution || record.execution.jobId) return;
      await this.recoverExecution(epoch);
      this.assertCurrent(epoch);
      if (this.state.record?.execution?.jobId) return;
      const plan = await this.transport.getPlan(record.execution.planId);
      this.assertCurrent(epoch);
      this.publish({ plan });
      if (plan.status !== "ready" || Date.parse(plan.expiresAt) <= Date.now())
        throw new Error("原计划尚不能继续提交，请保留本记录并继续核对。");
      const job = await this.transport.execute(
        record.execution.planId,
        record.execution.key,
      );
      this.assertCurrent(epoch);
      this.publish({ job });
      await this.persist(
        { ...record, execution: { ...record.execution, jobId: job.id } },
        epoch,
      );
    });
  }
  requestCancellation(target: CancellationTarget) {
    return this.action(async (epoch) => {
      await this.queue;
      this.assertCurrent(epoch);
      const record = this.state.record;
      if (
        !record?.execution ||
        record.execution.jobId !== target.jobId ||
        record.execution.planId !== target.planId
      )
        throw new Error("当前任务已改变，原取消确认不能用于其他任务。");
      await this.transport.checkAccess();
      this.assertCurrent(epoch);
      const current = await this.transport.getJob(target.jobId);
      this.assertCurrent(epoch);
      assertCancellationJob(current, target);
      this.publish({ job: current });
      if (!canRequestCancellation(current)) return;
      const cancellation = record.cancellation ?? {
        ...target,
        key: crypto.randomUUID(),
      };
      if (
        cancellation.jobId !== target.jobId ||
        cancellation.planId !== target.planId
      )
        throw new Error("已保存的取消请求属于其他任务，请保留原记录并核对。");
      await this.persist({ ...record, cancellation }, epoch);
      this.assertCurrent(epoch);
      const result = await this.transport.cancelJob(
        cancellation.jobId,
        cancellation.key,
      );
      this.assertCurrent(epoch);
      assertCancellationJob(result, target);
      if (
        (!result.cancelStatus || result.cancelStatus === "not_requested") &&
        !jobFinished(result)
      )
        throw new Error("取消回执尚未确认，请读取原任务核对。");
      this.publish({ job: result });
    });
  }
  private async recoverExecution(epoch: number) {
    const record = this.state.record;
    if (!record?.execution) return;
    const job = record.execution.jobId
      ? await this.transport.getJob(record.execution.jobId)
      : await this.transport.findJob(record.execution.planId);
    this.assertCurrent(epoch);
    if (!job) return;
    this.publish({ job });
    if (!record.execution.jobId)
      await this.persist(
        { ...record, execution: { ...record.execution, jobId: job.id } },
        epoch,
      );
  }
  refresh() {
    if (this.state.access !== "ready") return this.verify();
    return this.action(async (epoch) => {
      await this.queue;
      this.assertCurrent(epoch);
      const record = this.state.record;
      if (record && !this.state.draftSaved) await this.persist(record, epoch);
      if (record?.planId) {
        const plan = await this.transport.getPlan(record.planId);
        this.assertCurrent(epoch);
        this.publish({ plan });
      }
      await this.recoverExecution(epoch);
    });
  }
  revise(nextDraft?: Draft, expected?: Draft, continueAccepted = false) {
    return this.action(async (epoch) => {
      const record = this.state.record;
      if (!record) return;
      if (record.execution && continueAccepted) {
        // Polling is only a display hint. The original job may have entered an
        // unknown submission state since the last queued/running observation.
        if (!record.execution.jobId) return;
        const current = await this.transport.getJob(record.execution.jobId);
        this.assertCurrent(epoch);
        if (
          current.id !== record.execution.jobId ||
          current.planId !== record.execution.planId
        )
          throw new Error("返回的任务与原提交不一致，请保留原记录并核对。");
        this.publish({ job: current });
        if (!jobFinished(current) && !canContinueCreation(current))
          throw new Error(
            "原任务当前仍需核对，暂未进入下一稿。原输入与提交记录已保留。",
          );
      } else if (record.execution && !jobFinished(this.state.job)) return;
      if (expected && JSON.stringify(record.draft) !== JSON.stringify(expected))
        throw new Error("输入已改变，请重新核对本次操作。");
      const previous = record.planId
        ? [
            ...record.previous,
            {
              planId: record.planId,
              ...(record.execution?.jobId
                ? { jobId: record.execution.jobId }
                : {}),
            },
          ]
        : record.previous;
      await this.persist(
        {
          schemaVersion: 1,
          draft: nextDraft ?? record.draft,
          previous,
        },
        epoch,
      );
      this.publish({ plan: undefined, job: undefined });
    });
  }
}

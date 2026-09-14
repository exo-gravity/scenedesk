import { editingCanonical } from "@drama/domain";
import type { components } from "@drama/contracts";
import type {
  CanvasAssistanceInput,
  CanvasAssistantDraft,
} from "./canvas-assistant.js";
import type { AssistantSession } from "./assistant-session.js";
type Plan = components["schemas"]["GenerationPlan"];
export type CanvasPlanReceipt = {
  key: string;
  input: CanvasAssistanceInput;
  phase: "unknown" | "rejected" | "accepted";
  planId?: string;
  refusal?: { status: number; code: string; message: string };
};
export type CanvasPlanDeliveries = { receipts: CanvasPlanReceipt[] };
export type CanvasPlanDeliveryStore = {
  read(): Promise<CanvasPlanDeliveries | undefined>;
  write(value: CanvasPlanDeliveries): Promise<void>;
};
export class CanvasPlanHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly verified: boolean,
    message: string,
  ) {
    super(message);
  }
}
export function canvasPlanError(status: number, body: unknown) {
  const error = body as Partial<components["schemas"]["Error"]> | null;
  const verified =
    !!error &&
    typeof error.code === "string" &&
    typeof error.message === "string" &&
    typeof error.requestId === "string" &&
    error.requestId.length > 0;
  return new CanvasPlanHttpError(
    status,
    verified ? error.code! : "UNVERIFIED_RESPONSE",
    verified,
    verified ? error.message! : "计划响应未能核对，原消息和请求仍保留。",
  );
}
const firstRefusals: Record<number, ReadonlySet<string>> = {
  412: new Set(["VERSION_CONFLICT"]),
  409: new Set([
    "ASSISTANCE_REPLY_TARGET_MISMATCH",
    "ASSISTANCE_REPLY_UNAVAILABLE",
  ]),
  503: new Set(["MODEL_NOT_CONFIGURED", "TARGET_CAPABILITY_UNAVAILABLE"]),
  422: new Set([
    "INVALID_REQUEST",
    "CANVAS_ASSISTANCE_LIMIT",
    "DUPLICATE_CANVAS_SOURCE",
    "CANVAS_CONTEXT_UNAVAILABLE",
    "ASSISTANCE_REFERENCE_UNAVAILABLE",
    "ASSISTANCE_REFERENCE_MISMATCH",
    "ASSISTANCE_REFERENCE_UNSUPPORTED",
    "TARGET_REFERENCE_UNSUPPORTED",
    "TARGET_REFERENCE_LIMIT",
    "ASSISTANCE_HISTORY_LIMIT",
    "ASSISTANCE_INPUT_LIMIT",
    "GENERATION_INPUT_LIMIT",
    "CANVAS_ASSISTANCE_INPUT_UNSUPPORTED",
  ]),
};
/** Canvas-only delivery receipts. An absent receipt for an old request is never evidence of a first delivery. */
export class CanvasPlanDelivery {
  private state: CanvasPlanDeliveries = { receipts: [] };
  private listeners = new Set<() => void>();
  private newInput: { fingerprint: string; used: boolean } | undefined;
  private retired = false;
  constructor(private store: CanvasPlanDeliveryStore) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(value: CanvasPlanDeliveries) {
    this.state = value;
    for (const listener of this.listeners) listener();
  }
  private current() {
    if (this.retired)
      throw Error("登录会话已经结束，不能继续写入这份投递记录。");
  }
  retire() {
    this.retired = true;
  }
  async load() {
    this.current();
    const saved = await this.store.read();
    this.current();
    this.publish(saved ?? { receipts: [] });
  }
  private async save(receipt: CanvasPlanReceipt) {
    this.current();
    const saved = await this.store.read();
    this.current();
    const next = {
      receipts: [
        ...(saved?.receipts ?? []).filter((item) => item.key !== receipt.key),
        structuredClone(receipt),
      ],
    };
    await this.store.write(next);
    this.current();
    this.publish(next);
  }
  async newMessage(input: CanvasAssistanceInput, prepare: () => Promise<void>) {
    this.current();
    if (this.newInput) throw Error("上一条消息正在保留，请稍后再发送。");
    this.newInput = { fingerprint: editingCanonical(input), used: false };
    try {
      await prepare();
    } finally {
      this.newInput = undefined;
    }
  }
  private assertPlan(plan: Plan, input: CanvasAssistanceInput, id?: string) {
    if (
      !plan ||
      typeof plan.id !== "string" ||
      !plan.id ||
      (id !== undefined && plan.id !== id) ||
      !plan.input ||
      editingCanonical(plan.input) !== editingCanonical(input)
    )
      throw Error("计划回包与原固定消息不一致，请保留原身份核对。");
  }
  async submit(
    input: CanvasAssistanceInput,
    key: string,
    post: () => Promise<Plan>,
    get: (id: string) => Promise<Plan>,
  ): Promise<Plan> {
    this.current();
    const saved = await this.store.read();
    this.current();
    const prior = saved?.receipts.find((item) => item.key === key);
    if (prior && editingCanonical(prior.input) !== editingCanonical(input))
      throw Error("原计划身份与消息不一致，不能更换正文重送。");
    if (prior?.phase === "accepted" && prior.planId) {
      const plan = await get(prior.planId);
      this.assertPlan(plan, input, prior.planId);
      return plan;
    }
    if (prior?.phase === "rejected" && prior.refusal)
      throw new CanvasPlanHttpError(
        prior.refusal.status,
        prior.refusal.code,
        true,
        prior.refusal.message,
      );
    const first =
      !prior &&
      !!this.newInput &&
      !this.newInput.used &&
      this.newInput.fingerprint === editingCanonical(input);
    if (first) this.newInput!.used = true;
    const unknown: CanvasPlanReceipt = {
      key,
      input: structuredClone(input),
      phase: "unknown",
    };
    // This strict write completes before any POST. A crash from this point is an unknown delivery.
    await this.save(unknown);
    this.current();
    try {
      const plan = await post();
      this.current();
      this.assertPlan(plan, input);
      await this.save({ ...unknown, phase: "accepted", planId: plan.id });
      return plan;
    } catch (cause) {
      if (
        first &&
        cause instanceof CanvasPlanHttpError &&
        cause.verified &&
        firstRefusals[cause.status]?.has(cause.code)
      ) {
        await this.save({
          ...unknown,
          phase: "rejected",
          refusal: {
            status: cause.status,
            code: cause.code,
            message: cause.message,
          },
        });
      }
      throw cause;
    }
  }
}

export async function returnRejectedCanvasPlan(
  delivery: CanvasPlanDelivery,
  controller: AssistantSession<CanvasAssistantDraft, CanvasAssistanceInput>,
) {
  const current = controller.getSnapshot(),
    record = current.record;
  if (
    current.access !== "ready" ||
    current.busy ||
    !record?.planRequest ||
    record.planId ||
    record.execution
  )
    throw Error("当前没有可返回编辑的明确拒绝计划。");
  await delivery.load();
  const receipt = delivery
    .getSnapshot()
    .receipts.find((item) => item.key === record.planRequest!.key);
  if (
    receipt?.phase !== "rejected" ||
    !receipt.refusal ||
    editingCanonical(receipt.input) !==
      editingCanonical(record.planRequest.input)
  )
    throw Error("原计划仍待核对，不能更换请求身份。");
  await controller.revise(
    {
      ...record.draft,
      nextInstruction:
        record.draft.nextInstruction || record.planRequest.input.prompt,
    },
    record.draft,
  );
  if (
    controller.getSnapshot().record?.planRequest?.key === record.planRequest.key
  )
    throw Error(
      controller.getSnapshot().error ?? "本机未完成保留，原计划意图仍未解除。",
    );
}

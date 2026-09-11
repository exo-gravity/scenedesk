import type { components } from "@drama/contracts";
import type { ReworkSource } from "./prompt-draft.js";
type Schema<T extends keyof components["schemas"]> = components["schemas"][T];
export type FeedbackIntent = {
  kind: "review" | "comment" | "change";
  key: string;
  attemptedAt: number;
  reviewId?: string;
  commentId?: string;
  revision?: number;
  authorId?: string;
  body:
    Schema<"ReviewInput"> | Schema<"CommentInput"> | Schema<"CommentChange">;
  rejected?: string;
};
export type FeedbackDraft = {
  body: string;
  started: boolean;
  editing?: Schema<"Comment">;
  intent?: FeedbackIntent;
  receipt?: Schema<"Review"> | Schema<"Comment">;
  selected?: ReworkSource;
  selections?: ReworkSource[];
  // Explicitly leaving an unresolved/changed operation never destroys its text.
  retained?: { body: string; intent?: FeedbackIntent }[];
};
export type FeedbackSnapshot = {
  reviews: Schema<"Review">[];
  comments: Schema<"Comment">[];
};
export type FeedbackStorage = {
  read(): Promise<FeedbackDraft | undefined>;
  write(draft: FeedbackDraft): Promise<void>;
  clear(): Promise<void>;
};
export type FeedbackTransport = {
  read(): Promise<FeedbackSnapshot>;
  send(intent: FeedbackIntent): Promise<unknown>;
};
type State = {
  draft?: FeedbackDraft | undefined;
  data?: FeedbackSnapshot | undefined;
  access: "checking" | "ready" | "error" | "forbidden";
  busy: boolean;
  saved: boolean;
  error?: string | undefined;
};
const uuid = (v: unknown) =>
  typeof v === "string" &&
  /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(v);
const positive = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0;
export function validFeedback(
  value: unknown,
  kind: "review" | "comment",
  scopeId: string,
  takeId?: string,
): boolean {
  if (!value || typeof value !== "object") return false;
  const v = value as Schema<"Review"> & Schema<"Comment">;
  if (!uuid(v.id) || !positive(v.revision)) return false;
  if (kind === "review")
    return (
      v.projectId === scopeId &&
      v.subject?.takeId === takeId &&
      !v.subject.cutRevisionId &&
      positive(v.number) &&
      ["open", "approved", "changes_requested"].includes(v.status) &&
      Array.isArray(v.sourceReviewIds) &&
      Array.isArray(v.reworkItems)
    );
  return (
    v.reviewId === scopeId &&
    uuid(v.authorId) &&
    typeof v.body === "string" &&
    !!v.body.trim() &&
    typeof v.resolved === "boolean" &&
    [v.startUs, v.endUs].every(
      (n) => n === undefined || (Number.isSafeInteger(n) && n >= 0),
    )
  );
}
export function validFeedbackReceipt(
  value: unknown,
  intent: FeedbackIntent,
  projectId: string,
  takeId: string,
  actorId: string,
) {
  if (
    !validFeedback(
      value,
      intent.kind === "review" ? "review" : "comment",
      intent.kind === "review" ? projectId : intent.reviewId!,
      takeId,
    )
  )
    return false;
  if (intent.kind === "review") {
    const r = value as Schema<"Review">;
    return (
      r.status === "open" &&
      r.revision === 1 &&
      r.sourceReviewIds.length === 0 &&
      r.reworkItems.length === 0
    );
  }
  const c = value as Schema<"Comment">;
  if (intent.kind === "comment") {
    const input = intent.body as Schema<"CommentInput">;
    if (
      c.revision !== 1 ||
      c.resolved ||
      ["startUs", "endUs", "parentCommentId"].some(
        (key) => c[key as keyof typeof c] !== input[key as keyof typeof input],
      )
    )
      return false;
  }
  return (
    c.authorId === (intent.kind === "comment" ? actorId : intent.authorId) &&
    (intent.kind !== "change" ||
      (c.id === intent.commentId &&
        [intent.revision!, intent.revision! + 1].includes(c.revision))) &&
    (!("body" in intent.body) || c.body === intent.body.body) &&
    (!("resolved" in intent.body) || c.resolved === intent.body.resolved)
  );
}
export function feedbackRetryAllowed(intent: FeedbackIntent, now = Date.now()) {
  return (
    intent.kind === "change" ||
    (Number.isFinite(intent.attemptedAt) &&
      now >= intent.attemptedAt &&
      now - intent.attemptedAt < 86400_000)
  );
}
export function trustedFeedbackRejection(status: number, value: unknown) {
  if (
    status !== 422 ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    return false;
  const v = value as Schema<"Error">;
  return (
    Object.keys(v).every((k) =>
      ["code", "message", "requestId", "details"].includes(k),
    ) &&
    [
      "REVIEW_SCOPE_UNSUPPORTED",
      "REVIEW_MEDIA_UNAVAILABLE",
      "INVALID_COMMENT_TEXT",
      "INVALID_COMMENT_TIME",
      "EMPTY_COMMENT_CHANGE",
      "INVALID_REQUEST",
    ].includes(v.code) &&
    typeof v.message === "string" &&
    !!v.message.trim() &&
    typeof v.requestId === "string" &&
    !!v.requestId.trim() &&
    (v.details === undefined ||
      (!!v.details &&
        typeof v.details === "object" &&
        !Array.isArray(v.details)))
  );
}
/** One Take's local draft, fixed comment CAS and bounded create receipt recovery. */
export class TakeFeedbackSession {
  private state: State = { access: "checking", busy: false, saved: true };
  private hidden?: FeedbackDraft | undefined;
  private listeners = new Set<() => void>();
  private queue = Promise.resolve();
  private epoch = 0;
  private retired = false;
  constructor(
    private storage: FeedbackStorage,
    private transport: FeedbackTransport,
    private projectId: string,
    private takeId: string,
    private actorId: string,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.state;
  private publish(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
  private current(epoch: number) {
    if (this.retired || epoch !== this.epoch)
      throw new Error("原意见窗口已停止操作。");
  }
  settle = () => this.queue;
  suspend() {
    this.hidden = this.state.draft ?? this.hidden;
    this.epoch++;
    this.publish({
      draft: undefined,
      data: undefined,
      access: "checking",
      busy: false,
    });
  }
  async retire() {
    this.suspend();
    this.retired = true;
    this.hidden = undefined;
    await this.queue;
    await this.storage.clear();
    this.publish({ access: "forbidden" });
  }
  private persist(draft: FeedbackDraft, epoch: number) {
    this.current(epoch);
    const copy = structuredClone(draft);
    // Accepted edits drain to this session's original slot even when its view hides.
    // Revocation waits for that drain before removing the slot.
    const work = this.queue.then(() => this.storage.write(copy));
    this.queue = work.catch(() => {});
    return work;
  }
  async verify() {
    if (this.retired || this.state.busy) return;
    const epoch = this.epoch;
    this.publish({ access: "checking", busy: true });
    try {
      const data = await this.transport.read();
      this.current(epoch);
      await this.queue;
      this.current(epoch);
      const stored = await this.storage.read();
      this.current(epoch);
      const draft = this.hidden ?? stored ?? { body: "", started: false };
      if (
        typeof draft.body !== "string" ||
        typeof draft.started !== "boolean" ||
        (draft.intent &&
          (!uuid(draft.intent.key) ||
            !Number.isFinite(draft.intent.attemptedAt) ||
            !["review", "comment", "change"].includes(draft.intent.kind) ||
            (draft.intent.kind === "review"
              ? (draft.intent.body as Schema<"ReviewInput">).subject?.takeId !==
                this.takeId
              : !data.reviews.some((r) => r.id === draft.intent!.reviewId)))) ||
        (draft.receipt &&
          (!draft.intent ||
            !validFeedbackReceipt(
              draft.receipt,
              draft.intent,
              this.projectId,
              this.takeId,
              this.actorId,
            )))
      )
        throw new Error("本机意见记录无法核对，请保留记录。");
      if (this.hidden) {
        await this.persist(draft, epoch);
        this.current(epoch);
      }
      this.hidden = undefined;
      this.publish({
        draft,
        data,
        access: "ready",
        saved: true,
        error: undefined,
      });
    } catch (error) {
      if (epoch !== this.epoch || this.retired) return;
      if (
        [401, 403, 404].includes((error as { status?: number }).status ?? 0)
      ) {
        await this.queue;
        try {
          await this.storage.clear();
          this.current(epoch);
          this.hidden = undefined;
        } catch {
          if (epoch !== this.epoch) return;
        }
        this.publish({
          draft: undefined,
          data: undefined,
          access: "forbidden",
          error: "当前不可访问候选意见。本机内容已隐藏，请重新核对权限。",
        });
      } else
        this.publish({
          draft: undefined,
          data: undefined,
          access: "error",
          error: "意见暂时无法读取。本机输入仍保留，请重试。",
        });
    } finally {
      if (epoch === this.epoch && !this.retired) this.publish({ busy: false });
    }
  }
  edit(patch: Partial<Pick<FeedbackDraft, "body" | "started">>) {
    if (
      this.state.access !== "ready" ||
      this.state.busy ||
      !this.state.draft ||
      this.state.draft.intent ||
      this.state.draft.receipt
    )
      return;
    const draft = { ...this.state.draft, ...patch },
      epoch = this.epoch;
    this.publish({ draft, saved: false });
    void this.persist(draft, epoch)
      .then(() => {
        if (epoch === this.epoch && this.state.draft === draft)
          this.publish({ saved: true });
      })
      .catch((error) => {
        if (epoch === this.epoch) this.publish({ error: String(error) });
      });
  }
  private async action(
    run: (draft: FeedbackDraft, epoch: number) => Promise<void>,
  ) {
    if (this.state.access !== "ready" || this.state.busy || !this.state.draft)
      return;
    const epoch = this.epoch,
      draft = this.state.draft;
    this.publish({ busy: true, error: undefined });
    try {
      await this.queue;
      this.current(epoch);
      await run(draft, epoch);
    } catch (error) {
      if (epoch !== this.epoch || this.retired) return;
      this.publish({
        error: error instanceof Error ? error.message : "请保留原文重试核对。",
      });
      if (
        [401, 403, 404].includes((error as { status?: number }).status ?? 0)
      ) {
        this.suspend();
        await this.verify();
      }
    } finally {
      if (epoch === this.epoch && !this.retired) this.publish({ busy: false });
    }
  }
  private async store(draft: FeedbackDraft, epoch: number) {
    await this.persist(draft, epoch);
    this.current(epoch);
    this.publish({ draft, saved: true });
  }
  openEditor(comment: Schema<"Comment">) {
    return this.action(async (draft, epoch) => {
      if (draft.intent || draft.receipt || (draft.started && draft.body))
        throw new Error("请先保存当前意见输入，再编辑其他意见。");
      if (comment.authorId !== this.actorId)
        throw new Error("只能编辑自己记录的意见正文。");
      await this.store(
        {
          ...draft,
          body: comment.body,
          started: true,
          editing: structuredClone(comment),
        },
        epoch,
      );
    });
  }
  select(source: ReworkSource) {
    return this.action(async (draft, epoch) => {
      const data = await this.transport.read();
      this.current(epoch);
      const current = data.comments.find(
        (c) => c.id === source.comment.id && c.reviewId === source.reviewId,
      );
      if (
        source.takeId !== this.takeId ||
        !current ||
        current.revision !== source.comment.revision ||
        current.resolved
      )
        throw new Error(
          "这条意见已改变，请读取当前意见后重新选择。原输入仍保留。",
        );
      await this.store(
        {
          ...draft,
          selected: structuredClone(source),
          selections: [
            ...(draft.selections ?? []).filter(
              (s) =>
                s.comment.id !== source.comment.id ||
                s.comment.revision !== source.comment.revision,
            ),
            structuredClone(source),
          ],
        },
        epoch,
      );
      this.publish({ data });
    });
  }
  submit(
    kind?: FeedbackIntent["kind"],
    target?: Schema<"Comment">,
    resolved?: boolean,
  ) {
    return this.action(async (original, epoch) => {
      if (original.receipt) {
        await this.finish(original, epoch);
        return;
      }
      if (original.intent?.rejected)
        throw new Error("请先核对未提交的原输入。");
      const data = await this.transport.read();
      this.current(epoch);
      let intent = original.intent;
      if (intent && !feedbackRetryAllowed(intent))
        throw new Error(
          "原创建回执已超过可恢复期限。请只读核对意见列表，保留原文；不要重新发送创建。",
        );
      if (!intent) {
        if (!kind) return;
        const review = data.reviews.find((r) => r.status === "open");
        const opened = target ?? original.editing;
        if (kind === "review" && review) {
          this.publish({ data });
          throw new Error("该候选已有意见记录，请在该记录内保存意见。");
        }
        if (kind === "comment" && !review)
          throw new Error("请先明确建立该候选的意见记录。");
        if (
          kind !== "review" &&
          resolved === undefined &&
          (!original.body.trim() || original.body.trim().length > 5000)
        )
          throw new Error("请填写 1–5000 字的意见正文。");
        if (kind === "change" && !opened)
          throw new Error("请先打开指定意见修订。");
        intent = {
          kind,
          key: crypto.randomUUID(),
          attemptedAt: Date.now(),
          ...(kind === "comment" ? { reviewId: review!.id } : {}),
          ...(kind === "change"
            ? {
                reviewId: opened!.reviewId,
                commentId: opened!.id,
                revision: opened!.revision,
                authorId: opened!.authorId,
              }
            : {}),
          body:
            kind === "review"
              ? { subject: { takeId: this.takeId } }
              : resolved !== undefined
                ? { resolved }
                : { body: original.body.trim() },
        };
      }
      const draft = { ...original, intent };
      await this.store(draft, epoch);
      try {
        if (!feedbackRetryAllowed(intent))
          throw new Error("原创建回执已超过可恢复期限，请只读核对并保留原文。");
        const result = await this.transport.send(structuredClone(intent));
        this.current(epoch);
        if (
          !validFeedbackReceipt(
            result,
            intent,
            this.projectId,
            this.takeId,
            this.actorId,
          )
        )
          throw new Error(
            "保存回包与原对象、作者或内容不匹配，结果尚未确认。请保留原请求核对。",
          );
        const completed = {
          ...draft,
          receipt: result as Schema<"Review"> | Schema<"Comment">,
        };
        this.publish({ draft: completed, saved: false });
        await this.finish(completed, epoch);
      } catch (error) {
        this.current(epoch);
        if (
          !original.intent &&
          (error as { trustedBusinessRejection?: boolean })
            .trustedBusinessRejection
        ) {
          await this.store(
            {
              ...draft,
              intent: { ...intent, rejected: (error as Error).message },
            },
            epoch,
          );
        }
        throw error;
      }
    });
  }
  private async finish(draft: FeedbackDraft, epoch: number) {
    if (
      !draft.intent ||
      !validFeedbackReceipt(
        draft.receipt,
        draft.intent,
        this.projectId,
        this.takeId,
        this.actorId,
      )
    )
      throw new Error("本机结果回执不能确认原请求，请保留记录核对。");
    await this.store(draft, epoch);
    const data = await this.transport.read();
    this.current(epoch);
    const { intent, receipt, editing, ...keep } = draft;
    const keepInput =
      intent?.kind === "review" ||
      (intent?.kind === "change" && "resolved" in intent.body);
    await this.store(
      {
        ...keep,
        ...(keepInput && editing ? { editing } : {}),
        body: keepInput ? draft.body : "",
        started: keepInput ? draft.started : false,
      },
      epoch,
    );
    this.publish({ data });
  }
  openPrevious(source: ReworkSource) {
    return this.action(async (draft, epoch) => {
      const known = draft.selections?.find(
        (s) =>
          s.takeId === source.takeId &&
          s.comment.id === source.comment.id &&
          s.comment.revision === source.comment.revision,
      );
      if (!known) throw new Error("此固定意见未在本机选择记录中。");
      const data = await this.transport.read();
      this.current(epoch);
      if (!data.reviews.some((r) => r.id === known.reviewId))
        throw new Error("原意见记录不可访问。");
      await this.store({ ...draft, selected: structuredClone(known) }, epoch);
    });
  }
  useExistingReview() {
    return this.action(async (draft, epoch) => {
      if (draft.intent?.kind !== "review" || draft.receipt) return;
      const data = await this.transport.read();
      this.current(epoch);
      if (!data.reviews.some((r) => r.status === "open"))
        throw new Error("尚未读到可用的候选意见记录。");
      const { intent, ...keep } = draft;
      await this.store(
        {
          ...keep,
          retained: [...(draft.retained ?? []), { body: draft.body, intent }],
        },
        epoch,
      );
      this.publish({ data });
    });
  }
  reconcileChange(openLatest = false) {
    return this.action(async (draft, epoch) => {
      const intent = draft.intent;
      if (intent?.kind !== "change") return;
      const data = await this.transport.read();
      this.current(epoch);
      const current = data.comments.find(
        (c) => c.id === intent.commentId && c.reviewId === intent.reviewId,
      );
      if (!current || current.revision < intent.revision!)
        throw new Error("原修订尚未改变。可明确按原请求重试，不能换用新基线。");
      const matches =
        [intent.revision!, intent.revision! + 1].includes(current.revision) &&
        (!("body" in intent.body) || current.body === intent.body.body) &&
        (!("resolved" in intent.body) ||
          current.resolved === intent.body.resolved);
      if (matches) {
        await this.finish({ ...draft, receipt: current }, epoch);
        return;
      }
      if (!openLatest)
        throw new Error(
          "意见已有其他修订，本机编辑保留。可明确保留本机副本后打开当前正文。",
        );
      const { intent: old, receipt, ...keep } = draft;
      const editing =
        current.authorId === this.actorId ? { editing: current } : {};
      await this.store(
        {
          ...keep,
          ...editing,
          body: current.authorId === this.actorId ? current.body : "",
          started: current.authorId === this.actorId,
          retained: [...(draft.retained ?? []), { body: draft.body, intent }],
        },
        epoch,
      );
      this.publish({ data });
    });
  }
  returnToEditing() {
    return this.action(async (draft, epoch) => {
      if (!draft.intent?.rejected) return;
      const { intent, ...keep } = draft;
      await this.store(keep, epoch);
    });
  }
}

import type { components } from "@drama/contracts";
type Schema<T extends keyof components["schemas"]> = components["schemas"][T];
export type ProjectFields = {
  name: string;
  format: string;
  rate: string;
  language: string;
};
export const emptyProjectFields: ProjectFields = {
  name: "",
  format: "portrait",
  rate: "24/1",
  language: "zh-CN",
};
export type ProjectRequest = {
  path: string;
  body: Schema<"CreateProject"> & { creationRequestId: string };
  idempotencyKey: string;
  rejected?: { code: string; message: string };
};
export type ProjectCreationRecord = {
  fields: ProjectFields;
  request?: ProjectRequest;
  result?: Schema<"Project">;
};
export type ProjectCreationStorage = {
  read(): Promise<ProjectCreationRecord | undefined>;
  write(record: ProjectCreationRecord): Promise<void>;
  clear(): Promise<void>;
  close(): void;
};
type Transport = {
  checkAccess(): Promise<void>;
  create(request: ProjectRequest): Promise<unknown>;
};
type State = {
  record: ProjectCreationRecord;
  ready: boolean;
  recovered: boolean;
  saved: boolean;
  busy: boolean;
  error?: Error | undefined;
};
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
export function validCreatedProject(
  value: unknown,
  tenantId: string,
): value is Schema<"Project"> {
  if (!value || typeof value !== "object") return false;
  const p = value as Schema<"Project">,
    s = p.spec;
  return (
    uuid(p.id) &&
    p.tenantId === tenantId &&
    Number.isSafeInteger(p.revision) &&
    p.revision > 0 &&
    [p.createdAt, p.updatedAt].every(
      (value) =>
        value === undefined ||
        (typeof value === "string" && Number.isFinite(Date.parse(value))),
    ) &&
    p.kind === "drama" &&
    typeof p.name === "string" &&
    p.name.length > 0 &&
    uuid(p.leadMembershipId) &&
    ["active", "archived"].includes(p.status) &&
    !!s &&
    [s.width, s.height, s.fpsNum, s.fpsDen].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    ) &&
    typeof s.language === "string"
  );
}
export function trustedProjectRejection(
  status: number,
  value: unknown,
): boolean {
  if (
    status !== 422 ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    return false;
  const body = value as Schema<"Error">;
  return (
    Object.keys(body).every((key) =>
      ["code", "message", "requestId", "details"].includes(key),
    ) &&
    ["INVALID_REQUEST", "INVALID_PROJECT_LEAD"].includes(body.code) &&
    typeof body.message === "string" &&
    !!body.message.trim() &&
    typeof body.requestId === "string" &&
    !!body.requestId.trim() &&
    (body.details === undefined ||
      (!!body.details &&
        typeof body.details === "object" &&
        !Array.isArray(body.details)))
  );
}
const errorValue = (value: unknown) =>
  value instanceof Error
    ? value
    : new Error("创建结果尚未确认，请保留原请求。");
/** One tab's project creation, with a durable request and explicit business recovery. */
export class ProjectCreation {
  private state: State = {
    record: { fields: { ...emptyProjectFields } },
    ready: false,
    recovered: false,
    saved: true,
    busy: false,
  };
  private listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  constructor(
    private storage: ProjectCreationStorage,
    private transport: Transport,
    private tenantId: string,
    private leadMembershipId: string,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.state;
  private publish(patch: Partial<State>) {
    if (this.closed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  close() {
    this.closed = true;
    this.storage.close();
  }
  async load() {
    if (this.closed || this.state.busy) return;
    this.publish({ busy: true, ready: false, error: undefined });
    try {
      await this.transport.checkAccess();
      if (this.closed) return;
      const record = await this.storage.read();
      if (record) {
        const f = record.fields,
          r = record.request;
        if (
          !f ||
          ![f.name, f.format, f.rate, f.language].every(
            (v) => typeof v === "string",
          ) ||
          (r &&
            (r.path !== this.path ||
              !uuid(r.body?.creationRequestId) ||
              !uuid(r.idempotencyKey))) ||
          (record.result && !validCreatedProject(record.result, this.tenantId))
        )
          throw new Error("本机创建记录无法核对，请保留记录并重新读取。");
      }
      this.publish({
        record: record ?? { fields: { ...emptyProjectFields } },
        ready: true,
        recovered: !!record,
        saved: true,
      });
    } catch (error) {
      this.publish({ error: errorValue(error) });
    } finally {
      this.publish({ busy: false });
    }
  }
  private get path() {
    return `/v1/tenants/${this.tenantId}/projects`;
  }
  private persist(record: ProjectCreationRecord) {
    const copy = structuredClone(record);
    if (this.closed) return Promise.reject(new Error("原创建窗口已关闭。"));
    // Register accepted input immediately. The slot queue drains it before a
    // newly opened editor can claim/read, even after this view closes.
    const work = this.storage.write(copy);
    this.queue = work.catch(() => {});
    return work;
  }
  restore() {
    if (this.state.ready && !this.state.busy)
      this.publish({ recovered: false });
  }
  edit(fields: ProjectFields) {
    if (
      !this.state.ready ||
      this.state.recovered ||
      this.state.busy ||
      this.state.record.request ||
      this.state.record.result
    )
      return;
    const record = { fields: { ...fields } };
    this.publish({ record, saved: false, error: undefined });
    void this.persist(record)
      .then(() => {
        if (this.state.record === record) this.publish({ saved: true });
      })
      .catch((error) => this.publish({ error: errorValue(error) }));
  }
  async discard() {
    if (
      !this.state.ready ||
      this.state.busy ||
      this.state.record.request ||
      this.state.record.result
    )
      return;
    this.publish({ busy: true });
    try {
      await this.queue;
      if (this.closed) return;
      await this.storage.clear();
      if (this.closed) return;
      await this.loadEmpty();
    } catch (error) {
      this.publish({ error: errorValue(error) });
    } finally {
      this.publish({ busy: false });
    }
  }
  private async loadEmpty() {
    // Reacquire a writable empty slot after clearing; stale owners cannot revive it.
    await this.storage.read();
    this.publish({
      record: { fields: { ...emptyProjectFields } },
      recovered: false,
      saved: true,
      error: undefined,
    });
  }
  async returnToEditing() {
    if (!this.state.record.request?.rejected || this.state.busy) return;
    this.publish({ busy: true });
    try {
      const record = { fields: this.state.record.fields };
      await this.persist(record);
      this.publish({ record, saved: true, error: undefined });
    } catch (error) {
      this.publish({ error: errorValue(error) });
    } finally {
      this.publish({ busy: false });
    }
  }
  async submit(): Promise<Schema<"Project"> | undefined> {
    if (
      !this.state.ready ||
      this.state.recovered ||
      this.state.busy ||
      this.closed
    )
      return;
    if (this.state.record.result) return this.finish();
    const initialSend = !this.state.record.request;
    let record = this.state.record;
    if (record.request?.rejected) return;
    this.publish({ busy: true, error: undefined });
    try {
      await this.transport.checkAccess();
      if (this.closed) return;
      if (!record.request) {
        const fields = record.fields,
          [fpsNum, fpsDen] = fields.rate.split("/").map(Number);
        if (
          !fields.name.trim() ||
          fields.name.length > 160 ||
          !["portrait", "landscape"].includes(fields.format) ||
          !["24/1", "25/1", "30/1", "24000/1001", "30000/1001"].includes(
            fields.rate,
          ) ||
          !fields.language.trim()
        )
          throw new Error("请完整填写项目名称、画幅、帧率和语言。");
        record = {
          fields,
          request: {
            path: this.path,
            body: {
              creationRequestId: crypto.randomUUID(),
              name: fields.name.trim(),
              leadMembershipId: this.leadMembershipId,
              spec: {
                width: fields.format === "portrait" ? 1080 : 1920,
                height: fields.format === "portrait" ? 1920 : 1080,
                fpsNum: fpsNum!,
                fpsDen: fpsDen!,
                language: fields.language,
              },
            },
            idempotencyKey: crypto.randomUUID(),
          },
        };
      }
      this.publish({ record, saved: false });
      await this.persist(record);
      if (this.closed) return;
      this.publish({ saved: true });
      const result = await this.transport.create(
        structuredClone(record.request!),
      );
      if (this.closed) return;
      if (!validCreatedProject(result, this.tenantId))
        throw new Error(
          "服务器回包不完整，创建结果尚未确认。请恢复原请求核对。",
        );
      this.publish({ record: { ...record, result } });
      return await this.finish(true);
    } catch (error) {
      const problem = error as
        | {
            status?: number;
            code?: string;
            message?: string;
            trustedBusinessRejection?: boolean;
          }
        | undefined;
      if (
        !this.closed &&
        initialSend &&
        record.request &&
        problem?.trustedBusinessRejection === true &&
        problem.status === 422 &&
        ["INVALID_REQUEST", "INVALID_PROJECT_LEAD"].includes(problem.code ?? "")
      ) {
        const rejected = {
          ...record,
          request: {
            ...record.request,
            rejected: {
              code: problem!.code!,
              message: problem?.message ?? "本次创建未提交，请核对输入。",
            },
          },
        };
        try {
          await this.persist(rejected);
          this.publish({ record: rejected, saved: true });
        } catch {
          /* The original request remains locked if recording rejection fails. */
        }
      }
      this.publish({
        error: errorValue(error),
        ...([401, 403].includes(problem?.status ?? 0) ? { ready: false } : {}),
      });
    } finally {
      this.publish({ busy: false });
    }
  }
  async finish(alreadyBusy = false): Promise<Schema<"Project"> | undefined> {
    if (
      this.closed ||
      !this.state.ready ||
      this.state.recovered ||
      (this.state.busy && !alreadyBusy) ||
      !this.state.record.result
    )
      return;
    this.publish({ busy: true, error: undefined });
    const record = this.state.record;
    try {
      // Store the confirmed result before cleanup. A failed write keeps the original
      // durable request; reload can only explicitly replay that same creation.
      await this.persist(record);
      if (this.closed) return;
      await this.transport.checkAccess();
      if (this.closed) return;
      await this.storage.clear();
      if (this.closed) return;
      this.publish({ ready: false, saved: true });
      return record.result;
    } catch (error) {
      const status = (error as { status?: number } | undefined)?.status;
      this.publish({
        saved: false,
        error: errorValue(error),
        ...([401, 403].includes(status ?? 0) ? { ready: false } : {}),
      });
    } finally {
      this.publish({ busy: false });
    }
  }
}

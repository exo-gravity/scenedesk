import { editingCanonical } from "@drama/domain";
import { ApiError } from "./api";
import { browserContractCompiler } from "./contract-validation";
import {
  clearEditingLocal,
  inspectEditingLocal,
  discardInspectedEditingLocal,
  loadEditingLocal,
  removeEditingLocal,
  saveEditingLocal,
  type EditingPartition,
  type EditingLocalCopy,
  type EditingLocalInspection,
} from "./editing-local";

export type EditingSnapshot<D> = {
  revision: number;
  document: D;
  documentHash: string;
};
export type EditingBuffer = { value: string; valid: boolean };
export type EditingPending<D, C extends object> = {
  id: string;
  version: number;
  document: D;
  documentHash: string;
} & C;
export type EditingLocalValue<D, S, C extends object> = {
  base: S;
  document: D;
  buffers: Record<string, EditingBuffer>;
  pending: EditingPending<D, C> | null;
} & C;
export type EditingState<D, S, C extends object> = {
  phase:
    | "loading"
    | "ready"
    | "saving"
    | "checking"
    | "discarding"
    | "conflict"
    | "error"
    | "forbidden";
  local: EditingLocalValue<D, S, C> | null;
  remote: S | null;
  recovery: EditingLocalCopy<EditingLocalValue<D, S, C>> | null;
  recoveryBlocked: boolean;
  recoveryInspection: EditingLocalInspection | null;
  accessChecking: boolean;
  error: Error | null;
  storageError: Error | null;
  localSaved: boolean;
  dirty: boolean;
  hasInvalidInput: boolean;
};
export type EditingTransport<D, S, C extends object> = {
  read: () => Promise<S>;
  save: (pending: EditingPending<D, C>) => Promise<S>;
};
export type EditingPolicy<D, S, C extends object> = {
  snapshotSchema: string;
  saveSchema: string;
  objectId: (snapshot: S) => string;
  contextKeys: readonly (keyof C & string)[];
  envelope: Record<string, unknown>;
  inspect: (document: D) => unknown;
};
const same = (a: unknown, b: unknown) =>
  editingCanonical(a) === editingCanonical(b);
const inputPending = (local: { buffers: Record<string, EditingBuffer> }) =>
  Object.values(local.buffers).some((b) => !b.valid);
const unauthorized = (error: unknown) =>
  error instanceof ApiError &&
  [401, 403, 404].includes(error.status) &&
  error.code !== "CSRF_REJECTED";
const asError = (error: unknown) =>
  error instanceof Error
    ? error
    : new Error("编辑操作未完成，请保留输入后重试。");
async function documentHash(document: unknown) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(editingCanonical(document)),
  );
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
/** Owns single-flight saves, pending receipts and authorized local recovery for
 * both real editing document formats. Domain context stays in each adapter;
 * existing Cut recovery records keep their original field names and shape. */
export class EditingDocumentController<
  D,
  S extends EditingSnapshot<D> & C,
  C extends object = Record<never, never>,
> {
  private state: EditingState<D, S, C> = {
    phase: "loading",
    local: null,
    remote: null,
    recovery: null,
    recoveryBlocked: false,
    recoveryInspection: null,
    accessChecking: false,
    error: null,
    storageError: null,
    localSaved: false,
    dirty: false,
    hasInvalidInput: false,
  };
  private listeners = new Set<() => void>();
  private initialization: Promise<void> | undefined;
  private token: string | undefined;
  private storageQueue: Promise<void> = Promise.resolve();
  private writing = false;
  private paused = true;
  private revoked = false;
  private composing = false;
  private editSequence = 0;
  private firstUnsavedAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readSequence = 0;
  private validate:
    | Awaited<ReturnType<typeof browserContractCompiler>>["validateContract"]
    | undefined;

  constructor(
    readonly partition: EditingPartition,
    private transport: EditingTransport<D, S, C>,
    private readonly policy: EditingPolicy<D, S, C>,
    private readonly appSessionId?: string,
  ) {}
  private context(value: C): C {
    return Object.fromEntries(
      this.policy.contextKeys.map((key) => [key, value[key]]),
    ) as C;
  }
  private request(value: { document: D } & C) {
    return {
      ...this.policy.envelope,
      ...this.context(value),
      document: value.document,
    };
  }
  private isDirty(local: EditingLocalValue<D, S, C>) {
    return (
      !same(this.context(local), this.context(local.base)) ||
      !same(local.document, local.base.document)
    );
  }
  private receiptMatches(snapshot: S, pending: EditingPending<D, C>) {
    return (
      snapshot.revision > 0 &&
      snapshot.revision >= pending.version &&
      same(this.context(snapshot), this.context(pending)) &&
      snapshot.documentHash === pending.documentHash &&
      same(snapshot.document, pending.document)
    );
  }
  updateTransport(transport: EditingTransport<D, S, C>) {
    this.transport = transport;
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(change: Partial<EditingState<D, S, C>>) {
    if (this.revoked && change.phase !== "forbidden") return;
    const next = { ...this.state, ...change };
    next.dirty = !!next.local && this.isDirty(next.local);
    next.hasInvalidInput = !!next.local && inputPending(next.local);
    this.state = next;
    for (const listener of this.listeners) listener();
  }
  private acceptSnapshot(work: S) {
    if (
      !this.validate?.(this.policy.snapshotSchema, work).valid ||
      this.policy.objectId(work) !== this.partition.objectId
    )
      throw new Error(
        "读取的编辑内容格式或归属不符，请保留本机内容并重新读取。",
      );
    return work;
  }
  private freshLocal(work: S): EditingLocalValue<D, S, C> {
    return {
      base: work,
      document: work.document,
      ...this.context(work),
      buffers: {},
      pending: null,
    };
  }
  private async validRecovery(
    copy: EditingLocalCopy<EditingLocalValue<D, S, C>>,
    remote: S,
  ) {
    const value = copy.value;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !value.buffers ||
      typeof value.buffers !== "object" ||
      Array.isArray(value.buffers) ||
      (value.pending !== null &&
        (typeof value.pending !== "object" || Array.isArray(value.pending)))
    )
      throw new Error("本机副本格式不完整，不能直接恢复；原副本仍保留。");
    this.acceptSnapshot(value.base);
    if (
      value.base.revision > remote.revision ||
      !this.validate?.(this.policy.saveSchema, this.request(value)).valid ||
      !value.buffers ||
      Object.values(value.buffers).some(
        (b) =>
          !b || typeof b.value !== "string" || typeof b.valid !== "boolean",
      )
    )
      throw new Error("本机副本格式不完整，不能直接恢复；原副本仍保留。");
    if (
      value.pending &&
      (!Number.isSafeInteger(value.pending.version) ||
        value.pending.version < 0 ||
        value.pending.version !== value.base.revision ||
        typeof value.pending.id !== "string" ||
        !value.pending.id ||
        !this.validate(this.policy.saveSchema, this.request(value.pending))
          .valid ||
        !/^[a-f0-9]{64}$/.test(value.pending.documentHash))
    )
      throw new Error("本机保存请求不完整，不能自动重送；原副本仍保留。");
    if (
      value.pending &&
      (await documentHash(value.pending.document)) !==
        value.pending.documentHash
    )
      throw new Error("本机保存请求的内容与指纹不一致，原副本仍保留。");
    return value;
  }
  initialize() {
    return (this.initialization ??= this.load());
  }
  private async load() {
    this.publish({ phase: "loading", error: null });
    try {
      const [compiler, remote] = await Promise.all([
        browserContractCompiler(),
        this.transport.read(),
      ]);
      this.validate = compiler.validateContract;
      this.acceptSnapshot(remote);
      if (this.revoked) return;
      this.publish({ local: this.freshLocal(remote), remote });
      try {
        const copy = await loadEditingLocal<EditingLocalValue<D, S, C>>(
          this.partition,
        );
        if (this.revoked) return;
        this.token = copy?.token;
        if (copy) {
          const value = await this.validRecovery(copy, remote);
          this.publish({
            recoveryBlocked: false,
            recoveryInspection: null,
            storageError: null,
          });
          if (value.pending && this.receiptMatches(remote, value.pending)) {
            value.base = remote;
            value.pending = null;
          }
          if (
            !this.isDirty(value) &&
            !Object.keys(value.buffers).length &&
            !value.pending
          ) {
            this.publish({ localSaved: true });
            await this.persist();
          } else
            this.publish({ recovery: { ...copy, value }, localSaved: true });
        } else
          this.publish({
            localSaved: true,
            recoveryBlocked: false,
            recoveryInspection: null,
            storageError: null,
          });
        this.publish({ phase: "ready" });
      } catch (error) {
        const inspection = await inspectEditingLocal(this.partition).catch(
          () => null,
        );
        this.publish({
          storageError: asError(error),
          localSaved: false,
          recoveryBlocked: true,
          recoveryInspection: inspection,
          phase: "error",
        });
      }
    } catch (error) {
      if (unauthorized(error)) await this.revoke();
      else {
        this.initialization = undefined;
        this.publish({ phase: "error", error: asError(error) });
      }
    }
  }
  resume() {
    this.paused = false;
    this.schedule();
  }
  pause() {
    this.paused = true;
    this.clearTimer();
    void this.persist().catch(() => {});
  }
  suspendAccess() {
    if (this.revoked) return;
    this.readSequence++;
    this.clearTimer();
    this.publish({ accessChecking: true, error: null });
  }
  /** Release only a detached session whose latest work is already durable.
   * This is memory eviction, never a deletion of its local recovery copy. */
  async retireIfDurable() {
    const safe = () =>
      this.paused &&
      this.listeners.size === 0 &&
      !this.writing &&
      (this.state.phase !== "loading" || !this.initialization) &&
      (!this.state.local ||
        !!this.state.recovery ||
        this.state.recoveryBlocked ||
        (this.state.localSaved && !this.state.storageError));
    if (!safe()) return false;
    await this.storageQueue;
    if (!safe()) return false;
    this.revoked = true;
    this.clearTimer();
    this.initialization = undefined;
    this.validate = undefined;
    this.state = {
      ...this.state,
      local: null,
      remote: null,
      recovery: null,
      recoveryInspection: null,
      dirty: false,
      hasInvalidInput: false,
      error: null,
      storageError: null,
    };
    return true;
  }
  setComposing(value: boolean) {
    this.composing = value;
    if (value) this.clearTimer();
    else this.schedule();
  }
  private clearTimer() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
  private changed(local: EditingLocalValue<D, S, C>) {
    this.editSequence++;
    this.publish({
      local,
      localSaved: false,
      ...(this.state.phase === "error" && !local.pending
        ? { phase: "ready", error: null }
        : {}),
    });
    if (this.state.dirty) this.firstUnsavedAt ??= Date.now();
    else this.firstUnsavedAt = null;
    void this.persist()
      .then(() => this.schedule())
      .catch(() => {});
    this.schedule();
  }
  edit(document: D, buffers = this.state.local?.buffers ?? {}) {
    if (
      !this.state.local ||
      this.state.accessChecking ||
      this.state.recovery ||
      this.state.recoveryBlocked ||
      this.state.phase === "loading" ||
      this.state.phase === "discarding" ||
      this.revoked
    )
      return;
    this.changed({ ...this.state.local, document, buffers });
  }
  buffer(
    key: string,
    value: EditingBuffer | null,
    document = this.state.local?.document,
  ) {
    if (
      !this.state.local ||
      this.state.accessChecking ||
      !document ||
      this.state.recovery ||
      this.state.recoveryBlocked ||
      this.state.phase === "loading" ||
      this.state.phase === "discarding" ||
      this.revoked
    )
      return;
    const buffers = { ...this.state.local.buffers };
    if (value === null) delete buffers[key];
    else buffers[key] = value;
    this.changed({ ...this.state.local, document, buffers });
  }
  restore() {
    const { recovery, remote } = this.state;
    if (!recovery || !remote || this.revoked || this.state.accessChecking)
      return;
    const local = recovery.value;
    this.publish({
      recovery: null,
      local,
      phase: local.pending
        ? "checking"
        : local.base.revision !== remote.revision
          ? "conflict"
          : "ready",
      error: null,
    });
    if (local.pending) void this.checkPending(false);
    else {
      this.firstUnsavedAt = Date.now();
      this.schedule();
    }
  }
  private schedule() {
    this.clearTimer();
    if (
      this.paused ||
      this.state.accessChecking ||
      this.revoked ||
      this.composing ||
      this.writing ||
      this.state.recovery ||
      this.state.recoveryBlocked ||
      this.state.phase === "discarding" ||
      this.state.phase !== "ready" ||
      this.state.storageError ||
      !this.state.local ||
      this.state.local.pending ||
      !this.state.dirty ||
      this.state.hasInvalidInput
    )
      return;
    this.firstUnsavedAt ??= Date.now();
    const delay = Math.max(
      0,
      Math.min(800, 5000 - (Date.now() - this.firstUnsavedAt)),
    );
    this.timer = setTimeout(() => {
      void this.save();
    }, delay);
  }
  private persist() {
    const operation = this.storageQueue.then(async () => {
      if (
        this.revoked ||
        !this.state.local ||
        this.state.recovery ||
        this.state.recoveryBlocked
      )
        return;
      const sequence = this.editSequence,
        local = this.state.local;
      if (
        !this.isDirty(local) &&
        !Object.keys(local.buffers).length &&
        !local.pending
      ) {
        if (this.token) await removeEditingLocal(this.partition, this.token);
        this.token = undefined;
      } else {
        const copy = await saveEditingLocal(
          this.partition,
          local,
          this.token,
          this.appSessionId,
        );
        this.token = copy.token;
      }
      this.publish({
        localSaved: sequence === this.editSequence,
        storageError: null,
      });
    });
    this.storageQueue = operation.catch((error) =>
      this.publish({ storageError: asError(error), localSaved: false }),
    );
    return operation;
  }
  async retryLocal() {
    if (this.state.recoveryBlocked) {
      await this.load();
      return;
    }
    try {
      await this.persist();
      this.schedule();
    } catch {
      /* persistent notice owns retry */
    }
  }
  async save() {
    this.clearTimer();
    if (
      this.revoked ||
      this.state.accessChecking ||
      this.writing ||
      this.composing ||
      this.state.recovery ||
      this.state.recoveryBlocked ||
      !this.state.local ||
      this.state.phase === "loading" ||
      this.state.phase === "conflict"
    )
      return;
    if (this.state.local.pending) {
      await this.checkPending(true);
      return;
    }
    if (!this.state.dirty || this.state.hasInvalidInput) return;
    this.writing = true;
    try {
      const local = this.state.local;
      const sequence = this.editSequence;
      if (!this.validate?.(this.policy.saveSchema, this.request(local)).valid)
        throw new Error("仍有不能提交的编辑字段；输入已保留在本机，请先修正。");
      this.policy.inspect(local.document);
      const pending: EditingPending<D, C> = {
        id: crypto.randomUUID(),
        version: local.base.revision,
        ...this.context(local),
        document: structuredClone(local.document),
        documentHash: await documentHash(local.document),
      };
      if (this.revoked) return;
      this.publish({
        local: { ...this.state.local!, pending },
        phase: "saving",
        error: null,
      });
      if (this.editSequence === sequence) this.firstUnsavedAt = null;
      await this.submit(pending);
    } catch (error) {
      if (unauthorized(error)) await this.revoke();
      else this.publish({ phase: "error", error: asError(error) });
    } finally {
      this.writing = false;
      this.schedule();
    }
  }
  private async submit(pending: EditingPending<D, C>) {
    await this.persist();
    if (
      this.revoked ||
      this.state.accessChecking ||
      this.state.local?.pending?.id !== pending.id
    )
      return;
    try {
      const receipt = this.acceptSnapshot(await this.transport.save(pending));
      if (!this.receiptMatches(receipt, pending))
        throw new Error("服务器回执与本次保存内容不一致，请核对当前稿。");
      await this.confirm(receipt, pending);
    } catch (error) {
      if (unauthorized(error)) {
        await this.revoke();
        return;
      }
      if (error instanceof ApiError && [409, 422, 413].includes(error.status)) {
        if (this.state.local)
          this.publish({
            local: { ...this.state.local, pending: null },
            phase: error.status === 409 ? "conflict" : "error",
            error,
          });
        await this.persist();
        if (error.status === 409) await this.refresh();
      } else {
        this.publish({ phase: "checking", error: asError(error) });
        await this.resolvePending(pending, false);
      }
    }
  }
  private async confirm(receipt: S, pending: EditingPending<D, C>) {
    if (this.revoked || this.state.local?.pending?.id !== pending.id) return;
    const remote =
      this.state.remote && this.state.remote.revision > receipt.revision
        ? this.state.remote
        : receipt;
    this.publish({
      local: { ...this.state.local, base: receipt, pending: null },
      remote,
      phase: remote.revision > receipt.revision ? "conflict" : "ready",
      error: null,
    });
    if (this.state.dirty) this.firstUnsavedAt ??= Date.now();
    else this.firstUnsavedAt = null;
    // The pending request was persisted before the write. If this cleanup
    // aborts, a fresh authorized GET can resolve that receipt after reload.
    await this.persist().catch(() => {});
  }
  private async checkPending(retry: boolean) {
    if (
      this.writing ||
      this.revoked ||
      this.state.accessChecking ||
      !this.state.local?.pending
    )
      return;
    this.writing = true;
    this.publish({ phase: "checking", error: null });
    try {
      await this.resolvePending(this.state.local.pending, retry);
    } catch (error) {
      if (unauthorized(error)) await this.revoke();
      else this.publish({ phase: "error", error: asError(error) });
    } finally {
      this.writing = false;
      this.schedule();
    }
  }
  private async resolvePending(pending: EditingPending<D, C>, retry: boolean) {
    const remote = this.acceptSnapshot(await this.transport.read());
    if (this.revoked || this.state.local?.pending?.id !== pending.id) return;
    if (remote.revision < (this.state.remote?.revision ?? 0))
      throw new Error("核对回复早于已读取的编辑内容，请重新读取。");
    this.publish({ remote });
    if (this.receiptMatches(remote, pending)) {
      await this.confirm(remote, pending);
      return;
    }
    if (remote.revision === pending.version) {
      if (retry) {
        this.publish({ phase: "saving" });
        await this.submit(pending);
      } else
        this.publish({
          phase: "error",
          error: new Error(
            "尚未读到这次保存的结果。可以核对后重试同一版本，期间的新输入仍保留在本机。",
          ),
        });
      return;
    }
    if (remote.revision < pending.version)
      throw new Error("读到的编辑内容早于本机基线，请稍后重新核对。");
    this.publish({
      phase: "conflict",
      local: { ...this.state.local, pending: null },
      error: null,
    });
    await this.persist().catch(() => {});
  }
  async refresh() {
    if (this.revoked || this.state.phase === "loading" || !this.validate)
      return false;
    const sequence = ++this.readSequence;
    try {
      const remote = this.acceptSnapshot(await this.transport.read());
      if (
        this.revoked ||
        sequence !== this.readSequence ||
        remote.revision < (this.state.remote?.revision ?? 0)
      )
        return !this.revoked;
      const wasChecking = this.state.accessChecking;
      this.publish({ remote, accessChecking: false, error: null });
      if (wasChecking && this.state.local?.pending && !this.writing) {
        await this.checkPending(false);
        return true;
      }
      if (
        this.writing ||
        this.state.local?.pending ||
        this.state.recovery ||
        this.state.recoveryBlocked ||
        !this.state.local
      )
        return true;
      if (!this.state.dirty && !Object.keys(this.state.local.buffers).length) {
        this.publish({
          local: this.freshLocal(remote),
          phase: "ready",
          error: null,
        });
        await this.persist();
      } else if (remote.revision !== this.state.local.base.revision)
        this.publish({ phase: "conflict" });
      this.schedule();
      return true;
    } catch (error) {
      if (sequence !== this.readSequence || this.revoked) return !this.revoked;
      if (unauthorized(error)) await this.revoke();
      else this.publish({ error: asError(error) });
      return false;
    }
  }
  /** The view binds this action to the exact remote revision it displayed. */
  async reapply(
    document: D,
    buffers: Record<string, EditingBuffer>,
    remoteRevision: number,
    context: C,
  ) {
    if (
      !this.state.local ||
      !this.state.remote ||
      this.state.accessChecking ||
      this.revoked ||
      this.writing ||
      this.state.recovery ||
      this.state.recoveryBlocked ||
      this.state.local.pending ||
      this.state.phase === "loading"
    )
      return;
    this.editSequence++;
    const local = { ...this.state.local, document, buffers, pending: null };
    if (this.state.remote.revision !== remoteRevision) {
      this.publish({
        local,
        phase: "conflict",
        error: new Error(
          "比较期间编辑内容又有更新；手动合并内容已保留，请核对新版本。",
        ),
      });
    } else
      this.publish({
        local: { ...local, base: this.state.remote, ...context },
        phase: "ready",
        error: null,
      });
    await this.persist().catch(() => {});
    this.firstUnsavedAt = Date.now();
    this.schedule();
  }
  localDiscardContext() {
    const { local, recovery, remote } = this.state;
    return editingCanonical({
      document: local?.document ?? null,
      buffers: local?.buffers ?? null,
      baseRevision: local?.base.revision ?? null,
      context: local ? this.context(local) : null,
      pending: local?.pending?.id ?? null,
      recovery: recovery?.token ?? null,
      remoteRevision: remote?.revision ?? null,
      remoteSnapshot: remote,
    });
  }
  async discardLocal(expectedContext?: string) {
    if (
      !this.state.remote ||
      this.revoked ||
      this.state.accessChecking ||
      this.writing ||
      this.state.phase === "loading" ||
      this.state.local?.pending ||
      (expectedContext !== undefined &&
        expectedContext !== this.localDiscardContext())
    )
      return false;
    const originalPhase = this.state.phase;
    this.writing = true;
    this.clearTimer();
    this.publish({ phase: "discarding" });
    // Delete first. A failed local discard leaves the recovery/input visible.
    await this.storageQueue;
    try {
      if (this.revoked) return false;
      // A failed initial read supplies no CAS token. Re-read before declaring
      // discard complete; an unavailable/corrupt store must remain visible.
      if (this.state.recoveryBlocked && !this.token)
        this.token = (await loadEditingLocal(this.partition))?.token;
      if (this.token) await removeEditingLocal(this.partition, this.token);
      if (this.revoked || !this.state.remote) return false;
      this.token = undefined;
      this.editSequence++;
      this.publish({
        local: this.freshLocal(this.state.remote),
        recovery: null,
        recoveryBlocked: false,
        recoveryInspection: null,
        phase: "ready",
        localSaved: true,
        error: null,
        storageError: null,
      });
      this.firstUnsavedAt = null;
      return true;
    } catch (error) {
      this.publish({
        phase: originalPhase,
        storageError: asError(error),
        localSaved: false,
      });
      return false;
    } finally {
      this.writing = false;
    }
  }
  async discardDamagedLocal(inspection: EditingLocalInspection) {
    if (
      this.revoked ||
      this.state.accessChecking ||
      this.writing ||
      !this.state.recoveryBlocked ||
      this.state.recoveryInspection?.stamp !== inspection.stamp
    )
      return false;
    this.writing = true;
    this.clearTimer();
    this.publish({ phase: "discarding" });
    try {
      const remote = this.acceptSnapshot(await this.transport.read());
      if (this.revoked) return false;
      await this.storageQueue;
      await discardInspectedEditingLocal({
        ...inspection,
        partition: this.partition,
      });
      if (this.revoked) return false;
      this.token = undefined;
      this.editSequence++;
      this.firstUnsavedAt = null;
      const currentRemote =
        this.state.remote && this.state.remote.revision > remote.revision
          ? this.state.remote
          : remote;
      this.publish({
        local: this.freshLocal(currentRemote),
        remote: currentRemote,
        recovery: null,
        recoveryBlocked: false,
        recoveryInspection: null,
        phase: "ready",
        localSaved: true,
        error: null,
        storageError: null,
      });
      return true;
    } catch (error) {
      if (unauthorized(error)) await this.revoke();
      else
        this.publish({
          phase: "error",
          storageError: asError(error),
          localSaved: false,
        });
      return false;
    } finally {
      this.writing = false;
    }
  }
  async revoke(options: { preserveLocal?: boolean } = {}) {
    this.revoked = true;
    this.paused = true;
    this.clearTimer();
    this.publish({
      phase: "forbidden",
      local: null,
      remote: null,
      recovery: null,
      recoveryInspection: null,
      error: null,
      storageError: null,
    });
    await this.storageQueue;
    if (options.preserveLocal) return;
    try {
      await clearEditingLocal(
        this.partition.userId,
        {
          tenantId: this.partition.tenantId,
          projectId: this.partition.projectId,
          objectId: this.partition.objectId,
        },
        this.appSessionId,
      );
    } catch (error) {
      this.publish({ phase: "forbidden", storageError: asError(error) });
    }
  }
}

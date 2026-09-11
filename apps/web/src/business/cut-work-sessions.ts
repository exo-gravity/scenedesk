import { CutWorkController, type WorkTransport } from "./cut-work-controller";
import { EditingLocalError, type EditingPartition } from "./editing-local";
import type { EditingAccessHint } from "./editing-access";

/** Owns detached request receipts while bounding retained editor documents.
 * Operations serialize only local bookkeeping; network reads belong to callers. */
export class CutWorkSessionRegistry {
  private sessions = new Map<
    string,
    { controller: CutWorkController; sessionId: string }
  >();
  private queue: Promise<unknown> = Promise.resolve();
  private epochs = new Map<string, number>();
  private retiredSessions = new Set<string>();
  constructor(
    private readonly limit = 8,
    private readonly retained = 4,
  ) {}
  get size() {
    return this.sessions.size;
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  private async prune(target: number) {
    for (const [key, { controller }] of this.sessions) {
      if (this.sessions.size <= target) break;
      if (await controller.retireIfDurable()) this.sessions.delete(key);
    }
  }
  acquire(
    key: string,
    partition: EditingPartition,
    transport: WorkTransport,
    sessionId = "",
  ) {
    const epoch = this.epochs.get(partition.userId) ?? 0;
    return this.serial(async () => {
      const stillCurrent = () => {
        if (
          (this.epochs.get(partition.userId) ?? 0) !== epoch ||
          this.retiredSessions.has(
            JSON.stringify([partition.userId, sessionId]),
          )
        )
          throw new EditingLocalError(
            "unavailable",
            "这次编辑会话已结束，请重新核对当前身份后打开。",
          );
      };
      stillCurrent();
      const existing = this.sessions.get(key);
      if (existing) {
        existing.controller.updateTransport(transport);
        this.sessions.delete(key);
        this.sessions.set(key, existing);
        return { controller: existing.controller, reopening: true };
      }
      await this.prune(this.limit - 1);
      stillCurrent();
      if (this.sessions.size >= this.limit)
        throw new EditingLocalError(
          "unavailable",
          "已有多份编辑仍在保存或未能保留到本机。请先返回这些剪辑处理保存问题，再打开新的剪辑；现有输入仍保留。",
        );
      const controller = new CutWorkController(
        partition,
        transport,
        sessionId || undefined,
      );
      this.sessions.set(key, { controller, sessionId });
      return { controller, reopening: false };
    });
  }
  release(key: string, controller: CutWorkController) {
    controller.pause();
    return this.serial(async () => {
      if (this.sessions.get(key)?.controller === controller)
        await this.prune(this.retained);
    });
  }
  async clearUser(userId: string, sessionId?: string) {
    if (sessionId)
      this.retiredSessions.add(JSON.stringify([userId, sessionId]));
    else this.epochs.set(userId, (this.epochs.get(userId) ?? 0) + 1);
    // Stop immediately, before waiting for any registry/storage bookkeeping.
    const entries = [...this.sessions].filter(
      ([, entry]) =>
        entry.controller.partition.userId === userId &&
        (!sessionId || entry.sessionId === sessionId),
    );
    const clearing = Promise.all(
      entries.map(([, { controller }]) => controller.revoke()),
    );
    await this.serial(async () => {
      await clearing;
      for (const [key, entry] of entries)
        if (this.sessions.get(key) === entry) this.sessions.delete(key);
    });
  }
  private matching(hint: EditingAccessHint) {
    return [...this.sessions.values()].filter(({ controller, sessionId }) => {
      const p = controller.partition;
      return (
        sessionId === hint.sessionId &&
        p.userId === hint.userId &&
        controller.getSnapshot().phase !== "forbidden" &&
        (hint.kind === "session" ||
          (p.tenantId === hint.tenantId &&
            p.projectId === hint.projectId &&
            p.objectId === hint.objectId))
      );
    });
  }
  suspendAccess(hint: EditingAccessHint) {
    for (const { controller } of this.matching(hint))
      controller.suspendAccess();
  }
  async refreshAccess(hint: EditingAccessHint) {
    await Promise.all(
      this.matching(hint).map(({ controller }) => controller.refresh()),
    );
  }
  /** A newer login for the same user owns its own session. End the old memory
   * without erasing recovery records that the newer session may have updated. */
  async retireSession(hint: EditingAccessHint) {
    this.retiredSessions.add(JSON.stringify([hint.userId, hint.sessionId]));
    const entries = this.matching(hint);
    await Promise.all(
      entries.map(({ controller }) =>
        controller.revoke({ preserveLocal: true }),
      ),
    );
    for (const [key, entry] of this.sessions)
      if (entries.includes(entry)) this.sessions.delete(key);
  }
}

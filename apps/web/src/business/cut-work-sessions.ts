import { CutWorkController, type WorkTransport } from "./cut-work-controller";
import { EditingLocalError, type EditingPartition } from "./editing-local";

/** Owns detached request receipts while bounding retained editor documents.
 * Operations serialize only local bookkeeping; network reads belong to callers. */
export class CutWorkSessionRegistry {
  private sessions = new Map<string, CutWorkController>();
  private queue: Promise<unknown> = Promise.resolve();
  private epochs = new Map<string, number>();
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
    for (const [key, controller] of this.sessions) {
      if (this.sessions.size <= target) break;
      if (await controller.retireIfDurable()) this.sessions.delete(key);
    }
  }
  acquire(key: string, partition: EditingPartition, transport: WorkTransport) {
    const epoch = this.epochs.get(partition.userId) ?? 0;
    return this.serial(async () => {
      const stillCurrent = () => {
        if ((this.epochs.get(partition.userId) ?? 0) !== epoch)
          throw new EditingLocalError(
            "unavailable",
            "这次编辑会话已结束，请重新核对当前身份后打开。",
          );
      };
      stillCurrent();
      const existing = this.sessions.get(key);
      if (existing) {
        existing.updateTransport(transport);
        this.sessions.delete(key);
        this.sessions.set(key, existing);
        return { controller: existing, reopening: true };
      }
      await this.prune(this.limit - 1);
      stillCurrent();
      if (this.sessions.size >= this.limit)
        throw new EditingLocalError(
          "unavailable",
          "已有多份编辑仍在保存或未能保留到本机。请先返回这些剪辑处理保存问题，再打开新的剪辑；现有输入仍保留。",
        );
      const controller = new CutWorkController(partition, transport);
      this.sessions.set(key, controller);
      return { controller, reopening: false };
    });
  }
  release(key: string, controller: CutWorkController) {
    controller.pause();
    return this.serial(async () => {
      if (this.sessions.get(key) === controller)
        await this.prune(this.retained);
    });
  }
  async clearUser(userId: string) {
    this.epochs.set(userId, (this.epochs.get(userId) ?? 0) + 1);
    // Stop immediately, before waiting for any registry/storage bookkeeping.
    const entries = [...this.sessions].filter(
      ([, c]) => c.partition.userId === userId,
    );
    const clearing = Promise.all(entries.map(([, c]) => c.revoke()));
    await this.serial(async () => {
      await clearing;
      for (const [key, controller] of entries)
        if (this.sessions.get(key) === controller) this.sessions.delete(key);
    });
  }
}

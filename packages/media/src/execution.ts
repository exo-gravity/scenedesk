import { AsyncLocalStorage } from "node:async_hooks";
import { MediaFailure } from "./policy.js";

export type OwnedMediaContainer = {
  id: string;
  hostId: string;
  release(): Promise<void>;
};
export type MediaExecution = {
  signal: AbortSignal;
  reserveContainer(): Promise<OwnedMediaContainer>;
  /** Cumulative bytes written, including intermediates; deleting a file does not reset the budget. */
  accountWrite(bytes: number): void;
};
const execution = new AsyncLocalStorage<MediaExecution>();
export const currentMediaExecution = () => execution.getStore();
export const withMediaExecution = <T>(
  owner: MediaExecution,
  run: () => Promise<T>,
) => execution.run(owner, run);
export function accountMediaWrite(bytes: number) {
  const owner = execution.getStore();
  owner?.signal.throwIfAborted();
  owner?.accountWrite(bytes);
}
export function mediaWriteBudget(limit: number) {
  let written = 0;
  return (bytes: number) => {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || written + bytes > limit)
      throw new MediaFailure(
        "MEDIA_WORKSPACE_LIMIT",
        "制作任务的累计临时写入超过限额，请缩短素材或外部转换。",
      );
    written += bytes;
  };
}

type RetentionState = {
  local: unknown | null;
  localSaved: boolean;
  storageError: Error | null;
  accessChecking: boolean;
  phase: string;
  recovery: unknown | null;
  recoveryBlocked: boolean;
};

/** Editing another node needs durable local inputs, not a new network save.
 * Existing unknown canvas requests remain attached to the same controller. */
export async function retainCanvasEditing(
  controller: { retryLocal(): Promise<void>; getSnapshot(): RetentionState },
  retainGeneration: (() => Promise<boolean>) | undefined,
  current: () => boolean,
) {
  const check = () => {
    const state = controller.getSnapshot();
    if (!current()) throw new Error("编辑页面已切换。");
    if (
      !state.local ||
      !state.localSaved ||
      state.storageError ||
      state.accessChecking ||
      state.phase === "forbidden" ||
      state.phase === "loading" ||
      state.recovery ||
      state.recoveryBlocked
    )
      throw new Error(
        "本机输入尚未安全保存，请完成本机恢复后再切换。原输入仍保留。",
      );
  };
  await controller.retryLocal();
  check();
  if (retainGeneration && !(await retainGeneration()))
    throw new Error("创作参数尚未保存在本机，原编辑对象已保留，请重试。");
  check();
}

export type CreationIntent = {
  command: {
    path: string;
    method: "POST";
    body: unknown;
    version: number;
    idempotencyKey: string;
  };
  rejected?: { status: number; message: string };
};

/** Persist the exact request before sending; recovery never resolves new inputs. */
export async function submitCreation(
  intent: CreationIntent,
  expectedPath: string,
  store: (intent: CreationIntent) => Promise<boolean>,
  send: (command: CreationIntent["command"]) => Promise<unknown>,
  options: { initialSend: boolean; isCurrent: () => boolean },
) {
  if (
    intent.command.path !== expectedPath ||
    intent.command.method !== "POST" ||
    !intent.command.idempotencyKey ||
    !Number.isSafeInteger(intent.command.version) ||
    intent.command.version < 1 ||
    intent.rejected
  )
    throw Error("原创建记录与当前目标不匹配，请保留记录并核对。");
  const fixed = structuredClone(intent);
  if (!(await store(fixed)) || !options.isCurrent()) return;
  try {
    await send(structuredClone(fixed.command));
  } catch (error) {
    const problem = (error ?? {}) as {
      status?: number;
      code?: string;
      message?: string;
    };
    // Only a response to the first, never-unknown send can prove rejection.
    // A later 412 may mean the 24-hour replay receipt expired after a commit.
    if (
      options.initialSend &&
      options.isCurrent() &&
      [400, 409, 412, 422].includes(problem.status ?? 0) &&
      problem.code !== "IDEMPOTENCY_CONFLICT"
    )
      await store({
        ...fixed,
        rejected: {
          status: problem.status!,
          message: problem.message ?? "服务器拒绝了本次创建，未提交内容。",
        },
      });
    throw error;
  }
}

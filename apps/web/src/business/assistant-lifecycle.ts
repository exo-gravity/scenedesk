import type { AssistantSession, AssistantState } from "./assistant-session";
import type { EditingAccessHint } from "./editing-access";
import { registerEditingSessions } from "./editing-lifecycle";
import { clearAssistantLocal } from "./assistant-storage";
type Entry = {
  controller: Pick<
    AssistantSession<unknown>,
    "suspend" | "verify" | "retire" | "settle"
  > & {
    hasUnretainedDraft?(): boolean;
    settleAccess?(): Promise<void> | undefined;
    getSnapshot(): Pick<AssistantState<unknown>, "access" | "busy"> &
      (
        | { record?: unknown; draftSaved: boolean }
        | { draft?: unknown; saved: boolean }
      );
  };
  userId: string;
  sessionId: string;
  tenantId: string;
  projectId: string;
};
type RegisteredEntry = Entry & { attached: boolean };
const entries = new Set<RegisteredEntry>();
export type ProjectAssistantScope = Pick<
  Entry,
  "sessionId" | "userId" | "tenantId" | "projectId"
>;

/** Navigation barrier only: observe the local queue, never retry a command or model call. */
export async function retainProjectAssistantDrafts(
  scope: ProjectAssistantScope,
) {
  const inProject = (entry: Entry) =>
    entry.sessionId === scope.sessionId &&
    entry.userId === scope.userId &&
    entry.tenantId === scope.tenantId &&
    entry.projectId === scope.projectId;
  const waiting = [...entries].filter(inProject);
  await Promise.all(waiting.map((entry) => entry.controller.settle()));
  const current = new Set(waiting);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: Promise<never> | undefined;
  try {
    for (;;) {
      // Lazy editors can mount while an earlier editor is checking access.
      // They participate in this same barrier and cannot reset its time budget.
      for (const entry of entries) if (inProject(entry)) current.add(entry);
      const checks = [...current].flatMap((entry) => {
        const check = entry.controller.settleAccess?.();
        return check ? [check] : [];
      });
      if (!checks.length) break;
      deadline ??= new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("助手或创作输入仍在核对，请稍后重试切换。")),
          15000,
        );
      });
      await Promise.race([Promise.all(checks), deadline]);
    }
  } finally {
    clearTimeout(timer);
  }

  // There is no await between discovering the final registrations and checking
  // their current state. Later edits cannot borrow an earlier saved snapshot.

  for (const entry of current) {
    const state = entry.controller.getSnapshot();
    const saved = "draftSaved" in state ? state.draftSaved : state.saved;
    // Unmount suspends the old view while this barrier may be waiting on a
    // different editor. Once unregister has drained and removed that entry,
    // a retained, idle draft is safe; its cleanup-only checking state is not
    // a current authority check. Newly mounted entries are still inspected.
    const pending = entry.controller.hasUnretainedDraft?.() ?? !saved;
    if ((!entries.has(entry) || !entry.attached) && !pending && !state.busy) {
      entries.delete(entry);
      continue;
    }
    if (state.access !== "ready")
      throw new Error(
        "助手或创作输入尚未完成核对，请保留当前页面，核对后再切换。",
      );
    if (state.busy)
      throw new Error("助手或创作操作尚未结束，请保留当前输入，稍后再切换。");
    if (!saved)
      throw new Error("助手或创作输入尚未保留到本机，请先完成本机保存再切换。");
  }
}

const matches = (entry: Entry, hint: EditingAccessHint) =>
  entry.userId === hint.userId &&
  entry.sessionId === hint.sessionId &&
  (hint.kind === "session" ||
    (entry.tenantId === hint.tenantId && entry.projectId === hint.projectId));
/** Explicit recovery: authorization/fixed-result reads and local writes only. */
export async function retryProjectAssistantRetention(
  scope: ProjectAssistantScope,
) {
  const inProject = (entry: Entry) =>
    entry.sessionId === scope.sessionId &&
    entry.userId === scope.userId &&
    entry.tenantId === scope.tenantId &&
    entry.projectId === scope.projectId;
  await Promise.all(
    [...entries].filter(inProject).map((entry) => entry.controller.settle()),
  );
  await Promise.all(
    [...entries].filter(inProject).map(async (entry) => {
      const state = entry.controller.getSnapshot();
      const saved = "draftSaved" in state ? state.draftSaved : state.saved;
      if (state.busy || (state.access === "ready" && saved)) return;
      // Keep a visible unsaved record before verify reads its older storage copy.
      // Never interrupt an active command or replay it as part of navigation.
      entry.controller.suspend();
      await entry.controller.verify();
    }),
  );
  await retainProjectAssistantDrafts(scope);
}
registerEditingSessions({
  suspendAccess(hint) {
    for (const entry of entries)
      if (matches(entry, hint)) entry.controller.suspend();
  },
  async refreshAccess(hint) {
    await Promise.all(
      [...entries]
        .filter((entry) => matches(entry, hint))
        .map((entry) => entry.controller.verify()),
    );
  },
  async retireSession(hint) {
    await Promise.all(
      [...entries]
        .filter((entry) => matches(entry, hint))
        .map((entry) => entry.controller.retire()),
    );
    await clearAssistantLocal(hint.userId, hint.sessionId);
  },
  async clearUser(userId, sessionId) {
    await Promise.all(
      [...entries]
        .filter(
          (entry) =>
            entry.userId === userId &&
            (!sessionId || entry.sessionId === sessionId),
        )
        .map((entry) => entry.controller.retire()),
    );
    await clearAssistantLocal(userId, sessionId);
  },
});
export function registerAssistant(entry: Entry) {
  // Hooks cache the controller across unmounts. Reattaching that same controller
  // restores its pending draft through verify(); do not retain a second ghost
  // registration or let an old cleanup suspend the new view.
  for (const prior of entries)
    if (
      !prior.attached &&
      prior.controller.getSnapshot === entry.controller.getSnapshot &&
      prior.userId === entry.userId &&
      prior.sessionId === entry.sessionId &&
      prior.tenantId === entry.tenantId &&
      prior.projectId === entry.projectId
    )
      entries.delete(prior);
  const registered: RegisteredEntry = { ...entry, attached: true };
  entries.add(registered);
  return () => {
    if (!registered.attached) return;
    registered.attached = false;
    entry.controller.suspend();
    void entry.controller.settle().then(
      () => {
        const state = entry.controller.getSnapshot();
        const saved = "draftSaved" in state ? state.draftSaved : state.saved;
        if (!(entry.controller.hasUnretainedDraft?.() ?? !saved))
          entries.delete(registered);
      },
      () => {
        /* A failed drain stays a barrier until this controller recovers. */
      },
    );
  };
}

import type { AssistantSession, AssistantState } from "./assistant-session";
import type { EditingAccessHint } from "./editing-access";
import { registerEditingSessions } from "./editing-lifecycle";
import { clearAssistantLocal } from "./assistant-storage";
type Entry = {
  controller: Pick<
    AssistantSession<unknown>,
    "suspend" | "verify" | "retire" | "settle"
  > & {
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
const entries = new Set<Entry>();
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

  // Inspect together after all waits. A later edit may have queued another write,
  // or an access refresh may have hidden a record while an earlier write settled.
  // Neither can authorize navigation from an older, successfully saved snapshot.
  const current = new Set([...waiting, ...[...entries].filter(inProject)]);
  for (const entry of current) {
    const state = entry.controller.getSnapshot();
    if (state.access !== "ready")
      throw new Error(
        "助手或创作输入尚未完成核对，请保留当前页面，核对后再切换。",
      );
    if (state.busy)
      throw new Error("助手或创作操作尚未结束，请保留当前输入，稍后再切换。");
    const saved = "draftSaved" in state ? state.draftSaved : state.saved;
    if (!saved)
      throw new Error("助手或创作输入尚未保留到本机，请先完成本机保存再切换。");
  }
}

const matches = (entry: Entry, hint: EditingAccessHint) =>
  entry.userId === hint.userId &&
  entry.sessionId === hint.sessionId &&
  (hint.kind === "session" ||
    (entry.tenantId === hint.tenantId && entry.projectId === hint.projectId));
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
  entries.add(entry);
  return () => {
    entry.controller.suspend();
    void entry.controller.settle().finally(() => entries.delete(entry));
  };
}

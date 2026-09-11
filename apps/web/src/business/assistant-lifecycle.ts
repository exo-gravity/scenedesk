import type { AssistantSession } from "./assistant-session";
import type { EditingAccessHint } from "./editing-access";
import { registerEditingSessions } from "./editing-lifecycle";
import { clearAssistantLocal } from "./assistant-storage";
type Entry = {
  controller: AssistantSession;
  userId: string;
  sessionId: string;
  tenantId: string;
  projectId: string;
};
const entries = new Set<Entry>();
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

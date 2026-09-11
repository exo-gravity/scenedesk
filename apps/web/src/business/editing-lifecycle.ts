import { clearEditingLocal } from "./editing-local";
import type { EditingAccessHint } from "./editing-access";

type EditingSessions = {
  suspendAccess(hint: EditingAccessHint): void;
  refreshAccess(hint: EditingAccessHint): Promise<void>;
  retireSession(hint: EditingAccessHint): Promise<void>;
  clearUser(userId: string, sessionId?: string): Promise<void>;
};
const sessions = new Set<EditingSessions>();
export function registerEditingSessions(registry: EditingSessions) {
  sessions.add(registry);
}
export function suspendEditingAccess(hint: EditingAccessHint) {
  for (const registry of sessions) registry.suspendAccess(hint);
}
export async function refreshEditingAccess(hint: EditingAccessHint) {
  await Promise.all([...sessions].map((r) => r.refreshAccess(hint)));
}
export async function retireEditingSession(hint: EditingAccessHint) {
  await Promise.all([...sessions].map((r) => r.retireSession(hint)));
}
export async function clearUserEditing(userId: string, sessionId?: string) {
  await Promise.all([...sessions].map((r) => r.clearUser(userId, sessionId)));
  await clearEditingLocal(userId, {}, sessionId);
}

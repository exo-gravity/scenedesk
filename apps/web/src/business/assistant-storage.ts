import type {
  AssistantDraft,
  AssistantRecord,
  AssistantStorage,
} from "./assistant-session";
import type { Schema } from "./api";
import { tabIdentity } from "./content-drafts";
let connection: Promise<IDBDatabase> | undefined;
function database() {
  return (connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("scenedesk-assistant", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("sessions");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error("助手的本机恢复存储不可用，请勿关闭当前输入。"));
  }));
}
export function assistantStorage<
  Draft = AssistantDraft,
  Request = Schema<"PlanInput">,
>(
  userId: string,
  path: string,
  sessionId: string,
): AssistantStorage<Draft, Request> {
  const key = tabIdentity().then((tab) =>
    JSON.stringify([userId, path, tab, sessionId]),
  );
  async function access(
    change?: { record: AssistantRecord<Draft, Request> } | { remove: true },
  ): Promise<AssistantRecord<Draft, Request> | undefined> {
    const [db, id] = await Promise.all([database(), key]);
    return new Promise((resolve, reject) => {
      const tx = db.transaction("sessions", change ? "readwrite" : "readonly"),
        store = tx.objectStore("sessions");
      const request = change
        ? "remove" in change
          ? store.delete(id)
          : store.put(change.record, id)
        : store.get(id);
      tx.oncomplete = () => resolve(change ? undefined : request.result);
      tx.onerror = tx.onabort = () =>
        reject(new Error("助手的本机恢复记录未保存，请保留当前页面。"));
    });
  }
  return {
    read: () => access(),
    write: async (record) => {
      await access({ record });
    },
    clear: async () => {
      await access({ remove: true });
    },
  };
}
export async function clearAssistantLocal(userId: string, sessionId?: string) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("sessions", "readwrite"),
      cursor = tx.objectStore("sessions").openCursor();
    cursor.onsuccess = () => {
      const row = cursor.result;
      if (!row) return;
      let key: unknown;
      try {
        key = JSON.parse(String(row.key));
      } catch {
        row.continue();
        return;
      }
      if (
        Array.isArray(key) &&
        key[0] === userId &&
        (!sessionId || key[3] === sessionId)
      )
        row.delete();
      row.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () =>
      reject(new Error("助手的本机内容尚未清理。"));
  });
}

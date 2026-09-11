import { tabIdentity } from "./content-drafts";
import type {
  ProjectCreationRecord,
  ProjectCreationStorage,
} from "./project-creation";
let connection: Promise<IDBDatabase> | undefined;
const queues = new Map<string, Promise<unknown>>();
function database() {
  return (connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("scenedesk-project-creation", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      connection = undefined;
      reject(new Error("项目的本机恢复存储不可用，请保留当前输入。"));
    };
  }));
}
/** The tab lock prevents copied tabs sharing a slot. A slot owner prevents late
 * writes from a closed editor/session overwriting its newly opened successor. */
export function projectCreationStorage(
  userId: string,
  tenantId: string,
): ProjectCreationStorage {
  const key = tabIdentity().then((tab) =>
    JSON.stringify([userId, tenantId, tab]),
  );
  const owner = crypto.randomUUID();
  let active = true,
    claimed = false;
  async function access(
    action: "read" | "write" | "clear",
    record?: ProjectCreationRecord,
  ): Promise<ProjectCreationRecord | undefined> {
    if (!active) throw new Error("原项目创建窗口已关闭。");
    const id = await key;
    const previous = queues.get(id) ?? Promise.resolve();
    const operation = previous
      .catch(() => {})
      .then(async () => {
        if (action === "read" && !active)
          throw new Error("原项目创建窗口已关闭。");
        const db = await database();
        if (action === "read" && !active)
          throw new Error("原项目创建窗口已关闭。");
        return new Promise<ProjectCreationRecord | undefined>(
          (resolve, reject) => {
            const tx = db.transaction("drafts", "readwrite", {
                durability: "strict",
              }),
              store = tx.objectStore("drafts"),
              request = store.get(id);
            let result: ProjectCreationRecord | undefined,
              failure: Error | undefined;
            request.onsuccess = () => {
              try {
                if (action === "read" && !active) {
                  tx.abort();
                  return;
                }
                const previous = request.result as
                  { owner: string; record?: ProjectCreationRecord } | undefined;
                if (
                  (action !== "read" && previous?.owner !== owner) ||
                  (action === "read" &&
                    claimed &&
                    previous &&
                    previous.owner !== owner)
                ) {
                  failure = new Error(
                    "本次创建已在重新打开的窗口继续，请关闭旧窗口后恢复。",
                  );
                  tx.abort();
                  return;
                }
                result = previous?.record;
                if (action === "read")
                  store.put(
                    { owner, ...(result ? { record: result } : {}) },
                    id,
                  );
                else if (action === "clear") store.delete(id);
                else store.put({ owner, record }, id);
              } catch (error) {
                failure =
                  error instanceof Error ? error : new Error("本机存储失败。");
                tx.abort();
              }
            };
            tx.oncomplete = () => {
              if (action === "read") claimed = true;
              resolve(result);
            };
            tx.onerror = tx.onabort = () =>
              reject(
                failure ??
                  new Error("项目本机记录未完成保存，请保留当前输入并重试。"),
              );
          },
        );
      });
    queues.set(id, operation);
    void operation
      .finally(() => {
        if (queues.get(id) === operation) queues.delete(id);
      })
      .catch(() => {});
    return operation;
  }
  return {
    read: () => access("read"),
    close: () => {
      active = false;
    },
    write: async (record) => {
      await access("write", record);
    },
    clear: async () => {
      await access("clear");
    },
  };
}

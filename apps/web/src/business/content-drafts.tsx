import { useEffect, useRef, useState } from "react";
import { Alert, Button, Group, Text } from "@mantine/core";
import { useSession } from "./api";

type LocalDraft<T> = { value: T; baseVersion: number; savedAt: string };
const receiptKey = (key: string) => `scenedesk-draft-committed:${key}`;
let connection: Promise<IDBDatabase> | undefined;
function database() {
  return (connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("scenedesk-content-drafts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
async function storage<T>(
  key: string,
  change?: { value: LocalDraft<T> } | { remove: true },
): Promise<LocalDraft<T> | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("drafts", change ? "readwrite" : "readonly"),
      store = tx.objectStore("drafts");
    const request = !change
      ? store.get(key)
      : "remove" in change
        ? store.delete(key)
        : store.put(change.value, key);
    tx.oncomplete = () => resolve(request.result as LocalDraft<T> | undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export function tabIdentity(): Promise<string> {
  // sessionStorage is copied when a tab is duplicated. An origin-scoped browser
  // lock proves this document owns the ID; another live document gets a fresh ID.
  // Keep the promise on the document through development hot reloads as well.
  const documentState = globalThis as typeof globalThis & {
    __scenedeskDraftTab?: Promise<string>;
  };
  return (documentState.__scenedeskDraftTab ??= new Promise(
    (resolve, reject) => {
      if (!navigator.locks) {
        reject(new Error("Independent tab draft storage is unavailable"));
        return;
      }
      const hold = (id: string) => {
        void navigator.locks
          .request(
            `scenedesk-content-tab:${id}`,
            { ifAvailable: true },
            (lock) => {
              if (!lock) {
                hold(crypto.randomUUID());
                return;
              }
              sessionStorage.setItem("scenedesk-content-tab", id);
              resolve(id);
              // Released by the browser when this document ends, including reload.
              return new Promise<void>(() => {});
            },
          )
          .catch(reject);
      };
      try {
        hold(
          sessionStorage.getItem("scenedesk-content-tab") ??
            crypto.randomUUID(),
        );
      } catch (error) {
        reject(error);
      }
    },
  ));
}
export function useContentDraft<T>(
  path: string,
  initial: T,
  version: number,
  initialValue: T = initial,
) {
  const session = useSession();
  const [key, setKey] = useState<string>();
  const [value, setValue] = useState(initialValue),
    [baseVersion, setBaseVersion] = useState(version);
  const original = useRef(JSON.stringify(initial));
  const [recovered, setRecovered] = useState<LocalDraft<T>>(),
    [ready, setReady] = useState(false),
    [error, setError] = useState(false),
    [saved, setSaved] = useState(false);
  const [completion, setCompletion] = useState<"idle" | "pending" | "failed">(
    "idle",
  );
  const [destination, setDestination] = useState<"server" | "local">("server");
  const afterCompletion = useRef<(() => void) | undefined>(undefined);
  const cleaning = useRef<Promise<void> | undefined>(undefined);
  const latest = useRef({ initial, version });
  latest.current = { initial, version };
  const active = useRef(true),
    queue = useRef(Promise.resolve());
  const dirty = JSON.stringify(value) !== original.current;
  useEffect(() => {
    let live = true;
    let received = false;
    tabIdentity()
      .then(async (id) => {
        const key = JSON.stringify([session.userId, path, id]);
        if (live) setKey(key);
        const receipt = sessionStorage.getItem(receiptKey(key));
        received = receipt === "1" || receipt === "local";
        if (received) {
          active.current = false;
          if (live) {
            setDestination(receipt === "local" ? "local" : "server");
            setCompletion("pending");
          }
          await storage(key, { remove: true });
          sessionStorage.removeItem(receiptKey(key));
          if (live) {
            active.current = true;
            setCompletion("idle");
          }
          return undefined;
        }
        return storage<T>(key);
      })
      .then((found) => {
        if (live) {
          setRecovered(found);
          setReady(true);
        }
      })
      .catch(() => {
        if (live) {
          setError(true);
          if (received) setCompletion("failed");
          setReady(true);
        }
      });
    return () => {
      live = false;
    };
  }, [session.userId, path]);
  useEffect(() => {
    if (!key || !ready || recovered || !active.current) return;
    setSaved(false);
    let current = true;
    queue.current = queue.current
      .then(() =>
        storage(
          key,
          dirty
            ? {
                value: {
                  value,
                  baseVersion,
                  savedAt: new Date().toISOString(),
                },
              }
            : { remove: true },
        ),
      )
      .then(() => {
        if (current) setSaved(true);
      })
      .catch(() => {
        if (current) setError(true);
      });
    return () => {
      current = false;
    };
  }, [key, ready, recovered, dirty, value, baseVersion]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty && (!saved || error)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saved, error]);
  const cleanCommitted = () => {
    if (cleaning.current) return cleaning.current;
    setCompletion("pending");
    const run = queue.current.then(async () => {
      if (key) {
        await storage(key, { remove: true });
        sessionStorage.removeItem(receiptKey(key));
      }
    });
    // Keep later storage work usable after an abort; completion has its own
    // state and never turns a storage failure into another business submission.
    queue.current = run.catch(() => {});
    cleaning.current = run
      .then(() => {
        setRecovered(undefined);
        setError(false);
        setCompletion("idle");
        const after = afterCompletion.current;
        afterCompletion.current = undefined;
        if (after) after();
        else {
          const current = latest.current;
          original.current = JSON.stringify(current.initial);
          setValue(current.initial);
          setBaseVersion(current.version);
          active.current = true;
        }
      })
      .catch(() => setCompletion("failed"))
      .finally(() => {
        cleaning.current = undefined;
      });
    return cleaning.current;
  };
  const complete = (
    after?: () => void,
    destination: "server" | "local" = "server",
  ) => {
    active.current = false;
    afterCompletion.current = after;
    setDestination(destination);
    // This small receipt survives refresh independently of a failing IDB delete.
    // It contains no input or response body and is scoped to this user's tab.
    try {
      if (key)
        sessionStorage.setItem(
          receiptKey(key),
          destination === "local" ? "local" : "1",
        );
    } catch {
      // In-memory completion still prevents resubmission in this document.
    }
    return cleanCommitted();
  };
  const stage = async (next: T, nextBaseVersion = baseVersion) => {
    if (!key || !ready || recovered || !active.current) {
      setError(true);
      return false;
    }
    const write = queue.current.then(() =>
      storage(key, {
        value: {
          value: next,
          baseVersion: nextBaseVersion,
          savedAt: new Date().toISOString(),
        },
      }),
    );
    queue.current = write.then(() => {}).catch(() => {});
    try {
      await write;
      setValue(next);
      setBaseVersion(nextBaseVersion);
      setSaved(true);
      setError(false);
      return true;
    } catch {
      setError(true);
      return false;
    }
  };
  // Local-only editors have not committed a business command. Do not create a
  // server receipt for a cancelled or staged proposal operation.
  const clear = async () => {
    active.current = false;
    try {
      await queue.current;
      if (key) await storage(key, { remove: true });
      return true;
    } catch {
      active.current = true;
      setError(true);
      return false;
    }
  };
  return {
    value,
    setValue,
    baseVersion,
    rebase: () => setBaseVersion(version),
    dirty,
    ready: ready && completion === "idle",
    error,
    saved,
    recovered,
    complete,
    stage,
    clear,
    committed: completion !== "idle",
    completion,
    destination,
    retryCompletion: cleanCommitted,
    restore: () => {
      if (recovered) {
        setValue(recovered.value);
        setBaseVersion(recovered.baseVersion);
        setRecovered(undefined);
      }
    },
    discard: () => {
      if (!key) {
        setError(true);
        return;
      }
      queue.current = queue.current
        .then(() => storage(key, { remove: true }))
        .then(() => {
          setRecovered(undefined);
          setError(false);
        })
        .catch(() => setError(true));
    },
  };
}
export function DraftNotice({
  draft,
  pendingCreation = false,
}: {
  draft: ReturnType<typeof useContentDraft<any>>;
  pendingCreation?: boolean;
}) {
  if (draft.committed)
    return (
      <Alert
        title={
          draft.destination === "server"
            ? "服务器已保存"
            : "已保留到本地提案草稿"
        }
      >
        <Text>
          {draft.destination === "local"
            ? draft.completion === "failed"
              ? "本项修改已保留到本地提案，尚未提交服务器。子草稿清理失败，可以重试清理。"
              : "本项修改已保留到本地提案，正在清理子草稿…"
            : draft.completion === "failed"
              ? "本地草稿清理失败。内容已经保存，请只重试清理；这不会再次提交内容。"
              : "正在清理已提交的本地草稿…"}
        </Text>
        {draft.completion === "failed" && (
          <Button mt="md" onClick={() => void draft.retryCompletion()}>
            重试清理本地草稿
          </Button>
        )}
      </Alert>
    );
  if (draft.recovered)
    return (
      <Alert
        title={
          pendingCreation ? "发现待确认的创建请求" : "发现本标签页未提交的内容"
        }
      >
        <Text>
          本地保存于 {new Date(draft.recovered.savedAt).toLocaleString()}
          {pendingCreation
            ? "。原请求可能已提交成功。恢复记录后，只能明确核对同一次创建。"
            : "。恢复后仍需核对服务器版本并提交。"}
        </Text>
        {draft.error && (
          <Text c="red">本地草稿操作失败，这份记录仍保留，可以重新恢复。</Text>
        )}
        <Group mt="md">
          <Button onClick={draft.restore}>
            {pendingCreation ? "恢复创建记录" : "恢复未提交内容"}
          </Button>
          {!pendingCreation && (
            <Button variant="subtle" onClick={draft.discard}>
              放弃这份本地草稿
            </Button>
          )}
        </Group>
      </Alert>
    );
  if (draft.error)
    return (
      <Alert title="本地保存不可用">请在离开页面前提交或复制当前内容。</Alert>
    );
  return (
    <Text size="xs" c="dimmed" aria-live="polite">
      {!draft.ready
        ? "正在检查本地草稿…"
        : draft.dirty
          ? draft.saved
            ? pendingCreation
              ? "原创建请求已保存在本标签页，结果以服务器核对为准。"
              : "修改已保存在本标签页，尚未提交。"
            : "正在保存本地修改…"
          : "修改后可保存；关闭面板会保留本地草稿。"}
    </Text>
  );
}

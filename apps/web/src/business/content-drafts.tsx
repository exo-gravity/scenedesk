import { useEffect, useRef, useState } from "react";
import { Alert, Button, Group, Text } from "@mantine/core";
import { useSession } from "./api";

type LocalDraft<T> = { value: T; baseVersion: number; savedAt: string };
let connection: Promise<IDBDatabase> | undefined;
const unavailableTabId = crypto.randomUUID();
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
function tabIdentity() {
  try {
    const old = sessionStorage.getItem("scenedesk-content-tab");
    if (old) return old;
    const id = crypto.randomUUID();
    sessionStorage.setItem("scenedesk-content-tab", id);
    return id;
  } catch {
    return unavailableTabId;
  }
}
export function useContentDraft<T>(path: string, initial: T, version: number) {
  const session = useSession();
  const [key] = useState(() =>
    JSON.stringify([session.userId, path, tabIdentity()]),
  );
  const [value, setValue] = useState(initial),
    [baseVersion, setBaseVersion] = useState(version);
  const original = useRef(JSON.stringify(initial));
  const [recovered, setRecovered] = useState<LocalDraft<T>>(),
    [ready, setReady] = useState(false),
    [error, setError] = useState(false),
    [saved, setSaved] = useState(false);
  const active = useRef(true),
    queue = useRef(Promise.resolve());
  const dirty = JSON.stringify(value) !== original.current;
  useEffect(() => {
    let live = true;
    storage<T>(key)
      .then((found) => {
        if (live) {
          setRecovered(found);
          setReady(true);
        }
      })
      .catch(() => {
        if (live) {
          setError(true);
          setReady(true);
        }
      });
    return () => {
      live = false;
    };
  }, [key]);
  useEffect(() => {
    if (!ready || recovered || !active.current) return;
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
  const clear = () => {
    active.current = false;
    queue.current = queue.current
      .then(() => storage(key, { remove: true }))
      .then(() => {})
      .catch(() => setError(true));
    return queue.current;
  };
  return {
    value,
    setValue,
    baseVersion,
    rebase: () => setBaseVersion(version),
    dirty,
    ready,
    error,
    saved,
    recovered,
    clear,
    restore: () => {
      if (recovered) {
        setValue(recovered.value);
        setBaseVersion(recovered.baseVersion);
        setRecovered(undefined);
      }
    },
    discard: () => {
      setRecovered(undefined);
      queue.current = queue.current
        .then(() => storage(key, { remove: true }))
        .then(() => {})
        .catch(() => setError(true));
    },
  };
}
export function DraftNotice({
  draft,
}: {
  draft: ReturnType<typeof useContentDraft<any>>;
}) {
  if (draft.recovered)
    return (
      <Alert title="发现本标签页未提交的内容">
        <Text>
          本地保存于 {new Date(draft.recovered.savedAt).toLocaleString()}
          。恢复后仍需核对服务器版本并提交。
        </Text>
        <Group mt="md">
          <Button onClick={draft.restore}>恢复未提交内容</Button>
          <Button variant="subtle" onClick={draft.discard}>
            放弃这份本地草稿
          </Button>
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
            ? "修改已保存在本标签页，尚未提交。"
            : "正在保存本地修改…"
          : "修改后可保存；关闭面板会保留本地草稿。"}
    </Text>
  );
}

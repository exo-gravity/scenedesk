import { editingCanonical } from "@drama/domain";

/** Local recovery only. Callers must authorize the object before displaying any
 * recovered value, and clear its partition immediately when access is lost. */
export type EditingPartition = Readonly<{
  userId: string;
  tenantId: string;
  projectId: string;
  kind: "cut_work_draft" | "canvas";
  objectId: string;
  clientSessionId: string;
}>;
export type EditingLocalCopy<T> = Readonly<{
  format: 1;
  version: number;
  token: string;
  savedAt: number;
  value: T;
}>;
export type EditingLocalMetadata = EditingPartition & {
  key: string;
  version: number;
  token: string;
  savedAt: number;
  bytes: number;
};
export const EDITING_LOCAL_POLICY = Object.freeze({ days: 7, copies: 20 });
export class EditingLocalError extends Error {
  constructor(
    readonly code: "capacity" | "conflict" | "corrupt" | "unavailable",
    message: string,
  ) {
    super(message);
  }
}
const ttl = EDITING_LOCAL_POLICY.days * 24 * 60 * 60 * 1000;
let connection: Promise<IDBDatabase> | undefined;
function open() {
  if (!connection) {
    const attempt = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("scenedesk-editing-recovery", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("copies");
        const metadata = request.result.createObjectStore("metadata", {
          keyPath: "key",
        });
        metadata.createIndex("user", "userId");
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(
          new EditingLocalError(
            "unavailable",
            "本机恢复存储被其他页面占用，请关闭旧页面后重试。",
          ),
        );
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          connection = undefined;
        };
        resolve(db);
      };
    });
    connection = attempt.catch((error) => {
      connection = undefined;
      throw error;
    });
  }
  return connection;
}
function partitionKey(partition: EditingPartition) {
  return JSON.stringify([
    partition.userId,
    partition.tenantId,
    partition.projectId,
    partition.kind,
    partition.objectId,
    partition.clientSessionId,
  ]);
}
function complete<T>(
  tx: IDBTransaction,
  result: () => T,
  failure: () => Error | undefined = () => undefined,
) {
  return new Promise<T>((resolve, reject) => {
    tx.oncomplete = () => resolve(result());
    tx.onabort = () =>
      reject(
        failure() ??
          tx.error ??
          new EditingLocalError(
            "unavailable",
            "本机恢复写入中断，请保留当前页面并重试。",
          ),
      );
    tx.onerror = () => {
      /* onabort is the final transaction outcome. */
    };
  });
}

export async function loadEditingLocal<T>(
  partition: EditingPartition,
): Promise<EditingLocalCopy<T> | undefined> {
  const db = await open(),
    tx = db.transaction(["copies", "metadata"], "readonly"),
    key = partitionKey(partition);
  const body = tx.objectStore("copies").get(key),
    header = tx.objectStore("metadata").get(key);
  await complete(tx, () => undefined);
  const metadata = header.result as EditingLocalMetadata | undefined;
  if (!metadata || metadata.savedAt < Date.now() - ttl) return undefined;
  const value = body.result as EditingLocalCopy<T> | undefined;
  if (
    !value ||
    value.format !== 1 ||
    value.version !== metadata.version ||
    value.token !== metadata.token ||
    value.savedAt !== metadata.savedAt
  )
    throw new EditingLocalError(
      "corrupt",
      "本机恢复记录不完整，请保留当前输入并检查其他恢复点。",
    );
  return value;
}

/** Header-only enumeration keeps twenty potentially large documents out of RAM. */
export async function listEditingLocal(userId: string) {
  const db = await open(),
    tx = db.transaction("metadata", "readonly");
  const request = tx
    .objectStore("metadata")
    .index("user")
    .getAll(IDBKeyRange.only(userId));
  await complete(tx, () => undefined);
  const copies = (request.result as EditingLocalMetadata[])
    .filter((r) => r.savedAt >= Date.now() - ttl)
    .sort((a, b) => b.savedAt - a.savedAt || a.key.localeCompare(b.key));
  return {
    copies,
    bytes: copies.reduce((sum, c) => sum + c.bytes, 0),
    policy: EDITING_LOCAL_POLICY,
  };
}

/** Local CAS prevents a late completion cleanup from deleting newer edits. The
 * caller serializes edits for its own tab; other tabs have independent keys. */
export async function saveEditingLocal<T>(
  partition: EditingPartition,
  value: T,
  expectedToken: string | undefined,
) {
  const encoded = editingCanonical(value);
  const bytes = new TextEncoder().encode(encoded).byteLength;
  // Store JSON values only: never File/Blob handles or response objects.
  const jsonValue = JSON.parse(encoded) as T;
  const db = await open(),
    tx = db.transaction(["copies", "metadata"], "readwrite"),
    key = partitionKey(partition),
    now = Date.now();
  const copies = tx.objectStore("copies"),
    metadata = tx.objectStore("metadata");
  const request = metadata
    .index("user")
    .getAll(IDBKeyRange.only(partition.userId));
  let failure: Error | undefined, saved: EditingLocalCopy<T>;
  const finished = complete(
    tx,
    () => saved!,
    () => failure,
  );
  request.onsuccess = () => {
    const records = request.result as EditingLocalMetadata[],
      current = records.find((r) => r.key === key && r.savedAt >= now - ttl);
    if (current?.token !== expectedToken) {
      failure = new EditingLocalError(
        "conflict",
        "这份本机副本已变化，请重新读取后核对。",
      );
      tx.abort();
      return;
    }
    const retained = records.filter((r) => r.savedAt >= now - ttl);
    if (!current && retained.length >= EDITING_LOCAL_POLICY.copies) {
      // A twenty-first document must not silently delete somebody's unsent work.
      failure = new EditingLocalError(
        "capacity",
        "本用户已有 20 份本机恢复副本，请检查并清理不再需要的副本后重试。",
      );
      tx.abort();
      return;
    }
    for (const expired of records.filter((r) => r.savedAt < now - ttl)) {
      copies.delete(expired.key);
      metadata.delete(expired.key);
    }
    saved = {
      format: 1,
      version: (current?.version ?? 0) + 1,
      token: crypto.randomUUID(),
      savedAt: now,
      value: jsonValue,
    };
    copies.put(saved, key);
    metadata.put({
      ...partition,
      key,
      version: saved.version,
      token: saved.token,
      savedAt: now,
      bytes,
    } satisfies EditingLocalMetadata);
  };
  return finished;
}

export async function removeEditingLocal(
  partition: EditingPartition,
  expectedToken: string,
) {
  const db = await open(),
    tx = db.transaction(["copies", "metadata"], "readwrite"),
    key = partitionKey(partition);
  const metadata = tx.objectStore("metadata"),
    request = metadata.get(key);
  let failure: Error | undefined;
  const finished = complete(
    tx,
    () => undefined,
    () => failure,
  );
  request.onsuccess = () => {
    const current = request.result as EditingLocalMetadata | undefined;
    if (current && current.token !== expectedToken) {
      failure = new EditingLocalError(
        "conflict",
        "已有更新的本机输入，不能按旧回执清理。",
      );
      tx.abort();
      return;
    }
    tx.objectStore("copies").delete(key);
    metadata.delete(key);
  };
  await finished;
}

/** Used by logout/revocation after stopping local writers; filters never cross
 * users. The caller also clears its in-memory editor and query cache. */
export async function clearEditingLocal(
  userId: string,
  scope: { tenantId?: string; projectId?: string; objectId?: string } = {},
) {
  const db = await open(),
    tx = db.transaction(["copies", "metadata"], "readwrite");
  const metadata = tx.objectStore("metadata"),
    request = metadata.index("user").getAll(IDBKeyRange.only(userId));
  const finished = complete(tx, () => undefined);
  request.onsuccess = () => {
    for (const row of request.result as EditingLocalMetadata[]) {
      if (
        Object.entries(scope).some(
          ([field, value]) =>
            row[field as keyof EditingLocalMetadata] !== value,
        )
      )
        continue;
      tx.objectStore("copies").delete(row.key);
      metadata.delete(row.key);
    }
  };
  await finished;
}

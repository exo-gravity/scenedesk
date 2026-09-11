import { api, type Schema, type Session } from "./api";

export type ImportRecord = {
  id: string;
  userId: string;
  scopeKey: string;
  createdAt: string;
  declaration: Schema<"UploadInput">;
  intentId?: string;
  transferred?: boolean;
  placementHandled?: boolean;
};
let connection: Promise<IDBDatabase> | undefined;
function database() {
  return (connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("scenedesk-media-imports", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("imports", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error("本机无法保存上传进度，请保留页面后重试。"));
  }));
}
export async function importRecords(userId: string, scopeKey: string) {
  const db = await database();
  return new Promise<ImportRecord[]>((resolve, reject) => {
    const tx = db.transaction("imports", "readwrite");
    const store = tx.objectStore("imports"),
      request = store.getAll();
    const expired = (record: ImportRecord) =>
      !Number.isFinite(Date.parse(record.createdAt)) ||
      Date.parse(record.createdAt) < Date.now() - 7 * 86400_000;
    request.onsuccess = () => {
      for (const record of request.result as ImportRecord[])
        if (record.userId === userId && expired(record))
          store.delete(record.id);
    };
    tx.oncomplete = () =>
      resolve(
        (request.result as ImportRecord[])
          .filter(
            (record) =>
              record.userId === userId &&
              record.scopeKey === scopeKey &&
              !expired(record),
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
    tx.onerror = tx.onabort = () => reject(new Error("本机上传记录读取失败。"));
  });
}
export async function saveImport(record: ImportRecord, remove = false) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("imports", "readwrite"),
      store = tx.objectStore("imports");
    if (remove) store.delete(record.id);
    else store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () =>
      reject(new Error("本机上传记录保存失败，请保留当前页面。"));
  });
}
const mimeByExtension: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  ogg: "audio/ogg",
  txt: "text/plain",
  srt: "application/x-subrip",
};
export const importAccept = Object.keys(mimeByExtension)
  .map((ext) => `.${ext}`)
  .join(",");
export function importMime(file: File) {
  const mime =
    mimeByExtension[file.name.split(".").at(-1)?.toLowerCase() ?? ""];
  if (!mime)
    throw new Error("请选择支持的图片、音视频、UTF-8 文本或 SRT 文件。");
  if (!file.size || file.size > 256 * 1024 * 1024)
    throw new Error("文件须大于 0 且不超过 256 MiB。");
  if (
    (mime === "text/plain" || mime === "application/x-subrip") &&
    file.size > 2 * 1024 * 1024
  )
    throw new Error("文本和 SRT 文件不能超过 2 MiB。");
  return mime;
}
export async function fileHash(file: File, signal: AbortSignal) {
  signal.throwIfAborted();
  const bytes = await file.arrayBuffer();
  signal.throwIfAborted();
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  signal.throwIfAborted();
  return Array.from(new Uint8Array(hash), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
export function mediaPost<T>(
  session: Session,
  path: string,
  body: unknown,
  signal?: AbortSignal,
  key: string = crypto.randomUUID(),
) {
  return api<T>(path, {
    method: "POST",
    ...(signal ? { signal } : {}),
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      "X-CSRF-Token": session.csrfToken,
      "Idempotency-Key": key,
    },
    body: JSON.stringify(body),
  });
}

/** One resumable upload protocol shared by the asset library and canvas. The
 * durable declaration/request identity is stored before any external write. */
export async function resumeMediaImport({
  initial,
  selected,
  session,
  path,
  signal,
  store,
  phase,
  progress,
}: {
  initial: ImportRecord;
  selected: File | null;
  session: Session;
  path: string;
  signal: AbortSignal;
  store: (record: ImportRecord) => Promise<void>;
  phase: (value: string) => void;
  progress: (value: number) => void;
}) {
  let record = initial;
  if (selected) {
    phase("正在核对文件");
    importMime(selected);
    if (
      selected.size !== record.declaration.bytes ||
      (await fileHash(selected, signal)) !== record.declaration.sha256
    )
      throw new Error(
        "所选文件与本次上传的原声明不同，请选择原文件；更换内容应新建导入。",
      );
  }
  signal.throwIfAborted();
  phase("正在读取上传状态");
  if (!record.intentId) {
    if (Date.parse(record.createdAt) < Date.now() - 15 * 60_000)
      throw new Error("本次上传创建确认已过期，请新建导入。");
    const created = await mediaPost<Schema<"UploadIntent">>(
      session,
      `${path}/uploads`,
      record.declaration,
      signal,
      record.id,
    );
    record = { ...record, intentId: created.id };
    await store(record);
  }
  const intent = await api<Schema<"UploadIntent">>(
    `${path}/uploads/${record.intentId}`,
    { signal },
  );
  if (["expired", "rejected"].includes(intent.status))
    throw new Error(
      intent.issue?.message ?? "本次上传已结束，请重新导入文件。",
    );
  if (intent.status === "accepted") return { record, intent };
  if (intent.status === "pending" && !record.transferred) {
    if (!selected) throw new Error("请选择原文件，核对后继续上传。");
    phase("正在上传文件");
    await transferFile(selected, intent, signal, progress);
    record = { ...record, transferred: true };
    await store(record);
  }
  signal.throwIfAborted();
  phase("正在提交验收");
  const submitted = await mediaPost<Schema<"UploadIntent">>(
    session,
    `${path}/uploads/${record.intentId}/complete`,
    { bytes: record.declaration.bytes, sha256: record.declaration.sha256 },
    signal,
  );
  return { record, intent: submitted };
}
export function transferFile(
  file: File,
  intent: Schema<"UploadIntent">,
  signal: AbortSignal,
  progress: (percent: number) => void,
) {
  if (!intent.uploadUrl || intent.method !== "POST" || !intent.formFields)
    throw new Error("上传凭证不可用，请重新读取上传状态。");
  return new Promise<void>((resolve, reject) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(intent.formFields!))
      form.append(key, value);
    form.append("file", file, file.name);
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const finish = (error?: Error) => {
      signal.removeEventListener("abort", abort);
      error ? reject(error) : resolve();
    };
    request.open("POST", intent.uploadUrl!);
    request.timeout = 15 * 60_000;
    request.withCredentials = false;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        progress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () =>
      finish(
        request.status === 204
          ? undefined
          : new Error("存储未确认上传。凭证可能已过期，请读取状态后重试。"),
      );
    request.onerror = () =>
      finish(new Error("上传连接中断，恢复后可重新选择同一文件续办。"));
    request.ontimeout = () =>
      finish(new Error("上传已超时，请读取状态后继续。"));
    request.onabort = () =>
      finish(new DOMException("上传已暂停，本机记录已保留。", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      finish(new DOMException("上传已暂停。", "AbortError"));
      return;
    }
    request.send(form);
  });
}

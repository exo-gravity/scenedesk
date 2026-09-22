import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  FileButton,
  Group,
  Progress,
  Stack,
  Text,
} from "@mantine/core";
import { inspectCanvasDocument, type CanvasNode } from "@drama/domain";
import { defaultCardWidth } from "./canvas-card-frame";
import { api, ApiError, useSession, type Schema } from "./api";
import type { CanvasController } from "./canvas-controller";
import {
  fileHash,
  importAccept,
  importMime,
  importRecords,
  mediaPost,
  resumeMediaImport,
  saveImport,
  type ImportRecord,
} from "./media-imports";
import { ErrorNotice } from "./common";
import classes from "./canvas-uploads.module.css";

type Point = Schema<"CanvasPoint">;
type Entry = Schema<"CanvasUpload">;
export type CanvasUploadRow = {
  id: string;
  title: string;
  position: Point;
  record?: ImportRecord;
  entry?: Entry;
  phase?: string | undefined;
  progress?: number;
  error?: Error | undefined;
};
type Uploads = {
  rows: CanvasUploadRow[];
  busy: boolean;
  readOnly: boolean;
  loading: boolean;
  error: Error | null;
  retry: () => void;
  begin: (files: File[], point: Point) => void;
  resume: (row: CanvasUploadRow, file: File | null) => void;
  place: (row: CanvasUploadRow) => void;
  dismiss: (row: CanvasUploadRow) => void;
  pause: () => void;
};
const Context = createContext<Uploads | null>(null);
export const useCanvasUploads = () => useContext(Context);
const labels: Record<Schema<"UploadIntent">["status"], string> = {
  pending: "等待上传",
  uploaded: "等待处理",
  verifying: "正在处理",
  accepted: "已导入 · 待添加到画布",
  rejected: "导入失败",
  expired: "上传已过期",
};

export function CanvasUploads({
  controller,
  tenantId,
  projectId,
  canvasId,
  readOnly,
  children,
}: {
  controller: CanvasController;
  tenantId: string;
  projectId: string;
  canvasId: string;
  readOnly: boolean;
  children: ReactNode;
}) {
  const session = useSession();
  const mediaPath = `/v1/tenants/${tenantId}`,
    path = `${mediaPath}/projects/${projectId}/canvases/${canvasId}`;
  const scopeKey = `canvas:${tenantId}:${projectId}:${canvasId}`;
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const [records, setRecords] = useState<ImportRecord[]>([]),
    [loaded, setLoaded] = useState(false),
    [loadAttempt, setLoadAttempt] = useState(0),
    [error, setError] = useState<Error | null>(null);
  const [staged, setStaged] = useState<CanvasUploadRow[]>([]),
    [details, setDetails] = useState<Record<string, Partial<CanvasUploadRow>>>(
      {},
    );
  const [busy, setBusy] = useState(false);
  const current = useRef<AbortController | null>(null),
    mounted = useRef(true),
    recordMap = useRef(new Map<string, ImportRecord>());
  const blocked = useRef(readOnly);
  blocked.current = readOnly;
  const pending = useQuery({
    queryKey: ["user", session.userId, `${path}/uploads`],
    queryFn: ({ signal }) =>
      api<Schema<"CanvasUploadPage">>(`${path}/uploads`, { signal }),
    refetchInterval: 2500,
  });
  useEffect(() => {
    let live = true;
    mounted.current = true;
    importRecords(session.userId, scopeKey)
      .then(async (found) => {
        found = await Promise.all(
          found.map(async (record) => {
            if (record.intentId) return record;
            try {
              const entry = await api<Entry>(
                `${path}/uploads/by-request/${record.id}`,
              );
              const restored = { ...record, intentId: entry.upload.id };
              await saveImport(restored);
              return restored;
            } catch (reason) {
              if (
                reason instanceof ApiError &&
                reason.code === "CANVAS_UPLOAD_REQUEST_MISSING"
              )
                return record;
              throw reason;
            }
          }),
        );
        if (!live) return;
        recordMap.current = new Map(found.map((record) => [record.id, record]));
        setRecords(found);
        setLoaded(true);
      })
      .catch((reason) => {
        if (live) setError(reason);
      });
    return () => {
      live = false;
      mounted.current = false;
      current.current?.abort();
    };
  }, [session.id, session.userId, scopeKey, loadAttempt]);
  useEffect(() => {
    if (!pending.isSuccess || state.dirty || !state.local) return;
    let live = true;
    const candidates = records.filter(
      (record) =>
        record.intentId &&
        !pending.data.items.some(
          (entry) => entry.upload.id === record.intentId,
        ),
    );
    void Promise.all(
      candidates.map(async (record) => {
        try {
          const entry = await api<Entry>(`${path}/uploads/${record.intentId}`);
          if (!live || (!entry.placed && !entry.dismissed)) return;
          await saveImport(record, true);
          if (live) {
            recordMap.current.delete(record.id);
            setRecords([...recordMap.current.values()]);
          }
        } catch {
          /* Keep recovery metadata until the server confirms its disposition. */
        }
      }),
    );
    return () => {
      live = false;
    };
  }, [
    pending.data,
    pending.isSuccess,
    records,
    state.dirty,
    state.local?.base.revision,
    path,
  ]);
  useEffect(() => {
    if (readOnly) current.current?.abort();
  }, [readOnly]);
  const store = async (record: ImportRecord) => {
    await saveImport(record);
    if (!mounted.current) return;
    recordMap.current.set(record.id, record);
    setRecords([...recordMap.current.values()]);
    if (record.intentId) void pending.refetch();
  };
  const update = (id: string, patch: Partial<CanvasUploadRow>) => {
    if (mounted.current)
      setDetails((previous) => ({
        ...previous,
        [id]: { ...previous[id], ...patch },
      }));
  };
  const fresh = (id: string, signal: AbortSignal) =>
    api<Entry>(`${path}/uploads/${id}`, { signal });
  const inputFor = (row: CanvasUploadRow): ImportRecord =>
    row.record
      ? {
          ...row.record,
          ...(!row.record.intentId && row.entry
            ? { intentId: row.entry.upload.id }
            : {}),
        }
      : {
          id: crypto.randomUUID(),
          userId: session.userId,
          scopeKey,
          createdAt: new Date().toISOString(),
          declaration: row.entry!.declaration,
          intentId: row.entry!.upload.id,
        };
  const canPlace = () => {
    const now = controller.getSnapshot();
    if (
      blocked.current ||
      !mounted.current ||
      !now.local ||
      now.accessChecking ||
      now.recovery ||
      now.recoveryBlocked ||
      [
        "forbidden",
        "loading",
        "discarding",
        "conflict",
        "checking",
        "error",
      ].includes(now.phase)
    )
      throw new Error("文件仍保留，请完成画布恢复或权限核对后再放入。");
    return now.local.document;
  };
  async function place(
    record: ImportRecord,
    signal: AbortSignal,
    automatic = false,
  ) {
    if (automatic && recordMap.current.get(record.id)?.placementHandled) return;
    let entry = await fresh(record.intentId!, signal);
    if (entry.dismissed || entry.placed) return;
    if (entry.upload.status !== "accepted" || !entry.upload.mediaId)
      throw new Error("文件尚未通过验收，暂不能作为画布素材。");
    const media = await api<Schema<"Media">>(
      `${mediaPath}/media/${entry.upload.mediaId}`,
      { signal },
    );
    if (media.status !== "ready" || media.kind === "document")
      throw new Error("这份文件当前不能放入画布，请查看素材状态。");
    canPlace();
    // Persist the one-shot decision before editing. A crash in either direction
    // leaves an explicit recovery action, never an automatic duplicate after undo.
    await store({ ...record, placementHandled: true });
    entry = await fresh(record.intentId!, signal);
    signal.throwIfAborted();
    if (entry.dismissed || entry.placed) return;
    const document = canPlace();
    if (document.nodes.some((node) => node.id === entry.nodeId)) return;
    const node: CanvasNode = {
      id: entry.nodeId,
      title: media.displayName,
      kind: media.kind,
      width: defaultCardWidth(
        media.kind,
        media.width && media.height ? { width: media.width, height: media.height } : null,
      ),
      position: entry.position,
      content: { type: "media", mediaId: media.id },
    };
    const next = { ...document, nodes: [...document.nodes, node] };
    inspectCanvasDocument(next);
    controller.change(next);
    if (
      !controller
        .getSnapshot()
        .local?.document.nodes.some((item) => item.id === node.id)
    )
      throw new Error("素材已导入，当前画布未接受修改，请完成恢复后再放入。");
  }
  const wait = async (signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException("上传已暂停。", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, 2500);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  async function run(
    record: ImportRecord,
    file: File | null,
    signal: AbortSignal,
  ) {
    update(record.id, { error: undefined, progress: 0 });
    if (!record.intentId) {
      try {
        const entry = await api<Entry>(
          `${path}/uploads/by-request/${record.id}`,
          { signal },
        );
        record = { ...record, intentId: entry.upload.id };
      } catch (reason) {
        if (!(
          reason instanceof ApiError &&
          reason.code === "CANVAS_UPLOAD_REQUEST_MISSING"
        ))
          throw reason;
      }
    }
    await store(record);
    const submitted = await resumeMediaImport({
      initial: record,
      selected: file,
      session,
      path: mediaPath,
      signal,
      store,
      phase: (value) => update(record.id, { phase: value }),
      progress: (value) => update(record.id, { progress: value }),
    });
    record = submitted.record;
    for (;;) {
      signal.throwIfAborted();
      const entry = await fresh(record.intentId!, signal);
      update(record.id, { entry, phase: labels[entry.upload.status] });
      if (entry.dismissed || entry.placed) break;
      if (entry.upload.status === "accepted") {
        await place(record, signal, true);
        break;
      }
      if (
        ["expired", "rejected"].includes(entry.upload.status) ||
        entry.upload.issue?.retryable
      )
        throw new Error(
          entry.upload.issue?.message ?? "文件处理未完成，请核对状态后继续。",
        );
      await wait(signal);
    }
    update(record.id, { phase: undefined });
  }
  async function task(work: (signal: AbortSignal) => Promise<void>) {
    if (current.current || blocked.current || !loaded) return;
    const abort = new AbortController();
    current.current = abort;
    setBusy(true);
    setError(null);
    try {
      await work(abort.signal);
    } catch (reason) {
      if (mounted.current) setError(reason as Error);
    } finally {
      if (current.current === abort) current.current = null;
      if (mounted.current) {
        setBusy(false);
        void pending.refetch();
      }
    }
  }
  const resume = (row: CanvasUploadRow, file: File | null) =>
    void task(async (signal) => {
      const record = inputFor(row);
      try {
        await run(record, file, signal);
      } catch (reason) {
        update(record.id, { phase: undefined, error: reason as Error });
        throw reason;
      }
    });
  const begin = (files: File[], point: Point) =>
    void task(async (signal) => {
      if (!files.length) return;
      if (files.length + rows.length > 20)
        throw new Error("请先处理现有文件；一次最多保留 20 份待处理导入。");
      const queue = files.map((file, index) => {
        const mime = importMime(file);
        if (!/^(image|video|audio)\//.test(mime))
          throw new Error(
            "画布支持拖入图片、视频和声音，文本文件请从素材库导入。",
          );
        if (Array.from(file.name).length > 160)
          throw new Error("文件名不能超过 160 个字。");
        const position = {
          x: Math.max(-1000000, Math.min(1000000, point.x + index * 36)),
          y: Math.max(-1000000, Math.min(1000000, point.y + index * 24)),
        };
        return { file, mime, position, id: crypto.randomUUID() };
      });
      setStaged(
        queue.map((item) => ({
          id: item.id,
          title: item.file.name,
          position: item.position,
          phase: "等待核对文件",
        })),
      );
      const prepared: { record: ImportRecord; file: File }[] = [];
      try {
        for (const item of queue) {
          update(item.id, { phase: "正在核对文件" });
          const record: ImportRecord = {
            id: item.id,
            userId: session.userId,
            scopeKey,
            createdAt: new Date().toISOString(),
            declaration: {
              scope: "project",
              projectId,
              fileName: item.file.name,
              displayName: item.file.name,
              bytes: item.file.size,
              mime: item.mime,
              sha256: await fileHash(item.file, signal),
              canvasTarget: {
                canvasId,
                clientRequestId: item.id,
                position: item.position,
              },
            },
          };
          await store(record);
          prepared.push({ record, file: item.file });
          update(item.id, { phase: "等待上传" });
        }
        setStaged([]);
        for (const item of prepared) {
          try {
            await run(item.record, item.file, signal);
          } catch (reason) {
            update(item.record.id, {
              phase: undefined,
              error: reason as Error,
            });
            if (signal.aborted) throw reason;
          }
        }
      } finally {
        if (mounted.current) setStaged([]);
      }
    });
  const entries = pending.data?.items ?? [];
  const rows: CanvasUploadRow[] = [
    ...entries.map((entry) => {
      const record = records.find(
        (item) =>
          item.intentId === entry.upload.id ||
          (entry.createdBy === session.userId &&
            entry.clientRequestId === item.id),
      );
      const id = record?.id ?? entry.upload.id;
      return {
        id,
        title: entry.declaration.displayName ?? entry.declaration.fileName,
        position: entry.position,
        entry,
        ...(record ? { record } : {}),
        ...details[id],
      };
    }),
    ...records
      .filter(
        (record) =>
          (!record.intentId || !!details[record.id]?.phase) &&
          !entries.some(
            (entry) =>
              entry.upload.id === record.intentId ||
              (entry.createdBy === session.userId &&
                entry.clientRequestId === record.id),
          ),
      )
      .map((record) => ({
        id: record.id,
        title: record.declaration.displayName ?? record.declaration.fileName,
        position: record.declaration.canvasTarget!.position,
        record,
        ...details[record.id],
      })),
    ...staged
      .filter((item) => !records.some((record) => record.id === item.id))
      .map((item) => ({ ...item, ...details[item.id] })),
  ].filter(
    (row) =>
      !row.entry?.placed &&
      !row.entry?.dismissed &&
      !state.local?.document.nodes.some(
        (node) => node.id === row.entry?.nodeId,
      ),
  );
  const value: Uploads = {
    rows,
    busy,
    readOnly: readOnly || !loaded || pending.isError,
    loading: !loaded || pending.isPending,
    error: error ?? pending.error,
    retry: () => {
      setError(null);
      if (!loaded) setLoadAttempt((attempt) => attempt + 1);
      void pending.refetch();
    },
    begin,
    resume,
    pause: () => current.current?.abort(),
    place: (row) =>
      void task(async (signal) => {
        const record = inputFor(row);
        await store(record);
        await place(record, signal);
      }),
    dismiss: (row) =>
      void task(async (signal) => {
        let record = inputFor(row);
        if (!record.intentId) {
          try {
            const entry = await api<Entry>(
              `${path}/uploads/by-request/${record.id}`,
              { signal },
            );
            record = { ...record, intentId: entry.upload.id };
            await store(record);
          } catch (reason) {
            if (
              reason instanceof ApiError &&
              reason.code === "CANVAS_UPLOAD_REQUEST_MISSING" &&
              Date.parse(record.createdAt) < Date.now() - 15 * 60_000
            ) {
              await saveImport(record, true);
              recordMap.current.delete(record.id);
              if (mounted.current) setRecords([...recordMap.current.values()]);
              return;
            }
            throw reason;
          }
        }
        const existing = await fresh(record.intentId!, signal);
        if (existing.placed)
          throw new Error("素材已经放入画布，请使用节点的移除操作。");
        await mediaPost<Entry>(
          session,
          `${path}/uploads/${record.intentId}/dismiss`,
          undefined,
          signal,
        );
        if (row.record) {
          await saveImport(row.record, true);
          recordMap.current.delete(row.record.id);
          setRecords([...recordMap.current.values()]);
        }
      }),
  };
  const revoked =
    pending.error instanceof ApiError &&
    [401, 403, 404].includes(pending.error.status);
  useEffect(() => {
    if (revoked) {
      current.current?.abort();
      for (const record of recordMap.current.values())
        void saveImport(record, true).catch(() => {});
      recordMap.current.clear();
      setRecords([]);
      setStaged([]);
      setDetails({});
      controller.suspendAccess();
      void controller.refresh();
    }
  }, [revoked, controller]);
  return (
    <Context.Provider value={revoked ? { ...value, rows: [] } : value}>
      {children}
    </Context.Provider>
  );
}

export function CanvasUploadPanel() {
  const uploads = useCanvasUploads();
  if (!uploads) return null;
  return (
    <section className={classes.uploadList} aria-label="文件导入记录">
      <ErrorNotice error={uploads.error} retry={uploads.retry} />
      {uploads.loading && !uploads.error && (
        <Text size="sm" role="status">
          正在读取导入记录…
        </Text>
      )}
      {!uploads.loading && !uploads.error && !uploads.rows.length && (
        <Text size="sm" c="dimmed">
          没有需要处理的文件导入。
        </Text>
      )}
      {uploads.rows.length > 0 && (
        <>
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              导入完成后可添加到画布。移除记录不会删除已导入的素材。
            </Text>
            {uploads.busy && (
              <Button size="xs" onClick={uploads.pause}>
                暂停上传
              </Button>
            )}
          </Group>
          {uploads.rows.map((row) => (
            <CanvasUploadItem key={row.id} row={row} uploads={uploads} />
          ))}
        </>
      )}
    </section>
  );
}

export function CanvasUploadSummary({ row }: { row: CanvasUploadRow }) {
  return (
    <Stack gap="xs">
      <Text fw={600} className={classes.prose}>
        {row.title}
      </Text>
      <Text size="sm" role="status">
        {row.entry && ["rejected", "expired"].includes(row.entry.upload.status)
          ? labels[row.entry.upload.status]
          : row.error
            ? "需要恢复"
            : (row.phase ??
              (row.entry ? labels[row.entry.upload.status] : "创建状态待核对"))}
      </Text>
      {row.phase === "正在上传文件" && (
        <Progress
          value={row.progress ?? 0}
          aria-label={`${row.title}上传进度`}
        />
      )}
    </Stack>
  );
}
function CanvasUploadItem({
  row,
  uploads,
}: {
  row: CanvasUploadRow;
  uploads: Uploads;
}) {
  const status = row.entry?.upload.status,
    ready = status === "accepted",
    closed = status === "expired" || status === "rejected";
  return (
    <article className={classes.choice} aria-label={`画布上传 ${row.title}`}>
      <CanvasUploadSummary row={row} />
      {row.error && row.error.message !== row.entry?.upload.issue?.message && (
        <Alert title="本次导入未完成">{row.error.message}</Alert>
      )}
      {row.entry?.upload.issue && (
        <Alert title="文件处理状态">{row.entry.upload.issue.message}</Alert>
      )}
      <Group gap="xs">
        {ready ? (
          <Button
            size="xs"
            disabled={uploads.busy || uploads.readOnly}
            onClick={() => uploads.place(row)}
          >
            放入画布
          </Button>
        ) : (
          !closed &&
          (row.record || row.entry) && (
            <>
              <FileButton
                accept={importAccept}
                onChange={(file) => {
                  if (file) uploads.resume(row, file);
                }}
              >
                {(props) => (
                  <Button
                    {...props}
                    size="xs"
                    disabled={uploads.busy || uploads.readOnly}
                  >
                    重选原文件继续
                  </Button>
                )}
              </FileButton>
              <Button
                size="xs"
                disabled={
                  uploads.busy ||
                  uploads.readOnly ||
                  status === "verifying" ||
                  (status === "uploaded" && !row.entry?.upload.issue?.retryable)
                }
                onClick={() => uploads.resume(row, null)}
              >
                核对并继续
              </Button>
            </>
          )
        )}
        {(row.entry ||
          (row.record &&
            !row.record.intentId &&
            Date.parse(row.record.createdAt) < Date.now() - 15 * 60_000)) && (
          <Button
            size="xs"
            variant="subtle"
            disabled={uploads.busy || uploads.readOnly}
            onClick={() => uploads.dismiss(row)}
          >
            移除记录
          </Button>
        )}
      </Group>
    </article>
  );
}

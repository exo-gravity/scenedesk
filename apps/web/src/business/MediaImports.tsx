import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  FileInput,
  Group,
  Progress,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { UploadSimple } from "@phosphor-icons/react";
import { api, ApiError, useSession, type Schema } from "./api";
import { ErrorNotice } from "./common";
import {
  fileHash,
  importAccept,
  importMime,
  importRecords,
  resumeMediaImport,
  saveImport,
  type ImportRecord,
} from "./media-imports";
import classes from "./media.module.css";

type Props = {
  path: string;
  scopeKey: string;
  projectId?: string | undefined;
  canWrite: boolean;
  mediaHref: (id: string) => string;
};
const statusLabels: Record<Schema<"UploadIntent">["status"], string> = {
  pending: "等待上传",
  uploaded: "等待验收",
  verifying: "正在验收",
  accepted: "导入完成",
  rejected: "文件未通过",
  expired: "上传已过期",
};
export function MediaImports(props: Props) {
  const session = useSession(),
    cache = useQueryClient();
  const [records, setRecords] = useState<ImportRecord[]>([]),
    [error, setError] = useState<Error>(),
    [ready, setReady] = useState(false);
  const [file, setFile] = useState<File | null>(null),
    [name, setName] = useState("");
  const [active, setActive] = useState<string>(),
    [phase, setPhase] = useState(""),
    [progress, setProgress] = useState(0);
  const controller = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    importRecords(session.userId, props.scopeKey)
      .then((found) => {
        if (mounted.current) {
          setRecords(found);
          setReady(true);
        }
      })
      .catch((error) => {
        if (mounted.current) setError(error);
      });
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, [session.userId, props.scopeKey]);
  const store = async (record: ImportRecord) => {
    await saveImport(record);
    if (mounted.current)
      setRecords((previous) => [
        record,
        ...previous.filter((item) => item.id !== record.id),
      ]);
  };
  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: ["user", session.userId] });
  };
  async function resume(initial: ImportRecord, selected: File | null) {
    if (active || !props.canWrite) return;
    const current = new AbortController();
    controller.current = current;
    setActive(initial.id);
    setError(undefined);
    setProgress(0);
    const record = initial;
    try {
      await resumeMediaImport({
        initial: record,
        selected,
        session,
        path: props.path,
        signal: current.signal,
        store,
        phase: (value) => {
          if (mounted.current) setPhase(value);
        },
        progress: (value) => {
          if (mounted.current) setProgress(value);
        },
      });
      await refresh();
      if (mounted.current) {
        setFile(null);
        setName("");
      }
    } catch (error) {
      if (mounted.current)
        setError(
          current.signal.aborted
            ? new Error("上传已暂停，本机记录已保留。恢复后可继续。")
            : (error as Error),
        );
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
        await saveImport(record, true).catch(() => {
          if (mounted.current)
            setError(
              new Error("访问权限已失效，本机记录暂未清除，请关闭当前工作区。"),
            );
        });
        if (mounted.current)
          setRecords((previous) =>
            previous.filter((item) => item.id !== record.id),
          );
      }
    } finally {
      if (mounted.current) {
        setActive(undefined);
        setPhase("");
      }
    }
  }
  async function begin() {
    if (!file || active || !ready || !props.canWrite) return;
    setError(undefined);
    const current = new AbortController();
    controller.current = current;
    setActive("hashing");
    setPhase("正在核对文件");
    try {
      if (records.length >= 20)
        throw new Error("本机列表最多保留 20 次导入，请先移除已结束的记录。");
      const mime = importMime(file),
        displayName = name.trim() || file.name;
      if (
        Array.from(displayName).length > 160 ||
        Array.from(file.name).length > 160
      )
        throw new Error("文件名与素材名称不能超过 160 个字。");
      const record: ImportRecord = {
        id: crypto.randomUUID(),
        userId: session.userId,
        scopeKey: props.scopeKey,
        createdAt: new Date().toISOString(),
        declaration: {
          scope: props.projectId ? "project" : "shared",
          ...(props.projectId ? { projectId: props.projectId } : {}),
          fileName: file.name,
          displayName,
          mime,
          bytes: file.size,
          sha256: await fileHash(file, current.signal),
        },
      };
      await store(record);
      if (!mounted.current || current.signal.aborted) return;
      setActive(undefined);
      // resume receives this exact declaration; a lost create response reuses its durable request ID.
      await resume(record, file);
    } catch (error) {
      if (mounted.current)
        setError(
          current.signal.aborted ? new Error("操作已暂停。") : (error as Error),
        );
    } finally {
      if (mounted.current) {
        setActive(undefined);
        setPhase("");
      }
    }
  }
  return (
    <section className={classes.imports} aria-label="文件导入与恢复">
      <Stack gap="md">
        <Group justify="space-between">
          <Text fw={600}>导入文件</Text>
          <Text size="sm" c="dimmed">
            单文件最多 256 MiB · 文本与 SRT 最多 2 MiB
          </Text>
        </Group>
        {props.canWrite ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void begin();
            }}
          >
            <div className={classes.importFields}>
              <FileInput
                label="选择文件"
                placeholder="图片、音视频、文本或 SRT"
                accept={importAccept}
                value={file}
                onChange={setFile}
                disabled={!!active}
                clearable
              />
              <TextInput
                label="素材名称"
                placeholder="默认使用原文件名"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                disabled={!!active}
                maxLength={160}
              />
              <Button
                type="submit"
                variant="filled"
                leftSection={<UploadSimple size={18} />}
                disabled={!file || !ready || !!active}
              >
                开始导入
              </Button>
            </div>
          </form>
        ) : (
          <Text c="dimmed">
            {props.projectId
              ? "项目已归档，恢复项目后可导入。"
              : "共享素材由工作室所有者或管理员导入。"}
          </Text>
        )}
        {active && (
          <Stack gap="xs">
            <Group justify="space-between">
              <Text role="status">
                {phase}
                {phase === "正在上传文件" ? ` · ${progress}%` : ""}
              </Text>
              <Button onClick={() => controller.current?.abort()}>暂停</Button>
            </Group>
            {phase === "正在上传文件" && (
              <Progress value={progress} aria-label="文件上传进度" />
            )}
          </Stack>
        )}
        <ErrorNotice error={error ?? null} />
        {records.map((record) => (
          <PendingImport
            key={record.id}
            record={record}
            {...props}
            disabled={!!active}
            resume={(selected) => void resume(record, selected)}
            remove={async () => {
              await saveImport(record, true);
              setRecords((previous) =>
                previous.filter((item) => item.id !== record.id),
              );
            }}
            onAccepted={refresh}
          />
        ))}
      </Stack>
    </section>
  );
}
function PendingImport(
  props: Props & {
    record: ImportRecord;
    disabled: boolean;
    resume: (file: File | null) => void;
    remove: () => Promise<void>;
    onAccepted: () => Promise<void>;
  },
) {
  const session = useSession(),
    [file, setFile] = useState<File | null>(null),
    [removeError, setRemoveError] = useState<Error>();
  const record = props.record;
  const upload = useQuery({
    queryKey: [
      "user",
      session.userId,
      `${props.path}/uploads/${record.intentId}`,
    ],
    queryFn: ({ signal }) =>
      api<Schema<"UploadIntent">>(`${props.path}/uploads/${record.intentId}`, {
        signal,
      }),
    enabled: !!record.intentId,
    refetchInterval: (query) =>
      query.state.error ||
      ["accepted", "expired", "rejected"].includes(
        query.state.data?.status ?? "",
      )
        ? false
        : 2500,
  });
  const accepted = upload.data?.status === "accepted";
  useEffect(() => {
    if (accepted) void props.onAccepted();
  }, [accepted]);
  const revoked =
    upload.error instanceof ApiError &&
    [401, 403, 404].includes(upload.error.status);
  useEffect(() => {
    if (revoked) void props.remove().catch(setRemoveError);
  }, [revoked]);
  const status =
    upload.data?.status ??
    (!record.intentId && Date.parse(record.createdAt) < Date.now() - 15 * 60_000
      ? "expired"
      : undefined);
  const closed =
    !!status && ["accepted", "rejected", "expired"].includes(status);
  if (revoked) return <ErrorNotice error={upload.error} />;
  return (
    <article
      className={classes.importRow}
      aria-label={`导入记录 ${record.declaration.displayName}`}
    >
      <Group justify="space-between">
        <Text fw={500}>{record.declaration.displayName}</Text>
        <Badge>{status ? statusLabels[status] : "创建状态待核对"}</Badge>
      </Group>
      <Text size="sm" c="dimmed">
        {record.declaration.fileName} ·{" "}
        {(record.declaration.bytes / 1024).toFixed(1)} KiB
      </Text>
      <ErrorNotice
        error={upload.error ?? removeError ?? null}
        retry={() => void upload.refetch()}
      />
      {upload.data?.issue && (
        <Alert
          title={
            upload.data.issue.retryable ? "处理需要恢复" : "文件未通过验收"
          }
        >
          {upload.data.issue.message}
        </Alert>
      )}
      <Group mt="sm" align="end">
        {!closed && props.canWrite && !upload.error && (
          <>
            {(!status || status === "pending") && !record.transferred && (
              <FileInput
                label="重新选择原文件"
                placeholder="刷新后需重新选择"
                accept={importAccept}
                value={file}
                onChange={setFile}
                disabled={props.disabled}
              />
            )}
            <Button
              disabled={
                props.disabled ||
                status === "verifying" ||
                (status === "uploaded" && !upload.data?.issue?.retryable)
              }
              onClick={() => props.resume(file)}
            >
              继续本次导入
            </Button>
          </>
        )}
        {upload.data?.mediaId && (
          <Button component="a" href={props.mediaHref(upload.data.mediaId)}>
            查看素材
          </Button>
        )}
        {closed && (
          <Button
            variant="subtle"
            disabled={props.disabled}
            onClick={() => void props.remove().catch(setRemoveError)}
          >
            移除本机记录
          </Button>
        )}
      </Group>
    </article>
  );
}

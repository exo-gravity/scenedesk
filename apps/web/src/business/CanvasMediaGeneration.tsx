import { useEffect, useRef, useState } from "react";
import {
  Button,
  Group,
  Loader,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { ImageSquare, FilmStrip, MusicNotes } from "@phosphor-icons/react";
import { useList, useResource, type Schema } from "./api";
import { ErrorNotice, projectPath, tenantPath } from "./common";
import type { CanvasController } from "./canvas-controller";
import { MediaGenerationWorkspace } from "./MediaGenerationWorkspace";
import { jobStatusLabel } from "./assistant-session";
import { MediaPreview } from "./MediaPreview";
import {
  GeneratedMediaComparison,
  type ComparedMedia,
} from "./GeneratedMediaResult";
import classes from "./image-generation.module.css";
export type CanvasMediaGenerationProps = {
  tenantId: string;
  projectId: string;
  sceneId: string | undefined;
  controller: CanvasController;
  /** Explicit editing target. Canvas selection must not change it implicitly. */
  selectedNodeId?: string | undefined;
  mode?: "editor" | "history";
  presentation?: "node" | "detail" | undefined;
  inspectedPlanId?: string | undefined;
  onInspectPlan?: ((planId: string) => void) | undefined;
  onCloseInspection?: (() => void) | undefined;
  onRetainDraft?:
    | ((retain: (() => Promise<void>) | undefined) => void)
    | undefined;
  readOnly: boolean;
  focus: (ids: string[]) => void;
};
/** The fixed attempt view has its own recovery partition; browsing never replaces a draft. */
export function CanvasMediaGeneration({
  tenantId,
  projectId,
  sceneId,
  controller,
  selectedNodeId,
  mode = "editor",
  presentation,
  inspectedPlanId,
  onInspectPlan,
  onCloseInspection,
  onRetainDraft,
  readOnly,
  focus,
}: CanvasMediaGenerationProps) {
  const snapshot = controller.getSnapshot(),
    canvas = snapshot.local?.base;
  const [localInspection, setLocalInspection] = useState<string>();
  const [comparison, setComparison] = useState<ComparedMedia[]>([]);
  const [comparing, setComparing] = useState(false);
  const historyId = inspectedPlanId ?? localInspection;
  const entries = useList<Schema<"CanvasPlanEntry">>(
    `${projectPath(tenantId, projectId)}/canvases/${canvas?.id ?? "unavailable"}/generation-plans`,
    mode === "history" &&
      !!canvas &&
      !snapshot.accessChecking &&
      snapshot.phase !== "forbidden",
  );
  const attempts =
    entries.data?.filter((entry) =>
      ["image", "video", "audio"].includes(entry.plan.input.purpose),
    ) ?? [];
  const history =
    mode === "history"
      ? attempts.find((entry) => entry.plan.id === historyId)
      : undefined;
  const selected = snapshot.local?.document.nodes.find(
    (node) => node.id === selectedNodeId,
  );
  const editable =
    selected?.content.type === "draft" && selected.kind !== "text"
      ? selected
      : undefined;
  const purpose = history?.plan.input.purpose ?? editable?.kind;
  const kind = purpose === "audio" || purpose === "video" ? purpose : "image";
  const label = { image: "图片", video: "视频", audio: "声音" }[kind];
  const nodeId = mode === "history" ? history?.origin.nodeId : editable?.id;
  if (!canvas || snapshot.accessChecking || snapshot.phase === "forbidden")
    return null;
  if (mode === "editor" && !editable) return null;
  const save = async () => {
    await controller.save();
    const current = controller.getSnapshot();
    if (
      current.accessChecking ||
      current.phase !== "ready" ||
      current.dirty ||
      current.hasInvalidInput ||
      !current.localSaved ||
      !current.local ||
      current.local.pending ||
      current.recovery ||
      current.recoveryBlocked
    )
      throw Error(`请先完成画布保存或冲突恢复，再准备${label}操作。`);
    return current.local.base;
  };
  const inspect = (id: string) => {
    if (onInspectPlan) onInspectPlan(id);
    else setLocalInspection(id);
  };
  return (
    <section
      className={classes.canvasGeneration}
      aria-label={mode === "history" ? "固定尝试与结果" : "当前草稿生成"}
    >
      {mode === "history" && (
        <>
          <Group
            justify="space-between"
            className={classes.canvasGenerationHeading}
          >
            <Text fw={600}>
              {history ? "固定尝试 · 只读输入" : "尝试与结果"}
            </Text>
            {historyId && (
              <Button
                size="xs"
                variant="subtle"
                onClick={() => {
                  setLocalInspection(undefined);
                  onCloseInspection?.();
                }}
              >
                返回尝试列表
              </Button>
            )}
          </Group>
          <ErrorNotice
            error={entries.error}
            retry={() => void entries.refetch()}
          />
          {!entries.data && !entries.error && (
            <Loader size="sm" aria-label="正在读取固定尝试" />
          )}
          {historyId && entries.data && !history && (
            <Text role="status">
              原尝试尚未读取或已不可访问。当前创作输入保持不变。
            </Text>
          )}
          {!history && (
            <Stack gap="xs">
              {attempts.map((entry) => (
                <CanvasAttemptRow
                  key={entry.plan.id}
                  entry={entry}
                  tenantId={tenantId}
                  projectId={projectId}
                  title={
                    snapshot.local?.document.nodes.find(
                      (node) => node.id === entry.origin.nodeId,
                    )?.title
                  }
                  compared={comparison.map((item) => item.mediaId)}
                  compare={(item) =>
                    setComparison((old) =>
                      old.some((selected) => selected.mediaId === item.mediaId)
                        ? old.filter(
                            (selected) => selected.mediaId !== item.mediaId,
                          )
                        : [...old.slice(-1), item],
                    )
                  }
                  inspect={() => inspect(entry.plan.id)}
                />
              ))}
              {entries.data && !attempts.length && (
                <Text size="sm" c="dimmed">
                  还没有固定尝试。准备计划后可从这里找回输入、任务与结果。
                </Text>
              )}
            </Stack>
          )}
          {!!comparison.length && (
            <Group className={classes.comparisonSelection}>
              <Text size="xs">
                比较：
                {comparison
                  .map(
                    (item, index) =>
                      `${index === 0 ? "A" : "B"} · ${item.label}`,
                  )
                  .join(" / ")}
              </Text>
              <Button
                size="xs"
                disabled={comparison.length !== 2}
                onClick={() => setComparing(true)}
              >
                比较 A / B
              </Button>
              <Button
                size="xs"
                variant="subtle"
                onClick={() => setComparison([])}
              >
                清除比较选择
              </Button>
            </Group>
          )}
          {comparing && (
            <GeneratedMediaComparison
              items={comparison}
              close={() => setComparing(false)}
            />
          )}
        </>
      )}
      {nodeId && (
        <MediaGenerationWorkspace
          kind={kind}
          tenantId={tenantId}
          projectId={projectId}
          active={!readOnly}
          historyPlanId={history?.plan.id}
          inspection={mode === "history"}
          presentation={presentation ?? (mode === "editor" ? "node" : "detail")}
          onInspectPlan={onInspectPlan}
          onRetainDraft={onRetainDraft}
          source={{
            kind: "canvas",
            canvas: { ...canvas, document: snapshot.local!.document },
            sceneId,
            nodeId,
            awaitingSave:
              snapshot.phase !== "ready" ||
              snapshot.dirty ||
              !snapshot.localSaved ||
              !!snapshot.local?.pending,
            configure: (id, change) => {
              const current = controller.getSnapshot();
              if (
                mode === "history" ||
                readOnly ||
                current.accessChecking ||
                current.phase === "forbidden" ||
                !current.local
              )
                throw Error("当前固定输入不可修改。");
              const node = current.local.document.nodes.find(
                (node) => node.id === id,
              );
              if (node?.kind !== kind || node.content.type !== "draft")
                throw Error("原草稿已改变，请重新核对编辑目标。");
              controller.change({
                ...current.local.document,
                nodes: current.local.document.nodes.map((item) =>
                  item.id === id
                    ? { ...node, content: { ...node.content, ...change } }
                    : item,
                ),
              });
            },
            save,
            focus,
            afterPlacement: async () => {
              await controller.refresh();
              if (mode === "history") await entries.refetch();
              const current = controller.getSnapshot();
              if (current.accessChecking || current.phase === "forbidden")
                throw Error("当前画布访问尚未核对。");
            },
          }}
        />
      )}
    </section>
  );
}
function CanvasAttemptRow({
  entry,
  tenantId,
  projectId,
  title,
  inspect,
  compared,
  compare,
}: {
  entry: Schema<"CanvasPlanEntry">;
  tenantId: string;
  projectId: string;
  title?: string | undefined;
  inspect: () => void;
  compared: string[];
  compare: (media: ComparedMedia) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!element.current) return;
    const observer = new IntersectionObserver(
      (rows) => {
        if (rows.some((row) => row.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "80px" },
    );
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  const job = useResource<Schema<"GenerationJob">>(
    `${tenantPath(tenantId)}/generation-jobs/${entry.jobId ?? "unavailable"}`,
    visible && !!entry.jobId,
  );
  const mediaId = job.data?.mediaIds[0];
  const media = useResource<Schema<"Media">>(
    `${tenantPath(tenantId)}/media/${mediaId ?? "unavailable"}`,
    visible && !!mediaId,
  );
  const kind = entry.plan.input.purpose;
  const Symbol =
    kind === "audio" ? MusicNotes : kind === "video" ? FilmStrip : ImageSquare;
  const validMedia =
    media.data?.sourceJobId === entry.jobId &&
    media.data?.id === mediaId &&
    !media.error
      ? media.data
      : undefined;
  return (
    <div ref={element}>
      <UnstyledButton
        onClick={inspect}
        className={classes.attemptRow}
        aria-label={`查看固定尝试 ${title ?? "已删除的草稿"} · ${entry.plan.id.slice(0, 8)}`}
      >
        <span className={classes.attemptThumbnail}>
          {validMedia ? (
            <MediaPreview
              media={validMedia}
              path={tenantPath(tenantId)}
              thumbnail
            />
          ) : (
            <Symbol size={24} />
          )}
        </span>
        <span className={classes.attemptDescription}>
          <Text component="span" size="sm" fw={500}>
            {title ?? "已删除的草稿"}
          </Text>
          <Text component="span" size="xs" c="dimmed">
            {kind === "audio" ? "声音" : kind === "video" ? "视频" : "图片"} ·{" "}
            {job.error
              ? "任务暂不可读"
              : (job.data?.status ?? entry.jobStatus) === "succeeded"
                ? "成果已就绪"
                : job.data
                  ? jobStatusLabel[job.data.status]
                  : entry.jobStatus
                    ? jobStatusLabel[entry.jobStatus]
                    : entry.jobId
                      ? "待核对任务"
                      : "固定计划"}
          </Text>
          <Text component="span" size="xs" c="dimmed">
            {entry.plan.createdAt
              ? new Date(entry.plan.createdAt).toLocaleString()
              : `计划 ${entry.plan.id.slice(0, 8)}`}
          </Text>
        </span>
      </UnstyledButton>
      {job.data?.status === "succeeded" &&
        job.data.mediaIds.map((id, index) => (
          <Button
            key={id}
            size="compact-xs"
            variant="subtle"
            onClick={() =>
              compare({
                tenantId,
                projectId,
                jobId: job.data!.id,
                mediaId: id,
                planId: entry.plan.id,
                kind: kind === "video" || kind === "audio" ? kind : "image",
                label: `${title ?? "已删除的草稿"}${job.data!.mediaIds.length > 1 ? ` · 结果 ${index + 1}` : ""}`,
              })
            }
          >
            {compared.includes(id) ? "移出比较" : "加入比较"}
            {job.data!.mediaIds.length > 1 ? ` · 结果 ${index + 1}` : ""}
          </Button>
        ))}
    </div>
  );
}

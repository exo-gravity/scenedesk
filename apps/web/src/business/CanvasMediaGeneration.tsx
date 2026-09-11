import { useState } from "react";
import { Accordion, NativeSelect, Stack, Text } from "@mantine/core";
import { ImageSquare, FilmStrip } from "@phosphor-icons/react";
import { useList, type Schema } from "./api";
import { ErrorNotice, projectPath } from "./common";
import type { CanvasController } from "./canvas-controller";
import { MediaGenerationWorkspace } from "./MediaGenerationWorkspace";
import classes from "./image-generation.module.css";
/** Canvas composition only: the owning editor still controls saving and conflict recovery. */
export function CanvasMediaGeneration({
  tenantId,
  projectId,
  sceneId,
  controller,
  selectedNodeId,
  readOnly,
  focus,
}: {
  tenantId: string;
  projectId: string;
  sceneId: string;
  controller: CanvasController;
  selectedNodeId?: string | undefined;
  readOnly: boolean;
  focus: (ids: string[]) => void;
}) {
  const snapshot = controller.getSnapshot(),
    canvas = snapshot.local?.base;
  const [historyId, setHistoryId] = useState<string | null>(null);
  const entries = useList<Schema<"CanvasPlanEntry">>(
    `${projectPath(tenantId, projectId)}/canvases/${canvas?.id ?? "unavailable"}/generation-plans`,
    !!canvas && !snapshot.accessChecking && snapshot.phase !== "forbidden",
  );
  const images =
    entries.data?.filter((entry) =>
      ["image", "video"].includes(entry.plan.input.purpose),
    ) ?? [];
  const history = images.find((entry) => entry.plan.id === historyId);
  const selected = snapshot.local?.document.nodes.find(
    (node) => node.id === selectedNodeId,
  );
  const kind =
    history?.plan.input.purpose === "video" ||
    (!history && selected?.kind === "video")
      ? "video"
      : "image";
  const label = kind === "image" ? "图片" : "视频",
    Symbol = kind === "image" ? ImageSquare : FilmStrip;
  const nodeId =
    history?.origin.nodeId ??
    ((selected?.kind === "image" || selected?.kind === "video") &&
    selected.content.type === "draft"
      ? selected.id
      : undefined);
  if (!canvas || snapshot.accessChecking || snapshot.phase === "forbidden")
    return null;
  const liveCanvas = { ...canvas, document: snapshot.local!.document };
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
  return (
    <Accordion className={classes.composer}>
      <Accordion.Item value="image">
        <Accordion.Control icon={<Symbol size={16} />}>
          画布生成与结果
        </Accordion.Control>
        <Accordion.Panel>
          <Stack gap="md" className={classes.canvasBody}>
            <Text size="sm">
              选择一个图片或视频草稿以准备生成，或找回已经保存的固定任务。
            </Text>
            <ErrorNotice
              error={entries.error}
              retry={() => void entries.refetch()}
            />
            <NativeSelect
              label="画布生成任务历史"
              value={historyId ?? ""}
              onChange={(event) =>
                setHistoryId(event.currentTarget.value || null)
              }
              data={[
                { value: "", label: "选择已保存任务" },
                ...images.map((entry, index) => ({
                  value: entry.plan.id,
                  label: `${snapshot.local?.document.nodes.find((node) => node.id === entry.origin.nodeId)?.title ?? `已删除的${entry.plan.input.purpose === "video" ? "视频" : "图片"}草稿`} · ${index + 1} · ${entry.jobId ? "已有任务" : "固定计划"}`,
                })),
              ]}
            />
            {nodeId ? (
              <MediaGenerationWorkspace
                kind={kind}
                tenantId={tenantId}
                projectId={projectId}
                active={!readOnly}
                historyPlanId={history?.plan.id}
                source={{
                  kind: "canvas",
                  canvas: liveCanvas,
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
                      readOnly ||
                      current.accessChecking ||
                      current.phase === "forbidden" ||
                      !current.local
                    )
                      throw Error("当前画布不可修改。");
                    const node = current.local.document.nodes.find(
                      (node) => node.id === id,
                    );
                    if (node?.kind !== kind || node.content.type !== "draft")
                      throw Error(`原${label}草稿已改变，请重新选择。`);
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
                    await entries.refetch();
                    const current = controller.getSnapshot();
                    if (current.accessChecking || current.phase === "forbidden")
                      throw Error("当前画布访问尚未核对。");
                  },
                }}
              />
            ) : (
              <Text size="sm" c="dimmed">
                先选择图片或视频草稿。也可通过“继续创作”建立独立草稿。
              </Text>
            )}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}

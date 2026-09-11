import { useState } from "react";
import {
  Alert,
  Button,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import type { CanvasNode } from "@drama/domain";
import { api, useList, useResource, useSession, type Schema } from "./api";
import { DraftNotice, useContentDraft } from "./content-drafts";
import { ErrorNotice } from "./common";
import { parseSourceSeconds, sourceSeconds } from "./candidate-time";
import type { CanvasController } from "./canvas-controller";
import { MediaPreview } from "./MediaPreview";
import classes from "./canvas.module.css";
import { referencePurposes } from "./asset-queries";

type Binding = Schema<"CanvasShotBinding">;
type Seed = { shotId: string; shotRevisionId: string; take?: Schema<"Take"> };
type Placement = (
  media: Schema<"Media">,
  shot: Schema<"Shot">,
  take?: Schema<"Take">,
  assetRevisionId?: string,
) => void;
function clean(controller: CanvasController) {
  const s = controller.getSnapshot();
  return (
    !!s.local &&
    s.phase === "ready" &&
    !s.dirty &&
    !s.local.pending &&
    !s.hasInvalidInput &&
    !s.recovery &&
    !s.recoveryBlocked &&
    !s.accessChecking &&
    s.localSaved &&
    !s.storageError
  );
}
export function CanvasShotConnections({
  path,
  sceneId,
  controller,
  sceneCanvas,
  shots,
  target,
  readOnly,
  changed,
  focus,
  editTarget,
  busyChange,
  seed,
  place,
}: {
  path: string;
  sceneId: string;
  controller: CanvasController;
  sceneCanvas: Schema<"SceneCanvas">;
  shots: Schema<"Shot">[];
  target: CanvasNode | null;
  readOnly: boolean;
  seed?: Seed | undefined;
  place: Placement;
  changed: () => Promise<void>;
  focus: (ids: string[]) => void;
  editTarget: (node: CanvasNode | null) => void;
  busyChange: (busy: boolean) => void;
}) {
  const [query, setQuery] = useState(""),
    [placement, setPlacement] = useState<Schema<"Shot"> | null>(null);
  const local = controller.getSnapshot().local!;
  const linked = new Set(sceneCanvas.bindings.map((b) => b.nodeId));
  const base = location.hash.split("?")[0]!;
  return (
    <Stack>
      {target && (
        <CanvasBindingEditor
          key={target.id}
          path={path}
          sceneId={sceneId}
          node={target}
          controller={controller}
          shots={shots}
          bindings={sceneCanvas.bindings.filter((b) => b.nodeId === target.id)}
          seed={seed}
          readOnly={readOnly}
          changed={changed}
          close={() => editTarget(null)}
          busyChange={busyChange}
        />
      )}
      {placement && (
        <ShotCanvasPlacement
          key={placement.id}
          path={path}
          shot={shots.find((s) => s.id === placement.id) ?? placement}
          readOnly={readOnly}
          close={() => setPlacement(null)}
          place={(media, shot, take, assetRevisionId) => {
            place(media, shot, take, assetRevisionId);
            setPlacement(null);
          }}
        />
      )}
      <TextInput
        label="查找本场镜头或探索内容"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
      />
      <Text fw={600}>本场镜头</Text>
      {shots
        .filter((s) => (s.label + s.spec.intent).includes(query))
        .map((shot) => {
          const bindings = sceneCanvas.bindings.filter(
            (b) => b.shotId === shot.id,
          );
          const ids = [
            ...new Set(
              bindings.filter((b) => b.nodeActive).map((b) => b.nodeId),
            ),
          ];
          return (
            <div key={shot.id} className={classes.choice}>
              <Text fw={600}>
                {shot.label}
                {shot.status !== "active" ? " · 已归档" : ""}
              </Text>
              <Text size="sm" lineClamp={2}>
                {shot.spec.intent}
              </Text>
              <Text size="xs">
                {bindings.filter((b) => b.role === "reference").length}{" "}
                个参考关联 ·{" "}
                {bindings.filter((b) => b.role === "candidate").length}{" "}
                个候选关联
              </Text>
              {bindings.some(
                (b) => b.shotRevisionId !== shot.specRevisionId,
              ) && <Text size="xs">含旧镜头要求的关联，保留原来源。</Text>}
              <Group gap="xs">
                <Button
                  size="xs"
                  disabled={!ids.length}
                  onClick={() => focus(ids)}
                >
                  定位镜头节点
                </Button>
                <Button
                  size="xs"
                  component="a"
                  href={`${base}?scene=${sceneId}&shot=${shot.id}&mode=storyboard`}
                >
                  查看分镜
                </Button>
                <Button
                  size="xs"
                  disabled={readOnly || shot.status !== "active"}
                  onClick={() => setPlacement(shot)}
                >
                  添加到画布
                </Button>
              </Group>
              {bindings
                .filter((b) => !b.nodeActive)
                .map((b) => (
                  <Text key={b.id} size="xs">
                    节点已移出画布；原
                    {b.role === "candidate" ? "候选" : "参考关联"}仍保留。
                  </Text>
                ))}
            </div>
          );
        })}
      {!shots.length && (
        <Text size="sm">
          本场还没有镜头，可在场次目录创建；画布内容可继续独立探索。
        </Text>
      )}
      <Text fw={600}>本场探索 · 未关联镜头</Text>
      {local.document.nodes
        .filter(
          (n) =>
            !linked.has(n.id) &&
            (
              n.title +
              (n.content.type === "text"
                ? n.content.text
                : n.content.type === "draft"
                  ? n.content.prompt
                  : "")
            ).includes(query),
        )
        .map((node) => (
          <div key={node.id} className={classes.choice}>
            <Text>
              {node.title} ·{" "}
              {node.content.type === "draft"
                ? "创作草稿"
                : node.content.type === "text"
                  ? "文字"
                  : "素材"}
            </Text>
            <Group>
              <Button size="xs" onClick={() => focus([node.id])}>
                定位内容
              </Button>
              {node.content.type === "media" && (
                <Button size="xs" onClick={() => editTarget(node)}>
                  关联镜头
                </Button>
              )}
            </Group>
          </div>
        ))}
    </Stack>
  );
}

function CanvasBindingEditor({
  path,
  sceneId,
  node,
  controller,
  shots,
  bindings,
  readOnly,
  changed,
  close,
  busyChange,
  seed,
}: {
  seed?: Seed | undefined;
  path: string;
  sceneId: string;
  node: CanvasNode;
  controller: CanvasController;
  shots: Schema<"Shot">[];
  bindings: Binding[];
  readOnly: boolean;
  changed: () => Promise<void>;
  close: () => void;
  busyChange: (busy: boolean) => void;
}) {
  const session = useSession();
  const scenePath = `${path}/scenes/${sceneId}/canvas`;
  const mediaPath = path.split("/projects/")[0]!;
  const media = useResource<Schema<"Media">>(
    `${mediaPath}/media/${node.content.type === "media" ? node.content.mediaId : ""}`,
    node.content.type === "media",
  );
  const state = controller.getSnapshot();
  const [initial] = useState(() => ({
    shotId: "",
    shotRevisionId: "",
    role: "reference" as "reference" | "candidate",
    inSeconds: "0",
    outSeconds: "",
    sourceTakeId: "",
    requestId: crypto.randomUUID(),
  }));
  const [seeded] = useState(() =>
    seed
      ? {
          ...initial,
          shotId: seed.shotId,
          shotRevisionId: seed.shotRevisionId,
          role: seed.take ? ("candidate" as const) : ("reference" as const),
          inSeconds: sourceSeconds(seed.take?.range.inUs ?? 0),
          outSeconds: seed.take ? sourceSeconds(seed.take.range.outUs) : "",
          sourceTakeId: seed.take?.sourceTakeId ?? "",
        }
      : initial,
  );
  const draft = useContentDraft(
    `${scenePath}/nodes/${node.id}/binding-form`,
    initial,
    state.local!.base.revision,
    seeded,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [success, setSuccess] = useState<string | null>(null);
  const shot = shots.find((s) => s.id === draft.value.shotId);
  const fixed = useResource<Schema<"ShotRevision">>(
    `${path}/shots/${draft.value.shotId}/revisions/${draft.value.shotRevisionId}`,
    !!draft.value.shotId && !!draft.value.shotRevisionId,
  );
  const existingNode = state.local?.document.nodes.find(
    (n) => n.id === node.id,
  );
  const currentVersion = state.local!.base.revision;
  const stale = !!draft.value.shotId && draft.baseVersion !== currentVersion;
  const inUs = parseSourceSeconds(draft.value.inSeconds),
    outUs = parseSourceSeconds(draft.value.outSeconds);
  const validRange =
    inUs !== undefined &&
    outUs !== undefined &&
    inUs < outUs &&
    outUs <= (media.data?.durationUs ?? 0);
  const editable =
    !readOnly && !busy && draft.ready && !draft.recovered && !draft.committed;
  const valid =
    editable &&
    !!existingNode &&
    !!shot &&
    shot.status === "active" &&
    fixed.data &&
    media.data?.status === "ready" &&
    clean(controller) &&
    !stale &&
    (draft.value.role === "reference" || (node.kind === "video" && validRange));
  async function submit() {
    if (!valid) return;
    const values = draft.value,
      version = draft.baseVersion;
    const body: Schema<"BindCanvasNode"> =
      values.role === "reference"
        ? {
            role: "reference",
            shotId: values.shotId,
            shotRevisionId: values.shotRevisionId,
          }
        : {
            role: "candidate",
            shotId: values.shotId,
            shotRevisionId: values.shotRevisionId,
            range: { inUs: inUs!, outUs: outUs! },
            ...(values.sourceTakeId
              ? { sourceTakeId: values.sourceTakeId }
              : {}),
          };
    setBusy(true);
    busyChange(true);
    setError(null);
    setSuccess(null);
    try {
      if (!(await draft.stage(values)))
        throw new Error("本机输入尚未保存，请重试本机保存后再关联。");
      const latest = await api<Schema<"SceneCanvas">>(scenePath, {
        signal: AbortSignal.timeout(15000),
      });
      const found = latest.bindings.find(
        (b) =>
          b.nodeId === node.id &&
          b.shotId === body.shotId &&
          b.shotRevisionId === body.shotRevisionId &&
          b.role === body.role,
      );
      let matches = !!found;
      if (found && body.role === "candidate") {
        const take = await api<Schema<"Take">>(
          `${path}/takes/${found.takeId}`,
          { signal: AbortSignal.timeout(15000) },
        );
        matches =
          take.mediaId ===
            (node.content.type === "media" ? node.content.mediaId : "") &&
          take.range.inUs === body.range.inUs &&
          take.range.outUs === body.range.outUs &&
          (take.sourceTakeId ?? "") === values.sourceTakeId;
      }
      if (!matches) {
        if (
          latest.canvas.revision !== version ||
          !clean(controller) ||
          controller.getSnapshot().local?.base.revision !== version
        )
          throw new Error(
            "画布已变化，请刷新关联、核对最新画布后再提交。原输入仍保留。",
          );
        await api<Schema<"SceneCanvas">>(
          `${scenePath}/nodes/${node.id}/shot-bindings`,
          {
            method: "POST",
            signal: AbortSignal.timeout(15000),
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
              "Idempotency-Key": values.requestId,
              "If-Match": `"${version}"`,
            },
            body: JSON.stringify(body),
          },
        );
      }
      await draft.complete();
      setSuccess("已确认镜头关联；候选与采用保持分别处理。");
    } catch (e) {
      setError(
        e instanceof Error ? e : new Error("关联未完成，原输入仍保留。"),
      );
    } finally {
      try {
        await changed();
      } finally {
        setBusy(false);
        busyChange(false);
      }
    }
  }
  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text fw={600}>关联目标 · {node.title}</Text>
        <Button size="xs" variant="subtle" onClick={close}>
          收起
        </Button>
      </Group>
      <Text size="xs">
        目标固定为以上节点，浏览其他内容不会替换。关联不属于画布撤销。
      </Text>
      {!existingNode && (
        <Alert title="节点已移出画布">先取回原节点后再建立关联。</Alert>
      )}
      {media.data && (
        <MediaPreview media={media.data} path={mediaPath} thumbnail />
      )}
      <DraftNotice draft={draft} />
      <ErrorNotice
        error={error ?? media.error ?? fixed.error}
        retry={() => void changed()}
        retryLabel="刷新画布与关联"
      />
      {success && <Text role="status">{success}</Text>}
      <Select
        label="关联到本场镜头"
        placeholder="明确选择镜头"
        searchable
        value={draft.value.shotId || null}
        disabled={!editable}
        data={shots
          .filter((s) => s.status === "active")
          .map((s) => ({ value: s.id, label: s.label }))}
        onChange={(id) => {
          const chosen = shots.find((s) => s.id === id);
          if (chosen) {
            if (clean(controller)) draft.rebase();
            draft.setValue({
              ...draft.value,
              shotId: chosen.id,
              shotRevisionId: chosen.specRevisionId,
              requestId: crypto.randomUUID(),
            });
          }
        }}
      />
      {fixed.data && (
        <Text size="sm">
          固定镜头要求 v{fixed.data.number}：{fixed.data.spec.intent}
        </Text>
      )}
      {shot && shot.specRevisionId !== draft.value.shotRevisionId && (
        <Alert title="镜头要求已更新">
          <Text size="sm">
            原输入仍引用上述旧要求。当前：{shot.spec.intent}
          </Text>
          <Button
            size="xs"
            disabled={!editable}
            onClick={() =>
              draft.setValue({
                ...draft.value,
                shotRevisionId: shot.specRevisionId,
                requestId: crypto.randomUUID(),
              })
            }
          >
            已核对，使用当前镜头要求
          </Button>
        </Alert>
      )}
      <Select
        label="关联用途"
        allowDeselect={false}
        value={draft.value.role}
        disabled={!editable}
        data={[
          { value: "reference", label: "待选参考" },
          ...(node.kind === "video"
            ? [{ value: "candidate", label: "视频候选" }]
            : []),
        ]}
        onChange={(value) =>
          draft.setValue({
            ...draft.value,
            role: value === "candidate" ? "candidate" : "reference",
            outSeconds:
              draft.value.outSeconds ||
              sourceSeconds(media.data?.durationUs ?? 0),
            requestId: crypto.randomUUID(),
          })
        }
      />
      {draft.value.role === "candidate" && (
        <>
          <TextInput
            label="候选入点（秒）"
            value={draft.value.inSeconds}
            disabled={!editable}
            onChange={(e) =>
              draft.setValue({
                ...draft.value,
                inSeconds: e.currentTarget.value,
                requestId: crypto.randomUUID(),
              })
            }
          />
          <TextInput
            label="候选出点（秒）"
            value={draft.value.outSeconds}
            disabled={!editable}
            onChange={(e) =>
              draft.setValue({
                ...draft.value,
                outSeconds: e.currentTarget.value,
                requestId: crypto.randomUUID(),
              })
            }
            error={
              !validRange
                ? "请输入视频范围内的有效入出点，最多六位小数。"
                : undefined
            }
          />
        </>
      )}
      {draft.value.sourceTakeId && (
        <Text size="xs">
          保留候选沿用来源 {draft.value.sourceTakeId.slice(0, 8)}。
        </Text>
      )}
      <Text size="xs">
        参考不会改写镜头默认参考；候选只保存选定区间，不自动采用。
      </Text>
      {(!clean(controller) || stale) && (
        <Alert title="先核对已保存画布">
          <Text size="sm">
            画布版本 {currentVersion}，表单基线 {draft.baseVersion}
            。完成画布保存和冲突处理后再关联。
          </Text>
          <Group mt="xs">
            <Button size="xs" onClick={() => void controller.save()}>
              保存画布
            </Button>
            <Button
              size="xs"
              disabled={!editable || !clean(controller)}
              onClick={() => {
                draft.rebase();
                draft.setValue({
                  ...draft.value,
                  requestId: crypto.randomUUID(),
                });
              }}
            >
              已核对，使用当前画布版本
            </Button>
          </Group>
        </Alert>
      )}
      <Button
        variant="filled"
        disabled={!valid}
        loading={busy}
        onClick={() => void submit()}
      >
        确认关联镜头
      </Button>
      <Text fw={600}>此节点的已有关联</Text>
      {!bindings.length && <Text size="sm">尚未关联镜头。</Text>}
      {bindings.map((binding) => (
        <UnbindConnection
          key={binding.id}
          binding={binding}
          shot={shots.find((s) => s.id === binding.shotId)}
          path={scenePath}
          controller={controller}
          readOnly={readOnly || busy}
          changed={changed}
          busyChange={busyChange}
        />
      ))}
    </Stack>
  );
}
function UnbindConnection({
  binding,
  shot,
  path,
  controller,
  readOnly,
  changed,
  busyChange,
}: {
  binding: Binding;
  shot: Schema<"Shot"> | undefined;
  path: string;
  controller: CanvasController;
  readOnly: boolean;
  changed: () => Promise<void>;
  busyChange: (busy: boolean) => void;
}) {
  const session = useSession();
  const [review, setReview] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null);
  const version = controller.getSnapshot().local!.base.revision;
  const current = review === version && clean(controller) && !readOnly && !busy;
  return (
    <div className={classes.choice}>
      <Text size="sm">
        {shot?.label ?? "镜头不可用"} ·{" "}
        {binding.role === "candidate" ? "视频候选" : "待选参考"}
        {!binding.nodeActive ? " · 节点已移除" : ""}
        {shot && shot.specRevisionId !== binding.shotRevisionId
          ? " · 旧要求"
          : ""}
      </Text>
      <ErrorNotice error={error} />
      {review === null ? (
        <Button
          size="xs"
          disabled={readOnly || !clean(controller)}
          onClick={() => setReview(version)}
        >
          解除此关联
        </Button>
      ) : (
        <>
          <Text size="xs">
            只解除刚才核对的关系。候选、素材与当前采用继续保留。
          </Text>
          {review !== version && (
            <Text size="xs">画布又有变化，请取消后重新核对。</Text>
          )}
          <Group>
            <Button
              size="xs"
              disabled={!current}
              loading={busy}
              onClick={() => {
                void (async () => {
                  if (!current) return;
                  setBusy(true);
                  busyChange(true);
                  setError(null);
                  try {
                    const latest = await api<Schema<"SceneCanvas">>(path, {
                      signal: AbortSignal.timeout(15000),
                    });
                    if (latest.bindings.some((b) => b.id === binding.id)) {
                      if (
                        latest.canvas.revision !== review ||
                        !clean(controller)
                      )
                        throw new Error(
                          "画布已变化，请重新核对后解除。原关联仍保留。",
                        );
                      await api(
                        `${path}/nodes/${binding.nodeId}/shot-bindings/${binding.id}`,
                        {
                          method: "DELETE",
                          signal: AbortSignal.timeout(15000),
                          headers: {
                            "X-CSRF-Token": session.csrfToken,
                            "If-Match": `"${review}"`,
                          },
                        },
                      );
                    }
                    setReview(null);
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e
                        : new Error("解除未完成，请刷新核对原关联。"),
                    );
                  } finally {
                    try {
                      await changed();
                    } finally {
                      setBusy(false);
                      busyChange(false);
                    }
                  }
                })();
              }}
            >
              确认解除关联
            </Button>
            <Button size="xs" disabled={busy} onClick={() => setReview(null)}>
              取消
            </Button>
          </Group>
        </>
      )}
    </div>
  );
}

function ShotCanvasPlacement({
  path,
  shot,
  readOnly,
  close,
  place,
}: {
  path: string;
  shot: Schema<"Shot">;
  readOnly: boolean;
  close: () => void;
  place: Placement;
}) {
  const takes = useList<Schema<"Take">>(`${path}/takes?shotId=${shot.id}`);
  const mediaPath = path.split("/projects/")[0]!;
  return (
    <Stack>
      <Group justify="space-between">
        <Text fw={600}>添加到画布 · {shot.label}</Text>
        <Button size="xs" onClick={close}>
          取消
        </Button>
      </Group>
      <Text size="xs">
        明确选择已有候选或镜头参考，先添加独立素材节点，再核对镜头关联。
      </Text>
      <ErrorNotice error={takes.error} retry={() => void takes.refetch()} />
      <Text fw={500}>已有视频候选</Text>
      {takes.isPending && <Loader size="sm" />}
      {takes.data?.map((take) => (
        <PlacementMedia
          key={take.id}
          path={mediaPath}
          mediaId={take.mediaId}
          label={`候选 ${take.id.slice(0, 8)} · ${sourceSeconds(take.range.inUs)}–${sourceSeconds(take.range.outUs)} 秒${take.shotRevisionId !== shot.specRevisionId ? " · 旧要求" : ""}`}
          readOnly={readOnly}
          add={(media) => place(media, shot, take)}
        />
      ))}
      {takes.data?.length === 0 && <Text size="sm">还没有视频候选。</Text>}
      <Text fw={500}>镜头已有参考</Text>
      {shot.spec.references?.map((reference, index) => (
        <PlacementMedia
          key={`${reference.mediaId}:${index}`}
          path={mediaPath}
          mediaId={reference.mediaId}
          label={`镜头参考 · ${referencePurposes[reference.purpose]}`}
          readOnly={readOnly}
          add={(media) =>
            place(media, shot, undefined, reference.assetRevisionId)
          }
        />
      ))}
      {!shot.spec.references?.length && (
        <Text size="sm">还没有镜头默认参考；也可从素材面板添加。</Text>
      )}
    </Stack>
  );
}
function PlacementMedia({
  path,
  mediaId,
  label,
  readOnly,
  add,
}: {
  path: string;
  mediaId: string;
  label: string;
  readOnly: boolean;
  add: (media: Schema<"Media">) => void;
}) {
  const media = useResource<Schema<"Media">>(`${path}/media/${mediaId}`);
  return (
    <div className={classes.choice}>
      <Text size="sm">{label}</Text>
      <ErrorNotice error={media.error} retry={() => void media.refetch()} />
      {media.data && (
        <>
          <MediaPreview path={path} media={media.data} thumbnail />
          <Text size="sm">{media.data.displayName}</Text>
          <Button
            size="xs"
            disabled={readOnly || media.data.status !== "ready"}
            onClick={() => add(media.data!)}
          >
            添加这份素材到画布
          </Button>
        </>
      )}
    </div>
  );
}

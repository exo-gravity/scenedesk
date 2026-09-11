import { reworkScope } from "./prompt-draft";
import { useEffect, useState } from "react";
import {
  Alert,
  Checkbox,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  NumberInput,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import {
  ArrowsClockwise,
  ImageSquare,
  FilmStrip,
  MusicNotes,
} from "@phosphor-icons/react";
import {
  api,
  ApiError,
  useList,
  useResource,
  useSession,
  type Schema,
} from "./api";
import { ErrorNotice, projectPath, tenantPath } from "./common";
import { jobFinished, jobStatusLabel } from "./assistant-session";
import type { PromptDraft } from "./prompt-draft";
import {
  executableImages,
  shotImageRequest,
  canvasImageRequest,
  type ImageCapability,
} from "./image-generation";
import { useGenerationSession } from "./use-generation-session";
import { GeneratedMediaResult } from "./GeneratedMediaResult";
import {
  executableVideos,
  shotVideoRequest,
  canvasVideoRequest,
} from "./video-generation";
import {
  executableAudios,
  shotAudioRequest,
  canvasAudioRequest,
} from "./audio-generation";
import { AudioPlanSources } from "./AudioPlanSources";
import classes from "./image-generation.module.css";
export type MediaInputSource =
  | { kind: "shot"; creation: PromptDraft }
  | {
      kind: "canvas";
      canvas: Schema<"Canvas">;
      sceneId: string;
      nodeId: string;
      awaitingSave: boolean;
      configure: (
        nodeId: string,
        change: Pick<
          Schema<"CanvasDraftContent">,
          "connectionId" | "capabilityId" | "output"
        >,
      ) => void;
      save: () => Promise<Schema<"Canvas">>;
      afterPlacement: (
        placement: Schema<"CanvasResultPlacement">,
      ) => Promise<void>;
      focus: (ids: string[]) => void;
    };
export type MediaGenerationProps = {
  tenantId: string;
  projectId: string;
  source: MediaInputSource;
  active: boolean;
  historyPlanId?: string | undefined;
};
export function MediaGenerationWorkspace(
  props: MediaGenerationProps & { kind: "image" | "video" | "audio" },
) {
  const session = useSession();
  const key =
    props.source.kind === "shot"
      ? `${props.source.creation.source.shotId}${reworkScope(props.source.creation.rework)}`
      : `${props.source.canvas.id}:${props.source.nodeId}`;
  return (
    <GenerationWorkspace
      key={`${session.id}:${props.kind}:${key}`}
      {...props}
    />
  );
}
function GenerationWorkspace({
  kind,
  tenantId,
  projectId,
  source,
  active,
  historyPlanId,
}: MediaGenerationProps & { kind: "image" | "video" | "audio" }) {
  const label = { image: "图片", video: "视频", audio: "音频" }[kind],
    single = { image: "单张图片", video: "单段视频", audio: "单段音频" }[kind],
    next = { image: "下一张图片", video: "下一段视频", audio: "下一段音频" }[
      kind
    ],
    Symbol = { image: ImageSquare, video: FilmStrip, audio: MusicNotes }[kind];
  const session = useSession(),
    tenant = tenantPath(tenantId),
    path = projectPath(tenantId, projectId);
  const subject =
    source.kind === "shot"
      ? {
          kind: "shot" as const,
          shotId: source.creation.source.shotId,
          inputScope: reworkScope(source.creation.rework),
        }
      : {
          kind: "canvas" as const,
          canvasId: source.canvas.id,
          nodeId: source.nodeId,
          sceneId: source.sceneId,
        };
  const { controller, state } = useGenerationSession(
    tenantId,
    projectId,
    subject,
    kind,
  );
  const capabilities = useList<ImageCapability>(
      `${tenant}/capabilities?purpose=${kind}`,
    ),
    models = {
      image: executableImages,
      video: executableVideos,
      audio: executableAudios,
    }[kind](capabilities.data ?? []);
  const [error, setError] = useState<string>();
  const { record, plan, job } = state,
    draft = record?.draft;
  const node =
    source.kind === "canvas"
      ? source.canvas.document.nodes.find((n) => n.id === source.nodeId)
      : undefined;
  const content =
    node?.kind === kind && node.content.type === "draft"
      ? node.content
      : undefined;
  const capabilityId =
    source.kind === "canvas" ? content?.capabilityId : draft?.capabilityId;
  const output =
    (source.kind === "canvas" ? content?.output : draft?.output) ?? {};
  const capability = models.find((c) => c.id === capabilityId),
    frozen = !!record?.planId || !!record?.planRequest,
    disabled = !active || state.busy || !draft;
  const placement = draft?.placement;
  const awaitingSave = source.kind === "canvas" && source.awaitingSave;
  useEffect(() => {
    if (
      capabilities.error instanceof ApiError &&
      [401, 403, 404].includes(capabilities.error.status)
    ) {
      controller.suspend();
      void controller.verify();
    }
  }, [capabilities.error, controller]);
  const change = (id: string, next: Schema<"OutputOptions">) => {
    if (!draft) return;
    setError(undefined);
    if (source.kind === "canvas") {
      const cap = models.find((c) => c.id === id);
      try {
        source.configure(source.nodeId, {
          ...(cap
            ? { connectionId: cap.connectionId, capabilityId: cap.id }
            : {}),
          output: next,
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "草稿尚未更新。");
      }
    } else controller.updateDraft({ ...draft, capabilityId: id, output: next });
  };
  const prepare = () => {
    if (!draft) return;
    setError(undefined);
    void controller.prepareFrom(draft, async () => {
      if (source.kind === "shot") {
        if (!capability) throw Error(`请选择可执行${label}模型。`);
        return {
          image: shotImageRequest,
          video: shotVideoRequest,
          audio: shotAudioRequest,
        }[kind](source.creation, projectId, capability, output);
      }
      const canvas = await source.save();
      if (canvas.id !== source.canvas.id)
        throw Error("画布目标已改变，请重新核对。");
      return {
        image: canvasImageRequest,
        video: canvasVideoRequest,
        audio: canvasAudioRequest,
      }[kind](canvas, source.sceneId, source.nodeId, models);
    });
  };
  const post = <T,>(
    url: string,
    key: string,
    body?: unknown,
    revision?: number,
  ) =>
    api<T>(url, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        "X-CSRF-Token": session.csrfToken,
        "Idempotency-Key": key,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(revision === undefined ? {} : { "If-Match": `"${revision}"` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const recoverArchive = () => {
    if (!draft || !job) return;
    const intent = draft.archiveRequest ?? {
      jobId: job.id,
      key: crypto.randomUUID(),
    };
    void controller
      .commitDraft(
        draft,
        { ...draft, archiveRequest: intent },
        async (current) => {
          await post(
            `${tenant}/generation-jobs/${intent.jobId}/recover-archive`,
            intent.key,
          );
          return { ...current, archiveRequest: undefined };
        },
      )
      .then(() => controller.refresh());
  };
  const reviewPlacement = () => {
    if (
      !draft ||
      !job ||
      job.status !== "succeeded" ||
      source.kind !== "canvas" ||
      !job.mediaIds.length
    )
      return;
    void controller.commitDraft(draft, draft, async (current) => {
      const canvas = await source.save();
      if (canvas.id !== source.canvas.id) throw Error("结果接收画布已改变。");
      const origin = canvas.document.nodes.find((n) => n.id === source.nodeId);
      return {
        ...current,
        placement: {
          phase: "review",
          key: crypto.randomUUID(),
          canvasId: canvas.id,
          revision: canvas.revision,
          input: {
            jobId: job.id,
            mediaIds: [job.mediaIds[0]!],
            position: {
              x: origin ? origin.position.x + origin.width + 64 : 80,
              y: origin?.position.y ?? 80,
            },
          },
        },
      };
    });
  };
  const materialize = () => {
    if (
      !draft ||
      !placement ||
      source.kind !== "canvas" ||
      job?.status !== "succeeded"
    )
      return;
    void controller
      .commitDraft(
        draft,
        { ...draft, placement: { ...placement, phase: "unknown" } },
        async (current, checkCurrent) => {
          try {
            const placed = await post<Schema<"CanvasResultPlacement">>(
              `${path}/canvases/${placement.canvasId}/results`,
              placement.key,
              placement.input,
              placement.revision,
            );
            checkCurrent();
            return {
              ...current,
              placement: { ...placement, phase: "placed", placed },
            };
          } catch (cause) {
            if (cause instanceof ApiError && cause.status === 412)
              return {
                ...current,
                placement: { ...placement, phase: "conflict" },
              };
            throw cause;
          }
        },
      )
      .then(async () => {
        const current = controller.getSnapshot();
        const placed = current.record?.draft.placement;
        if (
          current.access !== "ready" ||
          placed?.phase !== "placed" ||
          !placed.placed
        )
          return;
        try {
          await source.afterPlacement(placed.placed);
        } catch {
          setError(`${label}已加入画布，但当前画布尚未完成刷新，请重新读取。`);
        }
      });
  };
  if (state.access !== "ready")
    return (
      <Alert
        title={
          state.access === "forbidden"
            ? `${label}任务不可访问`
            : `正在核对${label}任务访问`
        }
      >
        <Text size="sm">{state.error ?? "核对后恢复固定输入与任务。"}</Text>
        {state.access === "checking" ? (
          <Loader size="sm" />
        ) : (
          <Button variant="default" onClick={() => void controller.verify()}>
            重新核对访问权限
          </Button>
        )}
      </Alert>
    );
  const resolved = plan?.resolvedInput as
    | (Schema<"ResolvedInput"> & {
        capabilitySnapshot?: ImageCapability;
        output?: Schema<"OutputOptions">;
      })
    | undefined;
  return (
    <Stack className={classes.panel} gap="md" aria-label={`生成${single}`}>
      <Group justify="space-between">
        <Text fw={600}>{`生成${single}`}</Text>
        <Badge variant="light">
          {state.draftSaved ? "本机已保留" : "正在保留"}
        </Badge>
      </Group>
      <Text size="xs" c="dimmed">
        {source.kind === "shot"
          ? `来源：${source.creation.label}的本次提示`
          : `来源：${node?.title ?? `已删除的${label}草稿`}`}
        。先确认固定计划，再执行一次。
      </Text>
      {(error || state.error) && (
        <Alert title="需要处理" role="alert">
          {error ?? state.error}
        </Alert>
      )}
      <ErrorNotice
        error={capabilities.error}
        retry={() => void capabilities.refetch()}
      />
      {!capabilities.isLoading && !capabilities.error && !models.length && (
        <Alert title={`${label}生成暂不可用`}>
          {`尚未配置可执行的${label}模型。提示目标描述不能直接执行，你的创作输入仍保留。`}
        </Alert>
      )}
      {historyPlanId && (
        <Button
          variant="default"
          disabled={state.busy}
          onClick={() =>
            void controller.openExisting(historyPlanId, (plan) => {
              if (
                plan.input.projectId !== projectId ||
                plan.input.purpose !== kind
              )
                throw Error(`这份计划不属于当前${label}工作区。`);
            })
          }
        >
          {`打开所选的固定${label}任务`}
        </Button>
      )}
      <Select
        label={`${label}生成模型`}
        value={capabilityId || null}
        disabled={disabled || frozen || (source.kind === "canvas" && !content)}
        data={models.map((c) => ({
          value: c.id,
          label: `${c.modelVersion}${c.executionMode === "test_fixture" ? " · 受控测试" : ""}`,
        }))}
        onChange={(id) => {
          const cap = models.find((c) => c.id === id);
          change(id ?? "", {
            ...(kind !== "audio" && cap?.allowedResolutions?.length === 1
              ? { resolution: cap.allowedResolutions[0]! }
              : {}),
            ...(kind !== "image" &&
            cap?.minDurationSeconds !== undefined &&
            cap.minDurationSeconds === cap.maxDurationSeconds
              ? { durationSeconds: cap.minDurationSeconds }
              : {}),
          });
        }}
      />
      {kind !== "audio" && (
        <Group grow align="start">
          <Select
            label={`${label}尺寸`}
            value={output.resolution ?? null}
            disabled={disabled || frozen || !capability}
            data={capability?.allowedResolutions ?? []}
            onChange={(resolution) => {
              const {
                aspectRatio: _aspect,
                resolution: _resolution,
                ...rest
              } = output;
              change(capabilityId ?? "", {
                ...rest,
                ...(resolution ? { resolution } : {}),
              });
            }}
          />
          <Select
            label="画幅"
            placeholder={`按${label}尺寸`}
            clearable
            value={output.aspectRatio ?? null}
            disabled={disabled || frozen || !capability}
            data={capability?.allowedAspectRatios ?? []}
            onChange={(aspectRatio) => {
              const { aspectRatio: _old, ...rest } = output;
              change(capabilityId ?? "", {
                ...rest,
                ...(aspectRatio ? { aspectRatio } : {}),
              });
            }}
          />
        </Group>
      )}
      {kind !== "image" && (
        <Stack gap="sm">
          <NumberInput
            label={`${label}时长（秒）`}
            allowDecimal={false}
            min={capability?.minDurationSeconds ?? 1}
            max={capability?.maxDurationSeconds ?? Number.MAX_SAFE_INTEGER}
            value={output.durationSeconds ?? ""}
            disabled={disabled || frozen || !capability}
            onChange={(value) => {
              const { durationSeconds: _old, ...rest } = output;
              change(capabilityId ?? "", {
                ...rest,
                ...(typeof value === "number"
                  ? { durationSeconds: value }
                  : {}),
              });
            }}
          />
          {kind === "video" &&
            (capability?.audioOutput === true ? (
              <Checkbox
                label="同时生成声音"
                checked={output.withAudio === true}
                disabled={disabled || frozen}
                onChange={(event) =>
                  change(capabilityId ?? "", {
                    ...output,
                    withAudio: event.currentTarget.checked,
                  })
                }
              />
            ) : (
              <Text size="xs" c="dimmed">
                {capability?.audioOutput === false
                  ? "当前模型生成无声视频。"
                  : "声音生成能力尚未确认。"}
              </Text>
            ))}
        </Stack>
      )}
      <NumberInput
        label="随机种子（可选）"
        min={0}
        max={2147483647}
        allowDecimal={false}
        value={output.seed ?? ""}
        disabled={disabled || frozen || !capability}
        onChange={(value) => {
          const { seed: _old, ...rest } = output;
          change(capabilityId ?? "", {
            ...rest,
            ...(typeof value === "number" ? { seed: value } : {}),
          });
        }}
      />
      {!plan && awaitingSave && (
        <Text role="status" size="sm">
          先完成画布保存或核对，完成后可准备生成。
        </Text>
      )}
      {!plan && (
        <Button
          leftSection={<Symbol size={16} />}
          disabled={
            disabled ||
            !capability ||
            awaitingSave ||
            (source.kind === "shot" && !source.creation.prompt.trim()) ||
            (source.kind === "canvas" && !content)
          }
          onClick={prepare}
        >
          {record?.planRequest
            ? `恢复原${label}计划请求`
            : `查看${label}生成计划`}
        </Button>
      )}
      {plan && (
        <Stack
          gap="sm"
          className={classes.result}
          aria-label={`固定${label}计划`}
        >
          <Group justify="space-between">
            <Text fw={600}>{`固定${label}计划`}</Text>
            <Badge variant="light">
              {plan.status === "ready"
                ? "可执行"
                : plan.status === "consumed"
                  ? "已提交"
                  : "暂不可执行"}
            </Badge>
          </Group>
          {(plan as Schema<"GenerationPlan"> & { executionMode?: string })
            .executionMode === "test_fixture" && (
            <Alert title={`受控测试${label}`}>
              用于验证生成与归档流程，不代表真实模型效果。
            </Alert>
          )}
          <Text size="sm">
            模型：
            {resolved?.capabilitySnapshot?.modelVersion ??
              capability?.modelVersion}{" "}
            {kind !== "audio" && (
              <>
                {" "}
                · {resolved?.output?.resolution ?? plan.input.output.resolution}
              </>
            )}
          </Text>
          {kind !== "image" && (
            <Text size="sm">
              {resolved?.output?.durationSeconds ??
                plan.input.output.durationSeconds}{" "}
              秒
              {kind === "video" && (
                <>
                  {" "}
                  ·{" "}
                  {(resolved?.output ?? plan.input.output).withAudio
                    ? "生成声音"
                    : "无声视频"}
                </>
              )}
            </Text>
          )}
          <Text size="sm" className={classes.prose}>
            {resolved?.prompt}
          </Text>
          <Text size="xs" c="dimmed">
            固定参考 {resolved?.references.length ?? 0} 个
            {plan.input.assistanceSource
              ? ` · 提示建议 r${plan.input.assistanceSource.revision}`
              : ""}
            。有效至 {new Date(plan.expiresAt).toLocaleString()}。
          </Text>
          {kind === "audio" && resolved && (
            <AudioPlanSources resolved={resolved} />
          )}
          {plan.blockingReasons.map((reason) => (
            <Text size="sm" c="red" key={reason}>
              {reason}
            </Text>
          ))}
          {!record?.execution && (
            <Button
              disabled={
                disabled ||
                plan.status !== "ready" ||
                Date.parse(plan.expiresAt) <= Date.now()
              }
              onClick={() => void controller.execute()}
            >
              {`确认执行${label}生成`}
            </Button>
          )}
          {(!record?.execution || jobFinished(job)) && (
            <Button
              variant="subtle"
              disabled={disabled || placement?.phase === "unknown"}
              onClick={() =>
                draft &&
                void controller.revise(
                  { capabilityId: draft.capabilityId, output: draft.output },
                  draft,
                )
              }
            >
              {`保留原任务，准备${next}`}
            </Button>
          )}
        </Stack>
      )}
      {record?.execution && (
        <Stack gap="sm" className={classes.result}>
          <Group justify="space-between">
            <Text fw={600}>
              {job?.status === "succeeded"
                ? `${label}结果已归档`
                : job
                  ? jobStatusLabel[job.status]
                  : `${label}提交结果待核对`}
            </Text>
            <Button
              variant="subtle"
              leftSection={<ArrowsClockwise size={16} />}
              disabled={state.busy}
              onClick={() => void controller.refresh()}
            >
              {`核对${label}任务`}
            </Button>
          </Group>
          {(!job ||
            ["submission_unknown", "reconciliation_required"].includes(
              job.status,
            )) && (
            <Text size="sm">刷新只读取原任务，未知提交不会再次执行。</Text>
          )}
          {!job && (
            <Button
              variant="default"
              disabled={disabled}
              onClick={() => void controller.resumeSubmission()}
            >
              {`核对后恢复原${label}提交`}
            </Button>
          )}
          {job?.inputOutdated && (
            <Alert>当前来源已有变化，此任务仍保留原固定输入。</Alert>
          )}
          {job?.errorCode && <Text size="sm">{job.errorCode}</Text>}
          {job?.status === "archive_failed" && (
            <Stack>
              <Text size="sm">
                结果保存未完成，可恢复归档。恢复不会重新调用模型。
              </Text>
              <Button
                disabled={disabled || !!draft?.archiveRequest}
                onClick={recoverArchive}
              >
                {`恢复${label}归档`}
              </Button>
            </Stack>
          )}
          {draft?.archiveRequest && (
            <Stack>
              <Text size="sm">归档恢复结果待核对，请先读取原任务。</Text>
              <Button
                disabled={disabled}
                variant="default"
                onClick={() =>
                  draft &&
                  void controller
                    .commitDraft(draft, draft, async (current) => {
                      await api(
                        `${tenant}/generation-jobs/${draft.archiveRequest!.jobId}`,
                        { signal: AbortSignal.timeout(15000) },
                      );
                      return {
                        ...current,
                        archiveRequest: {
                          ...draft.archiveRequest!,
                          checked: true,
                        },
                      };
                    })
                    .then(() => controller.refresh())
                }
              >
                核对归档恢复
              </Button>
              {draft.archiveRequest.checked && (
                <Button
                  disabled={disabled}
                  variant="default"
                  onClick={recoverArchive}
                >
                  继续原归档恢复请求
                </Button>
              )}
            </Stack>
          )}
          {job?.status === "succeeded" &&
            job.mediaIds.map((mediaId) => (
              <GeneratedMediaResult
                kind={kind}
                key={mediaId}
                tenantId={tenantId}
                projectId={projectId}
                jobId={job.id}
                mediaId={mediaId}
              />
            ))}
          {job?.status === "succeeded" &&
            source.kind === "canvas" &&
            !placement && (
              <Button
                disabled={disabled || awaitingSave}
                onClick={reviewPlacement}
              >
                查看添加到画布的位置
              </Button>
            )}
          {placement?.phase === "unknown" && (
            <Alert title="添加结果待核对">
              <Text size="sm">
                {`原${label}与添加请求已保留。恢复会核对同一次添加，不会生成新${label}。`}
              </Text>
              <Button
                disabled={disabled || job?.status !== "succeeded"}
                onClick={materialize}
              >
                恢复本次添加
              </Button>
            </Alert>
          )}
          {placement?.phase === "conflict" && (
            <Alert title="画布已有修改">
              <Text size="sm">{`${label}尚未添加，先保存并核对当前画布。`}</Text>
              <Button
                disabled={disabled || awaitingSave}
                onClick={reviewPlacement}
              >
                重新核对添加位置
              </Button>
            </Alert>
          )}
          {placement?.phase === "placed" && (
            <Alert title="已添加到画布">
              {`结果以独立${label}节点保存。`}
              {source.kind === "canvas" && placement.placed && (
                <Button
                  mt="sm"
                  variant="default"
                  onClick={() =>
                    source.focus(
                      placement.placed!.placements.map((item) => item.nodeId),
                    )
                  }
                >
                  定位{label}结果
                </Button>
              )}
            </Alert>
          )}
        </Stack>
      )}
      {!!record?.previous.length && (
        <details>
          <summary>
            此前{label}任务（{record.previous.length}）
          </summary>
          <Stack mt="sm">
            {record.previous
              .filter((previous) => previous.jobId)
              .map((previous) => (
                <PastMedia
                  kind={kind}
                  key={previous.planId}
                  tenantId={tenantId}
                  projectId={projectId}
                  jobId={previous.jobId!}
                />
              ))}
          </Stack>
        </details>
      )}
      <Modal
        opened={
          placement?.phase === "review" &&
          state.access === "ready" &&
          job?.status === "succeeded"
        }
        title={`确认添加${label}结果`}
        onClose={() =>
          draft &&
          controller.updateDraft({ ...draft, placement: undefined }, true)
        }
        centered
      >
        <Stack>
          <Text>
            {`将已归档的${label}添加为独立节点，放在原草稿旁边；保留原草稿和镜头采用。`}
          </Text>
          <Button
            disabled={disabled || job?.status !== "succeeded"}
            onClick={materialize}
          >
            确认添加到画布
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
function PastMedia({
  kind,
  tenantId,
  projectId,
  jobId,
}: {
  tenantId: string;
  projectId: string;
  jobId: string;
  kind: "image" | "video" | "audio";
}) {
  const label = { image: "图片", video: "视频", audio: "音频" }[kind];
  const job = useResource<Schema<"GenerationJob">>(
    `${tenantPath(tenantId)}/generation-jobs/${jobId}`,
  );
  if (job.error)
    return <ErrorNotice error={job.error} retry={() => void job.refetch()} />;
  return (
    <Stack gap="xs">
      <Text size="sm">
        {job.data?.status === "succeeded"
          ? `已归档${label}`
          : job.data
            ? jobStatusLabel[job.data.status]
            : "正在读取任务"}
      </Text>
      {job.data?.status === "succeeded" &&
        job.data.mediaIds.map((mediaId) => (
          <GeneratedMediaResult
            kind={kind}
            key={mediaId}
            tenantId={tenantId}
            projectId={projectId}
            jobId={jobId}
            mediaId={mediaId}
          />
        ))}
    </Stack>
  );
}

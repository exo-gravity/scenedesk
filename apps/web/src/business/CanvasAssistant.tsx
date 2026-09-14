import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { ArrowsClockwise, Sparkle, X } from "@phosphor-icons/react";
import { editingCanonical } from "@drama/domain";
import { api, useList, useResource, useSession, type Schema } from "./api";
import { ErrorNotice, projectPath, tenantPath } from "./common";
import type { CanvasController } from "./canvas-controller";
import { jobFinished, jobStatusLabel } from "./assistant-session";
import { GenerationJobControls } from "./GenerationJobControls";
import { referencePurposes, options } from "./asset-queries";
import { useCanvasAssistantSession } from "./use-canvas-assistant-session";
import {
  applicationPrompt,
  assertCanvasApplication,
  canvasAssistancePlan,
  captureCanvasSources,
  sameCanvasSources,
  requestCanvasApplication,
  CanvasApplicationError,
  type CanvasAssistantDraft,
  type FixedCanvasSource,
} from "./canvas-assistant";
import classes from "./image-generation.module.css";
export type CanvasAssistantProps = {
  tenantId: string;
  projectId: string;
  sceneId: string;
  controller: CanvasController;
  active: boolean;
  visible: boolean;
  requestedContext?: { nodeIds: string[]; nonce: number } | undefined;
};
export function CanvasAssistant(props: CanvasAssistantProps) {
  const session = useSession();
  const canvasId = props.controller.getSnapshot().local?.base.id;
  if (!canvasId) return <Text>正在读取画布上下文。</Text>;
  return (
    <CanvasAssistantContent
      key={`${session.id}:${canvasId}`}
      {...props}
      canvasId={canvasId}
    />
  );
}
function CanvasAssistantContent({
  tenantId,
  projectId,
  sceneId: _sceneId,
  controller: canvasController,
  active,
  visible,
  requestedContext,
  canvasId,
}: CanvasAssistantProps & { canvasId: string }) {
  const session = useSession(),
    path = projectPath(tenantId, projectId),
    tenant = tenantPath(tenantId);
  const { controller, state } = useCanvasAssistantSession(
    tenantId,
    projectId,
    canvasId,
  );
  const capabilities = useList<Schema<"Capability">>(
    `${tenant}/capabilities`,
    state.access === "ready",
  );
  const { record, plan, job } = state,
    draft = record?.draft;
  const [inspectedArtifact, setInspectedArtifact] = useState<{
    id: string;
    revision: number;
  }>();
  const cache = useQueryClient();
  const artifactListPath = `${path}/assistance-artifacts?canvasId=${canvasId}&kind=prepare_prompt`;
  const savedArtifacts = useList<Schema<"AssistanceArtifact">>(
    artifactListPath,
    state.access === "ready",
  );
  useEffect(() => {
    if (job?.assistanceArtifactId)
      void cache.invalidateQueries({
        queryKey: ["user", session.userId, artifactListPath],
      });
  }, [cache, session.userId, artifactListPath, job?.assistanceArtifactId]);
  const historyArtifact = useResource<Schema<"AssistanceArtifact">>(
    `${path}/assistance-artifacts/${inspectedArtifact?.id ?? "unavailable"}/revisions/${inspectedArtifact?.revision ?? 1}`,
    state.access === "ready" && !!inspectedArtifact,
  );
  const artifact = inspectedArtifact
    ? !historyArtifact.error &&
      historyArtifact.data?.id === inspectedArtifact.id &&
      historyArtifact.data.revision === inspectedArtifact.revision
      ? historyArtifact.data
      : undefined
    : draft?.artifact;
  const frozen = !!record?.planId || !!record?.planRequest;
  const disabled = !active || !visible || state.busy || !draft;
  const [error, setError] = useState<string>();
  const [targetNodeId, setTargetNodeId] = useState<string | null>(null);
  const [applyMode, setApplyMode] = useState<"replace" | "append">("replace");
  const seenContext = useRef<number | undefined>(undefined);
  const canvasState = canvasController.getSnapshot();
  const assistant = capabilities.data?.find(
    (c) => c.id === draft?.capabilityId,
  );
  const target = capabilities.data?.find(
    (c) => c.id === draft?.targetCapabilityId,
  );
  const textModels =
    capabilities.data?.filter(
      (c) => c.enabled && c.purpose === "creative_assistance",
    ) ?? [];
  const targets =
    capabilities.data?.filter(
      (c) => c.enabled && ["image", "video", "audio"].includes(c.purpose),
    ) ?? [];
  const modelLabel = (c: Schema<"Capability">) =>
    `${c.modelVersion}${(c as { executionMode?: string }).executionMode === "test_fixture" ? " · 受控测试" : ""}`;
  const update = (patch: Partial<CanvasAssistantDraft>) => {
    if (draft) controller.updateDraft({ ...draft, ...patch }, true);
  };
  const savedCanvas = async () => {
    await canvasController.save();
    const current = canvasController.getSnapshot();
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
      throw Error("请先处理画布保存与恢复，助手不会采用未核对的来源。");
    return current.local.base;
  };
  useEffect(() => {
    if (
      !visible ||
      !active ||
      !requestedContext ||
      requestedContext.nonce === seenContext.current ||
      state.access !== "ready" ||
      state.busy ||
      !draft
    )
      return;
    seenContext.current = requestedContext.nonce;
    if (frozen) {
      setError(
        "当前尝试的上下文已固定。请先保留原尝试并准备新建议，再明确加入这些对象。",
      );
      return;
    }
    const initial = canvasController.getSnapshot();
    if (
      !initial.local ||
      initial.accessChecking ||
      initial.phase === "forbidden"
    )
      return;
    let captured: ReturnType<typeof captureCanvasSources>;
    try {
      captured = captureCanvasSources(
        { ...initial.local.base, document: initial.local.document },
        requestedContext.nodeIds,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "请重新核对所选上下文。",
      );
      return;
    }
    void controller.commitDraft(draft, draft, async (current) => {
      const saved = await savedCanvas();
      const sources = captureCanvasSources(saved, requestedContext.nodeIds);
      if (
        sources.some(
          (source, index) =>
            editingCanonical(source.content) !==
            editingCanonical(captured[index]?.content),
        )
      )
        throw Error("保存期间选定来源已改变，请重新明确加入。");
      const merged = [...current.sources];
      for (const source of sources)
        if (
          !merged.some(
            (prior) =>
              prior.source.canvasId === source.source.canvasId &&
              prior.source.nodeId === source.source.nodeId,
          )
        )
          merged.push(source);
      if (merged.length > 20)
        throw Error("本次最多 20 个固定节点，请先移除不需要的上下文。");
      return { ...current, sources: merged };
    });
  }, [
    requestedContext,
    visible,
    active,
    state.access,
    state.busy,
    draft,
    frozen,
    controller,
    canvasController,
  ]);
  const application = draft?.application;
  const readArtifact = () => {
    if (!draft || !job?.assistanceArtifactId || !plan) return;
    void controller.commitDraft(draft, draft, async (current) => {
      const found = await api<Schema<"AssistanceArtifact">>(
        `${path}/assistance-artifacts/${job.assistanceArtifactId}`,
      );
      const sources =
        (
          found.resolvedInput as Schema<"ResolvedInput"> & {
            canvasSnapshots?: { source: FixedCanvasSource }[];
          }
        ).canvasSnapshots?.map((item) => item.source) ?? [];
      if (
        found.projectId !== projectId ||
        found.generationJobId !== job.id ||
        found.request.kind !== "prepare_prompt" ||
        found.request.targetCapabilityId !==
          plan.input.assistance?.targetCapabilityId ||
        found.request.targetCapabilityRevision !==
          plan.input.assistance?.targetCapabilityRevision ||
        !sameCanvasSources(
          sources,
          current.sources.map((item) => item.source),
        )
      )
        throw Error("这份建议与本次固定来源不一致，原输入仍保留。");
      setInspectedArtifact(undefined);
      return { ...current, artifact: found };
    });
  };
  const reviewApplication = () => {
    if (
      !draft ||
      !artifact ||
      !targetNodeId ||
      application?.phase === "unknown" ||
      application?.phase === "missing"
    )
      return;
    const selectedTarget = targetNodeId,
      mode = applyMode,
      fixedArtifact = structuredClone(artifact);
    void controller.commitDraft(draft, draft, async (current) => {
      const saved = await savedCanvas();
      const node = saved.document.nodes.find((n) => n.id === selectedTarget);
      if (
        node?.content.type !== "draft" ||
        node.content.capabilityId !==
          fixedArtifact.request.targetCapabilityId ||
        node.kind !==
          capabilities.data?.find(
            (c) => c.id === fixedArtifact.request.targetCapabilityId,
          )?.purpose
      )
        throw Error(
          "目标草稿的类型或模型不匹配，请在草稿中先明确配置同一目标能力。",
        );
      return {
        ...current,
        previousApplications: current.application
          ? [...(current.previousApplications ?? []), current.application]
          : current.previousApplications,
        application: {
          phase: "review",
          key: crypto.randomUUID(),
          revision: saved.revision,
          body: {
            applicationId: crypto.randomUUID(),
            artifactId: fixedArtifact.id,
            artifactRevision: fixedArtifact.revision,
            nodeId: node.id,
            mode,
          },
          targetTitle: node.title,
          beforePrompt: node.content.prompt,
          afterPrompt: applicationPrompt(
            node.content.prompt,
            fixedArtifact.body.prompt,
            mode,
          ),
        },
      };
    });
  };
  const apply = () => {
    if (
      !draft ||
      !application ||
      !["review", "missing"].includes(application.phase)
    )
      return;
    const intent = structuredClone(application);
    void controller
      .commitDraft(
        draft,
        { ...draft, application: { ...intent, phase: "unknown" } },
        async (current, checkCurrent) => {
          try {
            const result = await requestCanvasApplication(
              `${path}/canvases/${canvasId}/assistance-applications`,
              {
                method: "POST",
                signal: AbortSignal.timeout(15000),
                headers: {
                  "Content-Type": "application/json",
                  "X-CSRF-Token": session.csrfToken,
                  "Idempotency-Key": intent.key,
                  "If-Match": `"${intent.revision}"`,
                },
                body: JSON.stringify(intent.body),
              },
            );
            checkCurrent();
            assertCanvasApplication(intent, result, canvasId);
            return {
              ...current,
              application: { ...intent, phase: "applied", result },
            };
          } catch (cause) {
            if (
              cause instanceof CanvasApplicationError &&
              cause.verified &&
              ((cause.status === 412 && cause.code === "VERSION_CONFLICT") ||
                (cause.status === 409 &&
                  cause.code === "CANVAS_ASSISTANCE_CONFLICT"))
            )
              return {
                ...current,
                application: { ...intent, phase: "blocked" },
              };
            throw cause;
          }
        },
      )
      .then(async () => {
        if (
          controller.getSnapshot().record?.draft.application?.phase ===
          "applied"
        )
          await canvasController.refresh();
      });
  };
  const recoverApplication = () => {
    if (!draft || !application) return;
    const intent = structuredClone(application);
    void controller
      .commitDraft(draft, draft, async (current, checkCurrent) => {
        try {
          const result = await requestCanvasApplication(
            `${path}/canvases/${canvasId}/assistance-applications/${intent.body.applicationId}`,
            { signal: AbortSignal.timeout(15000) },
          );
          checkCurrent();
          assertCanvasApplication(intent, result, canvasId);
          return {
            ...current,
            application: { ...intent, phase: "applied", result },
          };
        } catch (cause) {
          if (
            cause instanceof CanvasApplicationError &&
            cause.verified &&
            cause.status === 404 &&
            cause.code === "CANVAS_ASSISTANCE_APPLICATION_NOT_FOUND"
          )
            return { ...current, application: { ...intent, phase: "missing" } };
          throw cause;
        }
      })
      .then(async () => {
        if (
          controller.getSnapshot().record?.draft.application?.phase ===
          "applied"
        )
          await canvasController.refresh();
      });
  };
  if (
    state.access !== "ready" ||
    canvasState.accessChecking ||
    canvasState.phase === "forbidden"
  )
    return (
      <Alert title="正在核对画布助手访问">
        <Text size="sm">
          {state.error ?? "仅在当前身份与画布权限核对后恢复输入。"}
        </Text>
        <Button variant="subtle" onClick={() => void controller.verify()}>
          重新核对访问
        </Button>
      </Alert>
    );
  const applicable =
    canvasState.local?.document.nodes.filter(
      (n) =>
        n.content.type === "draft" &&
        n.content.capabilityId === artifact?.request.targetCapabilityId &&
        n.kind ===
          capabilities.data?.find(
            (c) => c.id === artifact?.request.targetCapabilityId,
          )?.purpose,
    ) ?? [];
  return (
    <Stack
      className={classes.canvasAssistant}
      gap="sm"
      aria-label="画布创作助手"
    >
      <Text size="sm">
        仅使用你明确加入的对象，准备一份可核对的提示建议。不会自动读取整场或执行生成。
      </Text>
      {(error || state.error) && (
        <Alert title="需要处理" role="alert">
          {error ?? state.error}
        </Alert>
      )}
      <Group justify="space-between">
        <Text size="xs">固定上下文 · {draft?.sources.length ?? 0} / 20</Text>
        <Text size="xs" role="status" c="dimmed">
          {state.draftSaved ? "本机已保留" : "正在保留"}
        </Text>
      </Group>
      {!draft?.sources.length && (
        <Text size="sm" c="dimmed">
          在画布选中对象后，明确选择“加入助手上下文”。无需绑定镜头。
        </Text>
      )}
      {draft?.sources.map((item, index) => (
        <div
          className={classes.assistantSource}
          key={`${item.source.canvasId}:${item.source.nodeId}`}
        >
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm" fw={500}>
              {index + 1}. {item.title}
            </Text>
            <Button
              size="compact-xs"
              variant="subtle"
              aria-label={`移除助手上下文 ${item.title}`}
              disabled={disabled || frozen}
              onClick={() =>
                update({ sources: draft.sources.filter((_, i) => i !== index) })
              }
            >
              <X size={14} />
            </Button>
          </Group>
          <Text size="xs" c="dimmed">
            画布 r{item.source.canvasRevision} · {item.kind}
          </Text>
          <details>
            <summary>查看固定内容</summary>
            <Text size="sm" className={classes.prose}>
              {item.content.type === "text"
                ? item.content.text
                : item.content.type === "draft"
                  ? item.content.prompt
                  : `固定媒体 ${item.content.mediaId}${item.content.assetRevisionId ? ` · 资产版本 ${item.content.assetRevisionId}` : ""}`}
            </Text>
          </details>
          {item.content.type === "media" && (
            <Select
              size="xs"
              label="本次参考用途"
              value={item.source.purpose ?? null}
              disabled={disabled || frozen}
              data={options(referencePurposes)}
              onChange={(purpose) => {
                if (purpose)
                  update({
                    sources: draft.sources.map((source, i) =>
                      i === index
                        ? {
                            ...source,
                            source: {
                              ...source.source,
                              purpose:
                                purpose as Schema<"Reference">["purpose"],
                            },
                          }
                        : source,
                    ),
                  });
              }}
            />
          )}
        </div>
      ))}
      <ErrorNotice
        error={capabilities.error}
        retry={() => void capabilities.refetch()}
      />
      <div className={classes.assistantModels}>
        <Select
          label="助手能力"
          size="sm"
          value={draft?.capabilityId || null}
          data={textModels.map((c) => ({ value: c.id, label: modelLabel(c) }))}
          disabled={disabled || frozen}
          onChange={(id) => update({ capabilityId: id ?? "" })}
        />
        <Select
          label="提示用于哪项生成能力"
          size="sm"
          value={draft?.targetCapabilityId || null}
          data={targets.map((c) => ({
            value: c.id,
            label: `${modelLabel(c)} · ${c.purpose}`,
          }))}
          disabled={disabled || frozen}
          onChange={(id) => {
            const cap = targets.find((c) => c.id === id);
            update({
              targetCapabilityId: id ?? "",
              ...(cap ? { targetCapabilityRevision: cap.revision } : {}),
            });
          }}
        />
      </div>
      {!capabilities.isLoading && !capabilities.error && !textModels.length && (
        <Alert title="画布助手暂不可用">
          尚未配置可用助手服务，已选上下文与本次要求会保留。
        </Alert>
      )}
      <Textarea
        label="本次要求"
        placeholder="例如：保留钥匙和手部关系，准备自然的拿取动作提示。"
        minRows={3}
        autosize
        maxRows={8}
        value={draft?.instruction ?? ""}
        disabled={disabled || frozen}
        onChange={(e) => update({ instruction: e.currentTarget.value })}
      />
      {!plan && (
        <Button
          leftSection={<Sparkle size={16} />}
          disabled={disabled || !assistant || !target || !draft?.sources.length}
          onClick={() => {
            try {
              if (draft && assistant && target)
                void controller.prepare(
                  canvasAssistancePlan(draft, projectId, assistant, target),
                );
            } catch (cause) {
              setError(
                cause instanceof Error ? cause.message : "请核对固定上下文。",
              );
            }
          }}
        >
          {record?.planRequest ? "恢复原助手计划" : "核对助手计划"}
        </Button>
      )}
      {plan && (
        <Stack className={classes.result} gap="xs">
          <Group justify="space-between">
            <Text fw={600}>固定助手尝试</Text>
            <Badge variant="light">{plan.status}</Badge>
          </Group>
          <Text size="xs">
            上下文 {draft?.sources.length} 项 · 目标能力 r
            {plan.input.assistance?.targetCapabilityRevision}
          </Text>
          <Text size="sm" className={classes.prose}>
            {plan.resolvedInput.prompt}
          </Text>
          {(plan as { executionMode?: string }).executionMode ===
            "test_fixture" && (
            <Alert>
              受控测试身份：仅用于验证协议与恢复，不代表真实模型效果。
            </Alert>
          )}
          {plan.blockingReasons.map((reason) => (
            <Text key={reason} size="sm" c="red">
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
              确认执行助手准备
            </Button>
          )}
          {record?.execution && (
            <>
              <Text role="status">
                {job?.status === "succeeded"
                  ? "提示建议已准备"
                  : job
                    ? jobStatusLabel[job.status]
                    : "提交结果待核对"}
              </Text>
              <Button
                variant="subtle"
                leftSection={<ArrowsClockwise size={14} />}
                disabled={state.busy}
                onClick={() => void controller.refresh()}
              >
                查询原助手任务
              </Button>
              {!job && (
                <Button
                  variant="subtle"
                  disabled={disabled}
                  onClick={() => void controller.resumeSubmission()}
                >
                  核对后恢复原助手提交
                </Button>
              )}
              {job && (
                <GenerationJobControls
                  job={job}
                  cancellation={record.cancellation}
                  active={active && visible}
                  busy={state.busy}
                  label="这次画布助手任务"
                  requestCancellation={(intent) =>
                    controller.requestCancellation(intent)
                  }
                />
              )}
              {job?.assistanceArtifactId && (
                <Button
                  variant="default"
                  disabled={disabled}
                  onClick={readArtifact}
                >
                  查看固定建议与差异
                </Button>
              )}
            </>
          )}
        </Stack>
      )}
      <details>
        <summary>画布建议历史 · {savedArtifacts.data?.length ?? 0}</summary>
        <ErrorNotice
          error={savedArtifacts.error}
          retry={() => void savedArtifacts.refetch()}
        />
        <Stack gap="xs">
          {savedArtifacts.data?.map((item) => (
            <Button
              key={item.id}
              variant="subtle"
              size="xs"
              disabled={
                disabled ||
                (!!application &&
                  ["review", "unknown", "missing"].includes(application.phase))
              }
              onClick={() =>
                setInspectedArtifact({ id: item.id, revision: item.revision })
              }
            >
              建议 {item.id.slice(0, 8)} · r{item.revision}
              {item.createdAt
                ? ` · ${new Date(item.createdAt).toLocaleString()}`
                : ""}
            </Button>
          ))}
        </Stack>
      </details>
      {inspectedArtifact && (
        <Group>
          <Text size="xs">
            正在查看固定历史建议 r{inspectedArtifact.revision}，本次要求未改变
          </Text>
          <Button
            variant="subtle"
            size="xs"
            onClick={() => setInspectedArtifact(undefined)}
          >
            返回本次建议
          </Button>
        </Group>
      )}
      <ErrorNotice
        error={historyArtifact.error}
        retry={() => void historyArtifact.refetch()}
      />
      {artifact && (
        <Stack className={classes.result} gap="sm" aria-label="固定画布建议">
          <Text fw={600}>建议 r{artifact.revision} · 先核对，再明确应用</Text>
          {artifact.inputOutdated && (
            <Alert>
              原来源已变化。固定建议保留，请重新核对；不能应用过期来源。
            </Alert>
          )}
          <Text className={classes.prose} size="sm">
            {artifact.body.prompt}
          </Text>
          <details>
            <summary>保留、修改与参考建议</summary>
            <Text className={classes.prose} size="sm">
              {[
                ...artifact.body.retain.map((s) => `保留：${s}`),
                ...artifact.body.change.map((s) => `修改：${s}`),
                artifact.body.notes,
              ]
                .filter(Boolean)
                .join("\n")}
            </Text>
            {artifact.body.referenceSuggestions.map((r, i) => (
              <Text key={i} size="sm">
                参考建议 {i + 1} · {r.purpose} · {r.mediaId}
              </Text>
            ))}
            <Text size="xs" c="dimmed">
              应用只修改提示正文，不自动连线、更换模型或采用成果。
            </Text>
          </details>
          <Select
            label="明确应用到哪个草稿"
            value={targetNodeId}
            data={applicable.map((n) => ({ value: n.id, label: n.title }))}
            disabled={
              disabled ||
              (!!application &&
                ["review", "unknown", "missing"].includes(application.phase))
            }
            onChange={setTargetNodeId}
          />
          {!applicable.length && (
            <Text size="sm">
              请先给目标草稿配置与建议相同的媒体类型及生成能力。
            </Text>
          )}
          <Select
            label="应用方式"
            value={applyMode}
            disabled={
              disabled ||
              (!!application &&
                ["review", "unknown", "missing"].includes(application.phase))
            }
            data={[
              { value: "replace", label: "替换提示正文" },
              { value: "append", label: "追加到现有提示" },
            ]}
            onChange={(value) =>
              setApplyMode(value === "append" ? "append" : "replace")
            }
          />
          {(!application ||
            ["applied", "blocked"].includes(application.phase)) && (
            <Button
              variant="default"
              disabled={disabled || !targetNodeId || artifact.inputOutdated}
              onClick={reviewApplication}
            >
              查看应用差异
            </Button>
          )}
        </Stack>
      )}
      {application && (
        <Stack
          className={classes.applicationReview}
          gap="sm"
          aria-label="画布建议应用核对"
        >
          <Text fw={600}>
            应用到 {application.targetTitle} · 画布 r{application.revision}
          </Text>
          <div className={classes.promptDiff}>
            <div>
              <Text size="xs" c="dimmed">
                原提示
              </Text>
              <Text size="sm" className={classes.prose}>
                {application.beforePrompt || "（空）"}
              </Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">
                应用后
              </Text>
              <Text size="sm" className={classes.prose}>
                {application.afterPrompt}
              </Text>
            </div>
          </div>
          {application.phase === "review" && (
            <Group>
              <Button disabled={disabled} onClick={apply}>
                确认应用这份建议
              </Button>
              <Button
                variant="subtle"
                disabled={disabled}
                onClick={() => update({ application: undefined })}
              >
                返回检查建议
              </Button>
            </Group>
          )}
          {application.phase === "unknown" && (
            <Alert title="应用结果待核对">
              <Text size="sm">
                原目标、正文和版本已保留。查询不会重新生成或新建应用。
              </Text>
              <Button disabled={disabled} onClick={recoverApplication}>
                查询原应用记录
              </Button>
            </Alert>
          )}
          {application.phase === "missing" && (
            <Alert title="尚未找到原应用">
              <Button disabled={disabled} onClick={apply}>
                明确重送原应用请求
              </Button>
              <Button
                variant="subtle"
                disabled={disabled}
                onClick={recoverApplication}
              >
                再次查询原记录
              </Button>
            </Alert>
          )}
          {application.phase === "blocked" && (
            <Alert title="画布版本或应用身份冲突">
              原修改与本次应用意图已保留。先核对当前画布，再明确查看新的应用差异。
            </Alert>
          )}
          {application.phase === "applied" && (
            <Alert title="建议已应用">
              服务器已保存为画布 r
              {application.result?.application.resultCanvasRevision}
              。其他节点、参考、模型与当前采用保持不变。
            </Alert>
          )}
        </Stack>
      )}
      {plan && (!record?.execution || jobFinished(job)) && (
        <Button
          variant="subtle"
          disabled={
            disabled ||
            (!!application &&
              ["unknown", "missing", "review"].includes(application.phase))
          }
          onClick={() => {
            if (draft)
              void controller.revise(
                { ...draft, artifact: undefined, application: undefined },
                draft,
              );
          }}
        >
          保留原尝试，准备新的建议
        </Button>
      )}
    </Stack>
  );
}

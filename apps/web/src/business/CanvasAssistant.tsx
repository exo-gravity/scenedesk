import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Popover,
  Select,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import {
  ArrowsClockwise,
  PaperPlaneRight,
  Paperclip,
  SlidersHorizontal,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import { editingCanonical } from "@drama/domain";
import { api, useList, useSession, type Schema } from "./api";
import { ErrorNotice, projectPath, tenantPath } from "./common";
import type { CanvasController } from "./canvas-controller";
import { jobFinished, jobStatusLabel } from "./assistant-session";
import { GenerationJobControls } from "./GenerationJobControls";
import { referencePurposes, options } from "./asset-queries";
import { useCanvasAssistantSession } from "./use-canvas-assistant-session";
import {
  canvasAssistantReply,
  retainCanvasAssistantReply,
  canvasReplyContinuationPending,
  isCanvasDiscussion,
  applicationPrompt,
  assertCanvasApplication,
  captureCanvasSources,
  sameCanvasSources,
  requestCanvasApplication,
  CanvasApplicationError,
  canvasApplicationWasRefused,
  type CanvasAssistantSource,
  type CanvasAssistantDraft,
  type FixedCanvasSource,
} from "./canvas-assistant";
import classes from "./canvas-assistant-chat.module.css";
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
  const {
    controller,
    state,
    deliveries,
    sendMessage: sendRetainedMessage,
    returnRejectedToEditing,
  } = useCanvasAssistantSession(tenantId, projectId, canvasId);
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
  const artifactListPath = `${path}/assistance-artifacts?canvasId=${canvasId}`;
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
  const historyArtifact = useFreshCanvasResource<Schema<"AssistanceArtifact">>(
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
  const messageKind = draft?.nextKind ?? draft?.kind ?? "prepare_prompt";
  const discussion = messageKind === "discuss";
  const fixedDiscussion = plan?.input.assistance?.kind === "discuss";
  const disabled = !active || !visible || state.busy || !draft;
  const [error, setError] = useState<string>();
  const [executionDetails, setExecutionDetails] = useState<string>();
  const [targetNodeId, setTargetNodeId] = useState<string | null>(null);
  const [applyMode, setApplyMode] = useState<"replace" | "append">("replace");
  const [attachmentReview, setAttachmentReview] = useState<{
    before: CanvasAssistantSource[];
    after: CanvasAssistantSource[];
    revision: number;
  }>();
  const seenContext = useRef<number | undefined>(undefined);
  const readAttempt = useRef<string | undefined>(undefined);
  const conversation = useRef<HTMLDivElement>(null);
  const conversationContent = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
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
      const merged = [...(current.nextSources ?? current.sources)];
      for (const source of sources) {
        const index = merged.findIndex(
          (prior) =>
            prior.source.canvasId === source.source.canvasId &&
            prior.source.nodeId === source.source.nodeId,
        );
        if (index < 0) merged.push(source);
        else merged[index] = source;
      }
      if (merged.length > 20)
        throw Error("本次最多 20 个固定节点，请先移除不需要的上下文。");
      return frozen
        ? { ...current, nextSources: merged }
        : { ...current, sources: merged, nextSources: undefined };
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
        editingCanonical(found.request) !==
          editingCanonical(plan.input.assistance) ||
        (isCanvasDiscussion(found) && found.request.canvasId !== canvasId) ||
        !sameCanvasSources(
          sources,
          current.sources.map((item) => item.source),
        )
      )
        throw Error("这份建议与本次固定来源不一致，原输入仍保留。");
      canvasAssistantReply(found);
      setInspectedArtifact(undefined);
      return retainCanvasAssistantReply(current, found);
    });
  };
  useEffect(() => {
    if (!draft || state.busy || state.access !== "ready" || !visible || !active)
      return;
    const defaults: Partial<CanvasAssistantDraft> = {};
    if (!draft.capabilityId && textModels.length === 1)
      defaults.capabilityId = textModels[0]!.id;
    if (!discussion && !draft.targetCapabilityId && targets.length === 1) {
      defaults.targetCapabilityId = targets[0]!.id;
      defaults.targetCapabilityRevision = targets[0]!.revision;
    }
    if (Object.keys(defaults).length) update(defaults);
  }, [draft, capabilities.data, state.busy, state.access, visible, active]);
  useEffect(() => {
    if (
      !visible ||
      state.access !== "ready" ||
      state.busy ||
      !job?.assistanceArtifactId ||
      !plan ||
      (draft?.artifact && !canvasReplyContinuationPending(draft)) ||
      readAttempt.current === job.assistanceArtifactId
    )
      return;
    readAttempt.current = job.assistanceArtifactId;
    readArtifact();
  }, [
    job?.assistanceArtifactId,
    draft?.artifact,
    state.busy,
    state.access,
    visible,
    plan,
  ]);
  useEffect(() => {
    const scroller = conversation.current,
      content = conversationContent.current;
    if (!visible || !scroller || !content) return;
    let contentHeight = scroller.scrollHeight,
      viewportHeight = scroller.clientHeight;
    const follow = () => {
      contentHeight = scroller.scrollHeight;
      viewportHeight = scroller.clientHeight;
      if (followLatest.current) scroller.scrollTop = contentHeight;
    };
    const onScroll = () => {
      // Resizing or loading an older turn is not a request to read history.
      if (
        contentHeight !== scroller.scrollHeight ||
        viewportHeight !== scroller.clientHeight
      ) {
        follow();
        return;
      }
      followLatest.current =
        scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 32;
    };
    const observer = new ResizeObserver(follow);
    observer.observe(content);
    observer.observe(scroller);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    follow();
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [visible, state.access, canvasState.accessChecking, canvasState.phase]);
  const sendMessage = () => {
    setError(undefined);
    if (!assistant || (!discussion && !target)) {
      setError(
        discussion
          ? "请在设置中选择已配置的文字助手，消息会保留。"
          : "请为具体生成提示选择助手与目标能力。",
      );
      return;
    }
    followLatest.current = true;
    if (conversation.current)
      conversation.current.scrollTop = conversation.current.scrollHeight;
    void sendRetainedMessage(assistant, target, async (sources) => {
      const saved = await api<Schema<"Canvas">>(
        `${path}/canvases/${canvasId}`,
        { signal: AbortSignal.timeout(15000) },
      );
      if (
        saved.id !== canvasId ||
        saved.projectId !== projectId ||
        sources.some(
          (source) =>
            source.source.canvasId !== saved.id ||
            source.source.canvasRevision !== saved.revision,
        )
      )
        throw Error(
          "节点附件仍是旧画布版本。请先核对当前附件并明确确认，再发送；尚未提交新计划。",
        );
      if (!sources.length) return;
      const fresh = captureCanvasSources(
        saved,
        sources.map((source) => source.source.nodeId),
      );
      if (
        fresh.some(
          (source, index) =>
            editingCanonical(source.content) !==
            editingCanonical(sources[index]?.content),
        )
      )
        throw Error(
          "节点附件正文未通过核对。请查看当前附件差异；尚未提交新计划。",
        );
    }).catch((cause) =>
      setError(
        cause instanceof Error ? cause.message : "消息仍保留，请核对后继续。",
      ),
    );
  };
  const reviewAttachments = () => {
    if (!draft) return;
    setError(undefined);
    void controller.commitDraft(draft, draft, async (current) => {
      const before = structuredClone(current.nextSources ?? current.sources);
      const saved = await savedCanvas();
      const after = captureCanvasSources(
        saved,
        before.map((item) => item.source.nodeId),
      ).map((item, index) => ({
        ...item,
        source: {
          ...item.source,
          ...(before[index]!.source.purpose
            ? { purpose: before[index]!.source.purpose }
            : {}),
        },
      }));
      setAttachmentReview({ before, after, revision: saved.revision });
      return current;
    });
  };
  const confirmAttachments = () => {
    if (!draft || !attachmentReview) return;
    const review = attachmentReview;
    void controller
      .commitDraft(draft, draft, async (current) => {
        if (
          editingCanonical(current.nextSources ?? current.sources) !==
          editingCanonical(review.before)
        )
          throw Error("附件选择已改变，请重新核对。");
        const saved = await savedCanvas();
        if (saved.revision !== review.revision)
          throw Error("核对期间画布又有修改，请重新查看附件差异。");
        const fresh = captureCanvasSources(
          saved,
          review.after.map((item) => item.source.nodeId),
        );
        if (
          fresh.some(
            (item, index) =>
              editingCanonical(item.content) !==
              editingCanonical(review.after[index]?.content),
          )
        )
          throw Error("节点正文已改变，请重新查看附件差异。");
        return frozen
          ? { ...current, nextSources: review.after }
          : { ...current, sources: review.after, nextSources: undefined };
      })
      .then(() => {
        const current = controller.getSnapshot();
        if (
          current.draftSaved &&
          current.record &&
          editingCanonical(
            current.record.draft.nextSources ?? current.record.draft.sources,
          ) === editingCanonical(review.after)
        )
          setAttachmentReview(undefined);
      });
  };
  const continueFrom = (fixed: Schema<"AssistanceArtifact">) => {
    if (!draft) return;
    void controller.commitDraft(draft, draft, async (current) => {
      const found = await api<Schema<"AssistanceArtifact">>(
        `${path}/assistance-artifacts/${fixed.id}/revisions/${fixed.revision}`,
        { signal: AbortSignal.timeout(15000) },
      );
      if (
        found.id !== fixed.id ||
        found.revision !== fixed.revision ||
        found.projectId !== projectId ||
        found.generationJobId !== fixed.generationJobId ||
        (isCanvasDiscussion(found) && found.request.canvasId !== canvasId)
      )
        throw Error("这份历史建议未通过当前权限与固定版本核对。");
      canvasAssistantReply(found);
      return {
        ...current,
        replyTo: { artifactId: found.id, revision: found.revision },
        replyChoice: "explicit",
        nextKind: isCanvasDiscussion(found) ? "discuss" : "prepare_prompt",
        ...(isCanvasDiscussion(found)
          ? {}
          : {
              targetCapabilityId: found.request.targetCapabilityId!,
              targetCapabilityRevision: found.request.targetCapabilityRevision,
            }),
      };
    });
  };
  const reviewApplication = () => {
    if (
      !draft ||
      !artifact ||
      isCanvasDiscussion(artifact) ||
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
            if (canvasApplicationWasRefused(intent, cause))
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
  const composerSources = draft?.nextSources ?? draft?.sources ?? [];
  const composerText =
    draft?.nextInstruction ?? (frozen ? "" : (draft?.instruction ?? ""));
  const pendingApplication =
    !!application &&
    ["review", "unknown", "missing"].includes(application.phase);
  const pendingPlan = !!record?.planRequest && !record.planId;
  const currentDelivery = deliveries.receipts.find(
    (item) => item.key === record?.planRequest?.key,
  );
  const pendingJob = !!record?.execution && !jobFinished(job);
  const fixedInput = plan?.input ?? record?.planRequest?.input;
  const earlierJobs = new Set(
    record?.previous.flatMap((entry) => (entry.jobId ? [entry.jobId] : [])),
  );
  const olderArtifacts = !savedArtifacts.error
    ? (savedArtifacts.data
        ?.filter(
          (entry) =>
            entry.generationJobId !== job?.id &&
            !earlierJobs.has(entry.generationJobId),
        )
        .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "")) ??
      [])
    : [];
  return (
    <section className={classes.chat} aria-label="画布创作助手">
      <div
        className={classes.conversation}
        ref={conversation}
        role="log"
        tabIndex={0}
        aria-label="画布助手对话"
        aria-live="polite"
        aria-relevant="additions"
      >
        <div className={classes.conversationContent} ref={conversationContent}>
          {!fixedInput &&
            !record?.previous.length &&
            !olderArtifacts.length && (
              <div className={classes.welcome}>
                <Sparkle size={24} weight="light" aria-hidden="true" />
                <Text fw={600}>想创作什么？直接聊聊</Text>
                <Text size="sm" c="dimmed">
                  从故事、人物或一个画面开始。需要具体参考时，再把画布对象作为附件加入。
                </Text>
              </div>
            )}
          <ErrorNotice
            error={savedArtifacts.error}
            retry={() => void savedArtifacts.refetch()}
          />
          {deliveries.receipts.some(
            (item) =>
              item.phase === "rejected" &&
              item.key !== record?.planRequest?.key,
          ) && (
            <details>
              <summary>未创建的计划记录</summary>
              {deliveries.receipts
                .filter(
                  (item) =>
                    item.phase === "rejected" &&
                    item.key !== record?.planRequest?.key,
                )
                .map((item) => (
                  <div className={classes.executionCard} key={item.key}>
                    <Text size="xs" c="dimmed">
                      原请求 {item.key.slice(0, 8)} · 明确未创建
                    </Text>
                    <Text className={classes.prose} size="sm">
                      {item.input.prompt}
                    </Text>
                    <Text size="xs">{item.refusal?.message}</Text>
                  </div>
                ))}
            </details>
          )}
          {olderArtifacts.map((item) => (
            <SavedCanvasConversation
              key={item.id}
              path={path}
              tenant={tenant}
              projectId={projectId}
              artifactSummary={item}
              disabled={disabled || pendingApplication}
              onInspect={setInspectedArtifact}
              onContinue={continueFrom}
            />
          ))}
          {record?.previous.map((entry) => (
            <SavedCanvasConversation
              key={entry.planId}
              path={path}
              tenant={tenant}
              projectId={projectId}
              entry={entry}
              disabled={disabled || pendingApplication}
              onInspect={setInspectedArtifact}
              onContinue={continueFrom}
            />
          ))}
          {fixedInput && (
            <article
              className={classes.userMessage}
              aria-label="本轮已发送消息"
            >
              <Text size="xs" c="dimmed">
                你 ·{" "}
                {plan?.createdAt
                  ? new Date(plan.createdAt).toLocaleString()
                  : "本轮固定消息"}
              </Text>
              <Text className={classes.prose} size="sm">
                {fixedInput.prompt || "（仅固定节点上下文）"}
              </Text>
              <SourceAttachments sources={draft?.sources ?? []} readonly />
              {fixedInput.assistanceSource && (
                <Text
                  size="xs"
                  c="dimmed"
                  title={`${fixedInput.assistanceSource.artifactId} · r${fixedInput.assistanceSource.revision}`}
                >
                  {fixedInput.assistance?.kind === "discuss"
                    ? "引用已选回复"
                    : `基于建议 ${fixedInput.assistanceSource.artifactId.slice(0, 8)} · r${fixedInput.assistanceSource.revision}`}
                </Text>
              )}
            </article>
          )}
          {pendingPlan && (
            <div className={classes.executionCard} role="status">
              {currentDelivery?.phase === "rejected" ? (
                <>
                  <Text fw={500} size="sm">
                    这条消息未创建计划
                  </Text>
                  <Text size="sm">{currentDelivery.refusal?.message}</Text>
                  <Text size="xs" c="dimmed">
                    首次明确拒绝。原正文与请求记录保留，可以返回编辑后再发送。
                  </Text>
                  <Button
                    variant="default"
                    size="xs"
                    disabled={disabled}
                    onClick={() =>
                      void returnRejectedToEditing().catch((cause) =>
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : "原请求仍保留。",
                        ),
                      )
                    }
                  >
                    保留拒绝记录，返回编辑
                  </Button>
                </>
              ) : (
                <>
                  <Text fw={500} size="sm">
                    消息计划待核对
                  </Text>
                  <Text size="sm">
                    原消息与请求身份已保留。恢复只核对原计划。
                  </Text>
                  <Button
                    variant="default"
                    size="xs"
                    disabled={disabled}
                    onClick={() =>
                      void controller.prepare(record!.planRequest!.input)
                    }
                  >
                    恢复原助手计划
                  </Button>
                </>
              )}
            </div>
          )}
          {plan &&
            (!fixedDiscussion ||
              !artifact ||
              job?.status !== "succeeded" ||
              executionDetails === plan.id) && (
              <div className={classes.executionCard} aria-label="本轮助手执行">
                <Group justify="space-between">
                  <Text size="sm" fw={600}>
                    {record?.execution
                      ? job?.status === "succeeded"
                        ? fixedDiscussion
                          ? "回复已就绪"
                          : "建议已准备"
                        : job
                          ? jobStatusLabel[job.status]
                          : "提交结果待核对"
                      : fixedDiscussion
                        ? "原讨论计划已保留，尚未执行"
                        : "计划已固定，等待确认"}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {plan.id.slice(0, 8)}
                  </Text>
                </Group>
                <Text size="xs" c="dimmed">
                  {draft?.sources.length ?? 0} 个附件 · 助手 r
                  {plan.capabilityRevision}
                  {!fixedDiscussion && (
                    <>
                      {" "}
                      · 目标 r{plan.input.assistance?.targetCapabilityRevision}
                    </>
                  )}
                </Text>
                {plan.executionMode === "test_fixture" && (
                  <Text size="xs" c="dimmed">
                    本地受控测试 · 执行不代表真实模型效果
                  </Text>
                )}
                <details>
                  <summary>查看固定输入与执行设置</summary>
                  <Text size="xs">
                    助手 {plan.input.capabilityId} · r{plan.capabilityRevision}
                  </Text>
                  {!fixedDiscussion && (
                    <Text size="xs">
                      目标 {plan.input.assistance?.targetCapabilityId} · r
                      {plan.input.assistance?.targetCapabilityRevision}
                    </Text>
                  )}
                  <Text size="xs">
                    有效至 {new Date(plan.expiresAt).toLocaleString()}
                  </Text>
                  <Text className={classes.prose} size="sm">
                    {plan.resolvedInput.prompt}
                  </Text>
                </details>
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
                    {fixedDiscussion ? "继续原讨论回复" : "确认执行助手准备"}
                  </Button>
                )}
                {record?.execution && (
                  <>
                    <Group gap="xs">
                      <Button
                        variant="subtle"
                        size="compact-xs"
                        leftSection={<ArrowsClockwise size={14} />}
                        disabled={state.busy}
                        onClick={() => void controller.refresh()}
                      >
                        查询原助手任务
                      </Button>
                      {!job && (
                        <Button
                          variant="subtle"
                          size="compact-xs"
                          disabled={disabled}
                          onClick={() => void controller.resumeSubmission()}
                        >
                          核对后恢复原助手提交
                        </Button>
                      )}
                    </Group>
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
                    {job?.assistanceArtifactId && !draft?.artifact && (
                      <Button
                        variant="default"
                        size="xs"
                        disabled={disabled}
                        onClick={readArtifact}
                      >
                        读取原任务的固定建议
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
          {inspectedArtifact && (
            <Group>
              <Text size="xs">
                正在查看固定历史建议 r{inspectedArtifact.revision}
                ，本次要求未改变
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
            <Stack
              className={classes.result}
              gap="sm"
              aria-label="固定画布建议"
            >
              <Group justify="space-between">
                <Text
                  size="sm"
                  fw={600}
                  title={`${artifact.id} · r${artifact.revision}`}
                >
                  {isCanvasDiscussion(artifact) ? "AI 助手" : "画布助手"}
                </Text>
                {!isCanvasDiscussion(artifact) && (
                  <Text size="xs" c="dimmed">
                    固定建议 r{artifact.revision}
                  </Text>
                )}
              </Group>
              {artifact.executionMode === "test_fixture" && (
                <Text size="xs" c="dimmed">
                  受控测试输出 · 非真实模型回复
                </Text>
              )}
              {artifact.inputOutdated && (
                <Alert>
                  {isCanvasDiscussion(artifact)
                    ? "这份回复的附件已有变化。固定讨论保留，继续时请明确核对附件。"
                    : "原来源已变化。固定建议保留，请重新核对；不能应用过期来源。"}
                </Alert>
              )}
              <Text className={classes.prose} size="sm">
                <CanvasReplyText artifact={artifact} />
              </Text>
              {!isCanvasDiscussion(artifact) && (
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
              )}
              <Group>
                <Button
                  variant="subtle"
                  size="compact-sm"
                  disabled={disabled}
                  onClick={() => continueFrom(artifact)}
                >
                  {isCanvasDiscussion(artifact)
                    ? "继续讨论"
                    : "基于这份建议继续"}
                </Button>
                {isCanvasDiscussion(artifact) &&
                  plan &&
                  artifact.generationJobId === job?.id && (
                    <Button
                      variant="subtle"
                      size="compact-xs"
                      onClick={() =>
                        setExecutionDetails(
                          executionDetails === plan.id ? undefined : plan.id,
                        )
                      }
                    >
                      执行记录
                    </Button>
                  )}
              </Group>
              {!isCanvasDiscussion(artifact) && (
                <details className={classes.applyOptions}>
                  <summary>应用到画布草稿</summary>
                  <Select
                    label="明确应用到哪个草稿"
                    value={targetNodeId}
                    data={applicable.map((n) => ({
                      value: n.id,
                      label: n.title,
                    }))}
                    disabled={
                      disabled ||
                      (!!application &&
                        ["review", "unknown", "missing"].includes(
                          application.phase,
                        ))
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
                        ["review", "unknown", "missing"].includes(
                          application.phase,
                        ))
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
                      disabled={
                        disabled || !targetNodeId || artifact.inputOutdated
                      }
                      onClick={reviewApplication}
                    >
                      查看应用差异
                    </Button>
                  )}
                </details>
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
                <Alert title="这次应用未执行">
                  画布版本、固定来源或目标输入未通过核对。原修改与应用意图已保留；请检查当前画布或重新准备建议，再明确查看新的应用差异。
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
        </div>
      </div>
      <form
        className={classes.composer}
        aria-label="画布助手消息输入"
        onSubmit={(event) => {
          event.preventDefault();
          sendMessage();
        }}
      >
        {(error || state.error) && (
          <Alert title="需要处理" role="alert">
            {error ?? state.error}
          </Alert>
        )}
        <ErrorNotice
          error={capabilities.error}
          retry={() => void capabilities.refetch()}
        />
        <SourceAttachments
          sources={composerSources}
          readonly={disabled}
          onChange={(sources) =>
            update(
              frozen
                ? { nextSources: sources }
                : { sources, nextSources: undefined },
            )
          }
        />
        {!!composerSources.length && (
          <div className={classes.attachmentCheck}>
            <Button
              size="compact-xs"
              variant="subtle"
              disabled={disabled}
              onClick={reviewAttachments}
            >
              核对当前附件
            </Button>
            <details>
              <summary>核对会做什么</summary>
              <Text size="xs" c="dimmed">
                先保存当前画布并展示附件差异。只有确认后才更新本条消息附件，旧轮次不变；已删除节点请明确移除附件。
              </Text>
            </details>
          </div>
        )}
        {attachmentReview && (
          <div className={classes.attachmentReview} aria-label="当前附件差异">
            <Text size="sm" fw={600}>
              核对到画布 r{attachmentReview.revision}
            </Text>
            {attachmentReview.after.map((item, index) => (
              <details key={item.source.nodeId}>
                <summary>
                  {item.title} · r
                  {attachmentReview.before[index]?.source.canvasRevision} → r
                  {item.source.canvasRevision} ·{" "}
                  {editingCanonical(item.content) ===
                  editingCanonical(attachmentReview.before[index]?.content)
                    ? "正文未变"
                    : "正文已变"}
                </summary>
                <div className={classes.promptDiff}>
                  <div>
                    <Text size="xs" c="dimmed">
                      原附件
                    </Text>
                    <Text size="sm" className={classes.prose}>
                      {sourceText(attachmentReview.before[index]!)}
                    </Text>
                  </div>
                  <div>
                    <Text size="xs" c="dimmed">
                      当前附件
                    </Text>
                    <Text size="sm" className={classes.prose}>
                      {sourceText(item)}
                    </Text>
                  </div>
                </div>
              </details>
            ))}
            <Group>
              <Button
                size="xs"
                disabled={disabled}
                onClick={confirmAttachments}
              >
                使用已核对的附件
              </Button>
              <Button
                size="xs"
                variant="subtle"
                onClick={() => setAttachmentReview(undefined)}
              >
                保留原附件
              </Button>
            </Group>
          </div>
        )}
        {draft?.replyTo && (
          <div className={classes.replyAttachment}>
            <Text
              size="xs"
              title={`${draft.replyTo.artifactId} · r${draft.replyTo.revision}`}
            >
              {discussion
                ? draft.replyChoice === "automatic"
                  ? "承接上一轮对话"
                  : "引用已选回复"
                : `基于固定回复 ${draft.replyTo.artifactId.slice(0, 8)} · r${draft.replyTo.revision}`}
            </Text>
            <ActionIcon
              variant="subtle"
              size="sm"
              aria-label="移除所承接的建议"
              disabled={disabled}
              onClick={() =>
                update({ replyTo: undefined, replyChoice: "none" })
              }
            >
              <X size={14} />
            </ActionIcon>
          </div>
        )}
        {draft && canvasReplyContinuationPending(draft) && (
          <Button
            size="compact-xs"
            variant="subtle"
            disabled={disabled}
            onClick={readArtifact}
          >
            核对最新回复与续聊上下文
          </Button>
        )}
        <Textarea
          aria-label="发送给画布助手"
          placeholder={
            discussion ? "说说你的创作想法…" : "描述希望准备的生成提示…"
          }
          minRows={3}
          maxRows={7}
          autosize
          value={composerText}
          disabled={disabled}
          onChange={(event) =>
            update({ nextInstruction: event.currentTarget.value })
          }
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              (event.metaKey || event.ctrlKey) &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              sendMessage();
            }
          }}
        />
        <div className={classes.composerActions}>
          <Popover position="top-start" width={300} trapFocus>
            <Popover.Target>
              <Button
                variant="subtle"
                size="compact-xs"
                leftSection={<SlidersHorizontal size={15} />}
                aria-label="对话设置"
              >
                {assistant ? modelLabel(assistant) : "选择助手"}
                {!discussion &&
                  (target ? ` · ${target.purpose}` : " · 选择目标")}
              </Button>
            </Popover.Target>
            <Popover.Dropdown>
              <Stack gap="sm">
                <Text size="sm" fw={600}>
                  本条消息设置
                </Text>
                <Select
                  label="助手模型"
                  size="sm"
                  value={draft?.capabilityId || null}
                  data={textModels.map((c) => ({
                    value: c.id,
                    label: modelLabel(c),
                  }))}
                  disabled={disabled}
                  onChange={(id) => update({ capabilityId: id ?? "" })}
                />
                <Select
                  label="本条消息"
                  size="sm"
                  value={messageKind}
                  data={[
                    { value: "discuss", label: "自由讨论" },
                    { value: "prepare_prompt", label: "准备生成提示" },
                  ]}
                  disabled={disabled || !!draft?.replyTo}
                  onChange={(value) =>
                    update({
                      nextKind:
                        value === "prepare_prompt"
                          ? "prepare_prompt"
                          : "discuss",
                    })
                  }
                />
                {!discussion && (
                  <Select
                    label="建议用于"
                    size="sm"
                    value={draft?.targetCapabilityId || null}
                    data={targets.map((c) => ({
                      value: c.id,
                      label: `${modelLabel(c)} · ${c.purpose}`,
                    }))}
                    disabled={disabled || !!draft?.replyTo}
                    onChange={(id) => {
                      const cap = targets.find((c) => c.id === id);
                      update({
                        targetCapabilityId: id ?? "",
                        ...(cap
                          ? { targetCapabilityRevision: cap.revision }
                          : {}),
                      });
                    }}
                  />
                )}
                {draft?.replyTo && (
                  <Text size="xs" c="dimmed">
                    这条消息承接固定回复，沿用其讨论或提示类型。切换类型前请明确移除该回复附件。
                  </Text>
                )}
                <Text size="xs" c="dimmed">
                  {discussion
                    ? "发送即请求这一条文字回复，不生成媒体或修改画布。"
                    : "发送准备固定提示计划；执行和应用到画布分别确认。"}
                </Text>
              </Stack>
            </Popover.Dropdown>
          </Popover>
          <Button
            type="submit"
            size="compact-sm"
            aria-label={discussion ? "发送讨论消息" : "发送消息并核对计划"}
            leftSection={<PaperPlaneRight size={15} />}
            disabled={
              disabled ||
              !composerText.trim() ||
              !assistant ||
              (!discussion && (!target || !composerSources.length)) ||
              pendingPlan ||
              pendingJob ||
              pendingApplication
            }
          >
            发送
          </Button>
        </div>
        <Group justify="space-between" gap="xs">
          <Text size="xs" c="dimmed" role="status">
            {state.draftSaved ? "本机已保留" : "正在保留"}
          </Text>
          <Text size="xs" c="dimmed">
            ⌘ / Ctrl + Enter 发送
          </Text>
        </Group>
        {!capabilities.isLoading &&
        !capabilities.error &&
        !textModels.length ? (
          <Text size="xs" c="dimmed">
            尚未连接可执行的助手。消息与附件会保留。
          </Text>
        ) : (assistant as { executionMode?: string } | undefined)
            ?.executionMode === "test_fixture" ? (
          <Text size="xs" c="dimmed">
            当前助手为受控测试身份，没有真实模型调用。
          </Text>
        ) : null}
        {(pendingPlan || pendingJob || pendingApplication) && (
          <Text size="xs" c="dimmed">
            后续输入会保留；请先处理上方
            {pendingApplication
              ? "建议应用"
              : pendingJob
                ? "原任务"
                : "原消息计划"}
            ，再发送下一条。
          </Text>
        )}
        {plan && !record?.execution && !pendingApplication && (
          <Text size="xs" c="dimmed">
            发送下一条会保留上轮未执行的计划。
          </Text>
        )}
      </form>
    </section>
  );
}

function SourceAttachments({
  sources,
  readonly,
  onChange,
}: {
  sources: CanvasAssistantSource[];
  readonly: boolean;
  onChange?: (sources: CanvasAssistantSource[]) => void;
}) {
  if (!sources.length)
    return readonly ? null : (
      <Text size="xs" c="dimmed">
        附件可选：需要具体参考时，从画布明确加入对象。
      </Text>
    );
  return (
    <details className={classes.attachments}>
      <summary>
        <Paperclip size={14} aria-hidden="true" />
        <span>{sources.length} 个节点附件</span>
        <span className={classes.attachmentNames}>
          {sources
            .slice(0, 2)
            .map((item) => item.title)
            .join("、")}
          {sources.length > 2 ? "…" : ""}
        </span>
      </summary>
      <div className={classes.attachmentList}>
        {sources.map((item, index) => (
          <div
            className={classes.attachment}
            key={`${item.source.canvasId}:${item.source.nodeId}`}
          >
            <Group justify="space-between" wrap="nowrap">
              <Text size="xs" fw={500}>
                {index + 1}. {item.title}
              </Text>
              {onChange && (
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  aria-label={`移除助手上下文 ${item.title}`}
                  disabled={readonly}
                  onClick={() =>
                    onChange(sources.filter((_, i) => i !== index))
                  }
                >
                  <X size={14} />
                </ActionIcon>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              画布 r{item.source.canvasRevision} · {item.kind}
            </Text>
            <details>
              <summary>查看固定内容</summary>
              <Text className={classes.prose} size="sm">
                {item.content.type === "text"
                  ? item.content.text
                  : item.content.type === "draft"
                    ? item.content.prompt
                    : `固定媒体 ${item.content.mediaId}${item.content.assetRevisionId ? ` · 资产版本 ${item.content.assetRevisionId}` : ""}`}
              </Text>
            </details>
            {item.content.type === "media" &&
              (readonly || !onChange ? (
                <Text size="xs">
                  参考用途：
                  {referencePurposes[item.source.purpose ?? "composition"] ??
                    item.source.purpose}
                </Text>
              ) : (
                <Select
                  label="本次参考用途"
                  size="xs"
                  value={item.source.purpose ?? null}
                  data={options(referencePurposes)}
                  disabled={readonly}
                  onChange={(purpose) => {
                    if (purpose)
                      onChange(
                        sources.map((source, i) =>
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
                      );
                  }}
                />
              ))}
          </div>
        ))}
      </div>
    </details>
  );
}
function SavedCanvasConversation({
  path,
  tenant,
  projectId,
  entry,
  artifactSummary,
  disabled,
  onInspect,
  onContinue,
}: {
  path: string;
  tenant: string;
  projectId: string;
  entry?: { planId: string; jobId?: string };
  artifactSummary?: Schema<"AssistanceArtifact">;
  disabled: boolean;
  onInspect: (artifact: { id: string; revision: number }) => void;
  onContinue: (artifact: Schema<"AssistanceArtifact">) => void;
}) {
  const priorJob = useFreshCanvasResource<Schema<"GenerationJob">>(
    `${tenant}/generation-jobs/${entry?.jobId ?? artifactSummary?.generationJobId ?? "unavailable"}`,
    !!(entry?.jobId || artifactSummary),
  );
  const job = !priorJob.error ? priorJob.data : undefined;
  const planId = entry?.planId ?? job?.planId;
  const priorPlan = useFreshCanvasResource<Schema<"GenerationPlan">>(
    `${tenant}/generation-plans/${planId ?? "unavailable"}`,
    !!planId,
  );
  const artifactId = artifactSummary?.id ?? job?.assistanceArtifactId;
  const artifactRevision = artifactSummary?.revision ?? 1;
  const priorArtifact = useFreshCanvasResource<Schema<"AssistanceArtifact">>(
    `${path}/assistance-artifacts/${artifactId ?? "unavailable"}/revisions/${artifactRevision}`,
    !!(artifactSummary || job?.assistanceArtifactId),
  );
  const plan =
    !priorJob.error &&
    !priorPlan.error &&
    priorPlan.data?.input.projectId === projectId
      ? priorPlan.data
      : undefined;
  const result =
    !priorJob.error &&
    !priorPlan.error &&
    !priorArtifact.error &&
    priorArtifact.data?.projectId === projectId &&
    priorArtifact.data.id === artifactId &&
    priorArtifact.data.revision === artifactRevision &&
    !!job &&
    priorArtifact.data.generationJobId === job.id
      ? priorArtifact.data
      : undefined;
  return (
    <div className={classes.savedTurn}>
      <ErrorNotice
        error={priorJob.error ?? priorPlan.error ?? priorArtifact.error}
        retry={() => {
          void priorJob.refetch();
          void priorPlan.refetch();
          void priorArtifact.refetch();
        }}
      />
      {plan && (
        <article className={classes.userMessage}>
          <Text size="xs" c="dimmed" title={plan.id}>
            你 ·{" "}
            {plan.createdAt
              ? new Date(plan.createdAt).toLocaleString()
              : plan.input.assistance?.kind === "discuss"
                ? "已发送"
                : `固定计划 ${plan.id.slice(0, 8)}`}
          </Text>
          <Text className={classes.prose} size="sm">
            {plan.input.prompt || "（仅固定节点上下文）"}
          </Text>
        </article>
      )}
      {result ? (
        <article className={classes.assistantMessage}>
          <Text
            size="xs"
            c="dimmed"
            title={`${result.id} · r${result.revision}`}
          >
            {isCanvasDiscussion(result)
              ? "AI 助手"
              : `${artifactSummary ? "固定建议" : "原任务回复"} · r${result.revision}`}
            {result.executionMode === "test_fixture" ? " · 受控测试" : ""}
          </Text>
          <Text className={classes.prose} size="sm">
            <CanvasReplyText artifact={result} />
          </Text>
          <Group gap="xs">
            <Button
              variant="subtle"
              size="compact-xs"
              disabled={disabled}
              onClick={() => onContinue(result)}
            >
              {isCanvasDiscussion(result) ? "继续讨论" : "基于这份建议继续"}
            </Button>
            <Button
              variant="subtle"
              size="compact-xs"
              disabled={disabled}
              onClick={() =>
                onInspect({ id: result.id, revision: result.revision })
              }
            >
              {isCanvasDiscussion(result)
                ? "查看固定讨论"
                : "查看建议与应用差异"}
            </Button>
          </Group>
        </article>
      ) : (
        plan && (
          <Text size="xs" c="dimmed">
            {job
              ? job.status === "succeeded"
                ? "建议读取中"
                : jobStatusLabel[job.status]
              : "已保留的计划 · 尚无执行回执"}
          </Text>
        )
      )}
    </div>
  );
}

/** Every mounted history/selection and access recheck gets a fresh authorized GET. */
function useFreshCanvasResource<T>(path: string, enabled: boolean) {
  const [retry, setRetry] = useState(0);
  const token = useMemo(() => ({}), [path, enabled, retry]);
  const [read, setRead] = useState<{
    token: object;
    data?: T;
    error?: Error;
  }>();
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    void api<T>(path, { signal: abort.signal }).then(
      (data) => {
        if (!abort.signal.aborted) setRead({ token, data });
      },
      (cause) => {
        if (!abort.signal.aborted)
          setRead({
            token,
            error:
              cause instanceof Error
                ? cause
                : Error("历史记录未完成当前访问核对。"),
          });
      },
    );
    return () => abort.abort();
  }, [path, enabled, token]);
  return {
    data: enabled && read?.token === token ? read.data : undefined,
    error: enabled && read?.token === token ? (read.error ?? null) : null,
    refetch: () => setRetry((value) => value + 1),
  };
}

function sourceText(item: CanvasAssistantSource) {
  return item.content.type === "text"
    ? item.content.text
    : item.content.type === "draft"
      ? item.content.prompt
      : `固定媒体 ${item.content.mediaId}${item.content.assetRevisionId ? ` · 资产版本 ${item.content.assetRevisionId}` : ""}`;
}

function CanvasReplyText({
  artifact,
}: {
  artifact: Schema<"AssistanceArtifact">;
}) {
  try {
    return <>{canvasAssistantReply(artifact)}</>;
  } catch (cause) {
    return (
      <Text component="span" size="sm" c="red">
        {cause instanceof Error ? cause.message : "回复尚未核对。"}
      </Text>
    );
  }
}

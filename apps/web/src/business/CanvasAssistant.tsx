import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Menu,
  Popover,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  ArrowsClockwise,
  ArrowUp,
  ArrowLeft,
  CaretDown,
  CaretRight,
  ClockCounterClockwise,
  ChatCircle,
  FilmStrip,
  GearSix,
  Plus,
  TextT,
  Paperclip,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import { editingCanonical } from "@drama/domain";
import { api, useList, useSession, type Schema } from "./api";
import { ErrorNotice, projectPath, tenantPath } from "./common";
import type { CanvasController } from "./canvas-controller";
import { jobFinished, jobStatusLabel } from "./assistant-session";
import { GenerationJobControls } from "./GenerationJobControls";
import { MediaPreview } from "./MediaPreview";
import { referencePurposes, options } from "./asset-queries";
import { useCanvasAssistantSession } from "./use-canvas-assistant-session";
import {
  canvasAssistantReply,
  beginCanvasAssistantTopic,
  beginCanvasAssistantPrompt,
  beginCanvasAssistantDiscussion,
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
type AttachmentReview = {
  before: CanvasAssistantSource[];
  after: CanvasAssistantSource[];
  revision: number;
};
type ReviewFocus = { token: object; target: "review" | "input" } & (
  | {
      subject: "application";
      expected: CanvasAssistantDraft["application"];
    }
  | {
      subject: "attachments";
      expected: AttachmentReview | undefined;
      sources?: CanvasAssistantSource[];
    }
);
export type CanvasAssistantProps = {
  tenantId: string;
  projectId: string;
  sceneId: string;
  controller: CanvasController;
  active: boolean;
  visible: boolean;
  onPrepareStoryboard?: () => void;
  onClose?: () => void;
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
  onPrepareStoryboard,
  onClose,
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
  const [localActionPending, setLocalActionPending] = useState(false);
  const disabled =
    !active || !visible || state.busy || localActionPending || !draft;
  const [error, setError] = useState<string>();
  const [executionDetails, setExecutionDetails] = useState<string>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [referencePicker, setReferencePicker] = useState(false);
  const [composerMenu, setComposerMenu] = useState<"model" | "task">();
  const [referenceQuery, setReferenceQuery] = useState("");
  const [topicNotice, setTopicNotice] = useState<string>();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [targetNodeId, setTargetNodeId] = useState<string | null>(null);
  const [applyMode, setApplyMode] = useState<"replace" | "append">("replace");
  const [attachmentReview, setAttachmentReview] = useState<AttachmentReview>();
  const [reviewFocus, setReviewFocus] = useState<ReviewFocus>();
  const pendingReviewAction = useRef<object | undefined>(undefined);
  const applicationReviewElement = useRef<HTMLDivElement>(null);
  const attachmentReviewElement = useRef<HTMLDivElement>(null);
  const seenContext = useRef<number | undefined>(undefined);
  const readAttempt = useRef<string | undefined>(undefined);
  const conversation = useRef<HTMLDivElement>(null);
  const conversationContent = useRef<HTMLDivElement>(null);
  const inspectedResult = useRef<HTMLDivElement>(null);
  const pendingInspection = useRef<
    { id: string; revision: number } | undefined
  >(undefined);
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
  const targetOrder: Record<string, number> = { image: 0, video: 1, audio: 2 };
  const targets =
    capabilities.data
      ?.filter(
        (c) => c.enabled && ["image", "video", "audio"].includes(c.purpose),
      )
      .sort(
        (a, b) =>
          (targetOrder[a.purpose] ?? 3) - (targetOrder[b.purpose] ?? 3) ||
          a.modelVersion.localeCompare(b.modelVersion, "zh-CN") ||
          a.id.localeCompare(b.id),
      ) ?? [];
  const purposeLabel = (purpose: string) =>
    ({ image: "图片", video: "视频", audio: "音频" } as Record<string, string>)[
      purpose
    ] ?? purpose;
  const modelLabel = (c: Schema<"Capability">) =>
    `${c.modelVersion}${c.executionMode === "test_fixture" ? " · 演示" : ""}`;
  const targetLabel = (c: Schema<"Capability">) =>
    `${purposeLabel(c.purpose)} · ${modelLabel(c)}${c.mode === "target_profile_fixture" ? " · 仅提示目标" : ""}`;
  const selectedModelLabel = discussion
    ? assistant && modelLabel(assistant)
    : target && targetLabel(target);
  const modelChipLabel = (() => {
    if (discussion && assistant)
      return assistant.executionMode === "test_fixture"
        ? "演示助手"
        : assistant.modelVersion;
    if (!discussion && target) {
      const name =
        target.mode === "target_profile_fixture"
          ? "演示提示目标"
          : target.executionMode === "test_fixture"
            ? "演示模型"
            : target.modelVersion;
      return `${purposeLabel(target.purpose)} · ${name}`;
    }
    if (capabilities.isPending || capabilities.isFetching) return "读取模型…";
    if (capabilities.error) return "模型读取失败";
    if (discussion ? draft?.capabilityId : draft?.targetCapabilityId)
      return "原模型不可用";
    if (!(discussion ? textModels : targets).length)
      return discussion ? "暂无助手模型" : "暂无提示目标";
    return discussion ? "选择助手模型" : "选择目标模型";
  })();
  const quotedReply = useFreshCanvasResource<Schema<"AssistanceArtifact">>(
    `${path}/assistance-artifacts/${draft?.replyTo?.artifactId ?? "unavailable"}/revisions/${draft?.replyTo?.revision ?? 1}`,
    state.access === "ready" &&
      !!draft?.replyTo &&
      draft.replyChoice !== "automatic",
  );
  const focusInput = () =>
    requestAnimationFrame(() =>
      inputRef.current?.focus({ preventScroll: true }),
    );
  const changeComposerMenu = (menu: "model" | "task", opened: boolean) => {
    setComposerMenu((current) =>
      opened ? menu : current === menu ? undefined : current,
    );
    if (opened) setReferencePicker(false);
  };
  useEffect(() => {
    if (!visible || historyOpen) {
      setReferencePicker(false);
      setComposerMenu(undefined);
    }
  }, [visible, historyOpen]);
  const inspectArtifact = (value: { id: string; revision: number }) => {
    const selection = { id: value.id, revision: value.revision };
    pendingInspection.current = selection;
    followLatest.current = false;
    setInspectedArtifact(selection);
    setHistoryOpen(false);
    historyArtifact.refetch();
  };
  const closeInspection = () => {
    pendingInspection.current = undefined;
    setInspectedArtifact(undefined);
    focusInput();
  };
  const beginReviewAction = () => {
    const token = {};
    pendingReviewAction.current = token;
    return token;
  };
  const finishReviewFocus = (request: ReviewFocus) => {
    if (pendingReviewAction.current === request.token) setReviewFocus(request);
  };
  useEffect(() => {
    if (!visible || !active || state.access !== "ready")
      pendingReviewAction.current = undefined;
    return () => {
      pendingReviewAction.current = undefined;
    };
  }, [visible, active, state.access]);
  useEffect(() => {
    if (
      !reviewFocus ||
      pendingReviewAction.current !== reviewFocus.token ||
      !visible ||
      !active ||
      historyOpen ||
      state.access !== "ready" ||
      state.busy ||
      !state.draftSaved ||
      canvasState.accessChecking ||
      canvasState.phase !== "ready"
    )
      return;
    if (
      reviewFocus.subject === "application"
        ? editingCanonical(draft?.application ?? null) !==
          editingCanonical(reviewFocus.expected ?? null)
        : attachmentReview !== reviewFocus.expected ||
          (reviewFocus.sources &&
            editingCanonical(draft?.nextSources ?? draft?.sources) !==
              editingCanonical(reviewFocus.sources))
    )
      return;
    const target =
      reviewFocus.target === "input"
        ? inputRef.current
        : reviewFocus.subject === "application"
          ? applicationReviewElement.current
          : attachmentReviewElement.current;
    if (!target) return;
    const frame = requestAnimationFrame(() => {
      if (
        pendingReviewAction.current !== reviewFocus.token ||
        !target.isConnected ||
        target.closest("[hidden], [inert]")
      )
        return;
      pendingReviewAction.current = undefined;
      if (reviewFocus.target === "review") followLatest.current = false;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    reviewFocus,
    attachmentReview,
    draft,
    visible,
    active,
    historyOpen,
    state.access,
    state.busy,
    state.draftSaved,
    canvasState.accessChecking,
    canvasState.phase,
  ]);
  useEffect(() => {
    const pending = pendingInspection.current;
    if (!pending || pending !== inspectedArtifact) return;
    if (!visible || !active || state.access !== "ready") {
      pendingInspection.current = undefined;
      return;
    }
    if (
      historyOpen ||
      canvasState.accessChecking ||
      canvasState.phase !== "ready" ||
      historyArtifact.error ||
      !artifact ||
      artifact !== historyArtifact.data ||
      artifact.id !== pending.id ||
      artifact.revision !== pending.revision
    )
      return;
    const target = inspectedResult.current;
    if (!target) return;
    const frame = requestAnimationFrame(() => {
      if (
        pendingInspection.current !== pending ||
        target !== inspectedResult.current ||
        !target.isConnected ||
        target.closest("[hidden], [inert]")
      )
        return;
      pendingInspection.current = undefined;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    inspectedArtifact,
    artifact,
    historyArtifact.data,
    historyArtifact.error,
    historyOpen,
    visible,
    active,
    state.access,
    canvasState.accessChecking,
    canvasState.phase,
  ]);
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
  const addReferences = (nodeIds: string[]) => {
    if (!draft || disabled) return;
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
        nodeIds,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "请重新核对所选上下文。",
      );
      return;
    }
    return controller.commitDraft(draft, draft, async (current) => {
      const saved = await savedCanvas();
      const sources = captureCanvasSources(saved, nodeIds);
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
    void addReferences(requestedContext.nodeIds);
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
    if (
      !draft ||
      state.busy ||
      localActionPending ||
      state.access !== "ready" ||
      !visible ||
      !active
    )
      return;
    const defaults: Partial<CanvasAssistantDraft> = {};
    if (!draft.capabilityId && textModels.length === 1)
      defaults.capabilityId = textModels[0]!.id;
    if (!discussion && !draft.targetCapabilityId && targets.length === 1) {
      defaults.targetCapabilityId = targets[0]!.id;
      defaults.targetCapabilityRevision = targets[0]!.revision;
    }
    if (Object.keys(defaults).length) update(defaults);
  }, [
    draft,
    capabilities.data,
    state.busy,
    localActionPending,
    state.access,
    visible,
    active,
  ]);
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
    setTopicNotice(undefined);
    if (!assistant || (!discussion && !target)) {
      setError(
        discussion
          ? "请选择可用的助手模型，消息会保留。"
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
    const token = beginReviewAction();
    let review: AttachmentReview | undefined;
    setError(undefined);
    void controller
      .commitDraft(draft, draft, async (current) => {
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
        review = { before, after, revision: saved.revision };
        setAttachmentReview(review);
        return current;
      })
      .then(() => {
        const current = controller.getSnapshot();
        if (review && current.draftSaved && !current.error)
          finishReviewFocus({
            token,
            subject: "attachments",
            expected: review,
            sources: review.before,
            target: "review",
          });
      });
  };
  const confirmAttachments = () => {
    if (!draft || !attachmentReview) return;
    const review = attachmentReview;
    const token = beginReviewAction();
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
          !current.error &&
          current.record &&
          editingCanonical(
            current.record.draft.nextSources ?? current.record.draft.sources,
          ) === editingCanonical(review.after)
        ) {
          setAttachmentReview(undefined);
          finishReviewFocus({
            token,
            subject: "attachments",
            expected: undefined,
            sources: review.after,
            target: "input",
          });
        }
      });
  };
  const cancelAttachmentReview = () => {
    const token = beginReviewAction();
    setAttachmentReview(undefined);
    finishReviewFocus({
      token,
      subject: "attachments",
      expected: undefined,
      target: "input",
    });
  };
  const continueFrom = (fixed: Schema<"AssistanceArtifact">) => {
    if (!draft) return;
    void controller
      .commitDraft(draft, draft, async (current) => {
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
          discussionReturn: undefined,
          nextKind: isCanvasDiscussion(found) ? "discuss" : "prepare_prompt",
          ...(isCanvasDiscussion(found)
            ? {}
            : {
                targetCapabilityId: found.request.targetCapabilityId!,
                targetCapabilityRevision:
                  found.request.targetCapabilityRevision,
              }),
        };
      })
      .then(() => {
        setHistoryOpen(false);
        focusInput();
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
    const token = beginReviewAction();
    const reviewKey = crypto.randomUUID();
    void controller
      .commitDraft(draft, draft, async (current) => {
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
            key: reviewKey,
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
      })
      .then(() => {
        const current = controller.getSnapshot();
        const prepared = current.record?.draft.application;
        if (
          current.draftSaved &&
          !current.error &&
          prepared?.key === reviewKey &&
          prepared.phase === "review"
        )
          finishReviewFocus({
            token,
            subject: "application",
            expected: prepared,
            target: "review",
          });
      });
  };
  const cancelApplicationReview = () => {
    const token = beginReviewAction();
    update({ application: undefined });
    finishReviewFocus({
      token,
      subject: "application",
      expected: undefined,
      target: "input",
    });
  };
  const focusApplicationOutcome = (
    token: object,
    intent: NonNullable<CanvasAssistantDraft["application"]>,
  ) => {
    const current = controller.getSnapshot();
    const outcome = current.record?.draft.application;
    if (
      current.draftSaved &&
      outcome?.key === intent.key &&
      outcome.revision === intent.revision &&
      editingCanonical(outcome.body) === editingCanonical(intent.body)
    )
      finishReviewFocus({
        token,
        subject: "application",
        expected: outcome,
        target: outcome.phase === "applied" ? "input" : "review",
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
    const token = beginReviewAction();
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
        focusApplicationOutcome(token, intent);
      });
  };
  const recoverApplication = () => {
    if (!draft || !application) return;
    const intent = structuredClone(application);
    const token = beginReviewAction();
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
        focusApplicationOutcome(token, intent);
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
  const boundary = draft?.conversationBoundary;
  const visibleOlder = olderArtifacts.filter(
    (item) => !boundary?.artifactIds.includes(item.id),
  );
  const visiblePrevious =
    record?.previous.filter(
      (entry) => !boundary?.planIds.includes(entry.planId),
    ) ?? [];
  const hasMessages =
    !!fixedInput || !!visiblePrevious.length || !!visibleOlder.length;
  const taskBlocked =
    disabled || pendingPlan || pendingJob || pendingApplication;
  const isDemo = assistant?.executionMode === "test_fixture";
  const referenceNodes =
    canvasState.local?.document.nodes.filter((node) =>
      node.title
        .toLocaleLowerCase()
        .includes(referenceQuery.toLocaleLowerCase()),
    ) ?? [];
  const runLocalAction = async (action: () => Promise<void>) => {
    setError(undefined);
    setLocalActionPending(true);
    try {
      await action();
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "操作未完成，输入仍保留。",
      );
      return false;
    } finally {
      setLocalActionPending(false);
    }
  };
  const newTopic = async () => {
    if (
      savedArtifacts.isPending ||
      savedArtifacts.isFetching ||
      savedArtifacts.error
    ) {
      setError(
        "对话历史尚未核对完成，请稍后再开启新话题。当前输入会继续保留。",
      );
      return;
    }
    if (
      await runLocalAction(() =>
        beginCanvasAssistantTopic(
          controller,
          (savedArtifacts.data ?? []).map((item) => item.id),
        ),
      )
    ) {
      setInspectedArtifact(undefined);
      setHistoryOpen(false);
      setTopicNotice("已开启新话题，未发送的内容会继续保留。");
      followLatest.current = true;
      focusInput();
    }
  };
  const preparePrompt = async () => {
    if (await runLocalAction(() => beginCanvasAssistantPrompt(controller))) {
      setHistoryOpen(false);
      setTopicNotice(undefined);
      focusInput();
    }
  };
  const returnToDiscussion = async () => {
    if (
      await runLocalAction(() => beginCanvasAssistantDiscussion(controller))
    ) {
      setTopicNotice(undefined);
      focusInput();
    }
  };
  const startWriting = (text: string) => {
    if (!composerText.trim()) update({ nextInstruction: text });
    focusInput();
  };
  return (
    <section className={classes.chat} aria-label="画布创作助手">
      <header className={classes.header}>
        <Text fw={600} size="sm">
          {historyOpen ? "对话历史" : "创作助手"}
        </Text>
        <Group gap="xs" wrap="nowrap">
          <Tooltip label="开启新话题" withArrow>
            <ActionIcon
              variant="subtle"
              aria-label="开启新话题"
              disabled={
                taskBlocked ||
                savedArtifacts.isPending ||
                savedArtifacts.isFetching ||
                !!savedArtifacts.error
              }
              onClick={() => void newTopic()}
            >
              <Plus size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={historyOpen ? "返回对话" : "查看对话历史"} withArrow>
            <ActionIcon
              variant="subtle"
              aria-label={historyOpen ? "返回当前对话" : "查看对话历史"}
              aria-pressed={historyOpen}
              onClick={() => {
                setHistoryOpen(!historyOpen);
                if (historyOpen) focusInput();
              }}
            >
              {historyOpen ? (
                <ArrowLeft size={18} />
              ) : (
                <ClockCounterClockwise size={18} />
              )}
            </ActionIcon>
          </Tooltip>
          {onClose && (
            <Tooltip label="收起助手" withArrow>
              <ActionIcon
                variant="subtle"
                aria-label="收起 AI 助手"
                onClick={onClose}
              >
                <CaretRight size={18} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </header>
      {historyOpen && (
        <div className={classes.history} aria-label="已保存的对话历史">
          <Text size="xs" c="dimmed">
            查看或引用过去的回复，当前输入会保留。
          </Text>
          <ErrorNotice
            error={savedArtifacts.error}
            retry={() => void savedArtifacts.refetch()}
          />
          {(savedArtifacts.isPending || savedArtifacts.isFetching) && (
            <Text size="sm" c="dimmed" role="status">
              正在读取历史…
            </Text>
          )}
          {savedArtifacts.isSuccess &&
            !savedArtifacts.isFetching &&
            !olderArtifacts.length &&
            !record?.previous.length &&
            !draft?.artifact && (
              <Text size="sm" c="dimmed">
                还没有已保存的回复。
              </Text>
            )}
          {olderArtifacts.map((item) => (
            <SavedCanvasConversation
              key={item.id}
              path={path}
              tenant={tenant}
              projectId={projectId}
              artifactSummary={item}
              disabled={taskBlocked}
              onInspect={inspectArtifact}
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
              disabled={taskBlocked}
              onInspect={inspectArtifact}
              onContinue={continueFrom}
            />
          ))}
          {draft?.artifact && (
            <SavedCanvasConversation
              path={path}
              tenant={tenant}
              projectId={projectId}
              artifactSummary={draft.artifact}
              disabled={taskBlocked}
              onInspect={inspectArtifact}
              onContinue={continueFrom}
            />
          )}
        </div>
      )}
      <div
        className={classes.conversation}
        hidden={historyOpen}
        ref={conversation}
        role="log"
        tabIndex={0}
        aria-label="画布助手对话"
        aria-live="polite"
        aria-relevant="additions"
      >
        <div className={classes.conversationContent} ref={conversationContent}>
          {!hasMessages && !inspectedArtifact && (
            <div className={classes.welcome}>
              <Sparkle size={28} weight="light" aria-hidden="true" />
              <Text className={classes.welcomeTitle} fw={600}>
                一起把想法变成画面
              </Text>
              <Text size="sm" c="dimmed">
                聊故事、推敲镜头，或带上画布里的参考。
              </Text>
              <div className={classes.starters}>
                <Button
                  variant="default"
                  size="sm"
                  disabled={taskBlocked}
                  leftSection={<ChatCircle size={16} />}
                  onClick={() =>
                    startWriting("我想和你一起推敲这场戏的情绪和节奏。")
                  }
                >
                  推敲故事与镜头
                </Button>
                {onPrepareStoryboard && (
                  <Button
                    variant="default"
                    size="sm"
                    disabled={taskBlocked}
                    leftSection={<FilmStrip size={16} />}
                    onClick={onPrepareStoryboard}
                  >
                    从剧本整理分镜
                  </Button>
                )}
                <Button
                  variant="default"
                  size="sm"
                  disabled={taskBlocked}
                  leftSection={<Sparkle size={16} />}
                  onClick={() => void preparePrompt()}
                >
                  准备画面提示
                </Button>
              </div>
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
          {visibleOlder.map((item) => (
            <SavedCanvasConversation
              key={item.id}
              path={path}
              tenant={tenant}
              projectId={projectId}
              artifactSummary={item}
              disabled={disabled || pendingApplication}
              onInspect={inspectArtifact}
              onContinue={continueFrom}
            />
          ))}
          {visiblePrevious.map((entry) => (
            <SavedCanvasConversation
              key={entry.planId}
              path={path}
              tenant={tenant}
              projectId={projectId}
              entry={entry}
              disabled={disabled || pendingApplication}
              onInspect={inspectArtifact}
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
              {fixedInput.assistanceSource &&
                fixedInput.assistance?.kind !== "discuss" && (
                  <Text
                    size="xs"
                    c="dimmed"
                    title={`${fixedInput.assistanceSource.artifactId} · r${fixedInput.assistanceSource.revision}`}
                  >
                    {`基于建议 ${fixedInput.assistanceSource.artifactId.slice(0, 8)} · r${fixedInput.assistanceSource.revision}`}
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
            (!draft?.artifact ||
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
              <Button variant="subtle" size="xs" onClick={closeInspection}>
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
              ref={inspectedResult}
              tabIndex={inspectedArtifact ? -1 : undefined}
              role="region"
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
                  AI 助手
                </Text>
                {!isCanvasDiscussion(artifact) && (
                  <Text size="xs" c="dimmed">
                    画面提示
                  </Text>
                )}
              </Group>
              {artifact.executionMode === "test_fixture" && (
                <Text size="xs" c="dimmed">
                  演示回复 · 未调用真实模型
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
                  {isCanvasDiscussion(artifact) ? "引用回复" : "继续调整提示"}
                </Button>
                {plan &&
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
                <details
                  key={`${artifact.id}:${artifact.revision}:${application?.key ?? "idle"}:${application?.phase ?? "idle"}`}
                  className={classes.applyOptions}
                >
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
              ref={applicationReviewElement}
              role="region"
              tabIndex={-1}
              className={classes.applicationReview}
              gap="sm"
              aria-label="画布建议应用核对"
            >
              <Text fw={600}>
                {application.phase === "applied" ? "已应用到 " : "应用到 "}
                {application.targetTitle}
                {application.phase !== "applied" && ` · 画布 r${application.revision}`}
              </Text>
              <details open={application.phase !== "applied"}>
                <summary>
                  {application.phase === "applied" ? "查看这次应用差异" : "核对提示变化"}
                </summary>
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
              </details>
              {application.phase === "review" && (
                <Group>
                  <Button disabled={disabled} onClick={apply}>
                    确认应用这份建议
                  </Button>
                  <Button
                    variant="subtle"
                    disabled={disabled}
                    onClick={cancelApplicationReview}
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
                <Text size="xs" c="dimmed" role="status">
                  已保存 · 画布 r
                  {application.result?.application.resultCanvasRevision}
                </Text>
              )}
            </Stack>
          )}
        </div>
      </div>
      <form
        className={classes.composer}
        hidden={historyOpen}
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
        {topicNotice && (
          <Text size="xs" c="dimmed" role="status">
            {topicNotice}
          </Text>
        )}
        <div className={classes.inputShell}>
          <ComposerReferences
            sources={composerSources}
            tenant={tenant}
            disabled={disabled}
            onChange={(sources) =>
              update(
                frozen
                  ? { nextSources: sources }
                  : { sources, nextSources: undefined },
              )
            }
          />
          {!!composerSources.length &&
            (canvasState.dirty ||
              composerSources.some(
                (item) =>
                  item.source.canvasRevision !==
                  canvasState.local?.base.revision,
              )) && (
              <div className={classes.attachmentCheck}>
                <Text size="xs" c="dimmed">
                  参考内容有更新
                </Text>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  disabled={disabled}
                  onClick={reviewAttachments}
                >
                  查看并更新参考
                </Button>
              </div>
            )}
          {attachmentReview && (
            <div
              ref={attachmentReviewElement}
              role="region"
              tabIndex={-1}
              className={classes.attachmentReview}
              aria-label="当前附件差异"
            >
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
                  onClick={cancelAttachmentReview}
                >
                  保留原附件
                </Button>
              </Group>
            </div>
          )}
          {draft?.replyTo && draft.replyChoice !== "automatic" && (
            <div className={classes.replyAttachment}>
              <div className={classes.quoteText}>
                <Text size="xs" fw={500}>
                  引用回复
                </Text>
                <Text size="xs" c="dimmed" lineClamp={2}>
                  {quotedReply.data ? (
                    <CanvasReplyText artifact={quotedReply.data} />
                  ) : quotedReply.error ? (
                    "引用暂时无法读取，原选择仍保留"
                  ) : (
                    "正在读取引用…"
                  )}
                </Text>
              </div>
              <ActionIcon
                variant="subtle"
                size="sm"
                aria-label="取消引用回复"
                disabled={disabled}
                onClick={() =>
                  update({
                    replyTo: undefined,
                    replyChoice: "none",
                    discussionReturn: undefined,
                  })
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
              恢复上一条回复
            </Button>
          )}
          {!discussion && (
            <div className={classes.promptTask}>
              <span>准备提示</span>
              <Tooltip label="回到自由对话">
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  aria-label="回到自由对话"
                  disabled={taskBlocked}
                  onClick={() => void returnToDiscussion()}
                >
                  <X size={12} />
                </ActionIcon>
              </Tooltip>
            </div>
          )}
          <Textarea
            ref={inputRef}
            classNames={{ input: classes.messageInput }}
            variant="unstyled"
            aria-label="发送给画布助手"
            placeholder={
              discussion
                ? "聊聊你的创作想法…"
                : composerSources.length
                  ? "描述想要的画面、动作或氛围…"
                  : "从 + 添加参考，再描述想要的画面…"
            }
            minRows={2}
            maxRows={7}
            autosize
            value={composerText}
            disabled={!active || !visible || !draft}
            readOnly={state.busy || localActionPending}
            aria-busy={state.busy || localActionPending}
            onChange={(event) => {
              setTopicNotice(undefined);
              update({ nextInstruction: event.currentTarget.value });
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                if (!taskBlocked) sendMessage();
              }
            }}
          />
          <div className={classes.composerActions}>
            <Group gap="xs" wrap="nowrap" className={classes.inputTools}>
              <Popover
                opened={referencePicker}
                onChange={(opened) => {
                  setReferencePicker(opened);
                  if (opened) setComposerMenu(undefined);
                }}
                position="top-start"
                width={300}
                trapFocus
                returnFocus
              >
                <Popover.Target>
                  <Tooltip label="添加画布参考">
                    <ActionIcon
                      variant="subtle"
                      aria-label="添加画布参考"
                      disabled={disabled}
                      onClick={() => {
                        setComposerMenu(undefined);
                        setReferencePicker(!referencePicker);
                      }}
                    >
                      <Plus size={20} />
                    </ActionIcon>
                  </Tooltip>
                </Popover.Target>
                <Popover.Dropdown className={classes.actionPicker}>
                  <Text size="xs" fw={600}>
                    添加画布参考
                  </Text>
                  <TextInput
                    size="xs"
                    aria-label="查找画布参考"
                    placeholder="查找画布内容…"
                    value={referenceQuery}
                    onChange={(event) =>
                      setReferenceQuery(event.currentTarget.value)
                    }
                  />
                  <div className={classes.referenceChoices}>
                    {referenceNodes.slice(0, 30).map((node) => (
                      <Button
                        key={node.id}
                        variant="subtle"
                        size="sm"
                        fullWidth
                        disabled={
                          disabled ||
                          composerSources.some(
                            (source) => source.source.nodeId === node.id,
                          )
                        }
                        onClick={() => {
                          void addReferences([node.id]);
                          setReferencePicker(false);
                          focusInput();
                        }}
                      >
                        {node.title}
                        {composerSources.some(
                          (source) => source.source.nodeId === node.id,
                        )
                          ? " · 已添加"
                          : ""}
                      </Button>
                    ))}
                    {!referenceNodes.length && (
                      <Text size="xs" c="dimmed">
                        没有匹配的画布内容。
                      </Text>
                    )}
                    {referenceNodes.length > 30 && (
                      <Text size="xs" c="dimmed">
                        显示前 30 项，可搜索定位。
                      </Text>
                    )}
                  </div>
                </Popover.Dropdown>
              </Popover>

              <Menu
                position="top-start"
                width={240}
                opened={composerMenu === "task"}
                onChange={(opened) => changeComposerMenu("task", opened)}
              >
                <Menu.Target>
                  <Tooltip label="创作任务">
                    <ActionIcon
                      variant="subtle"
                      aria-label="打开创作任务"
                      disabled={taskBlocked}
                    >
                      <Sparkle size={19} />
                    </ActionIcon>
                  </Tooltip>
                </Menu.Target>
                <Menu.Dropdown>
                  {onPrepareStoryboard && (
                    <Menu.Item
                      leftSection={<FilmStrip size={16} />}
                      onClick={() => {
                        setComposerMenu(undefined);
                        onPrepareStoryboard();
                      }}
                    >
                      从剧本整理分镜
                    </Menu.Item>
                  )}
                  <Menu.Item
                    leftSection={<Sparkle size={16} />}
                    onClick={() => {
                      setComposerMenu(undefined);
                      void preparePrompt();
                    }}
                  >
                    准备画面提示
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
              <Menu
                position="top-start"
                width={260}
                middlewares={{
                  size: {
                    apply: ({ availableHeight, elements }) =>
                      elements.floating.style.setProperty(
                        "--model-menu-height",
                        `${Math.max(0, availableHeight)}px`,
                      ),
                  },
                }}
                opened={composerMenu === "model"}
                onChange={(opened) => changeComposerMenu("model", opened)}
              >
                <Menu.Target>
                  <Button
                    className={classes.modelButton}
                    variant="default"
                    size="compact-xs"
                    aria-label={
                      discussion ? "选择助手模型" : "选择生成目标与助手模型"
                    }
                    disabled={disabled}
                    title={selectedModelLabel ?? modelChipLabel}
                    leftSection={<GearSix size={13} />}
                    rightSection={<CaretDown size={12} />}
                  >
                    {modelChipLabel}
                  </Button>
                </Menu.Target>
                <Menu.Dropdown className={classes.modelMenu}>
                  {capabilities.isPending ? (
                    <Menu.Item disabled>正在读取模型…</Menu.Item>
                  ) : capabilities.error ? (
                    <>
                      <Menu.Label>模型读取失败，原选择仍保留</Menu.Label>
                      <Menu.Item
                        leftSection={<ArrowsClockwise size={16} />}
                        disabled={capabilities.isFetching}
                        onClick={() => void capabilities.refetch()}
                      >
                        {capabilities.isFetching
                          ? "正在重新读取…"
                          : "重新读取模型"}
                      </Menu.Item>
                    </>
                  ) : (
                    <>
                      {capabilities.isFetching && (
                        <Menu.Label>正在更新可用模型…</Menu.Label>
                      )}
                  {!discussion && (
                    <>
                      <Menu.Label>准备提示的目标模型</Menu.Label>
                      {targets.map((model) => (
                        <Menu.Item
                          key={model.id}
                          aria-label={`选择目标 ${targetLabel(model)}`}
                          disabled={!!draft?.replyTo}
                          onClick={() =>
                            update({
                              targetCapabilityId: model.id,
                              targetCapabilityRevision: model.revision,
                            })
                          }
                        >
                          {targetLabel(model)}
                          {model.id === target?.id ? " · 当前" : ""}
                        </Menu.Item>
                      ))}
                      {!targets.length && (
                        <Menu.Item disabled>尚未连接可用的提示目标</Menu.Item>
                      )}
                      {!!draft?.replyTo && (
                        <Text size="xs" c="dimmed" px="sm" py="xs">
                          继续调整沿用原目标；取消引用后可更换。
                        </Text>
                      )}
                      <Menu.Divider />
                    </>
                  )}
                  <Menu.Label>助手模型</Menu.Label>
                  {textModels.map((model) => (
                    <Menu.Item
                      key={model.id}
                      aria-label={`使用 ${modelLabel(model)}`}
                      onClick={() => update({ capabilityId: model.id })}
                    >
                      {modelLabel(model)}
                      {model.id === assistant?.id ? " · 当前" : ""}
                    </Menu.Item>
                  ))}
                  {!textModels.length && (
                    <Menu.Item disabled>尚未连接可用的助手模型</Menu.Item>
                  )}
                  {isDemo && (
                    <Text size="xs" c="dimmed" px="sm" py="xs">
                      当前回复仅用于演示，不调用真实模型。
                    </Text>
                  )}
                    </>
                  )}
                </Menu.Dropdown>
              </Menu>
            </Group>
            <Tooltip label="发送 · Enter；Shift+Enter 换行" withArrow>
              <ActionIcon
                type="submit"
                size="lg"
                radius="xl"
                variant="filled"
                aria-label={discussion ? "发送讨论消息" : "发送消息并核对计划"}
                disabled={
                  taskBlocked ||
                  !composerText.trim() ||
                  !assistant ||
                  (!discussion && (!target || !composerSources.length))
                }
              >
                <ArrowUp size={19} />
              </ActionIcon>
            </Tooltip>
          </div>
        </div>
        {!state.draftSaved && (
          <Text size="xs" c="dimmed" role="status">
            正在保留草稿…
          </Text>
        )}
        {!capabilities.isLoading &&
          !capabilities.error &&
          !textModels.length && (
            <Text size="xs" c="dimmed">
              尚未连接助手模型，输入会保留。
            </Text>
          )}
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

function ComposerReferences({
  sources,
  tenant,
  disabled,
  onChange,
}: {
  sources: CanvasAssistantSource[];
  tenant: string;
  disabled: boolean;
  onChange: (sources: CanvasAssistantSource[]) => void;
}) {
  if (!sources.length) return null;
  return (
    <div
      className={classes.referenceStrip}
      role="region"
      tabIndex={0}
      aria-label="本次消息的画布参考"
    >
      {sources.map((item, index) => (
        <div className={classes.referenceChip} key={item.source.nodeId}>
          <Popover position="top-start" width={300} trapFocus returnFocus>
            <Popover.Target>
              <UnstyledButton
                type="button"
                className={classes.referenceButton}
                aria-label={`查看参考 ${item.title}`}
              >
                <ReferenceThumbnail source={item} tenant={tenant} />
                <span>{item.title}</span>
              </UnstyledButton>
            </Popover.Target>
            <Popover.Dropdown>
              <SourceAttachments
                sources={[item]}
                readonly={disabled}
                expanded
                onChange={(next) =>
                  onChange(
                    next.length
                      ? sources.map((source, i) =>
                          i === index ? next[0]! : source,
                        )
                      : sources.filter((_, i) => i !== index),
                  )
                }
              />
            </Popover.Dropdown>
          </Popover>
          <ActionIcon
            variant="subtle"
            size="sm"
            disabled={disabled}
            aria-label={`移除参考 ${item.title}`}
            onClick={() => onChange(sources.filter((_, i) => i !== index))}
          >
            <X size={12} />
          </ActionIcon>
        </div>
      ))}
    </div>
  );
}
function ReferenceThumbnail({
  source,
  tenant,
}: {
  source: CanvasAssistantSource;
  tenant: string;
}) {
  const mediaId =
    source.content.type === "media" ? source.content.mediaId : undefined;
  const media = useFreshCanvasResource<Schema<"Media">>(
    `${tenant}/media/${mediaId ?? "unavailable"}`,
    !!mediaId,
  );
  return (
    <span className={classes.referenceThumbnail} aria-hidden="true">
      {media.data?.id === mediaId && media.data ? (
        <MediaPreview media={media.data} path={tenant} thumbnail />
      ) : source.kind === "text" ? (
        <TextT size={18} />
      ) : (
        <Paperclip size={18} />
      )}
    </span>
  );
}
function SourceAttachments({
  sources,
  readonly,
  onChange,
  expanded = false,
}: {
  sources: CanvasAssistantSource[];
  readonly: boolean;
  onChange?: (sources: CanvasAssistantSource[]) => void;
  expanded?: boolean;
}) {
  if (!sources.length) return null;
  return (
    <details className={classes.attachments} open={expanded || undefined}>
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
                  comboboxProps={{ withinPortal: false }}
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
            AI 助手
            {!isCanvasDiscussion(result) ? " · 画面提示" : ""}
            {result.executionMode === "test_fixture" ? " · 演示" : ""}
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
              {isCanvasDiscussion(result) ? "引用回复" : "继续调整提示"}
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

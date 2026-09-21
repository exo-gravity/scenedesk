import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Loader, Modal, Text, Textarea, UnstyledButton } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowClockwise,
  ArrowUp,
  ArrowsClockwise,
  ArrowsInSimple,
  ArrowsOutSimple,
  CircleNotch,
  ClockCounterClockwise,
} from "@phosphor-icons/react";
import { editingCanonical, type CanvasDocument, type CanvasNode } from "@drama/domain";
import { api, ApiError, useList, useSession, type Schema } from "../../business/api";
import { canvasResultPosition } from "../../business/canvas-result-position";
import {
  canReviewCanvasResultPlacement,
  submitCanvasResultPlacement,
} from "../../business/canvas-result-placement";
import { tenantPath, projectPath } from "../../business/common";
import { useGenerationSession } from "../../business/use-generation-session";
import {
  canvasImageRequest,
  executableImages,
  type ImageCapability,
} from "../../business/image-generation";
import { canvasVideoRequest, executableVideos } from "../../business/video-generation";
import { canvasAudioRequest, executableAudios } from "../../business/audio-generation";
import { fixedShotSources } from "../../business/canvas-shot-sources";
import { reconcileOutputForCapability } from "../../business/generation-specification";
import { canContinueCreation, jobFinished, jobStatusLabel } from "../../business/assistant-session";
import { ComposerReferences } from "./ComposerReferences";
import { ModelPicker, SpecificationPicker, SubmitButton } from "./ComposerControls";
import classes from "./composer.module.css";

type Kind = "image" | "video" | "audio";
type ReferenceEdge = CanvasDocument["edges"][number];
type Draft = Extract<CanvasNode, { kind: Kind }> & {
  content: Extract<CanvasNode["content"], { type: "draft" }>;
};
const labels = { image: "图片", video: "视频", audio: "音频" };
const nextLabel = { image: "下一张图片", video: "下一段视频", audio: "下一段音频" };

export type ComposerProps = {
  tenantId: string;
  projectId: string;
  canvasId: string;
  sceneId: string | undefined;
  node: Draft;
  document: CanvasDocument;
  active: boolean;
  readOnly: boolean;
  mediaPath: string;
  /** The board has unsaved or unconfirmed changes; generation saves first. */
  awaitingSave: boolean;
  /** Save the board and return the saved canvas; throws when it cannot. */
  save: () => Promise<Schema<"Canvas">>;
  /** After a placement: re-read the board so the new cards appear. */
  afterPlacement: () => Promise<void>;
  changePrompt: (id: string, prompt: string) => void;
  configure: (
    id: string,
    change: Pick<Schema<"CanvasDraftContent">, "connectionId" | "capabilityId" | "output">,
  ) => void;
  addReference: (sourceId: string, targetId: string) => void;
  editEdge: (edgeId: string, patch: (edge: ReferenceEdge) => ReferenceEdge | null) => void;
  /** Register the "keep the draft" check the board runs before closing the panel. */
  registerRetain: (retain: (() => Promise<void>) | undefined) => void;
  /** This draft's fixed attempts, for the history entry. */
  attempts: readonly Schema<"CanvasPlanEntry">[];
  onOpenHistory: () => void;
  /** Focus editing: the same panel, larger, in a dialog. */
  focused: boolean;
  onFocusChange: (focused: boolean) => void;
  /** Select the cards a placement created. */
  onFocusNodes: (ids: string[]) => void;
  style?: CSSProperties | undefined;
  docked?: boolean | undefined;
  panelRef?: ((element: HTMLElement | null) => void) | undefined;
};

/**
 * The input panel under a selected draft. Prompt, model and specification
 * live in the canvas document; the generation session owns the fixed plan,
 * the submission and its receipts. The rules it reproduces are numbered in
 * docs/design/creative-workspace-rebuild-libtv-2026-09-21.md, Appendix A.
 */
export function Composer(props: ComposerProps) {
  const { tenantId, projectId, canvasId, sceneId, node, document, active, readOnly } = props;
  const kind = node.kind;
  const label = labels[kind];
  const tenant = tenantPath(tenantId),
    path = projectPath(tenantId, projectId);
  const session_ = useSession(),
    cache = useQueryClient();
  // Rule 1: the session identity is session · kind · canvas · node; the caller keys this component on it.
  const { controller: session, state } = useGenerationSession(
    tenantId,
    projectId,
    { kind: "canvas", canvasId, nodeId: node.id, sceneId },
    kind,
  );
  const capabilities = useList<ImageCapability>(`${tenant}/capabilities?purpose=${kind}`);
  const models = useMemo(
    () =>
      ({ image: executableImages, video: executableVideos, audio: executableAudios })[kind](
        capabilities.data ?? [],
      ),
    [capabilities.data, kind],
  );
  const [error, setError] = useState<string>();
  const [placementOpen, setPlacementOpen] = useState(false);
  const { record, plan, job } = state,
    draft = record?.draft;
  const placement = draft?.placement;
  // The cards' tags and results read the canvas's attempts; a new plan or a job change refreshes them.
  useEffect(() => {
    if (state.plan?.id || state.job?.status)
      void cache.invalidateQueries({
        queryKey: ["user", session_.userId, `${path}/canvases/${canvasId}/generation-plans`],
      });
  }, [cache, session_.userId, path, canvasId, state.plan?.id, state.job?.id, state.job?.status]);
  const content = node.content;
  const capability = models.find((c) => c.id === content.capabilityId);
  const output = content.output ?? {};
  const frozen = !!record?.planId || !!record?.planRequest; // rule 6
  const disabled = !active || readOnly || state.busy || !draft; // rule 7
  const edges = useMemo(
    () =>
      document.edges
        .filter((edge) => edge.targetNodeId === node.id)
        .sort((a, b) => a.position - b.position),
    [document.edges, node.id],
  );
  // Rule 4: a capability read that comes back 401/403/404 suspends the session until access is rechecked.
  useEffect(() => {
    if (capabilities.error instanceof ApiError && [401, 403, 404].includes(capabilities.error.status)) {
      session.suspend();
      void session.verify();
    }
  }, [capabilities.error, session]);
  // Rule 2: the board asks this before the panel closes; a settled session with a saved draft is required.
  const { registerRetain } = props;
  useEffect(() => {
    registerRetain(async () => {
      // Let a running access check finish first: while it runs there is
      // nothing unsaved to protect, and refusing would make every quick
      // reselection fail.
      await session.settle();
      await session.settleAccess();
      const current = session.getSnapshot();
      if (current.access === "ready" && !current.draftSaved)
        throw new Error("当前生成输入尚未保留，请先处理保存或权限提示。");
    });
    return () => registerRetain(undefined);
  }, [session, registerRetain]);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const ready = state.access === "ready";
  useEffect(() => {
    // Once the panel is usable for an empty draft, typing can start at once;
    // a later change of the prompt must not steal focus again.
    if (ready && !frozen && !readOnly && !content.prompt)
      promptRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, ready]);
  const configure = (change: Parameters<ComposerProps["configure"]>[1]) => {
    setError(undefined);
    try {
      props.configure(node.id, change);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "草稿尚未更新。");
    }
  };
  // Rule 17: switching models keeps only what the new model accepts and fills in single choices.
  const chooseModel = (model: ImageCapability) =>
    configure({
      connectionId: model.connectionId,
      capabilityId: model.id,
      output: reconcileOutputForCapability({ kind, output, capability: model }),
    });
  // Rule 8: fixed shot sources first, then save the board, refuse a changed board, then build the request.
  const submit = () => {
    if (!draft) return;
    setError(undefined);
    let shotSources: Schema<"ShotSource">[];
    try {
      shotSources = fixedShotSources(draft.shotSources);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "请核对镜头来源。");
      return;
    }
    const expected = editingCanonical(document);
    void session.generateFrom(draft, async () => {
      const canvas = await props.save();
      if (canvas.id !== canvasId || editingCanonical(canvas.document) !== expected)
        throw new Error("创作台已改变，请重新核对后再生成。");
      return { image: canvasImageRequest, video: canvasVideoRequest, audio: canvasAudioRequest }[kind](
        canvas,
        sceneId,
        node.id,
        models,
        shotSources,
      );
    });
  };
  const post = <T,>(url: string, key: string, body?: unknown, revision?: number) =>
    api<T>(url, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        "X-CSRF-Token": session_.csrfToken,
        "Idempotency-Key": key,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(revision === undefined ? {} : { "If-Match": `"${revision}"` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  // Rule 10: a finished job with media is reviewed for placement after the board is saved again.
  const reviewPlacement = () => {
    if (!draft || !job || job.status !== "succeeded" || !job.mediaIds.length || !canReviewCanvasResultPlacement(placement))
      return;
    setError(undefined);
    void session
      .commitDraft(draft, draft, async (current) => {
        const canvas = await props.save();
        if (canvas.id !== canvasId) throw new Error("结果接收的创作台已改变。");
        const position = canvasResultPosition(canvas.document.nodes, node.id, job.mediaIds.length);
        return {
          ...current,
          placement: {
            phase: "review",
            key: crypto.randomUUID(),
            canvasId: canvas.id,
            revision: canvas.revision,
            input: { jobId: job.id, mediaIds: [...job.mediaIds], position },
          },
        };
      })
      .then(() => {
        if (session.getSnapshot().record?.draft.placement?.phase === "review") setPlacementOpen(true);
      });
  };
  // Rules 11 and 12: the placement is submitted with If-Match; 412 becomes the conflict state.
  const materialize = () => {
    if (!draft || !placement || job?.status !== "succeeded") return;
    setError(undefined);
    void submitCanvasResultPlacement(session, draft, async (intent) => {
      try {
        const receipt = await post<Schema<"CanvasResultPlacement">>(
          `${path}/canvases/${intent.canvasId}/results`,
          intent.key,
          intent.input,
          intent.revision,
        );
        return { kind: "placed", receipt };
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 412 && cause.code === "VERSION_CONFLICT")
          return { kind: "version_conflict" };
        throw cause;
      }
    }).then(async () => {
      setPlacementOpen(false);
      const current = session.getSnapshot();
      const placed = current.record?.draft.placement;
      if (current.access !== "ready" || placed?.phase !== "placed" || !placed.placed) return;
      try {
        await props.afterPlacement();
      } catch {
        setError(`${label}已加入创作台，但当前创作台尚未完成刷新，请重新读取。`);
      }
    });
  };
  // Rule 13: archive recovery is two explicit steps and never calls the model again.
  const recoverArchive = () => {
    if (!draft || !job) return;
    const intent = draft.archiveRequest ?? { jobId: job.id, key: crypto.randomUUID() };
    void session
      .commitDraft(draft, { ...draft, archiveRequest: intent }, async (current) => {
        await post(`${tenant}/generation-jobs/${intent.jobId}/recover-archive`, intent.key);
        return { ...current, archiveRequest: undefined };
      })
      .then(() => session.refresh());
  };
  const checkArchive = () => {
    if (!draft?.archiveRequest) return;
    const request = draft.archiveRequest;
    void session
      .commitDraft(draft, draft, async (current) => {
        await api(`${tenant}/generation-jobs/${request.jobId}`, { signal: AbortSignal.timeout(15000) });
        return { ...current, archiveRequest: { ...request, checked: true } };
      })
      .then(() => session.refresh());
  };
  const expired = !!plan && Date.parse(plan.expiresAt) <= Date.now(); // rule 16
  const reason = !draft
    ? "生成输入正在读取"
    : !active
      ? "项目已归档"
      : capabilities.isLoading
        ? "正在读取模型"
        : !models.length
          ? "暂无可用模型"
          : !capability
            ? "先选择模型"
            : !content.prompt.trim()
              ? "先写下提示词"
              : undefined;
  const busyText = state.busy ? "处理中…" : undefined;
  const notice = error ?? state.error;
  const stop = (event: KeyboardEvent) => event.stopPropagation();
  // Rule 19: without confirmed access the whole panel is the recheck prompt.
  if (state.access !== "ready")
    return (
      <section
        ref={props.panelRef}
        className={classes.panel}
        style={props.style}
        data-docked={props.docked || undefined}
        aria-label={`生成${label}`}
        onKeyDown={stop}
      >
        <div className={classes.row}>
          <span className={classes.status} data-tone={state.access === "forbidden" ? "error" : undefined}>
            {state.access === "forbidden" ? `${label}任务不可访问` : `正在核对${label}任务访问`}
            {state.error ? ` · ${state.error}` : ""}
          </span>
          {state.access === "checking" ? (
            <Loader size="xs" aria-label="正在核对访问" />
          ) : (
            <UnstyledButton className={classes.action} data-quiet onClick={() => void session.verify()}>
              重新核对访问权限
            </UnstyledButton>
          )}
        </div>
      </section>
    );
  const continueLabel = `保留原任务，准备${nextLabel[kind]}`;
  const panel = (
    <section
      ref={props.focused ? undefined : props.panelRef}
      className={classes.panel}
      style={props.focused ? undefined : props.style}
      data-docked={(!props.focused && props.docked) || undefined}
      data-focus={props.focused || undefined}
      aria-label={`生成${label}`}
      onKeyDown={stop}
    >
      <div className={classes.row} data-align="end" data-corner>
        {props.attempts.length > 0 && (
          <UnstyledButton className={classes.pill} data-quiet onClick={props.onOpenHistory} aria-label="尝试与结果">
            <ClockCounterClockwise size={12} aria-hidden />
            <span>历史 {props.attempts.length}</span>
          </UnstyledButton>
        )}
        <UnstyledButton
          className={classes.corner}
          aria-label={props.focused ? "退出专注编辑" : "专注编辑"}
          onClick={() => props.onFocusChange(!props.focused)}
        >
          {props.focused ? <ArrowsInSimple size={16} aria-hidden /> : <ArrowsOutSimple size={16} aria-hidden />}
        </UnstyledButton>
      </div>
      <ComposerReferences
        document={document}
        nodeId={node.id}
        edges={edges}
        mediaPath={props.mediaPath}
        disabled={disabled || frozen}
        onAdd={(sourceId) => {
          setError(undefined);
          try {
            props.addReference(sourceId, node.id);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "引用未添加。");
          }
        }}
        onEdit={props.editEdge}
      />
      {frozen || readOnly || !active ? (
        <div className={classes.promptFrozen} aria-label="提示词">
          {content.prompt || <span className={classes.status}>（没有提示词）</span>}
        </div>
      ) : (
        <Textarea
          ref={promptRef}
          variant="unstyled"
          autosize
          minRows={props.focused ? 8 : 2}
          maxRows={props.focused ? 24 : 8}
          aria-label="提示词"
          placeholder={`描述这${kind === "audio" ? "段声音" : "个画面"}，参考与模型在下方`}
          className={classes.promptRoot}
          classNames={{ input: classes.prompt }}
          value={content.prompt}
          onChange={(event) => props.changePrompt(node.id, event.currentTarget.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              if (!reason && !disabled && !frozen) submit();
            }
          }}
        />
      )}
      <div className={classes.bottom}>
        <ModelPicker
          kind={kind}
          models={models}
          loading={capabilities.isLoading}
          capability={capability}
          disabled={disabled || frozen}
          onChange={chooseModel}
        />
        <SpecificationPicker
          kind={kind}
          capability={capability}
          output={output}
          disabled={disabled}
          frozen={frozen}
          onChange={(next) => configure({ output: next })}
          shotSources={draft?.shotSources}
          showShotSources={!!draft && !frozen} // rule 18
          onShotSources={(shotSources) => draft && session.updateDraft({ ...draft, shotSources })}
          shotSourceProps={{ path, projectId, sceneId }}
        />
        {record?.execution ? (
          // The state of the task is the check control: one quiet element, no separate icon.
          <UnstyledButton
            className={classes.status}
            data-tone={notice ? "error" : undefined}
            data-check
            aria-label={`核对${label}任务`}
            disabled={state.busy}
            onClick={() => void session.refresh()}
          >
            <ArrowsClockwise size={12} aria-hidden />
            <span role="status">{notice ?? busyText ?? (job ? jobStatusLabel[job.status] : `${label}提交结果待核对`)}</span>
          </UnstyledButton>
        ) : (
          <span className={classes.status} data-tone={notice ? "error" : undefined} role="status">
            {notice ??
              busyText ??
              (plan
                ? expired
                  ? "固定计划已过期，请保留原计划并重新准备"
                  : plan.status === "ready"
                    ? "输入已固定，可继续生成"
                    : (plan.blockingReasons[0] ?? "计划暂不可执行")
                : record?.planRequest
                  ? "原请求已固定，可继续"
                  : props.awaitingSave
                    ? "生成前会先保存创作台" // rule 9
                    : (reason ?? ""))}
          </span>
        )}
        {record?.execution ? (
          !job ? (
            // Rule 15: the submission receipt is unknown; the only move is to check and resume it.
            <SubmitButton
              label="核对后恢复原提交"
              reason="核对后恢复原提交"
              disabled={disabled}
              onClick={() => void session.resumeSubmission()}
            >
              <ArrowsClockwise size={18} weight="bold" aria-hidden />
            </SubmitButton>
          ) : jobFinished(job) || canContinueCreation(job) ? (
            // Rule 14: keep the original task, prepare the next draft.
            <SubmitButton
              label={continueLabel}
              reason={continueLabel}
              disabled={
                disabled ||
                draft?.placement?.phase === "unknown" ||
                draft?.placement?.phase === "review"
              }
              onClick={() =>
                draft &&
                void session.revise(
                  {
                    capabilityId: draft.capabilityId,
                    output: draft.output,
                    ...(draft.shotSources === undefined ? {} : { shotSources: draft.shotSources }),
                  },
                  draft,
                  true,
                )
              }
            >
              <ArrowClockwise size={18} weight="bold" aria-hidden />
            </SubmitButton>
          ) : (
            <SubmitButton label={jobStatusLabel[job.status]} reason={jobStatusLabel[job.status]} disabled onClick={() => {}}>
              <CircleNotch size={18} weight="bold" aria-hidden className={classes.spin} />
            </SubmitButton>
          )
        ) : plan ? (
          <SubmitButton
            label={`继续生成${label}`}
            reason={expired ? "固定计划已过期" : plan.status !== "ready" ? "计划暂不可执行" : undefined}
            disabled={disabled || plan.status !== "ready" || expired}
            onClick={() => void session.execute()}
          >
            <ArrowUp size={18} weight="bold" aria-hidden />
          </SubmitButton>
        ) : (
          <SubmitButton
            label={record?.planRequest ? `继续原${label}生成` : `生成${label}`}
            reason={reason}
            disabled={disabled || (!record?.planRequest && !!reason)}
            onClick={submit}
          >
            <ArrowUp size={18} weight="bold" aria-hidden />
          </SubmitButton>
        )}
      </div>
      {record?.execution && job && (job.status === "succeeded" || job.status === "archive_failed" || draft?.archiveRequest) && (
        <div className={classes.row} data-align="end" aria-label="本次生成结果">
          {job.status === "succeeded" && !placement && (
            <UnstyledButton className={classes.action} disabled={disabled || props.awaitingSave} onClick={reviewPlacement}>
              添加到创作台
            </UnstyledButton>
          )}
          {placement?.phase === "review" && (
            <UnstyledButton className={classes.action} disabled={disabled} onClick={() => setPlacementOpen(true)}>
              确认添加位置
            </UnstyledButton>
          )}
          {placement?.phase === "unknown" && (
            <>
              <span className={classes.status}>添加结果待核对：恢复会核对同一次添加，不会生成新{label}</span>
              <UnstyledButton className={classes.action} disabled={disabled || job.status !== "succeeded"} onClick={materialize}>
                恢复本次添加
              </UnstyledButton>
            </>
          )}
          {placement?.phase === "conflict" && (
            <>
              <span className={classes.status}>创作台已有修改，{label}尚未添加</span>
              <UnstyledButton className={classes.action} disabled={disabled || props.awaitingSave} onClick={reviewPlacement}>
                重新核对添加位置
              </UnstyledButton>
            </>
          )}
          {placement?.phase === "placed" && (
            <>
              <span className={classes.status}>已添加到创作台</span>
              {placement.placed && (
                <UnstyledButton
                  className={classes.action}
                  data-quiet
                  onClick={() => props.onFocusNodes(placement.placed!.placements.map((item) => item.nodeId))}
                >
                  定位{label}结果
                </UnstyledButton>
              )}
            </>
          )}
          {job.status === "archive_failed" && !draft?.archiveRequest && (
            <>
              <span className={classes.status}>结果保存未完成，恢复不会重新调用模型</span>
              <UnstyledButton className={classes.action} disabled={disabled} onClick={recoverArchive}>
                恢复{label}归档
              </UnstyledButton>
            </>
          )}
          {draft?.archiveRequest && (
            <>
              <span className={classes.status}>归档恢复结果待核对，请先读取原任务</span>
              <UnstyledButton className={classes.action} data-quiet disabled={disabled} onClick={checkArchive}>
                核对归档恢复
              </UnstyledButton>
              {draft.archiveRequest.checked && (
                <UnstyledButton className={classes.action} disabled={disabled} onClick={recoverArchive}>
                  继续原归档恢复请求
                </UnstyledButton>
              )}
            </>
          )}
        </div>
      )}
      <Modal
        opened={placementOpen && placement?.phase === "review" && state.access === "ready" && job?.status === "succeeded"} // rule 21
        onClose={() => {
          setPlacementOpen(false);
          if (draft) session.updateDraft({ ...draft, placement: undefined }, true);
        }}
        title={`确认添加${label}结果`}
      >
        <Text size="sm">将已归档的{label}作为独立卡片加入创作台，本次固定 {placement?.input.mediaIds.length ?? 0} 份结果。</Text>
        <Text size="xs" c="dimmed" mt="xs">
          位置：{placement?.input.position?.x ?? 0}，{placement?.input.position?.y ?? 0}
        </Text>
        <div className={classes.row} data-align="end" style={{ marginTop: "var(--mantine-spacing-md)" }}>
          <UnstyledButton className={classes.action} disabled={disabled || job?.status !== "succeeded"} onClick={materialize}>
            确认添加到创作台
          </UnstyledButton>
        </div>
      </Modal>
    </section>
  );
  // Focus editing is the same panel in a dialog: nothing else changes.
  return props.focused ? (
    <Modal opened onClose={() => props.onFocusChange(false)} title={`专注编辑 · ${node.title}`} size="xl">
      {panel}
    </Modal>
  ) : (
    panel
  );
}

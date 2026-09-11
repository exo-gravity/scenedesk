import { GenerationJobControls } from "./GenerationJobControls";
import { mediaPost } from "./media-imports";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  Textarea,
  SegmentedControl,
} from "@mantine/core";
import { ArrowsClockwise, FileText, Sparkle } from "@phosphor-icons/react";
import {
  allPages,
  api,
  ApiError,
  useList,
  useResource,
  useSession,
  type Schema,
} from "./api";
import { ErrorNotice, projectPath, tenantPath } from "./common";
import {
  AssistantSession,
  jobFinished,
  jobStatusLabel,
  planForDraft,
  selectedRange,
  type AssistantDraft,
} from "./assistant-session";
import { assistantStorage } from "./assistant-storage";
import { registerAssistant } from "./assistant-lifecycle";
import { subscribeEditingAccess } from "./editing-access";
import classes from "./assistant.module.css";
import { ShotPromptComposer } from "./ShotPromptComposer";

type ExecutionIdentified = {
  executionMode?: "test_fixture" | "verified_provider";
};
export function SceneAssistant(
  props: Parameters<typeof SceneAssistantContent>[0],
) {
  const session = useSession();
  return <AssistantModes key={session.id} {...props} />;
}
function AssistantModes(props: Parameters<typeof SceneAssistantContent>[0]) {
  const [mode, setMode] = useState("script"),
    [shotId, setShotId] = useState<string | null>(null);
  const content = useResource<Schema<"ContentTree">>(
    `${projectPath(props.tenantId, props.projectId)}/content`,
  );
  const shots =
    content.data?.shots.filter(
      (s) => s.sceneId === props.sceneId && s.status === "active",
    ) ?? [];
  const shot = shots.find((s) => s.id === shotId);
  return (
    <Stack gap="md" hidden={!props.visible} className={classes.panel}>
      <SegmentedControl
        value={mode}
        onChange={setMode}
        data={[
          { value: "script", label: "分镜建议" },
          { value: "prompt", label: "准备提示" },
        ]}
      />
      <SceneAssistantContent
        {...props}
        visible={props.visible && mode === "script"}
      />
      <Stack hidden={mode !== "prompt"} className={classes.panel}>
        <ErrorNotice
          error={content.error}
          retry={() => void content.refetch()}
        />
        {!content.error && (
          <>
            <Select
              label="选择本次提示的镜头来源"
              placeholder="明确选择一个镜头"
              value={shotId}
              onChange={setShotId}
              data={shots.map((s) => ({ value: s.id, label: s.label }))}
            />
            {shot ? (
              <ShotPromptComposer
                assistantOnly
                tenantId={props.tenantId}
                projectId={props.projectId}
                shot={shot}
                active={props.active}
              />
            ) : (
              <Text size="sm" c="dimmed">
                选择镜头后，固定其要求与参考，准备本次创作提示。仅画布内容暂不支持此入口。
              </Text>
            )}
          </>
        )}
      </Stack>
    </Stack>
  );
}
function SceneAssistantContent({
  tenantId,
  projectId,
  sceneId,
  active,
  visible,
  onOpenProposal,
}: {
  tenantId: string;
  projectId: string;
  sceneId: string;
  active: boolean;
  visible: boolean;
  onOpenProposal: (id: string) => void;
}) {
  const session = useSession(),
    path = projectPath(tenantId, projectId),
    tenant = tenantPath(tenantId);
  const tree = useResource<Schema<"ContentTree">>(`${path}/content`),
    scripts = useList<Schema<"ScriptRevision">>(`${path}/scripts`),
    capabilities = useList<Schema<"Capability">>(
      `${tenant}/capabilities?purpose=script_analysis`,
    );
  const scene = tree.data?.scenes.find((s) => s.id === sceneId);
  const [controller] = useState(
    () =>
      new AssistantSession(
        assistantStorage(
          session.userId,
          `${path}/scenes/${sceneId}/assistant`,
          session.id,
        ),
        {
          checkAccess: async () => {
            const current = await api<Schema<"Session">>("/v1/session", {
              signal: AbortSignal.timeout(15000),
            });
            if (current.id !== session.id || current.userId !== session.userId)
              throw new ApiError(401, "SESSION_CHANGED", "登录会话已改变。");
            await api(`${path}/content`, {
              signal: AbortSignal.timeout(15000),
            });
          },
          createPlan: (input, key) =>
            post(`${tenant}/generation-plans`, input, key),
          getPlan: (id) =>
            api(`${tenant}/generation-plans/${id}`, {
              signal: AbortSignal.timeout(15000),
            }),
          execute: (planId, key) =>
            post(`${tenant}/generation-jobs`, { planId }, key),
          cancelJob: (jobId, key) =>
            mediaPost(
              session,
              `${tenant}/generation-jobs/${jobId}/cancel`,
              undefined,
              AbortSignal.timeout(15000),
              key,
            ),
          getJob: (id) =>
            api(`${tenant}/generation-jobs/${id}`, {
              signal: AbortSignal.timeout(15000),
            }),
          findJob: async (planId) =>
            (
              await allPages<Schema<"GenerationJob">>(
                `${tenant}/generation-jobs?scope=project&projectId=${projectId}&planId=${planId}`,
              )
            ).find((j) => j.planId === planId),
        },
      ),
  );
  function post<T>(url: string, body: unknown, key: string): Promise<T> {
    return api<T>(url, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrfToken,
        "Idempotency-Key": key,
      },
      body: JSON.stringify(body),
    });
  }
  const state = useSyncExternalStore(
      controller.subscribe,
      controller.getSnapshot,
    ),
    started = useRef(false);
  const initialDraft = scene
    ? {
        scriptId: "",
        quote: "",
        prompt: "",
        capabilityId: "",
        modelLabel: "",
        context: [],
        target: {
          mode: "append_to_scene" as const,
          sceneId: scene.id,
          sceneRevision: scene.revision,
          episodeId: scene.episodeId,
        },
      }
    : undefined;
  useEffect(() => {
    if (!initialDraft || started.current) return;
    started.current = true;
    void controller.load(initialDraft);
  }, [scene, controller]);
  useEffect(() => {
    const unregister = registerAssistant({
      controller,
      userId: session.userId,
      sessionId: session.id,
      tenantId,
      projectId,
    });
    void controller.verify();
    const unsubscribe = subscribeEditingAccess((hint) => {
      if (
        hint.userId !== session.userId ||
        hint.sessionId !== session.id ||
        (hint.kind !== "session" &&
          (hint.tenantId !== tenantId || hint.projectId !== projectId))
      )
        return;
      controller.suspend();
      void controller.verify();
    });
    const check = () => {
      controller.suspend();
      void controller.verify();
    };
    window.addEventListener("online", check);
    window.addEventListener("focus", check);
    return () => {
      unsubscribe();
      unregister();
      window.removeEventListener("online", check);
      window.removeEventListener("focus", check);
    };
  }, [controller, session.id, session.userId, tenantId, projectId]);
  useEffect(() => {
    const error = tree.error ?? scripts.error;
    if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
      controller.suspend();
      void controller.verify();
    }
  }, [tree.error, scripts.error, controller]);
  const { record, plan, job } = state;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (record && !state.draftSaved) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [record, state.draftSaved]);
  useEffect(() => {
    if (!record?.execution || !visible || jobFinished(job)) return;
    const timer = window.setInterval(() => {
      void controller.refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [record?.execution?.planId, visible, job?.status, controller]);
  const [selection, setSelection] = useState<{ start: number; end: number }>(),
    [localError, setLocalError] = useState<string>();
  const source = scripts.data?.find((s) => s.id === record?.draft.scriptId),
    capability = capabilities.data?.find(
      (c) => c.id === record?.draft.capabilityId,
    ),
    frozen = !!record?.planId || !!record?.planRequest,
    disabled = !active || state.busy || !record || frozen,
    targetChanged =
      !!scene &&
      !!record &&
      (record.draft.target.sceneRevision !== scene.revision ||
        record.draft.target.episodeId !== scene.episodeId);
  const available =
    capabilities.data?.filter(
      (c) => c.enabled && c.purpose === "script_analysis",
    ) ?? [];
  const update = (patch: Partial<AssistantDraft>) => {
    if (record) {
      setLocalError(undefined);
      controller.updateDraft({ ...record.draft, ...patch });
    }
  };
  const jobs = useList<Schema<"GenerationJob">>(
    `${tenant}/generation-jobs?scope=project&projectId=${projectId}`,
    visible,
  );
  useEffect(() => {
    if (record?.previous.length) void jobs.refetch();
  }, [record?.previous.length]);
  const localPrevious = useMemo(
    () => new Set(record?.previous.map((r) => r.jobId).filter(Boolean)),
    [record?.previous],
  );
  const permissionHint = [tree.error, scripts.error].some(
    (error) =>
      error instanceof ApiError && [401, 403, 404].includes(error.status),
  );
  if (state.access !== "ready" || permissionHint)
    return (
      <Stack hidden={!visible} className={classes.panel}>
        <Alert
          title={
            state.access === "forbidden" ? "当前不可访问" : "正在核对场次访问"
          }
        >
          <Text size="sm">{state.error ?? "核对完成后恢复助手内容。"}</Text>
          {state.access !== "checking" && (
            <Button
              mt="sm"
              variant="default"
              onClick={() => void controller.verify()}
            >
              重新核对访问权限
            </Button>
          )}
        </Alert>
      </Stack>
    );
  return (
    <Stack gap="md" hidden={!visible} className={classes.panel}>
      <Text size="sm">为当前场次准备可编辑的分镜建议</Text>
      <Text size="sm" fw={600}>
        追加目标：{scene?.title ?? "当前场次"}
      </Text>
      <Text size="xs" c="dimmed">
        建议先保存为提案；由你选择并采纳新镜头。
      </Text>
      <ErrorNotice
        error={tree.error ?? scripts.error ?? capabilities.error}
        retry={() => {
          void tree.refetch();
          void scripts.refetch();
          void capabilities.refetch();
        }}
      />
      {(state.error || localError) && (
        <Alert title="需要处理" role="alert">
          <Text size="sm">{localError ?? state.error}</Text>
          {state.error && (
            <Button
              mt="sm"
              variant="default"
              loading={state.busy}
              onClick={() => {
                if (record) void controller.refresh();
                else if (initialDraft) void controller.load(initialDraft);
              }}
            >
              重新核对助手记录
            </Button>
          )}
        </Alert>
      )}
      {!record ? (
        <Loader size="sm" aria-label="正在恢复助手内容" />
      ) : (
        <>
          {record.execution && !job && (
            <Alert title="提交待核对">
              <Text size="sm">
                尚未收到这次提交的完整回执。先核对原任务，输入会保留。
              </Text>
              <Button
                mt="sm"
                variant="default"
                loading={state.busy}
                onClick={() => void controller.refresh()}
              >
                核对原任务
              </Button>
              {plan?.status === "ready" && (
                <Button
                  mt="sm"
                  variant="default"
                  disabled={!active}
                  loading={state.busy}
                  onClick={() => void controller.resumeSubmission()}
                >
                  继续原提交
                </Button>
              )}
            </Alert>
          )}
          {job && (
            <section aria-label="本次分镜任务" className={classes.result}>
              <Group justify="space-between">
                <Badge variant="light">{jobStatusLabel[job.status]}</Badge>
                <Button
                  size="xs"
                  variant="subtle"
                  aria-label="刷新分镜任务"
                  onClick={() => void controller.refresh()}
                  loading={state.busy}
                >
                  <ArrowsClockwise size={16} />
                </Button>
              </Group>
              <GenerationJobControls
                job={job}
                cancellation={record.cancellation}
                active={active && state.access === "ready"}
                busy={state.busy}
                label="本次分镜任务"
                requestCancellation={(target) =>
                  controller.requestCancellation(target)
                }
              />
              {(job as ExecutionIdentified).executionMode ===
                "test_fixture" && (
                <Alert title="测试任务" mt="sm">
                  这是受控测试输出，不是真实模型创作。
                </Alert>
              )}
              {["submission_unknown", "reconciliation_required"].includes(
                job.status,
              ) && (
                <Text size="sm">
                  供应商是否执行仍待核对。此任务不会因刷新、切换模式或重连而再次提交。
                </Text>
              )}
              {job.status === "archive_failed" && (
                <Text size="sm">
                  模型输出尚未保存为可用提案。请保留本任务，等待结果恢复。
                </Text>
              )}
              {job.errorCode && (
                <Text size="xs" c="dimmed">
                  {job.errorCode}
                </Text>
              )}
              {job.inputOutdated && (
                <Text size="sm">
                  来源已有新修订；本任务仍使用确认时的固定内容。
                </Text>
              )}
              {job.status === "succeeded" && job.proposalId && (
                <Button
                  mt="sm"
                  variant="filled"
                  leftSection={<FileText size={16} />}
                  onClick={() => onOpenProposal(job.proposalId!)}
                >
                  编辑并采纳分镜提案
                </Button>
              )}
              {job.status === "succeeded" && !job.proposalId && (
                <Alert title="结果入口尚未就绪">
                  任务未返回可用分镜提案，请刷新核对。
                </Alert>
              )}
            </section>
          )}
          {plan ? (
            <section aria-label="固定生成计划" className={classes.result}>
              <Text fw={600}>本次固定计划</Text>
              <Text size="sm">
                {record.draft.modelLabel || "已选模型"} · 能力版本{" "}
                {plan.capabilityRevision}
              </Text>
              {(plan as ExecutionIdentified).executionMode ===
                "test_fixture" && (
                <Alert title="测试能力">
                  本计划仅用于验证交互和恢复，不是真实 AI 服务。
                </Alert>
              )}
              <Text size="sm">
                追加到当前场次 · 目标版本{" "}
                {plan.input.proposalTarget?.mode === "append_to_scene"
                  ? plan.input.proposalTarget.sceneRevision
                  : "—"}
              </Text>
              <Text size="xs" c="dimmed">
                有效期至 {new Date(plan.expiresAt).toLocaleString()}
              </Text>
              <details open>
                <summary>发送的原文片段</summary>
                <Text size="sm" className={classes.prose}>
                  {plan.resolvedInput.sourceExcerpt?.quote ??
                    record.draft.quote}
                </Text>
              </details>
              {plan.resolvedInput.prompt && (
                <details>
                  <summary>创作要求</summary>
                  <Text size="sm" className={classes.prose}>
                    {plan.resolvedInput.prompt}
                  </Text>
                </details>
              )}
              {!!plan.resolvedInput.contextSnapshots?.length && (
                <details>
                  <summary>
                    附带的上下文（{plan.resolvedInput.contextSnapshots.length}{" "}
                    项）
                  </summary>
                  {plan.resolvedInput.contextSnapshots.map((context, index) => (
                    <Text key={index} size="sm" className={classes.prose}>
                      {context.text}
                    </Text>
                  ))}
                </details>
              )}
              {plan.costEstimate && (
                <Text size="sm">
                  预计执行预留：
                  {(
                    Number(plan.costEstimate.totalReservation.amountMicros) /
                    1000000
                  ).toLocaleString(undefined, {
                    maximumFractionDigits: 6,
                  })}{" "}
                  {plan.costEstimate.totalReservation.currency}
                  <br />
                  {plan.costEstimate.basisNote}
                </Text>
              )}
              {plan.blockingReasons.map((reason, index) => (
                <Alert key={index} title="当前不可执行">
                  {reason}
                </Alert>
              ))}
              {!record.execution && (
                <Button
                  variant="filled"
                  leftSection={<Sparkle size={16} />}
                  disabled={
                    !active ||
                    plan.status !== "ready" ||
                    Date.parse(plan.expiresAt) <= Date.now()
                  }
                  loading={state.busy}
                  onClick={() => void controller.execute()}
                >
                  {(plan as ExecutionIdentified).executionMode ===
                  "test_fixture"
                    ? "确认执行测试计划"
                    : "确认执行分镜分析"}
                </Button>
              )}
              {(!record.execution || jobFinished(job)) && (
                <Button
                  variant="default"
                  disabled={!active || state.busy}
                  onClick={() =>
                    void controller.revise(
                      scene
                        ? {
                            ...record.draft,
                            target: {
                              mode: "append_to_scene",
                              sceneId: scene.id,
                              sceneRevision: scene.revision,
                              episodeId: scene.episodeId,
                            },
                          }
                        : undefined,
                    )
                  }
                >
                  {record.execution ? "准备另一份提案" : "返回修改输入"}
                </Button>
              )}
            </section>
          ) : (
            <>
              {record.planRequest && (
                <Alert title="计划回执待核对">
                  <Text size="sm">
                    输入已固定，可以继续取回这份计划；此步骤不会执行模型。
                  </Text>
                  <Button
                    mt="sm"
                    loading={state.busy}
                    onClick={() =>
                      void controller.prepare(record.planRequest!.input)
                    }
                  >
                    取回原计划
                  </Button>
                </Alert>
              )}
              {!scripts.isPending && !scripts.data?.length && (
                <Alert title="先保存剧本">
                  <Text size="sm">
                    在项目的剧本页保存文本修订，再回到这里选择片段。
                  </Text>
                  <Button
                    component="a"
                    href={`#/app/t/${tenantId}/p/${projectId}/content`}
                    variant="subtle"
                    mt="sm"
                  >
                    打开剧本与内容
                  </Button>
                </Alert>
              )}
              <Select
                label="来源剧本"
                placeholder="明确选择一个修订"
                disabled={disabled}
                value={record.draft.scriptId || null}
                data={(scripts.data ?? []).map((s) => ({
                  value: s.id,
                  label: `剧本第 ${s.number} 版${s.id === tree.data?.currentScriptRevisionId ? " · 当前" : ""}`,
                }))}
                onChange={(id) => {
                  setSelection(undefined);
                  update({ scriptId: id ?? "", quote: "", range: undefined });
                }}
              />
              {source && (
                <>
                  <Textarea
                    label="选择要分析的原文"
                    description="拖选或用键盘选择片段，再点“使用选区”。"
                    value={source.text}
                    readOnly
                    minRows={6}
                    maxRows={10}
                    autosize
                    onSelect={(event) =>
                      setSelection({
                        start: event.currentTarget.selectionStart,
                        end: event.currentTarget.selectionEnd,
                      })
                    }
                  />
                  <Group gap="xs">
                    <Button
                      size="xs"
                      disabled={
                        disabled ||
                        !selection ||
                        selection.end <= selection.start
                      }
                      onClick={() => {
                        try {
                          if (selection)
                            update(
                              selectedRange(
                                source.text,
                                selection.start,
                                selection.end,
                              ),
                            );
                        } catch (error) {
                          setLocalError((error as Error).message);
                        }
                      }}
                    >
                      使用选区
                    </Button>
                    <Button
                      size="xs"
                      variant="subtle"
                      disabled={disabled || !source.text.trim()}
                      onClick={() =>
                        update(
                          selectedRange(source.text, 0, source.text.length),
                        )
                      }
                    >
                      明确使用整篇
                    </Button>
                  </Group>
                </>
              )}
              {record.draft.range && (
                <section className={classes.selection} aria-label="已选原文">
                  <Text size="xs" fw={600}>
                    已选 {Array.from(record.draft.quote).length} 字 ·
                    固定剧本片段
                  </Text>
                  <Text size="sm" className={classes.prose}>
                    {record.draft.quote}
                  </Text>
                </section>
              )}
              <Textarea
                label="分镜要求"
                description="可说明镜头节奏、数量或重点。"
                placeholder="例如：突出两个人的反应，保留原台词"
                value={record.draft.prompt}
                maxLength={10000}
                minRows={3}
                autosize
                disabled={disabled}
                onChange={(e) => update({ prompt: e.currentTarget.value })}
              />
              {scene && (
                <Checkbox
                  label="附带本场摘要与连续性设定"
                  description="仅在勾选后发送当前场次的设定。"
                  checked={record.draft.context.some(
                    (c) => c.source.kind === "scene",
                  )}
                  disabled={disabled}
                  onChange={(event) =>
                    update({
                      context: event.currentTarget.checked
                        ? [
                            {
                              source: {
                                kind: "scene",
                                objectId: scene.id,
                                revision: scene.revision,
                              },
                              label: scene.title,
                              text: scene.summary,
                            },
                          ]
                        : [],
                    })
                  }
                />
              )}
              {record.draft.context.map((context) => (
                <Text size="xs" c="dimmed" key={context.source.objectId}>
                  已选：{context.label} · 版本 {context.source.revision}
                </Text>
              ))}
              {targetChanged && (
                <Alert title="场次已有新修订">
                  <Text size="sm">
                    原选定的场次版本会继续保留。请核对场次后更新目标，再准备计划。
                  </Text>
                  <Button
                    variant="default"
                    mt="sm"
                    disabled={disabled}
                    onClick={() => {
                      if (scene)
                        update({
                          target: {
                            mode: "append_to_scene",
                            sceneId: scene.id,
                            sceneRevision: scene.revision,
                            episodeId: scene.episodeId,
                          },
                        });
                    }}
                  >
                    已核对，更新目标版本
                  </Button>
                </Alert>
              )}
              <Select
                label="分镜分析模型"
                placeholder={
                  capabilities.isPending
                    ? "正在读取可用能力"
                    : "选择实际可用模型"
                }
                value={record.draft.capabilityId || null}
                disabled={disabled || !available.length}
                data={available.map((c) => ({
                  value: c.id,
                  label: `${c.modelVersion} · ${c.mode}${(c as ExecutionIdentified).executionMode === "test_fixture" ? " · 测试" : ""}`,
                }))}
                onChange={(id) =>
                  update({
                    capabilityId: id ?? "",
                    modelLabel:
                      available.find((c) => c.id === id)?.modelVersion ?? "",
                  })
                }
              />
              {!capabilities.isPending &&
                !capabilities.error &&
                !available.length && (
                  <Alert title="分镜分析服务尚不可用">
                    当前工作室没有已启用的分镜分析能力。可以先保存选区与要求，接入可用服务后继续。
                  </Alert>
                )}
              {capability?.notes && <Text size="sm">{capability.notes}</Text>}
              {capability &&
                (capability as ExecutionIdentified).executionMode ===
                  "test_fixture" && (
                  <Alert title="仅供测试">
                    此能力返回受控测试提案，不是真实模型生成。
                  </Alert>
                )}
              <Button
                variant="filled"
                disabled={
                  disabled ||
                  targetChanged ||
                  !record.draft.range ||
                  !capability?.enabled
                }
                onClick={() => {
                  try {
                    if (capability)
                      void controller.prepare(
                        planForDraft(record.draft, projectId, capability),
                      );
                  } catch (error) {
                    setLocalError((error as Error).message);
                  }
                }}
              >
                查看分镜分析计划
              </Button>
              <Text size="xs" c="dimmed">
                {state.draftSaved
                  ? "选区和要求已保留在本机。"
                  : "正在保存本机输入…"}
                执行前会再次展示固定输入。
              </Text>
            </>
          )}
          {!!record.previous.length && (
            <details>
              <summary>先前的任务</summary>
              <Stack gap="sm" mt="sm">
                {record.previous.map((previous, index) => {
                  const savedJob = jobs.data?.find(
                    (j) => j.id === previous.jobId && localPrevious.has(j.id),
                  );
                  return (
                    <div key={previous.planId}>
                      <Text size="sm">
                        第 {index + 1} 次 ·{" "}
                        {savedJob
                          ? jobStatusLabel[savedJob.status]
                          : "计划已保留"}
                      </Text>
                      {savedJob?.proposalId && (
                        <Button
                          size="xs"
                          variant="default"
                          onClick={() => onOpenProposal(savedJob.proposalId!)}
                        >
                          打开分镜提案
                        </Button>
                      )}
                    </div>
                  );
                })}
              </Stack>
            </details>
          )}
        </>
      )}
    </Stack>
  );
}

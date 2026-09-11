import { useEffect, useState } from "react";
import {
  Alert,
  Accordion,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import {
  ArrowBendDownRight,
  ArrowsClockwise,
  Sparkle,
} from "@phosphor-icons/react";
import { api, ApiError, useList, useSession, type Schema } from "./api";
import { ErrorNotice, projectPath, tenantPath } from "./common";
import { jobFinished, jobStatusLabel } from "./assistant-session";
import {
  applyPrompt,
  promptPlan,
  nextPromptInput,
  sameValue,
  recoverArtifactSave,
  validateArtifact,
  type IdentifiedArtifact,
  type PromptDraft,
  type ReworkSource,
} from "./prompt-draft";
import { usePromptSession } from "./use-prompt-session";
import classes from "./assistant.module.css";
import { AudioGenerationWorkspace } from "./AudioGenerationWorkspace";
import { VideoGenerationWorkspace } from "./VideoGenerationWorkspace";
import { ImageGenerationWorkspace } from "./ImageGenerationWorkspace";
type Execution = { executionMode?: "test_fixture" | "verified_provider" };
export function ShotPromptComposer(props: {
  tenantId: string;
  projectId: string;
  shot: Schema<"Shot">;
  active: boolean;
  assistantOnly?: boolean;
  rework?: ReworkSource;
}) {
  const session = useSession();
  return (
    <PromptContent
      key={`${session.id}:${props.shot.id}:${props.rework?.takeId ?? ""}:${props.rework?.comment.id ?? ""}:${props.rework?.comment.revision ?? ""}`}
      {...props}
    />
  );
}
function PromptContent({
  tenantId,
  projectId,
  shot,
  active,
  assistantOnly = false,
  rework,
}: Parameters<typeof ShotPromptComposer>[0]) {
  const session = useSession(),
    path = projectPath(tenantId, projectId),
    tenant = tenantPath(tenantId);
  const { controller, state } = usePromptSession(
    tenantId,
    projectId,
    shot,
    rework,
  );
  const capabilities = useList<Schema<"Capability">>(`${tenant}/capabilities`);
  const savedArtifacts = useList<IdentifiedArtifact>(
    `${path}/assistance-artifacts?shotId=${shot.id}&kind=${rework ? "prepare_rework" : "prepare_prompt"}`,
    state.access === "ready",
  );
  useEffect(() => {
    if (
      [capabilities.error, savedArtifacts.error].some(
        (error) =>
          error instanceof ApiError && [401, 403, 404].includes(error.status),
      )
    ) {
      controller.suspend();
      void controller.verify();
    }
  }, [capabilities.error, savedArtifacts.error, controller]);
  const [error, setError] = useState<string>(),
    [confirmation, setConfirmation] = useState<PromptDraft>();
  useEffect(() => {
    if (state.access !== "ready") {
      setConfirmation(undefined);
      setHistoryRevision(null);
      setNextInput(undefined);
    }
  }, [state.access]);
  const [nextInput, setNextInput] = useState<{
    draft: PromptDraft;
    shot: Schema<"Shot">;
  }>();
  const [historyRevision, setHistoryRevision] = useState<string | null>(null);
  const { record, plan, job } = state,
    draft = record?.draft,
    artifact = draft?.artifact;
  const frozen = !!record?.planId || !!record?.planRequest;
  const disabled = !active || state.busy || !draft;
  const assistant = capabilities.data?.find(
      (c) => c.id === draft?.capabilityId,
    ),
    target = capabilities.data?.find((c) => c.id === draft?.targetCapabilityId);
  const label = (capability: Schema<"Capability">) =>
    `${capability.modelVersion} · ${capability.purpose}${(capability as Execution).executionMode === "test_fixture" ? " · 受控测试" : ""}`;
  const textModels =
      capabilities.data?.filter(
        (c) => c.enabled && c.purpose === "creative_assistance",
      ) ?? [],
    targets =
      capabilities.data?.filter(
        (c) => c.enabled && ["image", "video", "audio"].includes(c.purpose),
      ) ?? [];
  const update = (patch: Partial<PromptDraft>) => {
    if (draft) {
      setError(undefined);
      controller.updateDraft({ ...draft, ...patch }, true);
    }
  };
  const readArtifact = (id: string, revision?: number) =>
    api<IdentifiedArtifact>(
      `${path}/assistance-artifacts/${id}${revision ? `/revisions/${revision}` : ""}`,
      { signal: AbortSignal.timeout(15000) },
    );
  const openArtifact = (id: string) => {
    if (!draft) return;
    void controller.commitDraft(draft, draft, async (current) => {
      const found = await readArtifact(id);
      validateArtifact(current, found);
      return {
        ...current,
        artifact: found,
        editBody: found.body,
        saveIntent: undefined,
      };
    });
  };
  const save = () => {
    if (!draft || !artifact || !draft.editBody) return;
    const intent = draft.saveIntent ?? {
      revision: artifact.revision,
      body: {
        ...structuredClone(draft.editBody),
        retain: draft.editBody.retain.filter((item) => item.trim()),
        change: draft.editBody.change.filter((item) => item.trim()),
      },
    };
    void controller.commitDraft(
      draft,
      { ...draft, saveIntent: intent },
      async (current) => {
        const saved = await api<IdentifiedArtifact>(
          `${path}/assistance-artifacts/${artifact.id}`,
          {
            method: "PUT",
            signal: AbortSignal.timeout(15000),
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
              "If-Match": `"${intent.revision}"`,
            },
            body: JSON.stringify({ body: intent.body }),
          },
        );
        validateArtifact(current, saved);
        return {
          ...current,
          artifact: saved,
          editBody: saved.body,
          saveIntent: undefined,
        };
      },
    );
  };
  const apply = () => {
    if (!confirmation?.artifact) return;
    const expected = confirmation,
      fixedArtifact = confirmation.artifact;
    setConfirmation(undefined);
    void controller.commitDraft(expected, expected, async (current) => {
      const [freshArtifact, tree] = await Promise.all([
        readArtifact(fixedArtifact.id, fixedArtifact.revision),
        api<Schema<"ContentTree">>(`${path}/content`, {
          signal: AbortSignal.timeout(15000),
        }),
      ]);
      const latest = tree.shots.find((s) => s.id === current.source.shotId);
      if (
        !latest ||
        latest.status !== "active" ||
        (!current.rework &&
          latest.specRevisionId !== current.source.shotRevisionId)
      )
        throw new Error(
          "镜头来源已改变。当前输入仍保留，请核对镜头后重新准备。",
        );
      if (current.rework) {
        const take = await api<Schema<"Take">>(
          `${path}/takes/${current.rework.takeId}`,
        );
        if (
          take.shotId !== current.source.shotId ||
          take.shotRevisionId !== current.source.shotRevisionId
        )
          throw new Error("候选来源已改变，请保留原输入核对。");
      }
      return applyPrompt(current, freshArtifact);
    });
  };
  if (state.access !== "ready")
    return (
      <Alert
        title={
          state.access === "forbidden" ? "当前不可访问" : "正在核对镜头访问"
        }
      >
        <Text size="sm">{state.error ?? "核对完成后恢复本次输入。"}</Text>
        {state.access === "checking" ? (
          <Loader size="sm" />
        ) : (
          <Button
            mt="sm"
            variant="default"
            onClick={() => void controller.verify()}
          >
            重新核对访问权限
          </Button>
        )}
      </Alert>
    );
  return (
    <Stack
      className={assistantOnly ? classes.panel : classes.creation}
      gap="md"
      aria-label={rework ? "按意见准备修改" : "本次创作输入"}
    >
      <Group justify="space-between">
        <Text fw={600}>
          {rework ? "按意见准备修改" : "本次创作输入"} · {draft?.label}
        </Text>
        <Badge variant="light">
          {state.draftSaved ? "本机已保留" : "正在保留"}
        </Badge>
      </Group>
      <Text size="xs" c="dimmed">
        固定镜头要求：{draft?.intent}。切换镜头后，可返回此修订继续本次输入。
      </Text>
      {draft?.rework && (
        <div className={classes.selection}>
          <Text size="sm">
            固定候选 {draft.rework.takeId.slice(0, 8)} · 意见 r
            {draft.rework.comment.revision}
          </Text>
          <Text size="sm" className={classes.prose}>
            {draft.rework.comment.body}
          </Text>
          <Text size="xs" c="dimmed">
            新尝试保留原候选、原意见及普通创作输入。
          </Text>
        </div>
      )}
      {(state.error || error) && (
        <Alert role="alert" title="需要处理">
          {state.error ?? error}
        </Alert>
      )}
      {!assistantOnly && (
        <Textarea
          label="本次提示"
          description="手工内容保留在此；建议由你确认后追加。"
          minRows={3}
          autosize
          maxRows={8}
          value={draft?.prompt ?? ""}
          disabled={disabled}
          onChange={(e) => update({ prompt: e.currentTarget.value })}
        />
      )}
      {draft?.assistanceSource && (
        <Text size="xs" c="dimmed">
          已应用提示建议 r{draft.assistanceSource.revision}
          ，来源修订已固定。继续手工编辑不会改变该来源。
        </Text>
      )}
      {!!draft?.references.length && (
        <Text size="sm">
          已带入 {draft.references.length} 个固定参考。
          {draft.references.map((r) => r.note ?? r.purpose).join("、")}
        </Text>
      )}
      {!assistantOnly && draft && (
        <Accordion>
          <Accordion.Item value="image">
            <Accordion.Control icon={<Sparkle size={16} />}>
              生成图片
            </Accordion.Control>
            <Accordion.Panel>
              <ImageGenerationWorkspace
                tenantId={tenantId}
                projectId={projectId}
                source={{ kind: "shot", creation: draft }}
                active={active}
              />
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="video">
            <Accordion.Control icon={<Sparkle size={16} />}>
              生成视频
            </Accordion.Control>
            <Accordion.Panel>
              <VideoGenerationWorkspace
                tenantId={tenantId}
                projectId={projectId}
                source={{ kind: "shot", creation: draft }}
                active={active}
              />
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="audio">
            <Accordion.Control icon={<Sparkle size={16} />}>
              生成音频
            </Accordion.Control>
            <Accordion.Panel>
              <AudioGenerationWorkspace
                tenantId={tenantId}
                projectId={projectId}
                source={{ kind: "shot", creation: draft }}
                active={active}
              />
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}
      {draft && (
        <Button
          variant="subtle"
          disabled={
            disabled ||
            !!record?.planRequest ||
            !!draft.saveIntent ||
            (!!artifact && !sameValue(draft.editBody, artifact.body)) ||
            (!!record?.execution && !jobFinished(job))
          }
          onClick={() =>
            setNextInput({
              draft: structuredClone(draft),
              shot: structuredClone(shot),
            })
          }
        >
          保留当前输入，另开一次
        </Button>
      )}
      {!!draft?.previousInputs?.length && (
        <details>
          <summary>此前保留的输入（{draft.previousInputs.length}）</summary>
          <Stack mt="sm">
            {draft.previousInputs.map((input, index) => (
              <div key={index} className={classes.selection}>
                <Text size="xs" c="dimmed">
                  第 {index + 1} 次输入
                  {input.assistanceSource
                    ? ` · 建议 r${input.assistanceSource.revision}`
                    : ""}
                </Text>
                <Text className={classes.prose} size="sm">
                  {input.prompt || "（未填写手工提示）"}
                </Text>
                {input.instruction && (
                  <Text className={classes.prose} size="sm">
                    准备要求：{input.instruction}
                  </Text>
                )}
              </div>
            ))}
          </Stack>
        </details>
      )}
      <Accordion defaultValue={assistantOnly ? "prepare" : null}>
        <Accordion.Item value="prepare">
          <Accordion.Control icon={<Sparkle size={16} />}>
            AI 准备提示
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              <ErrorNotice
                error={capabilities.error}
                retry={() => void capabilities.refetch()}
              />
              {!capabilities.isLoading &&
                !capabilities.error &&
                (!textModels.length || !targets.length) && (
                  <Alert title="提示准备暂不可用">
                    {!textModels.length
                      ? "尚未配置可用的提示准备模型。"
                      : "尚未配置可用的目标生成能力。"}{" "}
                    你可以先保留手工输入。
                  </Alert>
                )}
              <Select
                label="准备提示的模型"
                data={textModels.map((c) => ({ value: c.id, label: label(c) }))}
                value={draft?.capabilityId || null}
                disabled={disabled || frozen}
                onChange={(value) => update({ capabilityId: value ?? "" })}
              />
              <Select
                label="提示将用于哪项能力"
                data={targets.map((c) => ({ value: c.id, label: label(c) }))}
                value={draft?.targetCapabilityId || null}
                disabled={disabled || frozen}
                onChange={(value) => {
                  const cap = targets.find((c) => c.id === value);
                  update({
                    targetCapabilityId: value ?? "",
                    targetCapabilityRevision: cap?.revision,
                  });
                }}
              />
              <Textarea
                label="本次准备要求"
                placeholder="例如：强调人物动作和镜头运动，保留已有造型。"
                value={draft?.instruction ?? ""}
                onChange={(e) => update({ instruction: e.currentTarget.value })}
                disabled={disabled || frozen}
                minRows={2}
              />
              <Text size="xs" c="dimmed">
                {rework
                  ? "使用候选当时的镜头要求及选定意见修订。意见后来有变化时，原记录保留供核对。"
                  : "上下文仅使用已固定的当前镜头及其引用。可在候选旁记录意见，再按意见准备修改。"}
              </Text>
              {!plan && (
                <Button
                  leftSection={<Sparkle size={16} />}
                  disabled={
                    disabled || !assistant || !target || !!record?.execution
                  }
                  onClick={() => {
                    try {
                      if (draft && assistant && target)
                        void controller.prepare(
                          promptPlan(draft, projectId, assistant, target),
                        );
                    } catch (cause) {
                      setError(
                        cause instanceof Error ? cause.message : "请核对能力。",
                      );
                    }
                  }}
                >
                  {record?.planRequest ? "恢复原计划请求" : "查看固定计划"}
                </Button>
              )}
              {plan && (
                <Stack gap="sm" className={classes.result}>
                  <Group justify="space-between">
                    <Text fw={600}>固定生成计划</Text>
                    <Badge variant="light">
                      {plan.status === "ready"
                        ? "可执行"
                        : plan.status === "consumed"
                          ? "已提交"
                          : "暂不可执行"}
                    </Badge>
                  </Group>
                  {(plan as Execution).executionMode === "test_fixture" && (
                    <Alert title="受控测试能力">
                      用于验证交互与恢复流程，不是真实模型产出。
                    </Alert>
                  )}
                  <Text size="sm">
                    来源：{draft?.label} · {plan.resolvedInput.shots.length}{" "}
                    个固定镜头
                  </Text>
                  {plan.resolvedInput.feedbackSnapshot && (
                    <div className={classes.selection}>
                      <Text size="xs" c="dimmed">
                        计划固定意见 · r
                        {plan.resolvedInput.feedbackSnapshot.commentRevision}
                      </Text>
                      <Text size="sm" className={classes.prose}>
                        {plan.resolvedInput.feedbackSnapshot.body}
                      </Text>
                    </div>
                  )}
                  <Text size="sm">
                    目标能力：
                    {(
                      plan.resolvedInput as Schema<"ResolvedInput"> & {
                        targetCapabilitySnapshot?: Schema<"Capability">;
                      }
                    ).targetCapabilitySnapshot?.modelVersion ??
                      target?.modelVersion}{" "}
                    · r{plan.input.assistance?.targetCapabilityRevision}
                  </Text>
                  <Text size="sm" className={classes.prose}>
                    {plan.resolvedInput.prompt}
                  </Text>
                  <Text size="xs" c="dimmed">
                    计划有效至 {new Date(plan.expiresAt).toLocaleString()}
                    。执行只准备建议，随后可编辑和应用。
                  </Text>
                  {plan.blockingReasons.map((reason, index) => (
                    <Text c="red" size="sm" key={index}>
                      {typeof reason === "string"
                        ? reason
                        : JSON.stringify(reason)}
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
                      明确执行提示准备
                    </Button>
                  )}
                  {(!record?.execution || jobFinished(job)) && (
                    <Button
                      variant="subtle"
                      disabled={disabled}
                      onClick={() => {
                        if (draft)
                          void controller.revise({
                            ...draft,
                            artifact: undefined,
                            editBody: undefined,
                            saveIntent: undefined,
                          });
                      }}
                    >
                      保留输入，调整下一次准备
                    </Button>
                  )}
                </Stack>
              )}
              {record?.execution && (
                <Stack gap="sm" className={classes.result}>
                  <Group justify="space-between">
                    <Text fw={600}>
                      {job?.status === "succeeded"
                        ? "提示建议可用"
                        : job
                          ? jobStatusLabel[job.status]
                          : "提交结果待核对"}
                    </Text>
                    <Button
                      variant="subtle"
                      leftSection={<ArrowsClockwise size={16} />}
                      disabled={state.busy}
                      onClick={() => void controller.refresh()}
                    >
                      核对原任务
                    </Button>
                  </Group>
                  {(!job ||
                    ["submission_unknown", "reconciliation_required"].includes(
                      job.status,
                    )) && (
                    <Text size="sm">
                      正在核对原任务；切换页面和刷新不会再次执行。
                    </Text>
                  )}
                  {!job && (
                    <Button
                      variant="default"
                      disabled={disabled}
                      onClick={() => void controller.resumeSubmission()}
                    >
                      核对后恢复原提交
                    </Button>
                  )}
                  {job?.assistanceArtifactId && (
                    <Button
                      disabled={
                        disabled ||
                        !!draft?.saveIntent ||
                        (!!artifact &&
                          !sameValue(draft?.editBody, artifact.body))
                      }
                      onClick={() => openArtifact(job.assistanceArtifactId!)}
                    >
                      打开提示建议
                    </Button>
                  )}
                  {job?.inputOutdated && (
                    <Alert>来源已有变化，请核对后重新准备。</Alert>
                  )}
                </Stack>
              )}
              <ErrorNotice
                error={savedArtifacts.error}
                retry={() => void savedArtifacts.refetch()}
              />
              {!!savedArtifacts.data?.length && (
                <Select
                  label="找回已保存的提示建议"
                  placeholder="选择建议"
                  value={artifact?.id ?? null}
                  disabled={
                    disabled ||
                    !!draft?.saveIntent ||
                    (!!artifact && !sameValue(draft?.editBody, artifact.body))
                  }
                  data={savedArtifacts.data
                    .filter(
                      (a) =>
                        (rework
                          ? a.request.sourceTakeId === rework.takeId &&
                            a.request.feedback?.commentId ===
                              rework.comment.id &&
                            (a.request.feedback as { commentRevision?: number })
                              ?.commentRevision === rework.comment.revision
                          : a.request.kind === "prepare_prompt") &&
                        a.shotSources.some(
                          (source) =>
                            source.shotId === draft?.source.shotId &&
                            source.shotRevisionId ===
                              draft?.source.shotRevisionId,
                        ),
                    )
                    .map((a) => ({
                      value: a.id,
                      label: `${a.body.prompt.slice(0, 28)} · r${a.revision}${a.executionMode === "test_fixture" ? " · 受控测试" : ""}`,
                    }))}
                  onChange={(id) => id && openArtifact(id)}
                />
              )}
              {artifact && (
                <Stack gap="sm" className={classes.result}>
                  <Group>
                    <Text fw={600}>可编辑提示建议</Text>
                    <Badge>r{artifact.revision}</Badge>
                    {artifact.executionMode === "test_fixture" && (
                      <Badge color="orange">受控测试结果</Badge>
                    )}
                  </Group>
                  {artifact.inputOutdated && (
                    <Alert>此建议来源已改变，保留内容供核对。</Alert>
                  )}
                  <Select
                    label="查看已保存的建议历史"
                    value={historyRevision}
                    onChange={(value) => {
                      setHistoryRevision(value);
                      if (value && draft)
                        void controller.commitDraft(
                          draft,
                          draft,
                          async (current) => ({
                            ...current,
                            historyArtifact: await readArtifact(
                              artifact.id,
                              Number(value),
                            ),
                          }),
                        );
                    }}
                    disabled={disabled}
                    placeholder="选择固定修订（只读）"
                    data={Array.from(
                      { length: artifact.revision },
                      (_, index) => ({
                        value: String(index + 1),
                        label: `r${index + 1}${index === 0 ? " · 原始建议" : ""}`,
                      }),
                    )}
                  />
                  {historyRevision && draft?.historyArtifact && (
                    <div className={classes.selection}>
                      <Text size="xs" c="dimmed">
                        历史 r{draft.historyArtifact.revision} · 只读
                      </Text>
                      <Text size="sm" className={classes.prose}>
                        {draft.historyArtifact.body.prompt}
                      </Text>
                    </div>
                  )}
                  <Textarea
                    label="建议提示"
                    autosize
                    minRows={3}
                    maxRows={10}
                    value={draft?.editBody?.prompt ?? ""}
                    disabled={disabled || !!draft?.saveIntent}
                    onChange={(e) =>
                      draft?.editBody &&
                      update({
                        editBody: {
                          ...draft.editBody,
                          prompt: e.currentTarget.value,
                        },
                      })
                    }
                  />
                  <Textarea
                    label="建议备注"
                    autosize
                    minRows={2}
                    value={draft?.editBody?.notes ?? ""}
                    disabled={disabled || !!draft?.saveIntent}
                    onChange={(e) =>
                      draft?.editBody &&
                      update({
                        editBody: {
                          ...draft.editBody,
                          notes: e.currentTarget.value,
                        },
                      })
                    }
                  />
                  <Textarea
                    label="保留要求（每行一项）"
                    value={draft?.editBody?.retain.join("\n") ?? ""}
                    disabled={disabled || !!draft?.saveIntent}
                    onChange={(e) =>
                      draft?.editBody &&
                      update({
                        editBody: {
                          ...draft.editBody,
                          retain: e.currentTarget.value.split("\n"),
                        },
                      })
                    }
                  />
                  <Textarea
                    label="调整要求（每行一项）"
                    value={draft?.editBody?.change.join("\n") ?? ""}
                    disabled={disabled || !!draft?.saveIntent}
                    onChange={(e) =>
                      draft?.editBody &&
                      update({
                        editBody: {
                          ...draft.editBody,
                          change: e.currentTarget.value.split("\n"),
                        },
                      })
                    }
                  />
                  {!!draft?.editBody?.referenceSuggestions.length && (
                    <Text size="sm">
                      建议参考：
                      {draft.editBody.referenceSuggestions
                        .map((r) => r.note ?? r.purpose)
                        .join("、")}
                    </Text>
                  )}
                  {draft?.saveIntent && (
                    <Alert title="保存结果待核对">
                      本机编辑已保留。先读取原建议，核对保存是否完成。
                    </Alert>
                  )}
                  <Group>
                    <Button
                      disabled={
                        disabled ||
                        !draft?.editBody?.prompt.trim() ||
                        (!!draft?.saveIntent && !draft.saveIntent.checked) ||
                        (!draft?.saveIntent &&
                          sameValue(draft?.editBody, artifact.body))
                      }
                      onClick={save}
                    >
                      {draft?.saveIntent ? "按原修订重试保存" : "保存建议修订"}
                    </Button>
                    <Button
                      variant="default"
                      disabled={disabled}
                      onClick={() =>
                        draft &&
                        void controller.commitDraft(
                          draft,
                          draft,
                          async (current) =>
                            recoverArtifactSave(
                              current,
                              await readArtifact(artifact.id),
                            ),
                        )
                      }
                    >
                      核对建议修订
                    </Button>
                  </Group>
                  {(!!draft?.saveIntent ||
                    !sameValue(draft?.editBody, artifact.body)) && (
                    <Button
                      variant="subtle"
                      disabled={disabled}
                      onClick={() =>
                        draft &&
                        void controller.commitDraft(
                          draft,
                          draft,
                          async (current) => {
                            const latest = await readArtifact(artifact.id);
                            validateArtifact(current, latest);
                            return {
                              ...current,
                              retainedEdits: [
                                ...(current.retainedEdits ?? []),
                                {
                                  artifactId: artifact.id,
                                  revision: artifact.revision,
                                  body: current.editBody ?? artifact.body,
                                },
                              ],
                              artifact: latest,
                              editBody: latest.body,
                              saveIntent: undefined,
                            };
                          },
                        )
                      }
                    >
                      保留本机编辑副本，打开最新修订
                    </Button>
                  )}
                  {!!draft?.retainedEdits?.length && (
                    <details>
                      <summary>
                        已保留的本机编辑副本（{draft.retainedEdits.length}）
                      </summary>
                      <Stack mt="sm">
                        {draft.retainedEdits.map((edit, index) => (
                          <div key={index} className={classes.selection}>
                            <Text size="xs" c="dimmed">
                              基于 r{edit.revision} 的本机编辑 · 只读
                            </Text>
                            <Text size="sm" className={classes.prose}>
                              {edit.body.prompt}
                            </Text>
                            <Text size="sm" className={classes.prose}>
                              {edit.body.notes}
                            </Text>
                            <Text size="sm">
                              保留：{edit.body.retain.join("；")}；调整：
                              {edit.body.change.join("；")}
                            </Text>
                          </div>
                        ))}
                      </Stack>
                    </details>
                  )}
                  <Button
                    leftSection={<ArrowBendDownRight size={16} />}
                    disabled={
                      disabled ||
                      !!draft?.saveIntent ||
                      !!draft?.assistanceSource ||
                      artifact.inputOutdated ||
                      !sameValue(draft?.editBody, artifact.body)
                    }
                    onClick={() =>
                      draft && setConfirmation(structuredClone(draft))
                    }
                  >
                    {draft?.assistanceSource
                      ? "本次输入已应用建议"
                      : "追加到本次提示…"}
                  </Button>
                </Stack>
              )}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
      <Modal
        opened={!!nextInput && state.access === "ready"}
        onClose={() => setNextInput(undefined)}
        title="保留当前输入，另开一次"
        centered
      >
        <Stack>
          <Text>
            当前原文、准备要求与建议来源将保留，原固定任务不会改变。下一次使用本次确认打开的镜头要求：
            {nextInput?.shot.label} · {nextInput?.shot.spec.intent}
          </Text>
          <Button
            disabled={disabled}
            onClick={() => {
              if (nextInput)
                void controller.revise(
                  nextPromptInput(nextInput.draft, nextInput.shot),
                  nextInput.draft,
                );
              setNextInput(undefined);
            }}
          >
            保留并开始下一次输入
          </Button>
        </Stack>
      </Modal>
      <Modal
        opened={!!confirmation && state.access === "ready"}
        onClose={() => setConfirmation(undefined)}
        title="确认追加到本次提示"
        centered
      >
        <Stack>
          <Text size="sm">
            目标：{confirmation?.label}。保留原文，并追加建议 r
            {confirmation?.artifact?.revision}；固定参考与来源一起保留。
          </Text>
          <Text size="xs" c="dimmed">
            现有输入
          </Text>
          <Text className={classes.prose}>
            {confirmation?.prompt || "（空）"}
          </Text>
          <Text size="xs" c="dimmed">
            将追加
          </Text>
          <Text className={classes.prose}>
            {confirmation?.artifact?.body.prompt}
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => setConfirmation(undefined)}
            >
              返回编辑
            </Button>
            <Button disabled={!active || state.busy} onClick={apply}>
              确认追加，保留原文
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

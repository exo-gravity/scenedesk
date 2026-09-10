import { useState } from "react";
import {
  Alert,
  Button,
  Fieldset,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { useCommand } from "./api";
import { ErrorNotice } from "./common";
import { DraftNotice, useContentDraft } from "./content-drafts";
import {
  editableTask,
  memberName,
  sceneName,
  taskKinds,
  taskStages,
  taskStatuses,
  TaskSummary,
  type Task,
  type TaskInput,
  type TaskProps,
} from "./task-model";
import classes from "./tasks.module.css";
const choices = (values: Record<string, string>) =>
  Object.entries(values).map(([value, label]) => ({ value, label }));
function localDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, -1);
}
export function TaskEditor(
  props: TaskProps & {
    task?: Task;
    initialSceneId?: string;
    done: (task: Task) => void;
  },
) {
  const { task } = props;
  const [initial] = useState<TaskInput>(() =>
    task
      ? editableTask(task)
      : {
          title: "",
          kind: "general",
          stage: "planning",
          status: "open",
          note: "",
          ...(props.initialSceneId ? { sceneId: props.initialSceneId } : {}),
        },
  );
  const draft = useContentDraft(
    `${props.path}/tasks/${task?.id ?? "new"}`,
    { input: initial, dueLocal: localDate(initial.dueAt) },
    task?.revision ?? 1,
  );
  const command = useCommand<Task>(),
    [validation, setValidation] = useState<Error>();
  const value = draft.value.input;
  const set = <K extends keyof TaskInput>(key: K, value: TaskInput[K]) =>
    draft.setValue((v) => {
      const input = { ...v.input };
      if (value === undefined) delete input[key];
      else input[key] = value;
      return { ...v, input };
    });
  const eligible = props.members.filter(
    (m) =>
      m.status === "active" &&
      (m.role === "owner" ||
        m.role === "admin" ||
        props.projectMembers.some((p) => p.membershipId === m.id)),
  );
  const memberOptions = eligible.map((m) => ({
    value: m.id,
    label: memberName(props.members, m.id),
    disabled: false,
  }));
  if (
    value.assigneeMembershipId &&
    !eligible.some((m) => m.id === value.assigneeMembershipId)
  )
    memberOptions.push({
      value: value.assigneeMembershipId,
      label: `${memberName(props.members, value.assigneeMembershipId)} · 已无项目资格`,
      disabled: true,
    });
  const canWork =
    props.project.status === "active" &&
    (props.canManage ||
      (!!task &&
        task.assigneeMembershipId === props.own.id &&
        !!task.assigneeAvailable));
  const stale = !!task && task.revision !== draft.baseVersion;
  const scenes = props.tree.scenes.filter(
    (s) =>
      (s.status === "active" &&
        props.tree.episodes.some(
          (e) => e.id === s.episodeId && e.status === "active",
        )) ||
      s.id === value.sceneId,
  );
  const shots = props.tree.shots.filter(
    (s) =>
      s.id === value.shotId ||
      (s.status === "active" &&
        (!value.sceneId || s.sceneId === value.sceneId)),
  );
  if (draft.committed) return <DraftNotice draft={draft} />;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!canWork || stale || !draft.ready || draft.recovered) return;
        setValidation(undefined);
        try {
          if (!value.title.trim()) throw new Error("请填写任务标题。");
          if (
            value.kind === "scene_owner" &&
            (!value.sceneId || !value.assigneeMembershipId || value.shotId)
          )
            throw new Error(
              "场次主责需要明确场次与有效负责人，不能同时绑定单个镜头。",
            );
          if (
            value.shotId &&
            value.sceneId &&
            props.tree.shots.find((s) => s.id === value.shotId)?.sceneId !==
              value.sceneId
          )
            throw new Error("所选镜头不属于当前场次，请调整或取消镜头绑定。");
          const input = { ...value };
          if (!draft.value.dueLocal) delete input.dueAt;
          else if (draft.value.dueLocal !== localDate(input.dueAt)) {
            const due = new Date(draft.value.dueLocal);
            if (!Number.isFinite(due.getTime()))
              throw new Error("请检查截止时间。");
            input.dueAt = due.toISOString();
          }
          command.mutate(
            {
              path: `${props.path}/tasks${task ? `/${task.id}` : ""}`,
              ...(task
                ? { method: "PATCH" as const, version: draft.baseVersion }
                : {}),
              body: input,
            },
            {
              onCommitted: (saved) =>
                void draft.complete(() => props.done(saved)),
            },
          );
        } catch (error) {
          setValidation(error as Error);
        }
      }}
    >
      <Stack gap="lg">
        <DraftNotice draft={draft} />
        {!canWork && (
          <Alert title="仅查看">
            任务分派由项目负责人或管理员管理；协作者只处理自己的有效任务。
          </Alert>
        )}
        {task?.assigneeMembershipId && !task.assigneeAvailable && (
          <Alert title="需要重新分配">
            原受派人 {memberName(props.members, task.assigneeMembershipId)}{" "}
            已无项目资格。历史和处理说明保留，由负责人在此改派。
          </Alert>
        )}
        <Fieldset legend="分派与范围" disabled={!props.canManage || !canWork}>
          <Stack gap="md">
            <TextInput
              required
              label="任务标题"
              maxLength={160}
              value={value.title}
              onChange={(e) => set("title", e.currentTarget.value)}
            />
            <div className={classes.fields}>
              <Select
                label="任务类型"
                required
                disabled={!!task}
                value={value.kind}
                data={choices(taskKinds).filter(
                  (k) => k.value !== "rework" || task?.kind === "rework",
                )}
                onChange={(v) => {
                  if (v) {
                    draft.setValue((state) => {
                      const input = {
                        ...state.input,
                        kind: v as TaskInput["kind"],
                      };
                      if (v === "scene_owner") delete input.shotId;
                      return { ...state, input };
                    });
                  }
                }}
              />
              <Select
                label="负责人"
                placeholder="尚未分配"
                required={value.kind === "scene_owner"}
                clearable={value.kind !== "scene_owner"}
                clearButtonProps={{
                  "aria-hidden": false,
                  tabIndex: 0,
                  "aria-label": "取消负责人分配",
                }}
                searchable
                value={value.assigneeMembershipId ?? null}
                data={memberOptions}
                onChange={(v) => set("assigneeMembershipId", v ?? undefined)}
              />
              <Select
                label="场次绑定"
                placeholder="不绑定场次"
                required={value.kind === "scene_owner"}
                disabled={task?.kind === "scene_owner"}
                clearable={value.kind !== "scene_owner"}
                clearButtonProps={{
                  "aria-hidden": false,
                  tabIndex: 0,
                  "aria-label": "取消场次绑定",
                }}
                searchable
                value={value.sceneId ?? null}
                data={scenes.map((s) => ({
                  value: s.id,
                  label: sceneName(props.tree, s.id),
                }))}
                onChange={(v) => set("sceneId", v ?? undefined)}
              />
              <Select
                label="镜头绑定"
                placeholder="不绑定单个镜头"
                disabled={value.kind === "scene_owner"}
                clearable
                clearButtonProps={{
                  "aria-hidden": false,
                  tabIndex: 0,
                  "aria-label": "取消镜头绑定",
                }}
                searchable
                value={value.shotId ?? null}
                data={shots.map((s) => ({
                  value: s.id,
                  label: `${s.label} · ${sceneName(props.tree, s.sceneId)}`,
                }))}
                onChange={(v) => set("shotId", v ?? undefined)}
              />
              <Select
                label="制作阶段"
                value={value.stage}
                data={choices(taskStages)}
                onChange={(v) => {
                  if (v) set("stage", v as TaskInput["stage"]);
                }}
              />
              <TextInput
                type="datetime-local"
                step="0.001"
                label="截止时间（本地时间）"
                value={draft.value.dueLocal}
                onChange={(e) => {
                  const dueLocal = e.currentTarget.value;
                  draft.setValue((v) => ({ ...v, dueLocal }));
                }}
              />
            </div>
            {value.kind === "scene_owner" && (
              <Text size="sm" c="dimmed">
                每场只有一项主责任务；完成后也保留，后续改派或重新打开继续使用这项任务。
              </Text>
            )}
          </Stack>
        </Fieldset>
        <Select
          label="处理状态"
          disabled={!canWork}
          value={value.status}
          data={choices(taskStatuses)}
          onChange={(v) => {
            if (v) set("status", v as TaskInput["status"]);
          }}
        />
        <Textarea
          label="任务说明与处理记录"
          description="每次保存保留原说明和处理历史。完成任务不会自动批准审稿。"
          disabled={!canWork}
          autosize
          minRows={4}
          maxRows={12}
          maxLength={20000}
          value={value.note ?? ""}
          onChange={(e) => set("note", e.currentTarget.value)}
        />
        <ErrorNotice error={validation ?? command.error} />
        {stale && (
          <Alert title="任务已由他人更新">
            <Text mb="md">
              你的输入已保留。先核对以下服务器版本，再决定是否以当前输入继续保存。
            </Text>
            <TaskSummary
              task={task}
              members={props.members}
              tree={props.tree}
            />
            <Button
              mt="md"
              onClick={() => {
                draft.rebase();
                command.reset();
              }}
            >
              已核对，保留输入继续
            </Button>
          </Alert>
        )}
        <Group>
          <Button
            type="submit"
            variant="filled"
            loading={command.isPending}
            disabled={
              !canWork ||
              stale ||
              !draft.ready ||
              !!draft.recovered ||
              (!!task && !draft.dirty)
            }
          >
            {task ? "保存任务修改" : "创建任务"}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

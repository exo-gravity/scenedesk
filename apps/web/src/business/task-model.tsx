import { Badge, Group, Stack, Text } from "@mantine/core";
import type { Schema } from "./api";
import classes from "./tasks.module.css";
export type Task = Schema<"Task">;
export type TaskInput = Schema<"TaskInput">;
export type TaskProps = {
  path: string;
  project: Schema<"Project">;
  tree: Schema<"ContentTree">;
  own: Schema<"Membership">;
  members: Schema<"Membership">[];
  projectMembers: Schema<"ProjectMember">[];
  canManage: boolean;
};
export const taskKinds = {
  scene_owner: "场次主责",
  assist: "协助",
  general: "一般任务",
  rework: "审片返工",
};
export const taskStatuses = {
  open: "待处理",
  in_progress: "进行中",
  blocked: "遇到阻碍",
  done: "已完成",
};
export const taskStages = {
  planning: "创作准备",
  assets: "素材与设定",
  generation: "镜头制作",
  editing: "剪辑",
  review: "审阅",
  delivery: "交付",
};
export function editableTask(task: Task): TaskInput {
  const {
    id: _id,
    revision: _revision,
    projectId: _project,
    createdAt: _created,
    updatedAt: _updated,
    assigneeAvailable: _available,
    ...body
  } = task;
  return body;
}
export function memberName(members: TaskProps["members"], id?: string) {
  return id
    ? (members.find((m) => m.id === id)?.email ?? "原成员")
    : "尚未分配";
}
export function sceneName(tree: TaskProps["tree"], id: string) {
  const scene = tree.scenes.find((s) => s.id === id),
    episode = tree.episodes.find((e) => e.id === scene?.episodeId);
  return scene
    ? `${episode ? `${episode.title} / ` : ""}${scene.title}`
    : "原场次";
}
export function TaskSummary({
  task,
  members,
  tree,
}: {
  task: TaskInput;
  members: TaskProps["members"];
  tree: TaskProps["tree"];
}) {
  return (
    <Stack gap="xs" className={classes.prose}>
      <Text fw={600}>{task.title}</Text>
      <Group gap="xs">
        <Badge>{taskKinds[task.kind]}</Badge>
        <Badge>{taskStatuses[task.status]}</Badge>
        <Text size="sm">
          {taskStages[task.stage]} ·{" "}
          {memberName(members, task.assigneeMembershipId)}
        </Text>
      </Group>
      <Text size="sm">
        {task.sceneId ? sceneName(tree, task.sceneId) : "无场次绑定"}
        {task.shotId
          ? ` · ${tree.shots.find((s) => s.id === task.shotId)?.label ?? "原镜头"}`
          : ""}
      </Text>
      {task.dueAt && (
        <Text size="sm">期限：{new Date(task.dueAt).toLocaleString()}</Text>
      )}
      {task.note && <Text>{task.note}</Text>}
    </Stack>
  );
}

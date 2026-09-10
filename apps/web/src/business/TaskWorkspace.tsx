import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Select,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { ArrowLeft, Plus } from "@phosphor-icons/react";
import { useList, useResource, type Schema } from "./api";
import { Empty, ErrorNotice, SectionHeading } from "./common";
import { TaskEditor } from "./TaskEditor";
import {
  memberName,
  sceneName,
  taskKinds,
  taskStatuses,
  TaskSummary,
  type Task,
  type TaskProps,
} from "./task-model";
import classes from "./tasks.module.css";
export function TaskWorkspace(
  props: Omit<TaskProps, "projectMembers"> & {
    initialSceneId?: string;
    onClose: () => void;
  },
) {
  const [view, setView] = useState<"list" | "new" | "detail">("list"),
    [id, setId] = useState<string>(),
    [kind, setKind] = useState<string | null>(null),
    [status, setStatus] = useState<string | null>(null),
    [sceneId, setSceneId] = useState<string | null>(
      props.initialSceneId ?? null,
    ),
    [mine, setMine] = useState(false);
  const query = new URLSearchParams();
  if (kind) query.set("kind", kind);
  if (status) query.set("status", status);
  if (sceneId) query.set("sceneId", sceneId);
  if (mine) query.set("assigneeMembershipId", props.own.id);
  const tasks = useList<Task>(`${props.path}/tasks?${query}`, view === "list");
  const projectMembers = useList<Schema<"ProjectMember">>(
    `${props.path}/members`,
  );
  function open(task: Task) {
    setId(task.id);
    setView("detail");
  }
  return (
    <Stack gap="xl">
      <Button
        variant="subtle"
        w="fit-content"
        leftSection={<ArrowLeft size={18} />}
        onClick={props.onClose}
      >
        返回集场镜
      </Button>
      <SectionHeading
        title={`${props.project.name} · 分工与任务`}
        description="明确整场主责，保留协助与处理记录。任务状态不代表生成进度或审稿批准。"
        action={
          view === "list" &&
          props.canManage && (
            <Button
              leftSection={<Plus size={18} />}
              disabled={props.project.status !== "active"}
              onClick={() => setView("new")}
            >
              新建任务
            </Button>
          )
        }
      />
      {view !== "list" && (
        <Button
          variant="subtle"
          w="fit-content"
          onClick={() => setView("list")}
        >
          全部任务
        </Button>
      )}
      {props.project.status !== "active" && (
        <Alert title="项目已归档">可查看任务与历史，恢复项目后再处理。</Alert>
      )}
      <ErrorNotice
        error={projectMembers.error}
        retry={() => void projectMembers.refetch()}
      />
      {view === "new" &&
        (projectMembers.isPending ? (
          <Loader aria-label="正在读取项目成员" />
        ) : (
          projectMembers.data && (
            <TaskEditor
              {...props}
              key="new"
              projectMembers={projectMembers.data}
              {...(sceneId ? { initialSceneId: sceneId } : {})}
              done={open}
            />
          )
        ))}
      {view === "detail" && id && projectMembers.data && (
        <TaskDetail
          {...props}
          key={id}
          id={id}
          projectMembers={projectMembers.data}
        />
      )}
      {view === "detail" && projectMembers.isPending && (
        <Loader aria-label="正在读取项目成员" />
      )}
      {view === "list" && (
        <>
          <Group align="end">
            <Select
              label="类型"
              clearable
              clearButtonProps={{
                "aria-hidden": false,
                tabIndex: 0,
                "aria-label": "清除类型筛选",
              }}
              placeholder="全部类型"
              value={kind}
              onChange={setKind}
              data={Object.entries(taskKinds).map(([value, label]) => ({
                value,
                label,
              }))}
            />
            <Select
              label="状态"
              clearable
              clearButtonProps={{
                "aria-hidden": false,
                tabIndex: 0,
                "aria-label": "清除状态筛选",
              }}
              placeholder="全部状态"
              value={status}
              onChange={setStatus}
              data={Object.entries(taskStatuses).map(([value, label]) => ({
                value,
                label,
              }))}
            />
            <Select
              label="场次"
              clearable
              clearButtonProps={{
                "aria-hidden": false,
                tabIndex: 0,
                "aria-label": "清除场次筛选",
              }}
              searchable
              placeholder="全部场次"
              value={sceneId}
              onChange={setSceneId}
              data={props.tree.scenes.map((s) => ({
                value: s.id,
                label: sceneName(props.tree, s.id),
              }))}
            />
            <Switch
              label="只看分配给我"
              checked={mine}
              onChange={(e) => setMine(e.currentTarget.checked)}
            />
          </Group>
          <ErrorNotice error={tasks.error} retry={() => void tasks.refetch()} />
          {tasks.isPending ? (
            <Loader aria-label="正在读取任务" />
          ) : tasks.data?.length ? (
            <div className={classes.list}>
              {tasks.data.map((task) => (
                <article className={classes.row} key={task.id}>
                  <TaskSummary
                    task={task}
                    members={props.members}
                    tree={props.tree}
                  />
                  {task.assigneeMembershipId && !task.assigneeAvailable && (
                    <Badge mt="sm">
                      {memberName(props.members, task.assigneeMembershipId)} ·
                      待重新分配
                    </Badge>
                  )}
                  <Group mt="md">
                    <Button onClick={() => open(task)}>打开任务</Button>
                    <Text size="xs" c="dimmed">
                      版本 {task.revision}
                    </Text>
                  </Group>
                </article>
              ))}
            </div>
          ) : (
            <Empty>
              没有符合条件的任务。制作内容可直接继续，任务用于明确主责和需要协助的工作。
            </Empty>
          )}
        </>
      )}
    </Stack>
  );
}
function TaskDetail(props: TaskProps & { id: string }) {
  const current = useResource<Task>(`${props.path}/tasks/${props.id}`);
  const history = useList<Schema<"TaskRevision">>(
    `${props.path}/tasks/${props.id}/revisions`,
  );
  const [epoch, setEpoch] = useState(0),
    [saved, setSaved] = useState<number>();
  if (current.isError)
    return (
      <ErrorNotice error={current.error} retry={() => void current.refetch()} />
    );
  if (!current.data) return <Loader aria-label="正在打开任务" />;
  return (
    <Stack gap="xl">
      {saved && (
        <Alert title={`任务版本 ${saved} 已保存`}>
          分派与处理历史已记录，相关审稿的批准状态保持独立。
        </Alert>
      )}
      <Text size="sm" c="dimmed">
        任务版本 {current.data.revision}
      </Text>
      <TaskEditor
        {...props}
        key={`${props.id}:${epoch}`}
        task={current.data}
        done={(saved) => {
          setEpoch((e) => e + 1);
          setSaved(saved.revision);
        }}
      />
      <SectionHeading level={2} title="分派与处理历史" />
      <ErrorNotice error={history.error} retry={() => void history.refetch()} />
      {history.isPending ? (
        <Loader aria-label="正在读取任务历史" />
      ) : (
        <ol className={classes.history}>
          {[...(history.data ?? [])].reverse().map((entry) => (
            <li key={entry.id}>
              <Text size="sm" c="dimmed">
                版本 {entry.number} ·{" "}
                {entry.createdAt
                  ? new Date(entry.createdAt).toLocaleString()
                  : ""}{" "}
                ·{" "}
                {props.members.find((m) => m.userId === entry.changedBy)
                  ?.email ?? "原成员"}
              </Text>
              <details>
                <summary>查看当时分派与处理内容</summary>
                <TaskSummary
                  task={entry.snapshot}
                  members={props.members}
                  tree={props.tree}
                />
              </details>
            </li>
          ))}
        </ol>
      )}
    </Stack>
  );
}

import { useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Group,
  Loader,
  SegmentedControl,
  Text,
} from "@mantine/core";
import { allPages, useList, useSession, type Schema } from "./api";
import {
  Empty,
  ErrorNotice,
  SectionHeading,
  projectPath,
  tenantPath,
} from "./common";
import { taskStatuses, taskStages } from "./task-model";
import classes from "./workbench.module.css";

/** Personal work only: no team administration or post-production navigation. */
export default function MyWork({
  tenantId,
  own,
}: {
  tenantId: string;
  own: Schema<"Membership">;
}) {
  const session = useSession();
  const projects = useList<Schema<"Project">>(
    `${tenantPath(tenantId)}/projects`,
  );
  const [filter, setFilter] = useState("active");
  const queries = useQueries({
    queries: (projects.data ?? []).map((project) => {
      const path = `${projectPath(tenantId, project.id)}/tasks?assigneeMembershipId=${own.id}`;
      return {
        queryKey: ["user", session.userId, path],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          allPages<Schema<"Task">>(path, signal),
      };
    }),
  });
  useEffect(() => {
    document.title = "我的工作 · scenedesk";
  }, []);
  const items = queries.flatMap((query, index) =>
    (query.data ?? [])
      .filter(
        (task) =>
          ["planning", "assets", "generation"].includes(task.stage) &&
          (filter === "all" || task.status !== "done"),
      )
      .map((task) => ({ task, project: projects.data![index]! })),
  );
  const pending =
    projects.isPending || queries.some((query) => query.isPending);
  const failed = projects.isError || queries.some((query) => query.isError);
  return (
    <>
      <SectionHeading
        title="我的工作"
        description="继续分配给你的场次与创作任务。"
        action={
          <SegmentedControl
            aria-label="我的工作筛选"
            value={filter}
            onChange={setFilter}
            data={[
              { value: "active", label: "待处理" },
              { value: "all", label: "全部" },
            ]}
          />
        }
      />
      <ErrorNotice
        error={projects.error}
        retry={() => void projects.refetch()}
      />
      {queries.map(
        (query, index) =>
          query.isError && (
            <ErrorNotice
              key={projects.data![index]!.id}
              error={query.error}
              retry={() => void query.refetch()}
            />
          ),
      )}
      {pending && <Loader aria-label="正在读取我的工作" />}
      <div className={classes.workList}>
        {items.map(({ task, project }) => {
          const query = new URLSearchParams();
          if (task.sceneId) query.set("scene", task.sceneId);
          if (task.shotId) query.set("shot", task.shotId);
          const destination =
            task.sceneId && task.stage === "generation"
              ? "production"
              : "content";
          return (
            <article key={task.id} className={classes.workRow}>
              <div className={classes.workSummary}>
                <Text size="xs" c="dimmed" mb="xs">
                  {project.name} · {taskStages[task.stage]}
                </Text>
                <Text fw={500}>{task.title}</Text>
                {task.note && (
                  <Text size="sm" c="dimmed" mt="xs">
                    {task.note}
                  </Text>
                )}
              </div>
              <Group gap="lg">
                {task.dueAt && (
                  <Text size="xs" c="dimmed">
                    {new Date(task.dueAt).toLocaleDateString()} 截止
                  </Text>
                )}
                <Badge>{taskStatuses[task.status]}</Badge>
                <Button
                  component="a"
                  href={`#/app/t/${tenantId}/p/${project.id}/${destination}${query.size ? `?${query}` : ""}`}
                >
                  继续创作
                </Button>
              </Group>
            </article>
          );
        })}
      </div>
      {!pending && !failed && !items.length && (
        <Empty>
          <Text>
            {filter === "active"
              ? "当前没有待处理的创作任务。"
              : "还没有分配给你的创作任务。"}
          </Text>
          <Button
            component="a"
            variant="subtle"
            mt="lg"
            href={`#/app/t/${tenantId}`}
          >
            浏览项目
          </Button>
        </Empty>
      )}
    </>
  );
}

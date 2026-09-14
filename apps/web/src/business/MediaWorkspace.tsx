import { useEffect, useState } from "react";
import { useDebouncedValue } from "@mantine/hooks";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Group,
  Loader,
  Popover,
  Select,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import {
  ArrowLeft,
  UploadSimple,
  MagnifyingGlass,
  SlidersHorizontal,
  ClockCounterClockwise,
} from "@phosphor-icons/react";
import { api, useResource, useSession, type Page, type Schema } from "./api";
import {
  Empty,
  ErrorNotice,
  SectionHeading,
  projectPath,
  tenantPath,
} from "./common";
import MediaDetail from "./MediaDetails";
import { MediaImports } from "./MediaImports";
import { MediaPreview, mediaKind, mediaStatus } from "./MediaPreview";
import classes from "./media.module.css";

type Media = Schema<"Media">;
type Props = {
  tenantId: string;
  projectId?: string | undefined;
  own: Schema<"Membership">;
};
const choices = (values: Record<string, string>) =>
  Object.entries(values).map(([value, label]) => ({ value, label }));
export default function MediaWorkspace(props: Props) {
  const project = useResource<Schema<"Project">>(
    props.projectId ? projectPath(props.tenantId, props.projectId) : "",
    !!props.projectId,
  );
  if (props.projectId && project.isError)
    return (
      <ErrorNotice error={project.error} retry={() => void project.refetch()} />
    );
  if (props.projectId && !project.data)
    return <Loader aria-label="正在读取项目权限" />;
  return (
    <MediaBrowser
      key={`${props.tenantId}/${props.projectId ?? "shared"}`}
      {...props}
      project={project.data}
    />
  );
}
function MediaBrowser(
  props: Props & { project?: Schema<"Project"> | undefined },
) {
  const session = useSession(),
    path = tenantPath(props.tenantId);
  const baseHref = `#/app/t/${props.tenantId}${props.projectId ? `/p/${props.projectId}` : ""}/media`;
  const mediaHref = (id: string) =>
    `${baseHref}?media=${encodeURIComponent(id)}`;
  const mediaId = new URLSearchParams(location.hash.split("?")[1]).get("media");
  const [q, setQ] = useState(""),
    [kind, setKind] = useState<string | null>(null),
    [status, setStatus] = useState<string | null>(null),
    [imports, setImports] = useState<"new" | "history" | null>(null);
  const [search] = useDebouncedValue(q, 250);
  const filters = new URLSearchParams({
    scope: props.projectId ? "project" : "shared",
    limit: "30",
    ...(props.projectId ? { projectId: props.projectId } : {}),
    ...(search ? { q: search } : {}),
    ...(kind ? { kind } : {}),
    ...(status ? { status } : {}),
  });
  const listPath = `${path}/media?${filters}`;
  const list = useInfiniteQuery({
    queryKey: ["user", session.userId, listPath],
    initialPageParam: "",
    queryFn: ({ signal, pageParam }) =>
      api<Page<Media>>(
        `${listPath}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`,
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: (query) =>
      query.state.error
        ? false
        : query.state.data?.pages.some((page) =>
              page.items.some(
                (item) =>
                  item.status === "processing" ||
                  item.derivatives.some((d) =>
                    ["queued", "processing"].includes(d.status),
                  ),
              ),
            )
          ? 3000
          : false,
  });
  const canWrite = props.projectId
    ? props.project?.status === "active"
    : ["owner", "admin"].includes(props.own.role);
  useEffect(() => {
    document.title = `${props.project?.name ?? "工作室共享"} · 素材 · scenedesk`;
  }, [props.project?.name]);
  return (
    <Stack gap="lg" className={classes.workspace}>
      {mediaId ? (
        <Group justify="space-between">
          <Button
            component="a"
            href={baseHref}
            variant="subtle"
            leftSection={<ArrowLeft size={18} />}
          >
            全部素材
          </Button>
          <Button variant="subtle" onClick={() => setImports("history")}>
            导入记录
          </Button>
        </Group>
      ) : (
        <SectionHeading
          title={props.project ? "素材文件" : "工作室共享素材"}
          description={
            props.project
              ? "收集这一项目的图片、视频、声音与文档。"
              : "当前工作室成员共同查阅的素材。"
          }
          action={
            <Group gap="xs">
              <Button
                component="a"
                variant="subtle"
                href={`#/app/t/${props.tenantId}${props.projectId ? "/p/" + props.projectId : ""}/assets`}
              >
                设定资产
              </Button>
              <Button
                variant="subtle"
                leftSection={<ClockCounterClockwise size={18} />}
                onClick={() => setImports("history")}
              >
                导入记录
              </Button>
              {canWrite && (
                <Button
                  variant="filled"
                  leftSection={<UploadSimple size={18} />}
                  onClick={() => setImports("new")}
                >
                  导入素材
                </Button>
              )}
            </Group>
          }
        />
      )}
      {props.project?.status === "archived" && (
        <Alert title="项目已归档">
          仍可查阅和下载已验收素材，恢复项目后可继续导入与编辑。
        </Alert>
      )}
      <MediaImports
        path={path}
        scopeKey={baseHref}
        projectId={props.projectId}
        canWrite={canWrite}
        mediaHref={mediaHref}
        panel={imports}
        onOpen={() => setImports("history")}
        onClose={() => setImports(null)}
      />
      {mediaId ? (
        <>
          <MediaDetail
            key={mediaId}
            path={path}
            id={mediaId}
            canWrite={canWrite}
            expectedProjectId={props.projectId}
          />
        </>
      ) : (
        <>
          <div className={classes.browseTools}>
            <Group
              gap="xs"
              className={classes.categoryTabs}
              role="group"
              aria-label="素材类型"
            >
              {[{ value: "", label: "全部" }, ...choices(mediaKind)].map(
                (choice) => (
                  <UnstyledButton
                    key={choice.value}
                    className={classes.categoryTab}
                    aria-pressed={(kind ?? "") === choice.value}
                    onClick={() => setKind(choice.value || null)}
                  >
                    {choice.label}
                  </UnstyledButton>
                ),
              )}
            </Group>
            <Group gap="xs" className={classes.searchTools}>
              <TextInput
                aria-label="查找素材"
                placeholder="搜索名称或标签"
                leftSection={<MagnifyingGlass size={16} />}
                className={classes.searchInput}
                value={q}
                onChange={(event) => setQ(event.currentTarget.value)}
              />
              <Popover position="bottom-end" width={240}>
                <Popover.Target>
                  <Button
                    variant="subtle"
                    leftSection={<SlidersHorizontal size={17} />}
                  >
                    {status
                      ? mediaStatus[status as keyof typeof mediaStatus]
                      : "筛选"}
                  </Button>
                </Popover.Target>
                <Popover.Dropdown>
                  <Select
                    label="素材状态"
                    placeholder="全部状态"
                    clearable
                    value={status}
                    onChange={setStatus}
                    data={choices(mediaStatus)}
                  />
                </Popover.Dropdown>
              </Popover>
            </Group>
          </div>
          <ErrorNotice error={list.error} retry={() => void list.refetch()} />
          {list.isPending ? (
            <Loader aria-label="正在读取素材" />
          ) : (
            !list.isError && (
              <>
                {list.data?.pages.some((page) => page.items.length) ? (
                  <div className={classes.grid}>
                    {list.data.pages
                      .flatMap((page) => page.items)
                      .map((media) => (
                        <a
                          key={media.id}
                          href={mediaHref(media.id)}
                          className={classes.item}
                          aria-label={`查看素材 ${media.displayName}`}
                        >
                          <MediaPreview media={media} path={path} thumbnail />
                          <Text fw={500} lineClamp={2}>
                            {media.displayName}
                          </Text>
                          <Text size="sm" c="dimmed">
                            {mediaKind[media.kind]} ·{" "}
                            {mediaStatus[media.status]}
                          </Text>
                        </a>
                      ))}
                  </div>
                ) : (
                  <Empty>
                    {q || kind || status
                      ? "没有符合当前筛选的素材。"
                      : "这里还没有素材。从本地文件开始导入，验收后即可查看与使用。"}
                  </Empty>
                )}
                {list.hasNextPage && (
                  <Button
                    onClick={() => void list.fetchNextPage()}
                    loading={list.isFetchingNextPage}
                  >
                    加载更多素材
                  </Button>
                )}
              </>
            )
          )}
        </>
      )}
    </Stack>
  );
}

import { useEffect, useState } from "react";
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
  Skeleton,
} from "@mantine/core";
import {
  ArrowLeft,
  UploadSimple,
  MagnifyingGlass,
  SlidersHorizontal,
  ClockCounterClockwise,
} from "@phosphor-icons/react";
import { api, useResource, useSession, type Page, type Schema } from "./api";
import { Empty, ErrorNotice, projectPath, tenantPath } from "./common";
import MediaDetail from "./MediaDetails";
import { MediaImports } from "./MediaImports";
import { MediaPreview, mediaKind, mediaStatus } from "./MediaPreview";
import classes from "./media.module.css";
import { LibraryNavigation, type LibraryLocation } from "./LibraryNavigation";

type Media = Schema<"Media">;
type Props = {
  tenantId: string;
  projectId?: string | undefined;
  own: Schema<"Membership">;
  library: LibraryLocation;
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
  const { library } = props;
  const scopeKey = `#/app/t/${props.tenantId}${props.projectId ? `/p/${props.projectId}` : ""}/media`;
  const baseHref = library.href();
  const mediaHref = (id: string) => library.href({ media: id });
  const mediaId = new URLSearchParams(location.hash.split("?")[1]).get("media");
  const [status, setStatus] = useState<string | null>(null),
    [imports, setImports] = useState<"new" | "history" | null>(null);
  const kind = library.category;
  const search = library.search;
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
    enabled: !mediaId,
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
    document.title = `${props.project?.name ?? "工作室共享"} · 资产库 · SceneDesk`;
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
            返回资产库
          </Button>
          <Button variant="subtle" onClick={() => setImports("history")}>
            导入记录
          </Button>
        </Group>
      ) : (
        <LibraryNavigation
          library={library}
          projectName={props.project?.name}
          action={
            <Group gap="xs">
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
                  上传文件
                </Button>
              )}
            </Group>
          }
          filter={
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
                  label="文件状态"
                  placeholder="全部状态"
                  clearable
                  value={status}
                  onChange={setStatus}
                  data={choices(mediaStatus)}
                />
              </Popover.Dropdown>
            </Popover>
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
        scopeKey={scopeKey}
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
          <ErrorNotice error={list.error} retry={() => void list.refetch()} />
          {list.isPending ? (
            <div className={classes.grid}>
              <Skeleton height={230} aria-label="正在读取文件" />
              <Skeleton height={230} />
              <Skeleton height={230} />
            </div>
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
                    <Stack align="center" gap="sm">
                      <Text>
                        {library.q || status
                          ? "没有符合筛选的文件"
                          : `还没有${kind === "document" ? "文本文件" : mediaKind[kind as keyof typeof mediaKind]}`}
                      </Text>
                      <Text size="sm" c="dimmed">
                        {library.q
                          ? "试试其他名称或标签。"
                          : "上传文件后，可直接用于画布或关联到创作设定。"}
                      </Text>
                      {canWrite && !library.q && !status && (
                        <Button
                          variant="subtle"
                          onClick={() => setImports("new")}
                        >
                          选择文件
                        </Button>
                      )}
                    </Stack>
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

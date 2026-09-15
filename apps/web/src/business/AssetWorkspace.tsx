import { useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Fieldset,
  Group,
  Loader,
  Modal,
  Select,
  Popover,
  Skeleton,
  Stack,
  TagsInput,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { Plus, SlidersHorizontal } from "@phosphor-icons/react";
import { api, useCommand, useResource, useSession, type Schema } from "./api";
import { DraftNotice, useContentDraft } from "./content-drafts";
import { Empty, ErrorNotice, projectPath, tenantPath } from "./common";
import { assetKinds, options, useAssetPages } from "./asset-queries";
import { AssetDetails } from "./AssetDetails";
import { AssetGalleryItem } from "./AssetThumbnail";
import { LibraryNavigation, type LibraryLocation } from "./LibraryNavigation";
import classes from "./assets.module.css";
type Props = {
  tenantId: string;
  own: Schema<"Membership">;
  projectId?: string | undefined;
  library: LibraryLocation;
};
export default function AssetWorkspace(props: Props) {
  const project = useResource<Schema<"Project">>(
    props.projectId ? projectPath(props.tenantId, props.projectId) : "",
    !!props.projectId,
  );
  if (props.projectId && project.isError)
    return (
      <ErrorNotice error={project.error} retry={() => void project.refetch()} />
    );
  if (props.projectId && !project.data)
    return <Loader aria-label="正在核对项目权限" />;
  return (
    <AssetBrowser
      key={`${props.tenantId}/${props.projectId ?? "shared"}`}
      {...props}
      project={project.data}
    />
  );
}
function AssetBrowser(
  props: Props & { project?: Schema<"Project"> | undefined },
) {
  const { library } = props;
  const session = useSession();
  const path = tenantPath(props.tenantId),
    params = new URLSearchParams(location.hash.split("?")[1]),
    id = params.get("asset"),
    revision = params.get("revision") ?? undefined;
  const fromProject = params.get("from") === "project";
  const href = (asset: string, revision?: string) =>
    library.href({ asset, ...(revision ? { revision } : {}) }) +
    (fromProject ? "&from=project" : "");
  const back = library.href(fromProject ? { scope: "project" } : {});
  const [status, setStatus] = useState<string | null>("active"),
    [creating, setCreating] = useState(false);
  const kind = library.category in assetKinds ? library.category : "character";
  const query = new URLSearchParams({
    scope: props.projectId ? "project" : "shared",
    q: library.search,
    kind,
    ...(props.projectId ? { projectId: props.projectId } : {}),
    ...(status ? { status } : {}),
  });
  const assets = useAssetPages<Schema<"Asset">>(`${path}/assets?${query}`, !id);
  const imports = useAssetPages<Schema<"SharedImport">>(
    `${path}/projects/${props.projectId ?? ""}/shared-imports`,
    !!props.projectId && !id,
  );
  // Resolve exact imported revisions. The current shared revision must never replace a project's pinned cover or definition.
  const imported = useQueries({
    queries: (props.projectId && !id && !imports.isError
      ? (imports.data?.pages.flatMap((page) => page.items) ?? [])
      : []
    ).map((item) => ({
      queryKey: [
        "user",
        session.userId,
        path,
        "library-import",
        props.projectId,
        item.assetRevisionId,
      ],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const fixed = await api<Schema<"AssetRevision">>(
          `${path}/asset-revisions/${item.assetRevisionId}`,
          { signal },
        );
        const asset = await api<Schema<"Asset">>(
          `${path}/assets/${fixed.assetId}`,
          { signal },
        );
        if (
          fixed.id !== item.assetRevisionId ||
          asset.id !== fixed.assetId ||
          asset.scope !== "shared"
        )
          throw new Error("共享引入版本不匹配，请重新读取。");
        return { item, fixed, asset };
      },
    })),
  });
  const importedItems = imported
    .flatMap((result) => (!result.isError && result.data ? [result.data] : []))
    .filter(
      ({ asset }) =>
        asset.kind === kind &&
        (!status || asset.status === status) &&
        (!library.search ||
          `${asset.name} ${asset.description} ${(asset.tags ?? []).join(" ")}`
            .toLocaleLowerCase()
            .includes(library.search.toLocaleLowerCase())),
    );
  const ownItems = !assets.isError
    ? (assets.data?.pages.flatMap((page) => page.items) ?? [])
    : [];
  const manager = ["owner", "admin"].includes(props.own.role),
    canWrite = props.projectId ? props.project?.status === "active" : manager,
    canConfirm = manager || props.project?.leadMembershipId === props.own.id;
  const loading =
    assets.isPending ||
    (!!props.projectId && imports.isPending) ||
    imported.some((item) => item.isPending);
  const failed =
    assets.isError ||
    (!!props.projectId && imports.isError) ||
    imported.some((item) => item.isError);
  useEffect(() => {
    document.title = `${props.project?.name ?? "工作室共享"} · 资产库 · SceneDesk`;
  }, [props.project?.name]);
  return (
    <Stack
      gap="lg"
      className={classes.workspace}
      data-detail={id ? true : undefined}
    >
      {props.project?.status === "archived" && (
        <Alert title="项目已归档">
          仍可查看资产和固定版本，恢复项目后可继续编辑或引入。
        </Alert>
      )}
      {id ? (
        <AssetDetails
          key={id}
          path={path}
          tenantId={props.tenantId}
          id={id}
          revisionId={revision}
          expectedProjectId={props.projectId}
          canWrite={canWrite}
          canConfirm={canConfirm}
          href={href}
          back={back}
          targetProjectId={
            !props.projectId ? library.contextProjectId : undefined
          }
        />
      ) : (
        <>
          <LibraryNavigation
            library={library}
            projectName={props.project?.name}
            action={
              canWrite && (
                <Button
                  variant="filled"
                  leftSection={<Plus size={17} />}
                  onClick={() => setCreating(true)}
                >
                  新建{assetKinds[kind as keyof typeof assetKinds]}
                </Button>
              )
            }
            filter={
              <Popover position="bottom-end" width={240}>
                <Popover.Target>
                  <Button
                    variant="subtle"
                    leftSection={<SlidersHorizontal size={16} />}
                  >
                    筛选
                    {status === "archived"
                      ? " · 已归档"
                      : status === null
                        ? " · 全部状态"
                        : ""}
                  </Button>
                </Popover.Target>
                <Popover.Dropdown>
                  <Select
                    label="资产状态"
                    data={[
                      { value: "active", label: "使用中" },
                      { value: "archived", label: "已归档" },
                      { value: "all", label: "全部状态" },
                    ]}
                    value={status ?? "all"}
                    onChange={(value) =>
                      setStatus(value === "all" ? null : value)
                    }
                  />
                </Popover.Dropdown>
              </Popover>
            }
          />
          <ErrorNotice
            error={assets.error}
            retry={() => void assets.refetch()}
          />
          {props.projectId && (
            <ErrorNotice
              error={imports.error}
              retry={() => void imports.refetch()}
            />
          )}
          {imported
            .filter((item) => item.isError)
            .map((result, index) => (
              <ErrorNotice
                key={index}
                error={result.error}
                retry={() => void result.refetch()}
              />
            ))}
          <div className={classes.assetGallery}>
            {ownItems.map((asset) => (
              <AssetGalleryItem
                key={asset.id}
                asset={asset}
                path={path}
                href={href(asset.id)}
              />
            ))}
            {importedItems.map(({ item, asset, fixed }) => (
              <AssetGalleryItem
                key={item.id}
                asset={asset}
                fixedRevision={fixed}
                sourceLabel="来自共享"
                path={path}
                href={
                  library.href({
                    scope: "shared",
                    asset: asset.id,
                    revision: fixed.id,
                  }) + "&from=project"
                }
              />
            ))}
            {loading && <Skeleton height={280} aria-label="正在读取资产" />}
          </div>
          {!loading && !failed && !ownItems.length && !importedItems.length && (
            <Empty>
              <Stack align="center" gap="sm">
                <Text>
                  {imports.hasNextPage
                    ? "已加载内容中没有匹配项，可继续查找"
                    : library.q || status !== "active"
                      ? "没有符合筛选的内容"
                      : `还没有${assetKinds[kind as keyof typeof assetKinds]}`}
                </Text>
                <Text size="sm" c="dimmed">
                  {library.q
                    ? "试试其他名称或标签。"
                    : "可以先写下设定，再逐步补充参考。"}
                </Text>
                {props.projectId && (
                  <Button
                    component="a"
                    variant="subtle"
                    href={library.href({ scope: "shared" })}
                  >
                    浏览工作室共享
                  </Button>
                )}
              </Stack>
            </Empty>
          )}
          <Group>
            {assets.hasNextPage && (
              <Button
                loading={assets.isFetchingNextPage}
                onClick={() => void assets.fetchNextPage()}
              >
                加载更多资产
              </Button>
            )}
            {imports.hasNextPage && props.projectId && (
              <Button
                loading={imports.isFetchingNextPage}
                onClick={() => void imports.fetchNextPage()}
              >
                继续查找已引入资产
              </Button>
            )}
          </Group>
        </>
      )}
      <Modal
        opened={creating}
        onClose={() => setCreating(false)}
        title={`新建${assetKinds[kind as keyof typeof assetKinds]}`}
        size="lg"
      >
        {creating && (
          <CreateAsset
            path={path}
            projectId={props.projectId}
            initialKind={kind as Schema<"Asset">["kind"]}
            done={(asset) => {
              setCreating(false);
              location.hash = library.href({
                type: asset.kind,
                asset: asset.id,
              });
            }}
          />
        )}
      </Modal>
    </Stack>
  );
}
function CreateAsset({
  path,
  projectId,
  initialKind,
  done,
}: {
  path: string;
  projectId?: string | undefined;
  initialKind: Schema<"Asset">["kind"];
  done: (asset: Schema<"Asset">) => void;
}) {
  const draft = useContentDraft(
      `${path}/${projectId ?? "shared"}/asset-create`,
      {
        name: "",
        description: "",
        tags: [] as string[],
        kind: initialKind,
      },
      1,
    ),
    command = useCommand<Schema<"Asset">>();
  if (draft.committed) return <DraftNotice draft={draft} />;
  const value = draft.value;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (
          command.isPending ||
          !draft.ready ||
          draft.recovered ||
          !value.name.trim()
        )
          return;
        command.mutate(
          {
            path: `${path}/assets`,
            body: {
              ...value,
              scope: projectId ? "project" : "shared",
              ...(projectId ? { projectId } : {}),
            },
          },
          {
            onCommitted: (asset) => void draft.complete(() => done(asset)),
          },
        );
      }}
    >
      <Fieldset variant="unstyled" disabled={command.isPending}>
        <Stack gap="md">
          <DraftNotice draft={draft} />
          <ErrorNotice error={command.error} />
          {!projectId && (
            <Text size="sm">工作室成员都能读取这项共享资产。</Text>
          )}
          <Select
            label="资产类别"
            data={options(assetKinds)}
            value={value.kind}
            onChange={(kind) =>
              kind &&
              draft.setValue((v) => ({
                ...v,
                kind: kind as Schema<"Asset">["kind"],
              }))
            }
          />
          <TextInput
            label="资产名称"
            required
            maxLength={160}
            value={value.name}
            onChange={(e) => {
              const name = e.currentTarget.value;
              draft.setValue((v) => ({ ...v, name }));
            }}
          />
          <Textarea
            label="检索说明"
            autosize
            minRows={2}
            maxLength={20000}
            value={value.description}
            onChange={(e) => {
              const description = e.currentTarget.value;
              draft.setValue((v) => ({ ...v, description }));
            }}
          />
          <TagsInput
            label="标签"
            maxTags={50}
            value={value.tags}
            onChange={(tags) => draft.setValue((v) => ({ ...v, tags }))}
          />
          <Button
            variant="filled"
            type="submit"
            loading={command.isPending}
            disabled={!draft.ready || !!draft.recovered || !value.name.trim()}
          >
            创建并准备固定版本
          </Button>
        </Stack>
      </Fieldset>
    </form>
  );
}

import { useEffect, useState } from "react";
import { useDebouncedValue } from "@mantine/hooks";
import {
  Alert,
  Badge,
  Button,
  Fieldset,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  TagsInput,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { Plus } from "@phosphor-icons/react";
import { useCommand, useResource, type Schema } from "./api";
import { DraftNotice, useContentDraft } from "./content-drafts";
import {
  Empty,
  ErrorNotice,
  projectPath,
  SectionHeading,
  tenantPath,
} from "./common";
import { assetKinds, options, useAssetPages } from "./asset-queries";
import { AssetDetails } from "./AssetDetails";
import classes from "./assets.module.css";
type Props = {
  tenantId: string;
  own: Schema<"Membership">;
  projectId?: string | undefined;
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
  const path = tenantPath(props.tenantId),
    params = new URLSearchParams(location.hash.split("?")[1]),
    id = params.get("asset"),
    revision = params.get("revision") ?? undefined,
    targetProjectId = params.get("targetProject") ?? undefined;
  const base = `#/app/t/${props.tenantId}${props.projectId ? "/p/" + props.projectId : ""}/assets`;
  const href = (id: string, revision?: string) =>
    `${base}?${new URLSearchParams({ asset: id, ...(revision ? { revision } : {}), ...(targetProjectId ? { targetProject: targetProjectId } : {}) })}`;
  const back = targetProjectId
    ? `${base}?targetProject=${encodeURIComponent(targetProjectId)}`
    : base;
  const [q, setQ] = useState(""),
    [search] = useDebouncedValue(q, 250),
    [kind, setKind] = useState<string | null>(null),
    [status, setStatus] = useState<string | null>("active"),
    [creating, setCreating] = useState(false);
  const query = new URLSearchParams({
    scope: props.projectId ? "project" : "shared",
    q: search,
    ...(props.projectId ? { projectId: props.projectId } : {}),
    ...(kind ? { kind } : {}),
    ...(status ? { status } : {}),
  });
  const assets = useAssetPages<Schema<"Asset">>(`${path}/assets?${query}`),
    imports = useAssetPages<Schema<"SharedImport">>(
      `${path}/projects/${props.projectId ?? ""}/shared-imports`,
      !!props.projectId && !id,
    );
  const manager = ["owner", "admin"].includes(props.own.role),
    canWrite = props.projectId ? props.project?.status === "active" : manager,
    canConfirm = manager || props.project?.leadMembershipId === props.own.id;
  useEffect(() => {
    document.title = `${props.project?.name ?? "工作室共享"} · 资产 · 幕序`;
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
          targetProjectId={targetProjectId}
        />
      ) : (
        <>
          <SectionHeading
            title={props.projectId ? "项目资产" : "工作室共享资产"}
            description="角色、空间、道具、声音与风格的固定设定。"
            action={
              <Group gap="xs">
                <Button
                  component="a"
                  variant="subtle"
                  href={`#/app/t/${props.tenantId}${props.projectId ? "/p/" + props.projectId : ""}/media`}
                >
                  素材文件
                </Button>
                {canWrite && (
                  <Button
                    leftSection={<Plus size={16} />}
                    onClick={() => setCreating(true)}
                  >
                    新建资产
                  </Button>
                )}
              </Group>
            }
          />
          {targetProjectId && (
            <Alert title="正在选择要引入项目的共享固定版">
              打开资产并选择确切版本，再确认引入目标。
            </Alert>
          )}
          <div className={classes.filters}>
            <TextInput
              label="查找资产"
              placeholder="名称、说明或标签"
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
            />
            <Select
              label="资产类别"
              placeholder="全部类别"
              clearable
              data={options(assetKinds)}
              value={kind}
              onChange={setKind}
            />
            <Select
              label="资产状态"
              clearable
              data={[
                { value: "active", label: "使用中" },
                { value: "archived", label: "已归档" },
              ]}
              value={status}
              onChange={setStatus}
            />
          </div>
          <ErrorNotice
            error={assets.error}
            retry={() => void assets.refetch()}
          />
          {assets.isPending ? (
            <Loader aria-label="正在读取资产" />
          ) : (
            !assets.isError && (
              <>
                {assets.data?.pages
                  .flatMap((page) => page.items)
                  .map((asset) => (
                    <div className={classes.assetRow} key={asset.id}>
                      <a className={classes.assetLink} href={href(asset.id)}>
                        <Text fw={600}>{asset.name}</Text>
                        <Text size="sm" c="dimmed" lineClamp={2}>
                          {asset.description || assetKinds[asset.kind]}
                        </Text>
                      </a>
                      <Group gap="xs">
                        <Badge>{assetKinds[asset.kind]}</Badge>
                        <Text size="xs" c="dimmed">
                          {asset.status === "archived"
                            ? "已归档"
                            : asset.currentRevisionId
                              ? "已有固定版本"
                              : "待建立首版"}
                        </Text>
                      </Group>
                    </div>
                  ))}
                {!assets.data?.pages.some((page) => page.items.length) && (
                  <Empty>
                    {q || kind || status === "archived"
                      ? "没有符合筛选的资产。"
                      : "还没有资产。可先准备一项角色、场景或道具设定。"}
                  </Empty>
                )}
                {assets.hasNextPage && (
                  <Button
                    loading={assets.isFetchingNextPage}
                    onClick={() => void assets.fetchNextPage()}
                  >
                    加载更多资产
                  </Button>
                )}
              </>
            )
          )}
          {props.projectId && (
            <Stack gap="md">
              <Group justify="space-between">
                <Text fw={600}>已引入的共享固定版</Text>
                {canWrite && (
                  <Button
                    component="a"
                    href={`#/app/t/${props.tenantId}/assets?targetProject=${props.projectId}`}
                  >
                    从共享资产选择
                  </Button>
                )}
              </Group>
              <ErrorNotice
                error={imports.error}
                retry={() => void imports.refetch()}
              />
              {imports.isPending ? (
                <Loader size="sm" aria-label="正在读取已引入版本" />
              ) : (
                !imports.isError && (
                  <>
                    {imports.data?.pages
                      .flatMap((page) => page.items)
                      .map((item) => (
                        <ImportedAsset
                          key={item.id}
                          path={path}
                          tenantId={props.tenantId}
                          item={item}
                        />
                      ))}
                    {!imports.data?.pages.some((page) => page.items.length) && (
                      <Text size="sm" c="dimmed">
                        尚未引入共享资产。每次引入会保留确切版本，升级需另行选择。
                      </Text>
                    )}
                    {imports.hasNextPage && (
                      <Button
                        loading={imports.isFetchingNextPage}
                        onClick={() => void imports.fetchNextPage()}
                      >
                        加载更多引入记录
                      </Button>
                    )}
                  </>
                )
              )}
            </Stack>
          )}
        </>
      )}
      <Modal
        opened={creating}
        onClose={() => setCreating(false)}
        title={props.projectId ? "新建项目资产" : "新建工作室共享资产"}
        size="lg"
      >
        {creating && (
          <CreateAsset
            path={path}
            projectId={props.projectId}
            done={(asset) => {
              setCreating(false);
              location.hash = href(asset.id);
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
  done,
}: {
  path: string;
  projectId?: string | undefined;
  done: (asset: Schema<"Asset">) => void;
}) {
  const draft = useContentDraft(
      `${path}/${projectId ?? "shared"}/asset-create`,
      {
        name: "",
        description: "",
        tags: [] as string[],
        kind: "character" as Schema<"Asset">["kind"],
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
function ImportedAsset({
  path,
  tenantId,
  item,
}: {
  path: string;
  tenantId: string;
  item: Schema<"SharedImport">;
}) {
  const revision = useResource<Schema<"AssetRevision">>(
      `${path}/asset-revisions/${item.assetRevisionId}`,
    ),
    asset = useResource<Schema<"Asset">>(
      `${path}/assets/${revision.data?.assetId ?? ""}`,
      !!revision.data && !revision.isError,
    );
  if (revision.isError || asset.isError)
    return <ErrorNotice error={revision.error ?? asset.error} />;
  if (!revision.data || !asset.data)
    return <Text size="sm">正在读取固定版本…</Text>;
  return (
    <Group justify="space-between">
      <Text>
        {asset.data.name} · v{revision.data.number} ·{" "}
        {revision.data.status === "confirmed" ? "已确认" : "草稿"}
      </Text>
      <Button
        component="a"
        variant="subtle"
        href={`#/app/t/${tenantId}/assets?asset=${asset.data.id}&revision=${revision.data.id}&targetProject=${item.projectId}`}
      >
        查看此固定版
      </Button>
    </Group>
  );
}

import { useState } from "react";
import {
  ArrowLeft,
  DotsThree,
  PencilSimple,
  Archive,
} from "@phosphor-icons/react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Menu,
  Stack,
  Text,
} from "@mantine/core";
import { useCommand, useResource, type Schema } from "./api";
import { Empty, ErrorNotice, projectPath } from "./common";
import { assetKinds, useAssetPages } from "./asset-queries";
import {
  AssetRevisionView,
  AssetRevisionDefinition,
} from "./AssetRevisionView";
import { AssetDefinitionEditor } from "./AssetDefinitionEditor";
import { AssetMetadataEditor } from "./AssetMetadataEditor";
import { PendingCharacterImage } from "./CharacterMediaAssociation";
import classes from "./asset-details.module.css";
export function AssetDetails({
  path,
  tenantId,
  id,
  revisionId,
  expectedProjectId,
  canWrite,
  canConfirm,
  href,
  back,
  targetProjectId,
}: {
  path: string;
  tenantId: string;
  id: string;
  revisionId?: string | undefined;
  expectedProjectId?: string | undefined;
  canWrite: boolean;
  canConfirm: boolean;
  href: (id: string, revision?: string) => string;
  back: string;
  targetProjectId?: string | undefined;
}) {
  const asset = useResource<Schema<"Asset">>(`${path}/assets/${id}`);
  const selectedId = revisionId ?? asset.data?.currentRevisionId;
  const selected = useResource<Schema<"AssetRevision">>(
    `${path}/asset-revisions/${selectedId ?? ""}`,
    !!selectedId && !asset.isError,
  );
  const current = useResource<Schema<"AssetRevision">>(
    `${path}/asset-revisions/${asset.data?.currentRevisionId ?? ""}`,
    !!asset.data?.currentRevisionId && !asset.isError,
  );
  const [editing, setEditing] = useState<
      | { kind: "definition"; current?: Schema<"AssetRevision"> | undefined }
      | { kind: "metadata" }
    >(),
    [confirm, setConfirm] = useState<Schema<"AssetRevision">>(),
    [archive, setArchive] = useState<Schema<"Asset">>(),
    [historyOpen, setHistoryOpen] = useState(false),
    [usageOpen, setUsageOpen] = useState(false);
  const history = useAssetPages<Schema<"AssetRevision">>(
      `${path}/assets/${id}/revisions`,
      historyOpen,
    ),
    usages = useAssetPages<Schema<"UsageLocation">>(
      `${path}/assets/${id}/usages`,
      usageOpen,
    ),
    command = useCommand<Schema<"AssetRevision"> | Schema<"Asset">>();
  if (asset.isError)
    return (
      <Stack>
        <Button
          component="a"
          variant="subtle"
          href={back}
          leftSection={<ArrowLeft size={16} />}
        >
          返回资产库
        </Button>
        <ErrorNotice error={asset.error} retry={() => void asset.refetch()} />
      </Stack>
    );
  if (!asset.data) return <Loader aria-label="正在读取资产" />;
  const value = asset.data;
  if (value.projectId !== expectedProjectId)
    return (
      <Stack>
        <Button component="a" variant="subtle" href={back}>
          返回资产库
        </Button>
        <Empty>该资产不属于当前范围，请从所属项目或工作室共享区进入。</Empty>
      </Stack>
    );
  const active = canWrite && value.status === "active";
  const pendingMediaId =
    new URLSearchParams(location.hash.split("?")[1]).get("referenceMedia") ??
    undefined;
  const dismissPendingImage = () => {
    const [base, query] = location.hash.split("?");
    const params = new URLSearchParams(query);
    params.delete("referenceMedia");
    location.hash = `${base}${params.size ? `?${params}` : ""}`;
  };
  const openDefinition = () => {
    if (selectedId !== value.currentRevisionId) {
      const [base, query] = href(id).split("?");
      const params = new URLSearchParams(query);
      if (pendingMediaId) params.set("referenceMedia", pendingMediaId);
      location.hash = `${base}?${params}`;
    }
    setEditing({ kind: "definition", current: current.data });
  };
  const viewed =
    !selected.isError &&
    selected.data?.assetId === id &&
    selected.data.id === selectedId
      ? selected.data
      : undefined;
  const showEditor =
    (editing?.kind === "definition" && active) ||
    (editing?.kind === "metadata" && canWrite);
  return (
    <>
      <section className={classes.detail} aria-label="资产详情">
        <Group className={classes.navigation}>
          <Button
            component="a"
            variant="subtle"
            href={back}
            leftSection={<ArrowLeft size={16} />}
          >
            返回资产库
          </Button>
        </Group>
        <Group
          justify="space-between"
          align="center"
          className={classes.assetHeading}
        >
          <div>
            <Text size="xs" c="dimmed">
              {assetKinds[value.kind]} ·{" "}
              {value.scope === "shared" ? "工作室共享" : "项目资产"} ·{" "}
              {value.status === "archived" ? "已归档" : "使用中"}
            </Text>
            <Text component="h1" className={classes.assetTitle}>
              {value.name}
            </Text>
            {viewed && (
              <Group gap="xs" mt="xs">
                <Badge variant="light">
                  v{viewed.number} ·{" "}
                  {viewed.status === "confirmed" ? "已确认设定" : "草稿设定"}
                </Badge>
                <Text size="xs" c="dimmed">
                  {viewed.id === value.currentRevisionId
                    ? "当前版本"
                    : `历史版本${!current.isError && current.data ? ` · 当前为 v${current.data.number}` : ""}`}
                </Text>
              </Group>
            )}
          </div>
          {canWrite && (
            <Group gap="xs">
              {active && !showEditor && (
                <Button
                  variant="filled"
                  leftSection={<PencilSimple size={16} />}
                  disabled={
                    !!value.currentRevisionId &&
                    (!current.data || current.isError)
                  }
                  onClick={openDefinition}
                >
                  {value.currentRevisionId ? "新建修订" : "建立首版设定"}
                </Button>
              )}
              <Menu position="bottom-end">
                <Menu.Target>
                  <Button variant="subtle" aria-label="资产更多操作" px="xs">
                    <DotsThree size={22} />
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    leftSection={<PencilSimple size={16} />}
                    onClick={() =>
                      setEditing(
                        editing?.kind === "metadata"
                          ? undefined
                          : { kind: "metadata" },
                      )
                    }
                  >
                    修改检索信息
                  </Menu.Item>
                  {active && (
                    <Menu.Item
                      leftSection={<Archive size={16} />}
                      onClick={() => setArchive(value)}
                    >
                      归档资产
                    </Menu.Item>
                  )}
                </Menu.Dropdown>
              </Menu>
            </Group>
          )}
        </Group>
        <ErrorNotice error={asset.error ?? command.error} />
        {value.status === "archived" && (
          <Alert title="资产已归档">
            固定版本与已有引用仍保留。不能新增版本或将其用于新引用。
          </Alert>
        )}
        {pendingMediaId && !showEditor && (
          <PendingCharacterImage
            path={path}
            mediaId={pendingMediaId}
            asset={value}
            disabled={
              !active ||
              (!!value.currentRevisionId && (!current.data || current.isError))
            }
            actionLabel="编辑角色并核对图片"
            onAdd={openDefinition}
            onDismiss={dismissPendingImage}
          />
        )}
        <div
          className={classes.content}
          data-editing={showEditor || undefined}
          data-text-only={
            (!showEditor &&
              viewed &&
              !viewed.definition.references.length &&
              !viewed.definition.looks?.some(
                (look) => look.references.length,
              )) ||
            undefined
          }
        >
          <Stack gap="lg" className={classes.main}>
            {editing?.kind === "definition" && active && (
              <AssetDefinitionEditor
                key={id}
                asset={value}
                current={current.data ?? editing.current}
                currentReady={
                  !value.currentRevisionId ||
                  (!current.isError &&
                    current.data?.id === value.currentRevisionId)
                }
                pendingMediaId={pendingMediaId}
                dismissPendingImage={dismissPendingImage}
                path={path}
                done={(revision) => {
                  setEditing(undefined);
                  if (revision) location.hash = href(id, revision.id);
                }}
              />
            )}
            {editing?.kind === "metadata" && canWrite && (
              <AssetMetadataEditor
                key={id}
                asset={value}
                path={path}
                done={() => setEditing(undefined)}
              />
            )}
            {!showEditor && (
              <>
                <ErrorNotice
                  error={selected.error}
                  retry={() => void selected.refetch()}
                />
                {selectedId ? (
                  selected.isPending ? (
                    <Loader aria-label="正在读取固定版本" />
                  ) : (
                    selected.data &&
                    !selected.isError &&
                    (selected.data.assetId === id ? (
                      <AssetRevisionView
                        key={selected.data.id}
                        path={path}
                        tenantId={tenantId}
                        revision={selected.data}
                      />
                    ) : (
                      <Empty>指定版本不属于这项资产。</Empty>
                    ))
                  )
                ) : (
                  <Empty>
                    先建立第一个固定版本，保存设定和参考。资产名称与固定设定分别维护。
                  </Empty>
                )}
              </>
            )}
          </Stack>
          <Stack
            component="aside"
            gap="lg"
            className={classes.inspector}
            aria-label="设定与版本"
          >
            {viewed && (
              <>
                <AssetRevisionDefinition revision={viewed} path={path} />
                {viewed.id !== value.currentRevisionId && (
                  <Button
                    component="a"
                    variant="subtle"
                    className={classes.secondaryAction}
                    href={href(id)}
                  >
                    查看当前版本
                  </Button>
                )}
                {value.scope === "shared" && targetProjectId && (
                  <ImportFixedAsset
                    key={`${targetProjectId}/${viewed.id}`}
                    path={path}
                    tenantId={tenantId}
                    projectId={targetProjectId}
                    revision={viewed}
                    active={value.status === "active"}
                  />
                )}
                <details className={classes.disclosure}>
                  <summary>
                    版本信息与操作 <span>v{viewed.number}</span>
                  </summary>
                  <Stack mt="md" gap="sm">
                    <Text size="sm">
                      {viewed.status === "confirmed"
                        ? "此固定设定已确认。"
                        : "此版本为草稿，可以用于试作。"}
                      浏览版本不会替换既有引用。
                    </Text>
                    {viewed.createdAt && (
                      <Text size="xs" c="dimmed">
                        建立于 {new Date(viewed.createdAt).toLocaleString()}
                      </Text>
                    )}
                    {active && canConfirm && viewed.status === "draft" && (
                      <Button
                        variant="default"
                        onClick={() => setConfirm(viewed)}
                      >
                        确认 v{viewed.number} 设定
                      </Button>
                    )}
                  </Stack>
                </details>
              </>
            )}
            <ErrorNotice error={current.error} />
            <details
              className={classes.disclosure}
              onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
            >
              <summary>版本历史</summary>
              <Stack mt="md" gap="sm">
                <ErrorNotice
                  error={history.error}
                  retry={() => void history.refetch()}
                />
                {history.isPending && historyOpen && (
                  <Loader size="sm" aria-label="正在读取版本历史" />
                )}
                {!history.isError &&
                  history.data?.pages
                    .flatMap((page) => page.items)
                    .map((revision) => (
                      <Group key={revision.id} justify="space-between">
                        <Button
                          component="a"
                          variant="subtle"
                          href={href(id, revision.id)}
                          aria-current={
                            revision.id === viewed?.id ? "page" : undefined
                          }
                        >
                          查看 v{revision.number}
                        </Button>
                        <Text size="xs">
                          {revision.status === "confirmed" ? "已确认" : "草稿"}
                        </Text>
                      </Group>
                    ))}
                {history.hasNextPage && (
                  <Button
                    loading={history.isFetchingNextPage}
                    onClick={() => void history.fetchNextPage()}
                  >
                    加载更多固定版本
                  </Button>
                )}
              </Stack>
            </details>
            <details
              className={classes.disclosure}
              onToggle={(event) => setUsageOpen(event.currentTarget.open)}
            >
              <summary>使用位置</summary>
              <Stack mt="md" gap="sm">
                <Text size="xs" c="dimmed">
                  仅显示当前有权查看的直接引用。
                </Text>
                <ErrorNotice
                  error={usages.error}
                  retry={() => void usages.refetch()}
                />
                {usages.isPending && usageOpen && (
                  <Loader size="sm" aria-label="正在读取使用位置" />
                )}
                {!usages.isError &&
                  usages.data?.pages
                    .flatMap((page) => page.items)
                    .map((usage) => (
                      <AssetUsage
                        key={`${usage.kind}/${usage.objectId}`}
                        usage={usage}
                        path={path}
                        tenantId={tenantId}
                      />
                    ))}
                {!usages.isError &&
                  usages.data &&
                  !usages.data.pages.some((page) => page.items.length) && (
                    <Text size="sm" c="dimmed">
                      暂未找到有权查看的直接引用。
                    </Text>
                  )}
                {usages.hasNextPage && (
                  <Button
                    loading={usages.isFetchingNextPage}
                    onClick={() => void usages.fetchNextPage()}
                  >
                    加载更多使用位置
                  </Button>
                )}
              </Stack>
            </details>
            {(value.description || value.tags?.length) && (
              <details className={classes.disclosure}>
                <summary>检索信息与标签</summary>
                <Text size="sm" className={classes.definition}>
                  {value.description || "未填写"}
                </Text>
                <Group mt="sm" gap="xs">
                  {value.tags?.map((tag) => (
                    <Badge key={tag}>{tag}</Badge>
                  ))}
                </Group>
              </details>
            )}
          </Stack>
        </div>
      </section>
      <Modal
        title="确认这份固定设定？"
        opened={!!confirm}
        onClose={() => setConfirm(undefined)}
      >
        <Stack>
          <Text>
            {value.name} · v{confirm?.number}
            。确认表示团队认可此固定设定，不代表成片已审阅通过。之后修改会产生新的草稿版本。
          </Text>
          <Button
            variant="filled"
            loading={command.isPending}
            disabled={!confirm}
            onClick={() =>
              confirm &&
              command.mutate(
                {
                  path: `${path}/assets/${id}/revisions/${confirm.id}/confirm`,
                  version: confirm.revision,
                },
                { onSuccess: () => setConfirm(undefined) },
              )
            }
          >
            确认这份设定
          </Button>
        </Stack>
      </Modal>
      <Modal
        title="归档这项资产？"
        opened={!!archive}
        onClose={() => setArchive(undefined)}
      >
        <Stack>
          <Text>保留固定版本和已有引用，不再新增修订或引用。</Text>
          <Button
            variant="filled"
            loading={command.isPending}
            disabled={!archive}
            onClick={() =>
              archive &&
              command.mutate(
                {
                  path: `${path}/assets/${id}/archive`,
                  version: archive.revision,
                },
                { onSuccess: () => setArchive(undefined) },
              )
            }
          >
            确认归档资产
          </Button>
        </Stack>
      </Modal>
    </>
  );
}
function ImportFixedAsset({
  path,
  tenantId,
  projectId,
  revision,
  active,
}: {
  path: string;
  tenantId: string;
  projectId: string;
  revision: Schema<"AssetRevision">;
  active: boolean;
}) {
  const project = useResource<Schema<"Project">>(
      projectPath(tenantId, projectId),
    ),
    command = useCommand<Schema<"SharedImport">>();
  if (project.isError) return <ErrorNotice error={project.error} />;
  if (!project.data) return <Loader size="sm" aria-label="正在核对引入目标" />;
  return (
    <Stack gap="sm">
      <Text size="sm">固定引入目标：{project.data.name}</Text>
      <ErrorNotice error={command.error} />
      {command.isSuccess && command.data.assetRevisionId === revision.id && (
        <Text role="status">已引入此固定版本，后续修订不会自动升级。</Text>
      )}
      <Button
        disabled={!active || project.data.status !== "active"}
        loading={command.isPending}
        onClick={() =>
          command.mutate({
            path: `${path}/projects/${projectId}/shared-imports`,
            body: { assetRevisionId: revision.id },
          })
        }
      >
        将 v{revision.number} 引入此项目
      </Button>
      <Button
        component="a"
        variant="subtle"
        href={`#/app/t/${tenantId}/p/${projectId}/assets`}
      >
        返回项目资产
      </Button>
    </Stack>
  );
}

function AssetUsage({
  usage,
  path,
  tenantId,
}: {
  usage: Schema<"UsageLocation">;
  path: string;
  tenantId: string;
}) {
  const revision = useResource<Schema<"AssetRevision">>(
    `${path}/asset-revisions/${usage.objectId}`,
    usage.kind === "asset_revision",
  );
  if (usage.kind === "cut_work_draft" && usage.projectId && usage.sceneId)
    return (
      <Button
        component="a"
        variant="subtle"
        href={`#/app/t/${tenantId}/p/${usage.projectId}/editing?scene=${usage.sceneId}&cut=${usage.objectId}&tool=dialogue`}
      >
        {usage.label}
      </Button>
    );
  if (
    usage.projectId &&
    (usage.kind === "production" ||
      usage.kind === "scene" ||
      (usage.kind === "shot_revision" && usage.shotId))
  ) {
    const href =
      `#/app/t/${tenantId}/p/${usage.projectId}` +
      (usage.kind === "scene"
        ? `/content?scene=${usage.objectId}`
        : usage.kind === "shot_revision" && usage.shotId
          ? `/content?shot=${usage.shotId}&revision=${usage.objectId}`
          : "");
    return (
      <Button component="a" variant="subtle" href={href}>
        {usage.label}
      </Button>
    );
  }
  if (revision.isError) return <ErrorNotice error={revision.error} />;
  if (!revision.data) return <Text size="sm">{usage.label}</Text>;
  return (
    <Button
      component="a"
      variant="subtle"
      href={`#/app/t/${tenantId}${usage.projectId ? "/p/" + usage.projectId : ""}/assets?asset=${revision.data.assetId}&revision=${revision.data.id}`}
    >
      {usage.label}
    </Button>
  );
}

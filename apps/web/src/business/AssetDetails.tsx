import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
} from "@mantine/core";
import { useCommand, useResource, type Schema } from "./api";
import { Empty, ErrorNotice, projectPath, SectionHeading } from "./common";
import { assetKinds, useAssetPages } from "./asset-queries";
import { AssetRevisionView } from "./AssetRevisionView";
import { AssetDefinitionEditor } from "./AssetDefinitionEditor";
import { AssetMetadataEditor } from "./AssetMetadataEditor";
import classes from "./assets.module.css";
export function AssetDetails({
  path,
  tenantId,
  id,
  revisionId,
  expectedProjectId,
  canWrite,
  canConfirm,
  href,
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
  if (asset.isError && !asset.data)
    return (
      <ErrorNotice error={asset.error} retry={() => void asset.refetch()} />
    );
  if (!asset.data) return <Loader aria-label="正在读取资产" />;
  const value = asset.data;
  if (value.projectId !== expectedProjectId)
    return (
      <Empty>该资产不属于当前范围，请从所属项目或工作室共享区进入。</Empty>
    );
  const active = canWrite && value.status === "active";
  return (
    <>
      <SectionHeading
        title={value.name}
        description={`${assetKinds[value.kind]} · ${value.scope === "shared" ? "工作室共享" : "项目资产"} · ${value.status === "archived" ? "已归档" : "使用中"}`}
        action={
          canWrite && (
            <Button
              onClick={() =>
                setEditing(
                  editing?.kind === "metadata"
                    ? undefined
                    : { kind: "metadata" },
                )
              }
            >
              修改检索信息
            </Button>
          )
        }
      />
      <ErrorNotice error={asset.error ?? command.error} />
      {value.status === "archived" && (
        <Alert title="资产已归档">
          固定版本与已有引用仍保留。不能新增版本或将其用于新引用。
        </Alert>
      )}
      <div className={classes.detail}>
        <Stack gap="lg">
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
        </Stack>
        <Stack gap="lg">
          {selected.data &&
            !selected.isError &&
            selected.data.assetId === id && (
              <>
                <Group>
                  <Text fw={600}>v{selected.data.number}</Text>
                  <Badge>
                    {selected.data.status === "confirmed"
                      ? "已确认设定"
                      : "草稿设定"}
                  </Badge>
                  {selected.data.id === value.currentRevisionId && (
                    <Text size="xs" c="dimmed">
                      当前版本
                    </Text>
                  )}
                </Group>
                <Text size="sm" c="dimmed">
                  {selected.data.createdAt
                    ? new Date(selected.data.createdAt).toLocaleString()
                    : ""}
                </Text>
                <Text size="sm">
                  草稿版本可以用于试作。浏览其他版本不会自动替换镜头或项目的既有引用。
                </Text>
                {selected.data.id !== value.currentRevisionId && (
                  <Button component="a" href={href(id)}>
                    查看当前版本
                  </Button>
                )}
                {active && canConfirm && selected.data.status === "draft" && (
                  <Button onClick={() => setConfirm(selected.data)}>
                    确认 v{selected.data.number} 设定
                  </Button>
                )}
                {value.scope === "shared" && targetProjectId && (
                  <ImportFixedAsset
                    key={`${targetProjectId}/${selected.data.id}`}
                    path={path}
                    tenantId={tenantId}
                    projectId={targetProjectId}
                    revision={selected.data}
                    active={value.status === "active"}
                  />
                )}
              </>
            )}
          {active && (
            <Button
              disabled={
                !!value.currentRevisionId && (!current.data || current.isError)
              }
              onClick={() => {
                if (selectedId !== value.currentRevisionId)
                  location.hash = href(id);
                setEditing({ kind: "definition", current: current.data });
              }}
            >
              {value.currentRevisionId
                ? "基于当前版本新建修订"
                : "建立第一个固定版本"}
            </Button>
          )}
          <ErrorNotice error={current.error} />
          <details
            onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
          >
            <summary>固定版本历史</summary>
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
          <details onToggle={(event) => setUsageOpen(event.currentTarget.open)}>
            <summary>有权查看的直接使用位置</summary>
            <Stack mt="md" gap="sm">
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
            <div>
              <Text size="sm" fw={500}>
                检索说明
              </Text>
              <Text size="sm" className={classes.definition}>
                {value.description || "未填写"}
              </Text>
              <Group mt="sm" gap="xs">
                {value.tags?.map((tag) => (
                  <Badge key={tag}>{tag}</Badge>
                ))}
              </Group>
            </div>
          )}
          {active && (
            <Button onClick={() => setArchive(value)}>归档资产</Button>
          )}
        </Stack>
      </div>
      {editing?.kind === "definition" && active && (
        <AssetDefinitionEditor
          key={id}
          asset={value}
          current={current.data ?? editing.current}
          currentReady={
            !value.currentRevisionId ||
            (!current.isError && current.data?.id === value.currentRevisionId)
          }
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

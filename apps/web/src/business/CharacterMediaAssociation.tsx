import { useState } from "react";
import { useDebouncedValue } from "@mantine/hooks";
import {
  Button,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { MagnifyingGlass, UserPlus } from "@phosphor-icons/react";
import { useResource, type Schema } from "./api";
import { useAssetPages } from "./asset-queries";
import { Empty, ErrorNotice } from "./common";
import { MediaPreview } from "./MediaPreview";
import classes from "./character-media-association.module.css";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** This handoff identifies an image to inspect; it never grants scope or writes a reference. */
export function AddImageToCharacter({
  path,
  media,
  projectId,
}: {
  path: string;
  media: Schema<"Media">;
  projectId?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  if (media.kind !== "image" || media.status !== "ready") return null;
  return (
    <>
      <Button
        variant="default"
        leftSection={<UserPlus size={16} />}
        onClick={() => setOpen(true)}
      >
        添加到角色
      </Button>
      <Modal
        title="选择要添加图片的角色"
        opened={open}
        onClose={() => setOpen(false)}
        size="lg"
      >
        {open && (
          <CharacterTargets path={path} media={media} projectId={projectId} />
        )}
      </Modal>
    </>
  );
}

function CharacterTargets({
  path,
  media,
  projectId,
}: {
  path: string;
  media: Schema<"Media">;
  projectId?: string | undefined;
}) {
  const [q, setQ] = useState("");
  const [search] = useDebouncedValue(q, 250);
  const query = new URLSearchParams({
    kind: "character",
    status: "active",
    scope: projectId ? "project" : "shared",
    q: search,
    ...(projectId ? { projectId } : {}),
  });
  const assets = useAssetPages<Schema<"Asset">>(`${path}/assets?${query}`);
  const tenantId = path.split("/")[3]!;
  // Retain the project's library shell when it is browsing studio-shared content.
  const contextProject = location.hash.match(
    /^#\/app\/t\/[^/]+\/p\/([^/?]+)/,
  )?.[1];
  const contextProjectId =
    projectId ??
    (contextProject && uuid.test(contextProject) ? contextProject : undefined);
  const href = (assetId: string) => {
    const params = new URLSearchParams({
      type: "character",
      asset: assetId,
      referenceMedia: media.id,
      ...(!projectId ? { scope: "shared" } : {}),
    });
    return `#/app/t/${tenantId}${contextProjectId ? `/p/${contextProjectId}` : ""}/assets?${params}`;
  };
  const options =
    assets.data?.pages
      .flatMap((page) => page.items)
      .filter(
        (asset) =>
          asset.kind === "character" &&
          asset.status === "active" &&
          asset.projectId === projectId,
      ) ?? [];
  return (
    <Stack gap="md">
      <Text size="sm">
        {projectId ? "当前项目" : "工作室共享"} · {media.displayName}
      </Text>
      <Text size="sm" c="dimmed">
        选择后可核对图片并加入角色草稿。保存新修订后才会建立参考关系。
      </Text>
      <TextInput
        label="查找角色"
        placeholder="搜索角色名称或标签"
        value={q}
        onChange={(event) => setQ(event.currentTarget.value)}
        leftSection={<MagnifyingGlass size={16} />}
      />
      <ErrorNotice error={assets.error} retry={() => void assets.refetch()} />
      {assets.isPending ? (
        <Loader size="sm" aria-label="正在读取角色" />
      ) : (
        !assets.isError && (
          <>
            <div className={classes.targets}>
              {options.map((asset) => (
                <div key={asset.id} className={classes.target}>
                  <div>
                    <Text fw={500} className={classes.text}>
                      {asset.name}
                    </Text>
                    {asset.description && (
                      <Text size="sm" c="dimmed" lineClamp={2}>
                        {asset.description}
                      </Text>
                    )}
                  </div>
                  <Button
                    component="a"
                    variant="subtle"
                    href={href(asset.id)}
                    aria-label={`选择角色 ${asset.name}`}
                  >
                    选择
                  </Button>
                </div>
              ))}
            </div>
            {!options.length && (
              <Empty>
                当前范围没有匹配的角色。先在资产库建立角色，再添加图片。
              </Empty>
            )}
            {assets.hasNextPage && (
              <Button
                variant="subtle"
                loading={assets.isFetchingNextPage}
                onClick={() => void assets.fetchNextPage()}
              >
                加载更多角色
              </Button>
            )}
          </>
        )
      )}
    </Stack>
  );
}

export function PendingCharacterImage({
  path,
  mediaId,
  asset,
  disabled,
  added,
  actionLabel,
  onAdd,
  onDismiss,
}: {
  path: string;
  mediaId: string;
  asset: Schema<"Asset">;
  disabled: boolean;
  added?: boolean | undefined;
  actionLabel: string;
  onAdd: (media: Schema<"Media">) => void;
  onDismiss: () => void;
}) {
  const media = useResource<Schema<"Media">>(
    `${path}/media/${mediaId}`,
    uuid.test(mediaId),
  );
  if (!uuid.test(mediaId))
    return (
      <Group>
        <Text size="sm">待加入图片的标识无效，请从素材详情重新选择。</Text>
        <Button variant="subtle" onClick={onDismiss}>
          取消本次添加
        </Button>
      </Group>
    );
  const value =
    !media.isError && media.data?.id === mediaId ? media.data : undefined;
  const reason = !value
    ? undefined
    : asset.kind !== "character" || asset.status !== "active"
      ? "当前角色不能接受新参考。"
      : value.kind !== "image" || value.status !== "ready"
        ? "仅可加入已验收、未归档的图片。"
        : !(
              value.scope === "shared" ||
              (asset.scope === "project" && value.projectId === asset.projectId)
            )
          ? "此图片不属于角色可使用的范围，不能加入。"
          : undefined;
  return (
    <section className={classes.pending} aria-label="待加入的角色图片">
      <ErrorNotice error={media.error} retry={() => void media.refetch()} />
      {!value && !media.isError && (
        <Loader size="sm" aria-label="正在核对待加入图片" />
      )}
      {value && (
        <>
          <div className={classes.preview}>
            <MediaPreview key={value.id} path={path} media={value} thumbnail />
          </div>
          <Stack gap="xs" className={classes.description}>
            <Text size="sm" fw={600}>
              待加入：{value.displayName}
            </Text>
            <Text size="sm" className={classes.text}>
              角色：{asset.name} · 身份参考
            </Text>
            <Text size="xs" c="dimmed">
              保存新的固定版本后生效，原设定和已有引用保持不变。
            </Text>
            {reason && (
              <Text size="sm" role="status">
                {reason}
              </Text>
            )}
            {added ? (
              <Text size="sm" role="status">
                此图片已在当前编辑草稿的身份参考中。
              </Text>
            ) : (
              <Button
                className={classes.action}
                variant="default"
                disabled={disabled || !!reason}
                onClick={() => onAdd(value)}
              >
                {actionLabel}
              </Button>
            )}
          </Stack>
        </>
      )}
      <Button
        className={classes.action}
        size="compact-xs"
        variant="subtle"
        onClick={onDismiss}
      >
        {added ? "收起提示" : "取消本次添加"}
      </Button>
    </section>
  );
}

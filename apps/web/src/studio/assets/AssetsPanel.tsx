import { useState, type DragEvent } from "react";
import { Loader, TextInput, Tooltip, UnstyledButton } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import {
  Cube,
  FilmStrip,
  ImageSquare,
  MagnifyingGlass,
  Mountains,
  MusicNotes,
  Palette,
  Plus,
  User,
  Waveform,
  X,
} from "@phosphor-icons/react";
import { usePages, useResource, type Schema } from "../../business/api";
import { ErrorNotice } from "../../business/common";
import { MediaPreview } from "../../business/MediaPreview";
import { AssetMediaThumbnail } from "../../business/AssetThumbnail";
import { assetKinds } from "../../business/asset-queries";
import classes from "./assets.module.css";

/** What a dragged item carries to the board: the media to place, and the fixed asset revision it came from. */
export type AssetDrop = { mediaId: string; assetRevisionId?: string; title: string };
export const ASSET_DROP_TYPE = "application/x-scenedesk-asset";
const assetIcons = { character: User, location: Mountains, prop: Cube, voice: Waveform, style: Palette };
const mediaIcons = { image: ImageSquare, video: FilmStrip, audio: MusicNotes, document: ImageSquare };

/**
 * The project's assets and media as a side panel of the board: a list to
 * search, drag onto the board, or add with one press. The full library stays
 * its own page behind "管理资产". Placing something here creates a media card;
 * it never binds a shot or adopts anything.
 */
export function AssetsPanel({
  tenantId,
  projectId,
  mediaPath,
  readOnly,
  onAdd,
  onClose,
}: {
  tenantId: string;
  projectId: string;
  mediaPath: string;
  readOnly: boolean;
  onAdd: (item: AssetDrop) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [search] = useDebouncedValue(query.trim(), 250);
  const q = encodeURIComponent(search);
  const assets = usePages<Schema<"Asset">>(
    `${mediaPath}/assets?scope=project&projectId=${projectId}&status=active&q=${q}`,
  );
  const media = usePages<Schema<"Media">>(
    `${mediaPath}/media?scope=project&projectId=${projectId}&status=ready&q=${q}`,
  );
  const assetItems = assets.data?.pages.flatMap((page) => page.items) ?? [];
  const mediaItems = (media.data?.pages.flatMap((page) => page.items) ?? []).filter(
    (item) => item.kind !== "document" && item.status === "ready",
  );
  return (
    <section className={classes.panel} aria-label="资产面板">
      <header className={classes.header}>
        <span className={classes.title}>资产</span>
        <a className={classes.manage} href={`#/app/t/${tenantId}/p/${projectId}/assets`}>
          管理资产
        </a>
        <UnstyledButton className={classes.close} aria-label="关闭资产面板" onClick={onClose}>
          <X size={14} aria-hidden />
        </UnstyledButton>
      </header>
      <TextInput
        variant="unstyled"
        size="sm"
        aria-label="搜索资产与素材"
        placeholder="搜索"
        leftSection={<MagnifyingGlass size={14} aria-hidden />}
        classNames={{ root: classes.searchRoot!, input: classes.search! }}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <div className={classes.scroll}>
        <h3 className={classes.heading}>项目资产</h3>
        <ErrorNotice error={assets.error} retry={() => void assets.refetch()} />
        {assetItems.map((asset) => (
          <AssetRow key={asset.id} asset={asset} mediaPath={mediaPath} readOnly={readOnly} onAdd={onAdd} />
        ))}
        {assets.isPending && <Loader size="xs" aria-label="正在读取资产" />}
        {assets.data && !assetItems.length && (
          <p className={classes.empty}>{search ? "没有匹配的资产" : "还没有项目资产"}</p>
        )}
        {assets.hasNextPage && (
          <UnstyledButton className={classes.more} disabled={assets.isFetchingNextPage} onClick={() => void assets.fetchNextPage()}>
            更多资产
          </UnstyledButton>
        )}
        <h3 className={classes.heading}>素材</h3>
        <ErrorNotice error={media.error} retry={() => void media.refetch()} />
        {mediaItems.map((item) => (
          <MediaRow key={item.id} media={item} mediaPath={mediaPath} readOnly={readOnly} onAdd={onAdd} />
        ))}
        {media.isPending && <Loader size="xs" aria-label="正在读取素材" />}
        {media.data && !mediaItems.length && (
          <p className={classes.empty}>{search ? "没有匹配的素材" : "还没有可用素材"}</p>
        )}
        {media.hasNextPage && (
          <UnstyledButton className={classes.more} disabled={media.isFetchingNextPage} onClick={() => void media.fetchNextPage()}>
            更多素材
          </UnstyledButton>
        )}
      </div>
    </section>
  );
}

function startDrag(event: DragEvent<HTMLElement>, item: AssetDrop) {
  event.dataTransfer.setData(ASSET_DROP_TYPE, JSON.stringify(item));
  event.dataTransfer.effectAllowed = "copy";
}

function Row({
  item,
  icon,
  thumb,
  title,
  detail,
  readOnly,
  onAdd,
}: {
  item: AssetDrop | undefined;
  icon: React.ReactNode;
  thumb: React.ReactNode;
  title: string;
  detail: string;
  readOnly: boolean;
  onAdd: (item: AssetDrop) => void;
}) {
  const draggable = !!item && !readOnly;
  return (
    <div
      className={classes.row}
      draggable={draggable}
      data-draggable={draggable || undefined}
      aria-label={`${title} · ${detail}`}
      onDragStart={(event) => item && startDrag(event, item)}
    >
      <span className={classes.thumb}>{thumb ?? icon}</span>
      <span className={classes.rowText}>
        <span className={classes.rowTitle}>{title}</span>
        <span className={classes.rowDetail}>{detail}</span>
      </span>
      {item && (
        <Tooltip label="加入创作台">
          <UnstyledButton
            className={classes.add}
            aria-label={`加入创作台：${title}`}
            disabled={readOnly}
            onClick={() => onAdd(item)}
          >
            <Plus size={14} aria-hidden />
          </UnstyledButton>
        </Tooltip>
      )}
    </div>
  );
}

function AssetRow({
  asset,
  mediaPath,
  readOnly,
  onAdd,
}: {
  asset: Schema<"Asset">;
  mediaPath: string;
  readOnly: boolean;
  onAdd: (item: AssetDrop) => void;
}) {
  const revision = useResource<Schema<"AssetRevision">>(
    `${mediaPath}/asset-revisions/${asset.currentRevisionId ?? ""}`,
    !!asset.currentRevisionId,
  );
  const fixed =
    !revision.isError && revision.data?.assetId === asset.id && revision.data.id === asset.currentRevisionId
      ? revision.data
      : undefined;
  const mediaId = fixed?.definition.references[0]?.mediaId;
  const Icon = assetIcons[asset.kind];
  return (
    <Row
      item={mediaId && fixed ? { mediaId, assetRevisionId: fixed.id, title: asset.name } : undefined}
      icon={<Icon size={18} aria-hidden />}
      thumb={mediaId ? <AssetMediaThumbnail path={mediaPath} mediaId={mediaId} /> : undefined}
      title={asset.name}
      detail={`${assetKinds[asset.kind]}${!asset.currentRevisionId ? " · 待建立首版" : mediaId ? "" : " · 文字设定"}`}
      readOnly={readOnly}
      onAdd={onAdd}
    />
  );
}

function MediaRow({
  media,
  mediaPath,
  readOnly,
  onAdd,
}: {
  media: Schema<"Media">;
  mediaPath: string;
  readOnly: boolean;
  onAdd: (item: AssetDrop) => void;
}) {
  const Icon = mediaIcons[media.kind];
  return (
    <Row
      item={{ mediaId: media.id, title: media.displayName }}
      icon={<Icon size={18} aria-hidden />}
      thumb={media.kind === "audio" ? undefined : <MediaPreview media={media} path={mediaPath} thumbnail />}
      title={media.displayName}
      detail={{ image: "图片", video: "视频", audio: "音频", document: "文档" }[media.kind]}
      readOnly={readOnly}
      onAdd={onAdd}
    />
  );
}

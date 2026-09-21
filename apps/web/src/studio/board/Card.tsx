import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { Menu, Text, TextInput, Textarea, UnstyledButton } from "@mantine/core";
import {
  Handle,
  NodeResizeControl,
  NodeToolbar,
  Position,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  ArrowsOutSimple,
  FilmStrip,
  ImageSquare,
  MusicNotes,
  Play,
  Plus,
  Quotes,
  TextAlignLeft,
  WarningCircle,
} from "@phosphor-icons/react";
import type { CanvasDocument, CanvasNode } from "@drama/domain";
import { useResource, type Schema } from "../../business/api";
import { MediaPreview } from "../../business/MediaPreview";
import { draftFrameAspect } from "../../business/canvas-card-frame";
import { CANVAS_NODE_WIDTH } from "../../business/canvas-node-actions";
import { referenceState } from "../../business/canvas-reference-state";
import classes from "./board.module.css";

export type CardActions = {
  textChange: (id: string, text: string) => void;
  stopTextEdit: () => void;
  startRename: (id: string) => void;
  /** `null` cancels; a title commits (validated by the engine). */
  rename: (id: string, title: string | null) => void;
  resizeWidth: (id: string, width: number, done: boolean) => void;
  /** Create a draft of `kind` fed by these cards; the engine checks the sources. */
  continueWith: (ids: string[], kind: "image" | "video" | "audio") => void;
};
export type CardData = {
  node: CanvasNode;
  mediaPath: string;
  groupTitle?: string | undefined;
  editingText: boolean;
  renaming: boolean;
  readOnly: boolean;
  actions: CardActions;
  /** References this card feeds, shown as purpose badges on it. */
  references: CanvasDocument["edges"];
  /** Single selection of a usable source: the ⊕ to continue from it appears. */
  canContinue: boolean;
};
export type CardNode = Node<CardData, "card">;

const icons = {
  text: TextAlignLeft,
  image: ImageSquare,
  video: FilmStrip,
  audio: MusicNotes,
};
const kindLabel = { text: "文字", image: "图片", video: "视频", audio: "音频" };

/**
 * One card on the board. The title sits outside the body as a small grey label
 * (double-click renames); the body is the work itself: text edited in place,
 * an empty draft as a centred icon in a frame of its output ratio, media
 * filling the frame. Selection darkens the edge and shows the two ports.
 */
export const Card = memo(function Card({ id, data, selected }: NodeProps<CardNode>) {
  const { node, readOnly, actions } = data;
  const Icon = icons[node.kind];
  const excerpt = node.kind === "text" && !!node.content.sourceExcerpt;
  const aspect = node.content.type === "draft" ? draftFrameAspect(node) : null;
  const media = useResource<Schema<"Media">>(
    `${data.mediaPath}/media/${node.content.type === "media" ? node.content.mediaId : ""}`,
    node.content.type === "media",
  );
  const mediaStatus =
    node.content.type !== "media"
      ? undefined
      : media.isError
        ? null
        : media.data?.id === node.content.mediaId
          ? { status: media.data.status }
          : undefined;
  const badges = [
    ...new Map(
      data.references
        .map((edge) => referenceState({ edge, source: node, media: mediaStatus }))
        .map((state) => [state.label, state] as const),
    ).values(),
  ];
  // Purposes this card serves: in the label row for text, over the frame for media.
  const badgeRow = badges.length > 0 && (
    <span className={classes.badges} aria-label="作为参考的用途">
      {badges.slice(0, 3).map((badge) => (
        <span key={badge.label} className={classes.badge} data-tone={badge.tone}>
          {badge.label}
        </span>
      ))}
      {badges.length > 3 && (
        <span className={classes.badge}>+{badges.length - 3}</span>
      )}
    </span>
  );
  const style: CSSProperties | undefined = aspect
    ? { aspectRatio: `${aspect.width} / ${aspect.height}` }
    : undefined;
  return (
    <div
      className={classes.card}
      data-kind={node.kind}
      data-content={excerpt ? "excerpt" : node.content.type}
      data-selected={selected || undefined}
      data-editing={data.editingText || undefined}
    >
      <div
        className={classes.label}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (!readOnly) actions.startRename(id);
        }}
      >
        {excerpt ? <Quotes size={14} aria-hidden /> : <Icon size={14} aria-hidden />}
        {data.renaming ? (
          <RenameInput id={id} title={node.title} actions={actions} />
        ) : (
          <span className={classes.title}>{node.title}</span>
        )}
        {node.kind === "text" && badgeRow}
        {data.groupTitle && (
          <span className={classes.group}>{data.groupTitle}</span>
        )}
      </div>
      <article
        className={classes.body}
        style={style}
        aria-label={`${node.title} · ${excerpt ? "固定摘录" : kindLabel[node.kind]}`}
      >
        {node.kind === "text" ? (
          <TextBody
            id={id}
            text={node.content.text}
            excerpt={excerpt}
            editing={data.editingText}
            readOnly={readOnly}
            actions={actions}
          />
        ) : node.content.type === "draft" ? (
          <div className={classes.placeholder}>
            <Icon size={40} aria-hidden />
          </div>
        ) : (
          <MediaBody
            kind={node.kind}
            mediaId={node.content.mediaId}
            path={data.mediaPath}
            media={media}
          />
        )}
        {node.kind !== "text" && badgeRow}
      </article>
      {node.content.type === "draft" ? (
        <Handle
          type="target"
          position={Position.Left}
          className={classes.port}
          isConnectable={!readOnly}
          aria-label="接收参考"
        />
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          className={classes.port}
          isConnectable={!readOnly}
          aria-label="作为参考"
        />
      )}
      <NodeToolbar
        position={Position.Right}
        isVisible={data.canContinue}
        offset={12}
        className={classes.continueToolbar!}
      >
        <Menu position="right-start" shadow="md" width={140} withinPortal>
          <Menu.Target>
            <UnstyledButton
              className={`nodrag nopan ${classes.plus}`}
              aria-label="继续创作"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Plus size={16} aria-hidden />
            </UnstyledButton>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              leftSection={<ImageSquare size={14} />}
              onClick={() => actions.continueWith([id], "image")}
            >
              图片
            </Menu.Item>
            <Menu.Item
              leftSection={<FilmStrip size={14} />}
              onClick={() => actions.continueWith([id], "video")}
            >
              视频
            </Menu.Item>
            <Menu.Item
              leftSection={<MusicNotes size={14} />}
              onClick={() => actions.continueWith([id], "audio")}
            >
              音频
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </NodeToolbar>
      {node.kind === "text" && !excerpt && !readOnly && selected && (
        <NodeResizeControl
          position="bottom-right"
          minWidth={CANVAS_NODE_WIDTH.min}
          maxWidth={CANVAS_NODE_WIDTH.max}
          resizeDirection="horizontal"
          className={classes.resize!}
          onResize={(_, params) => actions.resizeWidth(id, params.width, false)}
          onResizeEnd={(_, params) => actions.resizeWidth(id, params.width, true)}
        >
          <ArrowsOutSimple size={12} aria-hidden />
        </NodeResizeControl>
      )}
    </div>
  );
});

function RenameInput({
  id,
  title,
  actions,
}: {
  id: string;
  title: string;
  actions: CardActions;
}) {
  const [value, setValue] = useState(title);
  const done = useRef(false);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    actions.rename(id, next);
  };
  return (
    <TextInput
      autoFocus
      variant="unstyled"
      size="xs"
      aria-label="卡片名称"
      className={`nodrag nopan ${classes.renameRoot}`}
      classNames={{ input: classes.renameInput }}
      value={value}
      maxLength={160}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.currentTarget.value)}
      onBlur={() => finish(value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") finish(value);
        if (event.key === "Escape") finish(null);
      }}
    />
  );
}

function TextBody({
  id,
  text,
  excerpt,
  editing,
  readOnly,
  actions,
}: {
  id: string;
  text: string;
  excerpt: boolean;
  editing: boolean;
  readOnly: boolean;
  actions: CardActions;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!editing) return;
    // A new card is hidden until React Flow has measured it; keep asking for
    // focus for a few frames until the field can actually take it.
    let frames = 0,
      raf = 0;
    const tick = () => {
      const element = input.current;
      if (!element) return;
      element.focus({ preventScroll: true });
      if (document.activeElement !== element && frames++ < 30)
        raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [editing]);
  if (editing && !excerpt && !readOnly)
    return (
      <Textarea
        ref={input}
        variant="unstyled"
        autosize
        minRows={3}
        aria-label="文字内容"
        className={`nodrag nopan nowheel ${classes.textRoot}`}
        classNames={{ input: classes.textInput }}
        value={text}
        onChange={(event) => actions.textChange(id, event.currentTarget.value)}
        onBlur={actions.stopTextEdit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            actions.stopTextEdit();
          }
        }}
      />
    );
  if (!text)
    return (
      <div className={classes.placeholder}>
        <TextAlignLeft size={40} aria-hidden />
      </div>
    );
  return <div className={`${classes.text} nowheel`}>{text}</div>;
}

function MediaBody({
  kind,
  mediaId,
  path,
  media,
}: {
  kind: "image" | "video" | "audio";
  mediaId: string;
  path: string;
  media: ReturnType<typeof useResource<Schema<"Media">>>;
}) {
  const Icon = icons[kind];
  if (media.isError)
    return (
      <div className={classes.placeholder} data-tone="failed">
        <WarningCircle size={40} aria-hidden />
        <Text size="xs">素材当前无法读取</Text>
      </div>
    );
  if (media.data?.id !== mediaId)
    return (
      <div className={classes.placeholder}>
        <Icon size={40} aria-hidden />
      </div>
    );
  if (kind === "audio")
    return (
      <div className={classes.audio}>
        <MusicNotes size={28} aria-hidden />
        <Text size="xs" truncate>
          {media.data.displayName}
        </Text>
      </div>
    );
  const ratio =
    media.data.width && media.data.height
      ? `${media.data.width} / ${media.data.height}`
      : kind === "video"
        ? "16 / 9"
        : "1 / 1";
  return (
    <div className={classes.media} style={{ aspectRatio: ratio }}>
      <MediaPreview media={media.data} path={path} thumbnail />
      {kind === "video" && (
        <span className={classes.playBadge} aria-hidden>
          <Play size={18} weight="fill" />
        </span>
      )}
    </div>
  );
}

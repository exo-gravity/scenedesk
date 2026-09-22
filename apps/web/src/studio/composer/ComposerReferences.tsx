import { Menu, Tooltip, UnstyledButton } from "@mantine/core";
import {
  FilmStrip,
  ImageSquare,
  MusicNotes,
  Plus,
  Prohibit,
  Tag,
  TextAlignLeft,
  Trash,
} from "@phosphor-icons/react";
import type { CanvasDocument, CanvasNode } from "@drama/domain";
import { useResource, type Schema } from "../../business/api";
import { MediaPreview } from "../../business/MediaPreview";
import { referenceState } from "../../business/canvas-reference-state";
import { referencePurposes } from "../../business/reference-purposes";
import classes from "./composer.module.css";

type ReferenceEdge = CanvasDocument["edges"][number];
type Purpose = ReferenceEdge["purpose"];
const icons = { text: TextAlignLeft, image: ImageSquare, video: FilmStrip, audio: MusicNotes };
const purposeLabel = (purpose: Purpose) =>
  purpose === "prompt" ? "提示" : referencePurposes[purpose];

/**
 * Row 1 and 2 of the panel: "＋参考" picks another card on the board as a
 * reference; the thumbnails show every reference with its purpose in the
 * corner and its state from the engine. A thumbnail's menu changes the
 * purpose, disables or removes the reference.
 */
export function ComposerReferences({
  document,
  nodeId,
  edges,
  mediaPath,
  disabled,
  onAdd,
  onEdit,
}: {
  document: CanvasDocument;
  nodeId: string;
  /** Inbound references of this draft, in input order. */
  edges: ReferenceEdge[];
  mediaPath: string;
  disabled: boolean;
  onAdd: (sourceId: string) => void;
  onEdit: (edgeId: string, patch: (edge: ReferenceEdge) => ReferenceEdge | null) => void;
}) {
  const referenced = new Set(edges.map((edge) => edge.sourceNodeId));
  const candidates = document.nodes.filter(
    (node) => node.id !== nodeId && node.content.type !== "draft" && !referenced.has(node.id),
  );
  return (
    <>
      <div className={classes.row}>
        <Menu position="bottom-start" shadow="md" width={344} withinPortal classNames={{ dropdown: classes.pickerDropdown }}>
          <Menu.Target>
            <UnstyledButton className={classes.pill} aria-label="添加参考" disabled={disabled}>
              <Plus size={12} aria-hidden />
              <span>参考</span>
            </UnstyledButton>
          </Menu.Target>
          <Menu.Dropdown>
            {candidates.length ? (
              <div className={classes.pickerGrid}>
                {candidates.map((node) => (
                  <CandidateTile key={node.id} node={node} mediaPath={mediaPath} onAdd={onAdd} />
                ))}
              </div>
            ) : (
              <Menu.Item disabled>创作台上没有可再加入的文字或素材</Menu.Item>
            )}
          </Menu.Dropdown>
        </Menu>
      </div>
      {edges.length > 0 && (
        <div className={classes.references} aria-label="本次参考">
          {edges.map((edge) => (
            <ReferenceThumb
              key={edge.id}
              edge={edge}
              source={document.nodes.find((node) => node.id === edge.sourceNodeId)}
              mediaPath={mediaPath}
              disabled={disabled}
              onEdit={onEdit}
            />
          ))}
        </div>
      )}
    </>
  );
}

function ReferenceThumb({
  edge,
  source,
  mediaPath,
  disabled,
  onEdit,
}: {
  edge: ReferenceEdge;
  source: CanvasNode | undefined;
  mediaPath: string;
  disabled: boolean;
  onEdit: (edgeId: string, patch: (edge: ReferenceEdge) => ReferenceEdge | null) => void;
}) {
  const mediaId = source?.content.type === "media" ? source.content.mediaId : undefined;
  const media = useResource<Schema<"Media">>(`${mediaPath}/media/${mediaId ?? ""}`, !!mediaId);
  const state = referenceState({
    edge,
    source,
    media: !mediaId ? undefined : media.isError ? null : media.data?.id === mediaId ? { status: media.data.status } : undefined,
  });
  const Icon = source ? icons[source.kind] : Prohibit;
  const purposes: Purpose[] =
    source?.kind === "text" ? ["prompt"] : (Object.keys(referencePurposes) as Purpose[]);
  const label = `${source?.title ?? "来源已不在创作台上"} · ${state.label}`;
  return (
    <Menu position="bottom-start" shadow="md" width={200} withinPortal>
      <Menu.Target>
        <Tooltip label={label}>
          <UnstyledButton
            className={classes.reference}
            data-tone={state.tone}
            aria-label={label}
          >
            {mediaId && media.data?.id === mediaId && !media.isError ? (
              <MediaPreview media={media.data} path={mediaPath} thumbnail />
            ) : (
              <Icon size={20} aria-hidden />
            )}
            <span className={classes.referenceTag} data-tone={state.tone}>
              {state.tone === "ok" ? state.label : purposeLabel(edge.purpose)}
            </span>
          </UnstyledButton>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{source?.title ?? "来源已不在创作台上"}</Menu.Label>
        <Menu.Sub>
          <Menu.Sub.Target>
            <Menu.Sub.Item leftSection={<Tag size={14} />} disabled={disabled}>
              用途 · {purposeLabel(edge.purpose)}
            </Menu.Sub.Item>
          </Menu.Sub.Target>
          <Menu.Sub.Dropdown>
            {purposes.map((purpose) => (
              <Menu.Item
                key={purpose}
                disabled={disabled}
                data-active={purpose === edge.purpose || undefined}
                onClick={() => onEdit(edge.id, (current) => ({ ...current, purpose }))}
              >
                {purposeLabel(purpose)}
              </Menu.Item>
            ))}
          </Menu.Sub.Dropdown>
        </Menu.Sub>
        <Menu.Item
          leftSection={<Prohibit size={14} />}
          disabled={disabled}
          onClick={() => onEdit(edge.id, (current) => ({ ...current, enabled: !current.enabled }))}
        >
          {edge.enabled ? "停用" : "启用"}
        </Menu.Item>
        <Menu.Item
          leftSection={<Trash size={14} />}
          disabled={disabled}
          onClick={() => onEdit(edge.id, () => null)}
        >
          移除参考
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

/** One card on the board offered as a reference: its picture when it has one, its title underneath. */
function CandidateTile({
  node,
  mediaPath,
  onAdd,
}: {
  node: CanvasDocument["nodes"][number];
  mediaPath: string;
  onAdd: (id: string) => void;
}) {
  const mediaId = node.content.type === "media" ? node.content.mediaId : undefined;
  const media = useResource<Schema<"Media">>(`${mediaPath}/media/${mediaId ?? ""}`, !!mediaId);
  const Icon = icons[node.kind];
  return (
    <Menu.Item className={classes.pickerItem} aria-label={node.title} onClick={() => onAdd(node.id)}>
      <span className={classes.pickerThumb} data-kind={node.kind}>
        {media.data && media.data.id === mediaId ? (
          <MediaPreview media={media.data} path={mediaPath} thumbnail />
        ) : (
          <Icon size={20} aria-hidden />
        )}
      </span>
      <span className={classes.pickerTitle}>{node.title}</span>
    </Menu.Item>
  );
}

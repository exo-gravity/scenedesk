import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Menu } from "@mantine/core";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  useReactFlow,
  useViewport,
  type Connection,
  type Edge,
  type EdgeChange,
  type IsValidConnection,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import {
  ArrowBendDownRight,
  ClockCounterClockwise,
  Copy,
  FilmStrip,
  ImageSquare,
  MusicNotes,
  PencilSimple,
  Prohibit,
  Quotes,
  Sparkle,
  StackSimple,
  Tag,
  Trash,
} from "@phosphor-icons/react";
import {
  inspectCanvasDocument,
  type CanvasDocument,
  type CanvasNode,
} from "@drama/domain";
import type { CanvasController } from "../../business/canvas-controller";
import {
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  constrainCanvasViewport,
} from "../../business/canvas-viewport";
import {
  COPY_NODE,
  copyCanvasNodes,
  renameCanvasNode,
  updateCanvasNodeGeometry,
} from "../../business/canvas-node-actions";
import { referencePurposes } from "../../business/reference-purposes";
import { appendCanvasReference } from "../../business/canvas-reference";
import {
  createCanvasDraft,
  prepareCanvasCreation,
} from "../../business/canvas-creation";
import { ErrorNotice } from "../../business/common";
import { defaultCardWidth, emptyDraftFrame } from "../../business/canvas-card-frame";
import { Card, type CardActions, type CardNode } from "./Card";
import { estimateCardHeight, nearestFreeSpot } from "./free-spot";
import { Composer, type ComposerDragHandle, type ComposerProps } from "../composer/Composer";
import {
  COMPOSER_SIZE,
  composerNominalHeight,
  composerSafeArea,
  placeComposer,
  type ComposerPlacement,
  type ScreenRect,
} from "../composer/placement";
import type { Schema } from "../../business/api";
import {
  CanvasUploadSummary,
  useCanvasUploads,
  type CanvasUploadRow,
} from "../../business/CanvasUploads";
import { CanvasGenerationBatch } from "../../business/CanvasGenerationBatch";
import { History } from "../results/History";
import { AssetsPanel, ASSET_DROP_TYPE, type AssetDrop } from "../assets/AssetsPanel";
import { api } from "../../business/api";
import type { TaskLabel } from "../results/useNodeResults";
import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { Toolbar, type BoardTool } from "../shell/Toolbar";
import { ZoomControl } from "../shell/ZoomControl";
import classes from "./board.module.css";

type UploadNode = Node<{ row: CanvasUploadRow }, "upload">;
type BoardNode = CardNode | UploadNode;
const UploadCard = memo(function UploadCard({ data }: NodeProps<UploadNode>) {
  return (
    <article className={classes.upload} aria-label={`导入 ${data.row.title}`}>
      <CanvasUploadSummary row={data.row} />
    </article>
  );
});
const nodeTypes = { card: Card, upload: UploadCard };
const kindLabel = { text: "文字", image: "图片", video: "视频", audio: "音频" };
// Constant props for React Flow: a new identity per render would make its
// store updater write on every render, and any store subscriber in this
// component would then re-render it again without end.
const ariaLabelConfig = {
  "node.a11yDescription.default": "按方向键移动卡片，按回车选中。",
};
const panOnDragButtons = [1, 2];
const bandOf = (zoom: number) => (zoom < 0.5 ? "small" : "normal");
const multiSelectionKeys = ["Shift", "Meta", "Control"];
type ReferenceEdge = CanvasDocument["edges"][number];
type Purpose = ReferenceEdge["purpose"];
/** A card that can feed a draft: text with something in it, or existing media. */
const validSource = (node: CanvasNode) =>
  node.content.type === "media" ||
  (node.kind === "text" && node.content.text.trim() !== "");
/** The selected drafts that already have a model: what a batch can fix plans for. */
function selectedNodesRunnable(document: CanvasDocument, selected: readonly string[]) {
  return selected.filter((id) => {
    const node = document.nodes.find((item) => item.id === id);
    return (
      !!node &&
      node.kind !== "text" &&
      node.content.type === "draft" &&
      !!node.content.connectionId &&
      !!node.content.capabilityId
    );
  });
}
/** What a new reference means until the user says otherwise. */
const defaultPurpose = (source: CanvasNode): Purpose =>
  source.kind === "text"
    ? "prompt"
    : source.kind === "audio"
      ? "voice"
      : "composition";

/**
 * The board: React Flow over the canvas document, with the studio's own cards.
 * Every edit goes through the engine controller (undo, local recovery, save);
 * selection and viewport go to the view preference. Nothing here touches the
 * old canvas UI.
 */
export function Board({
  controller,
  document,
  readOnly,
  selected,
  onSelect,
  projectAspect,
  docked = false,
  viewport,
  onViewport,
  mediaPath,
  onShortcuts,
  attempts,
  results,
  tasks,
  assetPanelOpen,
  onAssetPanel,
  focusNodeId,
  scriptHref,
  shotsHref,
  onAssistantContext,
  generation,
}: {
  controller: CanvasController;
  document: CanvasDocument;
  readOnly: boolean;
  selected: string[];
  onSelect: (ids: string[]) => void;
  /** The project's picture shape: the frame of drafts and loading media cards. */
  projectAspect: { width: number; height: number };
  /** A docked panel takes the right edge; the board yields that width. */
  docked?: boolean;
  viewport: { x: number; y: number; zoom: number };
  onViewport: (viewport: { x: number; y: number; zoom: number }) => void;
  mediaPath: string;
  onShortcuts: () => void;
  attempts: readonly Schema<"CanvasPlanEntry">[];
  results: Record<string, string> | undefined;
  tasks: Record<string, TaskLabel>;
  assetPanelOpen: boolean;
  onAssetPanel: (open: boolean) => void;
  /** A card named in the address: brought into view once it is measured. */
  focusNodeId?: string | undefined;
  /** Where a fixed excerpt's source revision can be read. */
  scriptHref: (revisionId: string) => string;
  /** Where a board video can be registered as a shot's candidate. */
  shotsHref: (mediaId: string) => string;
  /** Hand the selected cards to the assistant as context. */
  onAssistantContext: (nodeIds: string[]) => void;
  /** What the input panel needs from the session: identity, saving, retention. */
  generation: Pick<
    ComposerProps,
    | "tenantId"
    | "projectId"
    | "canvasId"
    | "sceneId"
    | "active"
    | "awaitingSave"
    | "save"
    | "registerRetain"
    | "afterPlacement"
  >;
}) {
  const flow = useReactFlow<BoardNode, Edge>();
  const boardElement = useRef<HTMLDivElement>(null);
  const uploads = useCanvasUploads();
  const [historyId, setHistoryId] = useState<string>();
  const [batch, setBatch] = useState<string[]>();
  const [focusedPanel, setFocusedPanel] = useState(false);
  const [tool, setTool] = useState<BoardTool>("select");
  const [error, setError] = useState<Error | null>(null);
  const [editingTextId, setEditingTextId] = useState<string>();
  const [renamingId, setRenamingId] = useState<string>();
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
  // React Flow reports selection as deltas. They are applied to the latest
  // selection asked for, not to the rendered one: the retain guard in front
  // of `onSelect` may still be settling when the next click or box arrives.
  const requestedSelection = useRef(selected);
  useEffect(() => {
    requestedSelection.current = selected;
  }, [selected]);
  const [menu, setMenu] = useState<
    { x: number; y: number; kind: "node" } | { x: number; y: number; kind: "edge"; edgeId: string } | null
  >(null);
  const [connecting, setConnecting] = useState(false);
  // Far out, 12px labels are noise; the cards themselves say enough.
  const [zoomBand, setZoomBand] = useState(() => bandOf(viewport.zoom));
  // React Flow needs measured sizes on controlled nodes; they are view state only.
  const [measurements, setMeasurements] = useState<
    Record<string, { width: number; height: number }>
  >({});
  // A width being dragged, before the document takes it on resize end.
  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({});
  // A card named in the address is brought into view once it has a size.
  const broughtIntoView = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!focusNodeId || broughtIntoView.current === focusNodeId || !measurements[focusNodeId]) return;
    broughtIntoView.current = focusNodeId;
    void flow.fitView({ nodes: [{ id: focusNodeId }], padding: 0.4, maxZoom: 1, duration: 200 });
  }, [focusNodeId, measurements, flow]);
  useEffect(() => {
    const ids = new Set([
      ...document.nodes.map((node) => node.id),
      ...(uploads?.rows ?? []).map((row) => `upload:${row.id}`),
    ]);
    setMeasurements((current) =>
      Object.keys(current).every((id) => ids.has(id))
        ? current
        : Object.fromEntries(
            Object.entries(current).filter(([id]) => ids.has(id)),
          ),
    );
    if (editingTextId && !ids.has(editingTextId)) setEditingTextId(undefined);
    if (renamingId && !ids.has(renamingId)) setRenamingId(undefined);
  }, [document.nodes, uploads?.rows, editingTextId, renamingId]);
  useEffect(() => {
    const ids = new Set(document.edges.map((edge) => edge.id));
    setSelectedEdges((current) =>
      current.every((id) => ids.has(id))
        ? current
        : current.filter((id) => ids.has(id)),
    );
  }, [document.edges]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const current = useCallback(
    () => controller.getSnapshot().local?.document,
    [controller],
  );
  const change = useCallback(
    (next: CanvasDocument, group?: string) => {
      if (readOnly) return;
      try {
        inspectCanvasDocument(next);
        controller.change(next, group);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause : new Error("创作台变更未完成。"));
      }
    },
    [controller, readOnly],
  );
  const actions = useMemo<CardActions>(
    () => ({
      textChange: (id, text) => {
        const doc = current();
        if (!doc) return;
        change(
          {
            ...doc,
            nodes: doc.nodes.map((node) =>
              node.id === id && node.kind === "text"
                ? { ...node, content: { ...node.content, text } }
                : node,
            ),
          },
          `text:${id}`,
        );
      },
      stopTextEdit: () => setEditingTextId(undefined),
      startRename: (id) => {
        setEditingTextId(undefined);
        setRenamingId(id);
      },
      rename: (id, title) => {
        setRenamingId(undefined);
        if (title === null) return;
        const doc = current();
        if (!doc) return;
        try {
          change(renameCanvasNode(doc, id, title));
        } catch (cause) {
          setError(cause instanceof Error ? cause : new Error("名称未更新。"));
        }
      },
      resizeWidth: (id, width, done) => {
        if (!done) {
          setLiveWidths((live) => ({ ...live, [id]: width }));
          return;
        }
        setLiveWidths(({ [id]: _dropped, ...rest }) => rest);
        const doc = current();
        if (doc) change(updateCanvasNodeGeometry(doc, id, { width }));
      },
      continueWith: (ids, kind) => {
        // The engine pins the sources' identity, refuses drafts as sources,
        // places the new draft to their right and wires the references.
        const doc = current();
        if (!doc) return;
        try {
          const prepared = prepareCanvasCreation(doc, ids);
          const created = createCanvasDraft(doc, prepared, kind, projectAspect);
          // The engine places the draft to the right of its sources without
          // looking at other cards; settle it into the nearest free spot.
          const fresh = created.nodes.find((node) => node.id === prepared.id);
          if (fresh) {
            const height = estimateCardHeight(fresh.kind, fresh.width, emptyDraftFrame(fresh, projectAspect));
            const spot = freeSpot(
              { ...created, nodes: created.nodes.filter((node) => node.id !== prepared.id) },
              fresh.width,
              height,
              flow.flowToScreenPosition({ x: fresh.position.x + fresh.width / 2, y: fresh.position.y + height / 2 }),
              true,
            );
            fresh.position = spot;
            change(created);
            // The draft opens its panel at once, with a reference row for its sources.
            reveal(prepared.id, spot, fresh.width, height, composerNominalHeight(prepared.sources.length));
          } else change(created);
          if (
            controller
              .getSnapshot()
              .local?.document.nodes.some((node) => node.id === prepared.id)
          ) {
            onSelect([prepared.id]);
            setRenamingId(undefined);
            setEditingTextId(undefined);
          }
        } catch (cause) {
          setError(
            cause instanceof Error ? cause : new Error("草稿尚未创建，原来源已保留。"),
          );
        }
      },
    }),
    [change, current, controller, onSelect],
  );
  // The panel writes prompt, model and specification into the document (rule 5).
  const changePrompt = useCallback(
    (id: string, prompt: string) => {
      const doc = current();
      if (!doc) return;
      change(
        {
          ...doc,
          nodes: doc.nodes.map((node) =>
            node.id === id && node.kind !== "text" && node.content.type === "draft"
              ? { ...node, content: { ...node.content, prompt } }
              : node,
          ),
        },
        `prompt:${id}`,
      );
    },
    [change, current],
  );
  const configure = useCallback(
    (
      id: string,
      patch: Pick<Schema<"CanvasDraftContent">, "connectionId" | "capabilityId" | "output">,
    ) => {
      const doc = current();
      const state = controller.getSnapshot();
      if (readOnly || !doc || state.accessChecking || state.phase === "forbidden")
        throw new Error("当前固定输入不可修改。");
      const node = doc.nodes.find((item) => item.id === id);
      if (!node || node.kind === "text" || node.content.type !== "draft")
        throw new Error("原草稿已改变，请重新核对编辑目标。");
      change({
        ...doc,
        nodes: doc.nodes.map((item) =>
          item.id === id ? { ...node, content: { ...node.content, ...patch } } : item,
        ),
      });
    },
    [change, current, controller, readOnly],
  );
  const addReference = useCallback(
    (sourceId: string, targetId: string) => {
      const doc = current();
      const source = doc?.nodes.find((node) => node.id === sourceId);
      if (!doc || !source || readOnly) return;
      change({
        ...doc,
        edges: appendCanvasReference(doc.edges, {
          id: crypto.randomUUID(),
          sourceNodeId: sourceId,
          targetNodeId: targetId,
          enabled: true,
          purpose: defaultPurpose(source),
        }),
      });
    },
    [change, current, readOnly],
  );
  const referencesBySource = useMemo(() => {
    const map = new Map<string, ReferenceEdge[]>();
    for (const edge of document.edges)
      map.set(edge.sourceNodeId, [...(map.get(edge.sourceNodeId) ?? []), edge]);
    return map;
  }, [document.edges]);
  const groupTitles = useMemo(
    () => new Map(document.groups.map((group) => [group.id, group.title])),
    [document.groups],
  );
  const nodes = useMemo<CardNode[]>(
    () =>
      document.nodes.map((node) => ({
        id: node.id,
        type: "card",
        position: node.position,
        width: liveWidths[node.id] ?? node.width,
        data: {
          projectAspect,
          node,
          mediaPath,
          groupTitle: node.groupId ? groupTitles.get(node.groupId) : undefined,
          editingText: editingTextId === node.id,
          renaming: renamingId === node.id,
          readOnly,
          actions,
          references: referencesBySource.get(node.id) ?? [],
          canContinue:
            !readOnly &&
            selected.length === 1 &&
            selectedSet.has(node.id) &&
            validSource(node),
          resultMediaId: results?.[node.id],
          task: tasks[node.id],
        },
        ...(measurements[node.id] ? { measured: measurements[node.id] } : {}),
        selected: selectedSet.has(node.id),
        ariaLabel: node.title,
      })),
    [
      document.nodes,
      mediaPath,
      groupTitles,
      editingTextId,
      renamingId,
      readOnly,
      actions,
      measurements,
      liveWidths,
      selectedSet,
      selected.length,
      referencesBySource,
      results,
      tasks,
    ],
  );
  const shown = useMemo<BoardNode[]>(
    () => [
      ...nodes,
      ...(uploads?.rows ?? []).map(
        (row): UploadNode => ({
          id: `upload:${row.id}`,
          type: "upload",
          data: { row },
          position: row.position,
          width: 320,
          ...(measurements[`upload:${row.id}`] ? { measured: measurements[`upload:${row.id}`] } : {}),
          selectable: false,
          draggable: false,
          connectable: false,
          focusable: false,
        }),
      ),
    ],
    [nodes, uploads?.rows, measurements],
  );
  const selectedEdgeSet = useMemo(() => new Set(selectedEdges), [selectedEdges]);
  // References are edges: selectable, disabled ones dashed; removal is ours.
  const edges = useMemo<Edge[]>(
    () =>
      document.edges.map((edge) => ({
        id: edge.id,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        ariaLabel: `${edge.purpose === "prompt" ? "提示" : referencePurposes[edge.purpose]}${edge.enabled ? "" : " · 已停用"}`,
        ...(edge.enabled ? {} : { className: classes.edgeDisabled! }),
        type: "smoothstep",
        pathOptions: { borderRadius: 16 },
        deletable: false,
        selectable: true,
        focusable: true,
        selected: selectedEdgeSet.has(edge.id),
      })),
    [document.edges, selectedEdgeSet],
  );
  const onEdgesChange = (changes: EdgeChange<Edge>[]) => {
    const selection = new Set(selectedEdges);
    let selecting = false;
    for (const c of changes)
      if (c.type === "select") {
        selecting = true;
        if (c.selected) selection.add(c.id);
        else selection.delete(c.id);
      }
    if (selecting) setSelectedEdges([...selection]);
  };
  const isValidConnection = useCallback<IsValidConnection<Edge>>(
    (candidate) => {
      const doc = current();
      const source = doc?.nodes.find((node) => node.id === candidate.source),
        target = doc?.nodes.find((node) => node.id === candidate.target);
      return (
        !!source &&
        !!target &&
        source.id !== target.id &&
        source.content.type !== "draft" &&
        target.content.type === "draft"
      );
    },
    [current],
  );
  const connect = useCallback(
    (connection: Connection) => {
      setConnecting(false);
      const doc = current();
      const source = doc?.nodes.find((node) => node.id === connection.source);
      if (!doc || !source || readOnly) return;
      try {
        change({
          ...doc,
          edges: appendCanvasReference(doc.edges, {
            id: crypto.randomUUID(),
            sourceNodeId: connection.source,
            targetNodeId: connection.target,
            enabled: true,
            purpose: defaultPurpose(source),
          }),
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause : new Error("引用未添加。"));
      }
    },
    [current, change, readOnly],
  );
  const onConnectStart = useCallback(() => setConnecting(true), []);
  const onConnectEnd = useCallback(() => setConnecting(false), []);
  const editEdge = (
    edgeId: string,
    patch: (edge: ReferenceEdge) => ReferenceEdge | null,
  ) => {
    const doc = current();
    if (!doc || readOnly) return;
    change({
      ...doc,
      edges: doc.edges.flatMap((edge) => {
        if (edge.id !== edgeId) return [edge];
        const next = patch(edge);
        return next ? [next] : [];
      }),
    });
  };
  // These handlers are rebuilt each render. That is safe only because the
  // board never subscribes to React Flow's store (see `onConnectStart` below);
  // a subscription plus fresh handlers would loop the store updater.
  const onNodesChange = (changes: NodeChange<BoardNode>[]) => {
    const dimensions = changes.filter((c) => c.type === "dimensions");
    if (dimensions.length)
      setMeasurements((current) => {
        let next = current;
        for (const { id, dimensions: size } of dimensions) {
          if (
            !size ||
            size.width <= 0 ||
            size.height <= 0 ||
            (current[id]?.width === size.width &&
              current[id]?.height === size.height)
          )
            continue;
          if (next === current) next = { ...current };
          next[id] = size;
        }
        return next;
      });
    const selection = new Set(requestedSelection.current);
    let selecting = false;
    for (const c of changes)
      if (c.type === "select") {
        selecting = true;
        if (c.selected) selection.add(c.id);
        else selection.delete(c.id);
      }
    if (selecting) {
      requestedSelection.current = [...selection];
      onSelect(requestedSelection.current);
    }
    if (readOnly) return;
    const moves = new Map(
      changes.flatMap((c) =>
        c.type === "position" && c.position
          ? [[c.id, c.position] as const]
          : [],
      ),
    );
    if (!moves.size) return;
    const doc = current();
    if (!doc) return;
    // A grouped card carries its group along; groups are a spatial fact only.
    const groupMoves = new Map<string, { x: number; y: number }>();
    for (const [id, position] of moves) {
      const node = doc.nodes.find((n) => n.id === id);
      if (node?.groupId && !groupMoves.has(node.groupId))
        groupMoves.set(node.groupId, {
          x: position.x - node.position.x,
          y: position.y - node.position.y,
        });
    }
    change(
      {
        ...doc,
        nodes: doc.nodes.map((node) => {
          const position = moves.get(node.id),
            delta = node.groupId ? groupMoves.get(node.groupId) : undefined;
          return position
            ? { ...node, position }
            : delta
              ? {
                  ...node,
                  position: {
                    x: node.position.x + delta.x,
                    y: node.position.y + delta.y,
                  },
                }
              : node;
        }),
      },
      "move-nodes",
    );
  };
  /** How tall a card's body is, or would be: measured when React Flow has it, else expected from its frame. */
  const heightOf = (node: CanvasNode) =>
    measurements[node.id]?.height ?? estimateCardHeight(node.kind, node.width, emptyDraftFrame(node, projectAspect));
  /**
   * Where a new card goes: at the given point as it is, or from the centre of
   * the view (and when settling) the nearest free spot around it.
   */
  const freeSpot = (
    doc: CanvasDocument,
    width: number,
    height: number,
    client?: { x: number; y: number },
    settle = false,
  ) => {
    const box = boardElement.current?.getBoundingClientRect();
    const origin = client
      ? flow.screenToFlowPosition(client)
      : box
        ? flow.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
        : { x: 80, y: 80 };
    // The visible board between the top bar and the toolbar, in board coordinates.
    const within = box
      ? (() => {
          const topLeft = flow.screenToFlowPosition({ x: box.left, y: box.top + VISIBLE_BOARD_INSET.top }),
            bottomRight = flow.screenToFlowPosition({ x: box.right, y: box.bottom - VISIBLE_BOARD_INSET.bottom });
          return { x: topLeft.x, y: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y };
        })()
      : undefined;
    return nearestFreeSpot({
      origin,
      width,
      height,
      others:
        client && !settle
          ? []
          : doc.nodes.map((node) => ({ ...node.position, width: node.width, height: heightOf(node) })),
      within,
    });
  };
  /**
   * Bring a new card into view, label row included, by the smallest pan at
   * the same zoom: sideways only as far as puts the card inside the board,
   * up or down only as far as puts its label under the top bar or leaves
   * room under it for a panel of `panelHeight` (a draft opens its input
   * panel below it at once). Only when card and panel cannot both fit at
   * this zoom is the card fitted into view instead.
   */
  const reveal = (
    id: string,
    position: { x: number; y: number },
    width: number,
    height: number,
    panelHeight = 0,
  ) => {
    const box = boardElement.current?.getBoundingClientRect();
    if (!box) return;
    const viewport = flow.getViewport(),
      { zoom } = viewport;
    const topLeft = flow.flowToScreenPosition(position),
      bottomRight = flow.flowToScreenPosition({ x: position.x + width, y: position.y + height });
    const labelTop = topLeft.y - LABEL_HEIGHT * zoom,
      room = panelHeight ? 12 + panelHeight : 0,
      top = box.top + VISIBLE_BOARD_INSET.top,
      bottom = box.bottom - VISIBLE_BOARD_INSET.bottom,
      inset = 12;
    const dx =
      topLeft.x < box.left + inset
        ? box.left + inset - topLeft.x
        : bottomRight.x > box.right - inset
          ? box.right - inset - bottomRight.x
          : 0;
    const dy =
      labelTop < top
        ? top + inset - labelTop
        : bottomRight.y + room > bottom
          ? bottom - (bottomRight.y + room)
          : 0;
    if (!dx && !dy) return;
    if (labelTop + dy < top) {
      // Card and panel do not both fit at this zoom: show the card, at least.
      void flow.fitView({ nodes: [{ id }], padding: 0.4, maxZoom: 1, duration: 200 });
      return;
    }
    void flow.setViewport({ ...viewport, x: viewport.x + dx, y: viewport.y + dy }, { duration: 200 });
  };
  /** A media card for something from the assets panel: read the record first, never trust the drag. */
  const placeMedia = async (item: AssetDrop, client?: { x: number; y: number }) => {
    if (readOnly) return;
    try {
      const media = await api<Schema<"Media">>(`${mediaPath}/media/${item.mediaId}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (media.kind === "document" || media.status !== "ready")
        throw new Error("这份素材还不能放到创作台上。");
      const doc = current();
      if (!doc) return;
      const frame = media.width && media.height ? { width: media.width, height: media.height } : null;
      const width = defaultCardWidth(media.kind, frame);
      const node: CanvasNode = {
        id: crypto.randomUUID(),
        kind: media.kind,
        title: media.displayName.slice(0, 160) || "素材",
        width,
        position: freeSpot(doc, width, estimateCardHeight(media.kind, width, frame), client),
        content: {
          type: "media",
          mediaId: media.id,
          ...(item.assetRevisionId ? { assetRevisionId: item.assetRevisionId } : {}),
        },
      };
      change({ ...doc, nodes: [...doc.nodes, node] });
      onSelect([node.id]);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("素材未加入创作台。"));
    }
  };
  const add = (kind: CanvasNode["kind"]) => {
    const doc = current();
    if (!doc || readOnly) return;
    const frame = kind === "image" || kind === "video" ? projectAspect : null;
    const width = defaultCardWidth(kind, frame),
      height = estimateCardHeight(kind, width, frame);
    const count = doc.nodes.filter((node) => node.kind === kind).length + 1;
    const base = {
      id: crypto.randomUUID(),
      title: `${kindLabel[kind]} ${count}`,
      width,
      position: freeSpot(doc, width, height),
    };
    const node: CanvasNode =
      kind === "text"
        ? { ...base, kind, content: { type: "text", text: "" } }
        : { ...base, kind, content: { type: "draft", prompt: "", output: {} } };
    change({ ...doc, nodes: [...doc.nodes, node] });
    onSelect([node.id]);
    setRenamingId(undefined);
    setEditingTextId(kind === "text" ? node.id : undefined);
    reveal(node.id, node.position, width, height, kind === "text" ? 0 : composerNominalHeight(0));
  };
  const focusBoard = () =>
    boardElement.current?.focus({ preventScroll: true });
  const remove = () => {
    const doc = current();
    if (!doc || readOnly || (!selected.length && !selectedEdges.length))
      return;
    focusBoard();
    change({
      ...doc,
      nodes: doc.nodes.filter((n) => !selectedSet.has(n.id)),
      edges: doc.edges.filter(
        (e) =>
          !selectedEdgeSet.has(e.id) &&
          !selectedSet.has(e.sourceNodeId) &&
          !selectedSet.has(e.targetNodeId),
      ),
    });
    setSelectedEdges([]);
    if (selected.length) onSelect([]);
  };
  const duplicate = () => {
    const doc = current();
    if (!doc || readOnly || !selected.length) return;
    try {
      const result = copyCanvasNodes(doc, selected, COPY_NODE);
      change(result.document);
      onSelect(result.nodeIds);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("未能复制。"));
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      (event.target as HTMLElement).closest(
        "input,textarea,select,[contenteditable=true]",
      )
    )
      return;
    const meta = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (meta && key === "z") {
      event.preventDefault();
      if (readOnly) return;
      if (event.shiftKey) controller.redo();
      else controller.undo();
    } else if (meta && key === "d") {
      event.preventDefault();
      duplicate();
    } else if (meta && key === "a") {
      event.preventDefault();
      onSelect(document.nodes.map((node) => node.id));
    } else if (meta && (key === "=" || key === "+")) {
      event.preventDefault();
      void flow.zoomIn({ duration: 150 });
    } else if (meta && key === "-") {
      event.preventDefault();
      void flow.zoomOut({ duration: 150 });
    } else if (meta && key === "0") {
      event.preventDefault();
      void flow.fitView({ padding: 0.2, duration: 200 });
    } else if (!meta && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      remove();
    } else if (!meta && event.key === "Escape") {
      setEditingTextId(undefined);
      setRenamingId(undefined);
      setMenu(null);
      if (selected.length) onSelect([]);
    } else if (!meta && key === "v") {
      setTool("select");
    } else if (!meta && key === "h") {
      setTool("hand");
    } else if (!meta && event.key === "?") {
      event.preventDefault();
      onShortcuts();
    }
  };
  const dropPoint = (client?: { x: number; y: number }) => {
    const box = boardElement.current?.getBoundingClientRect();
    return flow.screenToFlowPosition(
      client ?? { x: (box?.left ?? 0) + (box?.width ?? 0) / 2, y: (box?.top ?? 0) + (box?.height ?? 0) / 2 },
    );
  };
  const importFiles = (files: File[], client?: { x: number; y: number }) => {
    if (readOnly || !uploads || uploads.readOnly || uploads.busy || !files.length) return;
    uploads.begin(files, dropPoint(client));
  };
  const single =
    selected.length === 1
      ? document.nodes.find((node) => node.id === selected[0])
      : undefined;
  const nodeAttempts = useMemo(
    () => (single ? attempts.filter((entry) => entry.origin.nodeId === single.id) : []),
    [attempts, single],
  );
  /** Drafts with a chosen model are the only ones a batch can fix plans for. */
  const runnable = selectedNodesRunnable(document, selected);
  const selectedNodes = document.nodes.filter((node) => selectedSet.has(node.id));
  const sourcesReady =
    selectedNodes.length > 0 && selectedNodes.every(validSource);
  const menuEdge =
    menu?.kind === "edge"
      ? document.edges.find((edge) => edge.id === menu.edgeId)
      : undefined;
  const menuEdgeSource = menuEdge
    ? document.nodes.find((node) => node.id === menuEdge.sourceNodeId)
    : undefined;
  const purposeChoices: Purpose[] =
    menuEdgeSource?.kind === "text"
      ? ["prompt"]
      : (Object.keys(referencePurposes) as Purpose[]);
  return (
    <div
      ref={boardElement}
      className={classes.board}
      style={docked ? { right: "var(--ws-studio-dock-width)" } : undefined}
      data-tool={tool}
      data-zoom={zoomBand}
      data-connecting={connecting || undefined}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onDragOver={(event) => {
        const types = event.dataTransfer.types;
        if (types.includes(ASSET_DROP_TYPE)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = readOnly ? "none" : "copy";
          return;
        }
        if (!types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect =
          readOnly || !uploads || uploads.readOnly || uploads.busy ? "none" : "copy";
      }}
      onDrop={(event) => {
        const types = event.dataTransfer.types;
        if (types.includes(ASSET_DROP_TYPE)) {
          event.preventDefault();
          try {
            const item = JSON.parse(event.dataTransfer.getData(ASSET_DROP_TYPE)) as AssetDrop;
            if (typeof item?.mediaId === "string")
              void placeMedia(item, { x: event.clientX, y: event.clientY });
          } catch {
            // Not one of ours: nothing to place.
          }
          return;
        }
        if (!types.includes("Files")) return;
        event.preventDefault();
        importFiles([...event.dataTransfer.files], { x: event.clientX, y: event.clientY });
      }}
    >
      {(error || uploads?.error) && (
        <div className={classes.error}>
          <ErrorNotice error={error} />
          <ErrorNotice error={uploads?.error ?? null} {...(uploads?.retry ? { retry: uploads.retry } : {})} />
        </div>
      )}
      <ReactFlow<BoardNode, Edge>
        nodes={shown}
        edges={edges}
        nodeTypes={nodeTypes}
        defaultViewport={viewport}
        minZoom={CANVAS_MIN_ZOOM}
        maxZoom={CANVAS_MAX_ZOOM}
        onMoveEnd={(_, next) => {
          const box = boardElement.current;
          if (!box?.clientWidth || !box.clientHeight) return;
          const legal = constrainCanvasViewport(next);
          if (legal !== next) {
            // setViewport emits the final, legal onMoveEnd; persist only that.
            void flow.setViewport(legal, { duration: 0 });
            return;
          }
          setZoomBand(bandOf(next.zoom));
          onViewport(next);
        }}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={() => void controller.save()}
        isValidConnection={isValidConnection}
        onConnectStart={onConnectStart}
        onConnect={connect}
        onConnectEnd={onConnectEnd}
        onEdgeContextMenu={(event, edge) => {
          event.preventDefault();
          setSelectedEdges([edge.id]);
          setMenu({ x: event.clientX, y: event.clientY, kind: "edge", edgeId: edge.id });
        }}
        onPaneClick={() => {
          setEditingTextId(undefined);
          setRenamingId(undefined);
          setMenu(null);
        }}
        onNodeDoubleClick={(event, node) => {
          if (readOnly || node.type !== "card") return;
          if (
            (event.target as HTMLElement).closest(
              "button,input,textarea,video,audio,media-controller",
            )
          )
            return;
          if (node.data.node.kind === "text" && !node.data.node.content.sourceExcerpt)
            setEditingTextId(node.id);
        }}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          if (node.type !== "card") return;
          if (!selectedSet.has(node.id)) onSelect([node.id]);
          setRenamingId(undefined);
          setMenu({ x: event.clientX, y: event.clientY, kind: "node" });
        }}
        onPaneContextMenu={(event) => {
          event.preventDefault();
          setMenu(null);
        }}
        zoomOnDoubleClick={false}
        nodesDraggable={!readOnly && tool === "select"}
        nodesConnectable={!readOnly}
        connectionRadius={24}
        panActivationKeyCode="Space"
        selectionKeyCode="Shift"
        multiSelectionKeyCode={multiSelectionKeys}
        elementsSelectable={tool === "select"}
        panOnDrag={tool === "hand" ? true : panOnDragButtons}
        panOnScroll
        zoomOnScroll
        zoomOnPinch
        selectionOnDrag={tool === "select"}
        deleteKeyCode={null}
        onlyRenderVisibleElements
        ariaLabelConfig={ariaLabelConfig}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.5}
          className={classes.dots!}
        />
      </ReactFlow>
      <Menu
        opened={!!menu}
        onChange={(opened) => {
          if (!opened) setMenu(null);
        }}
        position="bottom-start"
        shadow="md"
        width={200}
        withinPortal
        returnFocus
      >
        <Menu.Target>
          <div
            className={classes.menuAnchor}
            style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
            aria-hidden
          />
        </Menu.Target>
        {menu?.kind === "edge" && menuEdge ? (
          <Menu.Dropdown>
            <Menu.Label>
              {menuEdgeSource?.title ?? "参考"} → {document.nodes.find((node) => node.id === menuEdge.targetNodeId)?.title ?? "草稿"}
            </Menu.Label>
            <Menu.Sub>
              <Menu.Sub.Target>
                <Menu.Sub.Item leftSection={<Tag size={14} />} disabled={readOnly}>
                  用途 · {menuEdge.purpose === "prompt" ? "提示" : referencePurposes[menuEdge.purpose]}
                </Menu.Sub.Item>
              </Menu.Sub.Target>
              <Menu.Sub.Dropdown>
                {purposeChoices.map((purpose) => (
                  <Menu.Item
                    key={purpose}
                    disabled={readOnly}
                    data-active={purpose === menuEdge.purpose || undefined}
                    onClick={() =>
                      editEdge(menuEdge.id, (edge) => ({ ...edge, purpose }))
                    }
                  >
                    {purpose === "prompt" ? "提示" : referencePurposes[purpose]}
                  </Menu.Item>
                ))}
              </Menu.Sub.Dropdown>
            </Menu.Sub>
            <Menu.Item
              leftSection={<Prohibit size={14} />}
              disabled={readOnly}
              onClick={() =>
                editEdge(menuEdge.id, (edge) => ({ ...edge, enabled: !edge.enabled }))
              }
            >
              {menuEdge.enabled ? "停用" : "启用"}
            </Menu.Item>
            <Menu.Item
              leftSection={<Trash size={14} />}
              rightSection={<kbd className={classes.kbd} aria-hidden>⌫</kbd>}
              disabled={readOnly}
              onClick={() => editEdge(menuEdge.id, () => null)}
            >
              删除
            </Menu.Item>
          </Menu.Dropdown>
        ) : (
          <Menu.Dropdown>
            <Menu.Item
              leftSection={<PencilSimple size={14} />}
              disabled={readOnly || !single}
              onClick={() => single && actions.startRename(single.id)}
            >
              重命名
            </Menu.Item>
            <Menu.Sub>
              <Menu.Sub.Target>
                <Menu.Sub.Item
                  leftSection={<ArrowBendDownRight size={14} />}
                  disabled={readOnly || !sourcesReady}
                >
                  {selected.length > 1 ? "共同作为参考" : "继续创作"}
                </Menu.Sub.Item>
              </Menu.Sub.Target>
              <Menu.Sub.Dropdown>
                <Menu.Item
                  leftSection={<ImageSquare size={14} />}
                  onClick={() => actions.continueWith(selected, "image")}
                >
                  图片
                </Menu.Item>
                <Menu.Item
                  leftSection={<FilmStrip size={14} />}
                  onClick={() => actions.continueWith(selected, "video")}
                >
                  视频
                </Menu.Item>
                <Menu.Item
                  leftSection={<MusicNotes size={14} />}
                  onClick={() => actions.continueWith(selected, "audio")}
                >
                  音频
                </Menu.Item>
              </Menu.Sub.Dropdown>
            </Menu.Sub>
            {single && single.kind === "text" && single.content.sourceExcerpt && (
              <Menu.Item
                leftSection={<Quotes size={14} />}
                component="a"
                href={scriptHref(single.content.sourceExcerpt.scriptRevisionId)}
              >
                回看剧本来源
              </Menu.Item>
            )}
            {single && single.kind === "video" && single.content.type === "media" && (
              <Menu.Item
                leftSection={<FilmStrip size={14} />}
                component="a"
                href={shotsHref(single.content.mediaId)}
              >
                登记为镜头候选
              </Menu.Item>
            )}
            {single && single.kind !== "text" && single.content.type === "draft" && (
              <Menu.Item
                leftSection={<ClockCounterClockwise size={14} />}
                onClick={() => setHistoryId(single.id)}
              >
                尝试与结果{nodeAttempts.length ? ` · ${nodeAttempts.length}` : ""}
              </Menu.Item>
            )}
            {selected.length > 1 && (
              <Menu.Item
                leftSection={<StackSimple size={14} />}
                disabled={readOnly || runnable.length !== selected.length}
                onClick={() => setBatch(runnable)}
              >
                查看 {selected.length} 项的生成计划
              </Menu.Item>
            )}
            <Menu.Item
              leftSection={<Sparkle size={14} />}
              disabled={!selected.length}
              onClick={() => onAssistantContext(selected)}
            >
              交给助手
            </Menu.Item>
            <Menu.Item
              leftSection={<Copy size={14} />}
              rightSection={<kbd className={classes.kbd} aria-hidden>⌘D</kbd>}
              disabled={readOnly}
              onClick={duplicate}
            >
              复制
            </Menu.Item>
            <Menu.Item
              leftSection={<Trash size={14} />}
              rightSection={<kbd className={classes.kbd} aria-hidden>⌫</kbd>}
              disabled={readOnly}
              onClick={remove}
            >
              删除
            </Menu.Item>
          </Menu.Dropdown>
        )}
      </Menu>
      <Toolbar
        readOnly={readOnly}
        tool={tool}
        onTool={setTool}
        onAdd={add}
        onUpload={uploads && !uploads.readOnly ? (files) => importFiles(files) : undefined}
        canUndo={controller.canUndo}
        canRedo={controller.canRedo}
        onUndo={() => controller.undo()}
        onRedo={() => controller.redo()}
        onShortcuts={onShortcuts}
      />
      <ZoomControl assetsOpen={assetPanelOpen} onAssets={() => onAssetPanel(!assetPanelOpen)} />
      {assetPanelOpen && (
        <AssetsPanel
          tenantId={generation.tenantId}
          projectId={generation.projectId}
          mediaPath={mediaPath}
          readOnly={readOnly}
          onAdd={(item) => void placeMedia(item)}
          onClose={() => onAssetPanel(false)}
        />
      )}
      {single && single.kind !== "text" && single.content.type === "draft" && (
        <ComposerAnchor
          key={`${generation.canvasId}:${single.id}`}
          boardElement={boardElement}
          document={document}
          nodeId={single.id}
          references={document.edges
            .filter((edge) => edge.targetNodeId === single.id)
            .map((edge) => edge.sourceNodeId)}
        >
          {(style, docked, panelRef, dragHandle) => (
            <Composer
              {...generation}
              node={single as ComposerProps["node"]}
              document={document}
              readOnly={readOnly}
              mediaPath={mediaPath}
              changePrompt={changePrompt}
              configure={configure}
              addReference={addReference}
              editEdge={editEdge}
              attempts={nodeAttempts}
              onOpenHistory={() => setHistoryId(single.id)}
              focused={focusedPanel}
              onFocusChange={setFocusedPanel}
              onFocusNodes={onSelect}
              style={style}
              docked={docked}
              panelRef={panelRef}
              dragHandle={dragHandle}
            />
          )}
        </ComposerAnchor>
      )}
      {historyId && (
        <History
          tenantId={generation.tenantId}
          title={document.nodes.find((node) => node.id === historyId)?.title ?? "已删除的草稿"}
          attempts={attempts.filter((entry) => entry.origin.nodeId === historyId)}
          opened
          onClose={() => setHistoryId(undefined)}
        />
      )}
      {batch && controller.getSnapshot().local && (
        <CanvasGenerationBatch
          tenantId={generation.tenantId}
          projectId={generation.projectId}
          sceneId={generation.sceneId}
          canvasId={generation.canvasId}
          canvasRevision={controller.getSnapshot().local!.base.revision}
          document={document}
          nodeIds={batch}
          readOnly={readOnly}
          close={() => setBatch(undefined)}
        />
      )}
    </div>
  );
}

/**
 * Screen placement of the input panel: below the card, left-aligned, or
 * another side when that is taken; docked at the bottom-left when the card is off
 * screen or the board too small; where the user dragged it, for this card,
 * once they have. Re-evaluated on every viewport change.
 */
function ComposerAnchor({
  boardElement,
  document,
  nodeId,
  references,
  children,
}: {
  boardElement: React.RefObject<HTMLDivElement | null>;
  document: CanvasDocument;
  nodeId: string;
  references: string[];
  children: (
    style: React.CSSProperties | undefined,
    docked: boolean,
    panelRef: (element: HTMLElement | null) => void,
    dragHandle: ComposerDragHandle,
  ) => React.ReactNode;
}) {
  const { x, y, zoom } = useViewport();
  const flow = useReactFlow<CardNode>();
  // The panel's real size, once it has been measured; until then it is placed
  // by the nominal size and kept invisible, so the first visible position is
  // the one its true height allows and no guessed side sticks.
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [board, setBoard] = useState({ width: 0, height: 0 });
  const previous = useRef<ComposerPlacement | undefined>(undefined);
  // Where the user dragged the panel to, as its offset from the card. Kept for
  // this card only: the next card selected starts from the algorithm again.
  const [pinned, setPinned] = useState<{ dx: number; dy: number }>();
  const latest = useRef<{ anchor: ScreenRect; rect: ScreenRect } | undefined>(undefined);
  // The card's rectangle at the last render: while it is changing from one
  // render to the next (a pan, an animation bringing a new card into view),
  // no placement is recorded as "previous", so a side chosen mid-motion never
  // sticks; the first still render records the placement the settled position
  // gets.
  const lastAnchor = useRef<ScreenRect | undefined>(undefined);
  const drag = useRef<{ pointerId: number; x: number; y: number; rect: ScreenRect } | undefined>(undefined);
  const dragHandle = useMemo<ComposerDragHandle>(
    () => ({
      onPointerDown: (event) => {
        if (event.button !== 0 || !latest.current) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, rect: latest.current.rect };
      },
      onPointerMove: (event) => {
        const start = drag.current;
        if (!start || start.pointerId !== event.pointerId || !latest.current) return;
        setPinned({
          dx: start.rect.x + event.clientX - start.x - latest.current.anchor.x,
          dy: start.rect.y + event.clientY - start.y - latest.current.anchor.y,
        });
      },
      onPointerUp: (event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current = undefined;
        // Keep the offset the panel actually got, not the one the pointer asked
        // for: after an overshoot at an edge it must move with the card again.
        if (latest.current)
          setPinned({
            dx: latest.current.rect.x - latest.current.anchor.x,
            dy: latest.current.rect.y - latest.current.anchor.y,
          });
      },
      onPointerCancel: (event) => {
        if (drag.current?.pointerId === event.pointerId) drag.current = undefined;
      },
    }),
    [],
  );
  useEffect(() => {
    const element = boardElement.current;
    if (!element) return;
    const measure = () =>
      setBoard({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [boardElement]);
  const panelObserver = useRef<ResizeObserver | null>(null);
  const panelRef = useCallback((element: HTMLElement | null) => {
    panelObserver.current?.disconnect();
    panelObserver.current = null;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const next = { width: element.offsetWidth, height: element.offsetHeight };
      // A panel not laid out yet reports 0; that is not a measurement.
      if (!(next.width > 0 && next.height > 0)) return;
      setSize((current) =>
        current && current.width === next.width && current.height === next.height ? current : next,
      );
    });
    observer.observe(element);
    panelObserver.current = observer;
  }, []);
  const rectOf = (id: string): ScreenRect | undefined => {
    const internal = flow.getInternalNode(id);
    const node = document.nodes.find((item) => item.id === id);
    if (!internal || !node) return undefined;
    const position = internal.internals.positionAbsolute;
    return {
      x: position.x * zoom + x,
      y: position.y * zoom + y,
      width: (internal.measured.width ?? node.width) * zoom,
      height: (internal.measured.height ?? 200) * zoom,
    };
  };
  const anchor = rectOf(nodeId);
  if (!anchor || !board.width) return null;
  const settled =
    !!lastAnchor.current &&
    lastAnchor.current.x === anchor.x &&
    lastAnchor.current.y === anchor.y &&
    lastAnchor.current.width === anchor.width &&
    lastAnchor.current.height === anchor.height;
  lastAnchor.current = anchor;
  const placement = placeComposer({
    anchor,
    safe: composerSafeArea(board.width, board.height),
    references: references.flatMap((id) => rectOf(id) ?? []),
    avoid: document.nodes.flatMap((node) =>
      node.id === nodeId || references.includes(node.id) ? [] : (rectOf(node.id) ?? []),
    ),
    previous: previous.current,
    pinned,
    size: size ?? COMPOSER_SIZE,
  });
  if (size) {
    if (settled) previous.current = placement;
    latest.current = placement.kind === "local" ? { anchor, rect: placement.rect } : undefined;
  }
  const unmeasured = size ? {} : { visibility: "hidden" as const };
  return children(
    placement.kind === "local"
      ? { left: placement.rect.x, top: placement.rect.y, ...unmeasured }
      : size
        ? undefined
        : unmeasured,
    placement.kind !== "local",
    panelRef,
    dragHandle,
  );
}

/** The board minus the top bar and the bottom toolbar, in screen pixels (see `composerSafeArea`). */
const VISIBLE_BOARD_INSET = { top: 60, bottom: 76 } as const;
/** The card's label row: 22px sitting above the body (`.label` in board.module.css) plus its gap. */
const LABEL_HEIGHT = 24;

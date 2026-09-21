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
  type Connection,
  type Edge,
  type EdgeChange,
  type IsValidConnection,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import {
  ArrowBendDownRight,
  Copy,
  FilmStrip,
  ImageSquare,
  MusicNotes,
  PencilSimple,
  Prohibit,
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
import { Card, type CardActions, type CardNode } from "./Card";
import { Toolbar, type BoardTool } from "../shell/Toolbar";
import { ZoomControl } from "../shell/ZoomControl";
import classes from "./board.module.css";

const nodeTypes = { card: Card };
const kindLabel = { text: "文字", image: "图片", video: "视频", audio: "音频" };
// Constant props for React Flow: a new identity per render would make its
// store updater write on every render, and any store subscriber in this
// component would then re-render it again without end.
const ariaLabelConfig = {
  "node.a11yDescription.default": "按方向键移动卡片，按回车选中。",
};
const panOnDragButtons = [1, 2];
type ReferenceEdge = CanvasDocument["edges"][number];
type Purpose = ReferenceEdge["purpose"];
/** A card that can feed a draft: text with something in it, or existing media. */
const validSource = (node: CanvasNode) =>
  node.content.type === "media" ||
  (node.kind === "text" && node.content.text.trim() !== "");
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
  viewport,
  onViewport,
  mediaPath,
  onShortcuts,
}: {
  controller: CanvasController;
  document: CanvasDocument;
  readOnly: boolean;
  selected: string[];
  onSelect: (ids: string[]) => void;
  viewport: { x: number; y: number; zoom: number };
  onViewport: (viewport: { x: number; y: number; zoom: number }) => void;
  mediaPath: string;
  onShortcuts: () => void;
}) {
  const flow = useReactFlow<CardNode, Edge>();
  const boardElement = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<BoardTool>("select");
  const [error, setError] = useState<Error | null>(null);
  const [editingTextId, setEditingTextId] = useState<string>();
  const [renamingId, setRenamingId] = useState<string>();
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
  const [menu, setMenu] = useState<
    { x: number; y: number; kind: "node" } | { x: number; y: number; kind: "edge"; edgeId: string } | null
  >(null);
  const [connecting, setConnecting] = useState(false);
  // React Flow needs measured sizes on controlled nodes; they are view state only.
  const [measurements, setMeasurements] = useState<
    Record<string, { width: number; height: number }>
  >({});
  // A width being dragged, before the document takes it on resize end.
  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({});
  useEffect(() => {
    const ids = new Set(document.nodes.map((node) => node.id));
    setMeasurements((current) =>
      Object.keys(current).every((id) => ids.has(id))
        ? current
        : Object.fromEntries(
            Object.entries(current).filter(([id]) => ids.has(id)),
          ),
    );
    if (editingTextId && !ids.has(editingTextId)) setEditingTextId(undefined);
    if (renamingId && !ids.has(renamingId)) setRenamingId(undefined);
  }, [document.nodes, editingTextId, renamingId]);
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
          change(createCanvasDraft(doc, prepared, kind));
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
    ],
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
  const onNodesChange = (changes: NodeChange<CardNode>[]) => {
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
    const selection = new Set(selected);
    let selecting = false;
    for (const c of changes)
      if (c.type === "select") {
        selecting = true;
        if (c.selected) selection.add(c.id);
        else selection.delete(c.id);
      }
    if (selecting) onSelect([...selection]);
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
  const add = (kind: CanvasNode["kind"]) => {
    const doc = current();
    if (!doc || readOnly) return;
    const box = boardElement.current?.getBoundingClientRect();
    const center = box
      ? flow.screenToFlowPosition({
          x: box.left + box.width / 2,
          y: box.top + box.height / 2,
        })
      : { x: 80, y: 80 };
    const width = kind === "text" ? 320 : 360;
    const count = doc.nodes.filter((node) => node.kind === kind).length + 1;
    // Start at the centre of the view; while the frame would cover another
    // card, move to that card's right, so cards added in a row line up.
    const height = 200;
    const position = {
      x: Math.round(center.x - width / 2),
      y: Math.round(center.y - height / 2),
    };
    const covered = () =>
      doc.nodes.find((node) => {
        const other = measurements[node.id]?.height ?? height;
        return (
          position.x < node.position.x + node.width + 24 &&
          node.position.x < position.x + width + 24 &&
          position.y < node.position.y + other + 24 &&
          node.position.y < position.y + height + 24
        );
      });
    for (let step = 0, hit = covered(); step < 50 && hit; step++, hit = covered())
      position.x = hit.position.x + hit.width + 48;
    const base = {
      id: crypto.randomUUID(),
      title: `${kindLabel[kind]} ${count}`,
      width,
      position,
    };
    const node: CanvasNode =
      kind === "text"
        ? { ...base, kind, content: { type: "text", text: "" } }
        : { ...base, kind, content: { type: "draft", prompt: "", output: {} } };
    change({ ...doc, nodes: [...doc.nodes, node] });
    onSelect([node.id]);
    setRenamingId(undefined);
    setEditingTextId(kind === "text" ? node.id : undefined);
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
  const single =
    selected.length === 1
      ? document.nodes.find((node) => node.id === selected[0])
      : undefined;
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
      data-tool={tool}
      data-connecting={connecting || undefined}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {error && (
        <div className={classes.error}>
          <ErrorNotice error={error} />
        </div>
      )}
      <ReactFlow<CardNode, Edge>
        nodes={nodes}
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
          if (readOnly) return;
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
        canUndo={controller.canUndo}
        canRedo={controller.canRedo}
        onUndo={() => controller.undo()}
        onRedo={() => controller.redo()}
        onShortcuts={onShortcuts}
      />
      <ZoomControl />
    </div>
  );
}

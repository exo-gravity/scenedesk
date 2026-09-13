import {
  CANVAS_MIN_ZOOM,
  CANVAS_MAX_ZOOM,
  canvasZoomLabel,
  constrainCanvasViewport,
} from "./canvas-viewport";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import {
  Background,
  useNodesInitialized,
  useReactFlow,
  useViewport,
  useStore,
  Handle,
  Position,
  ReactFlow,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  type NodeChange,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import {
  Alert,
  Button,
  FileButton,
  Group,
  Menu,
  NumberInput,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  ArrowCounterClockwise,
  ArrowClockwise,
  CornersOut,
  Crosshair,
  Hand,
  Cursor,
  TextT,
  ImageSquare,
  FilmStrip,
  MusicNotes,
  Copy,
  Trash,
  SelectionAll,
  Plus,
} from "@phosphor-icons/react";
import {
  inspectCanvasDocument,
  type CanvasDocument,
  type CanvasNode,
} from "@drama/domain";
import type { CanvasController } from "./canvas-controller";
import { useResource, type Schema } from "./api";
import { MediaPreview } from "./MediaPreview";
import { referencePurposes, options } from "./asset-queries";
import { appendCanvasReference } from "./canvas-reference";
import { ErrorNotice } from "./common";
import classes from "./canvas.module.css";
import { CanvasContinueCreation } from "./CanvasContinueCreation";
import {
  CanvasUploadSummary,
  useCanvasUploads,
  type CanvasUploadRow,
} from "./CanvasUploads";
import { importAccept } from "./media-imports";

type Preference = Schema<"SaveSceneWorkspacePreference">;
type CanvasFlowNode = Node<
  {
    node: CanvasNode;
    mediaPath: string;
    playing: boolean;
    play: (id: string) => void;
  },
  "canvas"
>;
type UploadFlowNode = Node<{ row: CanvasUploadRow }, "upload">;
type FlowNode = CanvasFlowNode | UploadFlowNode;
const CanvasNodeView = memo(function CanvasNodeView({
  data,
  selected,
}: NodeProps<CanvasFlowNode>) {
  const node = data.node;
  return (
    <article
      className={classes.node}
      data-selected={selected || undefined}
      data-content={node.content.type}
      aria-label={`${node.title} · ${node.kind}`}
    >
      <div className={`${classes.nodeHeader} canvas-drag-handle`}>
        <Text component="span" fw={600}>
          {node.title}
        </Text>
        <Text size="xs" c="dimmed">
          {node.content.type === "draft"
            ? "草稿"
            : { text: "文字", image: "图片", video: "视频", audio: "音频" }[
                node.kind
              ]}
        </Text>
      </div>
      {node.content.type === "text" ? (
        <div className={`${classes.nodeContent} nodrag nowheel`}>
          {node.content.text || "选择后输入文字"}
        </div>
      ) : node.content.type === "draft" ? (
        <div className={classes.draft}>
          <Text className={classes.prose} lineClamp={5}>
            {node.content.prompt || "选择后描述想要的内容"}
          </Text>
          <Text size="xs" c="dimmed">
            尚未生成
          </Text>
        </div>
      ) : (
        <NodeMedia
          width={node.width}
          mediaId={node.content.mediaId}
          path={data.mediaPath}
          playing={data.playing}
          play={() => data.play(node.id)}
        />
      )}
      <Handle
        className={classes.handle}
        type={node.content.type === "draft" ? "target" : "source"}
        position={
          node.content.type === "draft" ? Position.Left : Position.Right
        }
        aria-label={node.content.type === "draft" ? "接收参考" : "作为参考"}
      />
    </article>
  );
});
function NodeMedia({
  width,
  mediaId,
  path,
  playing,
  play,
}: {
  width: number;
  mediaId: string;
  path: string;
  playing: boolean;
  play: () => void;
}) {
  const media = useResource<Schema<"Media">>(`${path}/media/${mediaId}`);
  return (
    <div
      className={`${classes.nodeMedia} nodrag nopan`}
      style={
        {
          "--ws-node-media-height": `${media.data?.width && media.data.height ? (width * media.data.height) / media.data.width : 180}px`,
        } as CSSProperties
      }
    >
      {media.data ? (
        <>
          <MediaPreview media={media.data} path={path} thumbnail={!playing} />
          <Group justify="space-between" mt="xs">
            <Text size="xs">
              {media.data.status === "archived"
                ? "已归档 · 原有引用"
                : media.data.displayName}
            </Text>
            {["video", "audio"].includes(media.data.kind) && (
              <Button size="xs" onClick={play}>
                {playing ? "收起播放器" : "播放预览"}
              </Button>
            )}
          </Group>
        </>
      ) : (
        <Text>{media.isError ? "素材不可访问或已失效" : "正在读取素材…"}</Text>
      )}
    </div>
  );
}
const UploadNodeView = memo(function UploadNodeView({
  data,
}: NodeProps<UploadFlowNode>) {
  return (
    <article
      className={`${classes.node} ${classes.uploadNode}`}
      aria-label={`${data.row.title} · 上传状态`}
    >
      <CanvasUploadSummary row={data.row} />
    </article>
  );
});
const nodeTypes = { canvas: CanvasNodeView, upload: UploadNodeView };
export function CanvasBoard({
  controller,
  document,
  preference,
  changePreference,
  mediaPath,
  readOnly,
  addMedia,
  nodeActions,
  generation,
  focusRequest,
  focusCompleted,
}: {
  controller: CanvasController;
  document: CanvasDocument;
  preference: Preference;
  changePreference: (patch: Partial<Preference>) => void;
  mediaPath: string;
  readOnly: boolean;
  addMedia: () => void;
  nodeActions?: ReactNode;
  generation?: ReactNode;
  focusRequest?: { ids: string[]; nonce: number } | undefined;
  focusCompleted: (nonce: number) => void;
}) {
  const uploads = useCanvasUploads();
  const [hand, setHand] = useState(false),
    [playing, setPlaying] = useState<string | null>(null),
    [error, setError] = useState<Error | null>(null),
    [query, setQuery] = useState(""),
    [listExpanded, setListExpanded] = useState(false),
    [groupsExpanded, setGroupsExpanded] = useState(false);
  const [addPoint, setAddPoint] = useState<{
    screen: { x: number; y: number };
    canvas: { x: number; y: number };
  } | null>(null);
  const [localFocus, setLocalFocus] = useState(focusRequest);
  useEffect(() => setLocalFocus(focusRequest), [focusRequest]);
  const finishFocus = useCallback(
    (nonce: number) => {
      setLocalFocus((current) =>
        current?.nonce === nonce ? undefined : current,
      );
      focusCompleted(nonce);
    },
    [focusCompleted],
  );
  // React Flow requires measured dimensions on controlled nodes. Keep them in
  // this view only; selection must not reset measurement or write layout facts.
  const [measurements, setMeasurements] = useState<
    Record<string, { width: number; height: number }>
  >({});
  useEffect(() => {
    const ids = new Set([
      ...document.nodes.map((node) => node.id),
      ...(uploads?.rows ?? []).map((row) => `upload:${row.id}`),
    ]);
    setMeasurements((current) => {
      if (Object.keys(current).every((id) => ids.has(id))) return current;
      return Object.fromEntries(
        Object.entries(current).filter(([id]) => ids.has(id)),
      );
    });
  }, [document.nodes, uploads?.rows]);
  const narrow = useMediaQuery("(max-width: 760px)"),
    flow = useRef<ReactFlowInstance<FlowNode> | null>(null);
  const showNodeList = narrow || listExpanded;
  const showGroups =
    groupsExpanded ||
    Object.keys(controller.getSnapshot().local?.buffers ?? {}).some((key) =>
      key.startsWith("group:"),
    );
  const play = useCallback(
    (id: string) => setPlaying((old) => (old === id ? null : id)),
    [],
  );
  const selected = preference.selectedNodeIds.filter((id) =>
    document.nodes.some((n) => n.id === id),
  );
  const selectedSet = new Set(selected);
  const active =
    selected.length === 1
      ? document.nodes.find((n) => n.id === selected[0])
      : undefined;
  const nodes = useMemo<CanvasFlowNode[]>(
    () =>
      document.nodes.map((node) => ({
        id: node.id,
        type: "canvas",
        data: { node, mediaPath, playing: playing === node.id, play },
        position: node.position,
        width: node.width,
        ...(measurements[node.id] ? { measured: measurements[node.id] } : {}),
        selected: preference.selectedNodeIds.includes(node.id),
        dragHandle: ".canvas-drag-handle",
        ariaLabel: node.title,
      })),
    [
      document.nodes,
      mediaPath,
      playing,
      play,
      preference.selectedNodeIds,
      measurements,
    ],
  );
  const displayedNodes: FlowNode[] = [
    ...nodes,
    ...(uploads?.rows ?? []).map((row): UploadFlowNode => ({
      id: `upload:${row.id}`,
      type: "upload",
      data: { row },
      position: row.position,
      width: 320,
      ...(measurements[`upload:${row.id}`]
        ? { measured: measurements[`upload:${row.id}`] }
        : {}),
      selectable: false,
      draggable: false,
      connectable: false,
      focusable: false,
    })),
  ];
  const edges = useMemo(
    () =>
      document.edges.map((edge) => ({
        id: edge.id,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        label:
          edge.purpose === "prompt" ? "提示" : referencePurposes[edge.purpose],
        style: { opacity: edge.enabled ? 1 : 0.35 },
        deletable: false,
        focusable: true,
      })),
    [document.edges],
  );
  const change = (next: CanvasDocument, group?: string) => {
    if (readOnly) return;
    try {
      inspectCanvasDocument(next);
      controller.change(next, group);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error("画布变更未完成。"));
    }
  };
  function add(kind: CanvasNode["kind"], point?: { x: number; y: number }) {
    const visible = point ??
      flow.current?.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      }) ?? { x: 80, y: 80 };
    const node: CanvasNode =
      kind === "text"
        ? {
            id: crypto.randomUUID(),
            title: "创作笔记",
            kind,
            content: { type: "text", text: "" },
            width: 320,
            position: visible,
          }
        : {
            id: crypto.randomUUID(),
            title: `${{ image: "图片", video: "视频", audio: "音频" }[kind]}草稿`,
            kind,
            content: { type: "draft", prompt: "", output: {} },
            width: 360,
            position: visible,
          };
    change({ ...document, nodes: [...document.nodes, node] });
    changePreference({ selectedNodeIds: [node.id] });
  }
  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
    const dimensions = changes.filter((c) => c.type === "dimensions");
    if (dimensions.length)
      setMeasurements((current) => {
        let next = current;
        for (const { id, dimensions: size } of dimensions) {
          if (
            !size ||
            (current[id]?.width === size.width &&
              current[id]?.height === size.height)
          )
            continue;
          if (next === current) next = { ...current };
          next[id] = size;
        }
        return next;
      });
    const selection = new Set(preference.selectedNodeIds);
    let selecting = false;
    for (const c of changes)
      if (c.type === "select") {
        selecting = true;
        if (c.selected) selection.add(c.id);
        else selection.delete(c.id);
      }
    if (selecting) changePreference({ selectedNodeIds: [...selection] });
    if (readOnly) return;
    const moves = new Map(
      changes.flatMap((c) =>
        c.type === "position" && c.position
          ? [[c.id, c.position] as const]
          : [],
      ),
    );
    if (!moves.size) return;
    const groupMoves = new Map<string, { x: number; y: number }>();
    for (const [id, position] of moves) {
      const node = document.nodes.find((n) => n.id === id);
      if (node?.groupId && !groupMoves.has(node.groupId))
        groupMoves.set(node.groupId, {
          x: position.x - node.position.x,
          y: position.y - node.position.y,
        });
    }
    change(
      {
        ...document,
        nodes: document.nodes.map((node) => {
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
  const connect = (connection: Connection) => {
    const source = document.nodes.find((n) => n.id === connection.source);
    if (!source) return;
    try {
      change({
        ...document,
        edges: appendCanvasReference(document.edges, {
          id: crypto.randomUUID(),
          sourceNodeId: connection.source,
          targetNodeId: connection.target,
          enabled: true,
          purpose:
            source.kind === "text"
              ? "prompt"
              : source.kind === "audio"
                ? "voice"
                : "composition",
        }),
      });
    } catch (e) {
      setError(e instanceof Error ? e : new Error("引用未添加。"));
    }
  };
  const remove = () => {
    change({
      ...document,
      nodes: document.nodes.filter((n) => !selectedSet.has(n.id)),
      edges: document.edges.filter(
        (e) =>
          !selectedSet.has(e.sourceNodeId) && !selectedSet.has(e.targetNodeId),
      ),
    });
    changePreference({ selectedNodeIds: [] });
  };
  const duplicate = () => {
    const copies = document.nodes
      .filter((n) => selectedSet.has(n.id))
      .map((n) => ({
        ...n,
        id: crypto.randomUUID(),
        title: `${n.title.slice(0, 154)} 副本`,
        position: { x: n.position.x + 48, y: n.position.y + 48 },
      }));
    change({ ...document, nodes: [...document.nodes, ...copies] });
    changePreference({ selectedNodeIds: copies.map((n) => n.id) });
  };
  const focus = (ids: string[]) => {
    changePreference({ selectedNodeIds: ids });
    setLocalFocus({ ids, nonce: Date.now() });
  };
  const addItems = (point?: { x: number; y: number }) => {
    const choose = (kind: CanvasNode["kind"]) => {
      add(kind, point);
      setAddPoint(null);
    };
    return (
      <>
        <Menu.Item
          leftSection={<TextT size={16} />}
          disabled={readOnly}
          onClick={() => choose("text")}
        >
          文字
        </Menu.Item>
        <Menu.Item
          leftSection={<ImageSquare size={16} />}
          disabled={readOnly}
          onClick={() => choose("image")}
        >
          图片草稿
        </Menu.Item>
        <Menu.Item
          leftSection={<FilmStrip size={16} />}
          disabled={readOnly}
          onClick={() => choose("video")}
        >
          视频草稿
        </Menu.Item>
        <Menu.Item
          leftSection={<MusicNotes size={16} />}
          disabled={readOnly}
          onClick={() => choose("audio")}
        >
          声音草稿
        </Menu.Item>
        <Menu.Item disabled={readOnly} onClick={addMedia}>
          添加素材
        </Menu.Item>
        {uploads && (
          <FileButton
            multiple
            accept={importAccept}
            onChange={(files) => {
              uploads.begin(
                files,
                point ??
                  flow.current?.screenToFlowPosition({
                    x: window.innerWidth / 2,
                    y: window.innerHeight / 2,
                  }) ?? { x: 80, y: 80 },
              );
              setAddPoint(null);
            }}
          >
            {(props) => (
              <Menu.Item
                {...props}
                closeMenuOnClick={false}
                disabled={readOnly || uploads.readOnly || uploads.busy}
              >
                上传文件
              </Menu.Item>
            )}
          </FileButton>
        )}
      </>
    );
  };
  const viewportTools = (
    <Group
      className={classes.viewportTools}
      gap={4}
      wrap="nowrap"
      aria-label="画布视口工具"
    >
      <Group gap="xs">
        <Button
          size="xs"
          aria-label="撤销画布编辑"
          disabled={readOnly || !controller.canUndo}
          onClick={() => controller.undo()}
        >
          <ArrowCounterClockwise size={16} />
        </Button>
        <Button
          size="xs"
          aria-label="重做画布编辑"
          disabled={readOnly || !controller.canRedo}
          onClick={() => controller.redo()}
        >
          <ArrowClockwise size={16} />
        </Button>
        <Button
          size="xs"
          aria-pressed={hand}
          onClick={() => setHand(!hand)}
          aria-label={hand ? "手形" : "选择"}
          title={hand ? "手形" : "选择"}
        >
          {hand ? <Hand size={16} /> : <Cursor size={16} />}
        </Button>
        <Button
          size="xs"
          aria-label="缩小画布"
          onClick={() => void flow.current?.zoomOut()}
        >
          −
        </Button>
        <Button
          size="xs"
          aria-label="画布缩放到百分之百"
          onClick={() => void flow.current?.zoomTo(1)}
        >
          100%
        </Button>
        <Button
          size="xs"
          aria-label="放大画布"
          onClick={() => void flow.current?.zoomIn()}
        >
          ＋
        </Button>
        <Button
          size="xs"
          disabled={!selected.length}
          onClick={() => focus(selected)}
          aria-label="定位当前内容"
          title="定位当前内容"
        >
          <Crosshair size={16} />
        </Button>
        <Button
          size="xs"
          aria-label="适应内容"
          title="适应内容"
          onClick={() =>
            void flow.current?.fitView({
              padding: 0.2,
              minZoom: CANVAS_MIN_ZOOM,
              maxZoom: 1,
            })
          }
        >
          <CornersOut size={16} />
        </Button>
      </Group>
      <Text
        size="xs"
        className={classes.canvasCount}
        title={`${document.nodes.length} / 2,000 节点 · ${document.edges.length} / 5,000 引用 · 缩放 ${canvasZoomLabel(preference.viewport.zoom)}`}
      >
        {document.nodes.length} 项
      </Text>
      <Menu position="top-start" keepMounted>
        <Menu.Target>
          <Button size="xs" leftSection={<Plus size={16} />}>
            添加
          </Button>
        </Menu.Target>
        <Menu.Dropdown>{addItems()}</Menu.Dropdown>
      </Menu>
    </Group>
  );
  const selectionActions = (
    <Group gap="xs">
      <Text
        size="xs"
        fw={600}
        className={classes.selectionName}
        title={active ? `已选：${active.title}` : `已选 ${selected.length} 项`}
      >
        {active ? `已选 · ${active.title}` : `已选 ${selected.length} 项`}
      </Text>
      <CanvasContinueCreation
        controller={controller}
        selected={selected}
        readOnly={readOnly}
        focus={focus}
      />
      <Button
        size="xs"
        disabled={!selected.length || readOnly}
        leftSection={<Copy size={14} />}
        onClick={duplicate}
      >
        复制
      </Button>
      <Button
        size="xs"
        disabled={!selected.length || readOnly}
        leftSection={<Trash size={14} />}
        onClick={remove}
      >
        移除节点
      </Button>
      {selected.length > 1 && (
        <Button
          size="xs"
          disabled={readOnly}
          leftSection={<SelectionAll size={14} />}
          onClick={() => {
            const id = crypto.randomUUID();
            change({
              ...document,
              groups: [
                ...document.groups,
                { id, title: `分组 ${document.groups.length + 1}` },
              ],
              nodes: document.nodes.map((n) =>
                selectedSet.has(n.id) ? { ...n, groupId: id } : n,
              ),
            });
          }}
        >
          组合
        </Button>
      )}
    </Group>
  );
  return (
    <div
      className={classes.board}
      onKeyDown={(e) => {
        if (
          readOnly ||
          (e.target as HTMLElement).closest(
            "input,textarea,select,[contenteditable=true]",
          )
        )
          return;
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
          e.preventDefault();
          if (e.shiftKey) controller.redo();
          else controller.undo();
        }
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          remove();
        }
      }}
    >
      <ErrorNotice error={error} />
      {narrow ? (
        <div className={classes.empty}>
          <Text>窄屏以列表查看内容；完整空间制作请使用桌面宽度。</Text>
          {viewportTools}
        </div>
      ) : (
        <div
          className={classes.flow}
          data-editing={!!active || undefined}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files")) {
              event.preventDefault();
              event.dataTransfer.dropEffect =
                readOnly || uploads?.readOnly || uploads?.busy
                  ? "none"
                  : "copy";
            }
          }}
          onDrop={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            if (readOnly || uploads?.readOnly || uploads?.busy) return;
            uploads?.begin(
              [...event.dataTransfer.files],
              flow.current?.screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
              }) ?? { x: 80, y: 80 },
            );
          }}
        >
          <ReactFlow<FlowNode>
            nodes={displayedNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onInit={(instance) => {
              flow.current = instance;
            }}
            defaultViewport={preference.viewport}
            minZoom={CANVAS_MIN_ZOOM}
            maxZoom={CANVAS_MAX_ZOOM}
            onMoveEnd={(_, viewport) => {
              const legal = constrainCanvasViewport(viewport);
              if (legal !== viewport) {
                // setViewport emits the final, legal onMoveEnd. Persist only
                // that event so the saved view matches the visible position.
                void flow.current?.setViewport(legal, { duration: 0 });
                return;
              }
              changePreference({ viewport });
            }}
            onNodesChange={onNodesChange}
            onNodeDragStop={() => void controller.save()}
            onConnect={connect}
            onPaneClick={(e) => {
              if (e.detail === 2 && !readOnly) {
                setAddPoint({
                  screen: { x: e.clientX, y: e.clientY },
                  canvas: flow.current?.screenToFlowPosition({
                    x: e.clientX,
                    y: e.clientY,
                  }) ?? { x: 80, y: 80 },
                });
              }
            }}
            zoomOnDoubleClick={false}
            nodesDraggable={!readOnly && !hand}
            nodesConnectable={!readOnly}
            elementsSelectable={!hand}
            panOnDrag={hand ? true : [1, 2]}
            panOnScroll
            selectionOnDrag={!hand}
            deleteKeyCode={null}
            onlyRenderVisibleElements
            ariaLabelConfig={{
              "node.a11yDescription.default": "按方向键移动节点，按回车选中。",
              "controls.fitView.ariaLabel": "适应全部内容",
            }}
          >
            <MeasuredCanvasFocus request={localFocus} complete={finishFocus} />
            <CanvasSelectionTools
              nodes={nodes.filter((node) => selectedSet.has(node.id))}
            >
              {selectionActions}
            </CanvasSelectionTools>
            <Background color="var(--ws-canvas-dot)" gap={24} size={1} />
          </ReactFlow>
          {viewportTools}
          {addPoint && (
            <Menu
              opened
              onChange={(opened) => {
                if (!opened) setAddPoint(null);
              }}
              position="bottom-start"
              withinPortal
            >
              <Menu.Target>
                <UnstyledButton
                  aria-label="在此添加内容"
                  className={classes.pointAnchor}
                  style={{ left: addPoint.screen.x, top: addPoint.screen.y }}
                />
              </Menu.Target>
              <Menu.Dropdown>{addItems(addPoint.canvas)}</Menu.Dropdown>
            </Menu>
          )}
          {!document.nodes.length && (
            <div className={classes.canvasStart}>
              <Text className={classes.startEyebrow}>自由画布</Text>
              <Text className={classes.startTitle}>一个想法，从这里展开</Text>
              <Text size="sm" c="dimmed">
                放入参考，写下灵感，再逐步创作这一场的画面与声音。
              </Text>
              <Group justify="center" gap="sm">
                <Button
                  disabled={readOnly}
                  variant="default"
                  leftSection={<TextT size={16} />}
                  onClick={() => add("text")}
                >
                  写一个想法
                </Button>
                <Button
                  disabled={readOnly}
                  variant="default"
                  leftSection={<ImageSquare size={16} />}
                  onClick={addMedia}
                >
                  导入参考
                </Button>
                <Menu position="bottom" keepMounted>
                  <Menu.Target>
                    <Button
                      disabled={readOnly}
                      leftSection={<Plus size={16} />}
                    >
                      开始创作
                    </Button>
                  </Menu.Target>
                  <Menu.Dropdown>{addItems()}</Menu.Dropdown>
                </Menu>
              </Group>
              <Text size="xs" c="dimmed">
                也可以拖入文件，或双击空白选择内容类型
              </Text>
            </div>
          )}
        </div>
      )}
      {narrow && selected.length > 0 && (
        <div className={classes.mobileSelection}>{selectionActions}</div>
      )}
      <div className={classes.utilities}>
        <details
          open={showNodeList}
          onToggle={(event) => setListExpanded(event.currentTarget.open)}
        >
          <summary>节点列表与键盘定位</summary>
          {showNodeList && (
            <>
              <TextInput
                label="查找节点"
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
              />
              <Text size="xs" c="dimmed">
                按住 Shift 点击可多选，再共同作为参考。
              </Text>
              <div className={classes.nodeList}>
                {document.nodes
                  .filter((n) =>
                    `${n.title} ${n.content.type === "text" ? n.content.text : n.content.type === "draft" ? n.content.prompt : ""}`.includes(
                      query,
                    ),
                  )
                  .map((n) => (
                    <Button
                      key={n.id}
                      variant={selectedSet.has(n.id) ? "filled" : "subtle"}
                      onClick={(event) =>
                        focus(
                          event.shiftKey
                            ? selectedSet.has(n.id)
                              ? selected.filter((id) => id !== n.id)
                              : [...selected, n.id]
                            : [n.id],
                        )
                      }
                    >
                      {n.title}
                    </Button>
                  ))}
              </div>
            </>
          )}
        </details>
      </div>
      {!!document.groups.length && (
        <details
          className={classes.groupMenu}
          open={showGroups}
          onToggle={(event) => setGroupsExpanded(event.currentTarget.open)}
        >
          <summary>管理分组</summary>
          {showGroups && (
            <Stack gap="xs">
              {document.groups.map((group) => (
                <Group key={group.id} align="end">
                  <TextInput
                    label="分组名称"
                    value={
                      controller.getSnapshot().local?.buffers[
                        `group:${group.id}:title`
                      ]?.value ?? group.title
                    }
                    error={
                      controller.getSnapshot().local?.buffers[
                        `group:${group.id}:title`
                      ]
                        ? "请填写分组名称；原输入已保留"
                        : undefined
                    }
                    disabled={readOnly}
                    maxLength={160}
                    onChange={(e) => {
                      const title = e.currentTarget.value,
                        key = `group:${group.id}:title`;
                      const buffers = {
                        ...controller.getSnapshot().local?.buffers,
                      };
                      if (!title) buffers[key] = { value: title, valid: false };
                      else delete buffers[key];
                      controller.change(
                        {
                          ...document,
                          groups: document.groups.map((g) =>
                            g.id === group.id && title ? { ...g, title } : g,
                          ),
                        },
                        `group:${group.id}`,
                        buffers,
                      );
                    }}
                  />
                  <Button
                    disabled={readOnly}
                    onClick={() =>
                      change({
                        ...document,
                        groups: document.groups.filter(
                          (g) => g.id !== group.id,
                        ),
                        nodes: document.nodes.map((n) => {
                          if (n.groupId !== group.id) return n;
                          const { groupId: _group, ...node } = n;
                          return node;
                        }),
                      })
                    }
                  >
                    解散分组
                  </Button>
                </Group>
              ))}
            </Stack>
          )}
        </details>
      )}
      <div className={classes.localPanel} data-active={!!active || undefined}>
        {active && (
          <CanvasComposer
            key={active.id}
            node={active}
            controller={controller}
            document={document}
            readOnly={readOnly}
            composing={(value) => controller.setComposing(value)}
            change={change}
            focus={focus}
            nodeActions={nodeActions}
          />
        )}
        {generation}
      </div>
      {narrow && !document.nodes.length && (
        <div className={classes.empty}>
          <Text fw={600}>从一个想法、一张参考开始</Text>
          <Text c="dimmed">
            添加文字、素材或创作草稿，自由组织这一场的内容。
          </Text>
        </div>
      )}
    </div>
  );
}
/** Fit only after node measurement and selection-driven layout have settled. */
function MeasuredCanvasFocus({
  request,
  complete,
}: {
  request: { ids: string[]; nonce: number } | undefined;
  complete: (nonce: number) => void;
}) {
  const initialized = useNodesInitialized(),
    { fitView } = useReactFlow();
  const handled = useRef<typeof request>(undefined);
  useEffect(() => {
    if (!request || !initialized || handled.current === request) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        void fitView({
          nodes: request.ids.map((id) => ({ id })),
          padding: 0.3,
          minZoom: CANVAS_MIN_ZOOM,
          maxZoom: 1,
        }).then((ok) => {
          if (ok) {
            handled.current = request;
            complete(request.nonce);
          }
        });
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [request, initialized, fitView, complete]);
  return null;
}

function CanvasComposer({
  node,
  controller,
  document,
  readOnly,
  change,
  composing,
  focus,
  nodeActions,
}: {
  node: CanvasNode;
  controller: CanvasController;
  document: CanvasDocument;
  readOnly: boolean;
  change: (doc: CanvasDocument, group?: string) => void;
  composing: (value: boolean) => void;
  focus: (ids: string[]) => void;
  nodeActions?: ReactNode;
}) {
  const [reference, setReference] = useState<string | null>(null);
  const [referenceError, setReferenceError] = useState<Error | null>(null);
  const edit = (next: CanvasNode, group?: string) =>
    change(
      {
        ...document,
        nodes: document.nodes.map((n) => (n.id === node.id ? next : n)),
      },
      group,
    );
  const inbound = document.edges.filter((e) => e.targetNodeId === node.id);
  return (
    <div className={classes.composer}>
      <div className={classes.composerFields}>
        <Group justify="space-between">
          <Text fw={600} size="sm">
            {node.title}
          </Text>
          <Text size="xs" c="dimmed">
            {node.content.type === "draft" ? "独立创作草稿" : "画布节点"}
          </Text>
        </Group>
        {nodeActions}
        {node.content.type !== "media" && (
          <Textarea
            aria-label={
              node.content.type === "text" ? "文字内容" : "本次提示词"
            }
            placeholder={
              node.content.type === "text"
                ? "写下故事、构图或一闪而过的想法…"
                : "描述本次想要的画面、运动或声音…"
            }
            value={
              node.content.type === "text"
                ? node.content.text
                : node.content.prompt
            }
            minRows={2}
            autosize
            maxRows={4}
            maxLength={20000}
            disabled={readOnly}
            onCompositionStart={() => composing(true)}
            onCompositionEnd={() => composing(false)}
            onChange={(e) =>
              edit(
                {
                  ...node,
                  content:
                    node.content.type === "text"
                      ? { ...node.content, text: e.currentTarget.value }
                      : { ...node.content, prompt: e.currentTarget.value },
                } as CanvasNode,
                `content:${node.id}`,
              )
            }
          />
        )}
        {node.content.type === "draft" && inbound.length > 0 && (
          <div className={classes.referenceStrip} aria-label="本次画布参考">
            {inbound.map((edge) => {
              const source = document.nodes.find(
                (item) => item.id === edge.sourceNodeId,
              );
              return (
                <UnstyledButton
                  key={edge.id}
                  type="button"
                  className={classes.referenceChip}
                  data-disabled={!edge.enabled || undefined}
                  onClick={() => {
                    const details = window.document.getElementById(
                      `references-${node.id}`,
                    ) as HTMLDetailsElement | null;
                    if (details) details.open = true;
                  }}
                >
                  {source?.kind === "text" ? (
                    <TextT size={15} />
                  ) : source?.kind === "video" ? (
                    <FilmStrip size={15} />
                  ) : source?.kind === "audio" ? (
                    <MusicNotes size={15} />
                  ) : (
                    <ImageSquare size={15} />
                  )}
                  <span>{source?.title ?? "不可用参考"}</span>
                  <small>
                    {edge.enabled
                      ? edge.purpose === "prompt"
                        ? "提示"
                        : referencePurposes[edge.purpose]
                      : "已停用"}
                  </small>
                </UnstyledButton>
              );
            })}
          </div>
        )}
        {node.content.type === "draft" && (
          <details
            id={`references-${node.id}`}
            className={classes.referenceSettings}
          >
            <summary>
              参考材料{" "}
              <span>
                {inbound.filter((edge) => edge.enabled).length} 项已启用
              </span>
            </summary>
            <Select
              label="添加画布参考"
              placeholder="选择文字或已导入素材"
              searchable
              clearable
              value={reference}
              onChange={setReference}
              data={document.nodes
                .filter((n) => n.content.type !== "draft")
                .map((n) => ({ value: n.id, label: n.title }))}
              disabled={readOnly}
            />
            <Button
              disabled={!reference || readOnly}
              onClick={() => {
                const source = document.nodes.find((n) => n.id === reference);
                if (!source) return;
                try {
                  change({
                    ...document,
                    edges: appendCanvasReference(document.edges, {
                      id: crypto.randomUUID(),
                      sourceNodeId: source.id,
                      targetNodeId: node.id,
                      enabled: true,
                      purpose:
                        source.kind === "text"
                          ? "prompt"
                          : source.kind === "audio"
                            ? "voice"
                            : "composition",
                    }),
                  });
                  setReferenceError(null);
                } catch (e) {
                  setReferenceError(
                    e instanceof Error ? e : new Error("引用未添加。"),
                  );
                }
                setReference(null);
              }}
            >
              添加所选参考
            </Button>
            <ErrorNotice error={referenceError} />
            {inbound.map((edge) => {
              const source = document.nodes.find(
                (n) => n.id === edge.sourceNodeId,
              )!;
              return (
                <Group key={edge.id} align="end">
                  <Select
                    label={`${source.title} · 用途`}
                    allowDeselect={false}
                    value={edge.purpose}
                    data={
                      source.kind === "text"
                        ? [{ value: "prompt", label: "提示" }]
                        : options(referencePurposes)
                    }
                    disabled={readOnly}
                    onChange={(purpose) =>
                      change({
                        ...document,
                        edges: document.edges.map((e) =>
                          e.id === edge.id
                            ? {
                                ...e,
                                purpose: purpose as typeof edge.purpose,
                              }
                            : e,
                        ),
                      })
                    }
                  />
                  <Button
                    disabled={readOnly}
                    onClick={() =>
                      change({
                        ...document,
                        edges: document.edges.map((e) =>
                          e.id === edge.id ? { ...e, enabled: !e.enabled } : e,
                        ),
                      })
                    }
                  >
                    {edge.enabled ? "停用" : "启用"}
                  </Button>
                  <Button
                    disabled={readOnly}
                    onClick={() =>
                      change({
                        ...document,
                        edges: document.edges.filter((e) => e.id !== edge.id),
                      })
                    }
                  >
                    移除引用
                  </Button>
                </Group>
              );
            })}
          </details>
        )}
        <details
          className={classes.nodeSettings}
          open={
            Object.keys(controller.getSnapshot().local?.buffers ?? {}).some(
              (key) => key.startsWith(`node:${node.id}:`),
            ) || undefined
          }
        >
          <summary>
            节点属性 <span>名称、位置与分组</span>
          </summary>
          <TextInput
            label="节点名称"
            maxLength={160}
            value={
              controller.getSnapshot().local?.buffers[`node:${node.id}:title`]
                ?.value ?? node.title
            }
            disabled={readOnly}
            error={
              controller.getSnapshot().local?.buffers[`node:${node.id}:title`]
                ? "请填写节点名称；原输入已保留"
                : undefined
            }
            onChange={(e) => {
              const title = e.currentTarget.value,
                key = `node:${node.id}:title`;
              const buffers = { ...controller.getSnapshot().local?.buffers };
              if (!title) buffers[key] = { value: title, valid: false };
              else delete buffers[key];
              controller.change(
                {
                  ...document,
                  nodes: document.nodes.map((n) =>
                    n.id === node.id && title ? { ...n, title } : n,
                  ),
                },
                `title:${node.id}`,
                buffers,
              );
            }}
          />
          <div className={classes.fields}>
            {(
              [
                {
                  key: "x",
                  label: "横向位置",
                  value: node.position.x,
                  min: -1000000,
                  max: 1000000,
                },
                {
                  key: "y",
                  label: "纵向位置",
                  value: node.position.y,
                  min: -1000000,
                  max: 1000000,
                },
                {
                  key: "width",
                  label: "节点宽度",
                  value: node.width,
                  min: 120,
                  max: 1600,
                },
              ] as const
            ).map((field) => {
              const key = `node:${node.id}:${field.key}`,
                buffer = controller.getSnapshot().local?.buffers[key];
              return (
                <NumberInput
                  key={key}
                  label={field.label}
                  value={buffer?.value ?? field.value}
                  min={field.min}
                  max={field.max}
                  clampBehavior="none"
                  disabled={readOnly}
                  error={buffer ? "请完成这个数值；原输入已保留" : undefined}
                  onChange={(v) => {
                    const buffers = {
                      ...controller.getSnapshot().local?.buffers,
                    };
                    const valid =
                      typeof v === "number" &&
                      Number.isFinite(v) &&
                      v >= field.min &&
                      v <= field.max;
                    if (!valid)
                      buffers[key] = { value: String(v), valid: false };
                    else delete buffers[key];
                    const next = valid
                      ? field.key === "width"
                        ? { ...node, width: v }
                        : {
                            ...node,
                            position: { ...node.position, [field.key]: v },
                          }
                      : node;
                    controller.change(
                      {
                        ...document,
                        nodes: document.nodes.map((n) =>
                          n.id === node.id ? next : n,
                        ),
                      },
                      `number:${key}`,
                      buffers,
                    );
                  }}
                />
              );
            })}
          </div>
          <Select
            label="分组"
            clearable
            allowDeselect
            placeholder="独立节点"
            value={node.groupId ?? null}
            data={document.groups.map((g) => ({ value: g.id, label: g.title }))}
            disabled={readOnly}
            onChange={(v) => {
              const { groupId: _old, ...rest } = node;
              edit(v ? { ...node, groupId: v } : rest);
            }}
          />
          {node.groupId && (
            <Button
              variant="subtle"
              onClick={() =>
                focus(
                  document.nodes
                    .filter((n) => n.groupId === node.groupId)
                    .map((n) => n.id),
                )
              }
            >
              选中并定位整组
            </Button>
          )}
        </details>
      </div>
    </div>
  );
}

function CanvasSelectionTools({
  nodes,
  children,
}: {
  nodes: CanvasFlowNode[];
  children: ReactNode;
}) {
  const { x, y, zoom } = useViewport();
  const width = useStore((state) => state.width),
    height = useStore((state) => state.height);
  const tool = useRef<HTMLDivElement>(null);
  const [toolHeight, setToolHeight] = useState(42);
  useEffect(() => {
    const element = tool.current;
    if (!element) return;
    const measure = () => setToolHeight(element.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [nodes.length, width, height]);
  if (!nodes.length || !width || !height) return null;
  const left = Math.min(...nodes.map((node) => node.position.x)),
    right = Math.max(
      ...nodes.map(
        (node) => node.position.x + (node.measured?.width ?? node.width ?? 320),
      ),
    ),
    top = Math.min(...nodes.map((node) => node.position.y));
  const toolWidth = Math.min(420, width - 24);
  const screenTop = top * zoom + y;
  return (
    <div
      ref={tool}
      className={classes.selectionTools}
      aria-label="所选内容操作"
      style={{
        width: toolWidth,
        left: Math.max(
          12,
          Math.min(
            width - toolWidth - 12,
            ((left + right) / 2) * zoom + x - toolWidth / 2,
          ),
        ),
        top: Math.max(
          12,
          Math.min(
            height - toolHeight - 12,
            screenTop > toolHeight + 20
              ? screenTop - toolHeight - 12
              : screenTop + 36,
          ),
        ),
      }}
    >
      {children}
    </div>
  );
}

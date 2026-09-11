import {
  editingCanonical,
  inspectCanvasDocument,
  type CanvasDocument,
} from "@drama/domain";
import type { Schema } from "./api";
import {
  EditingDocumentController,
  type EditingTransport,
  type EditingState,
  type EditingBuffer,
} from "./editing-document-controller";
import type { EditingPartition } from "./editing-local";

type Canvas = Schema<"Canvas">;
type CanvasContext = Record<never, never>;
export type CanvasTransport = EditingTransport<
  CanvasDocument,
  Canvas,
  CanvasContext
>;
export type CanvasEditorState = EditingState<
  CanvasDocument,
  Canvas,
  CanvasContext
>;
type CanvasEdit = {
  document: CanvasDocument;
  buffers: Record<string, EditingBuffer>;
};
const sameEdit = (a: CanvasEdit, b: CanvasEdit) =>
  editingCanonical(a) === editingCanonical(b);
export class CanvasController extends EditingDocumentController<
  CanvasDocument,
  Canvas,
  CanvasContext
> {
  private past: CanvasEdit[] = [];
  private future: CanvasEdit[] = [];
  private historyHead: CanvasEdit | undefined;
  private lastEdit: { group: string; at: number } | undefined;
  private syncHistory() {
    const local = this.getSnapshot().local;
    const current = local
      ? { document: local.document, buffers: local.buffers }
      : undefined;
    if (
      current?.document !== this.historyHead?.document ||
      current?.buffers !== this.historyHead?.buffers
    ) {
      // Authorized reads of identical saved content preserve session undo.
      if (
        !current ||
        !this.historyHead ||
        !sameEdit(current, this.historyHead)
      ) {
        this.past = [];
        this.future = [];
        this.lastEdit = undefined;
      }
      this.historyHead = current;
    }
    return current;
  }
  get canUndo() {
    this.syncHistory();
    return this.past.length > 0;
  }
  get canRedo() {
    this.syncHistory();
    return this.future.length > 0;
  }
  change(
    document: CanvasDocument,
    group?: string,
    buffers = this.getSnapshot().local?.buffers ?? {},
  ) {
    const nodeIds = new Set(document.nodes.map((n) => n.id)),
      groupIds = new Set(document.groups.map((g) => g.id));
    buffers = Object.fromEntries(
      Object.entries(buffers).filter(
        ([key]) =>
          (!key.startsWith("node:") || nodeIds.has(key.split(":")[1]!)) &&
          (!key.startsWith("group:") || groupIds.has(key.split(":")[1]!)),
      ),
    );
    const previous = this.syncHistory(),
      next = { document, buffers };
    if (!previous || sameEdit(previous, next)) return;
    // Update history before publishing so synchronous subscribers see the new undo state.
    const oldPast = this.past,
      oldFuture = this.future,
      oldLast = this.lastEdit;
    if (
      !group ||
      this.lastEdit?.group !== group ||
      Date.now() - this.lastEdit.at > 1000
    )
      this.past = [...this.past, previous].slice(-100);
    this.future = [];
    this.historyHead = next;
    this.lastEdit = group ? { group, at: Date.now() } : undefined;
    super.edit(document, buffers);
    if (
      this.getSnapshot().local?.document !== document ||
      this.getSnapshot().local?.buffers !== buffers
    ) {
      this.past = oldPast;
      this.future = oldFuture;
      this.lastEdit = oldLast;
      this.historyHead = previous;
    }
  }
  undo() {
    const current = this.syncHistory(),
      previous = this.past.at(-1);
    if (!current || !previous) return;
    this.past.pop();
    this.future.push(current);
    this.historyHead = previous;
    this.lastEdit = undefined;
    super.edit(previous.document, previous.buffers);
    if (
      this.getSnapshot().local?.document !== previous.document ||
      this.getSnapshot().local?.buffers !== previous.buffers
    ) {
      this.future.pop();
      this.past.push(previous);
      this.historyHead = current;
    }
  }
  redo() {
    const current = this.syncHistory(),
      next = this.future.at(-1);
    if (!current || !next) return;
    this.future.pop();
    this.past.push(current);
    this.historyHead = next;
    this.lastEdit = undefined;
    super.edit(next.document, next.buffers);
    if (
      this.getSnapshot().local?.document !== next.document ||
      this.getSnapshot().local?.buffers !== next.buffers
    ) {
      this.past.pop();
      this.future.push(next);
      this.historyHead = current;
    }
  }
  constructor(
    partition: EditingPartition,
    transport: CanvasTransport,
    appSessionId?: string,
  ) {
    super(
      partition,
      transport,
      {
        snapshotSchema: "Canvas",
        saveSchema: "SaveCanvas",
        objectId: (canvas) => canvas.id,
        contextKeys: [],
        envelope: { schemaVersion: 1 },
        inspect: inspectCanvasDocument,
      },
      appSessionId,
    );
  }
  merge(document: CanvasDocument, remoteRevision: number) {
    if (this.getSnapshot().hasInvalidInput)
      return Promise.reject(
        new Error("请先完成尚未输入完整的数值，本机输入仍保留。"),
      );
    return this.reapply(document, {}, remoteRevision, {});
  }
}

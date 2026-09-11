import { inspectWorkDocument, type WorkDocument } from "@drama/domain";
import type { Schema } from "./api";
import {
  EditingDocumentController,
  type EditingBuffer,
  type EditingPending,
  type EditingLocalValue,
  type EditingState,
  type EditingTransport,
} from "./editing-document-controller";
import type { EditingPartition } from "./editing-local";

type Work = Schema<"CutWorkDraft">;
type CutContext = { baseCutRevision: number };
export type { EditingBuffer };
export type WorkPendingWrite = EditingPending<WorkDocument, CutContext>;
export type WorkLocalValue = EditingLocalValue<WorkDocument, Work, CutContext>;
export type WorkEditorState = EditingState<WorkDocument, Work, CutContext>;
export type WorkTransport = EditingTransport<WorkDocument, Work, CutContext>;
export class CutWorkController extends EditingDocumentController<
  WorkDocument,
  Work,
  CutContext
> {
  constructor(
    partition: EditingPartition,
    transport: WorkTransport,
    appSessionId?: string,
  ) {
    super(
      partition,
      transport,
      {
        snapshotSchema: "CutWorkDraft",
        saveSchema: "SaveCutWorkDraft",
        objectId: (work) => work.cutId,
        contextKeys: ["baseCutRevision"],
        envelope: {},
        inspect: inspectWorkDocument,
      },
      appSessionId,
    );
  }
  merge(
    document: WorkDocument,
    buffers: Record<string, EditingBuffer>,
    remoteRevision: number,
    baseCutRevision: number,
  ) {
    return this.reapply(document, buffers, remoteRevision, { baseCutRevision });
  }
}

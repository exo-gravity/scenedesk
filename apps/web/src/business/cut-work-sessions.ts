import { CutWorkController, type WorkTransport } from "./cut-work-controller";
import { EditingSessionRegistry } from "./editing-sessions";
export class CutWorkSessionRegistry extends EditingSessionRegistry<
  CutWorkController,
  WorkTransport
> {
  constructor(limit = 8, retained = 4) {
    super(
      (partition, transport, sessionId) =>
        new CutWorkController(partition, transport, sessionId),
      limit,
      retained,
    );
  }
}

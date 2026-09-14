import type { components } from "@drama/contracts";
import type { AssistantSession } from "./assistant-session.js";
import type { ImageDraft, ImageRequest } from "./image-generation.js";

type Placement = NonNullable<ImageDraft["placement"]>;
type Receipt = components["schemas"]["CanvasResultPlacement"];
export type CanvasPlacementReply =
  { kind: "placed"; receipt: Receipt } | { kind: "version_conflict" };

export function canReviewCanvasResultPlacement(placement?: Placement) {
  return !placement || placement.phase === "conflict";
}

/** A transport failure leaves the pre-saved unknown intent intact. A later
 * version rejection cannot prove that the first request had no side effect. */
export function submitCanvasResultPlacement(
  controller: Pick<AssistantSession<ImageDraft, ImageRequest>, "commitDraft">,
  draft: ImageDraft,
  send: (intent: Placement) => Promise<CanvasPlacementReply>,
): Promise<void> {
  if (
    !draft.placement ||
    !["review", "unknown"].includes(draft.placement.phase)
  )
    return Promise.resolve();
  const intent = structuredClone(draft.placement);
  return controller.commitDraft(
    draft,
    { ...draft, placement: { ...intent, phase: "unknown" } },
    async (current, checkCurrent) => {
      const reply = await send(intent);
      checkCurrent();
      if (reply.kind === "version_conflict") {
        if (intent.phase === "review")
          return {
            ...current,
            placement: { ...intent, phase: "conflict" },
          };
        throw Error(
          "原添加请求的结果仍待核对，当前画布版本已变化。原请求、版本和位置已保留，请读取画布核对；此次拒绝不能说明第一次未添加。",
        );
      }
      return {
        ...current,
        placement: { ...intent, phase: "placed", placed: reply.receipt },
      };
    },
  );
}

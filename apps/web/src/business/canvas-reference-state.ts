import { referencePurposes } from "./reference-purposes.js";

export type ReferenceTone =
  | "ok"
  | "disabled"
  | "missing"
  | "pending"
  | "archived"
  | "failed";

/**
 * What a reference chip says about itself. A disabled edge is disabled
 * whatever its source looks like; a source that left the canvas is named as
 * missing; media that is not ready, archived or unreadable is named as such.
 * None of these states is ever submitted as a valid input.
 */
export function referenceState({
  edge,
  source,
  media,
}: {
  edge: { enabled: boolean; purpose: string };
  source: { kind: string } | undefined;
  /** The media record for a media source: `undefined` while loading, `null` when unreadable. */
  media?: { status: string } | null | undefined;
}): { tone: ReferenceTone; label: string } {
  if (!edge.enabled) return { tone: "disabled", label: "已停用" };
  if (!source) return { tone: "missing", label: "来源已不在画布上" };
  if (source.kind !== "text") {
    if (media === null) return { tone: "failed", label: "素材当前无法读取" };
    if (media === undefined) return { tone: "pending", label: "正在读取素材" };
    if (media && media.status === "archived")
      return { tone: "archived", label: "已归档 · 原有引用" };
    if (media && media.status !== "ready")
      return { tone: "pending", label: "正在验收原文件" };
  }
  return {
    tone: "ok",
    label:
      edge.purpose === "prompt"
        ? "提示"
        : (referencePurposes[edge.purpose as keyof typeof referencePurposes] ??
          edge.purpose),
  };
}

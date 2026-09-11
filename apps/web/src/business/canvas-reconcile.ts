import {
  editingCanonical,
  inspectCanvasDocument,
  type CanvasDocument,
} from "@drama/domain";

type Entry = {
  label: string;
  value:
    | CanvasDocument["nodes"][number]
    | CanvasDocument["edges"][number]
    | CanvasDocument["groups"][number];
};
function entries(document: CanvasDocument) {
  return new Map<string, Entry>([
    ...document.nodes.map(
      (n) =>
        [
          `nodes:${n.id.toLowerCase()}`,
          { label: `节点 · ${n.title}`, value: n },
        ] as const,
    ),
    ...document.edges.map(
      (e) =>
        [
          `edges:${e.id.toLowerCase()}`,
          { label: `引用 · ${e.purpose}`, value: e },
        ] as const,
    ),
    ...document.groups.map(
      (g) =>
        [
          `groups:${g.id.toLowerCase()}`,
          { label: `分组 · ${g.title}`, value: g },
        ] as const,
    ),
  ]);
}
const same = (a: Entry | undefined, b: Entry | undefined) =>
  a && b ? editingCanonical(a.value) === editingCanonical(b.value) : a === b;
export function canvasChanges(
  base: CanvasDocument,
  local: CanvasDocument,
  remote: CanvasDocument,
) {
  const a = entries(base),
    b = entries(local),
    c = entries(remote);
  return [...new Set([...a.keys(), ...b.keys()])].flatMap((key) =>
    same(a.get(key), b.get(key))
      ? []
      : [
          {
            key,
            label: (b.get(key) ?? a.get(key))!.label,
            base: a.get(key)?.value,
            local: b.get(key)?.value,
            remote: c.get(key)?.value,
            sharedChange: !same(a.get(key), c.get(key)),
          },
        ],
  );
}
/** Reapply only explicit object choices. Dangling references fail instead of
 * silently dropping peers' edges or inventing a merge. */
export function replayCanvasChanges(
  base: CanvasDocument,
  local: CanvasDocument,
  remote: CanvasDocument,
  selected: ReadonlySet<string>,
): CanvasDocument {
  const result = entries(remote),
    mine = entries(local),
    changes = canvasChanges(base, local, remote);
  for (const key of selected) {
    if (!changes.some((c) => c.key === key))
      throw new Error("所选变化已不属于当前比较，请重新核对。");
    const value = mine.get(key);
    if (value) result.set(key, value);
    else result.delete(key);
  }
  const document: CanvasDocument = { nodes: [], edges: [], groups: [] };
  for (const [key, entry] of result) {
    if (key.startsWith("nodes:"))
      document.nodes.push(entry.value as CanvasDocument["nodes"][number]);
    else if (key.startsWith("edges:"))
      document.edges.push(entry.value as CanvasDocument["edges"][number]);
    else document.groups.push(entry.value as CanvasDocument["groups"][number]);
  }
  inspectCanvasDocument(document);
  return document;
}

export const EDITING_HISTORY_POLICY = Object.freeze({
  recentHours: 24,
  recentMaxRevisions: 100,
  checkpointMinutes: 15,
  checkpointDays: 7,
  dailyDays: 30,
  uncompressedByteBudget: 256 * 1024 * 1024,
});
export type HistoryReason =
  "current" | "previous" | "recent" | "checkpoint" | "pinned";
export type HistoryFact = Readonly<{
  revision: number;
  documentHash: string;
  canonicalBytes: number;
  createdAt: number;
  pinned: boolean;
}>;

/** Only the retained set is returned. Call under the object's transaction lock;
 * pins and protected head identities are database facts, never client inputs. */
export function retainEditingHistory(
  facts: readonly HistoryFact[],
  now: number,
  byteBudget = EDITING_HISTORY_POLICY.uncompressedByteBudget,
) {
  const sorted = [...facts].sort((a, b) => b.revision - a.revision);
  const retained = new Map<number, Set<HistoryReason>>();
  const add = (revision: number, reason: HistoryReason) => {
    const reasons = retained.get(revision) ?? new Set<HistoryReason>();
    reasons.add(reason);
    retained.set(revision, reasons);
  };
  if (sorted[0]) add(sorted[0].revision, "current");
  if (sorted[1]) add(sorted[1].revision, "previous");
  const minute = 60_000,
    day = 24 * 60 * minute;
  for (const row of sorted
    .filter((f) => f.createdAt >= now - day)
    .slice(0, EDITING_HISTORY_POLICY.recentMaxRevisions))
    add(row.revision, "recent");
  for (const [width, days] of [
    [15 * minute, 7],
    [day, 30],
  ] as const) {
    const buckets = new Set<number>();
    for (const row of sorted) {
      if (row.createdAt < now - days * day) continue;
      const bucket = Math.floor(row.createdAt / width);
      if (!buckets.has(bucket)) {
        buckets.add(bucket);
        add(row.revision, "checkpoint");
      }
    }
  }
  for (const row of sorted) if (row.pinned) add(row.revision, "pinned");
  const protectedRow = (row: HistoryFact) =>
    [...(retained.get(row.revision) ?? [])].some(
      (reason) =>
        reason === "current" || reason === "previous" || reason === "pinned",
    );
  const protectedHashes = new Set(
    sorted.filter(protectedRow).map((f) => f.documentHash),
  );
  const counts = new Map<string, { references: number; bytes: number }>();
  let bytes = 0;
  for (const row of sorted) {
    if (!retained.has(row.revision) || protectedHashes.has(row.documentHash))
      continue;
    const body = counts.get(row.documentHash) ?? {
      references: 0,
      bytes: row.canonicalBytes,
    };
    if (!body.references) bytes += body.bytes;
    body.references++;
    counts.set(row.documentHash, body);
  }
  const disposable = sorted
    .filter((row) => retained.has(row.revision) && !protectedRow(row))
    .sort(
      (a, b) =>
        Number(retained.get(a.revision)!.has("checkpoint")) -
          Number(retained.get(b.revision)!.has("checkpoint")) ||
        a.revision - b.revision,
    );
  for (const row of disposable) {
    if (bytes <= byteBudget) break;
    retained.delete(row.revision);
    const body = counts.get(row.documentHash);
    if (body && --body.references === 0) bytes -= body.bytes;
  }
  return { retained, unpinnedHistoryBytes: bytes };
}

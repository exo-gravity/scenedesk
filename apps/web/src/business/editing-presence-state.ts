import type { components } from "@drama/contracts";

/** Elapsed time includes the request round trip, conservatively expiring advice.
 * A local clock/date change must not extend another page's server TTL. */
export function editingPresenceLabel(
  snapshot: components["schemas"]["EditingPresence"],
  clientId: string,
  elapsedMs: number,
) {
  const serverTime = Date.parse(snapshot.serverTime);
  const now = serverTime + Math.max(0, elapsedMs);
  if (!Number.isFinite(now) || now >= serverTime + 90_000)
    return { label: "编辑状态暂不可用", refreshInMs: null };
  const others = snapshot.entries.filter(
    (entry) =>
      entry.clientSessionId !== clientId && Date.parse(entry.expiresAt) > now,
  );
  const editing = others.filter((entry) => entry.activity === "editing").length;
  return {
    label: editing
      ? `另有 ${editing} 个页面正在编辑`
      : others.length
        ? `另有 ${others.length} 个页面正在查看`
        : "暂未收到其他页面活动",
    refreshInMs: Math.max(
      1,
      Math.min(
        serverTime + 90_000,
        ...others.map((entry) => Date.parse(entry.expiresAt)),
      ) - now,
    ),
  };
}

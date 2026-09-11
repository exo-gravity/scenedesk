/** Cross-document hints carry no content and never grant or revoke authority.
 * Receivers suspend editing, then verify the current server session/object. */
export type EditingAccessHint = {
  sessionId: string;
  userId: string;
} & (
  | { kind: "session" }
  | { kind: "cut"; tenantId: string; projectId: string; objectId: string }
);
const channelName = "scenedesk-editing-access-v1";
const sender = crypto.randomUUID();
const identifier = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128;
export function readEditingAccessHint(
  value: unknown,
): EditingAccessHint | null {
  if (!value || typeof value !== "object") return null;
  const hint = value as Record<string, unknown>;
  if (!identifier(hint.sessionId) || !identifier(hint.userId)) return null;
  if (hint.kind === "session")
    return { kind: "session", sessionId: hint.sessionId, userId: hint.userId };
  if (
    hint.kind === "cut" &&
    identifier(hint.tenantId) &&
    identifier(hint.projectId) &&
    identifier(hint.objectId)
  )
    return {
      kind: "cut",
      sessionId: hint.sessionId,
      userId: hint.userId,
      tenantId: hint.tenantId,
      projectId: hint.projectId,
      objectId: hint.objectId,
    };
  return null;
}
export function notifyEditingAccess(hint: EditingAccessHint) {
  if (typeof BroadcastChannel === "undefined") return;
  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel(channelName);
    channel.postMessage({ sender, hint });
  } catch {
    // Browser policy can disable this advisory path. Server checks still apply.
  } finally {
    channel?.close();
  }
}
export function subscribeEditingAccess(
  receive: (hint: EditingAccessHint) => void,
) {
  if (typeof BroadcastChannel === "undefined") return () => {};
  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(channelName);
  } catch {
    return () => {};
  }
  channel.onmessage = ({ data }) => {
    if (!data || data.sender === sender) return;
    const hint = readEditingAccessHint(data.hint);
    if (hint) receive(hint);
  };
  return () => channel.close();
}

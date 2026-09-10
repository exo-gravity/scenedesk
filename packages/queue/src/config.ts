import type { Queue } from "pg-boss";

export const queueVersion = "12.30.0";
export const queueSchemaVersion = 40;
export const defaultQueueSchema = "scenedesk_queue";
export const internalQueue = "media-probe";
export const queuePolicy = {
  policy: "short",
  retryLimit: 5,
  retryDelay: 2,
  retryBackoff: true,
  retryDelayMax: 60,
  expireInSeconds: 120,
  heartbeatSeconds: 15,
  retentionSeconds: 7 * 86400,
  deleteAfterSeconds: 7 * 86400,
} satisfies Omit<Queue, "name">;

export function queueSchema(value = defaultQueueSchema) {
  if (!/^scenedesk_queue(?:_[a-z0-9]+)?$/.test(value) || value.length > 50)
    throw new Error("Queue schema must be an isolated scenedesk_queue name");
  return value;
}
export function roleIdentifier(value: string) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value))
    throw new Error("Invalid queue role identifier");
  return `"${value}"`;
}

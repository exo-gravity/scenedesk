import type { Session } from "./api";

export type CanvasLocation = "project" | string;

function key(session: Session, tenantId: string, projectId: string) {
  return `scenedesk-recent-canvas:${session.id}:${session.userId}:${tenantId}:${projectId}`;
}

/** A convenience hint, never authority or a cached project/scene label. */
export function recentCanvas(
  session: Session,
  tenantId: string,
  projectId: string,
) {
  try {
    return sessionStorage.getItem(key(session, tenantId, projectId));
  } catch {
    return null;
  }
}

export function rememberCanvas(
  session: Session,
  tenantId: string,
  projectId: string,
  location: CanvasLocation,
) {
  try {
    sessionStorage.setItem(key(session, tenantId, projectId), location);
  } catch {
    // Storage restrictions only disable the shortcut; the actual canvas remains usable.
  }
}

export function canvasLocationHref(base: string, sceneId: string | null) {
  return sceneId === null
    ? `${base}/canvas?scope=project`
    : `${base}/production?scene=${encodeURIComponent(sceneId)}&mode=canvas`;
}

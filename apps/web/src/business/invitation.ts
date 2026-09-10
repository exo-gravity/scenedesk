export const pendingInvitationKey = "scenedesk:pending-invitation";

export function invitationFromFragment(hash: string): string | null {
  if (hash.split("?")[0] !== "#/invitation") return null;
  const token = new URLSearchParams(hash.split("?")[1]).get("token");
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
export function loginReturnPath(hash: string): string {
  // Invitation secrets stay in a fragment/tab-local storage, never in the
  // login URL query string, server access logs or the OIDC return path record.
  return hash.split("?")[0] === "#/invitation"
    ? "/#/invitation"
    : `/${hash || "#/app"}`;
}

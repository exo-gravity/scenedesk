/**
 * Addresses of the creative workspace before the rebuild, mapped to where the
 * studio keeps the same thing now. Old links live on in browser history,
 * bookmarks and receipts, so they keep opening; `null` means the address is
 * not one of the retired pages and is left alone.
 */
export function studioRouteFor(hash: string): string | null {
  const [route = "", search = ""] = hash.split("?");
  const match =
    /^#\/app\/t\/([^/]+)\/p\/([^/]+)\/(canvas|production|script|content)$/.exec(
      route,
    );
  if (!match) return null;
  const base = `#/app/t/${match[1]}/p/${match[2]}`;
  const query = new URLSearchParams(search);
  const param = (name: string) => {
    const value = query.get(name);
    return value ? `${name}=${encodeURIComponent(value)}` : "";
  };
  switch (match[3]) {
    case "canvas":
      return `${base}/studio${query.get("node") ? `?${param("node")}` : ""}`;
    case "production":
      // Scene canvases are addressed by `?scene=`; a storyboard deep link to a
      // shot opens that shot in the shot organiser.
      if (query.get("scene") && query.get("shot"))
        return `${base}/studio/shots?${param("scene")}&${param("shot")}`;
      return `${base}/studio${query.get("scene") ? `?${param("scene")}` : ""}`;
    case "script":
      // The story settings tab moved to the project page.
      if (query.get("tab") === "settings") return base;
      return `${base}/studio/script${query.get("revision") ? `?${param("revision")}` : ""}`;
    case "content":
      // The old content page showed a fixed script revision when linked with
      // `?revision=` and no shot; everything else on it stays where it is.
      return query.get("revision") && !query.get("shot")
        ? `${base}/studio/script?${param("revision")}`
        : null;
  }
  return null;
}

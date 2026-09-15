import { useEffect, useState } from "react";
import { useDebouncedValue } from "@mantine/hooks";
import { useResource, type Schema } from "./api";
import { tenantPath } from "./common";
import AssetWorkspace from "./AssetWorkspace";
import MediaWorkspace from "./MediaWorkspace";
import { libraryCategories, type LibraryLocation } from "./LibraryNavigation";

export default function AssetLibrary(props: {
  tenantId: string;
  projectId?: string | undefined;
  own: Schema<"Membership">;
  legacyMedia?: boolean;
}) {
  const params = new URLSearchParams(location.hash.split("?")[1]);
  const contextProjectId =
    props.projectId ?? params.get("targetProject") ?? undefined;
  const shared = !props.projectId || params.get("scope") === "shared";
  const rawCategory = params.get("type");
  const assetHint = useResource<Schema<"Asset">>(
    `${tenantPath(props.tenantId)}/assets/${params.get("asset") ?? ""}`,
    !rawCategory && params.has("asset"),
  );
  const mediaHint = useResource<Schema<"Media">>(
    `${tenantPath(props.tenantId)}/media/${params.get("media") ?? ""}`,
    !rawCategory && params.has("media"),
  );
  const category =
    libraryCategories.find((item) => item.value === rawCategory)?.value ??
    (!assetHint.isError ? assetHint.data?.kind : undefined) ??
    (!mediaHint.isError ? mediaHint.data?.kind : undefined) ??
    (props.legacyMedia || params.has("media") ? "image" : "character");
  const [q, setQ] = useState(params.get("q") ?? "");
  const query = params.get("q") ?? "";
  useEffect(() => setQ(query), [query]);
  const [search] = useDebouncedValue(q, 250);
  const updateSearch = (value: string) => {
    const query = new URLSearchParams(location.hash.split("?")[1]);
    if (value) query.set("q", value);
    else query.delete("q");
    history.replaceState(
      history.state,
      "",
      `${location.hash.split("?")[0]}?${query}`,
    );
    setQ(value);
  };
  const base = `#/app/t/${props.tenantId}${contextProjectId ? `/p/${contextProjectId}` : ""}/assets`;
  const href: LibraryLocation["href"] = (values = {}) => {
    const scope = values.scope ?? (shared ? "shared" : "project");
    const query = new URLSearchParams({
      type: values.type ?? category,
      ...(scope === "shared" && contextProjectId ? { scope } : {}),
      ...(q ? { q } : {}),
      ...(values.asset ? { asset: values.asset } : {}),
      ...(values.revision ? { revision: values.revision } : {}),
      ...(values.media ? { media: values.media } : {}),
    });
    return `${base}?${query}`;
  };
  const library: LibraryLocation = {
    tenantId: props.tenantId,
    contextProjectId,
    projectId: shared ? undefined : props.projectId,
    category,
    q,
    search,
    setQ: updateSearch,
    href,
  };
  const media =
    ["image", "video", "audio", "document"].includes(category) &&
    !params.has("asset");
  return media ? (
    <MediaWorkspace
      {...props}
      projectId={library.projectId}
      library={library}
    />
  ) : (
    <AssetWorkspace
      {...props}
      projectId={library.projectId}
      library={library}
    />
  );
}

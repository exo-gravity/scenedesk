import { useInfiniteQuery } from "@tanstack/react-query";
import { api, useSession, type Page } from "./api";
export function useAssetPages<T>(path: string, enabled = true) {
  const session = useSession();
  return useInfiniteQuery({
    queryKey: ["user", session.userId, path],
    initialPageParam: "",
    enabled,
    queryFn: ({ signal, pageParam }) =>
      api<Page<T>>(
        `${path}${path.includes("?") ? "&" : "?"}limit=30${pageParam ? "&cursor=" + encodeURIComponent(pageParam) : ""}`,
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}
export const assetKinds = {
  character: "角色",
  location: "空间",
  prop: "道具",
  voice: "声音",
  style: "风格",
};
export const referencePurposes = {
  identity: "身份",
  look: "造型",
  location: "空间",
  action: "动作",
  composition: "构图",
  style: "风格",
  voice: "声音",
  start_frame: "首帧",
  end_frame: "尾帧",
  prop: "道具",
};
export const options = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

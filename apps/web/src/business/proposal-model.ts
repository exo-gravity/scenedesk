import type { Schema } from "./api";
export type Tree = Schema<"ContentTree">;
export type Proposal = Schema<"Proposal">;
export type Operation = Schema<"ProposalOperation">;
export type Props = {
  path: string;
  tree: Tree;
  active: boolean;
  projectName: string;
  initialSceneId?: string;
  onClose: () => void;
};
export const kindName = {
  episode: "单集",
  scene: "场次",
  shot: "镜头",
  asset_suggestion: "资产建议",
};
export const statusName = {
  proposed: "待采纳",
  applied: "已采纳",
  rejected: "已拒绝",
};
export const title = (op: Operation) =>
  "label" in op.proposed
    ? op.proposed.label
    : "title" in op.proposed
      ? op.proposed.title
      : op.proposed.name;
export const activeScenes = (tree: Tree) =>
  tree.scenes.filter(
    (s) =>
      s.status === "active" &&
      tree.episodes.some((e) => e.id === s.episodeId && e.status === "active"),
  );
export function sceneOptions(tree: Tree) {
  return activeScenes(tree).map((s) => ({
    value: s.id,
    label: `${tree.episodes.find((e) => e.id === s.episodeId)?.title} / ${s.title}`,
  }));
}

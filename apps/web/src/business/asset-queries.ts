export { usePages as useAssetPages } from "./api";
export const assetKinds = {
  character: "角色",
  location: "场景",
  prop: "道具",
  voice: "声音设定",
  style: "风格",
};
export { referencePurposes } from "./reference-purposes";
export const options = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

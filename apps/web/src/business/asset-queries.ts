export { usePages as useAssetPages } from "./api";
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

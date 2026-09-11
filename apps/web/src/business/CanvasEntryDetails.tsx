import { Stack, Text } from "@mantine/core";
import type { CanvasDocument } from "@drama/domain";
import { referencePurposes } from "./asset-queries";

type Entry =
  | CanvasDocument["nodes"][number]
  | CanvasDocument["edges"][number]
  | CanvasDocument["groups"][number];
/** Human-readable read-only content used before conflict replay or history restore. */
export function CanvasEntryDetails({
  value,
  document,
}: {
  value: Entry | undefined;
  document: CanvasDocument;
}) {
  if (!value) return <Text size="sm">已删除或不存在</Text>;
  if ("sourceNodeId" in value) {
    const title = (id: string) =>
      document.nodes.find((n) => n.id.toLowerCase() === id.toLowerCase())
        ?.title ?? "已删除节点";
    return (
      <Text size="sm">
        {title(value.sourceNodeId)} → {title(value.targetNodeId)} ·{" "}
        {value.purpose === "prompt" ? "提示" : referencePurposes[value.purpose]}{" "}
        · {value.enabled ? "启用" : "停用"} · 顺序 {value.position + 1}
      </Text>
    );
  }
  if (!("content" in value)) return <Text size="sm">分组 · {value.title}</Text>;
  const content = value.content;
  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        {value.title}
      </Text>
      <Text size="sm">
        位置 {value.position.x}, {value.position.y} · 宽度 {value.width}
        {value.groupId
          ? ` · 分组 ${document.groups.find((g) => g.id === value.groupId)?.title ?? "已删除分组"}`
          : ""}
      </Text>
      {content.type === "text" ? (
        <Text
          size="sm"
          style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
        >
          {content.text || "正文为空"}
        </Text>
      ) : content.type === "draft" ? (
        <>
          <Text
            size="sm"
            style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
          >
            {content.prompt || "提示为空"}
          </Text>
          {content.capabilityId && (
            <Text size="sm">模型能力：{content.capabilityId}</Text>
          )}
          {Object.entries(content.output).map(([key, value]) => (
            <Text size="sm" key={key}>
              {{
                aspectRatio: "画幅",
                durationSeconds: "时长（秒）",
                resolution: "分辨率",
                withAudio: "生成声音",
                seed: "随机种子",
              }[key] ?? key}
              ：
              {typeof value === "boolean"
                ? value
                  ? "是"
                  : "否"
                : String(value)}
            </Text>
          ))}
        </>
      ) : (
        <Text size="sm">
          固定素材：{content.mediaId}
          {content.assetRevisionId
            ? ` · 资产版本 ${content.assetRevisionId}`
            : ""}
        </Text>
      )}
    </Stack>
  );
}

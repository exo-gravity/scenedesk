import { Stack, Text } from "@mantine/core";
import type { Schema } from "./api";
import classes from "./image-generation.module.css";
/** Read only the prepared snapshot; navigation and current asset pointers are not sources. */
export function AudioPlanSources({
  resolved,
}: {
  resolved: Schema<"ResolvedInput">;
}) {
  const lines = resolved.shots.flatMap((shot) =>
    (shot.spec.dialogue ?? []).map((line) => ({ shot, line })),
  );
  const voices = resolved.references.filter(
    (item) => item.reference.purpose === "voice",
  );
  const descriptions = (resolved.contextSnapshots ?? []).filter(
    (item) => item.source.kind === "asset_revision",
  );
  return (
    <details>
      <summary>
        固定对白与声音来源（{lines.length} 句 · {voices.length} 个参考）
      </summary>
      <Stack gap="sm" mt="sm">
        <Text size="xs" c="dimmed">
          这些是本次生成依据。结果仍需试听核对，不会自动绑定对白或替换原声音。
        </Text>
        {!lines.length && (
          <Text size="sm">未关联固定对白，可准备独立声音。</Text>
        )}
        {lines.map(({ shot, line }, index) => (
          <Stack gap={4} key={`${shot.shotRevisionId}:${line.id}`}>
            <Text size="sm" className={classes.prose}>
              第 {index + 1} 句：{line.text}
            </Text>
            {line.performance && (
              <Text size="xs" className={classes.prose}>
                表演要求：{line.performance}
              </Text>
            )}
            <Text size="xs" c="dimmed" className={classes.prose}>
              固定镜头要求：{shot.shotRevisionId}
              {line.voiceAssetRevisionId
                ? ` · 单句声音版本：${line.voiceAssetRevisionId}`
                : ""}
            </Text>
          </Stack>
        ))}
        {descriptions.map((snapshot) => (
          <Stack
            gap={4}
            key={`${snapshot.source.objectId}:${snapshot.source.revision}`}
          >
            <Text size="sm" fw={500}>
              固定资产说明
            </Text>
            <Text size="sm" className={classes.prose}>
              {snapshot.text}
            </Text>
            <Text size="xs" c="dimmed" className={classes.prose}>
              固定版本：{snapshot.source.objectId} · r{snapshot.source.revision}
            </Text>
          </Stack>
        ))}
        {voices.map(({ reference }, index) => (
          <Stack
            gap={4}
            key={`${reference.mediaId}:${reference.assetRevisionId ?? ""}:${index}`}
          >
            <Text size="sm">{reference.note || `声音参考 ${index + 1}`}</Text>
            <Text size="xs" c="dimmed" className={classes.prose}>
              素材：{reference.mediaId}
              {reference.assetRevisionId
                ? ` · 固定声音版本：${reference.assetRevisionId}`
                : ""}
            </Text>
          </Stack>
        ))}
      </Stack>
    </details>
  );
}

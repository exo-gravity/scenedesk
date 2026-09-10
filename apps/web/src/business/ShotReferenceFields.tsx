import { useState } from "react";
import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { useResource, type Schema } from "./api";
import { AssetPicker, FixedAssetLabel } from "./CreativeAssetFields";
import { AssetReferenceFields } from "./AssetReferenceFields";
import { MediaPreview } from "./MediaPreview";
import { ErrorNotice, Empty } from "./common";
import { referencePurposes } from "./asset-queries";
import classes from "./assets.module.css";
type Reference = Schema<"Reference">;
export function ShotReferenceFields({
  path,
  projectId,
  value,
  onChange,
}: {
  path: string;
  projectId: string;
  value: Reference[];
  onChange: (value: Reference[]) => void;
}) {
  const [selected, setSelected] = useState<{
      asset: Schema<"Asset">;
      revision: Schema<"AssetRevision">;
    }>(),
    [count, setCount] = useState(12);
  const sources = selected
    ? [
        ...selected.revision.definition.references,
        ...(selected.revision.definition.looks ?? []).flatMap(
          (l) => l.references,
        ),
      ]
    : [];
  const unique = sources.filter(
    (r, i) =>
      sources.findIndex(
        (s) => s.mediaId === r.mediaId && s.purpose === r.purpose,
      ) === i,
  );
  return (
    <Stack>
      <AssetReferenceFields
        path={path}
        projectId={projectId}
        value={value}
        onChange={onChange}
        purpose="composition"
      />
      <AssetPicker
        path={path}
        projectId={projectId}
        mode="revision"
        label="从资产固定版选择参考"
        onChoose={({ asset, revision }) => {
          if (revision) {
            setCount(12);
            setSelected({ asset, revision });
          }
        }}
      />
      <Modal
        title="选择固定版中的参考"
        opened={!!selected}
        onClose={() => setSelected(undefined)}
        size="lg"
      >
        {selected && (
          <Stack>
            <FixedAssetLabel path={path} id={selected.revision.id} />
            <Text size="sm">
              所选素材会记录为此固定版的参考，不随资产后续修订变化。
            </Text>
            {!unique.length && (
              <Empty>
                此版本没有参考素材。可以添加已导入的素材，或先在资产区补充参考并保存新版本。
              </Empty>
            )}
            {unique.slice(0, count).map((source) => {
              const ref: Reference = {
                ...source,
                assetRevisionId: selected.revision.id,
                subjectAssetId: selected.asset.id,
              };
              const duplicate = value.some(
                (r) =>
                  r.mediaId === ref.mediaId &&
                  r.purpose === ref.purpose &&
                  r.assetRevisionId === ref.assetRevisionId &&
                  r.subjectAssetId === ref.subjectAssetId,
              );
              return (
                <FixedMediaChoice
                  key={`${ref.mediaId}/${ref.purpose}`}
                  path={path}
                  reference={ref}
                  duplicate={duplicate}
                  choose={() => {
                    if (!duplicate) onChange([...value, ref]);
                    setSelected(undefined);
                  }}
                />
              );
            })}
            {unique.length > count && (
              <Button onClick={() => setCount((c) => c + 12)}>
                加载更多固定版参考
              </Button>
            )}
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
function FixedMediaChoice({
  path,
  reference,
  duplicate,
  choose,
}: {
  path: string;
  reference: Reference;
  duplicate: boolean;
  choose: () => void;
}) {
  const media = useResource<Schema<"Media">>(
    `${path}/media/${reference.mediaId}`,
  );
  return (
    <div className={classes.referenceRow}>
      <div className={classes.referenceImage}>
        {media.data && !media.isError && (
          <MediaPreview path={path} media={media.data} thumbnail />
        )}
      </div>
      <Stack className={classes.grow} gap="xs">
        <Text size="sm">
          {media.data?.displayName ?? "正在读取素材…"} ·{" "}
          {referencePurposes[reference.purpose]}
        </Text>
        <ErrorNotice error={media.error} />
        <Group>
          <Button
            disabled={
              duplicate || media.isError || media.data?.status !== "ready"
            }
            onClick={choose}
            size="xs"
          >
            {duplicate
              ? "已添加"
              : media.data?.status === "archived"
                ? "已归档，不能新引用"
                : "使用这项固定版参考"}
          </Button>
        </Group>
      </Stack>
    </div>
  );
}

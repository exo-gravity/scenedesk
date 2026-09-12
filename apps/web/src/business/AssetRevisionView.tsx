import { useState } from "react";
import {
  Button,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useResource, type Schema } from "./api";
import { Empty, ErrorNotice } from "./common";
import { MediaPreview } from "./MediaPreview";
import { FixedVoiceLabel } from "./FixedVoiceField";
import { referencePurposes } from "./asset-queries";
import classes from "./assets.module.css";
export function AssetRevisionView({
  revision,
  path,
  tenantId,
}: {
  revision: Schema<"AssetRevision">;
  path: string;
  tenantId: string;
}) {
  const [lookId, setLookId] = useState("root"),
    [selected, setSelected] = useState<string>();
  const definition = revision.definition,
    look = definition.looks?.find((item) => item.id === lookId);
  const references = look?.references ?? definition.references;
  const id = references.some((ref) => ref.mediaId === selected)
    ? selected
    : references[0]?.mediaId;
  const media = useResource<Schema<"Media">>(`${path}/media/${id ?? ""}`, !!id);
  return (
    <Stack gap="md" className={classes.mediaMain}>
      {!!definition.looks?.length && (
        <Select
          label="查看身份或造型参考"
          value={lookId}
          onChange={(value) => {
            if (value) {
              setLookId(value);
              setSelected(undefined);
            }
          }}
          data={[
            { value: "root", label: "身份与主参考" },
            ...definition.looks.map((look) => ({
              value: look.id,
              label: `${look.label} · 造型修订 ${look.revision}`,
            })),
          ]}
        />
      )}
      {id ? (
        <>
          <ErrorNotice error={media.error} retry={() => void media.refetch()} />
          {media.isPending ? (
            <Loader aria-label="正在读取固定参考" />
          ) : (
            media.data &&
            !media.isError && (
              <>
                <MediaPreview
                  key={media.data.id}
                  media={media.data}
                  path={path}
                />
                <Group justify="space-between">
                  <Text>{media.data.displayName}</Text>
                  <Button
                    component="a"
                    variant="subtle"
                    href={`#/app/t/${tenantId}${media.data.projectId ? "/p/" + media.data.projectId : ""}/media?media=${media.data.id}`}
                  >
                    查看素材与来源
                  </Button>
                </Group>
              </>
            )
          )}
        </>
      ) : (
        <Empty>
          这个固定版本尚无{look ? "此造型的" : "主"}参考文件。文字设定仍已保存。
        </Empty>
      )}
      <Group gap="sm">
        {references.map((ref, index) => (
          <UnstyledButton
            key={`${ref.mediaId}/${index}`}
            className={classes.referenceChoice}
            data-selected={ref.mediaId === id || undefined}
            onClick={() => setSelected(ref.mediaId)}
          >
            <Text size="sm">
              {referencePurposes[ref.purpose]} {index + 1}
            </Text>
            {ref.note && (
              <Text size="xs" lineClamp={2}>
                {ref.note}
              </Text>
            )}
          </UnstyledButton>
        ))}
      </Group>
    </Stack>
  );
}

export function AssetRevisionDefinition({
  revision,
  path,
}: {
  revision: Schema<"AssetRevision">;
  path: string;
}) {
  const definition = revision.definition;
  return (
    <Stack gap="md" className={classes.revisionDefinition}>
      <div>
        <Text size="sm" fw={600}>
          固定设定
        </Text>
        <Text size="sm" mt="xs" className={classes.definition}>
          {definition.description || "未填写设定说明"}
        </Text>
      </div>
      {definition.voiceDescription && (
        <div>
          <Text fw={500}>声音说明</Text>
          <Text className={classes.definition}>
            {definition.voiceDescription}
          </Text>
        </div>
      )}
      {definition.defaultVoiceAssetRevisionId && (
        <div>
          <Text fw={500}>默认声音固定版</Text>
          <FixedVoiceLabel
            path={path}
            id={definition.defaultVoiceAssetRevisionId}
          />
        </div>
      )}
    </Stack>
  );
}

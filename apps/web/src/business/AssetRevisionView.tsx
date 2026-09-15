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
import { MediaPreview, mediaKind, mediaStatus } from "./MediaPreview";
import { AssetMediaThumbnail } from "./AssetThumbnail";
import { FixedVoiceLabel } from "./FixedVoiceField";
import { referencePurposes } from "./asset-queries";
import classes from "./asset-details.module.css";
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
    [selected, setSelected] = useState(0),
    [sourceOpen, setSourceOpen] = useState(false);
  const definition = revision.definition,
    look = definition.looks?.find((item) => item.id === lookId);
  const references = look?.references ?? definition.references;
  const selectedIndex = references[selected] ? selected : 0;
  const reference = references[selectedIndex];
  const id = reference?.mediaId;
  const media = useResource<Schema<"Media">>(`${path}/media/${id ?? ""}`, !!id);
  return (
    <Stack gap="md" className={classes.mediaMain}>
      <Group
        justify="space-between"
        align="end"
        className={classes.referenceHeading}
      >
        <div>
          <Text component="h2" className={classes.sectionTitle}>
            参考画面与声音
          </Text>
          <Text size="xs" c="dimmed">
            {look?.label ?? "主参考"} · {references.length} 份固定参考
          </Text>
        </div>
        {!!definition.looks?.length && (
          <Select
            label="参考分组"
            className={classes.lookSelect}
            value={lookId}
            onChange={(value) => {
              if (value) {
                setLookId(value);
                setSelected(0);
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
      </Group>
      {id ? (
        <>
          <ErrorNotice error={media.error} retry={() => void media.refetch()} />
          {media.isPending ? (
            <Loader aria-label="正在读取固定参考" />
          ) : (
            media.data &&
            !media.isError &&
            media.data.id === id && (
              <>
                <MediaPreview
                  key={media.data.id}
                  media={media.data}
                  path={path}
                />
                <div className={classes.referenceCaption}>
                  <Text fw={500} className={classes.definition}>
                    {media.data.displayName}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {referencePurposes[reference!.purpose]}参考 ·{" "}
                    {selectedIndex + 1} / {references.length}
                  </Text>
                  {reference?.note && (
                    <Text size="sm" className={classes.definition}>
                      {reference.note}
                    </Text>
                  )}
                </div>
              </>
            )
          )}
        </>
      ) : (
        <Empty>
          这个固定版本尚无{look ? "此造型的" : "主"}参考文件。文字设定仍已保存。
        </Empty>
      )}
      {!!references.length && (
        <div
          className={classes.referenceStrip}
          role="group"
          aria-label="固定版本参考"
        >
          {references.map((ref, index) => (
            <UnstyledButton
              key={`${ref.mediaId}/${index}`}
              className={classes.referenceChoice}
              data-selected={index === selectedIndex || undefined}
              aria-pressed={index === selectedIndex}
              aria-label={`查看${referencePurposes[ref.purpose]}参考 ${index + 1}`}
              onClick={() => setSelected(index)}
            >
              <div className={classes.referenceThumbnail}>
                <AssetMediaThumbnail path={path} mediaId={ref.mediaId} />
              </div>
              <Text size="sm">
                {referencePurposes[ref.purpose]} {index + 1}
              </Text>
            </UnstyledButton>
          ))}
        </div>
      )}
      {reference && (
        <details
          className={classes.disclosure}
          onToggle={(event) => setSourceOpen(event.currentTarget.open)}
        >
          <summary>素材来源与引用信息</summary>
          {sourceOpen && (
            <Stack gap="sm" mt="md">
              <Text size="sm">
                此处查看的是资产 v{revision.number} 中的
                {referencePurposes[reference.purpose]}
                参考，切换预览不会修改引用。
              </Text>
              {!media.isError && media.data?.id === reference.mediaId && (
                <>
                  <Text size="xs" c="dimmed">
                    {mediaKind[media.data.kind]} ·{" "}
                    {media.data.scope === "shared" ? "工作室共享" : "项目素材"}{" "}
                    · {mediaStatus[media.data.status]}
                  </Text>
                  <Button
                    component="a"
                    className={classes.secondaryAction}
                    variant="subtle"
                    href={`#/app/t/${tenantId}${media.data.projectId ? "/p/" + media.data.projectId : ""}/media?media=${media.data.id}`}
                  >
                    查看素材与来源
                  </Button>
                </>
              )}
              {reference.assetRevisionId && (
                <FixedReferenceSource
                  key={reference.assetRevisionId}
                  path={path}
                  tenantId={tenantId}
                  revisionId={reference.assetRevisionId}
                />
              )}
            </Stack>
          )}
        </details>
      )}
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
        <Text component="h2" className={classes.sectionTitle}>
          设定内容
        </Text>
        <Text mt="sm" className={classes.definition}>
          {definition.description || "未填写设定说明"}
        </Text>
      </div>
      {definition.voiceDescription && (
        <div>
          <Text size="sm" fw={500}>
            声音说明
          </Text>
          <Text className={classes.definition}>
            {definition.voiceDescription}
          </Text>
        </div>
      )}
      {definition.defaultVoiceAssetRevisionId && (
        <details className={classes.disclosure}>
          <summary>默认声音固定版</summary>
          <div className={classes.disclosureBody}>
            <FixedVoiceLabel
              path={path}
              id={definition.defaultVoiceAssetRevisionId}
            />
          </div>
        </details>
      )}
    </Stack>
  );
}

function FixedReferenceSource({
  path,
  tenantId,
  revisionId,
}: {
  path: string;
  tenantId: string;
  revisionId: string;
}) {
  const revision = useResource<Schema<"AssetRevision">>(
    `${path}/asset-revisions/${revisionId}`,
  );
  const asset = useResource<Schema<"Asset">>(
    `${path}/assets/${revision.data?.assetId ?? ""}`,
    !revision.isError && revision.data?.id === revisionId,
  );
  if (revision.isError || asset.isError)
    return (
      <ErrorNotice
        error={revision.error ?? asset.error}
        retry={() => {
          if (revision.isError) void revision.refetch();
          if (asset.isError && revision.data?.id === revisionId)
            void asset.refetch();
        }}
      />
    );
  if (!revision.data || !asset.data)
    return (
      <Text size="sm" c="dimmed">
        正在读取来源固定版本…
      </Text>
    );
  if (
    revision.data.id !== revisionId ||
    asset.data.id !== revision.data.assetId
  )
    return <Text size="sm">来源版本不匹配，请重新打开详情。</Text>;
  return (
    <Button
      component="a"
      variant="subtle"
      className={classes.sourceLink}
      href={`#/app/t/${tenantId}${asset.data.projectId ? "/p/" + asset.data.projectId : ""}/assets?asset=${asset.data.id}&revision=${revisionId}`}
    >
      来源设定：{asset.data.name} · v{revision.data.number}
    </Button>
  );
}

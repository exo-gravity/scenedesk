import { useState } from "react";
import { useDebouncedValue } from "@mantine/hooks";
import {
  ActionIcon,
  Button,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { Plus, Trash } from "@phosphor-icons/react";
import { useResource, type Schema } from "./api";
import { Empty, ErrorNotice } from "./common";
import { MediaPreview, mediaKind } from "./MediaPreview";
import { options, referencePurposes, useAssetPages } from "./asset-queries";
import classes from "./assets.module.css";
import { FixedAssetLabel } from "./CreativeAssetFields";
type Reference = Schema<"Reference">;
export function AssetReferenceFields({
  path,
  projectId,
  value,
  onChange,
  purpose = "identity",
  mediaOnly = false,
  readOnly = false,
}: {
  path: string;
  projectId?: string | undefined;
  value: Reference[];
  onChange: (refs: Reference[]) => void;
  purpose?: Reference["purpose"];
  mediaOnly?: boolean;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Stack gap="sm">
      {value.map((ref, index) => (
        <ReferenceRow
          key={`${ref.mediaId}/${index}`}
          path={path}
          value={ref}
          mediaOnly={mediaOnly}
          readOnly={readOnly}
          onChange={(changed) =>
            onChange(value.map((item, i) => (i === index ? changed : item)))
          }
          remove={() => onChange(value.filter((_, i) => i !== index))}
        />
      ))}
      {!readOnly && (
        <Button leftSection={<Plus size={16} />} onClick={() => setOpen(true)}>
          {mediaOnly ? "添加样片参考" : "添加参考素材"}
        </Button>
      )}
      <Modal
        opened={open}
        onClose={() => setOpen(false)}
        title={mediaOnly ? "选择样片参考" : "选择参考素材"}
        size="xl"
      >
        {open && (
          <MediaChoice
            path={path}
            projectId={projectId}
            purpose={purpose}
            existing={value}
            mediaOnly={mediaOnly}
            onChoose={(media, purpose) => {
              if (
                !value.some(
                  (ref) => ref.mediaId === media.id && ref.purpose === purpose,
                )
              )
                onChange([...value, { mediaId: media.id, purpose }]);
              setOpen(false);
            }}
          />
        )}
      </Modal>
    </Stack>
  );
}
function ReferenceRow({
  path,
  value,
  onChange,
  remove,
  readOnly,
  mediaOnly,
}: {
  path: string;
  value: Reference;
  onChange: (ref: Reference) => void;
  remove: () => void;
  readOnly: boolean;
  mediaOnly: boolean;
}) {
  const media = useResource<Schema<"Media">>(`${path}/media/${value.mediaId}`);
  return (
    <div className={classes.referenceRow}>
      <div className={classes.referenceImage}>
        {media.data && !media.isError ? (
          <MediaPreview path={path} media={media.data} thumbnail />
        ) : (
          <Text size="xs">参考暂不可读</Text>
        )}
      </div>
      <Stack gap="xs" className={classes.grow}>
        <Text fw={500}>
          {media.data && !media.isError
            ? media.data.displayName
            : "原参考已保留"}
        </Text>
        <ErrorNotice error={media.error} />
        {media.data && !media.isError && (
          <Button
            component="a"
            variant="subtle"
            size="compact-xs"
            target="_blank"
            rel="noopener"
            href={`#/app/t/${path.split("/")[3]}${media.data.projectId ? "/p/" + media.data.projectId : ""}/media?media=${media.data.id}`}
          >
            在新标签页查看素材
          </Button>
        )}
        {!mediaOnly &&
          (readOnly ? (
            <Text size="sm">
              用途：{referencePurposes[value.purpose]}
              {value.note ? ` · ${value.note}` : ""}
            </Text>
          ) : (
            <details className={classes.referenceSettings}>
              <summary>
                {referencePurposes[value.purpose]} · 编辑用途与说明
              </summary>
              <Stack gap="sm" mt="sm">
                <Select
                  label="参考用途"
                  data={options(referencePurposes)}
                  value={value.purpose}
                  onChange={(purpose) =>
                    purpose &&
                    onChange({
                      ...value,
                      purpose: purpose as Reference["purpose"],
                    })
                  }
                />
                <TextInput
                  label="参考说明"
                  value={value.note ?? ""}
                  onChange={(event) =>
                    onChange({ ...value, note: event.currentTarget.value })
                  }
                />
              </Stack>
            </details>
          ))}
        {value.assetRevisionId && (
          <FixedAssetLabel path={path} id={value.assetRevisionId} />
        )}
      </Stack>
      {!readOnly && (
        <ActionIcon variant="subtle" aria-label="移除这项参考" onClick={remove}>
          <Trash size={18} />
        </ActionIcon>
      )}
    </div>
  );
}
function MediaChoice({
  path,
  projectId,
  purpose: initial,
  existing,
  onChoose,
  mediaOnly,
}: {
  path: string;
  projectId?: string | undefined;
  purpose: Reference["purpose"];
  existing: Reference[];
  onChoose: (media: Schema<"Media">, purpose: Reference["purpose"]) => void;
  mediaOnly: boolean;
}) {
  const [scope, setScope] = useState(projectId ? "project" : "shared"),
    [q, setQ] = useState(""),
    [purpose, setPurpose] = useState(initial),
    [search] = useDebouncedValue(q, 250);
  const params = new URLSearchParams({
    scope,
    status: "ready",
    q: search,
    ...(scope === "project" && projectId ? { projectId } : {}),
  });
  const media = useAssetPages<Schema<"Media">>(`${path}/media?${params}`);
  return (
    <Stack gap="lg">
      <Group align="end">
        {projectId && (
          <Select
            label="素材范围"
            data={[
              { value: "project", label: "当前项目" },
              { value: "shared", label: "工作室共享" },
            ]}
            value={scope}
            onChange={(value) => value && setScope(value)}
          />
        )}
        <TextInput
          label="查找素材"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        {!mediaOnly && (
          <Select
            label="作为何种参考"
            data={options(referencePurposes)}
            value={purpose}
            onChange={(value) =>
              value && setPurpose(value as Reference["purpose"])
            }
          />
        )}
      </Group>
      <ErrorNotice error={media.error} retry={() => void media.refetch()} />
      {media.isPending ? (
        <Loader aria-label="正在查找素材" />
      ) : (
        !media.isError && (
          <>
            <div className={classes.mediaChoices}>
              {media.data?.pages
                .flatMap((page) => page.items)
                .map((item) => (
                  <UnstyledButton
                    type="button"
                    className={classes.mediaChoice}
                    key={item.id}
                    disabled={existing.some(
                      (ref) =>
                        ref.mediaId === item.id && ref.purpose === purpose,
                    )}
                    onClick={() => onChoose(item, purpose)}
                    aria-label={`添加参考 ${item.displayName}`}
                  >
                    <MediaPreview path={path} media={item} thumbnail />
                    <Text fw={500}>{item.displayName}</Text>
                    <Text size="xs" c="dimmed">
                      {mediaKind[item.kind]} · {referencePurposes[purpose]}
                      {existing.some(
                        (ref) =>
                          ref.mediaId === item.id && ref.purpose === purpose,
                      )
                        ? " · 已添加"
                        : ""}
                    </Text>
                  </UnstyledButton>
                ))}
            </div>
            {!media.data?.pages.some((page) => page.items.length) && (
              <Empty>没有可添加的素材。先到素材区导入文件并等待验收。</Empty>
            )}
            {media.hasNextPage && (
              <Button
                loading={media.isFetchingNextPage}
                onClick={() => void media.fetchNextPage()}
              >
                加载更多素材
              </Button>
            )}
          </>
        )
      )}
    </Stack>
  );
}

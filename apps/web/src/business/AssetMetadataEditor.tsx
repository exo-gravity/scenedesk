import { useState } from "react";
import {
  Alert,
  Button,
  Fieldset,
  Group,
  Stack,
  TagsInput,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useCommand, type Schema } from "./api";
import { DraftNotice, useContentDraft } from "./content-drafts";
import { ErrorNotice } from "./common";
import classes from "./assets.module.css";
export function AssetMetadataEditor({
  asset,
  path,
  done,
}: {
  asset: Schema<"Asset">;
  path: string;
  done: () => void;
}) {
  const current = {
    name: asset.name,
    description: asset.description ?? "",
    tags: asset.tags ?? [],
  };
  const [initial] = useState(current),
    [error, setError] = useState<Error>();
  const draft = useContentDraft(
      `${path}/assets/${asset.id}/metadata`,
      { base: initial, input: initial },
      asset.revision,
    ),
    command = useCommand<Schema<"Asset">>();
  const stale = draft.baseVersion !== asset.revision,
    value = draft.value.input;
  const set = <K extends keyof typeof current>(
    key: K,
    value: (typeof current)[K],
  ) =>
    draft.setValue((old) => ({
      ...old,
      input: { ...old.input, [key]: value },
    }));
  return (
    <form
      className={classes.editor}
      onSubmit={(event) => {
        event.preventDefault();
        if (command.isPending || stale || !draft.ready || draft.recovered)
          return;
        if (!value.name.trim()) {
          setError(new Error("请填写资产名称。"));
          return;
        }
        command.mutate(
          {
            path: `${path}/assets/${asset.id}`,
            method: "PATCH",
            version: draft.baseVersion,
            body: value,
          },
          {
            onSuccess: async () => {
              await draft.clear();
              done();
            },
          },
        );
      }}
    >
      <Fieldset variant="unstyled" disabled={command.isPending}>
        <Stack gap="md">
          <Text fw={600}>检索名称与标签</Text>
          <DraftNotice draft={draft} />
          <ErrorNotice error={command.error ?? error ?? null} />
          {stale && (
            <Alert title="服务器已更新，当前输入已保留">
              <Text>服务器名称：{current.name}</Text>
              <Text>服务器说明：{current.description || "未填写"}</Text>
              <Text>服务器标签：{current.tags.join("、") || "无"}</Text>
              <Button
                mt="sm"
                onClick={() => {
                  const input = { ...value };
                  for (const key of Object.keys(
                    current,
                  ) as (keyof typeof current)[])
                    if (
                      JSON.stringify(value[key]) ===
                      JSON.stringify(draft.value.base[key])
                    )
                      Object.assign(input, { [key]: current[key] });
                  draft.setValue({ base: current, input });
                  draft.rebase();
                }}
              >
                已核对，继续基于当前版本
              </Button>
            </Alert>
          )}
          <TextInput
            required
            label="资产名称"
            maxLength={160}
            value={value.name}
            onChange={(e) => set("name", e.currentTarget.value)}
          />
          <Textarea
            label="检索说明"
            description="用于查找资产，不改变已有固定设定。"
            autosize
            minRows={2}
            maxLength={20000}
            value={value.description}
            onChange={(e) => set("description", e.currentTarget.value)}
          />
          <TagsInput
            label="标签"
            maxTags={50}
            value={value.tags}
            onChange={(tags) => set("tags", tags)}
          />
          <Group>
            <Button
              type="submit"
              variant="filled"
              loading={command.isPending}
              disabled={stale || !draft.ready || !!draft.recovered}
            >
              保存检索信息
            </Button>
            <Button onClick={done}>收起，保留本机草稿</Button>
          </Group>
        </Stack>
      </Fieldset>
    </form>
  );
}

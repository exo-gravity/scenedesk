import { useState } from "react";
import {
  Alert,
  Button,
  Fieldset,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { useCommand, type Schema } from "./api";
import { ErrorNotice } from "./common";
import { DraftNotice, useContentDraft } from "./content-drafts";
import { FixedAssetLabel, FixedAssetList } from "./CreativeAssetFields";
import { reconcileContent } from "./content-reconcile";
import classes from "./workbench.module.css";
type Production = Schema<"Production">;
type Props = { production: Production; path: string; active: boolean };
export function ProductionSettings(props: Props) {
  const [accepted, setAccepted] = useState<Production>(),
    [epoch, setEpoch] = useState(0);
  const current =
    accepted && accepted.revision > props.production.revision
      ? accepted
      : props.production;
  return (
    <Stack>
      {accepted && <Text role="status">剧目设定已保存。</Text>}
      <ProductionEditor
        key={epoch}
        {...props}
        production={current}
        saved={(value) => {
          setAccepted(value);
          setEpoch((e) => e + 1);
        }}
      />
    </Stack>
  );
}
function ProductionEditor({
  production,
  path,
  active,
  saved,
}: Props & { saved: (value: Production) => void }) {
  const source = {
    title: production.title,
    brief: production.brief,
    defaultAssetRevisionIds: production.defaultAssetRevisionIds,
  };
  const draft = useContentDraft(
      `${path}/settings`,
      { base: source, input: source },
      production.revision,
    ),
    command = useCommand<Production>();
  const input = draft.value.input,
    conflict = draft.baseVersion !== production.revision;
  const setText = (key: "title" | "brief", text: string) =>
    draft.setValue((v) => ({ ...v, input: { ...v.input, [key]: text } }));
  const tenantPath = path.split("/projects/")[0]!;
  return (
    <form
      className={classes.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (
          conflict ||
          !active ||
          !draft.ready ||
          draft.recovered ||
          !input.title.trim()
        )
          return;
        command.mutate(
          { path, method: "PUT", body: input, version: draft.baseVersion },
          {
            onSuccess: async (value) => {
              await draft.clear();
              saved(value);
            },
          },
        );
      }}
    >
      <Stack>
        <DraftNotice draft={draft} />
        {conflict && (
          <Alert title="剧目设定已更新">
            <Text>
              当前输入仍保留。核对后保留我的修改，未修改字段采用服务器值。
            </Text>
            <Text>
              {production.title} · {production.brief || "未填写创作设定"}
            </Text>
            {production.defaultAssetRevisionIds.map((id) => (
              <FixedAssetLabel key={id} path={tenantPath} id={id} />
            ))}
            <Button
              mt="sm"
              onClick={() => {
                draft.setValue({
                  base: source,
                  input: reconcileContent(draft.value.base, input, source),
                });
                draft.rebase();
              }}
            >
              核对后使用最新版本作为保存基线
            </Button>
          </Alert>
        )}
        <Fieldset
          variant="unstyled"
          disabled={
            !active || !draft.ready || !!draft.recovered || command.isPending
          }
        >
          <Stack>
            <TextInput
              label="剧目名称"
              required
              maxLength={160}
              value={input.title}
              onChange={(e) => setText("title", e.currentTarget.value)}
            />
            <Textarea
              label="故事与创作设定"
              minRows={5}
              autosize
              maxLength={20000}
              value={input.brief}
              onChange={(e) => setText("brief", e.currentTarget.value)}
            />
            <Text fw={600}>剧目默认资产</Text>
            <FixedAssetList
              path={tenantPath}
              projectId={production.projectId}
              value={input.defaultAssetRevisionIds}
              onChange={(ids) =>
                draft.setValue((v) => ({
                  ...v,
                  input: { ...v.input, defaultAssetRevisionIds: ids },
                }))
              }
            />
          </Stack>
        </Fieldset>
        <ErrorNotice error={command.error} />
        {active && (
          <Button
            variant="filled"
            type="submit"
            loading={command.isPending}
            disabled={
              conflict ||
              !draft.ready ||
              !!draft.recovered ||
              !input.title.trim()
            }
          >
            保存剧目设定
          </Button>
        )}
      </Stack>
    </form>
  );
}

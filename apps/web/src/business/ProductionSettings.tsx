import { useState } from "react";
import {
  Alert,
  Button,
  Fieldset,
  Group,
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
import layout from "./content.module.css";
type Production = Schema<"Production">;
type Props = {
  production: Production;
  path: string;
  active: boolean;
  presentation?: "editor" | "summary";
};
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
  presentation = "editor",
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
  const [editing, setEditing] = useState(presentation === "editor");
  const showEditor = editing || !!draft.recovered || conflict;
  if (draft.committed) return <DraftNotice draft={draft} />;
  return (
    <form
      className={`${classes.form} ${presentation === "summary" ? layout.storySettings : ""}`}
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
            onCommitted: (value) => void draft.complete(() => saved(value)),
          },
        );
      }}
    >
      <Stack>
        <DraftNotice draft={draft} />
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            故事设定 · r{production.revision}
            {draft.dirty ? " · 本机有修改" : ""}
          </Text>
          {presentation === "summary" && (
            <Button
              disabled={!draft.ready || !!draft.recovered || command.isPending}
              variant="subtle"
              onClick={() => setEditing(!editing)}
            >
              {showEditor ? "阅读设定" : "编辑设定"}
            </Button>
          )}
        </Group>
        {!showEditor && (
          <article className={layout.readingPaper}>
            <Text component="h2" className={layout.storyTitle}>
              {input.title}
            </Text>
            <div className={layout.readingText}>
              {input.brief || "写下这个故事的主题、人物关系与画面风格。"}
            </div>
            <div className={layout.storyReferences}>
              <Text fw={600} mb="md">
                默认参考
              </Text>
              {input.defaultAssetRevisionIds.length ? (
                input.defaultAssetRevisionIds.map((id) => (
                  <FixedAssetLabel key={id} path={tenantPath} id={id} />
                ))
              ) : (
                <Text c="dimmed">尚未设置默认资产</Text>
              )}
            </div>
          </article>
        )}
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
          hidden={!showEditor}
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
        {active && showEditor && (
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

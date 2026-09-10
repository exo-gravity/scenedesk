import { useState } from "react";
import { Alert, Button, Fieldset, Stack, Text } from "@mantine/core";
import { useCommand, type Schema } from "./api";
import { DraftNotice, useContentDraft } from "./content-drafts";
import { ErrorNotice } from "./common";
import { AssetReferenceFields } from "./AssetReferenceFields";
import { reconcileContent } from "./content-reconcile";
import classes from "./workbench.module.css";
type Project = Schema<"Project">;
type Props = { project: Project; path: string; active: boolean };
export function QualityReferenceSettings(props: Props) {
  const [accepted, setAccepted] = useState<Project>(),
    [epoch, setEpoch] = useState(0);
  const current =
    accepted && accepted.revision > props.project.revision
      ? accepted
      : props.project;
  return (
    <Stack className={classes.form}>
      <Text fw={600}>项目样片参考</Text>
      <Text size="sm" c="dimmed">
        导入的参考片用于核对目标质量与风格，不代表本项目成片已通过验收。
      </Text>
      {accepted && <Text role="status">样片参考已保存。</Text>}
      <QualityEditor
        key={epoch}
        {...props}
        project={current}
        saved={(p) => {
          setAccepted(p);
          setEpoch((e) => e + 1);
        }}
      />
    </Stack>
  );
}
function QualityEditor({
  project,
  path,
  active,
  saved,
}: Props & { saved: (value: Project) => void }) {
  const source = project.spec.qualityReferenceMediaIds ?? [];
  const draft = useContentDraft(
      `${path}/quality-references`,
      { base: source, input: source },
      project.revision,
    ),
    command = useCommand<Project>();
  const conflict = draft.baseVersion !== project.revision;
  const refs = (ids: string[]): Schema<"Reference">[] =>
    ids.map((mediaId) => ({ mediaId, purpose: "composition" }));
  if (draft.committed) return <DraftNotice draft={draft} />;
  return (
    <Stack>
      <DraftNotice draft={draft} />
      {conflict && (
        <Alert title="项目设置已更新">
          <Text>
            核对服务器样片后，保留我的增删并合并其他人的新增参考。项目名称与其他规格使用最新值。
          </Text>
          <AssetReferenceFields
            path={path.split("/projects/")[0]!}
            projectId={project.id}
            value={refs(source)}
            onChange={() => {}}
            readOnly
            mediaOnly
          />
          <Button
            mt="sm"
            onClick={() => {
              draft.setValue({
                base: source,
                input: reconcileContent(
                  draft.value.base,
                  draft.value.input,
                  source,
                ),
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
        disabled={!draft.ready || !!draft.recovered || command.isPending}
      >
        <AssetReferenceFields
          path={path.split("/projects/")[0]!}
          projectId={project.id}
          value={refs(draft.value.input)}
          readOnly={!active}
          mediaOnly
          purpose="composition"
          onChange={(refs) =>
            draft.setValue((v) => ({
              ...v,
              input: [...new Set(refs.map((r) => r.mediaId))],
            }))
          }
        />
      </Fieldset>
      <ErrorNotice error={command.error} />
      {active && (
        <Button
          loading={command.isPending}
          disabled={conflict || !draft.ready || !!draft.recovered}
          onClick={() =>
            command.mutate(
              {
                path,
                method: "PATCH",
                version: draft.baseVersion,
                body: {
                  name: project.name,
                  spec: {
                    ...project.spec,
                    qualityReferenceMediaIds: draft.value.input,
                  },
                },
              },
              {
                onCommitted: (p) => void draft.complete(() => saved(p)),
              },
            )
          }
        >
          保存样片参考
        </Button>
      )}
    </Stack>
  );
}

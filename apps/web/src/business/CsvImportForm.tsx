import { useState } from "react";
import {
  Alert,
  Button,
  FileInput,
  Group,
  Select,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { FileCsv } from "@phosphor-icons/react";
import { useCommand, type Schema } from "./api";
import { DraftNotice, useContentDraft } from "./content-drafts";
import { ErrorNotice } from "./common";
import {
  activeScenes,
  sceneOptions,
  type Props,
  type Proposal,
} from "./proposal-model";
import classes from "./proposals.module.css";
const template =
  "episode,scene,shot_label,intent,dialogue,duration_seconds,notes\n第一集,旧公寓,01,女主寻找旧钥匙,钥匙在哪里？,4.2,中景\n第一集,旧公寓,02,发现桌上的纸张,,2,特写";
export function ImportForm({
  path,
  tree,
  active,
  initialSceneId,
  onCreated,
}: Props & { onCreated: (id: string) => void }) {
  const available = activeScenes(tree);
  const draft = useContentDraft(
    `${path}/shot-list-imports`,
    {
      csvText: "",
      mode: initialSceneId ? "append_to_scene" : "new_structure",
      sceneId: initialSceneId ?? "",
    },
    tree.revision,
  );
  const command = useCommand<Proposal>(),
    [fileError, setFileError] = useState<string>(),
    [fileLoading, setFileLoading] = useState(false);
  const value = draft.value,
    stale = draft.baseVersion !== tree.revision;
  const update = (change: Partial<typeof value>) =>
    draft.setValue((v) => ({ ...v, ...change }));
  async function read(file: File | null) {
    if (!file) return;
    setFileLoading(true);
    setFileError(undefined);
    try {
      if (file.size > 2_000_003)
        throw new Error("CSV 文件过大，最多 500,000 个字符。");
      const csvText = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      if (Array.from(csvText).length > 500_000)
        throw new Error("CSV 最多包含 500,000 个字符。");
      update({ csvText });
    } catch (e) {
      setFileError(
        e instanceof Error ? e.message : "文件读取失败，请使用 UTF-8 CSV。",
      );
    } finally {
      setFileLoading(false);
    }
  }
  function submit() {
    const scene = available.find((s) => s.id === value.sceneId);
    if (
      !active ||
      !draft.ready ||
      draft.recovered ||
      stale ||
      fileLoading ||
      !value.csvText.trim()
    )
      return;
    if (value.mode === "append_to_scene" && !scene) {
      setFileError("所选场次已不可用，请重新选择追加场次或明确改为新建结构。");
      return;
    }
    const target: Schema<"ProposalTarget"> =
      value.mode === "append_to_scene" && scene
        ? {
            mode: "append_to_scene",
            sceneId: scene.id,
            sceneRevision: scene.revision,
            episodeId: scene.episodeId,
          }
        : { mode: "new_structure" };
    command.mutate(
      {
        path: `${path}/shot-list-imports`,
        version: draft.baseVersion,
        body: { csvText: value.csvText, target },
      },
      {
        onCommitted: (p) => void draft.complete(() => onCreated(p.id)),
      },
    );
  }
  if (draft.committed) return <DraftNotice draft={draft} />;
  return (
    <Stack gap="lg">
      <DraftNotice draft={draft} />
      {value.mode === "append_to_scene" &&
        !available.some((s) => s.id === value.sceneId) && (
          <Alert title="所选追加场次不可用">
            请重新选择场次，或明确将导入目标改为新建结构。CSV 内容仍保留。
          </Alert>
        )}
      <ErrorNotice error={command.error} />
      <div className={classes.columns}>
        <Stack>
          <Select
            label="导入目标"
            value={value.mode}
            onChange={(v) => update({ mode: v ?? "new_structure" })}
            data={[
              { value: "new_structure", label: "新建集场镜结构" },
              {
                value: "append_to_scene",
                label: "追加镜头到指定场次",
                disabled: !available.length,
              },
            ]}
          />
          {value.mode === "append_to_scene" && (
            <>
              <Select
                required
                label="目标场次"
                searchable
                value={value.sceneId}
                onChange={(v) => update({ sceneId: v ?? "" })}
                data={sceneOptions(tree)}
              />
              <Text size="sm" c="dimmed">
                CSV
                须来自一个场次。预览中的所有镜头将明确映射到所选场次，并排在现有镜头之后。
              </Text>
            </>
          )}
          <FileInput
            label="选择 UTF-8 CSV 文件"
            accept=".csv,text/csv"
            onChange={(file) => void read(file)}
            disabled={fileLoading}
            error={fileError}
            leftSection={<FileCsv size={18} />}
          />
          <Button
            component="a"
            href={`data:text/csv;charset=utf-8,${encodeURIComponent("\uFEFF" + template)}`}
            download="scenedesk-shot-list.csv"
            variant="subtle"
            w="fit-content"
          >
            下载导入模板
          </Button>
        </Stack>
        <div className={classes.mapping}>
          <Text fw={600}>固定列映射</Text>
          <dl>
            <dt>episode / scene</dt>
            <dd>单集 / 来源场次</dd>
            <dt>shot_label / intent</dt>
            <dd>镜头编号 / 叙事意图</dd>
            <dt>dialogue（可选）</dt>
            <dd>台词，按原文保留</dd>
            <dt>duration_seconds（可选）</dt>
            <dd>预计秒数，最多六位小数</dd>
            <dt>notes（可选）</dt>
            <dd>制作说明</dd>
          </dl>
          <Text size="sm" c="dimmed">
            前四列必填。支持带引号的逗号和换行；格式错误会给出行号，修正后重新预览。
          </Text>
        </div>
      </div>
      <Textarea
        label="CSV 内容"
        description="可以直接粘贴，也可以选择文件后在这里核对。"
        value={value.csvText}
        onChange={(e) => update({ csvText: e.currentTarget.value })}
        autosize
        minRows={8}
        maxRows={20}
      />
      {stale && (
        <Alert title="内容版本已变化">
          <Text>
            打开导入时为版本 {draft.baseVersion}，现在为 {tree.revision}。当前有{" "}
            {tree.episodes.length} 集、{tree.scenes.length} 场、
            {tree.shots.length} 镜。请返回集场镜核对，再明确使用当前版本。
          </Text>
          <Button mt="md" variant="default" onClick={draft.rebase}>
            已核对，使用当前内容版本
          </Button>
        </Alert>
      )}
      <Group>
        <Button
          loading={command.isPending}
          disabled={
            !active ||
            !draft.ready ||
            !!draft.recovered ||
            stale ||
            !value.csvText.trim() ||
            fileLoading ||
            (value.mode === "append_to_scene" &&
              !available.some((s) => s.id === value.sceneId))
          }
          onClick={submit}
        >
          生成导入预览
        </Button>
        <Text size="sm" c="dimmed">
          这一步保存提案，采纳后才会创建集场镜。
        </Text>
      </Group>
    </Stack>
  );
}

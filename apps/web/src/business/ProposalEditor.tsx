import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { PencilSimple } from "@phosphor-icons/react";
import { useCommand, type Schema } from "./api";
import { DraftNotice, useContentDraft } from "./content-drafts";
import { ErrorNotice, SectionHeading } from "./common";
import {
  activeScenes,
  sceneOptions,
  kindName,
  title,
  type Props,
  type Tree,
  type Proposal,
  type Operation,
} from "./proposal-model";
import {
  ParentLabel,
  ShotPreview,
  ContentChanges,
  ProposalChanges,
} from "./ProposalPreview";
import classes from "./proposals.module.css";
export function ProposalEditor({
  path,
  tree,
  active,
  proposal,
  current,
  historical,
  onSaved,
  initialSelection,
}: Props & {
  proposal: Proposal;
  current: Proposal;
  historical: boolean;
  initialSelection: string[];
  onSaved: (selected: string[]) => void;
}) {
  const initial = {
    edit: {
      operations: proposal.operations,
      target: proposal.target,
      baseContentRevision: proposal.baseContentRevision,
    } as Schema<"ProposalEdit">,
    selected: [] as string[],
  };
  // A saved content revision is clean; its still-unapplied selection remains a local draft.
  const draft = useContentDraft(
    `${path}/proposals/${proposal.id}${historical ? `/history/${proposal.revision}` : ""}`,
    initial,
    proposal.revision,
    {
      ...initial,
      selected: initialSelection.filter((id) =>
        proposal.operations.some((op) => op.opId === id),
      ),
    },
  );
  const command = useCommand<Proposal>(),
    apply = useCommand<Tree>(),
    [editingId, setEditingId] = useState<string>(),
    [confirm, setConfirm] = useState(false);
  const { edit: localEdit, selected } = draft.value;
  const readOnly = historical || current.status !== "proposed" || !active;
  const edit = readOnly
    ? {
        operations: proposal.operations,
        target: proposal.target,
        baseContentRevision: proposal.baseContentRevision,
      }
    : localEdit;
  const modified =
    JSON.stringify(edit) !==
    JSON.stringify({
      operations: proposal.operations,
      target: proposal.target,
      baseContentRevision: proposal.baseContentRevision,
    });
  const conflict = draft.baseVersion !== current.revision,
    stale = edit.baseContentRevision !== tree.revision;
  const update = (change: Partial<Schema<"ProposalEdit">>) =>
    draft.setValue((v) => ({ ...v, edit: { ...v.edit, ...change } }));
  const editing = edit.operations.find((op) => op.opId === editingId);
  const selectedOps = edit.operations.filter((op) =>
    selected.includes(op.opId),
  );
  const duplicateNames =
    edit.target.mode === "new_structure"
      ? selectedOps
          .filter((op) =>
            op.kind === "episode"
              ? tree.episodes.some((e) => e.title === title(op))
              : op.kind === "scene"
                ? tree.scenes.some((e) => e.title === title(op))
                : tree.shots.some((e) => e.label === title(op)),
          )
          .map((op) => `${kindName[op.kind]} ${title(op)}`)
      : [];
  const missing =
    edit.target.mode === "new_structure"
      ? selectedOps.filter((op) => {
          const parent =
            "episodeId" in op.proposed
              ? op.proposed.episodeId
              : "sceneId" in op.proposed
                ? op.proposed.sceneId
                : undefined;
          return parent && !selectedOps.some((p) => p.temporaryId === parent);
        })
      : [];
  const targetScene =
    edit.target.mode === "append_to_scene"
      ? activeScenes(tree).find(
          (s) => s.id === (edit.target as { sceneId: string }).sceneId,
        )
      : undefined;
  const invalidTarget =
    edit.target.mode === "append_to_scene" &&
    (!targetScene ||
      targetScene.revision !== edit.target.sceneRevision ||
      targetScene.episodeId !== edit.target.episodeId);
  function rebase() {
    const target = targetScene
      ? {
          mode: "append_to_scene" as const,
          sceneId: targetScene.id,
          sceneRevision: targetScene.revision,
          episodeId: targetScene.episodeId,
        }
      : edit.target;
    update({ baseContentRevision: tree.revision, target });
  }
  function save() {
    command.mutate(
      {
        path: `${path}/proposals/${proposal.id}`,
        method: "PUT",
        version: draft.baseVersion,
        body: edit,
      },
      {
        onCommitted: () => void draft.complete(() => onSaved(selected)),
      },
    );
  }
  function adopt() {
    apply.mutate(
      {
        path: `${path}/proposals/${proposal.id}/apply`,
        version: tree.revision,
        body: {
          proposalRevision: current.revision,
          selectedOperationIds: selected,
        },
      },
      {
        onCommitted: () => void draft.complete(() => setConfirm(false)),
      },
    );
  }
  if (draft.committed) return <DraftNotice draft={draft} />;
  if (command.isPending || apply.isPending)
    return (
      <Text role="status">
        {apply.isPending ? "正在确认采纳结果…" : "正在保存提案修订…"}
      </Text>
    );
  if (editing && !readOnly)
    return (
      <OperationEditor
        key={editing.opId}
        path={`${path}/proposals/${proposal.id}/operations/${editing.opId}`}
        version={draft.baseVersion}
        operation={editing}
        onCancel={() => setEditingId(undefined)}
        onSave={(op) =>
          draft.stage({
            ...draft.value,
            edit: {
              ...edit,
              operations: edit.operations.map((old) =>
                old.opId === op.opId ? op : old,
              ),
            },
          })
        }
      />
    );
  return (
    <Stack gap="lg">
      {historical && (
        <Alert title="历史修订只读">
          这里保留当时的提案内容，生命周期状态以当前提案为准。
          {current.application &&
            `实际采纳使用第 ${current.application.proposalRevision} 版。`}
        </Alert>
      )}
      {current.status === "applied" && (
        <Alert title="本提案已采纳">
          已创建内容可在集场镜中继续编辑。未选项仍保留在本提案历史中。
        </Alert>
      )}
      {!readOnly && <DraftNotice draft={draft} />}
      {readOnly &&
        !historical &&
        JSON.stringify(localEdit) !== JSON.stringify(edit) && (
          <Alert title="另有未提交的本地修改">
            <Text>以下草稿没有进入已保存的提案或采纳结果，仍保留在本机。</Text>
            <ProposalChanges
              before={localEdit.operations}
              after={proposal.operations}
            />
          </Alert>
        )}
      <ErrorNotice error={command.error ?? apply.error} />
      <Text>
        目标：
        {edit.target.mode === "new_structure"
          ? "新建集场镜结构"
          : (tree.scenes.find(
              (s) => s.id === (edit.target as { sceneId: string }).sceneId,
            )?.title ?? "指定场次")}{" "}
        · 基于内容版本 {edit.baseContentRevision}
      </Text>
      {conflict && !readOnly && (
        <Alert title="提案已被其他人修改">
          <Text>
            本地草稿基于第 {draft.baseVersion} 版，服务器已是第{" "}
            {current.revision} 版。请先打开当前修订核对；本地修改会继续保留。
          </Text>
          <ProposalChanges
            before={edit.operations}
            after={current.operations}
          />
          <Group mt="md">
            <Button variant="default" onClick={draft.rebase}>
              已核对，以本地内容建立新修订
            </Button>
            <Button variant="subtle" onClick={() => onSaved(selected)}>
              重新打开服务器修订
            </Button>
          </Group>
        </Alert>
      )}
      {(stale || invalidTarget) && !readOnly && (
        <Alert title="采纳前需要复核内容变化">
          <ContentChanges before={proposal.baseContentSnapshot} after={tree} />
          <Text mt="sm">明确更新基线后，还需保存为新的提案修订。</Text>
          <Button
            mt="md"
            variant="default"
            disabled={edit.target.mode === "append_to_scene" && !targetScene}
            onClick={rebase}
          >
            已核对变化，更新提案基线
          </Button>
        </Alert>
      )}
      {!readOnly && edit.target.mode === "append_to_scene" && (
        <Select
          label="追加目标场次"
          description="改变目标会明确重映射本提案内所有新镜头。"
          data={sceneOptions(tree)}
          value={edit.target.sceneId}
          onChange={(id) => {
            const scene = activeScenes(tree).find((s) => s.id === id);
            if (scene)
              update({
                target: {
                  mode: "append_to_scene",
                  sceneId: scene.id,
                  sceneRevision: scene.revision,
                  episodeId: scene.episodeId,
                },
                operations: edit.operations.map((op) => ({
                  ...op,
                  proposed: {
                    ...(op.proposed as Schema<"ShotInput">),
                    sceneId: scene.id,
                  },
                })),
              });
          }}
        />
      )}
      {!readOnly && (
        <Group>
          <Button
            variant="default"
            onClick={() =>
              draft.setValue((v) => ({
                ...v,
                selected: edit.operations.map((op) => op.opId),
              }))
            }
          >
            全选
          </Button>
          <Button
            variant="subtle"
            onClick={() => draft.setValue((v) => ({ ...v, selected: [] }))}
          >
            清空选择
          </Button>
          <Text size="sm" c="dimmed">
            已选 {selectedOps.length} / {edit.operations.length} 项
          </Text>
        </Group>
      )}
      <div className={classes.list}>
        {edit.operations.map((op) => (
          <article
            className={classes.row}
            key={op.opId}
            aria-label={`${kindName[op.kind]}建议 · ${title(op)}`}
          >
            <Group justify="space-between" align="start">
              <Group align="start">
                {!readOnly && (
                  <Checkbox
                    aria-label={`采纳${kindName[op.kind]} ${title(op)}`}
                    checked={selected.includes(op.opId)}
                    onChange={(e) => {
                      const checked = e.currentTarget.checked;
                      draft.setValue((v) => ({
                        ...v,
                        selected: checked
                          ? [...v.selected, op.opId]
                          : v.selected.filter((id) => id !== op.opId),
                      }));
                      setConfirm(false);
                    }}
                  />
                )}
                <div>
                  <Text fw={600}>
                    {kindName[op.kind]} · {title(op)}
                  </Text>
                  {current.application && (
                    <Badge variant="light">
                      {current.application.createdObjects[op.opId]
                        ? "已创建"
                        : "未采纳"}
                    </Badge>
                  )}
                  <ParentLabel
                    operation={op}
                    operations={edit.operations}
                    tree={tree}
                  />
                </div>
              </Group>
              {!readOnly && (
                <Button
                  size="xs"
                  variant="subtle"
                  leftSection={<PencilSimple size={16} />}
                  onClick={() => setEditingId(op.opId)}
                >
                  修改{title(op)}
                </Button>
              )}
            </Group>
            {op.kind === "shot" && (
              <ShotPreview spec={(op.proposed as Schema<"ShotInput">).spec} />
            )}
            {op.kind === "scene" && (
              <Text mt="sm" className={classes.prose}>
                {(op.proposed as Schema<"SceneInput">).summary}
              </Text>
            )}
            {!!op.sourceExcerpts?.length && (
              <Text size="sm" c="dimmed" className={classes.prose}>
                来源原文：{op.sourceExcerpts.map((e) => e.quote).join("\n")}
              </Text>
            )}
          </article>
        ))}
      </div>
      {!readOnly && (
        <>
          {!!missing.length && (
            <Alert title="还缺少父项">
              所选内容中有 {missing.length}{" "}
              项缺少所属单集或场次。请补选对应父项。
            </Alert>
          )}
          {modified ? (
            <Group>
              <Button
                onClick={save}
                loading={command.isPending}
                disabled={
                  conflict || stale || invalidTarget || !!draft.recovered
                }
              >
                保存提案修订
              </Button>
              <Text size="sm" c="dimmed">
                保存后保留勾选，继续核对采纳；现有集场镜保持原样。
              </Text>
            </Group>
          ) : (
            <Group>
              <Button
                disabled={
                  conflict ||
                  stale ||
                  invalidTarget ||
                  !selectedOps.length ||
                  !!missing.length ||
                  !!draft.recovered
                }
                onClick={() => setConfirm(true)}
              >
                检查采纳结果
              </Button>
            </Group>
          )}
          {confirm && !modified && (
            <Alert title="确认本次新增内容">
              {!!duplicateNames.length && (
                <Text fw={600} className={classes.prose}>
                  已有同名内容：{duplicateNames.join("、")}
                  。此次会新增独立结构，不合并到同名对象。
                </Text>
              )}
              <Text>
                将新建{" "}
                {selectedOps.filter((op) => op.kind === "episode").length} 集、
                {selectedOps.filter((op) => op.kind === "scene").length} 场、
                {selectedOps.filter((op) => op.kind === "shot").length}{" "}
                镜。未选项保留在历史；本提案采纳后不能再次追加另一组选择。
              </Text>
              <Group mt="md">
                <Button
                  loading={apply.isPending}
                  disabled={
                    conflict ||
                    stale ||
                    invalidTarget ||
                    !selectedOps.length ||
                    !!missing.length
                  }
                  onClick={adopt}
                >
                  确认采纳并创建
                </Button>
                <Button variant="subtle" onClick={() => setConfirm(false)}>
                  继续检查
                </Button>
              </Group>
            </Alert>
          )}
        </>
      )}
    </Stack>
  );
}
function OperationEditor({
  path,
  version,
  operation,
  onSave,
  onCancel,
}: {
  path: string;
  version: number;
  operation: Operation;
  onSave: (op: Operation) => Promise<boolean>;
  onCancel: () => void;
}) {
  const draft = useContentDraft(
    path,
    {
      op: structuredClone(operation),
      duration:
        operation.kind === "shot" &&
        (operation.proposed as Schema<"ShotInput">).spec.plannedDurationUs !==
          undefined
          ? String(
              (operation.proposed as Schema<"ShotInput">).spec
                .plannedDurationUs! / 1_000_000,
            )
          : "",
    },
    version,
  );
  const { op, duration } = draft.value,
    [error, setError] = useState<string>();
  const setOp = (change: (op: Operation) => Operation) =>
    draft.setValue((v) => ({ ...v, op: change(v.op) }));
  const setDuration = (duration: string) =>
    draft.setValue((v) => ({ ...v, duration }));
  const spec =
    op.kind === "shot" ? (op.proposed as Schema<"ShotInput">).spec : undefined;
  const change = (body: Record<string, unknown>) =>
    setOp((old) => ({ ...old, proposed: { ...old.proposed, ...body } }));
  const changeSpec = (body: Partial<Schema<"ShotSpec">>) =>
    change({ spec: { ...spec!, ...body } });
  async function finish() {
    const saved = structuredClone(op);
    if (spec) {
      const value = duration.trim();
      if (value && !/^\d+(\.\d{1,6})?$/.test(value)) {
        setError("时长须为非负秒数，最多六位小数。");
        return;
      }
      const [whole = "0", fraction = ""] = value.split("."),
        micros = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
      if (micros > BigInt(Number.MAX_SAFE_INTEGER)) {
        setError("时长超出范围。");
        return;
      }
      const body = saved.proposed as Schema<"ShotInput">;
      if (value) body.spec.plannedDurationUs = Number(micros);
      else delete body.spec.plannedDurationUs;
    }
    saved.summary = `${kindName[saved.kind]}：${title(saved)}`;
    if (await onSave(saved)) void draft.complete(onCancel, "local");
    else setError("无法保留到本地提案草稿。本项输入仍保留，请重试。");
  }
  if (draft.committed) return <DraftNotice draft={draft} />;
  return (
    <Stack gap="lg">
      <DraftNotice draft={draft} />
      {draft.baseVersion !== version && (
        <Alert title="这份本地单项草稿基于旧修订">
          <Text>请核对下方的本地表单与当前提案内容，再保留修改。</Text>
          <Text fw={600}>当前提案：{title(operation)}</Text>
          {operation.kind === "shot" && (
            <ShotPreview
              spec={(operation.proposed as Schema<"ShotInput">).spec}
            />
          )}
          <Button mt="md" variant="default" onClick={draft.rebase}>
            已核对，保留这份单项草稿
          </Button>
        </Alert>
      )}
      <SectionHeading
        level={2}
        title={`修改${kindName[op.kind]} · ${title(operation)}`}
        description="只修改这份提案；保存提案修订后再采纳。"
      />
      <TextInput
        required
        label={op.kind === "shot" ? "镜头编号" : "名称"}
        maxLength={160}
        value={title(op)}
        onChange={(e) =>
          change({
            [op.kind === "shot" ? "label" : "title"]: e.currentTarget.value,
          })
        }
      />
      {spec && (
        <>
          <Textarea
            required
            label="叙事意图"
            autosize
            minRows={3}
            value={spec.intent}
            maxLength={20000}
            onChange={(e) => changeSpec({ intent: e.currentTarget.value })}
          />
          {spec.dialogue?.map((line, index) => (
            <Textarea
              key={line.id}
              label={`台词 ${index + 1}`}
              autosize
              value={line.text}
              maxLength={20000}
              onChange={(e) => {
                const text = e.currentTarget.value;
                changeSpec({
                  dialogue: spec.dialogue!.map((old, i) =>
                    i === index ? { ...old, text } : old,
                  ),
                });
              }}
            />
          ))}
          <Button
            variant="subtle"
            w="fit-content"
            onClick={() =>
              changeSpec({
                dialogue: [
                  ...(spec.dialogue ?? []),
                  { id: crypto.randomUUID(), text: "" },
                ],
              })
            }
          >
            添加台词
          </Button>
          <TextInput
            label="预计时长（秒）"
            inputMode="decimal"
            value={duration}
            onChange={(e) => setDuration(e.currentTarget.value)}
            error={error}
          />
          <Textarea
            label="制作说明"
            autosize
            minRows={2}
            maxLength={20000}
            value={spec.notes ?? ""}
            onChange={(e) => changeSpec({ notes: e.currentTarget.value })}
          />
        </>
      )}
      {op.kind === "scene" && (
        <Textarea
          label="场次概述"
          autosize
          minRows={3}
          value={(op.proposed as Schema<"SceneInput">).summary}
          maxLength={20000}
          onChange={(e) => change({ summary: e.currentTarget.value })}
        />
      )}
      <Group>
        <Button
          onClick={finish}
          disabled={
            !draft.ready ||
            !!draft.recovered ||
            draft.baseVersion !== version ||
            !title(op).trim() ||
            (!!spec && !spec.intent.trim())
          }
        >
          保留本项修改
        </Button>
        <Button
          variant="subtle"
          onClick={() => {
            void draft.clear().then((cleared) => {
              if (cleared) onCancel();
            });
          }}
        >
          取消本项修改
        </Button>
      </Group>
    </Stack>
  );
}

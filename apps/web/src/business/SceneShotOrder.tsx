import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { ArrowDown, ArrowUp } from "@phosphor-icons/react";
import { useCommand, type Schema } from "./api";
import { ErrorNotice } from "./common";
import { DraftNotice, useContentDraft } from "./content-drafts";
import {
  isFocused,
  isSelected,
  type ClickModifiers,
  type ListSelection,
} from "./list-selection";
import classes from "./shot-list.module.css";

export function SceneShotOrder({
  path,
  tree,
  sceneId,
  shots,
  selection,
  active,
  onSelect,
}: {
  path: string;
  tree: Schema<"ContentTree">;
  sceneId: string;
  shots: Schema<"Shot">[];
  selection: ListSelection;
  active: boolean;
  onSelect: (id: string, modifiers: ClickModifiers) => void;
}) {
  const [initial] = useState(() => ({ ids: shots.map((s) => s.id), key: "" }));
  const draft = useContentDraft(
    `${path}/scenes/${sceneId}/shot-list-order`,
    initial,
    tree.revision,
  );
  const command = useCommand<Schema<"ContentTree">>();
  const [stageError, setStageError] = useState<Error | null>(null);
  const ids = draft.dirty ? draft.value.ids : shots.map((s) => s.id);
  const completeSet =
    ids.length === shots.length && shots.every((s) => ids.includes(s.id));
  const changed = draft.dirty && draft.baseVersion !== tree.revision;
  const disabled =
    !active ||
    !draft.ready ||
    !!draft.recovered ||
    draft.committed ||
    command.isPending;
  const move = (id: string, by: number) => {
    const next = [...ids],
      from = next.indexOf(id),
      to = from + by;
    if (from < 0 || to < 0 || to >= next.length) return;
    [next[from], next[to]] = [next[to]!, next[from]!];
    if (!draft.dirty) draft.rebase();
    draft.setValue({ ids: next, key: crypto.randomUUID() });
  };
  return (
    <nav className={classes.list} aria-label="镜头顺序">
      {draft.dirty || draft.recovered || draft.error || draft.committed ? (
        <DraftNotice draft={draft} />
      ) : null}
      <ErrorNotice error={command.error ?? stageError} />
      <Text size="xs" c="dimmed">
        按住 Shift 或 Command 点击可多选。
      </Text>
      {changed && (
        <Alert title="列表已更新">
          <Text size="xs">核对当前场次与镜头后再保存，本机顺序仍保留。</Text>
          <Button
            size="xs"
            disabled={disabled || !completeSet}
            onClick={() => {
              draft.rebase();
              draft.setValue({ ...draft.value, key: crypto.randomUUID() });
              command.reset();
            }}
          >
            保留顺序，使用最新版本
          </Button>
        </Alert>
      )}
      {!completeSet && (
        <Alert title="镜头集合已变化">
          <Text size="xs">
            服务器增加或移除了镜头，请重新按当前完整列表整理。
          </Text>
          <Button
            size="xs"
            disabled={disabled}
            onClick={() => {
              draft.rebase();
              draft.setValue({
                ids: shots.map((s) => s.id),
                key: crypto.randomUUID(),
              });
            }}
          >
            按当前列表重新整理
          </Button>
        </Alert>
      )}
      {ids.map((id, index) => {
        const shot = shots.find((s) => s.id === id);
        if (!shot) return null;
        return (
          <div
            className={classes.row}
            key={id}
            data-batch={isSelected(selection, id) ? "true" : undefined}
            data-focused={isFocused(selection, id) || undefined}
          >
            <UnstyledButton
              className={classes.rowTarget}
              aria-current={isFocused(selection, id) ? "true" : undefined}
              // A tooltip, not an aria-label: the row's own text is its name, which
              // then carries the membership mark below as well.
              title="按住 Shift 或 Command 点击可多选"
              onClick={(event) =>
                onSelect(id, {
                  extend: event.shiftKey || event.metaKey || event.ctrlKey,
                })
              }
            >
              <Text size="sm" fw={600}>
                {index + 1}. {shot.label}
              </Text>
              <Text size="xs" c="dimmed" lineClamp={2}>
                {shot.spec.intent}
              </Text>
              <Text size="xs">
                {shot.status === "archived" ? "已归档 · " : ""}
                {shot.currentTakeId ? "已选用" : "待选用"}
                {isSelected(selection, id) && (
                  <Text component="span" size="xs" fw={600}>
                    {" "}
                    · 已选入批量
                  </Text>
                )}
              </Text>
            </UnstyledButton>
            <Stack gap={0}>
              <ActionIcon
                size="sm"
                variant="subtle"
                aria-label={`上移 ${shot.label}`}
                disabled={disabled || !completeSet || index === 0}
                onClick={() => move(id, -1)}
              >
                <ArrowUp size={14} />
              </ActionIcon>
              <ActionIcon
                size="sm"
                variant="subtle"
                aria-label={`下移 ${shot.label}`}
                disabled={disabled || !completeSet || index === ids.length - 1}
                onClick={() => move(id, 1)}
              >
                <ArrowDown size={14} />
              </ActionIcon>
            </Stack>
          </div>
        );
      })}
      {!!shots.length && (
        <Button
          size="xs"
          variant="default"
          disabled={disabled || !draft.dirty || !completeSet || changed}
          loading={command.isPending}
          onClick={async () => {
            setStageError(null);
            if (!(await draft.stage(draft.value))) {
              setStageError(new Error("本机顺序未能保留，请重试。"));
              return;
            }
            command.mutate(
              {
                path: `${path}/content/reorder`,
                version: draft.baseVersion,
                idempotencyKey: draft.value.key,
                body: { kind: "shot", parentId: sceneId, orderedIds: ids },
              },
              { onCommitted: () => void draft.complete() },
            );
          }}
        >
          保存镜头顺序
        </Button>
      )}
    </nav>
  );
}

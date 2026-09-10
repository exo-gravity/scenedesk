import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Group,
  Loader,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useCommand, useResource, useSession, type Schema } from "./api";
import { DraftNotice, useContentDraft } from "./content-drafts";
import { ErrorNotice } from "./common";
import { MediaPreview } from "./MediaPreview";
import { parseSourceSeconds, sourceSeconds } from "./candidate-time";
import classes from "./candidates.module.css";

export function CandidateEditor({
  path,
  mediaPath,
  shot,
  media,
  active,
  source,
  onClose,
  onCreated,
}: {
  path: string;
  mediaPath: string;
  shot: Schema<"Shot">;
  media: Schema<"Media">;
  active: boolean;
  source?: Schema<"Take"> | undefined;
  onClose: () => void;
  onCreated: (take: Schema<"Take">) => void;
}) {
  const [initial] = useState(() => ({
    shotRevisionId: shot.specRevisionId,
    inSeconds: sourceSeconds(source?.range.inUs ?? 0),
    outSeconds: sourceSeconds(source?.range.outUs ?? media.durationUs ?? 0),
    note: "",
  }));
  const draft = useContentDraft(
    `${path}/takes/new/${shot.id}/${source?.id ?? media.id}`,
    initial,
    shot.revision,
  );
  const save = useCommand<Schema<"Take">>();
  const fixed = useResource<Schema<"ShotRevision">>(
    `${path}/shots/${shot.id}/revisions/${draft.value.shotRevisionId}`,
  );
  const inUs = parseSourceSeconds(draft.value.inSeconds),
    outUs = parseSourceSeconds(draft.value.outSeconds);
  const valid =
    inUs !== undefined &&
    outUs !== undefined &&
    inUs < outUs &&
    outUs <= (media.durationUs ?? 0);
  const changed = draft.value.shotRevisionId !== shot.specRevisionId;
  if (draft.committed) return <DraftNotice draft={draft} />;
  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text fw={600}>
          {source ? "核对并沿用候选" : "从视频建立候选"} · {shot.label}
        </Text>
        <Button variant="subtle" onClick={onClose}>
          收起，保留输入
        </Button>
      </Group>
      <MediaPreview
        key={media.id}
        media={media}
        path={mediaPath}
        range={valid ? { inUs: inUs!, outUs: outUs! } : undefined}
      />
      <form
        className={classes.composer}
        onSubmit={(event) => {
          event.preventDefault();
          if (
            !valid ||
            !draft.ready ||
            draft.recovered ||
            fixed.isError ||
            !fixed.data ||
            media.status !== "ready" ||
            !active
          )
            return;
          save.mutate(
            {
              method: "POST",
              path: `${path}/takes`,
              body: {
                shotId: shot.id,
                shotRevisionId: draft.value.shotRevisionId,
                mediaId: media.id,
                range: { inUs, outUs },
                ...(source ? { sourceTakeId: source.id } : {}),
                ...(draft.value.note ? { note: draft.value.note } : {}),
              },
            },
            {
              onCommitted: (take) => void draft.complete(() => onCreated(take)),
            },
          );
        }}
      >
        <Stack gap="md">
          <DraftNotice draft={draft} />
          <ErrorNotice error={save.error ?? fixed.error} />
          <Text fw={500}>
            {media.displayName} · {sourceSeconds(media.durationUs ?? 0)} 秒
          </Text>
          <Text size="sm">
            固定要求{" "}
            {fixed.data
              ? `v${fixed.data.number}：${fixed.data.spec.intent}`
              : "读取中…"}
          </Text>
          {changed && (
            <Alert title="镜头要求已更新">
              这份草稿仍绑定以上旧要求。归档后需再次核对沿用，才能成为当前采用。
              <Text mt="sm">当前要求：{shot.spec.intent}</Text>
              <Button
                mt="sm"
                disabled={
                  !active || !draft.ready || !!draft.recovered || save.isPending
                }
                onClick={() =>
                  draft.setValue({
                    ...draft.value,
                    shotRevisionId: shot.specRevisionId,
                  })
                }
              >
                已核对，绑定当前要求
              </Button>
            </Alert>
          )}
          {source && (
            <Text size="sm">
              来源候选 {source.id.slice(0, 8)} · 将建立新候选，保留来源关系。
            </Text>
          )}
          <fieldset
            disabled={
              !draft.ready ||
              !!draft.recovered ||
              save.isPending ||
              media.status !== "ready" ||
              !active
            }
            className={classes.fieldset}
          >
            <Group grow align="start">
              <TextInput
                label="入点（秒）"
                inputMode="decimal"
                value={draft.value.inSeconds}
                onChange={(event) =>
                  draft.setValue({
                    ...draft.value,
                    inSeconds: event.currentTarget.value,
                  })
                }
              />
              <TextInput
                label="出点（秒）"
                inputMode="decimal"
                value={draft.value.outSeconds}
                onChange={(event) =>
                  draft.setValue({
                    ...draft.value,
                    outSeconds: event.currentTarget.value,
                  })
                }
              />
            </Group>
            <Text size="xs" c="dimmed">
              最多 6
              位小数；区间包含入点、不包含出点。代理播放用于核对，精确制作副本将在剪辑时生成。
            </Text>
            {!valid && (
              <Text role="alert" c="var(--ws-danger)">
                请输入有效区间：入点小于出点，且不超出视频时长。
              </Text>
            )}
            <Textarea
              label="候选说明"
              value={draft.value.note}
              maxLength={20000}
              minRows={2}
              maxRows={4}
              autosize
              onChange={(event) =>
                draft.setValue({
                  ...draft.value,
                  note: event.currentTarget.value,
                })
              }
            />
            <Button
              type="submit"
              variant="filled"
              loading={save.isPending}
              disabled={!valid || !fixed.data || fixed.isError}
            >
              归档为候选
            </Button>
          </fieldset>
          {media.status !== "ready" && (
            <Alert>视频现已不可用于新候选，输入仍保留。</Alert>
          )}
        </Stack>
      </form>
    </Stack>
  );
}

export function SelectionEditor({
  path,
  shot,
  take,
  active,
  onClose,
}: {
  path: string;
  shot: Schema<"Shot">;
  take?: Schema<"Take"> | undefined;
  active: boolean;
  onClose: () => void;
}) {
  const cache = useQueryClient(),
    session = useSession();
  const draft = useContentDraft(
    `${path}/shots/${shot.id}/selection/${take?.id ?? "clear"}`,
    { reason: "" },
    shot.revision,
  );
  const current = useResource<Schema<"SelectionState">>(
    `${path}/shots/${shot.id}/selection`,
  );
  const save = useCommand<Schema<"Selection">>();
  const changed = draft.baseVersion !== shot.revision;
  const obsolete = take && take.shotRevisionId !== shot.specRevisionId;
  if (draft.committed) return <DraftNotice draft={draft} />;
  return (
    <Stack>
      <DraftNotice draft={draft} />
      <Text>
        {take
          ? `采用候选 ${take.id.slice(0, 8)}，区间 ${sourceSeconds(take.range.inUs)}–${sourceSeconds(take.range.outUs)} 秒。`
          : "清除本镜当前采用，保留所有候选与决定历史。"}
      </Text>
      <Text size="sm">此操作记录本镜偏好；不表示审阅通过。</Text>
      <ErrorNotice
        error={save.error ?? current.error}
        retry={() =>
          void cache.invalidateQueries({ queryKey: ["user", session.userId] })
        }
      />
      {current.data && (
        <Text size="sm">
          服务器当前采用：
          {current.data.currentSelection?.takeId?.slice(0, 8) ?? "尚未采用"} ·
          修改版本 {current.data.revision}
        </Text>
      )}
      {obsolete && <Alert>候选绑定旧要求，请关闭后核对沿用到当前要求。</Alert>}
      {changed && (
        <Alert title="镜头已被修改">
          核对最新要求和当前采用后，再决定是否继续。
          <Button
            mt="sm"
            disabled={
              !!obsolete ||
              current.isFetching ||
              current.data?.revision !== shot.revision
            }
            onClick={() => {
              draft.rebase();
              save.reset();
            }}
          >
            已核对，使用最新修改版本
          </Button>
        </Alert>
      )}
      <Textarea
        label="采用理由（可选）"
        disabled={!take || !draft.ready || !!draft.recovered || save.isPending}
        value={draft.value.reason}
        onChange={(event) =>
          draft.setValue({ reason: event.currentTarget.value })
        }
        maxLength={20000}
      />
      <Group justify="end">
        <Button onClick={onClose}>暂不操作</Button>
        <Button
          variant="filled"
          loading={save.isPending}
          disabled={
            !active ||
            !draft.ready ||
            !!draft.recovered ||
            changed ||
            !!obsolete ||
            !current.data ||
            current.isError
          }
          onClick={() =>
            save.mutate(
              {
                method: take ? "PUT" : "DELETE",
                path: `${path}/shots/${shot.id}/selection`,
                version: draft.baseVersion,
                ...(take
                  ? {
                      body: {
                        takeId: take.id,
                        ...(draft.value.reason
                          ? { reason: draft.value.reason }
                          : {}),
                      },
                    }
                  : {}),
              },
              { onCommitted: () => void draft.complete(onClose) },
            )
          }
        >
          {take ? "确认采用" : "确认清除采用"}
        </Button>
      </Group>
    </Stack>
  );
}

import { useState } from "react";
import {
  Badge,
  Button,
  Group,
  Loader,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { DownloadSimple } from "@phosphor-icons/react";
import { api, useList, useResource, useSession, type Schema } from "./api";
import { ErrorNotice } from "./common";
import { CandidateEditor, SelectionEditor } from "./CandidateEditor";
import { MediaPreview } from "./MediaPreview";
import { sourceSeconds } from "./candidate-time";
import classes from "./shot-list.module.css";

export function ShotResultFocus({
  shot,
  path,
  mediaPath,
  active,
  sourceMediaId,
  transition,
}: {
  shot: Schema<"Shot">;
  path: string;
  mediaPath: string;
  active: boolean;
  sourceMediaId?: string | undefined;
  transition: (next: () => void) => Promise<void>;
}) {
  const takes = useList<Schema<"Take">>(`${path}/takes?shotId=${shot.id}`);
  const selection = useResource<Schema<"SelectionState">>(
    `${path}/shots/${shot.id}/selection`,
  );
  const history = useList<Schema<"Selection">>(
    `${path}/shots/${shot.id}/selections`,
  );
  const [focused, setFocused] = useState(""),
    [compared, setCompared] = useState<string | null>(null),
    [decision, setDecision] = useState<{ take?: Schema<"Take"> }>(),
    [adding, setAdding] = useState(false);
  const source = useResource<Schema<"Media">>(
    `${mediaPath}/media/${sourceMediaId}`,
    !!sourceMediaId,
  );
  if (takes.isError || selection.isError || history.isError)
    return (
      <ErrorNotice
        error={takes.error ?? selection.error ?? history.error}
        retry={() => {
          void takes.refetch();
          void selection.refetch();
          void history.refetch();
        }}
      />
    );
  if (!takes.data || !selection.data || !history.data)
    return <Loader aria-label="正在读取镜头候选" />;
  const current = selection.data.currentSelection;
  const take =
    takes.data.find((t) => t.id === focused) ??
    takes.data.find((t) => t.id === current?.takeId) ??
    takes.data[0];
  const other = takes.data.find((t) => t.id === compared && t.id !== take?.id);
  const fixedShot = { ...shot, revision: selection.data.revision };
  return (
    <Stack gap="md">
      <Group justify="space-between">
        <div>
          <Text component="h2" className={classes.heading}>
            {shot.label}
          </Text>
          <Text size="sm" c="dimmed">
            {shot.spec.intent}
          </Text>
        </div>
        <Badge variant="light">
          {current?.takeId ? "已有明确选用" : "尚未选用"}
        </Badge>
      </Group>
      {sourceMediaId && (
        <>
          <ErrorNotice error={source.error} />
          {source.data?.kind === "video" ? (
            <Button
              size="xs"
              variant="default"
              disabled={
                !active || source.isError || source.data.status !== "ready"
              }
              onClick={() => void transition(() => setAdding(!adding))}
            >
              从所选画布视频建立候选
            </Button>
          ) : (
            source.data && (
              <Text size="xs" c="dimmed">
                所选画布素材是
                {source.data.kind === "image" ? "图片" : "其他素材"}
                ，可继续用作创作参考；镜头视频候选须为实际视频。
              </Text>
            )
          )}
        </>
      )}
      {adding && source.data?.kind === "video" && !source.error ? (
        <CandidateEditor
          presentation="list"
          path={path}
          mediaPath={mediaPath}
          shot={shot}
          media={source.data}
          active={active}
          onClose={() => void transition(() => setAdding(false))}
          onCreated={(value) => {
            setFocused(value.id);
            setAdding(false);
            void takes.refetch();
          }}
        />
      ) : (
        <>
          {!take ? (
            <Text c="dimmed">
              暂无视频候选。在画布选中原文件可用的视频后打开镜头列表，可登记为候选。
            </Text>
          ) : (
            <>
              <Group grow align="start">
                <Select
                  label="预览候选"
                  value={take.id}
                  data={takes.data.map((t, i) => ({
                    value: t.id,
                    label: `候选 ${i + 1}${t.id === current?.takeId ? " · 已选用" : ""}${t.shotRevisionId !== shot.specRevisionId ? " · 旧要求" : ""}`,
                  }))}
                  onChange={(id) =>
                    void transition(() => {
                      setFocused(id ?? "");
                      setDecision(undefined);
                    })
                  }
                />
                <Select
                  label="比较候选"
                  placeholder="选择另一份结果"
                  clearable
                  value={other?.id ?? null}
                  data={takes.data
                    .filter((t) => t.id !== take.id)
                    .map((t) => ({
                      value: t.id,
                      label: `候选 ${takes.data!.indexOf(t) + 1} · ${t.id.slice(0, 8)}`,
                    }))}
                  onChange={setCompared}
                />
              </Group>
              <div
                className={classes.previews}
                data-comparing={!!other || undefined}
              >
                <FixedTakePreview
                  key={take.id}
                  path={path}
                  mediaPath={mediaPath}
                  take={take}
                />
                {other && (
                  <FixedTakePreview
                    key={other.id}
                    path={path}
                    mediaPath={mediaPath}
                    take={other}
                  />
                )}
              </div>
              <Group>
                <Button
                  disabled={
                    !active ||
                    take.id === current?.takeId ||
                    take.shotRevisionId !== shot.specRevisionId
                  }
                  onClick={() =>
                    void transition(() =>
                      setDecision({ take: structuredClone(take) }),
                    )
                  }
                >
                  选用当前预览…
                </Button>
                {current?.takeId && (
                  <Button
                    variant="subtle"
                    disabled={!active}
                    onClick={() => void transition(() => setDecision({}))}
                  >
                    清除选用…
                  </Button>
                )}
              </Group>
              {take.shotRevisionId !== shot.specRevisionId && (
                <Text size="xs" c="dimmed">
                  候选保留原镜头要求。请在原候选工作区核对沿用后再选用。
                </Text>
              )}
            </>
          )}
          {decision && (
            <section className={classes.confirmation} aria-label="确认镜头选用">
              <SelectionEditor
                presentation="list"
                key={decision.take?.id ?? "clear"}
                path={path}
                shot={fixedShot}
                take={decision.take}
                active={active}
                onClose={() => void transition(() => setDecision(undefined))}
              />
            </section>
          )}
          {current?.takeId && (
            <SelectedDownload
              key={current.id}
              path={path}
              shot={shot}
              selectionId={current.id}
            />
          )}
          <details>
            <summary>选用历史（{history.data.length}）</summary>
            {history.data.map((item) => (
              <Text size="xs" key={item.id}>
                第 {item.number} 次 ·{" "}
                {item.takeId ? `候选 ${item.takeId.slice(0, 8)}` : "清除选用"}
                {item.reason ? ` · ${item.reason}` : ""}
              </Text>
            ))}
          </details>
        </>
      )}
    </Stack>
  );
}

function FixedTakePreview({
  path,
  mediaPath,
  take,
}: {
  path: string;
  mediaPath: string;
  take: Schema<"Take">;
}) {
  const media = useResource<Schema<"Media">>(
    `${mediaPath}/media/${take.mediaId}`,
  );
  const revision = useResource<Schema<"ShotRevision">>(
    `${path}/shots/${take.shotId}/revisions/${take.shotRevisionId}`,
  );
  if (media.isError || revision.isError)
    return <ErrorNotice error={media.error ?? revision.error} />;
  if (!media.data || !revision.data)
    return <Loader aria-label="正在读取固定候选" />;
  return (
    <Stack gap="xs">
      <MediaPreview media={media.data} path={mediaPath} range={take.range} />
      <Text size="xs">
        片段 {sourceSeconds(take.range.inUs)}–{sourceSeconds(take.range.outUs)}{" "}
        秒
      </Text>
      <Text size="xs" c="dimmed">
        {take.note || revision.data.spec.intent}
      </Text>
    </Stack>
  );
}

function SelectedDownload({
  path,
  shot,
  selectionId,
}: {
  path: string;
  shot: Schema<"Shot">;
  selectionId: string;
}) {
  const session = useSession();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null),
    [result, setResult] = useState<Schema<"SelectedTakeDownload">>();
  return (
    <Stack gap="xs">
      <Button
        variant="default"
        leftSection={<DownloadSimple size={16} />}
        loading={busy}
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          setError(null);
          setResult(undefined);
          try {
            const fixed = await api<Schema<"SelectedTakeDownload">>(
              `${path}/shots/${shot.id}/selection/download`,
              {
                method: "POST",
                signal: AbortSignal.timeout(15000),
                headers: {
                  "Content-Type": "application/json",
                  "X-CSRF-Token": session.csrfToken,
                  "Idempotency-Key": crypto.randomUUID(),
                },
                body: JSON.stringify({ selectionId }),
              },
            );
            setResult(fixed);
            const link = document.createElement("a");
            link.href = fixed.access.url;
            link.rel = "noopener noreferrer";
            link.download = fixed.media.originalFileName ?? "selected-video";
            link.click();
          } catch (cause) {
            setError(
              cause instanceof Error ? cause : new Error("原片下载请求失败。"),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        下载已选用原片
      </Button>
      <Text size="xs" c="dimmed">
        下载完整原视频；候选入出点另行显示，文件未裁剪。预览其他候选不会改变下载对象。
      </Text>
      <ErrorNotice error={error} />
      {result && (
        <Text size="xs" role="status">
          已请求下载 {result.media.originalFileName} · 选用区间{" "}
          {sourceSeconds(result.take.range.inUs)}–
          {sourceSeconds(result.take.range.outUs)}{" "}
          秒。请在浏览器下载记录核对文件。
        </Text>
      )}
    </Stack>
  );
}

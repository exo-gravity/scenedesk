import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Stack,
  Switch,
  TagsInput,
  Fieldset,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { Archive, DownloadSimple } from "@phosphor-icons/react";
import { api, useCommand, useSession, type Schema } from "./api";
import { Empty, ErrorNotice, SectionHeading } from "./common";
import { DraftNotice, useContentDraft } from "./content-drafts";
import { MediaPreview, mediaKind, mediaStatus } from "./MediaPreview";
import classes from "./media.module.css";
type Media = Schema<"Media">;
const formatBytes = (value?: number) =>
  value === undefined
    ? "验收后可见"
    : value < 1024 * 1024
      ? `${(value / 1024).toFixed(1)} KiB`
      : `${(value / 1024 / 1024).toFixed(1)} MiB`;

export default function MediaDetail({
  path,
  id,
  canWrite,
  expectedProjectId,
}: {
  path: string;
  id: string;
  canWrite: boolean;
  expectedProjectId?: string | undefined;
}) {
  const session = useSession();
  const media = useQuery({
    queryKey: ["user", session.userId, `${path}/media/${id}`],
    queryFn: ({ signal }) => api<Media>(`${path}/media/${id}`, { signal }),
    refetchInterval: (query) =>
      query.state.error
        ? false
        : query.state.data?.status === "processing" ||
            query.state.data?.derivatives.some((d) =>
              ["queued", "processing"].includes(d.status),
            )
          ? 2500
          : false,
  });
  const [archive, setArchive] = useState(false),
    [editing, setEditing] = useState(false);
  const command = useCommand<Media>(),
    download = useCommand<Schema<"AccessGrant">>();
  if (media.isError)
    return (
      <ErrorNotice error={media.error} retry={() => void media.refetch()} />
    );
  if (!media.data) return <Loader aria-label="正在读取素材" />;
  const value = media.data;
  if (value.projectId !== expectedProjectId)
    return (
      <Empty>该素材不属于当前浏览范围，请返回所属项目或共享素材区。</Empty>
    );
  const ready = ["ready", "archived"].includes(value.status);
  return (
    <>
      <SectionHeading
        level={1}
        title={value.displayName}
        description={`${mediaKind[value.kind]} · ${mediaStatus[value.status]}`}
        action={
          ready && (
            <Button
              leftSection={<DownloadSimple size={18} />}
              loading={download.isPending}
              onClick={() =>
                download.mutate(
                  {
                    path: `${path}/media/${id}/access`,
                    body: { variant: "original", disposition: "attachment" },
                  },
                  {
                    onSuccess: (result) => {
                      const anchor = document.createElement("a");
                      anchor.href = result.url;
                      anchor.rel = "noopener noreferrer";
                      anchor.click();
                    },
                  },
                )
              }
            >
              下载原文件
            </Button>
          )
        }
      />
      <ErrorNotice error={download.error ?? command.error} />
      {value.issue && (
        <Alert
          title={
            value.status === "rejected" ? "文件未通过验收" : "处理需要恢复"
          }
        >
          {value.issue.message}
          {value.issue.retryable && (
            <Text mt="xs">打开「导入记录」，继续本次上传记录。</Text>
          )}
        </Alert>
      )}
      <div className={classes.detail}>
        <Stack gap="md" className={classes.mediaMain}>
          <MediaPreview media={value} path={path} />
          {ready && value.kind !== "document" && (
            <Text size="sm" c="dimmed">
              下载原文件可取得最初验收的完整文件。
            </Text>
          )}
          {value.derivatives.map((derivative) => (
            <Group key={derivative.id} justify="space-between">
              <Text size="sm">
                {derivative.kind === "poster" ? "海报" : "代理"} ·{" "}
                {
                  {
                    queued: "等待处理",
                    processing: "正在处理",
                    ready: "可用",
                    failed: "处理失败",
                  }[derivative.status]
                }
              </Text>
              {derivative.status === "failed" && (
                <Stack gap="xs">
                  <Text size="sm">{derivative.issue?.message}</Text>
                  {canWrite && (
                    <Button
                      disabled={command.isPending}
                      onClick={() =>
                        command.mutate({
                          path: `${path}/media/${id}/derivatives/recover`,
                          body: { variant: derivative.kind },
                        })
                      }
                    >
                      恢复{derivative.kind === "poster" ? "海报" : "代理"}
                    </Button>
                  )}
                </Stack>
              )}
            </Group>
          ))}
        </Stack>
        <Stack gap="md" className={classes.inspector}>
          <Text component="h2" className={classes.inspectorTitle}>
            文件与来源
          </Text>
          <dl className={classes.facts}>
            <dt>原文件名</dt>
            <dd>{value.originalFileName}</dd>
            <dt>文件大小</dt>
            <dd>{formatBytes(value.bytes)}</dd>
            {value.width && (
              <>
                <dt>画面尺寸</dt>
                <dd>
                  {value.width} × {value.height}
                </dd>
              </>
            )}
            {value.durationUs !== undefined && (
              <>
                <dt>实际时长</dt>
                <dd>{(value.durationUs / 1_000_000).toFixed(3)} 秒</dd>
              </>
            )}
            {value.fpsNum && (
              <>
                <dt>帧率</dt>
                <dd>
                  {value.fpsNum}/{value.fpsDen} fps
                </dd>
              </>
            )}
            <dt>来源</dt>
            <dd>
              {value.provenance.status === "recorded"
                ? value.provenance.record?.sourceNote || "已记录，说明为空"
                : "尚未记录"}
            </dd>
          </dl>
          <Group gap="xs">
            {value.tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </Group>
          {value.provenance.record && (
            <div className={classes.detailsText}>
              <Text size="sm" c="dimmed">
                用途说明
              </Text>
              <Text>{value.provenance.record.usageNote || "未填写"}</Text>
              {value.provenance.record.sourceUrl && (
                <Text
                  component="a"
                  href={value.provenance.record.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  查看来源链接
                </Text>
              )}
            </div>
          )}
          {canWrite && (
            <Group>
              <Button onClick={() => setEditing((value) => !value)}>
                {editing ? "收起编辑" : "修改名称与来源"}
              </Button>
              {value.status === "ready" && (
                <Button
                  variant="subtle"
                  leftSection={<Archive size={18} />}
                  onClick={() => setArchive(true)}
                >
                  归档素材
                </Button>
              )}
            </Group>
          )}
          <details className={classes.disclosure}>
            <summary>文件校验信息</summary>
            <Text size="sm" className={classes.detailsText}>
              SHA-256：{value.sha256 ?? "验收后可见"}
            </Text>
          </details>
        </Stack>
      </div>
      {editing && canWrite && (
        <MediaMetadata
          key={value.id}
          media={value}
          path={path}
          done={() => setEditing(false)}
        />
      )}
      <Modal
        opened={archive}
        onClose={() => setArchive(false)}
        title="归档这项素材？"
        centered
      >
        <Stack>
          <Text>归档后保留原文件和已有引用，不再作为新引用加入制作。</Text>
          <ErrorNotice error={command.error} />
          <Group justify="flex-end">
            <Button onClick={() => setArchive(false)}>返回</Button>
            <Button
              loading={command.isPending}
              onClick={() =>
                command.mutate(
                  {
                    path: `${path}/media/${id}/archive`,
                    version: value.revision,
                  },
                  { onSuccess: () => setArchive(false) },
                )
              }
            >
              确认归档
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
function editableMetadata(media: Media) {
  return {
    displayName: media.displayName,
    tags: media.tags,
    sourceNote: media.provenance.record?.sourceNote ?? "",
    sourceUrl: media.provenance.record?.sourceUrl ?? "",
    usageNote: media.provenance.record?.usageNote ?? "",
    shareable: media.provenance.record?.shareable ?? false,
    recordSource: media.provenance.status === "recorded",
  };
}
function MediaMetadata({
  media,
  path,
  done,
}: {
  media: Media;
  path: string;
  done: () => void;
}) {
  const [initial] = useState(() => editableMetadata(media));
  const current = editableMetadata(media);
  const draft = useContentDraft(
    `${path}/media/${media.id}/metadata`,
    { base: initial, input: initial },
    media.revision,
  );
  const command = useCommand<Media>(),
    [validation, setValidation] = useState<Error>();
  const stale = draft.baseVersion !== media.revision,
    value = draft.value.input;
  const set = <K extends keyof typeof initial>(
    key: K,
    value: (typeof initial)[K],
  ) =>
    draft.setValue((old) => ({
      ...old,
      input: { ...old.input, [key]: value },
    }));
  const labels: Record<keyof typeof initial, string> = {
    displayName: "名称",
    tags: "标签",
    sourceNote: "来源说明",
    sourceUrl: "来源链接",
    usageNote: "用途说明",
    shareable: "允许公开来源说明",
    recordSource: "记录来源",
  };
  const changed = (Object.keys(initial) as (keyof typeof initial)[]).filter(
    (key) =>
      JSON.stringify(current[key]) !== JSON.stringify(draft.value.base[key]),
  );
  const show = (value: string | string[] | boolean) =>
    Array.isArray(value)
      ? value.join("、") || "无"
      : typeof value === "boolean"
        ? value
          ? "是"
          : "否"
        : value || "未填写";
  if (draft.committed) return <DraftNotice draft={draft} />;
  return (
    <form
      className={classes.metadata}
      onSubmit={(event) => {
        event.preventDefault();
        if (command.isPending || stale || !draft.ready || draft.recovered)
          return;
        setValidation(undefined);
        if (!value.displayName.trim()) {
          setValidation(new Error("请填写素材名称。"));
          return;
        }
        const provenance: Schema<"ProvenanceInput"> = {
          sourceNote: value.sourceNote,
          usageNote: value.usageNote,
          shareable: value.shareable,
          ...(value.sourceUrl.trim()
            ? { sourceUrl: value.sourceUrl.trim() }
            : {}),
          evidenceMediaIds: media.provenance.record?.evidenceMediaIds ?? [],
        };
        command.mutate(
          {
            path: `${path}/media/${media.id}`,
            method: "PATCH",
            version: draft.baseVersion,
            body: {
              displayName: value.displayName,
              tags: value.tags,
              ...(value.recordSource ? { provenance } : {}),
            },
          },
          {
            onCommitted: () => void draft.complete(done),
          },
        );
      }}
    >
      <Fieldset
        variant="unstyled"
        className={classes.metadata}
        disabled={command.isPending}
      >
        <Text fw={600}>名称与来源</Text>
        <DraftNotice draft={draft} />
        <ErrorNotice error={command.error ?? validation ?? null} />
        {stale && (
          <div className={classes.comparison}>
            <Text fw={600}>服务器已有新版本，当前输入已保留</Text>
            {changed.length ? (
              changed.map((key) => (
                <div key={key}>
                  <Text fw={500}>{labels[key]}</Text>
                  <Text size="sm">原基线：{show(draft.value.base[key])}</Text>
                  <Text size="sm">服务器：{show(current[key])}</Text>
                  <Text size="sm">当前输入：{show(value[key])}</Text>
                </div>
              ))
            ) : (
              <Text>素材的处理或归档状态已更新，名称与来源字段未改变。</Text>
            )}
            <Text size="sm">
              未经你修改的字段会保留服务器新值。双方都修改的字段请在下方手工核对，再继续保存。
            </Text>
            <Button
              mt="sm"
              onClick={() => {
                const input = { ...value };
                for (const key of Object.keys(
                  input,
                ) as (keyof typeof input)[]) {
                  if (
                    JSON.stringify(input[key]) ===
                    JSON.stringify(draft.value.base[key])
                  )
                    Object.assign(input, { [key]: current[key] });
                }
                draft.setValue({ base: current, input });
                draft.rebase();
              }}
            >
              已核对，使用当前服务器版本
            </Button>
          </div>
        )}
        <TextInput
          required
          label="素材名称"
          value={value.displayName}
          onChange={(event) => set("displayName", event.currentTarget.value)}
          maxLength={160}
        />
        <TagsInput
          label="标签"
          value={value.tags}
          onChange={(tags) => set("tags", tags)}
          maxTags={50}
        />
        <Switch
          label="记录来源与用途说明"
          checked={value.recordSource}
          disabled={media.provenance.status === "recorded"}
          onChange={(event) => set("recordSource", event.currentTarget.checked)}
        />
        {value.recordSource && (
          <>
            <Textarea
              label="来源说明"
              autosize
              minRows={2}
              value={value.sourceNote}
              onChange={(event) => set("sourceNote", event.currentTarget.value)}
              maxLength={20000}
            />
            <TextInput
              label="来源链接（可选）"
              value={value.sourceUrl}
              onChange={(event) => set("sourceUrl", event.currentTarget.value)}
              type="url"
            />
            <Textarea
              label="用途说明"
              autosize
              minRows={2}
              value={value.usageNote}
              onChange={(event) => set("usageNote", event.currentTarget.value)}
              maxLength={20000}
            />
            <Switch
              label="这份来源说明可随素材公开共享"
              checked={value.shareable}
              onChange={(event) =>
                set("shareable", event.currentTarget.checked)
              }
            />
            <Text size="sm" c="dimmed">
              来源说明是成员记录，不代表平台已认证使用许可。
            </Text>
          </>
        )}
        <Group>
          <Button
            type="submit"
            variant="filled"
            loading={command.isPending}
            disabled={stale || !draft.ready || !!draft.recovered}
          >
            保存名称与来源
          </Button>
          <Button onClick={done}>收起，保留本机草稿</Button>
        </Group>
      </Fieldset>
    </form>
  );
}

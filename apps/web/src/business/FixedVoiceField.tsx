import { useState } from "react";
import { useDebouncedValue } from "@mantine/hooks";
import {
  Button,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useCommand, useResource, type Schema } from "./api";
import { Empty, ErrorNotice } from "./common";
import { useAssetPages } from "./asset-queries";
export function FixedVoiceField({
  path,
  projectId,
  value,
  onChange,
}: {
  path: string;
  projectId?: string | undefined;
  value?: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Stack gap="xs">
      <Text fw={500}>角色默认声音</Text>
      {value ? (
        <FixedVoiceLabel path={path} id={value} />
      ) : (
        <Text size="sm" c="dimmed">
          尚未选择声音固定版
        </Text>
      )}
      <Group>
        <Button onClick={() => setOpen(true)}>选择声音固定版</Button>
        {value && (
          <Button variant="subtle" onClick={() => onChange(undefined)}>
            移除默认声音
          </Button>
        )}
      </Group>
      <Modal
        title="选择声音固定版"
        opened={open}
        onClose={() => setOpen(false)}
        size="lg"
      >
        {open && (
          <VoiceChoices
            path={path}
            projectId={projectId}
            done={(id) => {
              onChange(id);
              setOpen(false);
            }}
          />
        )}
      </Modal>
    </Stack>
  );
}
export function FixedVoiceLabel({ path, id }: { path: string; id: string }) {
  const revision = useResource<Schema<"AssetRevision">>(
    `${path}/asset-revisions/${id}`,
  );
  const asset = useResource<Schema<"Asset">>(
    `${path}/assets/${revision.data?.assetId ?? ""}`,
    !!revision.data && !revision.isError,
  );
  if (revision.isError || asset.isError)
    return <ErrorNotice error={revision.error ?? asset.error} />;
  if (!revision.data || !asset.data)
    return <Text size="sm">正在读取声音固定版…</Text>;
  return (
    <Text>
      {asset.data.name} · v{revision.data.number} ·{" "}
      {revision.data.status === "confirmed" ? "已确认" : "草稿"}
    </Text>
  );
}
function VoiceChoices({
  path,
  projectId,
  done,
}: {
  path: string;
  projectId?: string | undefined;
  done: (id: string) => void;
}) {
  const [scope, setScope] = useState(projectId ? "project" : "shared"),
    [q, setQ] = useState(""),
    [search] = useDebouncedValue(q, 250),
    [selected, setSelected] = useState<Schema<"Asset">>();
  const params = new URLSearchParams({
    scope,
    kind: "voice",
    status: "active",
    q: search,
    ...(scope === "project" && projectId ? { projectId } : {}),
  });
  const voices = useAssetPages<Schema<"Asset">>(`${path}/assets?${params}`);
  return selected ? (
    <Stack>
      <Button variant="subtle" onClick={() => setSelected(undefined)}>
        返回声音资产
      </Button>
      <Text fw={600}>{selected.name}</Text>
      <VoiceVersions
        path={path}
        projectId={projectId}
        asset={selected}
        done={done}
      />
    </Stack>
  ) : (
    <Stack gap="lg">
      <Group>
        {projectId && (
          <Select
            label="声音范围"
            value={scope}
            onChange={(value) => value && setScope(value)}
            data={[
              { value: "project", label: "当前项目" },
              { value: "shared", label: "工作室共享" },
            ]}
          />
        )}
        <TextInput
          label="查找声音资产"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
      </Group>
      <ErrorNotice error={voices.error} retry={() => void voices.refetch()} />
      {voices.isPending ? (
        <Loader aria-label="正在查找声音资产" />
      ) : (
        !voices.isError && (
          <>
            {voices.data?.pages
              .flatMap((page) => page.items)
              .map((voice) => (
                <Group key={voice.id} justify="space-between">
                  <Text>{voice.name}</Text>
                  <Button
                    disabled={!voice.currentRevisionId}
                    onClick={() => setSelected(voice)}
                  >
                    {voice.currentRevisionId ? "选择版本" : "尚无固定版本"}
                  </Button>
                </Group>
              ))}
            {!voices.data?.pages.some((page) => page.items.length) && (
              <Empty>
                没有可选声音资产。先在资产区新建「声音」，保存固定定义。
              </Empty>
            )}
            {voices.hasNextPage && (
              <Button
                onClick={() => void voices.fetchNextPage()}
                loading={voices.isFetchingNextPage}
              >
                加载更多声音资产
              </Button>
            )}
          </>
        )
      )}
    </Stack>
  );
}
function VoiceVersions({
  path,
  projectId,
  asset,
  done,
}: {
  path: string;
  projectId?: string | undefined;
  asset: Schema<"Asset">;
  done: (id: string) => void;
}) {
  const current = useResource<Schema<"AssetRevision">>(
    `${path}/asset-revisions/${asset.currentRevisionId}`,
  );
  const history = useAssetPages<Schema<"AssetRevision">>(
      `${path}/assets/${asset.id}/revisions`,
    ),
    command = useCommand<Schema<"SharedImport">>();
  const shared = !!projectId && asset.scope === "shared";
  const choose = (id: string) => {
    if (shared)
      command.mutate(
        {
          path: `${path}/projects/${projectId}/shared-imports`,
          body: { assetRevisionId: id },
        },
        { onSuccess: () => done(id) },
      );
    else done(id);
  };
  return (
    <Stack gap="md">
      <Text size="sm">
        选择后固定到该版本。声音资产的新修订不会自动替换角色的默认声音。
        {shared ? "此操作会将所选共享版本明确引入当前项目。" : ""}
      </Text>
      <ErrorNotice error={current.error ?? history.error ?? command.error} />
      {current.data && !current.isError && (
        <Stack gap="sm">
          <Text size="sm">
            {current.data.definition.voiceDescription ||
              current.data.definition.description ||
              "未填写声音说明"}
          </Text>
          <Button
            component="a"
            variant="subtle"
            target="_blank"
            rel="noopener"
            href={`#/app/t/${path.split("/")[3]}${asset.projectId ? "/p/" + asset.projectId : ""}/assets?asset=${asset.id}&revision=${current.data.id}`}
          >
            在新标签页核对声音固定版
          </Button>
          <Button
            variant="filled"
            loading={command.isPending}
            onClick={() => choose(current.data!.id)}
          >
            {shared ? "引入并使用" : "使用"} v{current.data.number} 固定版
          </Button>
        </Stack>
      )}
      <Text fw={500}>历史版本</Text>
      {history.data?.pages
        .flatMap((page) => page.items)
        .filter((revision) => revision.id !== asset.currentRevisionId)
        .map((revision) => (
          <Stack key={revision.id} gap="xs">
            <Group justify="space-between">
              <Text>
                v{revision.number} ·{" "}
                {revision.status === "confirmed" ? "已确认" : "草稿"}
              </Text>
              <Button
                disabled={command.isPending}
                onClick={() => choose(revision.id)}
              >
                {shared ? "引入并使用" : "使用"} v{revision.number}
              </Button>
            </Group>
            <Text size="sm">
              {revision.definition.voiceDescription ||
                revision.definition.description ||
                "未填写声音说明"}
            </Text>
            <Button
              component="a"
              variant="subtle"
              target="_blank"
              rel="noopener"
              href={`#/app/t/${path.split("/")[3]}${asset.projectId ? "/p/" + asset.projectId : ""}/assets?asset=${asset.id}&revision=${revision.id}`}
            >
              在新标签页核对 v{revision.number}
            </Button>
          </Stack>
        ))}
      {history.hasNextPage && (
        <Button
          onClick={() => void history.fetchNextPage()}
          loading={history.isFetchingNextPage}
        >
          加载更后面的版本
        </Button>
      )}
    </Stack>
  );
}

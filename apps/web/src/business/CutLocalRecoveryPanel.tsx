import { useState } from "react";
import { Alert, Button, Group, Loader, Stack, Text } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, useSession, type Schema } from "./api";
import { ErrorNotice } from "./common";
import { tabIdentity } from "./content-drafts";
import {
  discardInspectedEditingLocal,
  inspectEditingLocal,
  listEditingLocal,
  type EditingLocalInspection,
} from "./editing-local";
import type { CutWorkController } from "./cut-work-controller";

async function inactiveTab<T>(
  clientSessionId: string,
  operation: () => Promise<T>,
) {
  if (!navigator.locks)
    throw new Error("暂时无法核对标签页状态，请保留副本后重试。");
  return navigator.locks.request(
    `scenedesk-content-tab:${clientSessionId}`,
    { ifAvailable: true },
    async (lock) => {
      if (!lock)
        throw new Error(
          "这份副本仍由打开的标签页使用，请返回该页面核对，或关闭该页面后刷新列表。",
        );
      return operation();
    },
  );
}
export function CutLocalRecoveryPanel({
  controller,
  close,
}: {
  controller: CutWorkController;
  close: () => void;
}) {
  const session = useSession(),
    cache = useQueryClient();
  const catalog = useQuery({
    queryKey: ["user", session.userId, "editing-local-catalog"],
    queryFn: async () => ({
      ...(await listEditingLocal(session.userId)),
      currentTab: await tabIdentity(),
    }),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const refresh = async () => {
    await catalog.refetch();
    await cache.invalidateQueries({
      queryKey: ["user", session.userId, "editing-local-access"],
    });
  };
  return (
    <Stack gap="md">
      <Text fw={600}>本机恢复副本</Text>
      <Text size="sm">
        只保留在当前浏览器，最长 7 天，共用 20
        份额度。清理本机副本不会删除服务器工作稿或历史；尚未同步的输入可能无法找回。
      </Text>
      <ErrorNotice error={catalog.error} />
      <Button loading={catalog.isFetching} onClick={() => void refresh()}>
        刷新本机副本
      </Button>
      {catalog.data && (
        <>
          <Text size="sm">
            {catalog.data.count} / {catalog.data.policy.copies} 份 · 可核对大小{" "}
            {(catalog.data.bytes / 1024).toLocaleString(undefined, {
              maximumFractionDigits: 1,
            })}{" "}
            KiB
          </Text>
          {!!catalog.data.unidentified && (
            <Alert title="部分恢复目录无法定位">
              有 {catalog.data.unidentified}{" "}
              份目录无法确认所属对象，原记录仍保留。可以先处理其他副本，或重试读取。
            </Alert>
          )}
          {catalog.data.entries.map((entry) => (
            <LocalCopy
              key={JSON.stringify(entry.partition)}
              entry={entry}
              currentTab={catalog.data.currentTab}
              controller={controller}
              close={close}
              changed={async () => {
                await refresh();
                await controller.retryLocal();
              }}
            />
          ))}
          {!catalog.data.count && (
            <Text size="sm">当前用户没有尚在保留期内的本机恢复副本。</Text>
          )}
        </>
      )}
      {catalog.isPending && (
        <Loader size="sm" aria-label="正在读取本机恢复目录" />
      )}
    </Stack>
  );
}
function LocalCopy({
  entry,
  currentTab,
  controller,
  close,
  changed,
}: {
  entry: EditingLocalInspection;
  currentTab: string;
  controller: CutWorkController;
  close: () => void;
  changed: () => Promise<void>;
}) {
  const session = useSession(),
    cache = useQueryClient();
  const partition = entry.partition;
  const [confirmation, setConfirmation] =
      useState<EditingLocalInspection | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<Error | null>(null);
  const access = useQuery({
    queryKey: ["user", session.userId, "editing-local-access", partition],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const path = `/v1/tenants/${partition.tenantId}/projects/${partition.projectId}`;
      const [project, cut] = await Promise.all([
        api<Schema<"Project">>(path, { signal }),
        partition.kind === "cut_work_draft"
          ? api<Schema<"Cut">>(`${path}/cuts/${partition.objectId}`, { signal })
          : Promise.resolve(null),
      ]);
      return { project, cut };
    },
  });
  const activity = useQuery({
    queryKey: [
      "user",
      session.userId,
      "editing-local-access",
      "tab",
      partition.clientSessionId,
    ],
    staleTime: 0,
    queryFn: async () => {
      if (partition.clientSessionId === currentTab) return "current" as const;
      if (!navigator.locks) return "unknown" as const;
      return navigator.locks.request(
        `scenedesk-content-tab:${partition.clientSessionId}`,
        { ifAvailable: true },
        (lock) => (lock ? ("closed" as const) : ("open" as const)),
      );
    },
  });
  const visible =
    !access.isFetching && !access.isError ? access.data : undefined;
  const ownObject =
    partition.tenantId === controller.partition.tenantId &&
    partition.projectId === controller.partition.projectId &&
    partition.kind === controller.partition.kind &&
    partition.objectId === controller.partition.objectId;
  const href = visible?.cut?.sceneId
    ? `#/app/t/${partition.tenantId}/p/${partition.projectId}/editing?scene=${visible.cut.sceneId}&cut=${visible.cut.id}`
    : undefined;
  const failedAccess =
    access.error instanceof ApiError &&
    [401, 403, 404].includes(access.error.status);
  const inspect = async () => {
    setBusy(true);
    setError(null);
    try {
      const current = await inactiveTab(partition.clientSessionId, () =>
        inspectEditingLocal(partition),
      );
      if (current.stamp !== entry.stamp)
        throw new Error("副本在列表打开后已有变化，请刷新列表重新核对。");
      setConfirmation(current);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason : new Error("暂时无法核对副本。"),
      );
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (
      !confirmation ||
      confirmation.stamp !== entry.stamp ||
      partition.userId !== session.userId
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await inactiveTab(partition.clientSessionId, () =>
        discardInspectedEditingLocal(confirmation),
      );
      setConfirmation(null);
      await changed();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason : new Error("副本清理未完成。"),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack gap="xs">
      <Text fw={500}>
        {visible
          ? `${visible.project.name} / ${visible.cut?.name ?? "画布恢复副本"}`
          : access.isFetching
            ? "正在核对所属项目…"
            : failedAccess
              ? "当前无法访问的对象副本"
              : "尚未核对的本机副本"}
      </Text>
      {entry.metadata ? (
        <Text size="sm">
          {new Date(entry.metadata.savedAt).toLocaleString()} ·{" "}
          {(entry.metadata.bytes / 1024).toLocaleString(undefined, {
            maximumFractionDigits: 1,
          })}{" "}
          KiB
        </Text>
      ) : (
        <Text size="sm">本机目录格式异常，保存时间与大小暂不可核对。</Text>
      )}
      <Text size="sm">
        {activity.data === "current"
          ? "由本标签页保留"
          : activity.data === "open"
            ? "另一标签页仍在使用"
            : activity.data === "closed"
              ? "原标签页已关闭"
              : "标签页状态尚未核对"}
      </Text>
      <ErrorNotice
        error={error ?? (failedAccess ? null : access.error) ?? activity.error}
      />
      {access.error instanceof ApiError && access.error.status === 401 && (
        <Button
          onClick={() =>
            void cache.invalidateQueries({ queryKey: ["session"] })
          }
        >
          重新核对当前登录
        </Button>
      )}
      <Group>
        {activity.data === "current" && ownObject ? (
          <Button onClick={close}>核对当前剪辑的本机输入</Button>
        ) : (
          href && (
            <Button component="a" href={href}>
              {activity.data === "current"
                ? "返回此剪辑核对本机输入"
                : "查看服务器工作稿"}
            </Button>
          )
        )}
        <Button
          disabled={activity.data !== "closed" || busy}
          onClick={() => void inspect()}
        >
          核对并清理这份副本
        </Button>
      </Group>
      {confirmation && (
        <Alert title="确认清理这份本机副本">
          <Text size="sm">
            将删除上面这份已关闭标签页的本机恢复记录。未同步内容可能无法找回，服务器记录仍保留。
          </Text>
          {confirmation.stamp !== entry.stamp && (
            <Text size="sm">副本已变化，请取消后重新核对。</Text>
          )}
          <Group mt="sm">
            <Button
              loading={busy}
              disabled={
                confirmation.stamp !== entry.stamp || activity.data !== "closed"
              }
              onClick={() => void remove()}
            >
              确认清理已核对副本
            </Button>
            <Button variant="subtle" onClick={() => setConfirmation(null)}>
              保留此副本
            </Button>
          </Group>
        </Alert>
      )}
    </Stack>
  );
}

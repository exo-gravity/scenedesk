import { useState } from "react";
import { Alert, Button, Checkbox, Group, Stack, Text } from "@mantine/core";
import { ErrorNotice } from "./common";
import type { CanvasController, CanvasEditorState } from "./canvas-controller";
import { canvasChanges, replayCanvasChanges } from "./canvas-reconcile";
import { CanvasEntryDetails } from "./CanvasEntryDetails";
import { EditingLocalRecoveryPanel } from "./EditingLocalRecoveryPanel";

export function canvasSaveLabel(state: CanvasEditorState) {
  if (state.accessChecking) return "正在核对权限";
  if (state.hasInvalidInput) return "有待完成输入";
  if (state.phase === "conflict") return "保存冲突";
  if (state.phase === "saving") return "保存中";
  if (state.phase === "checking" || state.local?.pending) return "核对保存结果";
  if (state.phase === "error") return "保存失败";
  if (state.recovery) return "有本机待恢复内容";
  if (state.dirty || state.storageError || !state.localSaved)
    return "本机待同步";
  return "已保存";
}
export function CanvasRecovery({
  controller,
  state,
  retry,
  selectNode,
}: {
  controller: CanvasController;
  state: CanvasEditorState;
  retry?: () => void;
  selectNode?: (id: string) => void;
}) {
  const [discard, setDiscard] = useState<string | null>(null),
    [catalog, setCatalog] = useState(false);
  const remote = state.remote;
  if (state.phase === "forbidden")
    return (
      <Alert title="画布访问已失效">
        本机内容已停止展示，请重新核对项目访问权限。
      </Alert>
    );
  if (state.accessChecking)
    return (
      <Stack gap="sm">
        <Alert title="正在核对当前访问">
          核对完成前暂停展示和编辑，本机输入仍保留。
        </Alert>
        <ErrorNotice
          error={state.error}
          retry={() => void controller.refresh()}
          retryLabel="重新核对访问权限"
        />
      </Stack>
    );
  return (
    <Stack gap="sm">
      {state.hasInvalidInput && (
        <Alert title="有输入尚未填写完整">
          原输入已保留在本机，请在对应节点或分组补全后继续保存或处理冲突。
          <Group mt="sm">
            {[
              ...new Set(
                Object.keys(state.local?.buffers ?? {})
                  .filter((key) => key.startsWith("node:"))
                  .map((key) => key.split(":")[1]!),
              ),
            ].map((id) => (
              <Button key={id} onClick={() => selectNode?.(id)}>
                继续填写 ·{" "}
                {state.local?.document.nodes.find((n) => n.id === id)?.title ??
                  "节点"}
              </Button>
            ))}
          </Group>
        </Alert>
      )}
      {state.recovery && (
        <Alert title="发现尚未同步的本机画布">
          <Text>
            来自 {new Date(state.recovery.savedAt).toLocaleString()}
            ，服务器当前为版本 {remote?.revision}
            。恢复后先核对保存结果和其他人的修改。
          </Text>
          <Group mt="sm">
            <Button
              onClick={() => {
                controller.restore();
                const key = Object.keys(
                  controller.getSnapshot().local?.buffers ?? {},
                ).find((key) => key.startsWith("node:"));
                if (key) selectNode?.(key.split(":")[1]!);
              }}
            >
              恢复本机修改
            </Button>
            <Button
              onClick={() => setDiscard(controller.localDiscardContext())}
            >
              使用服务器版本
            </Button>
          </Group>
        </Alert>
      )}
      {state.recoveryBlocked && (
        <Alert title="本机恢复副本暂不可用">
          <Text>原记录仍保留，修复或明确清理后继续编辑。</Text>
          <Group mt="sm">
            <Button onClick={() => void controller.retryLocal()}>
              重新读取副本
            </Button>
            {state.recoveryInspection && (
              <Button
                onClick={() => setDiscard(controller.localDiscardContext())}
              >
                核对并清理损坏副本
              </Button>
            )}
          </Group>
        </Alert>
      )}
      {state.storageError && (
        <Alert title="本机保留未完成">
          <Text>{state.storageError.message}</Text>
          <Group mt="sm">
            <Button onClick={() => void controller.retryLocal()}>
              重试本机保留
            </Button>
            <Button onClick={() => setCatalog(!catalog)}>管理本机副本</Button>
          </Group>
        </Alert>
      )}
      {catalog && (
        <EditingLocalRecoveryPanel
          controller={controller}
          close={() => setCatalog(false)}
        />
      )}
      <ErrorNotice
        error={state.error}
        retry={state.local ? () => void controller.save() : () => retry?.()}
        retryLabel="核对并重试保存"
      />
      {state.phase === "conflict" && state.local && remote && (
        <CanvasConflict
          controller={controller}
          state={state}
          discard={() => setDiscard(controller.localDiscardContext())}
        />
      )}
      {discard && (
        <Alert title="确认处理这份本机副本">
          <Text>
            只处理刚才核对的本机输入，服务器历史仍保留。未同步修改可能无法找回。
          </Text>
          <Group mt="sm">
            <Button
              disabled={discard !== controller.localDiscardContext()}
              onClick={() => {
                const action =
                  state.recoveryBlocked && state.recoveryInspection
                    ? controller.discardDamagedLocal(state.recoveryInspection)
                    : controller.discardLocal(discard);
                void action.then((ok) => {
                  if (ok) setDiscard(null);
                });
              }}
            >
              确认使用服务器内容
            </Button>
            <Button onClick={() => setDiscard(null)}>保留本机内容</Button>
          </Group>
        </Alert>
      )}
    </Stack>
  );
}

function CanvasConflict({
  controller,
  state,
  discard,
}: {
  controller: CanvasController;
  state: CanvasEditorState;
  discard: () => void;
}) {
  const [comparison, setComparison] = useState(() => ({
    local: state.local!,
    remote: state.remote!,
  }));
  const [selected, setSelected] = useState<string[]>([]);
  const [failure, setFailure] = useState<Error | null>(null);
  const [reading, setReading] = useState(false);
  const { local, remote } = comparison;
  const changes = canvasChanges(
    local.base.document,
    local.document,
    remote.document,
  );
  const stale =
    state.remote?.revision !== remote.revision ||
    state.local?.document !== local.document ||
    state.local?.base.revision !== local.base.revision;
  return (
    <Alert
      title={`保存冲突 · 本机基线 ${local.base.revision} / 服务器 ${remote.revision}`}
    >
      <Stack gap="sm">
        <Text>
          勾选要重新应用的节点、引用或分组。未勾选的服务端内容会保留；同时修改或删除的对象需要逐项核对。
        </Text>
        {stale && (
          <Text>
            比较之后内容又有变化，请读取最新版本后重新选择。刚才的勾选仍显示，尚未应用。
          </Text>
        )}
        {changes.map((c) => (
          <div key={c.key}>
            <Checkbox
              label={`${c.label}${c.sharedChange ? " · 同伴也有修改" : ""}${c.local ? "" : " · 本机删除"}`}
              checked={selected.includes(c.key)}
              disabled={stale}
              onChange={(e) => {
                const checked = e.currentTarget.checked;
                setSelected((items) =>
                  checked
                    ? [...items, c.key]
                    : items.filter((k) => k !== c.key),
                );
              }}
            />
            <details>
              <summary>查看两边内容</summary>
              <Text fw={600}>本机</Text>
              <CanvasEntryDetails value={c.local} document={local.document} />
              <Text fw={600}>服务器</Text>
              <CanvasEntryDetails value={c.remote} document={remote.document} />
            </details>
          </div>
        ))}
        <ErrorNotice error={failure} />
        <Group>
          <Button
            disabled={
              !selected.length || stale || reading || state.hasInvalidInput
            }
            onClick={() => {
              try {
                const result = replayCanvasChanges(
                  local.base.document,
                  local.document,
                  remote.document,
                  new Set(selected),
                );
                void controller
                  .merge(result, remote.revision)
                  .catch((e) =>
                    setFailure(
                      e instanceof Error
                        ? e
                        : new Error("重新应用未完成，本机内容仍保留。"),
                    ),
                  );
              } catch (e) {
                setFailure(
                  e instanceof Error ? e : new Error("请一起核对关联对象。"),
                );
              }
            }}
          >
            重新应用选定修改
          </Button>
          <Button
            loading={reading}
            onClick={() => {
              setReading(true);
              void controller
                .refresh()
                .then((ok) => {
                  const next = controller.getSnapshot();
                  if (ok && next.local && next.remote) {
                    setComparison({ local: next.local, remote: next.remote });
                    setSelected([]);
                    setFailure(null);
                  }
                })
                .finally(() => setReading(false));
            }}
          >
            读取最新版本
          </Button>
          <Button variant="subtle" onClick={discard}>
            放弃本机修改
          </Button>
        </Group>
      </Stack>
    </Alert>
  );
}

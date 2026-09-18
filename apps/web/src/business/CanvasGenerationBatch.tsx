import { useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { Warning } from "@phosphor-icons/react";
import { api, ApiError, useSession, type Schema } from "./api";
import { ErrorNotice, projectPath, tenantPath } from "./common";
import { jobStatusLabel } from "./assistant-session";
import type { CanvasDocument } from "@drama/domain";
import classes from "./canvas-batch.module.css";

type Batch = Schema<"CanvasGenerationBatch">;
type BatchItem = Schema<"CanvasGenerationBatchItem">;
const KIND_LABEL: Record<string, string> = {
  image: "图片",
  video: "视频",
  audio: "声音",
};
const STATUS_LABEL: Record<BatchItem["status"], string> = {
  ready: "可执行",
  blocked: "当前不可执行",
  invalid: "本次输入不可用",
  executing: "正在提交",
  executed: "已提交",
  reconciliation_required: "待核对",
  stale: "画布已改变",
};
/** Statuses that may be submitted by this confirmation. */
const RUNNABLE: BatchItem["status"][] = ["ready"];
function money(value: Schema<"Money">) {
  return `${(Number(value.amountMicros) / 1000000).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  })} ${value.currency}`;
}
/**
 * The confirmation surface for a multi-node preparation. It is deliberately a
 * panel and not a toolbar button: the multi-selection only offers to *review* a
 * plan, and nothing is submitted until the user confirms here. The panel is also
 * the one place a scene's nodes are read side by side, which is what makes scene
 * continuity decidable at all.
 */
export function CanvasGenerationBatch({
  tenantId,
  projectId,
  sceneId,
  canvasId,
  canvasRevision,
  document,
  nodeIds,
  readOnly,
  close,
}: {
  tenantId: string;
  projectId: string;
  sceneId?: string | undefined;
  canvasId: string;
  canvasRevision: number;
  document: CanvasDocument;
  nodeIds: string[];
  readOnly: boolean;
  close: () => void;
}) {
  const session = useSession(),
    path = projectPath(tenantId, projectId),
    tenant = tenantPath(tenantId);
  const [batch, setBatch] = useState<Batch>();
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const post = <T,>(url: string, body: unknown, key: string, revision?: number) =>
    api<T>(url, {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: {
        "X-CSRF-Token": session.csrfToken,
        // The key is stable for this panel, so a retried prepare resolves to the
        // same batch instead of fixing a second set of plans.
        "Idempotency-Key": key,
        "Content-Type": "application/json",
        ...(revision === undefined ? {} : { "If-Match": `"${revision}"` }),
      },
      body: JSON.stringify(body),
    });
  const [prepareKey] = useState(() => crypto.randomUUID());
  const selected = nodeIds.flatMap((id) => {
    const node = document.nodes.find((candidate) => candidate.id === id);
    return node ? [node] : [];
  });
  const prepare = () => {
    setError(null);
    setBusy(true);
    const url = sceneId
      ? `${path}/scenes/${sceneId}/canvas/generation-batches`
      : `${path}/canvases/${canvasId}/generation-batches`;
    void post<Batch>(
      url,
      {
        nodeIds: selected.map((node) => node.id),
        shotSources: [],
        referenceOverrides: [],
        promptPolicy: "append",
      },
      prepareKey,
      canvasRevision,
    )
      .then(setBatch)
      .catch((cause) =>
        setError(
          cause instanceof ApiError && cause.status === 412
            ? new Error("画布已更新，请关闭后重新选择，再做一次。")
            : cause instanceof Error
              ? cause
              : new Error("生成计划尚未固定。"),
        ),
      )
      .finally(() => setBusy(false));
  };
  const runnable = (batch?.items ?? []).filter((item) =>
    RUNNABLE.includes(item.status),
  );
  const execute = () => {
    if (!batch) return;
    setError(null);
    setBusy(true);
    void post<Batch>(
      `${path}/canvas-generation-batches/${batch.id}/execute`,
      { nodeIds: runnable.map((item) => item.nodeId) },
      crypto.randomUUID(),
    )
      .then((next) => {
        setBatch(next);
        setConfirmed(false);
      })
      .catch((cause) =>
        setError(
          cause instanceof Error ? cause : new Error("批量生成尚未提交。"),
        ),
      )
      .finally(() => setBusy(false));
  };
  const names = new Map(selected.map((node) => [node.id, node.title]));
  return (
    <Modal
      opened
      onClose={close}
      title={batch ? "确认本次批量生成" : `本次所选 ${selected.length} 项`}
      size="min(880px, 94vw)"
      centered
    >
      <Stack gap="sm">
        {!batch && (
          <>
            <Text size="sm">
              这一步只准备计划，不会提交任何生成。确认前可以逐个核对输入。
            </Text>
            <div className={classes.selection}>
              {selected.map((node) => (
                <Text size="sm" key={node.id}>
                  {node.title}
                  <Text component="span" size="xs" c="dimmed">
                    {" "}
                    · {KIND_LABEL[node.kind] ?? node.kind}
                    {node.content.type === "draft"
                      ? node.content.capabilityId
                        ? ""
                        : " · 未选模型"
                      : " · 不是创作草稿"}
                  </Text>
                </Text>
              ))}
            </div>
          </>
        )}
        <ErrorNotice error={error} />
        {busy && !batch && <Loader size="sm" aria-label="正在固定生成计划" />}
        {!batch && !busy && (
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              取消
            </Button>
            <Button
              disabled={readOnly || !selected.length}
              onClick={prepare}
            >
              查看 {selected.length} 项的生成计划
            </Button>
          </Group>
        )}
        {batch && (
          <>
            <Group gap="sm">
              <Text size="sm" c="dimmed">
                画布修订 {batch.canvasRevision}
                {batch.currentCanvasRevision !== batch.canvasRevision
                  ? `（当前已是 ${batch.currentCanvasRevision}）`
                  : ""}
              </Text>
              <Text size="sm" c="dimmed">
                {runnable.length} 项可执行 · {batch.items.length} 项已列出
              </Text>
            </Group>
            {batch.currentCanvasRevision !== batch.canvasRevision && (
              <Alert title="画布已改变">
                <Text size="sm">
                  这份计划固定的是一份旧画布。标记为“画布已改变”的项不会被提交；
                  请关闭后重新选择，让它们按最新内容重新固定。
                </Text>
              </Alert>
            )}
            <Table className={classes.table} verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>节点</Table.Th>
                  <Table.Th>模型</Table.Th>
                  <Table.Th>状态</Table.Th>
                  <Table.Th>本次预留</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {batch.items.map((item) => (
                  <Table.Tr key={item.nodeId} data-status={item.status}>
                    <Table.Td>
                      <Text size="sm">{names.get(item.nodeId) ?? item.nodeId}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {item.plan?.capabilityId.slice(0, 8) ?? "—"}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{STATUS_LABEL[item.status]}</Text>
                      {item.jobStatus && (
                        <Text size="xs" c="dimmed">
                          {jobStatusLabel[item.jobStatus]}
                        </Text>
                      )}
                      {item.status === "stale" && (
                        <Text size="xs" c="dimmed">
                          计划基于画布修订 {batch.canvasRevision}
                        </Text>
                      )}
                      {[...item.blockingReasons, item.problemCode]
                        .filter((reason): reason is string => !!reason)
                        .map((reason) => (
                          <Text size="xs" c="dimmed" key={reason}>
                            {reason}
                          </Text>
                        ))}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">
                        {item.estimatedCost ? money(item.estimatedCost) : "—"}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {batch.estimate && (
              <Text size="sm">
                合计本次预留：{money(batch.estimate.totalReservation)}
                <br />
                {batch.estimate.basisNote}
              </Text>
            )}
            {!batch.estimate && (
              <Text size="sm" c="dimmed">
                没有可执行项，因而不产生合计预留。
              </Text>
            )}
            {runnable.length > 0 && (
              <Alert icon={<Warning size={16} />} title="提交后仍不会自动采用">
                <Text size="sm">
                  结果会归档并保留来源节点；采用仍在候选工作区里单独进行。
                </Text>
              </Alert>
            )}
            <Checkbox
              checked={confirmed}
              disabled={!runnable.length || readOnly}
              onChange={(event) => setConfirmed(event.currentTarget.checked)}
              label={`我确认按上面列出的 ${runnable.length} 项提交生成`}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={close}>
                关闭
              </Button>
              <Button
                disabled={
                  !confirmed || !runnable.length || readOnly || busy
                }
                onClick={execute}
              >
                提交 {runnable.length} 项生成
              </Button>
            </Group>
          </>
        )}
        {error && batch && (
          <Text size="xs" c="dimmed">
            已提交的项不受影响；可以只对仍在“可执行”的项再次确认。
          </Text>
        )}
      </Stack>
    </Modal>
  );
}

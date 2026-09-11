import { useEffect, useState } from "react";
import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
import {
  canRequestCancellation,
  cancellationDescription,
  type AsyncGenerationJob,
  type CancellationRequest,
  type CancellationTarget,
} from "./generation-lifecycle";

export function GenerationJobControls({
  job,
  cancellation,
  active,
  busy,
  label,
  requestCancellation,
}: {
  job: AsyncGenerationJob;
  cancellation?: CancellationRequest | undefined;
  active: boolean;
  busy: boolean;
  label: string;
  requestCancellation: (target: CancellationTarget) => Promise<void>;
}) {
  const [confirmation, setConfirmation] = useState<
    (CancellationTarget & { label: string }) | null
  >(null);
  useEffect(() => setConfirmation(null), [job.id, job.planId, active]);
  const description = cancellationDescription(job, cancellation);
  return (
    <Stack gap="xs" aria-label={`${label}取消状态`}>
      {job.status === "provider_pending" && (
        <Text size="sm">
          模型已接收这次任务，正在等待处理。可以离开页面，稍后读取进度。
        </Text>
      )}
      {job.status === "provider_running" && (
        <Text size="sm">
          模型正在处理固定输入。完成后会先保存结果，再提供取回入口。
        </Text>
      )}
      {description && (
        <Alert
          title={
            job.cancelStatus === "confirmed" && job.status === "cancelled"
              ? "已确认取消"
              : "取消状态"
          }
        >
          {description}
        </Alert>
      )}
      {canRequestCancellation(job) && (
        <Group>
          <Button
            variant="default"
            size="xs"
            disabled={!active || busy}
            onClick={() =>
              setConfirmation({ jobId: job.id, planId: job.planId, label })
            }
          >
            {cancellation ? "恢复原取消请求" : "请求取消任务"}
          </Button>
        </Group>
      )}
      <Modal
        opened={!!confirmation}
        onClose={() => setConfirmation(null)}
        title="确认请求取消"
        centered
      >
        {confirmation && (
          <Stack>
            <Text>
              取消“{confirmation.label}”（任务 {confirmation.jobId.slice(0, 8)}
              ）。
            </Text>
            <Text size="sm">
              这只请求停止原任务，不能保证模型尚未完成。已完成的结果仍会保留，原输入和旧结果不会被替换。
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setConfirmation(null)}>
                继续等待
              </Button>
              <Button
                disabled={
                  !active ||
                  busy ||
                  confirmation.jobId !== job.id ||
                  confirmation.planId !== job.planId
                }
                onClick={() => {
                  const target = confirmation;
                  setConfirmation(null);
                  void requestCancellation(target);
                }}
              >
                确认请求取消
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

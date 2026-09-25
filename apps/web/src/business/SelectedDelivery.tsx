import { useEffect, useRef, useState } from "react";
import { Alert, Button, Group, Modal, Stack, Text, Tooltip } from "@mantine/core";
import { DownloadSimple } from "@phosphor-icons/react";
import { api, ApiError, useSession, type Schema } from "./api";
import { ErrorNotice } from "./common";
import classes from "./shot-list.module.css";

function seconds(value: number) {
  return `${Math.floor(value / 1_000_000)}.${
    String(value % 1_000_000)
      .padStart(6, "0")
      .replace(/0+$/, "") || "0"
  }`;
}

/** The confirmation keeps the exact preview; query refreshes cannot replace it. */
export function SelectedDelivery({
  path,
  sceneId,
  active,
  transition,
  selectedCount,
}: {
  path: string;
  sceneId: string;
  active: boolean;
  transition: (next: () => void) => Promise<void>;
  selectedCount?: number;
}) {
  const session = useSession();
  const [preview, setPreview] = useState<Schema<"SelectedDeliveryPreview">>(),
    [busy, setBusy] = useState<"preview" | "download">(),
    [error, setError] = useState<Error | null>(null),
    [opened, setOpened] = useState(false),
    [requested, setRequested] = useState(false);
  const pending = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => pending.current?.abort(), []);
  const base = `${path}/scenes/${sceneId}/selected-delivery`;
  const unavailable = !active ? "恢复项目或场次后可打包下载" : selectedCount === 0 ? "先明确选用至少一个镜头" : undefined;
  async function load() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy("preview");
    setPreview(undefined);
    setError(null);
    setRequested(false);
    try {
      const value = await api<Schema<"SelectedDeliveryPreview">>(base, {
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(15_000),
        ]),
      });
      setPreview(value);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error ? cause : new Error("交接清单读取失败。"),
        );
    } finally {
      pending.current = undefined;
      setBusy(undefined);
    }
  }
  async function download() {
    if (!preview || pending.current) return;
    const fixed = preview;
    const controller = new AbortController();
    pending.current = controller;
    setBusy("download");
    setError(null);
    setRequested(false);
    try {
      const response = await fetch(`${base}/download`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(330_000),
        ]),
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        },
        body: JSON.stringify({ ticket: fixed.ticket }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new ApiError(
          response.status,
          body.code ?? "DELIVERY_UNAVAILABLE",
          body.message ?? "原片包未完成，请稍后重试。",
        );
      }
      if (response.headers.get("content-type") !== "application/zip")
        throw new Error("收到的文件格式不正确，未开始下载。请重试。");
      const blob = await response.blob();
      const expected = Number(response.headers.get("content-length"));
      if (
        !Number.isSafeInteger(expected) ||
        expected <= 0 ||
        blob.size !== expected
      )
        throw new Error("文件接收不完整，未开始下载。请保留清单后重试。");
      controller.signal.throwIfAborted();
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = `SceneDesk-${sceneId}-selected.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setRequested(true);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause
            : new Error("下载连接中断，请保留清单后重试。"),
        );
    } finally {
      pending.current = undefined;
      setBusy(undefined);
    }
  }
  return (
    <>
      <Tooltip label={unavailable} disabled={!unavailable} events={{ hover: true, focus: true, touch: true }}>
        <span tabIndex={unavailable ? 0 : undefined}>
          <Button
            size="sm"
            variant="default"
            leftSection={<DownloadSimple size={15} />}
            disabled={!!unavailable || !!busy}
            loading={busy === "preview"}
            onClick={() =>
              void transition(() => {
                setOpened(true);
                void load();
              })
            }
          >
            下载本场已选用
          </Button>
        </span>
      </Tooltip>
      <Modal opened={opened} onClose={() => { if (!busy) setOpened(false); }} title="下载本场已选用" size="lg" closeOnClickOutside={!busy} closeOnEscape={!busy} withCloseButton={!busy}>
        <Stack gap="sm">
          {busy === "preview" && <Text size="sm" role="status">正在核对本场选用与原片…</Text>}
          <ErrorNotice error={error} {...(!busy ? { retry: () => void load() } : {})} />
          {busy === "download" && (
            <Button
              size="xs"
              variant="subtle"
              onClick={() => {
                pending.current?.abort();
                setError(new Error("下载已取消，清单保留。可以再次确认下载。"));
              }}
            >
              取消下载
            </Button>
          )}
          {preview && (
            <section aria-label="选用原片交接清单">
              <Stack gap="sm">
                <Text fw={600}>
                  {preview.manifest.sceneTitle} · {preview.manifest.entries.length}{" "}
                  个已选用镜头
                </Text>
                <Text size="sm" c="dimmed">
                  按镜头顺序打包完整原视频，附镜头说明和入出点清单，文件未经裁剪。省略{" "}
                  {preview.manifest.unselectedCount} 个未选用、
                  {preview.manifest.archivedCount} 个已归档镜头。
                </Text>
                <ol className={classes.deliveryList}>
                  {preview.manifest.entries.map((entry) => (
                    <li key={entry.selectionId}>
                      <Text size="sm" fw={600}>
                        {entry.shotLabel} · {seconds(entry.range.inUs)}–
                        {seconds(entry.range.outUs)} 秒
                      </Text>
                      <Text size="sm">{entry.intent}</Text>
                      <Text size="xs" c="dimmed">
                        {entry.originalFileName}
                        {entry.takeNote ? ` · ${entry.takeNote}` : ""}
                      </Text>
                    </li>
                  ))}
                </ol>
                <Text size="xs" c="dimmed">
                  原片合计 {(preview.manifest.totalBytes / 1024 / 1024).toFixed(1)}{" "}
                  MB。每包最多 100 个镜头、256 MB；准备最多约 3 分钟，可取消后重试。
                </Text>
                {busy === "download" && (
                  <Text role="status" size="sm">
                    正在准备并接收原片包，请保持此窗口打开。镜头选用有变化时会停止并请你重新核对。
                  </Text>
                )}
                {requested && (
                  <Alert>
                    原片包已交给浏览器下载，请在浏览器下载记录中核对 ZIP 文件。
                  </Alert>
                )}
                <Group gap="xs">
                  <Button
                    size="sm"
                    loading={busy === "download"}
                    disabled={!!busy || !active}
                    onClick={() => void download()}
                  >
                    确认下载原片包
                  </Button>
                  <Button
                    size="sm"
                    variant="subtle"
                    disabled={!!busy}
                    onClick={() => {
                      setPreview(undefined);
                      setRequested(false);
                      setError(null);
                      setOpened(false);
                    }}
                  >
                    收起清单
                  </Button>
                </Group>
              </Stack>
            </section>
          )}
        </Stack>
      </Modal>
    </>
  );
}

import { editingCanonical } from "@drama/domain";
import { useRef, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { ArrowRight } from "@phosphor-icons/react";
import { api, ApiError, useSession, type Schema } from "./api";
import { DraftNotice, useContentDraft } from "./content-drafts";
import { selectedTextareaRange } from "./script-excerpt-selection";
import { ErrorNotice } from "./common";

type Intent = {
  excerpt: Schema<"ScriptExcerpt"> | null;
  nodeId?: string;
  key?: string;
  canvasId?: string;
  revision?: number;
  position?: Schema<"CanvasPoint">;
};
const empty: Intent = { excerpt: null };
/** Selection uses the saved canonical text, including Word table separators and Unicode.
 * Its fixed source is independent of which manuscript is subsequently current. */
export function ScriptCanvasExcerpt({
  script,
  current,
  active,
  path,
}: {
  script: Schema<"ScriptRevision">;
  current: boolean;
  active: boolean;
  path: string;
}) {
  const session = useSession();
  const draft = useContentDraft<Intent>(`${path}/canvas-excerpt`, empty, 1);
  const [opened, setOpened] = useState(false),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<Error>(),
    [missing, setMissing] = useState(false);
  const [receipt, setReceipt] =
    useState<Schema<"CanvasScriptExcerptReceipt">>();
  const pending = !!draft.value.nodeId;
  const post = <T,>(
    url: string,
    key: string,
    body?: unknown,
    revision?: number,
  ) =>
    api<T>(url, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        "X-CSRF-Token": session.csrfToken,
        "Idempotency-Key": key,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(revision === undefined ? {} : { "If-Match": `"${revision}"` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause : Error("暂未完成，请保留原选文。"),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const acknowledge = (
    found: Schema<"CanvasScriptExcerptReceipt">,
    intent: Intent,
  ) => {
    if (
      found.canvasId !== intent.canvasId ||
      found.nodeId !== intent.nodeId ||
      editingCanonical(found.sourceExcerpt) !== editingCanonical(intent.excerpt)
    )
      throw Error("返回的选文与原请求不一致，请保留原记录并核对。");
    setReceipt(found);
    setMissing(false);
  };
  const check = async () => {
    const intent = draft.value;
    if (!intent.canvasId || !intent.nodeId) {
      setMissing(true);
      return;
    }
    try {
      acknowledge(
        await api<Schema<"CanvasScriptExcerptReceipt">>(
          `${path}/canvases/${intent.canvasId}/script-excerpts/${intent.nodeId}`,
        ),
        intent,
      );
    } catch (cause) {
      if (
        cause instanceof ApiError &&
        cause.status === 404 &&
        cause.code === "NOT_FOUND"
      ) {
        // Verify project/canvas access first: a hidden resource is not an absent receipt.
        await api(`${path}/canvases/${intent.canvasId}`);
        setMissing(true);
      } else throw cause;
    }
  };
  const submit = async () => {
    let intent = draft.value;
    if (!intent.excerpt || !active) return;
    if (!intent.nodeId) {
      intent = {
        ...intent,
        nodeId: crypto.randomUUID(),
        key: crypto.randomUUID(),
      };
      if (!(await draft.stage(intent)))
        throw Error("选文尚未保存在本机，暂未添加。");
    }
    const canvas = intent.canvasId
      ? await api<Schema<"Canvas">>(`${path}/canvases/${intent.canvasId}`)
      : (await post<Schema<"ProjectCanvas">>(`${path}/canvas`, intent.key!))
          .canvas;
    // Re-read does not overwrite the shared canvas: the service appends only this node under CAS.
    intent = {
      ...intent,
      canvasId: canvas.id,
      revision: canvas.revision,
      key: crypto.randomUUID(),
      position: intent.position ?? {
        x: 80,
        y: Math.min(
          999000,
          Math.max(-200, ...canvas.document.nodes.map((n) => n.position.y)) +
            280,
        ),
      },
    };
    if (!(await draft.stage(intent)))
      throw Error("原添加请求未保留，暂未提交。");
    acknowledge(
      await post<Schema<"CanvasScriptExcerptReceipt">>(
        `${path}/canvases/${canvas.id}/script-excerpts`,
        intent.key!,
        {
          nodeId: intent.nodeId,
          sourceExcerpt: intent.excerpt,
          position: intent.position,
        },
        canvas.revision,
      ),
      intent,
    );
  };
  return (
    <Stack gap="xs">
      <Group>
        <Button
          variant="light"
          leftSection={<ArrowRight size={16} />}
          disabled={!active}
          onClick={() => setOpened(true)}
        >
          选文带入画布
        </Button>
        {(draft.recovered || pending) && (
          <Text size="sm">有待核对的选文，原请求仍保留。</Text>
        )}
      </Group>
      <Modal
        opened={opened}
        onClose={() => {
          if (!busy) setOpened(false);
        }}
        title="选文带入画布"
        size="lg"
        centered
      >
        <Stack>
          <Text size="sm">
            在原文中选中一段，作为画布参考继续创作。导入新稿后，这段原文仍保持不变。
          </Text>
          <DraftNotice
            draft={draft}
            pendingCreation={pending || !!draft.recovered?.value.nodeId}
          />
          {!draft.recovered && !draft.committed && (
            <>
              {!pending && (
                <Textarea
                  label={current ? "当前稿原文" : "历史稿原文"}
                  description="拖动选中，或使用键盘 Shift + 方向键。"
                  value={script.text}
                  readOnly
                  minRows={9}
                  maxRows={14}
                  autosize
                  onSelect={(event) => {
                    const el = event.currentTarget;
                    if (el.selectionStart === el.selectionEnd) return;
                    try {
                      const selected = selectedTextareaRange(
                        script.text,
                        el.value,
                        el.selectionStart,
                        el.selectionEnd,
                      );
                      if (Array.from(selected.quote).length > 20000)
                        throw Error("每次最多选择两万字，请分段带入画布。");
                      draft.setValue({
                        excerpt: { scriptRevisionId: script.id, ...selected },
                      });
                      setError(undefined);
                    } catch (cause) {
                      setError(cause as Error);
                    }
                  }}
                />
              )}
              {draft.value.excerpt && (
                <Alert title="选中的原文">
                  <Text
                    style={{
                      whiteSpace: "pre-wrap",
                      maxHeight: 180,
                      overflow: "auto",
                    }}
                  >
                    {draft.value.excerpt.quote}
                  </Text>
                </Alert>
              )}
              <ErrorNotice error={error ?? null} />
              {receipt ? (
                <Alert
                  title={
                    receipt.nodeActive
                      ? "选文已添加到画布"
                      : "原选文已添加，随后被移除"
                  }
                >
                  <Text size="sm">
                    {receipt.nodeActive
                      ? "可选中这段文字，创建图片或视频草稿。"
                      : "没有重复添加或恢复被移除的节点。"}
                  </Text>
                  <Button
                    mt="sm"
                    onClick={() =>
                      void draft.complete(() => {
                        location.hash = `${path.replace(/^\/v1\/tenants\//, "#/app/t/").replace("/projects/", "/p/")}/canvas${receipt.nodeActive ? `?node=${receipt.nodeId}` : ""}`;
                      })
                    }
                  >
                    进入画布
                  </Button>
                </Alert>
              ) : pending ? (
                <Group>
                  <Button
                    loading={busy}
                    disabled={!draft.ready || !!draft.recovered || !active}
                    onClick={() => void run(check)}
                  >
                    核对原选文添加结果
                  </Button>
                  {missing && (
                    <Button
                      variant="light"
                      loading={busy}
                      onClick={() => void run(submit)}
                    >
                      按最新画布继续添加
                    </Button>
                  )}
                </Group>
              ) : (
                <Button
                  loading={busy}
                  disabled={!draft.ready || !draft.value.excerpt || !active}
                  onClick={() => void run(submit)}
                >
                  添加选文到项目画布
                </Button>
              )}
            </>
          )}
        </Stack>
      </Modal>
    </Stack>
  );
}

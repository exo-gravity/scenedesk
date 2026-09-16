import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Loader,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { LinkSimple } from "@phosphor-icons/react";
import { api, useCommand, useResource, useSession, type Schema } from "./api";
import { DraftNotice, useContentDraft } from "./content-drafts";
import { ErrorNotice } from "./common";
import { DocumentBody, Warnings } from "./ScriptDocumentBody";
import classes from "./script-document.module.css";

type State = Schema<"FeishuImportState">;
type Draft = {
  url: string;
  requestId: string;
  importRequestId: string;
  sha256: string;
  attempted: boolean;
};
const empty: Draft = {
  url: "",
  requestId: "",
  importRequestId: "",
  sha256: "",
  attempted: false,
};
type Props = { path: string; tree: Schema<"ContentTree">; done: () => void };
export function FeishuScriptImport(props: Props) {
  const [epoch, setEpoch] = useState(0);
  return (
    <ImportLink
      key={epoch}
      {...props}
      reset={() => setEpoch((value) => value + 1)}
    />
  );
}
function ImportLink({
  path,
  tree,
  done,
  reset,
}: Props & { reset: () => void }) {
  const draft = useContentDraft<Draft>(
    `${path}/script-feishu-import`,
    empty,
    tree.revision,
  );
  const session = useSession(),
    command = useCommand<Schema<"ScriptRevision">>();
  const [open, setOpen] = useState(false),
    [state, setState] = useState<State>(),
    [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false),
    [checking, setChecking] = useState(false),
    [notSaved, setNotSaved] = useState(false),
    [completed, setCompleted] = useState(false),
    [resume, setResume] = useState(0);
  const mounted = useRef(true),
    operation = useRef<symbol | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current = null;
    };
  }, []);
  const current = (token: symbol) =>
    mounted.current && operation.current === token;
  function begin() {
    if (operation.current || !mounted.current || completed || draft.committed)
      return;
    const token = Symbol();
    operation.current = token;
    setBusy(true);
    return token;
  }
  function finish(token: symbol) {
    if (current(token)) {
      operation.current = null;
      setBusy(false);
    }
  }
  const show = open || draft.dirty || !!draft.recovered || draft.committed;
  const available = useResource<Schema<"FeishuImportAvailability">>(
    `${path}/feishu-imports/availability`,
    show,
  );
  const conflict = draft.baseVersion !== tree.revision;
  const request = (
    url: string,
    body?: unknown,
    method = "POST",
    version?: number,
  ) =>
    api<any>(url, {
      method,
      headers: {
        "X-CSRF-Token": session.csrfToken,
        "Idempotency-Key": crypto.randomUUID(),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(version === undefined ? {} : { "If-Match": `"${version}"` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  // Resume the same durable export; refreshing never starts another export.
  useEffect(() => {
    if (
      !draft.ready ||
      draft.recovered ||
      !draft.value.requestId ||
      completed ||
      draft.committed
    )
      return;
    let live = true;
    const id = draft.value.requestId;
    setState(undefined);
    setError(undefined);
    void (async () => {
      try {
        let value = await api<State>(`${path}/feishu-imports/${id}`);
        while (live) {
          setState(value);
          if (!["pending", "creating", "exporting"].includes(value.state))
            return;
          await new Promise((resolve) => setTimeout(resolve, 2000));
          if (!live) return;
          value = await request(`${path}/feishu-imports/${id}/advance`, {});
        }
      } catch (error) {
        if (live) setError(error as Error);
      }
    })();
    return () => {
      live = false;
    };
  }, [
    path,
    draft.value.requestId,
    draft.ready,
    !!draft.recovered,
    completed,
    draft.committed,
    resume,
  ]);
  async function read() {
    const token = begin();
    if (!token) return;
    setError(undefined);
    try {
      const value = {
        ...draft.value,
        requestId: draft.value.requestId || crypto.randomUUID(),
        importRequestId: crypto.randomUUID(),
        sha256: "",
        attempted: false,
      };
      if (!(await draft.stage(value)) || !current(token)) return;
      const created = await request(`${path}/feishu-imports`, {
        requestId: value.requestId,
        sourceUrl: value.url,
      });
      if (current(token)) {
        setState(created);
        setResume((n) => n + 1);
      }
    } catch (error) {
      if (current(token)) setError(error as Error);
    } finally {
      finish(token);
    }
  }
  async function complete(token: symbol) {
    if (!current(token)) return;
    await draft.complete(() => {
      if (!mounted.current) return;
      setCompleted(true);
      done();
    });
  }
  async function check() {
    const token = begin();
    if (!token) return;
    setChecking(true);
    setError(undefined);
    try {
      const result = await api<Schema<"ScriptImportReceipt">>(
        `${path}/script-imports/${draft.value.importRequestId}`,
      );
      if (!current(token)) return;
      if (result.found) {
        if (
          result.script?.source?.previewId !== draft.value.requestId ||
          result.script.sha256 !== draft.value.sha256 ||
          result.baseVersion !== draft.baseVersion
        )
          throw new Error("服务器结果与本次导入不一致，请核对当前稿。");
        await complete(token);
      } else setNotSaved(true);
    } catch (error) {
      if (current(token)) setError(error as Error);
    } finally {
      if (current(token)) setChecking(false);
      finish(token);
    }
  }
  async function confirm() {
    if (!state?.preview) return;
    const token = begin();
    if (!token) return;
    setError(undefined);
    try {
      const value = {
        ...draft.value,
        sha256: state.preview.sha256,
        attempted: true,
      };
      if (!(await draft.stage(value)) || !current(token)) return;
      await command.mutateAsync({
        path: `${path}/feishu-imports/${value.requestId}/confirm`,
        body: {
          importRequestId: value.importRequestId,
          previewSha256: value.sha256,
        },
        version: draft.baseVersion,
      });
      await complete(token);
    } catch (error) {
      if (current(token)) setError(error as Error);
    } finally {
      finish(token);
    }
  }
  async function abandon() {
    const token = begin();
    if (!token) return;
    setError(undefined);
    try {
      if (draft.value.requestId)
        await request(
          `${path}/feishu-imports/${draft.value.requestId}`,
          undefined,
          "DELETE",
        ).catch((error) => {
          if (error.status !== 404) throw error;
        });
      if (current(token) && (await draft.clear()) && current(token)) reset();
    } catch (error) {
      if (current(token)) setError(error as Error);
    } finally {
      finish(token);
    }
  }
  async function rebase() {
    const token = begin();
    if (!token) return;
    try {
      if (
        await draft.stage(
          {
            ...draft.value,
            importRequestId: crypto.randomUUID(),
            attempted: false,
          },
          tree.revision,
        )
      ) {
        if (current(token)) {
          setNotSaved(false);
          setError(undefined);
        }
      }
    } finally {
      finish(token);
    }
  }
  const disabled = !draft.ready || !!draft.recovered || busy || !!draft.error;
  if (completed)
    return (
      <Button variant="subtle" onClick={reset}>
        再次导入飞书文档
      </Button>
    );
  return (
    <Stack gap="sm">
      {!show && (
        <Group>
          <Button
            variant="subtle"
            leftSection={<LinkSimple size={16} />}
            onClick={() => setOpen(true)}
          >
            从飞书导入
          </Button>
        </Group>
      )}
      {(draft.recovered || draft.error || draft.committed) && (
        <DraftNotice draft={draft} />
      )}
      {show && !draft.committed && (
        <section className={classes.import} aria-label="飞书导入预览">
          <Group justify="space-between">
            <Text fw={600}>从飞书导入</Text>
            <Button
              variant="subtle"
              disabled={busy || !!draft.recovered}
              onClick={() => void abandon()}
            >
              取消导入
            </Button>
          </Group>
          <Text size="sm" c="dimmed">
            {available.data?.message ??
              "粘贴团队共享的飞书文档链接，先预览再导入。"}
          </Text>
          <TextInput
            label="飞书文档链接"
            placeholder="https://你的团队.feishu.cn/docx/…"
            value={draft.value.url}
            disabled={disabled || !!draft.value.requestId}
            onChange={(event) =>
              draft.setValue({ ...draft.value, url: event.currentTarget.value })
            }
          />
          <ErrorNotice error={error ?? available.error} />
          {!state && !draft.value.attempted && (
            <Button
              disabled={
                disabled ||
                !draft.value.url.trim() ||
                available.data?.projectBound === false
              }
              loading={busy}
              onClick={() => void read()}
            >
              读取并预览
            </Button>
          )}
          {state &&
            ["pending", "creating", "exporting"].includes(state.state) && (
              <Group>
                <Loader size="sm" />
                <Text size="sm">正在读取飞书正文，可以离开后继续。</Text>
              </Group>
            )}
          {state?.errorMessage && <Alert>{state.errorMessage}</Alert>}
          {state && ["expired", "failed", "unknown"].includes(state.state) && (
            <Text size="sm">
              请取消本次导入，核对文档授权后重新读取。链接仍保留在输入框中。
            </Text>
          )}
          {state?.preview && (
            <>
              <Text size="sm" c="dimmed">
                尚未导入 · {state.title} · 读取于{" "}
                {new Date(state.fetchedAt!).toLocaleString()}
              </Text>
              <Text size="xs" c="dimmed">
                按本次飞书导出的 Word 展示；画板、评论和嵌入内容可能简化，请核对源文档。
              </Text>
              <Warnings document={state.preview.document} />
              <DocumentBody
                document={state.preview.document}
                text={state.preview.text}
              />
              {conflict && (
                <Alert title="当前稿已更新">
                  <Text size="sm">
                    预览仍保留。请先核对本次是否已经导入，再核对当前稿。
                  </Text>
                  <Button
                    mt="sm"
                    variant="default"
                    disabled={disabled || !notSaved}
                    onClick={() => void rebase()}
                  >
                    已核对当前稿，继续导入
                  </Button>
                </Alert>
              )}
              <Button
                disabled={disabled || conflict}
                loading={busy && !checking}
                onClick={() => void confirm()}
              >
                确认导入
              </Button>
            </>
          )}
          {(draft.value.attempted || conflict) &&
            draft.value.importRequestId && (
              <Group>
                <Button
                  variant="default"
                  disabled={disabled}
                  loading={checking}
                  onClick={() => void check()}
                >
                  核对导入结果
                </Button>
                {notSaved && <Text size="sm">尚未保存，可继续导入。</Text>}
              </Group>
            )}
          {error && draft.value.requestId && (
            <Button
              variant="subtle"
              disabled={busy}
              onClick={() => setResume((n) => n + 1)}
            >
              继续读取预览
            </Button>
          )}
        </section>
      )}
    </Stack>
  );
}

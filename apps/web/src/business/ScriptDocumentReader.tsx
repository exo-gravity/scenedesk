import { ScriptCanvasExcerpt } from "./ScriptCanvasExcerpt";
import { DocumentBody, Warnings } from "./ScriptDocumentBody";
export { DocumentBody, Warnings } from "./ScriptDocumentBody";
import { FeishuScriptImport } from "./FeishuScriptImport";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Alert,
  Button,
  FileButton,
  Group,
  Loader,
  Menu,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import {
  DownloadSimple,
  DotsThree,
  FileDoc,
  ClockCounterClockwise,
  PencilSimple,
  UploadSimple,
} from "@phosphor-icons/react";
import { api, useCommand, useResource, type Schema } from "./api";
import { DraftNotice, useContentDraft } from "./content-drafts";
import { ScriptEditor } from "./ContentEditors";
import { ErrorNotice } from "./common";
import classes from "./script-document.module.css";
import { selectedDocumentQuote } from "./script-excerpt-selection";

type Preview = Schema<"ScriptDocumentPreview">;
type ImportDraft = {
  fileName: string;
  data: string;
  importRequestId: string;
  preview: Preview | null;
  attempted: boolean;
};
const empty: ImportDraft = {
  fileName: "",
  data: "",
  importRequestId: "",
  preview: null,
  attempted: false,
};
export function ScriptDocumentReader({
  tree,
  scripts,
  path,
  active,
  initialHistoryId,
  done,
}: {
  tree: Schema<"ContentTree">;
  scripts: Schema<"ScriptRevision">[];
  path: string;
  active: boolean;
  initialHistoryId?: string | null;
  done: () => void;
}) {
  const [history, setHistory] = useState<string | null>(
      initialHistoryId ?? null,
    ),
    [legacy, setLegacy] = useState(false),
    [showHistory, setShowHistory] = useState(false),
    [showNotes, setShowNotes] = useState(false),
    [importEpoch, setImportEpoch] = useState(0);
  // Move only entry buttons into the toolbar; import and recovery sessions stay mounted.
  const [wordAction, setWordAction] = useState<HTMLDivElement | null>(null),
    [feishuAction, setFeishuAction] = useState<HTMLDivElement | null>(null),
    [excerptAction, setExcerptAction] = useState<HTMLDivElement | null>(null);
  const [selectedExcerpt, setSelectedExcerpt] =
    useState<Schema<"ScriptExcerpt">>();
  const [downloadError, setDownloadError] = useState<Error>(),
    [downloading, setDownloading] = useState(false);
  useEffect(() => {
    setHistory(initialHistoryId ?? null);
  }, [initialHistoryId]);
  const selected = scripts.find(
    (script) => script.id === (history ?? tree.currentScriptRevisionId),
  );
  const fixed = useResource<Schema<"ScriptRevision">>(
    `${path}/scripts/${selected?.id ?? "none"}`,
    !!selected,
  );
  async function downloadOriginal() {
    if (!selected) return;
    setDownloading(true);
    setDownloadError(undefined);
    try {
      const original = await api<Schema<"ScriptDocumentOriginal">>(
        `${path}/scripts/${selected.id}/original`,
      );
      const data = Uint8Array.from(atob(original.data), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(
        new Blob([data], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = original.fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setDownloadError(error as Error);
    } finally {
      setDownloading(false);
    }
  }
  return (
    <Stack gap="lg" className={classes.reader}>
      <div className={classes.toolbar}>
        <div className={classes.documentIdentity}>
          <Text fw={600}>
            {selected
              ? `${history && history !== tree.currentScriptRevisionId ? "历史稿 · 只读" : "当前稿"} · ${selected.source ? "飞书导入" : selected.sourceFormat === "docx" ? "Word 导入" : "纯文本"}`
              : "导入你的初稿剧本"}
          </Text>
          {(selected?.fileName || !selected) && (
            <Text size="sm" c="dimmed">
              {selected?.fileName ??
                "把已确定的剧本带到这里，与项目成员一起阅读。"}
            </Text>
          )}
        </div>
        <Group gap="xs" className={classes.documentActions}>
          <div ref={setWordAction} />
          <div ref={setFeishuAction} />
          {history && history !== tree.currentScriptRevisionId && (
            <Button
              component="a"
              href={location.hash.split("?")[0]}
              variant="subtle"
              onClick={() => {
                setHistory(null);
                setShowHistory(false);
                setLegacy(false);
              }}
            >
              返回当前稿
            </Button>
          )}
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <Button
                variant="subtle"
                leftSection={<DotsThree size={18} />}
                aria-label="文档更多操作"
              >
                更多
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<ClockCounterClockwise size={16} />}
                disabled={!scripts.length}
                onClick={() => setShowHistory(!showHistory)}
              >
                查看历史
              </Menu.Item>
              {selected?.sourceFormat === "docx" && (
                <Menu.Item
                  leftSection={<DownloadSimple size={16} />}
                  disabled={downloading}
                  onClick={() => void downloadOriginal()}
                >
                  {selected.source ? "下载本次导出文件" : "下载原件"}
                </Menu.Item>
              )}
              {!!fixed.data?.document?.warnings.length && (
                <Menu.Item onClick={() => setShowNotes(!showNotes)}>
                  导入说明
                </Menu.Item>
              )}
              {active && !history && (
                <Menu.Item
                  leftSection={<PencilSimple size={16} />}
                  onClick={() => setLegacy(!legacy)}
                >
                  {legacy ? "收起正文编辑" : "编辑纯文本"}
                </Menu.Item>
              )}
            </Menu.Dropdown>
          </Menu>
        </Group>
        <div className={classes.excerptAction}>
          <div ref={setExcerptAction} />
        </div>
      </div>
      {showHistory && (
        <Group align="end">
          <Select
            aria-label="查阅历史剧本"
            label="历史稿"
            placeholder="当前稿"
            value={history}
            onChange={(value) => {
              setHistory(value === tree.currentScriptRevisionId ? null : value);
              setLegacy(false);
            }}
            data={[...scripts]
              .sort((a, b) => b.number - a.number)
              .map((script) => ({
                value: script.id,
                label: `${script.createdAt ? new Date(script.createdAt).toLocaleString() : "导入时间未记录"} · ${script.fileName ?? "剧本文字"}${script.id === tree.currentScriptRevisionId ? " · 当前稿" : ""}`,
              }))}
          />
          <Button variant="subtle" onClick={() => setShowHistory(false)}>
            收起历史
          </Button>
        </Group>
      )}
      <ErrorNotice error={downloadError ?? null} />
      {active && (
        <ScriptImport
          key={importEpoch}
          path={path}
          tree={tree}
          actionTarget={wordAction}
          reset={() => setImportEpoch((value) => value + 1)}
          done={done}
        />
      )}
      {active && (
        <FeishuScriptImport
          path={path}
          tree={tree}
          done={done}
          actionTarget={feishuAction}
        />
      )}
      {selected?.source && (
        <Text size="sm" c="dimmed">
          飞书 · {selected.source.title} · 读取于{" "}
          {new Date(selected.source.fetchedAt).toLocaleString()}{" "}
          <a
            href={selected.source.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            查看源文档
          </a>
        </Text>
      )}
      {selected ? (
        <>
          <ErrorNotice error={fixed.error} retry={() => void fixed.refetch()} />
          {fixed.isPending && <Loader aria-label="正在读取剧本正文" />}
          {showNotes && (
            <Warnings
              document={!fixed.isError ? fixed.data?.document : undefined}
            />
          )}
          {fixed.data && !fixed.isError && (
            <>
              <ScriptCanvasExcerpt
                script={fixed.data}
                current={fixed.data.id === tree.currentScriptRevisionId}
                active={active}
                path={path}
                actionTarget={excerptAction}
                selectedExcerpt={selectedExcerpt}
              />
              <DocumentBody
                document={fixed.data.document}
                text={fixed.data.text}
                onTextSelection={(quote) => {
                  const selected = selectedDocumentQuote(
                    fixed.data!.text,
                    quote,
                  );
                  setSelectedExcerpt(
                    selected
                      ? { scriptRevisionId: fixed.data!.id, ...selected }
                      : undefined,
                  );
                }}
              />
            </>
          )}
        </>
      ) : (
        <div className={classes.empty}>
          <FileDoc size={40} />
          <Text>支持 .docx · 最大 4 MB</Text>
          <Text size="sm" c="dimmed">
            选择文件，预览正文后确认导入。
          </Text>
        </div>
      )}
      {history && !selected && (
        <Alert title="所选版本不可用">
          没有找到此固定剧本版本，请重新选择历史版本。
        </Alert>
      )}
      {active && !history && legacy && (
        <>
          <Alert title="纯文本编辑">
            保存后显示纯文本，不保留 Word 版式。原稿会自动留存在历史中。
          </Alert>
          <ScriptEditor
            tree={tree}
            scripts={scripts}
            path={path}
            presentation="document"
            done={done}
          />
        </>
      )}
    </Stack>
  );
}
function ScriptImport({
  path,
  tree,
  actionTarget,
  reset,
  done,
}: {
  path: string;
  tree: Schema<"ContentTree">;
  actionTarget: HTMLDivElement | null;
  reset: () => void;
  done: () => void;
}) {
  const draft = useContentDraft<ImportDraft>(
    `${path}/script-docx-import`,
    empty,
    tree.revision,
  );
  const preview = useCommand<Preview>(),
    commit = useCommand<Schema<"ScriptRevision">>();
  const [error, setError] = useState<Error>(),
    [reading, setReading] = useState(false);
  const [checking, setChecking] = useState(false),
    [notSaved, setNotSaved] = useState(false);
  const [busy, setBusy] = useState(false),
    [submitting, setSubmitting] = useState(false),
    [completed, setCompleted] = useState(false);
  const operation = useRef<symbol | null>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current = null;
    };
  }, []);
  // A late response belongs to this mounted import intent, never to a draft
  // restored or replaced by another instance at the same storage key.
  const current = (token: symbol) =>
    mounted.current && operation.current === token;
  function begin() {
    if (!mounted.current || operation.current || completed || draft.committed)
      return null;
    const token = Symbol();
    operation.current = token;
    setBusy(true);
    return token;
  }
  function finish(token: symbol) {
    if (!current(token)) return;
    operation.current = null;
    setBusy(false);
  }
  const conflict = draft.baseVersion !== tree.revision;
  function complete(token: symbol) {
    if (!current(token)) return Promise.resolve();
    return draft.complete(() => {
      // Cleanup may be explicitly retried after a local storage error. The
      // operation can end meanwhile, but this import instance must still own it.
      if (!mounted.current) return;
      setCompleted(true);
      done();
    });
  }
  async function checkReceipt() {
    const token = begin();
    if (!token) return;
    setChecking(true);
    setError(undefined);
    try {
      const receipt = await api<Schema<"ScriptImportReceipt">>(
        `${path}/script-imports/${draft.value.importRequestId}`,
      );
      if (!current(token)) return;
      if (receipt.found && receipt.script) {
        if (
          receipt.script.sha256 !== draft.value.preview?.sha256 ||
          receipt.script.fileName !== draft.value.fileName ||
          receipt.baseVersion !== draft.baseVersion
        )
          throw new Error("服务器回执与本机文件不一致，请核对历史版本。");
        await complete(token);
      } else setNotSaved(true);
    } catch (error) {
      if (current(token)) setError(error as Error);
    } finally {
      if (current(token)) setChecking(false);
      finish(token);
    }
  }
  async function submit() {
    if (!draft.value.preview) return;
    const token = begin();
    if (!token) return;
    setSubmitting(true);
    setError(undefined);
    try {
      if (
        !(await draft.stage({ ...draft.value, attempted: true })) ||
        !current(token)
      )
        return;
      await commit.mutateAsync({
        path: `${path}/scripts/import-docx`,
        body: {
          fileName: draft.value.fileName,
          data: draft.value.data,
          previewSha256: draft.value.preview.sha256,
          importRequestId: draft.value.importRequestId,
        },
        version: draft.baseVersion,
      });
      await complete(token);
    } catch (error) {
      if (current(token)) setError(error as Error);
    } finally {
      if (current(token)) setSubmitting(false);
      finish(token);
    }
  }
  async function parseFile(value: ImportDraft, token: symbol) {
    const result = await preview.mutateAsync({
      path: `${path}/scripts/preview-docx`,
      body: { fileName: value.fileName, data: value.data },
    });
    if (current(token)) await draft.stage({ ...value, preview: result });
  }
  async function previewFile() {
    const token = begin();
    if (!token) return;
    setError(undefined);
    try {
      await parseFile(draft.value, token);
    } catch (error) {
      if (current(token)) setError(error as Error);
    } finally {
      finish(token);
    }
  }
  async function choose(file: File | null) {
    if (!file) return;
    const token = begin();
    if (!token) return;
    setError(undefined);
    setReading(true);
    try {
      if (!/\.docx$/i.test(file.name) || file.size > 4 * 1024 * 1024)
        throw new Error("请选择不超过 4 MB 的 .docx 文件。");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!current(token)) return;
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      const value = {
        fileName: file.name,
        data: btoa(binary),
        importRequestId: crypto.randomUUID(),
        preview: null,
        attempted: false,
      };
      if ((await draft.stage(value)) && current(token))
        await parseFile(value, token);
    } catch (error) {
      if (current(token)) setError(error as Error);
    } finally {
      if (current(token)) setReading(false);
      finish(token);
    }
  }
  async function abandon() {
    const token = begin();
    if (!token) return;
    try {
      if ((await draft.clear()) && current(token)) reset();
    } finally {
      finish(token);
    }
  }
  async function rebase() {
    const token = begin();
    if (!token) return;
    try {
      const saved = await draft.stage(
        {
          ...draft.value,
          importRequestId: crypto.randomUUID(),
          attempted: false,
        },
        tree.revision,
      );
      if (saved && current(token)) {
        setNotSaved(false);
        commit.reset();
        setError(undefined);
      }
    } finally {
      finish(token);
    }
  }
  return (
    <Stack gap="md">
      {!completed && (draft.recovered || draft.committed || draft.error) && (
        <DraftNotice draft={draft} />
      )}
      {!completed &&
        draft.dirty &&
        !draft.recovered &&
        !draft.committed &&
        !draft.error && (
          <Text size="xs" c="dimmed" aria-live="polite">
            {draft.saved ? "文件已保留，离开后可继续导入。" : "正在保留文件…"}
          </Text>
        )}
      {completed && <Text size="sm">导入已保存。</Text>}
      {!draft.committed && !completed && (
        <>
          {actionTarget &&
            createPortal(
              <FileButton
                onChange={(file) => void choose(file)}
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              >
                {(props) => (
                  <Button
                    {...props}
                    variant="default"
                    leftSection={<UploadSimple size={16} />}
                    loading={reading || preview.isPending}
                    disabled={
                      !draft.ready ||
                      !!draft.recovered ||
                      busy ||
                      !!draft.value.fileName
                    }
                  >
                    {tree.currentScriptRevisionId
                      ? "重新导入 Word"
                      : "导入 Word"}
                  </Button>
                )}
              </FileButton>,
              actionTarget,
            )}
          <ErrorNotice error={error ?? commit.error} />
          {draft.value.fileName && (
            <section className={classes.import} aria-label="Word 导入预览">
              <Group justify="space-between">
                <div>
                  <Text fw={600}>{draft.value.fileName}</Text>
                  <Text size="sm" c="dimmed">
                    尚未导入 · 请核对正文和显示说明
                  </Text>
                </div>
                <Button
                  variant="subtle"
                  disabled={busy}
                  onClick={() => void abandon()}
                >
                  放弃本次导入
                </Button>
              </Group>
              {!draft.value.preview && (
                <Button
                  variant="default"
                  loading={preview.isPending}
                  disabled={!draft.ready || !!draft.recovered || busy}
                  onClick={() => void previewFile()}
                >
                  重新解析预览
                </Button>
              )}
              {draft.value.preview && (
                <>
                  <Warnings document={draft.value.preview.document} />
                  <DocumentBody
                    document={draft.value.preview.document}
                    text={draft.value.preview.text}
                  />
                  {conflict && (
                    <Alert title="项目内容已更新">
                      <Text>
                        导入文件仍保留。先核对本次导入是否已保存，再核对当前剧本。
                      </Text>
                      <Button
                        mt="sm"
                        variant="default"
                        disabled={!notSaved || busy}
                        onClick={() => void rebase()}
                      >
                        已核对最新版本，继续导入
                      </Button>
                    </Alert>
                  )}
                  {(draft.value.attempted || commit.error || conflict) && (
                    <Group>
                      <Button
                        variant="default"
                        loading={checking}
                        disabled={busy || !!draft.recovered || !draft.ready}
                        onClick={() => void checkReceipt()}
                      >
                        核对本次导入结果
                      </Button>
                      {notSaved && (
                        <Text size="sm" c="dimmed">
                          尚无已保存回执，可以核对最新版本后继续。
                        </Text>
                      )}
                    </Group>
                  )}
                  <Button
                    loading={
                      busy && !checking && !reading && !preview.isPending
                    }
                    disabled={
                      busy ||
                      conflict ||
                      !draft.ready ||
                      !!draft.recovered ||
                      !!draft.error
                    }
                    onClick={() => void submit()}
                  >
                    确认导入
                  </Button>
                </>
              )}
            </section>
          )}
        </>
      )}
    </Stack>
  );
}

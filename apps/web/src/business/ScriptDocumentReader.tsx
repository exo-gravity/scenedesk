import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  FileButton,
  Group,
  Image,
  Loader,
  Select,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import {
  DownloadSimple,
  FileDoc,
  PencilSimple,
  UploadSimple,
} from "@phosphor-icons/react";
import { api, useCommand, useResource, type Schema } from "./api";
import { DraftNotice, useContentDraft } from "./content-drafts";
import { ScriptEditor } from "./ContentEditors";
import { ErrorNotice } from "./common";
import classes from "./script-document.module.css";

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
function DocumentBody({
  document,
  text,
}: {
  document?: Schema<"ScriptDocument"> | undefined;
  text: string;
}) {
  return (
    <article className={classes.paper} aria-label="剧本阅读正文">
      {document ? (
        document.blocks.map((block, index) => {
          if (block.kind === "heading")
            return (
              <Text
                component="h2"
                size={block.level === 1 ? "xl" : "lg"}
                fw={600}
                key={index}
              >
                {block.text}
              </Text>
            );
          if (block.kind === "table")
            return (
              <Table.ScrollContainer minWidth={400} key={index}>
                <Table withTableBorder withColumnBorders>
                  <Table.Tbody>
                    {block.rows?.map((row, i) => (
                      <Table.Tr key={i}>
                        {row.map((cell, j) => (
                          <Table.Td key={j}>{cell}</Table.Td>
                        ))}
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            );
          if (block.kind === "image")
            return (
              <figure key={index}>
                <Image
                  src={block.imageData}
                  alt={block.alt ?? "文档图片"}
                  fit="contain"
                  mah={560}
                  loading="lazy"
                />
                <figcaption>{block.alt}</figcaption>
              </figure>
            );
          return <p key={index}>{block.text || "\u00a0"}</p>;
        })
      ) : (
        <div className={classes.plain}>{text}</div>
      )}
    </article>
  );
}
function Warnings({
  document,
}: {
  document?: Schema<"ScriptDocument"> | undefined;
}) {
  return document?.warnings.length ? (
    <Alert title="导入显示说明">
      <Stack gap="xs">
        {document.warnings.map((warning, i) => (
          <Text size="sm" key={i}>
            {warning}
          </Text>
        ))}
      </Stack>
    </Alert>
  ) : null;
}
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
    [importEpoch, setImportEpoch] = useState(0);
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
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text fw={600}>
            {selected?.fileName ?? (selected ? "剧本正文" : "导入你的初稿剧本")}
          </Text>
          <Text size="sm" c="dimmed">
            {selected
              ? `第 ${selected.number} 版 · ${history && history !== tree.currentScriptRevisionId ? "历史只读" : "当前版本"} · ${selected.createdAt ? new Date(selected.createdAt).toLocaleString() : ""}`
              : "把已确定的 Word 初稿带到这里，与项目成员一起阅读。"}
          </Text>
        </div>
        <Group gap="sm">
          <Select
            aria-label="查阅历史剧本"
            placeholder="当前版本"
            clearable
            value={history}
            onChange={(value) => {
              setHistory(value);
              setLegacy(false);
            }}
            data={[...scripts]
              .sort((a, b) => b.number - a.number)
              .map((script) => ({
                value: script.id,
                label: `第 ${script.number} 版${script.id === tree.currentScriptRevisionId ? " · 当前" : ""}`,
              }))}
          />
          {selected?.sourceFormat === "docx" && (
            <Button
              variant="default"
              leftSection={<DownloadSimple size={16} />}
              loading={downloading}
              onClick={() => void downloadOriginal()}
            >
              下载原件
            </Button>
          )}
        </Group>
      </Group>
      <ErrorNotice error={downloadError ?? null} />
      {active && (
        <ScriptImport
          key={importEpoch}
          path={path}
          tree={tree}
          reset={() => setImportEpoch((value) => value + 1)}
          done={done}
        />
      )}
      {selected ? (
        <>
          <ErrorNotice error={fixed.error} retry={() => void fixed.refetch()} />
          {fixed.isPending && <Loader aria-label="正在读取剧本正文" />}
          <Warnings
            document={!fixed.isError ? fixed.data?.document : undefined}
          />
          {fixed.data && !fixed.isError && (
            <DocumentBody
              document={fixed.data.document}
              text={fixed.data.text}
            />
          )}
        </>
      ) : (
        <div className={classes.empty}>
          <FileDoc size={40} />
          <Text>支持 .docx · 最大 4 MB</Text>
          <Text size="sm" c="dimmed">
            先预览再导入。每次更新保存一个新版本，旧版本和引用保留。
          </Text>
        </div>
      )}
      {history && !selected && (
        <Alert title="所选版本不可用">
          没有找到此固定剧本版本，请重新选择历史版本。
        </Alert>
      )}
      {active && !history && (
        <>
          <Button
            variant="subtle"
            size="sm"
            leftSection={<PencilSimple size={16} />}
            onClick={() => setLegacy(!legacy)}
          >
            {legacy ? "收起正文编辑" : "打开原有纯文本编辑"}
          </Button>
          {legacy && (
            <>
              <Alert title="纯文本编辑">
                编辑后保存为纯文本新版本，不包含 Word
                版式。导入原件与原版仍保留在历史中。
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
        </>
      )}
    </Stack>
  );
}
function ScriptImport({
  path,
  tree,
  reset,
  done,
}: {
  path: string;
  tree: Schema<"ContentTree">;
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
  const submissionLock = useRef(false);
  const [stagingSubmission, setStagingSubmission] = useState(false);
  const conflict = draft.baseVersion !== tree.revision;
  async function checkReceipt() {
    setChecking(true);
    setError(undefined);
    try {
      const receipt = await api<Schema<"ScriptImportReceipt">>(
        `${path}/script-imports/${draft.value.importRequestId}`,
      );
      if (receipt.found && receipt.script) {
        if (
          receipt.script.sha256 !== draft.value.preview?.sha256 ||
          receipt.script.fileName !== draft.value.fileName ||
          receipt.baseVersion !== draft.baseVersion
        )
          throw new Error("服务器回执与本机文件不一致，请核对历史版本。");
        await draft.complete(done);
      } else setNotSaved(true);
    } catch (error) {
      setError(error as Error);
    } finally {
      setChecking(false);
    }
  }
  async function submit() {
    if (submissionLock.current || !draft.value.preview) return;
    submissionLock.current = true;
    setStagingSubmission(true);
    try {
      if (!(await draft.stage({ ...draft.value, attempted: true }))) return;
      commit.mutate(
        {
          path: `${path}/scripts/import-docx`,
          body: {
            fileName: draft.value.fileName,
            data: draft.value.data,
            previewSha256: draft.value.preview.sha256,
            importRequestId: draft.value.importRequestId,
          },
          version: draft.baseVersion,
        },
        {
          onCommitted: () => {
            void draft.complete(done);
          },
        },
      );
    } finally {
      submissionLock.current = false;
      setStagingSubmission(false);
    }
  }
  async function previewFile(value = draft.value) {
    setError(undefined);
    try {
      const result = await preview.mutateAsync({
        path: `${path}/scripts/preview-docx`,
        body: { fileName: value.fileName, data: value.data },
      });
      await draft.stage({ ...value, preview: result });
    } catch (error) {
      setError(error as Error);
    }
  }
  async function choose(file: File | null) {
    if (!file) return;
    setError(undefined);
    if (!/\.docx$/i.test(file.name) || file.size > 4 * 1024 * 1024) {
      setError(new Error("请选择不超过 4 MB 的 .docx 文件。"));
      return;
    }
    setReading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
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
      if (await draft.stage(value)) await previewFile(value);
    } catch (error) {
      setError(error as Error);
    } finally {
      setReading(false);
    }
  }
  return (
    <Stack gap="md">
      {(draft.dirty || draft.recovered || draft.committed || draft.error) && (
        <DraftNotice draft={draft} />
      )}
      {!draft.committed && (
        <>
          <Group>
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
                    commit.isPending ||
                    !!draft.value.fileName
                  }
                >
                  导入 Word 初稿 / 更新版本
                </Button>
              )}
            </FileButton>
          </Group>
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
                  disabled={reading || preview.isPending || commit.isPending}
                  onClick={() => {
                    void draft.clear().then((ok) => {
                      if (ok) reset();
                    });
                  }}
                >
                  放弃本次导入
                </Button>
              </Group>
              {!draft.value.preview && (
                <Button
                  variant="default"
                  loading={preview.isPending}
                  disabled={!draft.ready || !!draft.recovered || reading}
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
                        disabled={!notSaved}
                        onClick={() => {
                          void draft
                            .stage(
                              {
                                ...draft.value,
                                importRequestId: crypto.randomUUID(),
                                attempted: false,
                              },
                              tree.revision,
                            )
                            .then((ok) => {
                              if (ok) {
                                setNotSaved(false);
                                commit.reset();
                              }
                            });
                        }}
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
                        disabled={
                          commit.isPending || !!draft.recovered || !draft.ready
                        }
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
                    loading={commit.isPending || stagingSubmission}
                    disabled={
                      conflict ||
                      !draft.ready ||
                      !!draft.recovered ||
                      !!draft.error
                    }
                    onClick={() => void submit()}
                  >
                    确认导入为新版本
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

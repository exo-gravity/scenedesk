import { ScriptCanvasExcerpt } from "./ScriptCanvasExcerpt";
import { DocumentBody, Warnings } from "./ScriptDocumentBody";
export { DocumentBody, Warnings } from "./ScriptDocumentBody";
import { FeishuScriptImport } from "./FeishuScriptImport";
import { ScriptWordImport } from "./ScriptWordImport";
import { useEffect, useState } from "react";
import {
  Alert,
  Button,
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
} from "@phosphor-icons/react";
import { api, useResource, type Schema } from "./api";
import { ScriptEditor } from "./ContentEditors";
import { ErrorNotice } from "./common";
import classes from "./script-document.module.css";
import { selectedDocumentQuote } from "./script-excerpt-selection";

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
      {selected ? (
        <>
          <div className={classes.versionRow}>
            <div className={classes.versionMeta}>
              <Text fw={600} size="sm">
                {history && history !== tree.currentScriptRevisionId
                  ? "历史稿 · 只读"
                  : "当前稿"}{" "}
                ·{" "}
                {selected.source
                  ? "飞书导入"
                  : selected.sourceFormat === "docx"
                    ? "Word 导入"
                    : "纯文本"}
              </Text>
              {selected.fileName && (
                <Text size="sm" c="dimmed">
                  {selected.fileName}
                  {selected.createdAt
                    ? ` · ${new Date(selected.createdAt).toLocaleDateString()}`
                    : ""}
                </Text>
              )}
            </div>
            <Group gap="xs" className={classes.versionActions}>
              {history && history !== tree.currentScriptRevisionId && (
                <Button
                  component="a"
                  href={location.hash.split("?")[0]}
                  variant="default"
                  onClick={() => {
                    setHistory(null);
                    setShowHistory(false);
                    setLegacy(false);
                  }}
                >
                  返回当前稿
                </Button>
              )}
              <div ref={setWordAction} />
              <div ref={setFeishuAction} />
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
          </div>
          <div className={classes.excerptRow}>
            <div ref={setExcerptAction} />
          </div>
        </>
      ) : (
        <div className={classes.emptyState}>
          <Text fw={600}>导入你的初稿剧本</Text>
          <Text size="sm" c="dimmed">
            把已确定的剧本带到这里，与项目成员一起阅读。
          </Text>
          <Group gap="sm" justify="center">
            <div ref={setWordAction} />
            <div ref={setFeishuAction} />
          </Group>
          <Text size="xs" c="dimmed">
            支持 .docx，最大 4 MB。
          </Text>
        </div>
      )}
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
        <ScriptWordImport
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
      ) : null}
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

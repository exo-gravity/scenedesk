import { useEffect, useState } from "react";
import { Loader, Menu, Select, Text, UnstyledButton } from "@mantine/core";
import { ClockCounterClockwise, DotsThree, DownloadSimple } from "@phosphor-icons/react";
import { api, useList, useResource, type Schema } from "../../business/api";
import { ErrorNotice, projectPath } from "../../business/common";
import { DocumentBody, Warnings } from "../../business/ScriptDocumentBody";
import { ScriptWordImport } from "../../business/ScriptWordImport";
import { FeishuScriptImport } from "../../business/FeishuScriptImport";
import { ScriptCanvasExcerpt } from "../../business/ScriptCanvasExcerpt";
import { selectedDocumentQuote } from "../../business/script-excerpt-selection";
import classes from "./script.module.css";

/**
 * The script view: import a manuscript (Word or Feishu), read the current
 * one or a fixed earlier one, and take a selection onto the board as a fixed
 * excerpt. It is a manuscript, not a generator: no script card, no editing
 * of imported text here.
 */
export function ScriptView({
  tenantId,
  projectId,
  active,
  revisionId,
}: {
  tenantId: string;
  projectId: string;
  active: boolean;
  /** A fixed earlier revision to read, from the address; absent reads the current one. */
  revisionId: string | undefined;
}) {
  const path = projectPath(tenantId, projectId);
  const base = `#/app/t/${tenantId}/p/${projectId}/studio`;
  const content = useResource<Schema<"ContentTree">>(`${path}/content`);
  const scripts = useList<Schema<"ScriptRevision">>(`${path}/scripts`);
  const tree = content.data;
  const selectedId = revisionId ?? tree?.currentScriptRevisionId;
  const listed = scripts.data?.find((script) => script.id === selectedId);
  const fixed = useResource<Schema<"ScriptRevision">>(`${path}/scripts/${encodeURIComponent(selectedId ?? "")}`, !!selectedId);
  const [epoch, setEpoch] = useState(0);
  const [wordAction, setWordAction] = useState<HTMLDivElement | null>(null);
  const [feishuAction, setFeishuAction] = useState<HTMLDivElement | null>(null);
  const [excerptAction, setExcerptAction] = useState<HTMLDivElement | null>(null);
  const [selectedExcerpt, setSelectedExcerpt] = useState<Schema<"ScriptExcerpt">>();
  const [notes, setNotes] = useState(false);
  const [downloadError, setDownloadError] = useState<Error | null>(null);
  useEffect(() => setSelectedExcerpt(undefined), [selectedId]);
  const done = () => {
    void Promise.all([content.refetch(), scripts.refetch()]).then(() => setEpoch((value) => value + 1));
  };
  const historical = !!tree && !!selectedId && selectedId !== tree.currentScriptRevisionId;
  const goTo = (id: string | null) => {
    location.hash = id && id !== tree?.currentScriptRevisionId ? `${base}/script?revision=${id}` : `${base}/script`;
  };
  async function downloadOriginal() {
    if (!fixed.data) return;
    setDownloadError(null);
    try {
      const original = await api<Schema<"ScriptDocumentOriginal">>(`${path}/scripts/${fixed.data.id}/original`);
      const data = Uint8Array.from(atob(original.data), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(
        new Blob([data], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = original.fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setDownloadError(error as Error);
    }
  }
  if (content.isError || scripts.isError)
    return (
      <div className={classes.center}>
        <ErrorNotice error={content.error ?? scripts.error} retry={() => { void content.refetch(); void scripts.refetch(); }} />
      </div>
    );
  if (!tree || !scripts.data)
    return (
      <div className={classes.center}>
        <Loader aria-label="正在读取剧本" />
      </div>
    );
  return (
    <div className={classes.view}>
      <div className={classes.column}>
        {selectedId ? (
          <header className={classes.toolbar}>
            <div className={classes.meta}>
              <span className={classes.badge} data-historical={historical || undefined}>
                {historical ? "历史稿 · 只读" : "当前稿"}
                {listed && ` · ${listed.source ? "飞书导入" : listed.sourceFormat === "docx" ? "Word 导入" : "纯文本"}`}
              </span>
              {listed?.fileName && (
                <span className={classes.file}>
                  {listed.fileName}
                  {listed.createdAt ? ` · ${new Date(listed.createdAt).toLocaleDateString()}` : ""}
                </span>
              )}
            </div>
            <div className={classes.actions}>
              {historical && (
                <UnstyledButton className={classes.pill} onClick={() => goTo(null)}>
                  返回当前稿
                </UnstyledButton>
              )}
              <Select
                aria-label="查阅历史剧本"
                variant="unstyled"
                classNames={{ input: classes.history!, root: classes.historyRoot! }}
                leftSection={<ClockCounterClockwise size={14} aria-hidden />}
                value={selectedId}
                allowDeselect={false}
                onChange={(value) => goTo(value)}
                data={[...scripts.data]
                  .sort((a, b) => b.number - a.number)
                  .map((script) => ({
                    value: script.id,
                    label: `第 ${script.number} 稿 · ${script.createdAt ? new Date(script.createdAt).toLocaleString() : "导入时间未记录"}${script.id === tree.currentScriptRevisionId ? " · 当前稿" : ""}`,
                  }))}
              />
              <div ref={setWordAction} className={classes.slot} />
              <div ref={setFeishuAction} className={classes.slot} />
              <div ref={setExcerptAction} className={classes.slot} />
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <UnstyledButton className={classes.icon} aria-label="文档更多操作">
                    <DotsThree size={18} aria-hidden />
                  </UnstyledButton>
                </Menu.Target>
                <Menu.Dropdown>
                  {listed?.sourceFormat === "docx" && (
                    <Menu.Item leftSection={<DownloadSimple size={14} />} onClick={() => void downloadOriginal()}>
                      {listed.source ? "下载本次导出文件" : "下载原件"}
                    </Menu.Item>
                  )}
                  <Menu.Item disabled={!fixed.data?.document?.warnings.length} onClick={() => setNotes((value) => !value)}>
                    {notes ? "收起导入说明" : "导入说明"}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </div>
          </header>
        ) : (
          <div className={classes.empty}>
            <Text fw={600}>导入你的初稿剧本</Text>
            <Text size="sm" c="dimmed">
              把已确定的剧本带到这里，与项目成员一起阅读，再带着原文进入创作台。
            </Text>
            <div className={classes.actions}>
              <div ref={setWordAction} className={classes.slot} />
              <div ref={setFeishuAction} className={classes.slot} />
            </div>
            <Text size="xs" c="dimmed">
              支持 .docx，最大 4 MB。
            </Text>
          </div>
        )}
        <ErrorNotice error={downloadError} />
        {active && (
          <ScriptWordImport key={`word:${epoch}`} path={path} tree={tree} actionTarget={wordAction} reset={() => setEpoch((value) => value + 1)} done={done} />
        )}
        {active && <FeishuScriptImport path={path} tree={tree} done={done} actionTarget={feishuAction} />}
        {listed?.source && (
          <Text size="xs" c="dimmed">
            飞书 · {listed.source.title} · 读取于 {new Date(listed.source.fetchedAt).toLocaleString()}{" "}
            <a href={listed.source.sourceUrl} target="_blank" rel="noopener noreferrer">
              查看源文档
            </a>
          </Text>
        )}
        {selectedId && (
          <>
            <ErrorNotice error={fixed.error} retry={() => void fixed.refetch()} />
            {fixed.isPending && <Loader aria-label="正在读取剧本正文" />}
            {fixed.data && !fixed.isError && (
              <>
                {notes && <Warnings document={fixed.data.document} />}
                <ScriptCanvasExcerpt
                  script={fixed.data}
                  current={fixed.data.id === tree.currentScriptRevisionId}
                  active={active}
                  path={path}
                  actionTarget={excerptAction}
                  selectedExcerpt={selectedExcerpt}
                  canvasHref={(nodeId) => (nodeId ? `${base}?node=${nodeId}` : base)}
                />
                <div className={classes.paper}>
                  <DocumentBody
                    document={fixed.data.document}
                    text={fixed.data.text}
                    onTextSelection={(quote) => {
                      const selected = selectedDocumentQuote(fixed.data!.text, quote);
                      setSelectedExcerpt(selected ? { scriptRevisionId: fixed.data!.id, ...selected } : undefined);
                    }}
                  />
                </div>
              </>
            )}
            {!listed && scripts.data && (
              <Text size="sm" c="dimmed">
                没有找到此固定剧本版本，请重新选择历史版本。
              </Text>
            )}
          </>
        )}
      </div>
    </div>
  );
}

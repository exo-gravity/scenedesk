import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { ArrowLeft, Plus } from "@phosphor-icons/react";
import { useList, useResource } from "./api";
import { Empty, ErrorNotice, SectionHeading } from "./common";
import { statusName, type Props, type Proposal } from "./proposal-model";
import { ImportForm } from "./CsvImportForm";
import { ProposalEditor } from "./ProposalEditor";
import classes from "./proposals.module.css";
export function ProposalWorkspace(props: Props) {
  const [view, setView] = useState<"list" | "import" | "detail">("list"),
    [id, setId] = useState<string>(),
    [status, setStatus] = useState<string | null>(null),
    [sceneId, setSceneId] = useState<string | null>(null);
  const filters = new URLSearchParams();
  if (status) filters.set("status", status);
  if (sceneId) filters.set("sceneId", sceneId);
  const proposals = useList<Proposal>(
    `${props.path}/proposals?${filters}`,
    view === "list",
  );
  function open(proposalId: string) {
    setId(proposalId);
    setView("detail");
  }
  return (
    <Stack gap="xl">
      <Button
        variant="subtle"
        leftSection={<ArrowLeft size={18} />}
        onClick={props.onClose}
        w="fit-content"
      >
        返回集场镜
      </Button>
      <SectionHeading
        title={`${props.projectName} · 导入与提案`}
        description="先核对制作结构，再明确采纳。CSV 导入不调用模型。"
        action={
          view === "list" && (
            <Button
              leftSection={<Plus size={18} />}
              disabled={!props.active}
              onClick={() => setView("import")}
            >
              导入 CSV
            </Button>
          )
        }
      />
      {view !== "list" && (
        <Button
          variant="subtle"
          onClick={() => setView("list")}
          w="fit-content"
        >
          全部提案
        </Button>
      )}
      {!props.active && (
        <Alert title="项目已归档">
          可以查看提案及历史，恢复项目后再修改或采纳。
        </Alert>
      )}
      {view === "import" && <ImportForm {...props} onCreated={open} />}
      {view === "detail" && id && (
        <ProposalDetail {...props} key={id} id={id} />
      )}
      {view === "list" && (
        <>
          <Group align="end">
            <Select
              label="状态"
              placeholder="全部状态"
              clearable
              value={status}
              onChange={setStatus}
              data={Object.entries(statusName).map(([value, label]) => ({
                value,
                label,
              }))}
            />
            <Select
              label="追加到场次"
              placeholder="全部目标"
              clearable
              searchable
              value={sceneId}
              onChange={setSceneId}
              data={props.tree.scenes.map((s) => ({
                value: s.id,
                label: s.title,
              }))}
            />
          </Group>
          <ErrorNotice
            error={proposals.error}
            retry={() => void proposals.refetch()}
          />
          {proposals.isPending ? (
            <Loader aria-label="正在读取提案" />
          ) : proposals.data?.length ? (
            <div className={classes.list}>
              {proposals.data.map((p) => (
                <article key={p.id} className={classes.row}>
                  <Group justify="space-between">
                    <Text fw={600}>
                      CSV ·{" "}
                      {p.operations.filter((op) => op.kind === "shot").length}{" "}
                      个镜头
                    </Text>
                    <Badge variant="light">{statusName[p.status]}</Badge>
                  </Group>
                  <Text mt="sm">
                    {p.target.mode === "new_structure"
                      ? "新建集场镜结构"
                      : `追加到 ${props.tree.scenes.find((s) => s.id === (p.target as { sceneId: string }).sceneId)?.title ?? "指定场次"}`}
                  </Text>
                  <Text size="sm" c="dimmed" mt="xs">
                    第 {p.revision} 版 · 基于内容版本 {p.baseContentRevision} ·{" "}
                    {p.createdAt ? new Date(p.createdAt).toLocaleString() : ""}
                  </Text>
                  <Button mt="md" variant="default" onClick={() => open(p.id)}>
                    打开提案
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            <Empty>
              还没有符合条件的提案。导入 CSV 后会保存在这里，关闭页面也能找回。
            </Empty>
          )}
        </>
      )}
    </Stack>
  );
}
function ProposalDetail(props: Props & { id: string }) {
  const current = useResource<Proposal>(`${props.path}/proposals/${props.id}`),
    [revision, setRevision] = useState<string | null>(null),
    [epoch, setEpoch] = useState(0),
    [selection, setSelection] = useState<string[]>([]);
  const history = useResource<Proposal>(
    `${props.path}/proposals/${props.id}?revisionNumber=${revision ?? 1}`,
    !!revision,
  );
  if (current.isError)
    return (
      <ErrorNotice error={current.error} retry={() => void current.refetch()} />
    );
  if (!current.data) return <Loader aria-label="正在打开提案" />;
  const proposal = revision ? history.data : current.data;
  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Badge variant="light">{statusName[current.data.status]}</Badge>
        <Select
          label="提案修订"
          value={revision ?? "current"}
          onChange={(v) => setRevision(v === "current" ? null : v)}
          data={[
            {
              value: "current",
              label: `当前 · 第 ${current.data.revision} 版`,
            },
            ...Array.from({ length: current.data.revision }, (_, i) => ({
              value: String(i + 1),
              label: `历史 · 第 ${i + 1} 版${i === 0 ? "（原始导入）" : ""}`,
            })),
          ]}
        />
      </Group>
      <details>
        <summary>导入来源记录</summary>
        <Text size="xs" c="dimmed" className={classes.wrap}>
          CSV 内容摘要：{current.data.sourceHash}
        </Text>
        <Text size="sm" c="dimmed">
          原始导入内容保存在第 1 版，每次人工修改另存修订。
        </Text>
      </details>
      <ErrorNotice error={history.error} retry={() => void history.refetch()} />
      {proposal ? (
        <ProposalEditor
          {...props}
          key={`${props.id}:${revision ?? "current"}:${epoch}`}
          proposal={proposal}
          current={current.data}
          historical={!!revision}
          initialSelection={revision ? [] : selection}
          onSaved={(selected) => {
            setSelection(selected);
            setEpoch((e) => e + 1);
          }}
        />
      ) : (
        <Loader aria-label="正在读取历史修订" />
      )}
    </Stack>
  );
}

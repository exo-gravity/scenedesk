import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
} from "@mantine/core";
import { ArrowLeft, CheckCircle } from "@phosphor-icons/react";
import { useCommand, useList, useResource, type Schema } from "./api";
import { Empty, ErrorNotice, SectionHeading } from "./common";
import { DraftNotice, useContentDraft } from "./content-drafts";
import classes from "./creative.module.css";

type Basis = Schema<"CreativeBasisRevision">;
type Confirmation = Schema<"CreativeConfirmation">;
type Props = {
  path: string;
  project: Schema<"Project">;
  tree: Schema<"ContentTree">;
  members: Schema<"Membership">[];
  canConfirm: boolean;
  onClose: () => void;
};
const kindNames = {
  script: "剧本正文",
  production: "剧目设定",
  scene: "场次设定",
  shot_dialogue: "镜头台词",
};
const date = (value?: string) =>
  value ? new Date(value).toLocaleString() : "";
function subjectName(basis: Basis, tree: Props["tree"]) {
  return basis.basis.kind === "scene"
    ? (tree.scenes.find((s) => s.id === basis.subjectId)?.title ?? "历史场次")
    : basis.basis.kind === "shot_dialogue"
      ? (tree.shots.find((s) => s.id === basis.subjectId)?.label ?? "历史镜头")
      : kindNames[basis.basis.kind];
}
function status(basis: Basis, formal?: Confirmation) {
  return !formal
    ? basis.currentConfirmationId
      ? "确认记录待读取"
      : "尚无正式依据"
    : formal.basisRevisionId === basis.id
      ? "当前正式依据"
      : formal.contentHash === basis.contentHash
        ? "正式内容一致"
        : "与正式依据不同";
}
export function CreativeWorkspace(props: Props) {
  const [id, setId] = useState<string>(),
    [kind, setKind] = useState<string | null>(null),
    [history, setHistory] = useState(false);
  const bases = useList<Basis>(
    `${props.path}/creative-bases${kind ? `?kind=${kind}` : ""}`,
  );
  const confirmations = useList<Confirmation>(
    `${props.path}/creative-confirmations`,
  );
  const shown = bases.data?.filter((b) => history || b.isCurrentSource);
  return (
    <Stack gap="xl">
      <Button
        variant="subtle"
        w="fit-content"
        leftSection={<ArrowLeft size={18} />}
        onClick={props.onClose}
      >
        返回集场镜
      </Button>
      <SectionHeading
        title={`${props.project.name} · 创作依据`}
        description="核对固定文本与设定，明确哪一版作为正式依据。保存新草稿会保留此前确认。"
      />
      {props.project.status === "archived" && (
        <Alert title="项目已归档">
          可查阅依据与确认历史，恢复项目后再作确认。
        </Alert>
      )}
      <ErrorNotice
        error={bases.error ?? confirmations.error}
        retry={() => {
          void bases.refetch();
          void confirmations.refetch();
        }}
      />
      {id ? (
        <>
          <Button
            variant="subtle"
            w="fit-content"
            onClick={() => setId(undefined)}
          >
            全部创作依据
          </Button>
          <BasisDetail
            {...props}
            key={id}
            id={id}
            confirmations={confirmations.data ?? []}
            confirmationsReady={confirmations.isSuccess}
          />
        </>
      ) : (
        <>
          <Group align="end">
            <Select
              label="依据类型"
              placeholder="全部类型"
              clearable
              value={kind}
              onChange={setKind}
              data={Object.entries(kindNames).map(([value, label]) => ({
                value,
                label,
              }))}
            />
            <Switch
              label="包含历史版本"
              checked={history}
              onChange={(e) => setHistory(e.currentTarget.checked)}
            />
          </Group>
          {bases.isPending || confirmations.isPending ? (
            <Loader aria-label="正在读取创作依据" />
          ) : shown?.length ? (
            <div className={classes.list}>
              {[...shown].reverse().map((basis) => (
                <article key={basis.id} className={classes.row}>
                  <Group justify="space-between">
                    <Text fw={600}>{subjectName(basis, props.tree)}</Text>
                    <Badge variant="light">
                      {status(
                        basis,
                        confirmations.data?.find(
                          (c) => c.id === basis.currentConfirmationId,
                        ),
                      )}
                    </Badge>
                  </Group>
                  <Text size="sm" c="dimmed" mt="sm">
                    {kindNames[basis.basis.kind]} ·{" "}
                    {basis.number ? `依据第 ${basis.number} 版 · ` : ""}
                    {basis.isCurrentSource ? "当前草稿来源" : "历史来源"} ·{" "}
                    {date(basis.createdAt)}
                  </Text>
                  <Text mt="sm" lineClamp={2} className={classes.snapshot}>
                    {preview(basis.snapshot)}
                  </Text>
                  <Button mt="md" onClick={() => setId(basis.id)}>
                    核对这份依据
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            <Empty>
              此范围还没有已保存的创作依据。录入剧本、设定或台词后会自动出现在这里。
            </Empty>
          )}
        </>
      )}
    </Stack>
  );
}
function preview(value: Schema<"CreativeSnapshot">) {
  return value.kind === "script"
    ? value.text
    : value.kind === "production"
      ? value.brief
      : value.kind === "scene"
        ? value.summary
        : value.dialogue.map((d) => d.text).join("\n");
}
function Snapshot({ value }: { value: Schema<"CreativeSnapshot"> }) {
  return (
    <Stack gap="md" className={classes.snapshot}>
      {value.kind === "shot_dialogue" ? (
        value.dialogue.length ? (
          value.dialogue.map((d, i) => (
            <div key={d.id}>
              <Text size="sm" c="dimmed">
                第 {i + 1} 句
                {d.characterAssetId
                  ? ` · 人物 ${d.characterAssetId}`
                  : " · 未指定说话人"}
              </Text>
              <Text>{d.text}</Text>
              {d.performance && (
                <Text size="sm" c="dimmed">
                  试作备注：{d.performance}
                </Text>
              )}
            </div>
          ))
        ) : (
          <Text c="dimmed">这一版没有台词。</Text>
        )
      ) : (
        <Text>{preview(value) || "这一版正文为空。"}</Text>
      )}
      {value.kind === "scene" && (
        <>
          <Text fw={600}>连续性与叙事状态</Text>
          <Text>{value.state.spatialNotes || "未填写空间说明。"}</Text>
          {value.state.characters?.map((c) => (
            <Text key={c.characterAssetId}>
              人物 {c.characterAssetId}：
              {[c.position, c.emotion, c.gaze, c.knowledge, c.bodyNotes, c.note]
                .filter(Boolean)
                .join(" · ") || "未填写状态说明"}
            </Text>
          ))}
          {value.state.props?.map((p) => (
            <Text key={p.propAssetId}>
              道具 {p.propAssetId}：
              {[p.location, p.condition, p.hand, p.holderCharacterAssetId]
                .filter(Boolean)
                .join(" · ") || "未填写状态说明"}
            </Text>
          ))}
        </>
      )}
      {(value.kind === "scene" || value.kind === "production") &&
        value.defaultAssetRevisionIds.length > 0 && (
          <div>
            <Text fw={600}>固定资产版本</Text>
            {value.defaultAssetRevisionIds.map((id) => (
              <Text key={id} size="sm">
                {id}
              </Text>
            ))}
          </div>
        )}
    </Stack>
  );
}
function BasisDetail(
  props: Props & {
    id: string;
    confirmations: Confirmation[];
    confirmationsReady: boolean;
  },
) {
  const resource = useResource<Basis>(
    `${props.path}/creative-bases/${props.id}`,
  );
  if (resource.isError)
    return (
      <ErrorNotice
        error={resource.error}
        retry={() => void resource.refetch()}
      />
    );
  if (!resource.data) return <Loader aria-label="正在读取固定依据" />;
  const basis = resource.data,
    formal = props.confirmations.find(
      (c) => c.id === basis.currentConfirmationId,
    );
  const history = props.confirmations.filter(
    (c) => c.subjectId === basis.subjectId,
  );
  return (
    <Stack gap="lg">
      <SectionHeading
        level={2}
        title={subjectName(basis, props.tree)}
        description={`${kindNames[basis.basis.kind]} · 依据第 ${basis.number ?? "—"} 版 · 保存于 ${date(basis.createdAt)}`}
      />
      <Group>
        <Badge>{basis.isCurrentSource ? "当前草稿来源" : "历史来源"}</Badge>
        <Badge>{status(basis, formal)}</Badge>
      </Group>
      {!basis.isCurrentSource && (
        <Alert title="你正在核对历史依据">
          确认会明确使用这份历史内容，当前编辑稿仍保留。
        </Alert>
      )}
      <div className={classes.comparison}>
        <Stack>
          <Text fw={600}>本次核对的固定内容</Text>
          <Snapshot value={basis.snapshot} />
        </Stack>
        <Stack className={classes.formal}>
          <Text fw={600}>当前正式依据</Text>
          {formal ? (
            <>
              <Text size="sm" c="dimmed">
                {date(formal.confirmedAt)} ·{" "}
                {props.members.find((m) => m.userId === formal.confirmedBy)
                  ?.email ?? formal.confirmedBy}
              </Text>
              <Snapshot value={formal.snapshot} />
            </>
          ) : (
            <Text c="dimmed">
              {props.confirmationsReady && !basis.currentConfirmationId
                ? "这个对象还没有正式确认。"
                : "正在读取确认记录…"}
            </Text>
          )}
        </Stack>
      </div>
      {props.canConfirm && props.project.status === "active" ? (
        <ConfirmForm
          key={basis.id}
          path={props.path}
          basis={basis}
          ready={
            props.confirmationsReady &&
            (!basis.currentConfirmationId || !!formal)
          }
          formal={formal?.basisRevisionId === basis.id}
        />
      ) : (
        <Text c="dimmed">由项目负责人、工作室所有者或管理员确认正式依据。</Text>
      )}
      <Text size="sm" c="dimmed">
        创作依据确认只记录正式文本与设定。影片的实际画面、声音和表演仍需在固定稿审阅中核对。
      </Text>
      <details>
        <summary>来源与固定记录</summary>
        <Stack gap="xs" mt="sm" className={classes.evidence}>
          <Text size="xs">依据标识：{basis.id}</Text>
          <Text size="xs">
            来源：{basis.basis.objectId} · 版本 {basis.basis.revision}
          </Text>
          <Text size="xs">
            内容摘要（{basis.hashVersion}）：{basis.contentHash}
          </Text>
        </Stack>
      </details>
      <SectionHeading level={2} title="正式确认历史" />
      {history.length ? (
        <ol className={classes.history}>
          {[...history].reverse().map((c) => (
            <li key={c.id}>
              <Group justify="space-between">
                <Text>
                  {date(c.confirmedAt)} ·{" "}
                  {props.members.find((m) => m.userId === c.confirmedBy)
                    ?.email ?? c.confirmedBy}
                </Text>
                {c.id === basis.currentConfirmationId && (
                  <Badge>当前正式</Badge>
                )}
              </Group>
              {c.note && (
                <Text mt="sm" className={classes.snapshot}>
                  {c.note}
                </Text>
              )}
              <details>
                <summary>查看当次确认内容</summary>
                <Snapshot value={c.snapshot} />
              </details>
            </li>
          ))}
        </ol>
      ) : (
        <Text c="dimmed">
          {props.confirmationsReady ? "还没有确认记录。" : "正在读取确认历史…"}
        </Text>
      )}
    </Stack>
  );
}
function ConfirmForm({
  path,
  basis,
  ready,
  formal,
}: {
  path: string;
  basis: Basis;
  ready: boolean;
  formal: boolean;
}) {
  const command = useCommand<Confirmation>();
  const draft = useContentDraft(
    `${path}/creative-bases/${basis.id}/confirmation`,
    {
      note: "",
      expectedCurrentConfirmationId: basis.currentConfirmationId ?? null,
    },
    1,
  );
  const changed =
    draft.value.expectedCurrentConfirmationId !==
    (basis.currentConfirmationId ?? null);
  if (formal)
    return (
      <Alert title="这份依据已是当前正式版本" icon={<CheckCircle size={20} />}>
        后续内容修改会另存草稿；此确认记录持续保留。
      </Alert>
    );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (changed || !ready || !draft.ready || draft.recovered) return;
        command.mutate(
          {
            path: `${path}/creative-confirmations`,
            body: {
              basisRevisionId: basis.id,
              usage: "project_default",
              expectedCurrentConfirmationId:
                draft.value.expectedCurrentConfirmationId,
              ...(draft.value.note ? { note: draft.value.note } : {}),
            },
          },
          {
            onSuccess: () => {
              void draft.clear();
            },
          },
        );
      }}
    >
      <Stack gap="md">
        <DraftNotice draft={draft} />
        <Textarea
          label="确认说明"
          description="可记录本次确认的判断或适用说明。"
          autosize
          minRows={2}
          maxRows={8}
          maxLength={20000}
          value={draft.value.note}
          onChange={(e) => {
            const note = e.currentTarget.value;
            draft.setValue((v) => ({ ...v, note }));
          }}
        />
        <ErrorNotice error={command.error} />
        {changed && (
          <Alert title="正式依据已变化">
            <Text>
              请核对“当前正式依据”栏中的最新内容，再明确继续。本地说明会保留。
            </Text>
            <Button
              mt="sm"
              disabled={!ready}
              onClick={() => {
                draft.setValue((v) => ({
                  ...v,
                  expectedCurrentConfirmationId:
                    basis.currentConfirmationId ?? null,
                }));
                command.reset();
              }}
            >
              已核对最新正式依据
            </Button>
          </Alert>
        )}
        <Button
          type="submit"
          classNames={{
            root: classes.confirmButton,
            label: classes.confirmLabel,
          }}
          variant="filled"
          w="fit-content"
          loading={command.isPending}
          disabled={changed || !ready || !draft.ready || !!draft.recovered}
        >
          将这份固定内容确认为正式依据
        </Button>
      </Stack>
    </form>
  );
}

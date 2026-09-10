import { useState } from "react";
import { useDebouncedValue } from "@mantine/hooks";
import {
  ActionIcon,
  Button,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { Trash } from "@phosphor-icons/react";
import { useCommand, useResource, type Schema } from "./api";
import { assetKinds, useAssetPages } from "./asset-queries";
import { Empty, ErrorNotice } from "./common";
import classes from "./assets.module.css";

type Asset = Schema<"Asset">;
type Revision = Schema<"AssetRevision">;
type Choice = {
  asset: Asset;
  revision?: Revision;
  look?: Schema<"CharacterLookDefinition">;
};
type PickerProps = {
  path: string;
  projectId: string;
  label: string;
  mode: "identity" | "revision" | "look";
  kind?: Asset["kind"];
  assetId?: string;
  excludeIds?: string[];
  onChoose: (choice: Choice) => void;
};
export function AssetIdentityLabel({ path, id }: { path: string; id: string }) {
  const asset = useResource<Asset>(`${path}/assets/${id}`);
  if (asset.isError) return <ErrorNotice error={asset.error} />;
  if (!asset.data) return <Text size="sm">正在读取资产…</Text>;
  const value = asset.data;
  return (
    <Text size="sm">
      {value.name} · {assetKinds[value.kind]}
      {value.status === "archived" ? " · 已归档，保留原引用" : ""}
    </Text>
  );
}
export function FixedAssetLabel({ path, id }: { path: string; id: string }) {
  const revision = useResource<Revision>(`${path}/asset-revisions/${id}`);
  const asset = useResource<Asset>(
    `${path}/assets/${revision.data?.assetId ?? ""}`,
    !!revision.data && !revision.isError,
  );
  if (revision.isError || asset.isError)
    return <ErrorNotice error={revision.error ?? asset.error} />;
  if (!revision.data || !asset.data)
    return <Text size="sm">正在读取固定资产版本…</Text>;
  const r = revision.data,
    a = asset.data;
  return (
    <Stack gap={0} align="flex-start">
      <Text size="sm">
        {a.name} · v{r.number} · {r.status === "confirmed" ? "已确认" : "草稿"}
        {a.status === "archived" ? " · 资产已归档" : ""}
      </Text>
      <Button
        component="a"
        variant="subtle"
        size="compact-xs"
        target="_blank"
        rel="noopener"
        href={`#/app/t/${path.split("/")[3]}${a.projectId ? "/p/" + a.projectId : ""}/assets?asset=${a.id}&revision=${r.id}`}
      >
        在新标签页核对固定版
      </Button>
    </Stack>
  );
}
export function AssetPicker(props: PickerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {props.label}
      </Button>
      <Modal
        opened={open}
        onClose={() => setOpen(false)}
        title={props.label}
        size="lg"
      >
        {open && (
          <AssetChoices
            {...props}
            onChoose={(choice) => {
              props.onChoose(choice);
              setOpen(false);
            }}
          />
        )}
      </Modal>
    </>
  );
}
function AssetChoices(props: PickerProps) {
  const [scope, setScope] = useState("project"),
    [q, setQ] = useState(""),
    [search] = useDebouncedValue(q, 250);
  const [selected, setSelected] = useState<Asset>();
  const pinned = useResource<Asset>(
    `${props.path}/assets/${props.assetId ?? ""}`,
    !!props.assetId,
  );
  const params = new URLSearchParams({
    scope,
    status: "active",
    q: search,
    ...(props.kind ? { kind: props.kind } : {}),
    ...(scope === "project" ? { projectId: props.projectId } : {}),
  });
  const assets = useAssetPages<Asset>(
    `${props.path}/assets?${params}`,
    !props.assetId,
  );
  const choice = props.assetId ? pinned.data : selected;
  if (props.assetId && pinned.isError)
    return <ErrorNotice error={pinned.error} />;
  if (props.assetId && !pinned.data)
    return <Loader aria-label="正在读取指定资产" />;
  if (choice)
    return (
      <Stack>
        {!props.assetId && (
          <Button variant="subtle" onClick={() => setSelected(undefined)}>
            返回资产列表
          </Button>
        )}
        <Text fw={600}>{choice.name}</Text>
        {choice.status === "archived" ? (
          <Empty>此资产已归档，不能新选版本。</Empty>
        ) : (
          <AssetVersions {...props} asset={choice} />
        )}
      </Stack>
    );
  return (
    <Stack>
      <Select
        label="资产范围"
        data={[
          { value: "project", label: "当前项目" },
          { value: "shared", label: "工作室共享" },
        ]}
        value={scope}
        onChange={(v) => v && setScope(v)}
      />
      <TextInput
        label="查找资产"
        value={q}
        onChange={(e) => setQ(e.currentTarget.value)}
      />
      <ErrorNotice error={assets.error} retry={() => void assets.refetch()} />
      {assets.isPending || (props.assetId && pinned.isPending) ? (
        <Loader aria-label="正在读取资产" />
      ) : (
        <>
          {assets.data?.pages
            .flatMap((p) => p.items)
            .map((asset) => (
              <Group key={asset.id} justify="space-between" wrap="wrap">
                <Text size="sm">
                  {asset.name} · {assetKinds[asset.kind]}
                </Text>
                <Button
                  size="xs"
                  disabled={!!props.excludeIds?.includes(asset.id)}
                  onClick={() => {
                    if (props.mode === "identity" && asset.scope === "project")
                      props.onChoose({ asset });
                    else setSelected(asset);
                  }}
                >
                  {props.excludeIds?.includes(asset.id)
                    ? "已添加"
                    : props.mode === "identity" && asset.scope === "project"
                      ? "关联身份"
                      : "选择固定版"}
                </Button>
              </Group>
            ))}
          {!assets.isError &&
            !assets.data?.pages.some((p) => p.items.length) && (
              <Empty>没有可选资产。可先在资产区创建角色、道具或声音。</Empty>
            )}
          {assets.hasNextPage && (
            <Button
              loading={assets.isFetchingNextPage}
              onClick={() => void assets.fetchNextPage()}
            >
              加载更多资产
            </Button>
          )}
        </>
      )}
    </Stack>
  );
}
function AssetVersions(props: PickerProps & { asset: Asset }) {
  const current = useResource<Revision>(
    `${props.path}/asset-revisions/${props.asset.currentRevisionId ?? ""}`,
    !!props.asset.currentRevisionId,
  );
  const history = useAssetPages<Revision>(
    `${props.path}/assets/${props.asset.id}/revisions`,
  );
  const command = useCommand<Schema<"SharedImport">>();
  const shared = props.asset.scope === "shared";
  const choose = (revision: Revision, look?: Choice["look"]) => {
    const finish = () =>
      props.onChoose({
        asset: props.asset,
        revision,
        ...(look ? { look } : {}),
      });
    if (shared)
      command.mutate(
        {
          path: `${props.path}/projects/${props.projectId}/shared-imports`,
          body: { assetRevisionId: revision.id },
        },
        { onSuccess: finish },
      );
    else finish();
  };
  const revisions = [
    ...(current.data && !current.isError ? [current.data] : []),
    ...(history.data?.pages
      .flatMap((p) => p.items)
      .filter((r) => r.id !== current.data?.id) ?? []),
  ];
  return (
    <Stack>
      <Text size="sm" c="dimmed">
        {props.mode === "identity"
          ? "关联角色或道具身份。造型与声音需要分别指定。"
          : "选择固定版本，后续修订不会自动替换。"}
        {shared ? "使用前会将所选共享版本明确引入当前项目。" : ""}
      </Text>
      <ErrorNotice error={current.error ?? history.error ?? command.error} />
      {!props.asset.currentRevisionId && (
        <Empty>此资产尚无固定版本，请先在资产区保存定义。</Empty>
      )}
      {revisions.map((r) => (
        <Stack key={r.id} gap="xs">
          <FixedAssetLabel path={props.path} id={r.id} />
          <Text size="sm" lineClamp={3}>
            {r.definition.voiceDescription ||
              r.definition.description ||
              "未填写说明"}
          </Text>
          {props.mode === "look" ? (
            r.definition.looks?.length ? (
              r.definition.looks.map((look) => (
                <Button
                  key={look.id}
                  classNames={{
                    root: classes.choiceButton,
                    label: classes.choiceLabel,
                  }}
                  disabled={command.isPending}
                  onClick={() => choose(r, look)}
                >
                  {shared ? "引入并使用" : "使用"} v{r.number} · {look.label}
                  （造型修订 {look.revision}）
                </Button>
              ))
            ) : (
              <Text size="sm" c="dimmed">
                这一版没有造型。
              </Text>
            )
          ) : (
            <Button disabled={command.isPending} onClick={() => choose(r)}>
              {shared ? "引入并使用" : "使用"} v{r.number}
              {props.mode === "identity" ? " 的资产身份" : " 固定版"}
            </Button>
          )}
        </Stack>
      ))}
      {history.hasNextPage && (
        <Button
          loading={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          加载更早的版本
        </Button>
      )}
    </Stack>
  );
}
export function FixedAssetList({
  path,
  projectId,
  value,
  onChange,
}: {
  path: string;
  projectId: string;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <Stack gap="sm">
      {value.map((id, index) => (
        <Group key={id} justify="space-between" align="start">
          <FixedAssetLabel path={path} id={id} />
          <ActionIcon
            variant="subtle"
            aria-label={`移除第 ${index + 1} 个默认资产`}
            onClick={() => onChange(value.filter((x) => x !== id))}
          >
            <Trash size={16} />
          </ActionIcon>
        </Group>
      ))}
      <AssetPicker
        path={path}
        projectId={projectId}
        mode="revision"
        label="添加默认资产固定版"
        onChoose={({ revision }) => {
          if (revision && !value.includes(revision.id))
            onChange([...value, revision.id]);
        }}
      />
    </Stack>
  );
}
export function VoiceBinding({
  path,
  projectId,
  value,
  onChange,
  label = "声音覆盖",
}: {
  path: string;
  projectId: string;
  value?: string | undefined;
  label?: string;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <Stack gap="xs">
      <Text size="sm" fw={500}>
        {label}
      </Text>
      {value ? (
        <FixedAssetLabel path={path} id={value} />
      ) : (
        <Text size="xs" c="dimmed">
          未覆盖，制作时按上层设定解析。
        </Text>
      )}
      <Group>
        <AssetPicker
          path={path}
          projectId={projectId}
          kind="voice"
          mode="revision"
          label={`选择${label}固定版`}
          onChoose={({ revision }) => revision && onChange(revision.id)}
        />
        {value && (
          <Button
            size="xs"
            variant="subtle"
            onClick={() => onChange(undefined)}
          >
            移除此处声音覆盖
          </Button>
        )}
      </Group>
    </Stack>
  );
}
const omit = <T, K extends keyof T>(value: T, key: K): T => {
  const next = { ...value };
  delete next[key];
  return next;
};
export function ContinuityFields({
  path,
  projectId,
  value,
  onChange,
  label,
}: {
  path: string;
  projectId: string;
  value: Schema<"ContinuityState">;
  onChange: (value: Schema<"ContinuityState">) => void;
  label: string;
}) {
  const characters = value.characters ?? [],
    props = value.props ?? [];
  return (
    <Stack gap="lg">
      <Text fw={600}>{label}</Text>
      <Text size="xs" c="dimmed">
        记录预期状态；未填写的条目和字段沿用上层设定。入口与出口分别保存，不代表成片已满足连续性。
      </Text>
      <Textarea
        label={`${label} · 空间说明`}
        autosize
        minRows={2}
        value={value.spatialNotes ?? ""}
        onChange={(e) =>
          onChange({ ...value, spatialNotes: e.currentTarget.value })
        }
      />
      {characters.map((character, index) => (
        <Stack key={character.characterAssetId} gap="sm">
          <Group justify="space-between">
            <AssetIdentityLabel path={path} id={character.characterAssetId} />
            <Button
              size="xs"
              variant="subtle"
              onClick={() =>
                onChange({
                  ...value,
                  characters: characters.filter((_, i) => i !== index),
                })
              }
            >
              移除此处角色状态
            </Button>
          </Group>
          <CharacterFields
            path={path}
            projectId={projectId}
            value={character}
            onChange={(next) =>
              onChange({
                ...value,
                characters: characters.map((c, i) => (i === index ? next : c)),
              })
            }
          />
        </Stack>
      ))}
      <AssetPicker
        path={path}
        projectId={projectId}
        mode="identity"
        kind="character"
        excludeIds={characters.map((c) => c.characterAssetId)}
        label={`${label} · 添加角色`}
        onChoose={({ asset }) =>
          onChange({
            ...value,
            characters: [...characters, { characterAssetId: asset.id }],
          })
        }
      />
      {props.map((prop, index) => (
        <Stack key={prop.propAssetId} gap="sm">
          <Group justify="space-between">
            <AssetIdentityLabel path={path} id={prop.propAssetId} />
            <Button
              size="xs"
              variant="subtle"
              onClick={() =>
                onChange({
                  ...value,
                  props: props.filter((_, i) => i !== index),
                })
              }
            >
              移除此处道具状态
            </Button>
          </Group>
          <PropFields
            path={path}
            projectId={projectId}
            value={prop}
            onChange={(next) =>
              onChange({
                ...value,
                props: props.map((p, i) => (i === index ? next : p)),
              })
            }
          />
        </Stack>
      ))}
      <AssetPicker
        path={path}
        projectId={projectId}
        mode="identity"
        kind="prop"
        excludeIds={props.map((p) => p.propAssetId)}
        label={`${label} · 添加道具`}
        onChoose={({ asset }) =>
          onChange({ ...value, props: [...props, { propAssetId: asset.id }] })
        }
      />
    </Stack>
  );
}
function CharacterFields({
  path,
  projectId,
  value,
  onChange,
}: {
  path: string;
  projectId: string;
  value: Schema<"CharacterState">;
  onChange: (value: Schema<"CharacterState">) => void;
}) {
  const fixed = useResource<Revision>(
    `${path}/asset-revisions/${value.lookAssetRevisionId ?? ""}`,
    !!value.lookAssetRevisionId,
  );
  const look = fixed.data?.definition.looks?.find((l) => l.id === value.lookId);
  const labels = {
    position: "位置",
    emotion: "情绪",
    gaze: "视线",
    knowledge: "已知信息",
    bodyNotes: "身体状态",
    note: "角色状态说明",
  };
  return (
    <Stack gap="sm">
      {value.lookAssetRevisionId && (
        <>
          <FixedAssetLabel path={path} id={value.lookAssetRevisionId} />
          <Text size="sm">
            造型：{look?.label ?? "正在读取所选造型…"}
            {look ? ` · 修订 ${look.revision}` : ""}
          </Text>
          <ErrorNotice error={fixed.error} />
        </>
      )}
      <Group>
        <AssetPicker
          path={path}
          projectId={projectId}
          mode="look"
          assetId={value.characterAssetId}
          label="选择此处角色造型"
          onChoose={({ revision, look }) =>
            revision &&
            look &&
            onChange({
              ...value,
              lookId: look.id,
              lookAssetRevisionId: revision.id,
            })
          }
        />
        {value.lookId && (
          <Button
            size="xs"
            variant="subtle"
            onClick={() =>
              onChange(omit(omit(value, "lookId"), "lookAssetRevisionId"))
            }
          >
            移除此处造型覆盖
          </Button>
        )}
      </Group>
      {Object.entries(labels).map(([key, label]) => (
        <TextInput
          key={key}
          label={label}
          value={value[key as keyof typeof labels] ?? ""}
          onChange={(e) =>
            onChange(
              e.currentTarget.value
                ? { ...value, [key]: e.currentTarget.value }
                : omit(value, key as keyof typeof labels),
            )
          }
        />
      ))}
      <VoiceBinding
        path={path}
        projectId={projectId}
        value={value.voiceAssetRevisionId}
        onChange={(id) =>
          onChange(
            id
              ? { ...value, voiceAssetRevisionId: id }
              : omit(value, "voiceAssetRevisionId"),
          )
        }
        label="角色声音覆盖"
      />
      {(value.propAssetIds ?? []).map((id) => (
        <Group key={id} justify="space-between">
          <AssetIdentityLabel path={path} id={id} />
          <Button
            size="xs"
            variant="subtle"
            onClick={() =>
              onChange({
                ...value,
                propAssetIds: value.propAssetIds?.filter((p) => p !== id) ?? [],
              })
            }
          >
            移除随身道具
          </Button>
        </Group>
      ))}
      <AssetPicker
        path={path}
        projectId={projectId}
        kind="prop"
        mode="identity"
        label="添加角色随身道具"
        excludeIds={value.propAssetIds ?? []}
        onChoose={({ asset }) =>
          onChange({
            ...value,
            propAssetIds: [...(value.propAssetIds ?? []), asset.id],
          })
        }
      />
    </Stack>
  );
}
function PropFields({
  path,
  projectId,
  value,
  onChange,
}: {
  path: string;
  projectId: string;
  value: Schema<"PropState">;
  onChange: (value: Schema<"PropState">) => void;
}) {
  return (
    <Stack gap="sm">
      {value.propAssetRevisionId && (
        <FixedAssetLabel path={path} id={value.propAssetRevisionId} />
      )}
      <Group>
        <AssetPicker
          path={path}
          projectId={projectId}
          mode="revision"
          assetId={value.propAssetId}
          label="选择此处道具固定版"
          onChoose={({ revision }) =>
            revision && onChange({ ...value, propAssetRevisionId: revision.id })
          }
        />
        {value.propAssetRevisionId && (
          <Button
            size="xs"
            variant="subtle"
            onClick={() => onChange(omit(value, "propAssetRevisionId"))}
          >
            移除此处版本覆盖
          </Button>
        )}
      </Group>
      <Text size="sm" fw={500}>
        持有人
      </Text>
      {value.holderCharacterAssetId ? (
        <AssetIdentityLabel path={path} id={value.holderCharacterAssetId} />
      ) : (
        <Text size="sm">
          {value.holderCharacterAssetId === null
            ? "明确无人持有"
            : "沿用上层持有人"}
        </Text>
      )}
      <Group>
        <AssetPicker
          path={path}
          projectId={projectId}
          mode="identity"
          kind="character"
          label="指定道具持有人"
          onChoose={({ asset }) =>
            onChange({ ...value, holderCharacterAssetId: asset.id })
          }
        />
        <Button
          size="xs"
          variant="subtle"
          onClick={() => onChange({ ...value, holderCharacterAssetId: null })}
        >
          明确无人持有
        </Button>
        <Button
          size="xs"
          variant="subtle"
          onClick={() => onChange(omit(value, "holderCharacterAssetId"))}
        >
          沿用上层持有人
        </Button>
      </Group>
      <Select
        label="持握方式"
        value={value.hand ?? "inherit"}
        data={[
          { value: "inherit", label: "沿用上层" },
          { value: "left", label: "左手" },
          { value: "right", label: "右手" },
          { value: "both", label: "双手" },
          { value: "none", label: "未持握" },
        ]}
        onChange={(v) =>
          v &&
          onChange(
            v === "inherit"
              ? omit(value, "hand")
              : {
                  ...value,
                  hand: v as NonNullable<Schema<"PropState">["hand"]>,
                },
          )
        }
      />
      <TextInput
        label="道具位置"
        value={value.location ?? ""}
        onChange={(e) =>
          onChange(
            e.currentTarget.value
              ? { ...value, location: e.currentTarget.value }
              : omit(value, "location"),
          )
        }
      />
      <TextInput
        label="道具状态"
        value={value.condition ?? ""}
        onChange={(e) =>
          onChange(
            e.currentTarget.value
              ? { ...value, condition: e.currentTarget.value }
              : omit(value, "condition"),
          )
        }
      />
    </Stack>
  );
}
export function ContinuitySummary({
  path,
  value,
  label,
}: {
  path: string;
  value: Schema<"ContinuityState">;
  label: string;
}) {
  return (
    <Stack gap="sm">
      <Text fw={600}>{label}</Text>
      <Text size="sm">{value.spatialNotes || "未填写空间说明"}</Text>
      {value.characters?.map((c) => (
        <Stack key={c.characterAssetId} gap="xs">
          <AssetIdentityLabel path={path} id={c.characterAssetId} />
          <Text size="sm">
            {[
              c.position && `位置：${c.position}`,
              c.emotion && `情绪：${c.emotion}`,
              c.gaze && `视线：${c.gaze}`,
              c.knowledge && `已知：${c.knowledge}`,
              c.bodyNotes && `身体状态：${c.bodyNotes}`,
              c.note,
            ]
              .filter(Boolean)
              .join(" · ") || "未覆盖文字状态"}
          </Text>
          {c.lookAssetRevisionId && (
            <LookSummary
              path={path}
              revisionId={c.lookAssetRevisionId}
              lookId={c.lookId!}
            />
          )}
          {c.voiceAssetRevisionId && (
            <>
              <Text size="xs">角色声音覆盖</Text>
              <FixedAssetLabel path={path} id={c.voiceAssetRevisionId} />
            </>
          )}
          {!!c.propAssetIds?.length && <Text size="xs">随身道具</Text>}
          {c.propAssetIds?.map((id) => (
            <AssetIdentityLabel key={id} path={path} id={id} />
          ))}
        </Stack>
      ))}
      {value.props?.map((p) => (
        <Stack key={p.propAssetId} gap="xs">
          <AssetIdentityLabel path={path} id={p.propAssetId} />
          {p.propAssetRevisionId && (
            <FixedAssetLabel path={path} id={p.propAssetRevisionId} />
          )}
          {p.holderCharacterAssetId ? (
            <>
              <Text size="xs">持有人</Text>
              <AssetIdentityLabel path={path} id={p.holderCharacterAssetId} />
            </>
          ) : (
            <Text size="sm">
              {p.holderCharacterAssetId === null
                ? "明确无人持有"
                : "沿用上层持有人"}
            </Text>
          )}
          <Text size="sm">
            {[
              p.location && `位置：${p.location}`,
              p.condition && `状态：${p.condition}`,
              p.hand &&
                `持握：${{ left: "左手", right: "右手", both: "双手", none: "未持握" }[p.hand]}`,
            ]
              .filter(Boolean)
              .join(" · ") || "未覆盖位置与持握状态"}
          </Text>
        </Stack>
      ))}
    </Stack>
  );
}
function LookSummary({
  path,
  revisionId,
  lookId,
}: {
  path: string;
  revisionId: string;
  lookId: string;
}) {
  const revision = useResource<Revision>(
      `${path}/asset-revisions/${revisionId}`,
    ),
    look = revision.data?.definition.looks?.find((l) => l.id === lookId);
  return (
    <Stack gap={0}>
      <FixedAssetLabel path={path} id={revisionId} />
      <Text size="sm">
        造型：
        {look
          ? `${look.label} · 修订 ${look.revision}`
          : "暂不可读，保留所选固定造型"}
      </Text>
      <ErrorNotice error={revision.error} />
    </Stack>
  );
}
export function DialogueSummary({
  path,
  value,
}: {
  path: string;
  value: Schema<"Dialogue">[];
}) {
  return (
    <Stack gap="sm">
      {value.map((d, index) => (
        <Stack key={d.id} gap="xs">
          <Text fw={500} size="sm">
            第 {index + 1} 句
          </Text>
          {d.characterAssetId ? (
            <AssetIdentityLabel path={path} id={d.characterAssetId} />
          ) : (
            <Text size="xs" c="dimmed">
              未指定说话人
            </Text>
          )}
          <Text>
            “{d.text}”{d.performance ? ` · ${d.performance}` : ""}
          </Text>
          {d.voiceAssetRevisionId && (
            <>
              <Text size="xs">此句声音覆盖</Text>
              <FixedAssetLabel path={path} id={d.voiceAssetRevisionId} />
            </>
          )}
        </Stack>
      ))}
    </Stack>
  );
}

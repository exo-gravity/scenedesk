import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Fieldset,
  Group,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { Plus, Trash } from "@phosphor-icons/react";
import { useCommand, type Schema } from "./api";
import { DraftNotice, useContentDraft } from "./content-drafts";
import { ErrorNotice } from "./common";
import { AssetReferenceFields } from "./AssetReferenceFields";
import { FixedVoiceField } from "./FixedVoiceField";
import { PendingCharacterImage } from "./CharacterMediaAssociation";
import classes from "./assets.module.css";
type Definition = Schema<"AssetDefinition">;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const withoutNumber = ({
  revision: _,
  ...look
}: Schema<"CharacterLookDefinition">) => look;
function prepared(input: Definition, base: Definition): Definition {
  return {
    ...input,
    ...(input.looks
      ? {
          looks: input.looks.map((look) => {
            const previous = base.looks?.find((item) => item.id === look.id);
            return {
              ...look,
              revision: previous
                ? previous.revision +
                  (same(withoutNumber(previous), withoutNumber(look)) ? 0 : 1)
                : 1,
            };
          }),
        }
      : {}),
  };
}
function reconcile(
  base: Definition,
  input: Definition,
  server: Definition,
): Definition {
  const result = { ...input };
  for (const key of [
    "description",
    "references",
    "voiceDescription",
    "defaultVoiceAssetRevisionId",
  ] as const)
    if (same(input[key], base[key]))
      Object.assign(result, { [key]: server[key] });
  if (input.looks || base.looks || server.looks) {
    const identities = [
      ...new Set([
        ...(input.looks ?? []).map((look) => look.id),
        ...(server.looks ?? []).map((look) => look.id),
      ]),
    ];
    result.looks = identities.flatMap((id) => {
      const old = base.looks?.find((look) => look.id === id),
        local = input.looks?.find((look) => look.id === id),
        remote = server.looks?.find((look) => look.id === id);
      if (same(local, old)) return remote ? [remote] : [];
      if (!local) return [];
      if (!remote)
        return [
          {
            ...local,
            ...(old ? { id: crypto.randomUUID(), revision: 1 } : {}),
          },
        ];
      return [
        {
          ...local,
          label: same(local.label, old?.label) ? remote.label : local.label,
          references: same(local.references, old?.references)
            ? remote.references
            : local.references,
        },
      ];
    });
  }
  return result;
}
export function AssetDefinitionEditor({
  asset,
  current,
  currentReady,
  pendingMediaId,
  dismissPendingImage,
  path,
  done,
}: {
  asset: Schema<"Asset">;
  current?: Schema<"AssetRevision"> | undefined;
  currentReady: boolean;
  pendingMediaId?: string | undefined;
  dismissPendingImage?: (() => void) | undefined;
  path: string;
  done: (revision?: Schema<"AssetRevision">) => void;
}) {
  const empty: Definition = { description: "", references: [] };
  const source = current?.definition ?? empty;
  const [initial] = useState(source);
  const draft = useContentDraft(
    `${path}/assets/${asset.id}/definition`,
    { base: initial, input: initial },
    asset.revision,
  );
  const command = useCommand<Schema<"AssetRevision">>(),
    [error, setError] = useState<Error>();
  const stale = draft.baseVersion !== asset.revision,
    input = draft.value.input;
  const change = (next: Definition) =>
    draft.setValue((value) => ({ ...value, input: next }));
  if (draft.committed) return <DraftNotice draft={draft} />;
  return (
    <form
      className={classes.editor}
      onSubmit={(event) => {
        event.preventDefault();
        if (
          command.isPending ||
          !currentReady ||
          stale ||
          !draft.ready ||
          draft.recovered
        )
          return;
        setError(undefined);
        if ((input.looks ?? []).some((look) => !look.label.trim())) {
          setError(new Error("请为每种造型填写名称。"));
          return;
        }
        command.mutate(
          {
            path: `${path}/assets/${asset.id}/revisions`,
            version: draft.baseVersion,
            body: {
              definition: prepared(input, source),
              ...(current ? { parentRevisionId: current.id } : {}),
            },
          },
          {
            onCommitted: (revision) =>
              void draft.complete(() => done(revision)),
          },
        );
      }}
    >
      <Fieldset variant="unstyled" disabled={command.isPending}>
        <Stack gap="lg">
          <Text fw={600}>
            {current
              ? `新建修订 · 基于 v${current.number}`
              : "建立第一个固定版本"}
          </Text>
          <DraftNotice draft={draft} />
          <ErrorNotice error={command.error ?? error ?? null} />
          {!currentReady && (
            <Alert title="正在读取服务器当前设定">
              你的输入仍保留。读取完成后才能核对或保存。
            </Alert>
          )}
          {stale && currentReady && (
            <Alert title="服务器已有新版本，当前输入已保留">
              <Text>
                请核对服务器当前设定。未修改字段保留服务器新值；双方修改的字段以你核对后的输入为准。服务器已移除、你仍在修改的造型会作为新的造型选项保留。
              </Text>
              <details>
                <summary>查看服务器当前设定</summary>
                <Text className={classes.definition}>
                  {source.description || "设定说明为空"}
                </Text>
                {source.looks?.map((look) => (
                  <Text key={look.id}>
                    {look.label} · 造型修订 {look.revision} ·{" "}
                    {look.references.length} 项参考
                  </Text>
                ))}
                <Text size="sm">
                  共 {source.references.length}{" "}
                  项主参考。完整媒体及声音可在上方当前版本查看。
                </Text>
              </details>
              <Button
                mt="md"
                onClick={() => {
                  draft.setValue({
                    base: source,
                    input: reconcile(draft.value.base, input, source),
                  });
                  draft.rebase();
                }}
              >
                已核对，继续基于当前版本
              </Button>
            </Alert>
          )}
          {pendingMediaId && dismissPendingImage && (
            <PendingCharacterImage
              path={path}
              mediaId={pendingMediaId}
              asset={asset}
              disabled={
                !currentReady ||
                stale ||
                !draft.ready ||
                !!draft.recovered ||
                draft.error ||
                input.references.length +
                  (input.looks ?? []).reduce(
                    (count, look) => count + look.references.length,
                    0,
                  ) >=
                  200
              }
              added={input.references.some(
                (reference) =>
                  reference.mediaId === pendingMediaId &&
                  reference.purpose === "identity",
              )}
              actionLabel="加入身份参考草稿"
              onAdd={(media) => {
                if (
                  !input.references.some(
                    (reference) =>
                      reference.mediaId === media.id &&
                      reference.purpose === "identity",
                  )
                )
                  change({
                    ...input,
                    references: [
                      ...input.references,
                      { mediaId: media.id, purpose: "identity" },
                    ],
                  });
              }}
              onDismiss={dismissPendingImage}
            />
          )}
          <Textarea
            label="固定设定说明"
            description="保存在这个版本中，之后修改会产生新版本。"
            autosize
            minRows={3}
            maxLength={20000}
            value={input.description}
            onChange={(e) =>
              change({ ...input, description: e.currentTarget.value })
            }
          />
          <details className={classes.editorSection} open>
            <summary>
              主参考 <span>{input.references.length} 项</span>
            </summary>
            <div className={classes.sectionBody}>
              <AssetReferenceFields
                path={path}
                projectId={asset.projectId}
                value={input.references}
                onChange={(references) => change({ ...input, references })}
                purpose={
                  asset.kind === "character"
                    ? "identity"
                    : asset.kind === "location"
                      ? "location"
                      : asset.kind === "voice"
                        ? "voice"
                        : asset.kind === "prop"
                          ? "prop"
                          : "style"
                }
              />
            </div>
          </details>
          {(asset.kind === "voice" || asset.kind === "character") && (
            <details className={classes.editorSection}>
              <summary>
                声音{" "}
                <span>
                  {input.defaultVoiceAssetRevisionId
                    ? "已固定声线"
                    : input.voiceDescription
                      ? "已有声音说明"
                      : "未设置"}
                </span>
              </summary>
              <Stack gap="md" className={classes.sectionBody}>
                <Textarea
                  label="声音说明"
                  value={input.voiceDescription ?? ""}
                  onChange={(e) =>
                    change({
                      ...input,
                      voiceDescription: e.currentTarget.value,
                    })
                  }
                  autosize
                  minRows={2}
                  maxLength={20000}
                />
                {asset.kind === "character" && (
                  <FixedVoiceField
                    path={path}
                    projectId={asset.projectId}
                    value={input.defaultVoiceAssetRevisionId}
                    onChange={(id) => {
                      const next = { ...input };
                      if (id) next.defaultVoiceAssetRevisionId = id;
                      else delete next.defaultVoiceAssetRevisionId;
                      change(next);
                    }}
                  />
                )}
              </Stack>
            </details>
          )}
          {asset.kind === "character" && (
            <details className={classes.editorSection}>
              <summary>
                并存造型 <span>{input.looks?.length ?? 0} 种</span>
              </summary>
              <div className={classes.sectionBody}>
                {(input.looks ?? []).map((look, index) => (
                  <Stack gap="md" key={look.id} className={classes.look}>
                    <Group justify="space-between">
                      <Badge>造型 {index + 1}</Badge>
                      <ActionIcon
                        variant="subtle"
                        aria-label={`移除造型 ${look.label || index + 1}`}
                        onClick={() =>
                          change({
                            ...input,
                            looks: input.looks!.filter(
                              (item) => item.id !== look.id,
                            ),
                          })
                        }
                      >
                        <Trash size={18} />
                      </ActionIcon>
                    </Group>
                    <TextInput
                      label="造型名称"
                      value={look.label}
                      maxLength={160}
                      onChange={(e) => {
                        const label = e.currentTarget.value;
                        change({
                          ...input,
                          looks: input.looks!.map((item) =>
                            item.id === look.id ? { ...item, label } : item,
                          ),
                        });
                      }}
                    />
                    <AssetReferenceFields
                      path={path}
                      projectId={asset.projectId}
                      value={look.references}
                      onChange={(references) =>
                        change({
                          ...input,
                          looks: input.looks!.map((item) =>
                            item.id === look.id
                              ? { ...item, references }
                              : item,
                          ),
                        })
                      }
                      purpose="look"
                    />
                  </Stack>
                ))}
                <Button
                  leftSection={<Plus size={16} />}
                  disabled={(input.looks?.length ?? 0) >= 100}
                  onClick={() =>
                    change({
                      ...input,
                      looks: [
                        ...(input.looks ?? []),
                        {
                          id: crypto.randomUUID(),
                          revision: 1,
                          label: "",
                          references: [],
                        },
                      ],
                    })
                  }
                >
                  添加另一种造型
                </Button>
              </div>
            </details>
          )}
          <Group className={classes.editorActions}>
            <Button
              variant="filled"
              type="submit"
              loading={command.isPending}
              disabled={
                !currentReady || stale || !draft.ready || !!draft.recovered
              }
            >
              保存为新的固定版本
            </Button>
            <Button variant="subtle" onClick={() => done()}>
              返回预览，保留本机草稿
            </Button>
          </Group>
        </Stack>
      </Fieldset>
    </form>
  );
}

import { Stack, Text } from "@mantine/core";
import type { Schema } from "./api";
import { title, type Tree, type Operation } from "./proposal-model";
import classes from "./proposals.module.css";
export function ParentLabel({
  operation: op,
  operations,
  tree,
}: {
  operation: Operation;
  operations: Operation[];
  tree: Tree;
}) {
  const id =
    "episodeId" in op.proposed
      ? op.proposed.episodeId
      : "sceneId" in op.proposed
        ? op.proposed.sceneId
        : undefined;
  if (!id) return null;
  const parent = operations.find((o) => o.temporaryId === id),
    label = parent
      ? title(parent)
      : tree.scenes.find((s) => s.id === id)?.title;
  return (
    <Text size="sm" c="dimmed">
      所属：{label ?? "待核对父项"}
    </Text>
  );
}
export function ShotPreview({ spec }: { spec: Schema<"ShotSpec"> }) {
  return (
    <Stack gap="xs" mt="sm" className={classes.preview}>
      <Text className={classes.prose}>{spec.intent}</Text>
      {spec.action && (
        <Text className={classes.prose}>动作：{spec.action}</Text>
      )}
      {spec.camera && (
        <Text className={classes.prose}>镜头语言：{spec.camera}</Text>
      )}
      {spec.entryState?.spatialNotes && (
        <Text className={classes.prose}>
          入镜：{spec.entryState.spatialNotes}
        </Text>
      )}
      {spec.exitState?.spatialNotes && (
        <Text className={classes.prose}>
          出镜：{spec.exitState.spatialNotes}
        </Text>
      )}
      {spec.dialogue?.map((line) => (
        <Text className={classes.prose} key={line.id}>
          台词：{line.text}
        </Text>
      ))}
      {spec.plannedDurationUs !== undefined && (
        <Text size="sm" c="dimmed">
          预计 {spec.plannedDurationUs / 1_000_000} 秒
        </Text>
      )}
      {spec.notes && (
        <Text size="sm" c="dimmed" className={classes.prose}>
          {spec.notes}
        </Text>
      )}
    </Stack>
  );
}
export function ContentChanges({
  before,
  after,
}: {
  before: Tree | undefined;
  after: Tree;
}) {
  if (!before)
    return (
      <Text>当前内容版本为 {after.revision}。请返回集场镜核对后更新基线。</Text>
    );
  const changes: { label: string; previous: string; current: string }[] = [];
  if (before.currentScriptRevisionId !== after.currentScriptRevisionId)
    changes.push({
      label: "剧本原文",
      previous: before.currentScriptRevisionId ? "原有剧本版本" : "尚无剧本",
      current: "剧本已有新版本，请到剧本与历史中核对",
    });
  const describe = (
    kind: string,
    row:
      Tree["episodes"][number] | Tree["scenes"][number] | Tree["shots"][number],
  ) => {
    const label = "label" in row ? row.label : row.title;
    const detail =
      "spec" in row
        ? [
            row.spec.intent,
            ...(row.spec.dialogue ?? []).map((d) => `台词：${d.text}`),
            row.spec.action ? `动作：${row.spec.action}` : "",
            row.spec.camera ? `镜头语言：${row.spec.camera}` : "",
            row.spec.plannedDurationUs !== undefined
              ? `预计 ${row.spec.plannedDurationUs / 1_000_000} 秒`
              : "",
            row.spec.entryState?.spatialNotes
              ? `入镜：${row.spec.entryState.spatialNotes}`
              : "",
            row.spec.exitState?.spatialNotes
              ? `出镜：${row.spec.exitState.spatialNotes}`
              : "",
            ...(row.spec.dialogue ?? []).map((d) =>
              d.performance ? `表演：${d.performance}` : "",
            ),
            ...(row.spec.sourceExcerpts ?? []).map(
              (e) => `引用原文：${e.quote}`,
            ),
            row.spec.notes ?? "",
          ]
            .filter(Boolean)
            .join("\n")
        : "summary" in row
          ? [
              row.summary,
              row.timeLabel ?? "",
              row.locationLabel ?? "",
              row.state.spatialNotes ?? "",
            ]
              .filter(Boolean)
              .join("\n")
          : "";
    return `${kind} ${label} · ${row.status === "active" ? "可用" : "已归档"} · 顺序 ${row.position + 1}${detail ? "\n" + detail : ""}`;
  };
  for (const [key, kind] of [
    ["episodes", "单集"],
    ["scenes", "场次"],
    ["shots", "镜头"],
  ] as const) {
    const old = new Map(before[key].map((row) => [row.id, row])),
      now = new Map(after[key].map((row) => [row.id, row]));
    for (const [id, row] of old) {
      const latest = now.get(id);
      // JSONB reorders object keys; content revisions are the authoritative change marker.
      if (!latest || row.revision !== latest.revision)
        changes.push({
          label: `${kind}变化`,
          previous: describe(kind, row),
          current: latest ? describe(kind, latest) : "当前已不存在",
        });
    }
    for (const [id, row] of now)
      if (!old.has(id))
        changes.push({
          label: `新增${kind}`,
          previous: "基线中没有此项",
          current: describe(kind, row),
        });
  }
  return (
    <Stack gap="sm">
      <Text>
        基线版本 {before.revision} → 当前版本 {after.revision}
      </Text>
      {changes.length ? (
        changes.map((change, index) => (
          <details key={index}>
            <summary>
              {change.label} · {change.current.split("\n")[0]}
            </summary>
            <div className={classes.columns}>
              <div>
                <Text size="sm" fw={600}>
                  原基线
                </Text>
                <Text size="sm" className={classes.prose}>
                  {change.previous}
                </Text>
              </div>
              <div>
                <Text size="sm" fw={600}>
                  现在
                </Text>
                <Text size="sm" className={classes.prose}>
                  {change.current}
                </Text>
              </div>
            </div>
          </details>
        ))
      ) : (
        <Text>内容根版本已变化，集场镜内容没有差异。</Text>
      )}
    </Stack>
  );
}

export function ProposalChanges({
  before,
  after,
}: {
  before: Operation[];
  after: Operation[];
}) {
  return (
    <Stack mt="md" gap="sm">
      {[...new Set([...before, ...after].map((op) => op.opId))].map((id) => {
        const local = before.find((op) => op.opId === id),
          server = after.find((op) => op.opId === id);
        if (JSON.stringify(local) === JSON.stringify(server)) return null;
        return (
          <details key={id}>
            <summary>{title(server ?? local!)} · 内容不同</summary>
            <div className={classes.columns}>
              <div>
                <Text fw={600}>本地草稿</Text>
                {local ? (
                  <>
                    <Text>{title(local)}</Text>
                    {local.kind === "shot" && (
                      <ShotPreview
                        spec={(local.proposed as Schema<"ShotInput">).spec}
                      />
                    )}
                  </>
                ) : (
                  <Text>本地没有此项</Text>
                )}
              </div>
              <div>
                <Text fw={600}>服务器修订</Text>
                {server ? (
                  <>
                    <Text>{title(server)}</Text>
                    {server.kind === "shot" && (
                      <ShotPreview
                        spec={(server.proposed as Schema<"ShotInput">).spec}
                      />
                    )}
                  </>
                ) : (
                  <Text>服务器没有此项</Text>
                )}
              </div>
            </div>
          </details>
        );
      })}
    </Stack>
  );
}

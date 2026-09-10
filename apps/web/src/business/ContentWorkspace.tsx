import { ProposalWorkspace } from "./ProposalWorkspace";
import { CreativeWorkspace } from "./CreativeWorkspace";
import { TaskWorkspace } from "./TaskWorkspace";
import { memberName, taskStatuses } from "./task-model";
import { useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
} from "@mantine/core";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Archive,
  ArrowCounterClockwise,
  FilmSlate,
  PencilSimple,
  Plus,
  Scroll,
} from "@phosphor-icons/react";
import { useCommand, useList, useResource, type Schema } from "./api";
import { Empty, ErrorNotice, projectPath, SectionHeading } from "./common";
import {
  ScriptEditor,
  StructureEditor,
  type ContentEditing,
  type ContentEntity,
} from "./ContentEditors";
import classes from "./workbench.module.css";
import layout from "./content.module.css";
import {
  ContinuitySummary,
  DialogueSummary,
  FixedAssetLabel,
} from "./CreativeAssetFields";
import { AssetReferenceFields } from "./AssetReferenceFields";

export function ContentWorkspace({
  tenantId,
  projectId,
  own,
  members,
}: {
  tenantId: string;
  projectId: string;
  own: Schema<"Membership">;
  members: Schema<"Membership">[];
}) {
  const path = projectPath(tenantId, projectId);
  const project = useResource<Schema<"Project">>(path),
    content = useResource<Schema<"ContentTree">>(`${path}/content`),
    scripts = useList<Schema<"ScriptRevision">>(`${path}/scripts`);
  const [episodeId, setEpisodeId] = useState<string | null>(null),
    [sceneId, setSceneId] = useState<string | null>(null),
    [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<ContentEditing>(),
    [scriptOpen, setScriptOpen] = useState(false),
    [proposalOpen, setProposalOpen] = useState(false),
    [creativeOpen, setCreativeOpen] = useState(false),
    [tasksOpen, setTasksOpen] = useState(false),
    [history, setHistory] = useState<Schema<"Shot">>();
  const [historyRevision, setHistoryRevision] = useState<string>();
  const linked = new URLSearchParams(location.hash.split("?")[1]),
    linkedScene = linked.get("scene"),
    linkedShot = linked.get("shot"),
    linkedRevision = linked.get("revision");
  const handledLink = useRef("");
  useEffect(() => {
    const key = JSON.stringify([linkedScene, linkedShot, linkedRevision]);
    if (
      !content.data ||
      (!linkedScene && !linkedShot) ||
      key === handledLink.current
    )
      return;
    handledLink.current = key;
    const shot = content.data.shots.find((s) => s.id === linkedShot);
    const scene = content.data.scenes.find(
      (s) => s.id === (shot?.sceneId ?? linkedScene),
    );
    if (scene) {
      setEpisodeId(scene.episodeId);
      setSceneId(scene.id);
      setArchived(true);
    }
    if (shot) {
      setHistoryRevision(linkedRevision ?? shot.specRevisionId);
      setHistory(shot);
    }
  }, [content.data, linkedScene, linkedShot, linkedRevision]);
  const [archive, setArchive] = useState<{
    kind: ContentEditing["kind"];
    entity: ContentEntity;
  }>();
  const command = useCommand<unknown>();
  useEffect(() => {
    if (project.data) document.title = `${project.data.name} · 集场镜 · 幕序`;
  }, [project.data?.name]);
  if ((project.isError && !project.data) || (content.isError && !content.data))
    return (
      <ErrorNotice
        error={project.error ?? content.error}
        retry={() => {
          void project.refetch();
          void content.refetch();
        }}
      />
    );
  if (!project.data || !content.data)
    return <Loader aria-label="正在读取集场镜" />;
  const tree = content.data,
    p = project.data,
    active = p.status === "active";
  const episodes = tree.episodes.filter(
    (e) => archived || e.status === "active",
  );
  const episode = episodes.find((e) => e.id === episodeId) ?? episodes[0];
  const scenes = tree.scenes.filter(
    (s) => s.episodeId === episode?.id && (archived || s.status === "active"),
  );
  const scene = scenes.find((s) => s.id === sceneId) ?? scenes[0];
  const shots = tree.shots.filter(
    (s) => s.sceneId === scene?.id && (archived || s.status === "active"),
  );
  const sceneEditable =
    active && episode?.status === "active" && scene?.status === "active";
  if (tasksOpen)
    return (
      <TaskWorkspace
        path={path}
        project={p}
        tree={tree}
        members={members}
        own={own}
        canManage={
          own.role === "owner" ||
          own.role === "admin" ||
          p.leadMembershipId === own.id
        }
        {...(scene?.id ? { initialSceneId: scene.id } : {})}
        onClose={() => setTasksOpen(false)}
      />
    );
  if (creativeOpen)
    return (
      <CreativeWorkspace
        path={path}
        project={p}
        tree={tree}
        members={members}
        canConfirm={
          own.role === "owner" ||
          own.role === "admin" ||
          p.leadMembershipId === own.id
        }
        onClose={() => setCreativeOpen(false)}
      />
    );
  if (proposalOpen)
    return (
      <ProposalWorkspace
        path={path}
        tree={tree}
        active={active}
        projectName={p.name}
        {...(scene?.id ? { initialSceneId: scene.id } : {})}
        onClose={() => setProposalOpen(false)}
      />
    );
  function move(
    kind: ContentEditing["kind"],
    parentId: string,
    id: string,
    delta: number,
  ) {
    const siblings =
      kind === "episode"
        ? tree.episodes
        : kind === "scene"
          ? tree.scenes.filter((s) => s.episodeId === parentId)
          : tree.shots.filter((s) => s.sceneId === parentId);
    const orderedIds = siblings.map((s) => s.id),
      index = orderedIds.indexOf(id),
      target = index + delta;
    if (target < 0 || target >= orderedIds.length) return;
    [orderedIds[index], orderedIds[target]] = [
      orderedIds[target]!,
      orderedIds[index]!,
    ];
    command.mutate({
      path: `${path}/content/reorder`,
      body: { kind, parentId, orderedIds },
      version: tree.revision,
    });
  }
  const controls = (
    kind: ContentEditing["kind"],
    entity: ContentEntity,
    parentId: string,
    enabled: boolean,
  ) => {
    const siblings =
      kind === "episode"
        ? tree.episodes
        : kind === "scene"
          ? tree.scenes.filter((s) => s.episodeId === parentId)
          : tree.shots.filter((s) => s.sceneId === parentId);
    const index = siblings.findIndex((s) => s.id === entity.id),
      name = "label" in entity ? entity.label : entity.title;
    return (
      <Group gap="xs" wrap="wrap">
        <ActionIcon
          variant="subtle"
          aria-label={`编辑${name}`}
          disabled={!enabled}
          onClick={() => setEditing({ kind, id: entity.id, parentId })}
        >
          <PencilSimple size={18} />
        </ActionIcon>
        <ActionIcon
          variant="subtle"
          aria-label={`上移${name}`}
          disabled={!enabled || index === 0 || command.isPending}
          onClick={() => move(kind, parentId, entity.id, -1)}
        >
          <ArrowUp size={18} />
        </ActionIcon>
        <ActionIcon
          variant="subtle"
          aria-label={`下移${name}`}
          disabled={
            !enabled || index === siblings.length - 1 || command.isPending
          }
          onClick={() => move(kind, parentId, entity.id, 1)}
        >
          <ArrowDown size={18} />
        </ActionIcon>
        <ActionIcon
          variant="subtle"
          aria-label={`${entity.status === "active" ? "归档" : "恢复"}${name}`}
          disabled={!enabled}
          onClick={() => setArchive({ kind, entity })}
        >
          {entity.status === "active" ? (
            <Archive size={18} />
          ) : (
            <ArrowCounterClockwise size={18} />
          )}
        </ActionIcon>
      </Group>
    );
  };
  return (
    <>
      <ErrorNotice
        error={project.error ?? content.error}
        retry={() => {
          void project.refetch();
          void content.refetch();
        }}
      />
      <Button
        component="a"
        href={`#/app/t/${tenantId}/p/${projectId}`}
        variant="subtle"
        leftSection={<ArrowLeft size={18} />}
        mb="xl"
      >
        项目设定
      </Button>
      <SectionHeading
        title={p.name}
        description="剧本与集场镜 · 从文字到每一镜的创作要求"
        action={
          <Group>
            <Button
              component="a"
              href={`#/app/t/${tenantId}/p/${projectId}/media`}
            >
              项目素材
            </Button>
            <Button
              component="a"
              href={`#/app/t/${tenantId}/p/${projectId}/assets`}
            >
              项目资产
            </Button>
            <Button variant="default" onClick={() => setTasksOpen(true)}>
              分工与任务
            </Button>
            <Button variant="default" onClick={() => setCreativeOpen(true)}>
              创作依据
            </Button>
            <Button variant="default" onClick={() => setProposalOpen(true)}>
              CSV 与提案
            </Button>
            <Button
              leftSection={<Scroll size={18} />}
              disabled={scripts.isPending || scripts.isError}
              onClick={() => setScriptOpen(true)}
            >
              {tree.currentScriptRevisionId ? "剧本与历史" : "录入剧本"}
            </Button>
          </Group>
        }
      />
      <ErrorNotice error={scripts.error} retry={() => void scripts.refetch()} />
      <ErrorNotice error={command.error} />
      {!active && (
        <Alert mb="lg" title="项目已归档">
          内容与历史可查阅，恢复项目后可继续修改。
        </Alert>
      )}
      <Group justify="space-between" mb="xl">
        <Group gap="lg">
          <Text size="sm" c="dimmed">
            {tree.episodes.filter((e) => e.status === "active").length} 集 ·{" "}
            {tree.scenes.filter((s) => s.status === "active").length} 场 ·{" "}
            {tree.shots.filter((s) => s.status === "active").length} 镜
          </Text>
          <Text size="xs" c="dimmed">
            内容版本 {tree.revision}
          </Text>
        </Group>
        <Switch
          label="显示归档内容"
          checked={archived}
          onChange={(e) => setArchived(e.currentTarget.checked)}
        />
      </Group>
      <div className={layout.workspace}>
        <aside className={layout.outline} aria-label="集场结构">
          <Group justify="space-between">
            <Text fw={600}>集场结构</Text>
            <Button
              size="xs"
              variant="subtle"
              leftSection={<Plus size={16} />}
              disabled={!active}
              onClick={() =>
                setEditing({ kind: "episode", parentId: projectId })
              }
            >
              新建单集
            </Button>
          </Group>
          {!episodes.length && (
            <Text c="dimmed" size="sm" mt="lg">
              先建立单集，再安排场次。
            </Text>
          )}
          {episodes.map((ep) => (
            <section key={ep.id} className={layout.episode}>
              <Button
                fullWidth
                justify="space-between"
                variant={episode?.id === ep.id ? "light" : "subtle"}
                onClick={() => {
                  setEpisodeId(ep.id);
                  setSceneId(null);
                }}
                rightSection={
                  ep.status === "archived" ? (
                    <Badge size="xs">归档</Badge>
                  ) : undefined
                }
              >
                {ep.title}
              </Button>
              {episode?.id === ep.id && (
                <>
                  <Group justify="space-between" mt="xs">
                    {controls("episode", ep, projectId, active)}
                    <Button
                      size="xs"
                      variant="subtle"
                      disabled={!active || ep.status !== "active"}
                      onClick={() =>
                        setEditing({ kind: "scene", parentId: ep.id })
                      }
                    >
                      添加场次
                    </Button>
                  </Group>
                  <Stack gap="xs" mt="lg">
                    {scenes.map((sc) => (
                      <Button
                        key={sc.id}
                        fullWidth
                        justify="flex-start"
                        variant={scene?.id === sc.id ? "default" : "subtle"}
                        leftSection={<FilmSlate size={18} />}
                        onClick={() => setSceneId(sc.id)}
                      >
                        {sc.title}
                        {sc.status === "archived" ? " · 归档" : ""}
                      </Button>
                    ))}
                    {!scenes.length && (
                      <Text size="sm" c="dimmed">
                        本集尚无场次。
                      </Text>
                    )}
                  </Stack>
                </>
              )}
            </section>
          ))}
        </aside>
        <section className={layout.content} aria-label="场次镜头">
          {!scene ? (
            <Empty>
              <FilmSlate size={32} />
              <Text mt="md">选择或创建场次，开始安排镜头。</Text>
            </Empty>
          ) : (
            <>
              <SectionHeading
                level={2}
                title={scene.title}
                description={
                  [scene.timeLabel, scene.locationLabel]
                    .filter(Boolean)
                    .join(" · ") || "场次梗概与镜头要求"
                }
                action={controls(
                  "scene",
                  scene,
                  scene.episodeId,
                  active && episode?.status === "active",
                )}
              />
              <SceneResponsibility
                path={path}
                sceneId={scene.id}
                members={members}
                onOpen={() => setTasksOpen(true)}
              />
              {(scene.status === "archived" ||
                episode?.status === "archived") && (
                <Alert mb="lg">此场次或所属单集已归档，历史镜头保留。</Alert>
              )}
              {scene.summary && (
                <Text mb="md" className={layout.prose}>
                  {scene.summary}
                </Text>
              )}
              {scene.state.spatialNotes && (
                <Text c="dimmed" size="sm" mb="xl" className={layout.prose}>
                  {scene.state.spatialNotes}
                </Text>
              )}
              {!!(
                scene.state.characters?.length ||
                scene.state.props?.length ||
                scene.defaultAssetRevisionIds?.length
              ) && (
                <details>
                  <summary>查看场次角色、道具与默认资产</summary>
                  <Stack my="md">
                    <ContinuitySummary
                      path={path.split("/projects/")[0]!}
                      value={scene.state}
                      label="场次预期状态"
                    />
                    {scene.defaultAssetRevisionIds?.map((id) => (
                      <FixedAssetLabel
                        key={id}
                        path={path.split("/projects/")[0]!}
                        id={id}
                      />
                    ))}
                  </Stack>
                </details>
              )}
              <Group justify="space-between" mb="lg">
                <Text fw={600}>
                  镜头列表{" "}
                  <Text span c="dimmed" fw={400}>
                    · {shots.length}
                  </Text>
                </Text>
                <Button
                  variant="filled"
                  size="sm"
                  leftSection={<Plus size={18} />}
                  disabled={!sceneEditable}
                  onClick={() =>
                    setEditing({ kind: "shot", parentId: scene.id })
                  }
                >
                  添加镜头
                </Button>
              </Group>
              {!shots.length && (
                <Empty>
                  还没有镜头。先写明叙事意图，再逐步补充动作、台词和原文依据。
                </Empty>
              )}
              <div className={layout.shots}>
                {shots.map((sh) => (
                  <article className={layout.shot} key={sh.id}>
                    <div className={layout.shotTop}>
                      <Group>
                        <Text fw={600}>{sh.label}</Text>
                        {sh.status === "archived" && (
                          <Badge size="xs">归档</Badge>
                        )}
                      </Group>
                      {controls("shot", sh, sh.sceneId, !!sceneEditable)}
                    </div>
                    <Text className={layout.prose} mt="md">
                      {sh.spec.intent || "尚未填写叙事意图"}
                    </Text>
                    {sh.spec.action && (
                      <Text
                        className={layout.prose}
                        c="dimmed"
                        size="sm"
                        mt="sm"
                      >
                        {sh.spec.action}
                      </Text>
                    )}
                    {!!sh.spec.dialogue?.length && (
                      <div className={layout.dialogue}>
                        {sh.spec.dialogue.map((d) => (
                          <Text key={d.id} size="sm">
                            “{d.text}”
                          </Text>
                        ))}
                      </div>
                    )}
                    <Group justify="space-between" mt="lg">
                      <Text size="xs" c="dimmed">
                        {sh.spec.plannedDurationUs !== undefined
                          ? `${sh.spec.plannedDurationUs / 1000000} 秒`
                          : "时长待定"}
                        {sh.spec.camera ? ` · ${sh.spec.camera}` : ""}
                        {sh.spec.sourceExcerpts?.length
                          ? ` · ${sh.spec.sourceExcerpts.length} 处原文`
                          : ""}
                      </Text>
                      <Button
                        size="xs"
                        variant="subtle"
                        onClick={() => {
                          setHistoryRevision(undefined);
                          setHistory(sh);
                        }}
                      >
                        要求历史
                      </Button>
                    </Group>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
      <Modal
        opened={!!editing}
        onClose={() => setEditing(undefined)}
        title={`${editing?.id ? "编辑" : "新建"}${editing?.kind === "episode" ? "单集" : editing?.kind === "scene" ? "场次" : "镜头"}`}
        size="lg"
      >
        {editing && (
          <StructureEditor
            key={`${editing.kind}:${editing.id ?? editing.parentId}`}
            editing={editing}
            tree={tree}
            path={path}
            scripts={scripts.data ?? []}
            done={() => setEditing(undefined)}
          />
        )}
      </Modal>
      <Modal
        opened={scriptOpen}
        onClose={() => setScriptOpen(false)}
        title="剧本与版本"
        size="xl"
      >
        {scriptOpen &&
          (active ? (
            <ScriptEditor
              tree={tree}
              scripts={scripts.data ?? []}
              path={path}
              done={() => setScriptOpen(false)}
            />
          ) : (
            <ScriptArchive scripts={scripts.data ?? []} />
          ))}
      </Modal>
      <Modal
        opened={!!history}
        onClose={() => setHistory(undefined)}
        title={`${history?.label ?? ""} · 要求历史`}
        size="lg"
      >
        {history && (
          <ShotHistory
            key={`${history.id}:${historyRevision ?? "current"}`}
            path={path}
            shot={history}
            initialRevisionId={historyRevision}
          />
        )}
      </Modal>
      <Modal
        opened={!!archive}
        onClose={() => setArchive(undefined)}
        title={archive?.entity.status === "active" ? "归档内容" : "恢复内容"}
      >
        {archive && (
          <Stack>
            <Text>
              {archive.entity.status === "active"
                ? "归档后从当前计划隐藏；原文、要求历史和后续素材引用会保留。上级归档期间，下级内容只读。"
                : "恢复后重新出现在当前计划。"}
            </Text>
            <ErrorNotice error={command.error} />
            <Button
              loading={command.isPending}
              onClick={() => {
                const { kind, entity } = archive;
                const fields =
                  kind === "episode"
                    ? {
                        title: (entity as Schema<"Episode">).title,
                        position: entity.position,
                      }
                    : kind === "scene"
                      ? (() => {
                          const s = entity as Schema<"Scene">;
                          return {
                            episodeId: s.episodeId,
                            title: s.title,
                            position: s.position,
                            summary: s.summary,
                            state: s.state,
                            defaultAssetRevisionIds:
                              s.defaultAssetRevisionIds ?? [],
                            ...(s.timeLabel ? { timeLabel: s.timeLabel } : {}),
                            ...(s.locationLabel
                              ? { locationLabel: s.locationLabel }
                              : {}),
                          };
                        })()
                      : (() => {
                          const s = entity as Schema<"Shot">;
                          return {
                            sceneId: s.sceneId,
                            label: s.label,
                            position: s.position,
                            spec: s.spec,
                          };
                        })();
                command.mutate(
                  {
                    path: `${path}/${kind}s/${entity.id}`,
                    method: "PUT",
                    body: {
                      ...fields,
                      status:
                        entity.status === "active" ? "archived" : "active",
                    },
                    version: entity.revision,
                  },
                  { onSuccess: () => setArchive(undefined) },
                );
              }}
            >
              确认{archive.entity.status === "active" ? "归档" : "恢复"}
            </Button>
          </Stack>
        )}
      </Modal>
    </>
  );
}
function SceneResponsibility({
  path,
  sceneId,
  members,
  onOpen,
}: {
  path: string;
  sceneId: string;
  members: Schema<"Membership">[];
  onOpen: () => void;
}) {
  const tasks = useList<Schema<"Task">>(
    `${path}/tasks?kind=scene_owner&sceneId=${sceneId}`,
  );
  const task = tasks.data?.[0];
  return (
    <Stack gap="xs" mb="lg">
      <ErrorNotice error={tasks.error} retry={() => void tasks.refetch()} />
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {tasks.isPending
            ? "正在读取场次主责…"
            : tasks.isError
              ? "场次主责暂时无法读取"
              : task
                ? `场次主责：${memberName(members, task.assigneeMembershipId)} · ${task.assigneeAvailable ? taskStatuses[task.status] : "待重新分配"}`
                : "场次主责：尚未分配"}
        </Text>
        <Button size="xs" variant="subtle" onClick={onOpen}>
          查看本场分工
        </Button>
      </Group>
    </Stack>
  );
}
function ScriptArchive({ scripts }: { scripts: Schema<"ScriptRevision">[] }) {
  return (
    <Stack>
      {[...scripts]
        .sort((a, b) => b.number - a.number)
        .map((s) => (
          <Textarea
            key={s.id}
            label={`第 ${s.number} 版`}
            value={s.text}
            readOnly
            minRows={4}
            maxRows={12}
            autosize
          />
        ))}
    </Stack>
  );
}
function ShotHistory({
  path,
  shot,
  initialRevisionId,
}: {
  path: string;
  shot: Schema<"Shot">;
  initialRevisionId?: string | undefined;
}) {
  const history = useList<Schema<"ShotRevision">>(
      `${path}/shots/${shot.id}/revisions`,
    ),
    [id, setId] = useState<string | null>(
      initialRevisionId ?? shot.specRevisionId,
    );
  const revision = history.data?.find((r) => r.id === id);
  return (
    <Stack>
      <ErrorNotice error={history.error} />
      {history.isPending ? (
        <Loader />
      ) : (
        <>
          <Select
            label="镜头要求版本"
            value={id}
            onChange={setId}
            data={[...(history.data ?? [])]
              .sort((a, b) => b.number - a.number)
              .map((r) => ({
                value: r.id,
                label: `第 ${r.number} 版${r.id === shot.specRevisionId ? " · 当前" : ""}`,
              }))}
          />
          {revision && (
            <>
              <Textarea
                label="叙事意图"
                readOnly
                value={revision.spec.intent}
                autosize
                minRows={3}
              />
              <Textarea
                label="动作与表演"
                readOnly
                value={revision.spec.action ?? ""}
                autosize
                minRows={2}
              />
              <Text size="sm" c="dimmed">
                机位：{revision.spec.camera || "未填写"} · 时长：
                {revision.spec.plannedDurationUs === undefined
                  ? "未填写"
                  : `${revision.spec.plannedDurationUs / 1000000} 秒`}
              </Text>
              <ContinuitySummary
                path={path.split("/projects/")[0]!}
                value={revision.spec.entryState ?? {}}
                label="入口状态"
              />
              <ContinuitySummary
                path={path.split("/projects/")[0]!}
                value={revision.spec.exitState ?? {}}
                label="出口状态"
              />
              <AssetReferenceFields
                path={path.split("/projects/")[0]!}
                projectId={shot.projectId}
                value={revision.spec.references}
                onChange={() => {}}
                readOnly
              />
              {revision.spec.notes && (
                <Textarea
                  label="备注"
                  readOnly
                  value={revision.spec.notes}
                  autosize
                />
              )}
              <DialogueSummary
                path={path.split("/projects/")[0]!}
                value={revision.spec.dialogue ?? []}
              />
              {revision.spec.sourceExcerpts?.map((ex, i) => (
                <Text key={i} className={classes.notice}>
                  {ex.quote}
                </Text>
              ))}
              <Text size="xs" c="dimmed">
                此处只读查阅，不改变当前要求，也不复用任何批准。
              </Text>
            </>
          )}
        </>
      )}
    </Stack>
  );
}

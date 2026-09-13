import { ProposalDetail, ProposalWorkspace } from "./ProposalWorkspace";
import { SceneAssistant } from "./SceneAssistant";
import { CreativeWorkspace } from "./CreativeWorkspace";
import { ProductionSettings } from "./ProductionSettings";
import { SceneIndexPreview } from "./SceneIndexPreview";
import { useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Menu,
  Modal,
  Select,
  Stack,
  Switch,
  Tabs,
  Tooltip,
  Text,
  Textarea,
} from "@mantine/core";
import {
  ArrowDown,
  ArrowUp,
  Archive,
  ArrowCounterClockwise,
  FilmSlate,
  PencilSimple,
  Plus,
  Sparkle,
  X,
  DotsThree,
} from "@phosphor-icons/react";
import { ApiError, useCommand, useList, useResource, type Schema } from "./api";
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
  view = "scenes",
}: {
  tenantId: string;
  projectId: string;
  own: Schema<"Membership">;
  members: Schema<"Membership">[];
  view?: "scenes" | "script";
}) {
  const path = projectPath(tenantId, projectId);
  const project = useResource<Schema<"Project">>(path),
    content = useResource<Schema<"ContentTree">>(`${path}/content`),
    scripts = useList<Schema<"ScriptRevision">>(`${path}/scripts`);
  const [episodeId, setEpisodeId] = useState<string | null>(null),
    [sceneId, setSceneId] = useState<string | null>(null),
    [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<ContentEditing>(),
    [proposalOpen, setProposalOpen] = useState(false),
    [creativeOpen, setCreativeOpen] = useState(false),
    [history, setHistory] = useState<Schema<"Shot">>();
  const [historyRevision, setHistoryRevision] = useState<string>();
  const linked = new URLSearchParams(location.hash.split("?")[1]),
    linkedScene = linked.get("scene"),
    linkedShot = linked.get("shot"),
    linkedRevision = linked.get("revision");
  const scriptView = view === "script" || !!(linkedRevision && !linkedShot);
  const scriptTab = linked.get("tab") === "settings" ? "settings" : "text";
  function setScriptTab(value: string | null) {
    const query = new URLSearchParams(location.hash.split("?")[1]);
    if (value === "settings") query.set("tab", "settings");
    else query.delete("tab");
    location.hash = `${location.hash.split("?")[0]}${query.size ? `?${query}` : ""}`;
  }
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [scriptMounted, setScriptMounted] = useState(scriptView),
    [scriptEpoch, setScriptEpoch] = useState(0),
    [scriptOpening, setScriptOpening] = useState(false),
    [scriptTargetId, setScriptTargetId] = useState<string | null>(linkedScene),
    [scriptProposalId, setScriptProposalId] = useState<string>(),
    [detailsOpen, setDetailsOpen] = useState(!!(linkedScene || linkedShot));
  useEffect(() => {
    if (scriptView) setScriptMounted(true);
  }, [scriptView]);
  const handledLink = useRef("");
  useEffect(() => {
    const key = JSON.stringify([linkedScene, linkedShot, linkedRevision]);
    if (!content.data) return;
    if (!linkedScene && !linkedShot) {
      if (handledLink.current) {
        handledLink.current = "";
        setHistory(undefined);
        setHistoryRevision(undefined);
      }
      return;
    }
    if (key === handledLink.current) return;
    handledLink.current = key;
    const shot = content.data.shots.find((s) => s.id === linkedShot);
    const scene = content.data.scenes.find(
      (s) => s.id === (shot?.sceneId ?? linkedScene),
    );
    if (scene) {
      setEpisodeId(scene.episodeId);
      setSceneId(scene.id);
      setDetailsOpen(true);
      setArchived(true);
    }
    if (shot) {
      setHistoryRevision(linkedRevision ?? shot.specRevisionId);
      setHistory(shot);
    } else setHistory(undefined);
  }, [content.data, linkedScene, linkedShot, linkedRevision]);
  const [archive, setArchive] = useState<{
    kind: ContentEditing["kind"];
    entity: ContentEntity;
  }>();
  const command = useCommand<unknown>();
  const currentAccessError = [project.error, content.error, scripts.error].find(
    (error) =>
      error instanceof ApiError && [401, 403, 404].includes(error.status),
  );
  const [deniedAccess, setDeniedAccess] = useState<Error | null>(null);
  // Query caches retain data after refetch errors. A confirmed denial stays
  // closed through subsequent outages until all protected reads succeed again.
  const blockedAccess = currentAccessError ?? deniedAccess;
  useEffect(() => {
    if (currentAccessError) setDeniedAccess(currentAccessError);
    else if (project.isSuccess && content.isSuccess && scripts.isSuccess)
      setDeniedAccess(null);
  }, [
    currentAccessError,
    project.isSuccess,
    content.isSuccess,
    scripts.isSuccess,
  ]);
  useEffect(() => {
    if (blockedAccess) document.title = "内容不可访问 · 幕序";
    else if (project.data)
      document.title = `${project.data.name} · ${scriptView ? "剧本与设定" : "场次"} · 幕序`;
  }, [project.data?.name, blockedAccess, scriptView]);
  if (
    blockedAccess ||
    (project.isError && !project.data) ||
    (content.isError && !content.data)
  )
    return (
      <ErrorNotice
        error={blockedAccess ?? project.error ?? content.error}
        retry={() => {
          void project.refetch();
          void content.refetch();
          void scripts.refetch();
        }}
      />
    );
  if (!project.data || !content.data)
    return <Loader aria-label="正在读取集场镜" />;
  const tree = content.data,
    p = project.data,
    active = p.status === "active";
  const missingLink = linkedShot
    ? !tree.shots.some((s) => s.id === linkedShot)
    : linkedScene && !tree.scenes.some((s) => s.id === linkedScene);
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
  if (creativeOpen)
    return (
      <div className={scriptView ? layout.fullWorkspace : undefined}>
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
      </div>
    );
  if (proposalOpen)
    return (
      <div className={scriptView ? layout.fullWorkspace : undefined}>
        <ProposalWorkspace
          path={path}
          tree={tree}
          active={active}
          projectName={p.name}
          {...(scene?.id ? { initialSceneId: scene.id } : {})}
          onClose={() => setProposalOpen(false)}
        />
      </div>
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
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon variant="subtle" aria-label={`管理${name}`}>
            <DotsThree size={20} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            leftSection={<PencilSimple size={16} />}
            disabled={!enabled}
            onClick={() => setEditing({ kind, id: entity.id, parentId })}
          >
            编辑{name}
          </Menu.Item>
          <Menu.Item
            leftSection={<ArrowUp size={16} />}
            disabled={!enabled || index === 0 || command.isPending}
            onClick={() => move(kind, parentId, entity.id, -1)}
          >
            上移{name}
          </Menu.Item>
          <Menu.Item
            leftSection={<ArrowDown size={16} />}
            disabled={
              !enabled || index === siblings.length - 1 || command.isPending
            }
            onClick={() => move(kind, parentId, entity.id, 1)}
          >
            下移{name}
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item
            leftSection={
              entity.status === "active" ? (
                <Archive size={16} />
              ) : (
                <ArrowCounterClockwise size={16} />
              )
            }
            disabled={!enabled}
            onClick={() => setArchive({ kind, entity })}
          >
            {entity.status === "active" ? "归档" : "恢复"}
            {name}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    );
  };
  return (
    <>
      {missingLink && (
        <Alert title="链接中的内容不可用">
          <Text>
            指定的{linkedShot ? "镜头" : "场次"}
            不存在或不在当前可访问内容中。下方为当前项目内容，请重新选择。
          </Text>
          <Button
            mt="sm"
            onClick={() => {
              location.hash = location.hash.split("?")[0]!;
            }}
          >
            返回项目集场镜
          </Button>
        </Alert>
      )}
      <ErrorNotice
        error={project.error ?? content.error}
        retry={() => {
          void project.refetch();
          void content.refetch();
        }}
      />
      {!scriptView && (
        <SectionHeading
          title={scriptView ? "剧本与设定" : "场次"}
          description={
            scriptView
              ? "写下故事，再将选定原文整理为场次中的镜头要求。"
              : "按单集组织场次，从这里进入每一场的制作。"
          }
          action={
            <Group gap="sm">
              <Button variant="subtle" onClick={() => setCreativeOpen(true)}>
                创作依据
              </Button>
              <Button variant="default" onClick={() => setProposalOpen(true)}>
                CSV 与提案
              </Button>
              {!scriptView && (
                <Button
                  leftSection={<Plus size={16} />}
                  disabled={!active}
                  onClick={() =>
                    setEditing({ kind: "episode", parentId: projectId })
                  }
                >
                  新建单集
                </Button>
              )}
            </Group>
          }
        />
      )}
      <ErrorNotice error={scripts.error} retry={() => void scripts.refetch()} />
      <ErrorNotice error={command.error} />
      {!active && (
        <Alert mb="lg" title="项目已归档">
          内容与历史可查阅，恢复项目后可继续修改。
        </Alert>
      )}
      <div hidden={scriptView} className={layout.catalog}>
        {!episodes.length && <Empty>先新建单集，再安排故事发生的场次。</Empty>}
        <div aria-label="集场结构">
          {episodes.map((ep) => {
            const episodeScenes = tree.scenes.filter(
              (s) =>
                s.episodeId === ep.id && (archived || s.status === "active"),
            );
            return (
              <section
                key={ep.id}
                className={layout.episode}
                aria-label={ep.title}
              >
                <div className={layout.episodeHeader}>
                  <Group gap="sm">
                    <Text component="h2" className={layout.episodeTitle}>
                      {ep.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {episodeScenes.length} 场
                    </Text>
                    {ep.status === "archived" && <Badge size="xs">归档</Badge>}
                  </Group>
                  <Group gap="sm">
                    {controls("episode", ep, projectId, active)}
                    <Button
                      size="xs"
                      variant="subtle"
                      leftSection={<Plus size={14} />}
                      disabled={!active || ep.status !== "active"}
                      onClick={() =>
                        setEditing({ kind: "scene", parentId: ep.id })
                      }
                    >
                      添加场次
                    </Button>
                  </Group>
                </div>
                {episodeScenes.map((sc, index) => (
                  <article key={sc.id} className={layout.sceneRow}>
                    <SceneIndexPreview
                      path={path}
                      href={`#/app/t/${tenantId}/p/${projectId}/production?scene=${sc.id}`}
                      shot={tree.shots.find(
                        (sh) =>
                          sh.sceneId === sc.id &&
                          sh.status === "active" &&
                          !!sh.currentTakeId,
                      )}
                      title={sc.title}
                    />
                    <div className={layout.sceneName}>
                      <Text fw={600}>
                        {String(index + 1).padStart(2, "0")} · {sc.title}
                      </Text>
                      {sc.summary && (
                        <Text size="sm" c="dimmed" lineClamp={2} my="sm">
                          {sc.summary}
                        </Text>
                      )}
                      <Text size="xs" c="dimmed">
                        {
                          tree.shots.filter(
                            (s) => s.sceneId === sc.id && s.status === "active",
                          ).length
                        }{" "}
                        镜头
                        {[sc.locationLabel, sc.timeLabel].filter(Boolean).length
                          ? ` · ${[sc.locationLabel, sc.timeLabel].filter(Boolean).join(" / ")}`
                          : ""}
                      </Text>
                    </div>
                    {(sc.status === "archived" || ep.status === "archived") && (
                      <Text size="xs" c="dimmed" className={layout.sceneState}>
                        已归档
                      </Text>
                    )}
                    <Group gap="sm" className={layout.sceneActions}>
                      <Button
                        size="xs"
                        variant="subtle"
                        aria-expanded={detailsOpen && scene?.id === sc.id}
                        onClick={() => {
                          setEpisodeId(ep.id);
                          setSceneId(sc.id);
                          setDetailsOpen(!(detailsOpen && scene?.id === sc.id));
                        }}
                      >
                        场次与镜头要求
                      </Button>
                      <Button
                        size="sm"
                        variant="filled"
                        component="a"
                        href={`#/app/t/${tenantId}/p/${projectId}/production?scene=${sc.id}`}
                      >
                        进入制作
                      </Button>
                    </Group>
                  </article>
                ))}
                {!episodeScenes.length && (
                  <Text size="sm" c="dimmed" className={layout.emptyEpisode}>
                    本集尚无场次，添加场次后开始安排镜头。
                  </Text>
                )}
              </section>
            );
          })}
        </div>
        <Group justify="space-between" className={layout.catalogMeta}>
          <Text size="sm" c="dimmed">
            {tree.episodes.filter((e) => e.status === "active").length} 集 ·{" "}
            {tree.scenes.filter((s) => s.status === "active").length} 场 ·{" "}
            {tree.shots.filter((s) => s.status === "active").length} 镜
          </Text>
          <Group gap="lg">
            <Text size="xs" c="dimmed">
              内容版本 {tree.revision}
            </Text>
            <Switch
              label="显示归档内容"
              checked={archived}
              onChange={(e) => setArchived(e.currentTarget.checked)}
            />
          </Group>
        </Group>
        <section
          hidden={!detailsOpen}
          className={layout.content}
          aria-label="场次镜头"
        >
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
                action={
                  <Group>
                    <Button
                      variant="subtle"
                      onClick={() => setDetailsOpen(false)}
                    >
                      收起要求
                    </Button>
                    {controls(
                      "scene",
                      scene,
                      scene.episodeId,
                      active && episode?.status === "active",
                    )}
                  </Group>
                }
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
      {(scriptMounted || scriptView) && (
        <div
          hidden={!scriptView}
          className={layout.scriptWorkspace}
          data-assistant={(assistantOpen && scriptTab === "text") || undefined}
        >
          <section className={layout.scriptMain} aria-label="剧本正文与版本">
            {" "}
            <SectionHeading
              title={scriptView ? "剧本与设定" : "场次"}
              description={
                scriptView
                  ? "写下故事，再将选定原文整理为场次中的镜头要求。"
                  : "按单集组织场次，从这里进入每一场的制作。"
              }
              action={
                <Group gap="sm">
                  <Menu position="bottom-end" withinPortal>
                    <Menu.Target>
                      <ActionIcon aria-label="剧本操作" variant="subtle">
                        <DotsThree size={22} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item onClick={() => setProposalOpen(true)}>
                        提案历史与导入
                      </Menu.Item>
                      <Menu.Item onClick={() => setCreativeOpen(true)}>
                        核对创作依据
                      </Menu.Item>
                      <Menu.Item
                        component="a"
                        href={`#/app/t/${tenantId}/p/${projectId}/content`}
                      >
                        返回场次
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                  <Button
                    variant={assistantOpen ? "default" : "filled"}
                    leftSection={<Sparkle size={16} />}
                    aria-expanded={assistantOpen}
                    onClick={() => {
                      setScriptTab("text");
                      setAssistantOpen(
                        scriptTab === "text" ? !assistantOpen : true,
                      );
                    }}
                  >
                    整理为镜头
                  </Button>
                  {!scriptView && (
                    <Button
                      leftSection={<Plus size={16} />}
                      disabled={!active}
                      onClick={() =>
                        setEditing({ kind: "episode", parentId: projectId })
                      }
                    >
                      新建单集
                    </Button>
                  )}
                </Group>
              }
            />
            <Tabs value={scriptTab} onChange={setScriptTab} keepMounted mb="xl">
              <Tabs.List>
                <Tabs.Tab value="text">剧本正文</Tabs.Tab>
                <Tabs.Tab value="settings">故事设定</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="settings" pt="xl">
                <StorySettings path={path} active={active} />
              </Tabs.Panel>
              <Tabs.Panel value="text" pt="xl">
                {(scriptOpening || scripts.isPending) && (
                  <Loader aria-label="正在读取已保存的剧本版本" />
                )}
                {scripts.data &&
                  (active ? (
                    <ScriptEditor
                      key={scriptEpoch}
                      presentation="document"
                      tree={tree}
                      scripts={scripts.data}
                      path={path}
                      initialHistoryId={!linkedShot ? linkedRevision : null}
                      done={() => {
                        setScriptOpening(true);
                        // A successful write can precede query invalidation. Only reopen
                        // the document after both saved roots have been read back.
                        void Promise.all([content.refetch(), scripts.refetch()])
                          .then(([nextContent, nextScripts]) => {
                            if (!nextContent.isError && !nextScripts.isError)
                              setScriptEpoch((epoch) => epoch + 1);
                          })
                          .finally(() => setScriptOpening(false));
                      }}
                    />
                  ) : (
                    <ScriptArchive scripts={scripts.data} />
                  ))}
              </Tabs.Panel>
            </Tabs>
            <div className={layout.basis}>
              <div>
                <Text fw={600}>创作依据</Text>
                <Text size="sm" c="dimmed">
                  查看项目设定、角色关系和固定版本的创作依据。
                </Text>
              </div>
              <Button variant="default" onClick={() => setCreativeOpen(true)}>
                查看与编辑
              </Button>
            </div>
          </section>
          <aside
            hidden={!assistantOpen || scriptTab !== "text"}
            className={layout.scriptAssistant}
            aria-label="剧本提案助手"
          >
            <div className={layout.assistantHeader}>
              <Group justify="space-between">
                <Text component="h2" className={layout.episodeTitle}>
                  提案助手
                </Text>
                <Tooltip label="收起提案助手">
                  <ActionIcon
                    aria-label="收起提案助手"
                    onClick={() => setAssistantOpen(false)}
                  >
                    <X size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
              <Text size="xs" c="dimmed">
                选定来源 · 核对建议 · 明确采纳
              </Text>
            </div>
            {scriptProposalId ? (
              <>
                <Button
                  variant="subtle"
                  size="xs"
                  onClick={() => setScriptProposalId(undefined)}
                >
                  返回准备提案
                </Button>
                <ProposalDetail
                  key={scriptProposalId}
                  path={path}
                  tree={tree}
                  active={active}
                  projectName={p.name}
                  id={scriptProposalId}
                  onClose={() => setScriptProposalId(undefined)}
                />
              </>
            ) : (
              <Select
                label="本次建议的目标场次"
                placeholder="明确选择一个场次"
                clearable
                searchable
                value={scriptTargetId}
                onChange={setScriptTargetId}
                data={tree.scenes
                  .filter(
                    (sc) =>
                      sc.status === "active" &&
                      tree.episodes.some(
                        (ep) =>
                          ep.id === sc.episodeId && ep.status === "active",
                      ),
                  )
                  .map((sc) => ({
                    value: sc.id,
                    label: `${tree.episodes.find((ep) => ep.id === sc.episodeId)?.title ?? ""} · ${sc.title}`,
                  }))}
              />
            )}
            {scriptTargetId ? (
              <SceneAssistant
                key={scriptTargetId}
                tenantId={tenantId}
                projectId={projectId}
                sceneId={scriptTargetId}
                active={active}
                visible={
                  scriptView &&
                  assistantOpen &&
                  scriptTab === "text" &&
                  !scriptProposalId
                }
                onOpenProposal={setScriptProposalId}
              />
            ) : (
              !scriptProposalId && (
                <Text size="sm" c="dimmed">
                  先选择场次，再明确选取已保存的剧本版本与原文。正在编辑的文字不会自动成为生成输入。
                </Text>
              )
            )}
            {!scriptProposalId && (
              <Button variant="subtle" onClick={() => setProposalOpen(true)}>
                查看全部提案与导入
              </Button>
            )}
          </aside>
        </div>
      )}
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
function StorySettings({ path, active }: { path: string; active: boolean }) {
  const production = useResource<Schema<"Production">>(`${path}/production`);
  if (production.isError)
    return (
      <ErrorNotice
        error={production.error}
        retry={() => void production.refetch()}
      />
    );
  if (!production.data) return <Loader aria-label="正在读取故事设定" />;
  return (
    <ProductionSettings
      key={production.data.id}
      production={production.data}
      path={`${path}/production`}
      active={active}
      presentation="summary"
    />
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
      {history.data && id && !revision && (
        <Alert title="指定的要求版本不可用">
          这份镜头要求不存在或无访问权限，请明确选择其他版本。
        </Alert>
      )}
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

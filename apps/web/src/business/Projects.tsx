import { useEffect, useState } from "react";
import {
  ActionIcon,
  Menu,
  Skeleton,
  Tabs,
  Badge,
  Anchor,
  Button,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { Plus, ArrowLeft, ArrowRight, DotsThree, GearSix, FilmSlate } from "@phosphor-icons/react";
import {
  ApiError,
  useCommand,
  useList,
  useResource,
  type Schema,
  type Page,
} from "./api";
import {
  Empty,
  ErrorNotice,
  SectionHeading,
  projectPath,
  tenantPath,
} from "./common";
import classes from "./workbench.module.css";
import projectClasses from "./projects.module.css";
import { ContentWorkspace } from "./ContentWorkspace";
import { QualityReferenceSettings } from "./QualityReferenceSettings";
import { MediaPreview } from "./MediaPreview";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { CreateProjectForm } from "./CreateProjectForm";
import { ProductionSettings } from "./ProductionSettings";

type Member = Schema<"Membership">;
type Project = Schema<"Project">;
const rates = [
  { value: "24/1", label: "24 fps" },
  { value: "25/1", label: "25 fps" },
  { value: "30/1", label: "30 fps" },
  { value: "24000/1001", label: "23.976 fps（24000/1001）" },
  { value: "30000/1001", label: "29.97 fps（30000/1001）" },
];

export function Projects({
  tenantId,
  own,
  members,
  projectId,
  contentView,
}: {
  tenantId: string;
  own: Member;
  members: Member[];
  projectId?: string | undefined;
  contentView?: boolean | undefined;
}) {
  const manager = own.role === "owner" || own.role === "admin";
  const [creating, setCreating] = useState(false),
    [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "archived">("active");
  const projects = useList<Project>(`${tenantPath(tenantId)}/projects`);
  useEffect(() => {
    if (!projectId) document.title = "项目 · SceneDesk";
  }, [projectId]);
  if (projectId && contentView)
    return (
      <ContentWorkspace
        key={projectId}
        tenantId={tenantId}
        projectId={projectId}
        own={own}
        members={members}
      />
    );
  if (projectId)
    return (
      <ProjectDetails
        key={projectId}
        tenantId={tenantId}
        projectId={projectId}
        own={own}
      />
    );
  const available = projects.isError ? [] : (projects.data ?? []);
  const visibleProjects = available.filter((p) => p.status === status &&
    p.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return (
    <>
      <SectionHeading
        title="项目"
        action={
          manager && (
            <Button
              variant="filled"
              leftSection={<Plus size={18} />}
              onClick={() => setCreating(true)}
            >
              新建项目
            </Button>
          )
        }
      />
      <Tabs value={status} onChange={(value) => { if (value === "active" || value === "archived") setStatus(value); }}>
        <div className={projectClasses.toolbar}>
          <Tabs.List aria-label="项目状态" className={projectClasses.tabs}>
            <Tabs.Tab value="active">进行中{projects.data && !projects.isError && <span className={projectClasses.count}>{available.filter((p) => p.status === "active").length}</span>}</Tabs.Tab>
            <Tabs.Tab value="archived">已归档{projects.data && !projects.isError && <span className={projectClasses.count}>{available.filter((p) => p.status === "archived").length}</span>}</Tabs.Tab>
          </Tabs.List>
          <TextInput aria-label="查找项目" placeholder="搜索项目" value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            className={projectClasses.search} leftSection={<MagnifyingGlass size={16} aria-hidden />} />
        </div>
        <Tabs.Panel value={status}>
          <ErrorNotice error={projects.error} retry={() => void projects.refetch()} />
          {projects.isPending ? (
            <div className={projectClasses.grid} role="status" aria-label="正在读取项目">
              {[0, 1, 2].map((key) => <div key={key} className={projectClasses.card}>
                <Skeleton className={projectClasses.cover} /><div className={projectClasses.meta}><Skeleton height={20} width="65%" /></div><Skeleton height={18} width="45%" /><Skeleton height={18} width="35%" mt="xs" />
              </div>)}
            </div>
          ) : !projects.isError && visibleProjects.length ? (
            <div className={projectClasses.grid}>
              {visibleProjects.map((project) => <ProjectCard key={project.id} project={project} tenantId={tenantId} />)}
            </div>
          ) : !projects.isError && (
            <Empty>
              <Text>{search.trim() ? `没有找到符合“${search.trim()}”的项目。` : status === "archived" ? "还没有归档项目。" : "还没有进行中的项目。"}</Text>
              {search.trim() ? <Button variant="subtle" mt="md" onClick={() => setSearch("")}>清空搜索</Button> : status === "active" && (
                <Text mt="sm">{manager ? "创建项目，然后添加剧本、场次与参考素材。" : "负责人将你加入项目后，项目会显示在这里。"}</Text>
              )}
            </Empty>
          )}
        </Tabs.Panel>
      </Tabs>
      <Modal
        opened={creating && manager}
        onClose={() => setCreating(false)}
        title="新建短剧项目"
        size="lg"
      >
        {creating && manager && (
          <CreateProjectForm
            key={`${tenantId}:${own.id}`}
            tenantId={tenantId}
            own={own}
            onCreated={(id) => {
              setCreating(false);
              location.hash = `/app/t/${tenantId}/p/${id}/content`;
            }}
          />
        )}
      </Modal>
    </>
  );
}
function ProjectCard({ project, tenantId }: { project: Project; tenantId: string }) {
  const path = tenantPath(tenantId);
  const covers = useResource<Page<Schema<"Media">>>(
    `${path}/media?scope=project&projectId=${project.id}&kind=image&status=ready&limit=1`,
  );
  const cover = covers.isError ? undefined : covers.data?.items[0];
  const href = `#/app/t/${tenantId}/p/${project.id}/studio`;
  const { width, height, fpsNum, fpsDen } = project.spec;
  let divisor = width, remainder = height;
  while (remainder) [divisor, remainder] = [remainder, divisor % remainder];
  const unavailable = <ProjectPreviewFallback name={project.name} failed />;
  return (
    <article className={projectClasses.card} aria-label={project.name}>
      <Anchor href={href} className={projectClasses.cover} aria-label={`进入项目 ${project.name}`}>
        {covers.isPending ? <Skeleton height="100%" aria-label="正在读取项目预览" /> : cover ? (
          <MediaPreview media={cover} path={path} thumbnail unavailable={unavailable} />
        ) : <ProjectPreviewFallback name={project.name} failed={covers.isError} />}
      </Anchor>
      <div className={projectClasses.meta}>
        <Anchor href={href} className={projectClasses.title}>{project.name}</Anchor>
        <Menu position="bottom-end" width={168} withinPortal>
          <Menu.Target>
            <ActionIcon variant="subtle" color="gray" aria-label={`${project.name}的更多操作`}><DotsThree size={20} aria-hidden /></ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item component="a" href={`#/app/t/${tenantId}/p/${project.id}`} leftSection={<GearSix size={14} aria-hidden />}>项目设置</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>
      <Text size="xs" c="dimmed">{width === height ? "方形" : width > height ? "横屏" : "竖屏"} · {width / divisor}:{height / divisor} · {Number((fpsNum / fpsDen).toFixed(3))} fps</Text>
      <Anchor href={href} className={projectClasses.enter}>{project.status === "archived" ? "查看项目" : "进入创作台"}<ArrowRight size={14} aria-hidden /></Anchor>
    </article>
  );
}
function ProjectPreviewFallback({ name, failed }: { name: string; failed: boolean }) {
  return <div className={projectClasses.fallback}>
    <span className={projectClasses.fallbackName}>{name}</span>
    <span className={projectClasses.fallbackHint}>{failed ? "预览暂不可用" : "暂无预览"}</span>
  </div>;
}
function ProjectDetails({
  tenantId,
  projectId,
  own,
}: {
  tenantId: string;
  projectId: string;
  own: Member;
}) {
  const path = projectPath(tenantId, projectId),
    project = useResource<Project>(path);
  const participants = useList<Schema<"ProjectMember">>(`${path}/members`);
  const manager = own.role === "owner" || own.role === "admin";
  const lead = participants.data?.some(
    (m) => m.membershipId === own.id && m.role === "lead",
  );
  const [action, setAction] = useState<{
    kind: "archive" | "restore";
    project: Project;
  } | null>(null);
  const command = useCommand<Project>();
  useEffect(() => {
    if (project.data)
      document.title = `${project.data.name} · 项目设定 · SceneDesk`;
  }, [project.data?.name]);
  if (project.isError)
    return (
      <ErrorNotice error={project.error} retry={() => void project.refetch()} />
    );
  if (!project.data) return <Loader aria-label="正在读取项目" />;
  const p = project.data,
    active = p.status === "active";
  return (
    <>
      <Button
        variant="subtle"
        component="a"
        href={`#/app/t/${tenantId}`}
        leftSection={<ArrowLeft size={18} />}
        mb="xl"
      >
        工作室项目
      </Button>
      <SectionHeading
        title={p.name}
        description={active ? "项目与剧目设定" : "项目已归档，内容只读。"}
        action={
          (manager || lead) && (
            <Button
              onClick={() =>
                setAction({ kind: active ? "archive" : "restore", project: p })
              }
            >
              {active ? "归档项目" : "恢复项目"}
            </Button>
          )
        }
      />
      <Group mb="xl">
        <Button
          component="a"
          href={`#/app/t/${tenantId}/p/${projectId}/content`}
          leftSection={<FilmSlate size={18} />}
          variant="filled"
        >
          进入剧本与集场镜
        </Button>
        <Button
          component="a"
          href={`#/app/t/${tenantId}/p/${projectId}/assets`}
        >
          资产库
        </Button>
      </Group>
      {manager || lead ? (
        <ProjectSettings key={p.id} project={p} path={path} active={active} />
      ) : (
        <Text c="dimmed">
          {p.spec.width} × {p.spec.height} · {p.spec.fpsNum}/{p.spec.fpsDen} fps
        </Text>
      )}
      <hr className={classes.divider} />
      <QualityReferenceSettings
        project={p}
        path={path}
        active={active && !!(manager || lead)}
      />
      <hr className={classes.divider} />
      <Group justify="space-between">
        <div>
          <h2 className={classes.subheading}>剧目设定</h2>
          <Text c="dimmed">故事、风格与默认参考集中在创作页。</Text>
        </div>
        <StorySettings path={path} active={active} />
      </Group>
      <Modal
        opened={action !== null}
        onClose={() => {
          if (!command.isPending) {
            setAction(null);
            command.reset();
          }
        }}
        title={action?.kind === "archive" ? "归档项目" : "恢复项目"}
      >
        <Stack>
          <Text>
            {action?.kind === "archive"
              ? `归档“${action.project.name}”后项目内容只读，可以随时恢复。`
              : `恢复“${action?.project.name ?? ""}”后可继续编辑项目。`}
          </Text>
          <ErrorNotice error={command.error} />
          {command.error instanceof ApiError &&
            command.error.status === 412 && (
              <>
                <Text size="sm">
                  本次确认仍对应打开时的项目版本。请关闭后核对最新项目，再重新发起。
                </Text>
                <Button
                  onClick={() => {
                    setAction(null);
                    command.reset();
                    void project.refetch();
                  }}
                >
                  关闭并核对最新项目
                </Button>
              </>
            )}
          <Button
            variant="filled"
            loading={command.isPending}
            onClick={() => {
              if (!action) return;
              command.mutate(
                {
                  path: `${path}/${action.kind}`,
                  version: action.project.revision,
                },
                { onSuccess: () => setAction(null) },
              );
            }}
          >
            {action?.kind === "archive" ? "确认归档" : "确认恢复"}
          </Button>
        </Stack>
      </Modal>
    </>
  );
}
/** The story settings summary, opened from the project page since the old script page went. */
function StorySettings({ path, active }: { path: string; active: boolean }) {
  const [open, setOpen] = useState(false);
  const production = useResource<Schema<"Production">>(
    `${path}/production`,
    open,
  );
  return (
    <>
      <Button onClick={() => setOpen(true)}>查看剧目设定</Button>
      <Modal
        opened={open}
        onClose={() => setOpen(false)}
        title="剧目设定"
        size="lg"
      >
        {production.isError ? (
          <ErrorNotice
            error={production.error}
            retry={() => void production.refetch()}
          />
        ) : !production.data ? (
          <Loader aria-label="正在读取剧目设定" />
        ) : (
          <ProductionSettings
            key={production.data.id}
            production={production.data}
            path={`${path}/production`}
            active={active}
            presentation="summary"
          />
        )}
      </Modal>
    </>
  );
}
function ProjectSettings({
  project,
  path,
  active,
}: {
  project: Project;
  path: string;
  active: boolean;
}) {
  const command = useCommand<Project>();
  const [base, setBase] = useState(project);
  const form = useForm({
    initialValues: { name: project.name },
    validate: { name: (v) => (v.trim() ? null : "请输入项目名称。") },
  });
  return (
    <form
      className={classes.form}
      onSubmit={form.onSubmit((v) =>
        command.mutate(
          {
            path,
            method: "PATCH",
            version: base.revision,
            body: { name: v.name, spec: base.spec },
          },
          {
            onSuccess: (p) => {
              setBase(p);
              form.setInitialValues({ name: p.name });
            },
          },
        ),
      )}
    >
      <TextInput
        label="项目名称"
        maxLength={160}
        readOnly={!active}
        {...form.getInputProps("name")}
      />
      <Text c="dimmed">
        {base.spec.width} × {base.spec.height} · {base.spec.fpsNum}/
        {base.spec.fpsDen} fps · {base.spec.language}
      </Text>
      {active && project.revision !== base.revision && (
        <Text role="status">
          服务器已更新为「{project.name}」（版本 {project.revision}
          ）。当前输入仍然保留。
          <Button variant="subtle" onClick={() => setBase(project)}>
            核对后使用最新版本作为保存基线
          </Button>
        </Text>
      )}
      <ErrorNotice error={command.error} />
      {command.isSuccess && !form.isDirty() && (
        <Text role="status">项目设置已保存。</Text>
      )}
      {active && (
        <Button type="submit" variant="filled" loading={command.isPending}>
          保存项目设置
        </Button>
      )}
    </form>
  );
}

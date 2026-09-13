import { useEffect, useState } from "react";
import {
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
import { Plus, ArrowLeft, FilmSlate } from "@phosphor-icons/react";
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
import { ContentWorkspace } from "./ContentWorkspace";
import { ProductionSettings } from "./ProductionSettings";
import { QualityReferenceSettings } from "./QualityReferenceSettings";
import { MediaPreview } from "./MediaPreview";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { CreateProjectForm } from "./CreateProjectForm";

type Member = Schema<"Membership">;
type Project = Schema<"Project">;
type Production = Schema<"Production">;
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
  scriptView,
}: {
  tenantId: string;
  own: Member;
  members: Member[];
  projectId?: string | undefined;
  contentView?: boolean | undefined;
  scriptView?: boolean | undefined;
}) {
  const manager = own.role === "owner" || own.role === "admin";
  const [creating, setCreating] = useState(false),
    [search, setSearch] = useState("");
  const projects = useList<Project>(`${tenantPath(tenantId)}/projects`);
  useEffect(() => {
    if (!projectId) document.title = "项目 · 幕序 SceneDesk";
  }, [projectId]);
  if (projectId && (contentView || scriptView))
    return (
      <ContentWorkspace
        key={projectId}
        tenantId={tenantId}
        projectId={projectId}
        own={own}
        members={members}
        view={scriptView ? "script" : "scenes"}
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
  const visibleProjects =
    projects.data?.filter((p) =>
      p.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
    ) ?? [];
  return (
    <>
      <SectionHeading
        title="项目"
        description="从一个项目开始组织创作。"
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
      <TextInput
        label="查找项目"
        placeholder="输入项目名称"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        className={classes.projectSearch}
        leftSection={<MagnifyingGlass size={16} />}
      />
      <ErrorNotice
        error={projects.error}
        retry={() => void projects.refetch()}
      />
      {projects.isPending ? (
        <Loader aria-label="正在读取项目" />
      ) : (
        <div className={classes.projectGrid}>
          {visibleProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              tenantId={tenantId}
            />
          ))}
        </div>
      )}
      {!projects.isPending && !projects.isError && !projects.data?.length && (
        <Empty>
          <Text>还没有项目。</Text>
          <Text mt="sm">
            {manager
              ? "创建项目，然后添加剧本、场次与参考素材。"
              : "负责人将你加入项目后，项目会显示在这里。"}
          </Text>
        </Empty>
      )}
      {!projects.isPending &&
        !projects.isError &&
        !!projects.data?.length &&
        !visibleProjects.length && (
          <Empty>
            <Text>没有找到符合“{search}”的项目。</Text>
            <Button mt="md" onClick={() => setSearch("")}>
              清空搜索
            </Button>
          </Empty>
        )}
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
function ProjectCard({
  project,
  tenantId,
}: {
  project: Project;
  tenantId: string;
}) {
  const path = tenantPath(tenantId);
  const covers = useResource<Page<Schema<"Media">>>(
    `${path}/media?scope=project&projectId=${project.id}&kind=image&status=ready&limit=1`,
  );
  const cover = covers.data?.items[0];
  const href = `#/app/t/${tenantId}/p/${project.id}/content`;
  return (
    <article className={classes.projectCard}>
      <Anchor
        component="a"
        href={href}
        className={classes.projectCover}
        aria-label={`进入项目 ${project.name}`}
      >
        {cover ? (
          <MediaPreview media={cover} path={path} thumbnail />
        ) : (
          <div className={classes.projectCoverFallback}>
            <FilmSlate size={36} />
            <Text size="xs">
              {covers.isError ? "项目预览暂不可用" : "尚无项目画面"}
            </Text>
          </div>
        )}
      </Anchor>
      <div className={classes.projectMeta}>
        <Anchor href={href} className={classes.projectTitle}>
          {project.name}
        </Anchor>
        {project.status === "archived" && (
          <Text size="xs" c="dimmed">
            已归档
          </Text>
        )}
      </div>
      <Text size="xs" c="dimmed">
        写实短剧 · {project.spec.width} × {project.spec.height} ·{" "}
        {project.spec.fpsNum}/{project.spec.fpsDen} fps
      </Text>
    </article>
  );
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
    project = useResource<Project>(path),
    production = useResource<Production>(`${path}/production`);
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
    if (project.data) document.title = `${project.data.name} · 项目设定 · 幕序`;
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
        <Button component="a" href={`#/app/t/${tenantId}/p/${projectId}/media`}>
          项目素材
        </Button>
        <Button
          component="a"
          href={`#/app/t/${tenantId}/p/${projectId}/assets`}
        >
          项目资产
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
      <h2 className={classes.subheading}>剧目设定</h2>
      <ErrorNotice
        error={production.error}
        retry={() => void production.refetch()}
      />
      {production.data && (
        <ProductionSettings
          key={production.data.id}
          production={production.data}
          path={`${path}/production`}
          active={active}
        />
      )}
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

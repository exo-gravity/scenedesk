import { useState } from "react";
import {
  Badge,
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
import { useForm } from "@mantine/form";
import { Plus, ArrowLeft, FilmSlate } from "@phosphor-icons/react";
import { useCommand, useList, useResource, type Schema } from "./api";
import {
  Empty,
  ErrorNotice,
  SectionHeading,
  projectPath,
  tenantPath,
  roleName,
} from "./common";
import classes from "./workbench.module.css";
import { ContentWorkspace } from "./ContentWorkspace";

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
  const projects = useList<Project>(`${tenantPath(tenantId)}/projects`);
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
        members={members}
      />
    );
  return (
    <>
      <SectionHeading
        title="工作室项目"
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
        mb="xl"
      />
      <ErrorNotice
        error={projects.error}
        retry={() => void projects.refetch()}
      />
      {projects.isPending ? (
        <Loader aria-label="正在读取项目" />
      ) : (
        <div className={classes.rows}>
          {projects.data
            ?.filter((p) => p.name.includes(search))
            .map((p) => (
              <article key={p.id} className={classes.row}>
                <Group>
                  <FilmSlate size={28} />
                  <div>
                    <Text fw={600} size="lg">
                      {p.name}
                    </Text>
                    <Text c="dimmed" mt="xs">
                      写实短剧 · {p.spec.width} × {p.spec.height} ·{" "}
                      {p.spec.fpsNum}/{p.spec.fpsDen} fps
                    </Text>
                  </div>
                </Group>
                <Group>
                  <Badge>{p.status === "active" ? "进行中" : "已归档"}</Badge>
                  <Button component="a" href={`#/app/t/${tenantId}/p/${p.id}`}>
                    进入项目
                  </Button>
                </Group>
              </article>
            ))}
        </div>
      )}
      {!projects.isPending && !projects.data?.length && (
        <Empty>
          <Text>还没有项目。</Text>
          <Text mt="sm">
            {manager
              ? "创建项目并指定一位负责人。"
              : "负责人将你加入项目后，项目会显示在这里。"}
          </Text>
        </Empty>
      )}
      <Modal
        opened={creating}
        onClose={() => setCreating(false)}
        title="新建短剧项目"
        size="lg"
      >
        <CreateProject
          tenantId={tenantId}
          own={own}
          members={members}
          onCreated={(id) => {
            setCreating(false);
            location.hash = `/app/t/${tenantId}/p/${id}`;
          }}
        />
      </Modal>
    </>
  );
}
function CreateProject({
  tenantId,
  own,
  members,
  onCreated,
}: {
  tenantId: string;
  own: Member;
  members: Member[];
  onCreated: (id: string) => void;
}) {
  const command = useCommand<Project>();
  const form = useForm({
    initialValues: {
      name: "",
      leadMembershipId: own.id,
      format: "portrait",
      rate: "24/1",
      language: "zh-CN",
    },
    validate: {
      name: (v) =>
        v.trim().length && v.length <= 160 ? null : "请输入项目名称。",
    },
  });
  return (
    <form
      className={classes.form}
      onSubmit={form.onSubmit((values) => {
        const [fpsNum, fpsDen] = values.rate.split("/").map(Number);
        command.mutate(
          {
            path: `${tenantPath(tenantId)}/projects`,
            body: {
              name: values.name.trim(),
              leadMembershipId: values.leadMembershipId,
              spec: {
                width: values.format === "portrait" ? 1080 : 1920,
                height: values.format === "portrait" ? 1920 : 1080,
                fpsNum,
                fpsDen,
                language: values.language,
              },
            },
          },
          { onSuccess: (p) => onCreated(p.id) },
        );
      })}
    >
      <TextInput required label="项目名称" {...form.getInputProps("name")} />
      <Select
        label="项目负责人"
        data={members
          .filter((m) => m.status === "active")
          .map((m) => ({ value: m.id, label: m.email ?? m.userId }))}
        {...form.getInputProps("leadMembershipId")}
      />
      <div className={classes.grid}>
        <Select
          label="画幅"
          data={[
            { value: "portrait", label: "竖屏 · 1080 × 1920" },
            { value: "landscape", label: "横屏 · 1920 × 1080" },
          ]}
          {...form.getInputProps("format")}
        />
        <Select label="目标帧率" data={rates} {...form.getInputProps("rate")} />
      </div>
      <TextInput label="语言" required {...form.getInputProps("language")} />
      <ErrorNotice error={command.error} />
      <Button variant="filled" type="submit" loading={command.isPending}>
        创建项目
      </Button>
    </form>
  );
}
function ProjectDetails({
  tenantId,
  projectId,
  own,
  members,
}: {
  tenantId: string;
  projectId: string;
  own: Member;
  members: Member[];
}) {
  const path = projectPath(tenantId, projectId),
    project = useResource<Project>(path),
    production = useResource<Production>(`${path}/production`);
  const participants = useList<Schema<"ProjectMember">>(`${path}/members`);
  const manager = own.role === "owner" || own.role === "admin";
  const lead = participants.data?.some(
    (m) => m.membershipId === own.id && m.role === "lead",
  );
  const [action, setAction] = useState<"archive" | "restore" | "lead" | null>(
      null,
    ),
    [nextMember, setNextMember] = useState<string | null>(null);
  const command = useCommand<Project>(),
    memberCommand = useCommand<Schema<"ProjectMember">>();
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
        description={active ? "项目设定与参与成员" : "项目已归档，内容只读。"}
        action={
          (manager || lead) && (
            <Button onClick={() => setAction(active ? "archive" : "restore")}>
              {active ? "归档项目" : "恢复项目"}
            </Button>
          )
        }
      />
      <Button
        component="a"
        href={`#/app/t/${tenantId}/p/${projectId}/content`}
        leftSection={<FilmSlate size={18} />}
        variant="filled"
        mb="xl"
      >
        进入剧本与集场镜
      </Button>
      <Button
        component="a"
        href={`#/app/t/${tenantId}/p/${projectId}/media`}
        mb="xl"
        ml="md"
      >
        项目素材
      </Button>
      <Button
        component="a"
        href={`#/app/t/${tenantId}/p/${projectId}/assets`}
        mb="lg"
      >
        项目资产
      </Button>
      {manager || lead ? (
        <ProjectSettings key={p.id} project={p} path={path} active={active} />
      ) : (
        <Text c="dimmed">
          {p.spec.width} × {p.spec.height} · {p.spec.fpsNum}/{p.spec.fpsDen} fps
        </Text>
      )}
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
      <hr className={classes.divider} />
      <SectionHeading
        title="项目成员"
        level={2}
        description="工作室所有者与管理员可以管理全部项目。"
        action={
          manager &&
          active && (
            <Button
              onClick={() => {
                setNextMember(p.leadMembershipId);
                setAction("lead");
              }}
            >
              交接负责人
            </Button>
          )
        }
      />
      <ErrorNotice error={participants.error} />
      <ErrorNotice error={memberCommand.error} />
      <div className={classes.rows}>
        {participants.data?.map((member) => (
          <div key={member.id} className={classes.row}>
            <div>
              <Text fw={500}>
                {members.find((m) => m.id === member.membershipId)?.email ??
                  member.membershipId}
              </Text>
              <Text c="dimmed">{roleName[member.role]}</Text>
            </div>
            {(manager || lead) && active && member.role === "collaborator" && (
              <Button
                onClick={() =>
                  memberCommand.mutate({
                    path: `${path}/members/${member.membershipId}`,
                    method: "DELETE",
                    version: member.revision,
                  })
                }
              >
                移出项目
              </Button>
            )}
          </div>
        ))}
      </div>
      {(manager || lead) && active && (
        <Group mt="xl" align="flex-end">
          <Select
            label="添加协作者"
            placeholder="选择工作室成员"
            value={nextMember}
            onChange={setNextMember}
            data={members
              .filter(
                (m) =>
                  m.status === "active" &&
                  !participants.data?.some((p) => p.membershipId === m.id),
              )
              .map((m) => ({ value: m.id, label: m.email ?? m.userId }))}
          />
          <Button
            disabled={!nextMember}
            loading={memberCommand.isPending}
            onClick={() =>
              memberCommand.mutate(
                { path: `${path}/members`, body: { membershipId: nextMember } },
                { onSuccess: () => setNextMember(null) },
              )
            }
          >
            添加到项目
          </Button>
        </Group>
      )}
      <Modal
        opened={action !== null}
        onClose={() => {
          if (!command.isPending) {
            setAction(null);
            command.reset();
          }
        }}
        title={
          action === "lead"
            ? "交接项目负责人"
            : action === "archive"
              ? "归档项目"
              : "恢复项目"
        }
      >
        <Stack>
          <Text>
            {action === "lead"
              ? "原负责人保留协作者身份。新负责人可组织项目与成员。"
              : action === "archive"
                ? "归档后项目内容只读，可以随时恢复。"
                : "恢复后可继续编辑项目。"}
          </Text>
          {action === "lead" && (
            <Select
              label="新负责人"
              value={nextMember}
              onChange={setNextMember}
              data={members
                .filter((m) => m.status === "active")
                .map((m) => ({ value: m.id, label: m.email ?? m.userId }))}
            />
          )}
          <ErrorNotice error={command.error} />
          <Button
            variant="filled"
            loading={command.isPending}
            disabled={action === "lead" && !nextMember}
            onClick={() =>
              command.mutate(
                {
                  path: `${path}/${action}`,
                  version: p.revision,
                  ...(action === "lead"
                    ? { body: { membershipId: nextMember } }
                    : {}),
                },
                { onSuccess: () => setAction(null) },
              )
            }
          >
            确认
            {action === "lead"
              ? "交接"
              : action === "archive"
                ? "归档"
                : "恢复"}
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
function ProductionSettings({
  production,
  path,
  active,
}: {
  production: Production;
  path: string;
  active: boolean;
}) {
  const command = useCommand<Production>(),
    [base, setBase] = useState(production);
  const form = useForm({
    initialValues: { title: production.title, brief: production.brief },
    validate: { title: (v) => (v.trim() ? null : "请输入剧目名称。") },
  });
  return (
    <form
      className={classes.form}
      onSubmit={form.onSubmit((v) =>
        command.mutate(
          {
            path,
            method: "PUT",
            version: base.revision,
            body: {
              ...v,
              defaultAssetRevisionIds: base.defaultAssetRevisionIds,
            },
          },
          {
            onSuccess: (p) => {
              setBase(p);
              form.setInitialValues({ title: p.title, brief: p.brief });
            },
          },
        ),
      )}
    >
      <TextInput
        label="剧目名称"
        maxLength={160}
        readOnly={!active}
        {...form.getInputProps("title")}
      />
      <Textarea
        label="故事与创作设定"
        minRows={5}
        maxLength={20000}
        readOnly={!active}
        {...form.getInputProps("brief")}
      />
      {active && production.revision !== base.revision && (
        <div>
          <Text>
            服务器已有版本 {production.revision}。当前编辑内容仍然保留。
          </Text>
          <Text c="dimmed">
            {production.title} · {production.brief}
          </Text>
          <Button variant="subtle" onClick={() => setBase(production)}>
            核对后使用最新版本作为保存基线
          </Button>
        </div>
      )}
      <ErrorNotice error={command.error} />
      {command.isSuccess && !form.isDirty() && (
        <Text role="status">剧目设定已保存。</Text>
      )}
      {active && (
        <Button type="submit" variant="filled" loading={command.isPending}>
          保存剧目设定
        </Button>
      )}
    </form>
  );
}

import { lazy, Suspense, useEffect, useState, useRef } from "react";
import {
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Plus,
  SignOut,
  Buildings,
  FolderSimple,
  Users,
  Images,
} from "@phosphor-icons/react";
import {
  api,
  ApiError,
  SessionContext,
  useCommand,
  useList,
  useSession,
  type Schema,
  type Session,
} from "./api";
import { ErrorNotice, SectionHeading, Empty, tenantPath } from "./common";
import { Projects } from "./Projects";
import { Members } from "./Members";
const MediaWorkspace = lazy(() => import("./MediaWorkspace"));
import classes from "./workbench.module.css";
import {
  invitationFromFragment,
  loginReturnPath,
  pendingInvitationKey,
} from "./invitation";

export default function BusinessApp({ hash }: { hash: string }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            retry: (count, error) =>
              count < 1 &&
              (!(error instanceof ApiError) ||
                error.status === 0 ||
                error.status >= 500),
          },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <AuthenticatedApp hash={hash} />
    </QueryClientProvider>
  );
}
function AuthenticatedApp({ hash }: { hash: string }) {
  const shell = useRef<HTMLDivElement>(null);
  useEffect(() => {
    shell.current?.scrollTo({ top: 0, left: 0 });
  }, [hash]);
  useEffect(() => {
    const token = invitationFromFragment(hash);
    if (token)
      try {
        sessionStorage.setItem(pendingInvitationKey, token);
      } catch {
        /* The original link can be reopened after login. */
      }
  }, [hash]);
  const session = useQuery({
    queryKey: ["session"],
    queryFn: ({ signal }) => api<Session>("/v1/session", { signal }),
    staleTime: 0,
  });
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () =>
      api<{ phase: string; identityMode?: string }>("/health/live"),
  });
  useEffect(() => {
    document.title = "工作室 · 幕序 SceneDesk";
  }, []);
  return (
    <div className={classes.shell} ref={shell}>
      <header className={classes.header}>
        <Anchor href="#/app" className={classes.brand}>
          幕序{" "}
          <Text span c="dimmed">
            SceneDesk
          </Text>
        </Anchor>
        <Group gap="sm">
          <Badge>导入素材模式</Badge>
          {health.data?.identityMode === "local_test" && (
            <Badge>本地测试身份</Badge>
          )}
        </Group>
      </header>
      {session.isPending ? (
        <div className={classes.welcome}>
          <Loader aria-label="正在读取会话" />
        </div>
      ) : session.isError ? (
        <div className={classes.welcome}>
          <Stack gap="xl">
            <SectionHeading
              title="进入你的工作室"
              description="从项目与团队开始，把每一场戏落到实处。"
            />
            {session.error instanceof ApiError &&
            session.error.status === 401 ? (
              <Button
                component="a"
                variant="filled"
                size="md"
                href={`/v1/auth/login?returnTo=${encodeURIComponent(loginReturnPath(hash))}`}
              >
                登录并继续
              </Button>
            ) : (
              <ErrorNotice
                error={session.error}
                retry={() => void session.refetch()}
              />
            )}
            {health.data?.phase === "s0" && (
              <Text c="dimmed">
                本地业务服务尚未启动。请运行项目的业务启动命令后重试。
              </Text>
            )}
            <Anchor href="#/journey/?variant=recommendation&screen=production&mode=storyboard&tone=light&assistant=off">
              查看已确认的场次设计
            </Anchor>
          </Stack>
        </div>
      ) : (
        <SessionContext.Provider value={session.data}>
          <Workspace hash={hash} />
        </SessionContext.Provider>
      )}
    </div>
  );
}
function Workspace({ hash }: { hash: string }) {
  const session = useSession(),
    cache = useQueryClient(),
    logout = useCommand<void>();
  const tenants = useList<Schema<"Tenant">>("/v1/tenants");
  const segments = hash.split("?")[0]!.split("/");
  const tenantId = segments[2] === "t" ? segments[3] : undefined;
  const [createStudio, setCreateStudio] = useState(false);
  if (hash.startsWith("#/invitation")) return <Invitation hash={hash} />;
  return (
    <>
      <div className={classes.layout}>
        <aside className={classes.sidebar} aria-label="工作室导航">
          <Select
            label="当前工作室"
            placeholder="选择工作室"
            value={tenantId ?? null}
            data={(tenants.data ?? []).map((t) => ({
              value: t.id,
              label: t.name,
            }))}
            onChange={(id) => {
              if (id) location.hash = `/app/t/${id}`;
            }}
          />
          <Button
            leftSection={<FolderSimple size={18} />}
            variant="subtle"
            component="a"
            href={tenantId ? `#/app/t/${tenantId}` : "#/app"}
          >
            项目
          </Button>
          {tenantId && (
            <Button
              leftSection={<Images size={18} />}
              variant="subtle"
              component="a"
              href={`#/app/t/${tenantId}/media`}
            >
              共享素材
            </Button>
          )}
          {tenantId && (
            <Button
              leftSection={<Users size={18} />}
              variant="subtle"
              component="a"
              href={`#/app/t/${tenantId}/members`}
            >
              成员与设置
            </Button>
          )}
          <Button
            leftSection={<Plus size={18} />}
            variant="subtle"
            onClick={() => setCreateStudio(true)}
          >
            新建工作室
          </Button>
          <Text size="xs" c="dimmed" mt="xl">
            {session.email}
          </Text>
          <Button
            leftSection={<SignOut size={18} />}
            variant="subtle"
            loading={logout.isPending}
            onClick={() =>
              logout.mutate(
                { path: "/v1/session/logout" },
                {
                  onSuccess: () => {
                    cache.clear();
                    location.hash = "/app";
                    location.reload();
                  },
                },
              )
            }
          >
            退出登录
          </Button>
          <ErrorNotice error={logout.error} />
        </aside>
        <main className={classes.main}>
          <ErrorNotice
            error={tenants.error}
            retry={() => void tenants.refetch()}
          />
          {tenants.isPending ? (
            <Loader aria-label="正在读取工作室" />
          ) : createStudio || !tenantId ? (
            <>
              <SectionHeading
                title="你的工作室"
                description="项目、制作成员和素材各自归属于一个工作室。"
              />
              {!createStudio && !!tenants.data?.length && (
                <div className={classes.rows}>
                  {tenants.data.map((t) => (
                    <div key={t.id} className={classes.row}>
                      <Group>
                        <Buildings size={24} />
                        <Text fw={600}>{t.name}</Text>
                      </Group>
                      <Button component="a" href={`#/app/t/${t.id}`}>
                        进入工作室
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {(createStudio || !tenants.data?.length) && (
                <CreateTenant
                  onCreated={(id) => {
                    setCreateStudio(false);
                    location.hash = `/app/t/${id}`;
                  }}
                  onCancel={
                    tenants.data?.length
                      ? () => setCreateStudio(false)
                      : undefined
                  }
                />
              )}
            </>
          ) : (
            <TenantArea
              key={tenantId}
              tenantId={tenantId}
              section={segments[4]}
              projectId={segments[4] === "p" ? segments[5] : undefined}
              contentView={segments[6] === "content"}
              mediaView={segments[6] === "media"}
            />
          )}
        </main>
      </div>
    </>
  );
}
function TenantArea({
  tenantId,
  section,
  projectId,
  contentView,
  mediaView,
}: {
  tenantId: string;
  section?: string | undefined;
  projectId?: string | undefined;
  contentView?: boolean | undefined;
  mediaView?: boolean | undefined;
}) {
  const session = useSession();
  const members = useList<Schema<"Membership">>(
    `${tenantPath(tenantId)}/members`,
  );
  const own = members.data?.find((m) => m.userId === session.userId);
  if (members.isPending) return <Loader aria-label="正在读取权限" />;
  if (members.isError)
    return (
      <ErrorNotice error={members.error} retry={() => void members.refetch()} />
    );
  if (!own || own.status !== "active")
    return <Empty>你已没有这个工作室的访问权限。</Empty>;
  if (section === "media" || (projectId && mediaView))
    return (
      <Suspense fallback={<Loader aria-label="正在加载素材工作区" />}>
        <MediaWorkspace tenantId={tenantId} own={own} projectId={projectId} />
      </Suspense>
    );
  return section === "members" ? (
    <Members tenantId={tenantId} own={own} members={members.data} />
  ) : (
    <Projects
      tenantId={tenantId}
      own={own}
      members={members.data}
      projectId={projectId}
      contentView={contentView}
    />
  );
}
function CreateTenant({
  onCreated,
  onCancel,
}: {
  onCreated: (id: string) => void;
  onCancel?: (() => void) | undefined;
}) {
  const create = useCommand<Schema<"Tenant">>();
  const form = useForm({
    initialValues: { name: "", currency: "CNY" },
    validate: {
      name: (v) =>
        v.trim().length > 0 && v.length <= 160
          ? null
          : "请输入 1–160 字的工作室名称。",
    },
  });
  return (
    <form
      className={classes.form}
      onSubmit={form.onSubmit((values) =>
        create.mutate(
          {
            path: "/v1/tenants",
            body: { ...values, name: values.name.trim() },
          },
          { onSuccess: (result) => onCreated(result.id) },
        ),
      )}
    >
      <TextInput required label="工作室名称" {...form.getInputProps("name")} />
      <Select
        label="记账币种"
        data={[
          { value: "CNY", label: "人民币 CNY" },
          { value: "USD", label: "美元 USD" },
        ]}
        {...form.getInputProps("currency")}
      />
      <Text c="dimmed">
        创建后你将成为工作室所有者，可以邀请成员、分配项目负责人。
      </Text>
      <ErrorNotice error={create.error} />
      <Group>
        <Button type="submit" variant="filled" loading={create.isPending}>
          创建工作室
        </Button>
        {onCancel && <Button onClick={onCancel}>返回</Button>}
      </Group>
    </form>
  );
}
function Invitation({ hash }: { hash: string }) {
  const session = useSession(),
    accept = useCommand<Schema<"Membership">>();
  const [token] = useState(() => {
    const direct = invitationFromFragment(hash);
    try {
      return direct ?? sessionStorage.getItem(pendingInvitationKey);
    } catch {
      return direct;
    }
  });
  return (
    <main className={classes.welcome}>
      <Stack>
        <SectionHeading
          title="加入工作室"
          description={`以 ${session.email} 接受邀请。邮箱必须与邀请一致。`}
        />
        <ErrorNotice error={accept.error} />
        {!token && <Text>请重新打开原邀请链接，再接受邀请。</Text>}
        {accept.isSuccess ? (
          <>
            <Text>已加入工作室。</Text>
            <Button component="a" href="#/app" variant="filled">
              查看工作室
            </Button>
          </>
        ) : (
          <Button
            disabled={!token}
            loading={accept.isPending}
            variant="filled"
            onClick={() =>
              accept.mutate(
                { path: "/v1/invitations/accept", body: { token } },
                {
                  onSuccess: () => {
                    try {
                      sessionStorage.removeItem(pendingInvitationKey);
                    } catch {
                      /* No persisted copy was available. */
                    }
                    history.replaceState(null, "", "/#/invitation");
                  },
                },
              )
            }
          >
            接受邀请
          </Button>
        )}
      </Stack>
    </main>
  );
}

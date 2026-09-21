import {
  ProjectNavigationGuard,
  useProjectNavigationGuard,
} from "./project-navigation-guard";
import {
  type ReactNode,
  lazy,
  Suspense,
  useEffect,
  useState,
  useRef,
  useCallback,
} from "react";
import {
  Anchor,
  ActionIcon,
  Menu,
  Tooltip,
  UnstyledButton,
  useMantineColorScheme,
  useComputedColorScheme,
  Button,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  SignOut,
  Buildings,
  FolderSimple,
  Archive,
  CheckSquare,
  CaretRight,
  Moon,
  Sun,
  UserCircle,
} from "@phosphor-icons/react";
import {
  api,
  ApiError,
  SessionContext,
  useCommand,
  useList,
  useResource,
  useSession,
  type Schema,
  type Session,
} from "./api";
import {
  ErrorNotice,
  SectionHeading,
  Empty,
  tenantPath,
  projectPath,
} from "./common";
import { Projects } from "./Projects";
import { ProjectNavigation, projectSections } from "./ProjectNavigation";
const ProjectCanvasEntry = lazy(() => import("./ProjectCanvasEntry"));
const StudioEntry = lazy(() => import("../studio/StudioEntry"));
import {
  clearUserEditing,
  suspendEditingAccess,
  refreshEditingAccess,
  retireEditingSession,
} from "./use-cut-work";
import { notifyEditingAccess, subscribeEditingAccess } from "./editing-access";
import "./assistant-lifecycle";
const MyWork = lazy(() => import("./MyWork"));
const AssetLibrary = lazy(() => import("./AssetLibrary"));
const SceneProductionWorkspace = lazy(
  () => import("./SceneProductionWorkspace"),
);
import classes from "./workbench.module.css";
import { ProjectUpdates } from "./ProjectUpdates";
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
      <ProjectNavigationGuard>
        <AuthenticatedApp hash={hash} />
      </ProjectNavigationGuard>
    </QueryClientProvider>
  );
}
function AuthenticatedApp({ hash }: { hash: string }) {
  const shell = useRef<HTMLDivElement>(null);
  const { setColorScheme } = useMantineColorScheme();
  const colorScheme = useComputedColorScheme("light");
  const previousSession = useRef<{ id: string; userId: string } | undefined>(
    undefined,
  );
  const cache = useQueryClient();
  const [checkingSession, setCheckingSession] = useState(false);
  const [editingCleanupError, setEditingCleanupError] = useState<Error | null>(
    null,
  );
  const cleanupRetry = useRef<(() => Promise<void>) | null>(null);
  const runEditingCleanup = useCallback(
    async (operation: () => Promise<void>) => {
      try {
        await operation();
        if (cleanupRetry.current === operation) {
          cleanupRetry.current = null;
          setEditingCleanupError(null);
        }
      } catch (reason) {
        cleanupRetry.current = operation;
        setEditingCleanupError(
          reason instanceof Error
            ? reason
            : new Error("本机编辑恢复清理未完成。"),
        );
      }
    },
    [],
  );
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
  const currentSession = useRef(session);
  currentSession.current = session;
  useEffect(() => {
    let live = true,
      generation = 0;
    const unsubscribe = subscribeEditingAccess((hint) => {
      const current = currentSession.current.data;
      if (
        !current ||
        current.userId !== hint.userId ||
        current.id !== hint.sessionId
      )
        return;
      suspendEditingAccess(hint);
      if (hint.kind !== "session") {
        void refreshEditingAccess(hint);
        return;
      }
      const ticket = ++generation;
      setCheckingSession(true);
      void (async () => {
        try {
          const result = await currentSession.current.refetch();
          if (!live || ticket !== generation || result.isError || !result.data)
            return;
          if (
            result.data.id === hint.sessionId &&
            result.data.userId === hint.userId
          )
            await refreshEditingAccess(hint);
          else await retireEditingSession(hint);
        } catch (reason) {
          if (live && ticket === generation)
            setEditingCleanupError(
              reason instanceof Error
                ? reason
                : new Error("会话核对暂未完成。"),
            );
        } finally {
          if (live && ticket === generation) setCheckingSession(false);
        }
      })();
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () =>
      api<{ phase: string; identityMode?: string; providerMode?: string }>(
        "/health/live",
      ),
  });
  useEffect(() => {
    const prior = previousSession.current;
    if (session.data && !session.isError) {
      previousSession.current = {
        id: session.data.id,
        userId: session.data.userId,
      };
      if (prior && prior.id !== session.data.id) {
        const cleanup = () =>
          prior.userId === session.data.userId
            ? retireEditingSession({
                kind: "session",
                sessionId: prior.id,
                userId: prior.userId,
              })
            : clearUserEditing(prior.userId, prior.id);
        cache.removeQueries({ queryKey: ["user", prior.userId] });
        cache.removeQueries({ queryKey: ["media-access", prior.userId] });
        void runEditingCleanup(cleanup);
      }
    }
    if (
      session.error instanceof ApiError &&
      session.error.status === 401 &&
      prior
    ) {
      previousSession.current = undefined;
      notifyEditingAccess({
        kind: "session",
        sessionId: prior.id,
        userId: prior.userId,
      });
      cache.removeQueries({ queryKey: ["user", prior.userId] });
      cache.removeQueries({ queryKey: ["media-access", prior.userId] });
      void runEditingCleanup(() => clearUserEditing(prior.userId, prior.id));
    }
  }, [session.data, session.error, session.isError, cache, runEditingCleanup]);
  useEffect(() => {
    document.title = "创作工作台 · SceneDesk";
  }, []);
  return (
    <div
      className={classes.shell}
      ref={shell}
      data-project-workspace={
        (!!session.data &&
          !session.isError &&
          /^#\/app\/t\/[^/]+\/p\/[^/?]+(?:[/?]|$)/.test(hash) &&
          !hash.split("?")[0]?.endsWith("/production")) ||
        undefined
      }
      data-scene-production={
        (session.data &&
          !session.isError &&
          hash.split("?")[0]?.endsWith("/production") &&
          new URLSearchParams(hash.split("?")[1]).has("scene")) ||
        undefined
      }
    >
      <ErrorNotice
        error={editingCleanupError}
        retryLabel="重试清理本机恢复"
        {...(cleanupRetry.current
          ? {
              retry: () => {
                const operation = cleanupRetry.current;
                if (operation) void runEditingCleanup(operation);
              },
            }
          : {})}
      />
      {session.isError && (
        <header className={classes.header}>
          <Anchor href="#/app" className={classes.brand}>
            SceneDesk
          </Anchor>
          <Group gap="lg" wrap="nowrap" className={classes.headerStatus}>
            {health.data?.providerMode === "mock" && (
              <Text size="xs" c="dimmed">
                未连接真实模型
              </Text>
            )}
            {health.data?.identityMode === "local_test" && (
              <Text size="xs" c="dimmed">
                本地测试身份
              </Text>
            )}
            <Tooltip label={colorScheme === "light" ? "切换深色" : "切换浅色"}>
              <ActionIcon
                variant="subtle"
                size="xs"
                aria-label={colorScheme === "light" ? "切换深色" : "切换浅色"}
                onClick={() =>
                  setColorScheme(colorScheme === "light" ? "dark" : "light")
                }
              >
                {colorScheme === "light" ? <Moon size={16} /> : <Sun size={16} />}
              </ActionIcon>
            </Tooltip>
          </Group>
        </header>
      )}
      {session.isPending || checkingSession ? (
        <div className={classes.welcome}>
          <Loader aria-label="正在读取会话" />
        </div>
      ) : session.isError ? (
        <div className={classes.welcome}>
          <Stack gap="xl">
            <SectionHeading
              title="进入创作工作台"
              description="整理剧本与参考，在画布中创作，再将选用的镜头交付后期。"
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
            <Text size="sm" c="dimmed">
              当前为私有工作台，仅对已开通访问的账号开放。
            </Text>
          </Stack>
        </div>
      ) : (
        <SessionContext.Provider value={session.data}>
          <Workspace
            key={session.data.id}
            hash={hash}
            environment={[
              health.data?.providerMode === "mock" ? "未连接真实模型" : "",
              health.data?.identityMode === "local_test" ? "本地测试身份" : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        </SessionContext.Provider>
      )}
    </div>
  );
}
function Workspace({
  hash,
  environment,
}: {
  hash: string;
  environment: string;
}) {
  const { setColorScheme } = useMantineColorScheme();
  const colorScheme = useComputedColorScheme("light");
  const session = useSession(),
    cache = useQueryClient(),
    logout = useCommand<void>();
  const navigationGuard = useProjectNavigationGuard();
  const tenants = useList<Schema<"Tenant">>("/v1/tenants");
  const segments = hash.split("?")[0]!.split("/");
  const tenantId = segments[2] === "t" ? segments[3] : undefined;
  const projectId = segments[4] === "p" ? segments[5] : undefined;
  const production = !!projectId && segments[6] === "production";
  const projectSection = segments[6];
  const studioView = !!projectId && projectSection === "studio";
  const assetDetail =
    (projectSection === "assets" || (!projectId && segments[4] === "assets")) &&
    new URLSearchParams(hash.split("?")[1]).has("asset");
  const params = new URLSearchParams(hash.split("?")[1]);
  const scriptEditing =
    !!projectId &&
    (projectSection === "script" ||
      (projectSection === "content" &&
        params.has("revision") &&
        !params.has("shot")));
  const projectDirectory = !!projectId && (!production || params.has("scene"));
  const section = projectId ? "projects" : (segments[4] ?? "projects");
  const studio = tenants.data?.find((tenant) => tenant.id === tenantId);
  const detailObject = params.get("asset") ?? params.get("media");
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
  }, [
    tenantId,
    projectId,
    projectSection,
    section,
    detailObject,
    scriptEditing,
  ]);
  useEffect(() => {
    if (
      !tenantId &&
      !tenants.isError &&
      tenants.data?.length === 1 &&
      !hash.startsWith("#/invitation")
    ) {
      location.replace(`#/app/t/${tenants.data[0]!.id}`);
    }
  }, [tenantId, tenants.data, tenants.isError, hash]);
  const [logoutCommitted, setLogoutCommitted] = useState(false),
    [cleanupError, setCleanupError] = useState<Error | null>(null);
  const finishLogout = async () => {
    if (!logoutCommitted)
      notifyEditingAccess({
        kind: "session",
        sessionId: session.id,
        userId: session.userId,
      });
    setLogoutCommitted(true);
    setCleanupError(null);
    try {
      await clearUserEditing(session.userId, session.id);
      cache.clear();
      location.hash = "/app";
      location.reload();
    } catch (reason) {
      setCleanupError(
        reason instanceof Error ? reason : new Error("本机恢复清理未完成。"),
      );
    }
  };
  const accountMenu = (
    <Menu position="right-end" width={260}>
      <Menu.Target>
        <ActionIcon variant="subtle" aria-label="账号与退出登录">
          <UserCircle size={24} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{session.email}</Menu.Label>
        {environment && <Menu.Label>{environment}</Menu.Label>}
        <Menu.Item
          leftSection={
            colorScheme === "light" ? <Moon size={16} /> : <Sun size={16} />
          }
          onClick={() =>
            setColorScheme(colorScheme === "light" ? "dark" : "light")
          }
        >
          {colorScheme === "light" ? "切换深色" : "切换浅色"}
        </Menu.Item>
        <Menu.Item
          leftSection={<SignOut size={16} />}
          disabled={logout.isPending}
          onClick={() =>
            logout.mutate(
              { path: "/v1/session/logout" },
              { onCommitted: () => void finishLogout() },
            )
          }
        >
          退出登录
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
  if (logoutCommitted)
    return (
      <Stack>
        <Text>已退出登录，正在清理本机编辑恢复。</Text>
        <ErrorNotice
          error={cleanupError}
          retry={() => void finishLogout()}
          retryLabel="重试清理本机恢复"
        />
      </Stack>
    );
  if (hash.startsWith("#/invitation")) return <Invitation hash={hash} />;
  // In-app links go through the active workspace's leave guard, which
  // retains drafts before the address changes.
  const guardLinkClick = (event: React.MouseEvent) => {
    if (
      !navigationGuard.current ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const anchor = (event.target as Element).closest<HTMLAnchorElement>(
      'a[href^="#"]',
    );
    const destination = anchor?.getAttribute("href");
    if (
      !destination ||
      anchor?.target === "_blank" ||
      destination === location.hash
    )
      return;
    event.preventDefault();
    void navigationGuard.current(destination).catch(() => {});
  };
  // The rebuilt creative workspace owns the whole viewport: no studio rail,
  // context header or project navigation (see docs/design/creative-workspace-rebuild-libtv-2026-09-21.md §4).
  if (tenantId && projectId && studioView)
    return (
      <div className={classes.studioHost} onClickCapture={guardLinkClick}>
        <ProjectUpdates tenantId={tenantId} projectId={projectId}>
          <TenantArea
            key={tenantId}
            tenantId={tenantId}
            projectId={projectId}
            projectSection={projectSection}
            studioView
            studioSubview={segments[7]}
            environment={environment}
            account={accountMenu}
          />
        </ProjectUpdates>
      </div>
    );
  return (
    <>
      <div
        className={classes.layout}
        data-project-canvas={
          projectSection === "canvas" ||
          (production && params.has("scene")) ||
          undefined
        }
        onClickCapture={guardLinkClick}
        data-production={production || undefined}
        data-scene-production={(production && params.has("scene")) || undefined}
        data-project={projectDirectory || undefined}
      >
        <nav className={classes.sidebar} aria-label="工作室导航">
          <Menu position="right-start" width={240}>
            <Menu.Target>
              <UnstyledButton
                className={classes.studioSwitch}
                aria-label="切换工作室"
                title={studio?.name ?? "选择工作室"}
              >
                <Buildings size={25} />
                <span>{studio?.name ?? "工作室"}</span>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>当前工作室</Menu.Label>
              {(tenants.data ?? []).map((tenant) => (
                <Menu.Item
                  key={tenant.id}
                  component="a"
                  href={`#/app/t/${tenant.id}`}
                  leftSection={<Buildings size={16} />}
                >
                  {tenant.name}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
          <UnstyledButton
            component="a"
            className={classes.railItem}
            data-active={section === "projects" || undefined}
            aria-current={section === "projects" ? "page" : undefined}
            href={tenantId ? `#/app/t/${tenantId}` : "#/app"}
          >
            <FolderSimple size={22} />
            <span>项目</span>
          </UnstyledButton>
          {tenantId && (
            <>
              <UnstyledButton
                component="a"
                className={classes.railItem}
                data-active={section === "work" || undefined}
                aria-current={section === "work" ? "page" : undefined}
                href={`#/app/t/${tenantId}/work`}
              >
                <CheckSquare size={22} />
                <span>我的工作</span>
              </UnstyledButton>
              <UnstyledButton
                component="a"
                className={classes.railItem}
                data-active={["assets", "media"].includes(section) || undefined}
                aria-current={
                  ["assets", "media"].includes(section) ? "page" : undefined
                }
                href={`#/app/t/${tenantId}/assets`}
              >
                <Archive size={22} />
                <span>资产库</span>
              </UnstyledButton>
            </>
          )}
          <div className={classes.railFooter}>{accountMenu}</div>
        </nav>
        {!production && projectSection !== "canvas" && (
          <WorkspaceContext
            tenantId={tenantId}
            projectId={projectId}
            section={projectSection}
            studioName={studio?.name}
            studioSection={section}
          />
        )}
        {tenantId && projectId && projectDirectory && (
          <ProjectNavigation
            tenantId={tenantId}
            projectId={projectId}
            section={projectSection}
            scriptView={scriptEditing}
            footer={accountMenu}
            environment={environment}
          />
        )}
        <section className={classes.content}>
          <main
            className={classes.main}
            data-asset-detail={assetDetail || undefined}
            data-script-editor={scriptEditing || undefined}
            ref={main}
            id="workspace-content"
            tabIndex={-1}
          >
            <ErrorNotice error={logout.error} />
            <ErrorNotice
              error={tenants.error}
              retry={() => void tenants.refetch()}
            />
            {tenants.isPending ? (
              <Loader aria-label="正在读取工作室" />
            ) : tenants.isError ? null : !tenantId ? (
              <>
                <SectionHeading
                  title="选择创作空间"
                  description="进入已为你开通的工作室，继续项目创作。"
                />
                {tenants.data?.length ? (
                  <div className={classes.rows}>
                    {tenants.data.map((t) => (
                      <article key={t.id} className={classes.row}>
                        <Group>
                          <Buildings size={24} />
                          <Text fw={600}>{t.name}</Text>
                        </Group>
                        <Button component="a" href={`#/app/t/${t.id}`}>
                          查看项目
                        </Button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <Empty>
                    <Text>你的账号尚未开通创作空间。</Text>
                    <Text mt="sm">
                      请联系工作台负责人配置访问；开通后刷新即可进入项目。
                    </Text>
                    <Button mt="lg" onClick={() => void tenants.refetch()}>
                      刷新访问
                    </Button>
                  </Empty>
                )}
              </>
            ) : (
              <ProjectUpdates
                tenantId={tenantId}
                projectId={segments[4] === "p" ? segments[5] : undefined}
              >
                <TenantArea
                  key={tenantId}
                  tenantId={tenantId}
                  section={segments[4]}
                  projectId={segments[4] === "p" ? segments[5] : undefined}
                  contentView={segments[6] === "content"}
                  scriptView={segments[6] === "script"}
                  mediaView={segments[6] === "media"}
                  assetView={segments[6] === "assets"}
                  productionView={segments[6] === "production"}
                  projectSection={segments[6]}
                />
              </ProjectUpdates>
            )}
          </main>
        </section>
      </div>
    </>
  );
}
function WorkspaceContext({
  tenantId,
  projectId,
  section,
  studioName,
  studioSection,
}: {
  tenantId: string | undefined;
  projectId: string | undefined;
  section: string | undefined;
  studioName: string | undefined;
  studioSection: string;
}) {
  const project = useResource<Schema<"Project">>(
    tenantId && projectId ? projectPath(tenantId, projectId) : "",
    !!tenantId && !!projectId,
  );
  const title = projectId
    ? (projectSections.find((item) => item.id === section)?.label ??
      (section === "media"
        ? "项目资产"
        : section === "content"
          ? "场次目录"
          : "项目设置"))
    : ({
        projects: "项目",
        work: "我的工作",
        assets: "资产库",
        media: "资产库",
      }[studioSection] ?? "工作室");
  return (
    <header className={classes.contextHeader}>
      <nav className={classes.breadcrumb} aria-label="当前位置">
        <Anchor href={tenantId ? `#/app/t/${tenantId}` : "#/app"}>
          {studioName ?? "工作室"}
        </Anchor>
        <CaretRight size={14} />
        {projectId && (
          <>
            <Anchor href={`#/app/t/${tenantId}/p/${projectId}/script`}>
              {project.isError
                ? "项目不可访问"
                : (project.data?.name ?? "项目")}
            </Anchor>
            <CaretRight size={14} />
          </>
        )}
        {projectId && section === "content" && (
          <>
            <Anchor href={`#/app/t/${tenantId}/p/${projectId}/canvas`}>
              画布
            </Anchor>
            <CaretRight size={14} />
          </>
        )}
        <Text size="sm">{title}</Text>
      </nav>
    </header>
  );
}
function TenantArea({
  tenantId,
  section,
  projectId,
  contentView,
  scriptView,
  mediaView,
  assetView,
  productionView,
  projectSection,
  studioView,
  studioSubview,
  environment,
  account,
}: {
  tenantId: string;
  section?: string | undefined;
  projectId?: string | undefined;
  contentView?: boolean | undefined;
  scriptView?: boolean | undefined;
  mediaView?: boolean | undefined;
  assetView?: boolean | undefined;
  productionView?: boolean | undefined;
  projectSection?: string | undefined;
  studioView?: boolean | undefined;
  studioSubview?: string | undefined;
  environment?: string | undefined;
  account?: ReactNode;
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
  if (projectId && studioView)
    return (
      <Suspense fallback={<Loader aria-label="正在加载创作台" />}>
        <StudioEntry
          tenantId={tenantId}
          projectId={projectId}
          environment={environment}
          view={studioSubview}
          account={account}
        />
      </Suspense>
    );
  if (projectId && projectSection === "canvas")
    return (
      <Suspense fallback={<Loader aria-label="正在加载画布入口" />}>
        <ProjectCanvasEntry tenantId={tenantId} projectId={projectId} />
      </Suspense>
    );
  if (projectId && productionView)
    return (
      <Suspense fallback={<Loader aria-label="正在加载镜头制作" />}>
        <SceneProductionWorkspace tenantId={tenantId} projectId={projectId} />
      </Suspense>
    );
  if (
    (projectId &&
      projectSection &&
      ![
        "content",
        "script",
        "canvas",
        "media",
        "assets",
        "production",
      ].includes(projectSection)) ||
    (!projectId && section && !["media", "assets", "work"].includes(section))
  )
    return (
      <Stack gap="lg">
        <SectionHeading
          title="此入口暂未开放"
          description="导入剧本，在画布中创作，整理镜头与项目资产。"
        />
        <Button
          component="a"
          href={
            projectId
              ? `#/app/t/${tenantId}/p/${projectId}/content`
              : `#/app/t/${tenantId}`
          }
        >
          {projectId ? "返回剧本与集场镜" : "返回项目"}
        </Button>
      </Stack>
    );
  if (!projectId && section === "work")
    return (
      <Suspense fallback={<Loader aria-label="正在加载我的工作" />}>
        <MyWork tenantId={tenantId} own={own} />
      </Suspense>
    );
  if (
    ["media", "assets"].includes(section ?? "") ||
    (projectId && (mediaView || assetView))
  )
    return (
      <Suspense fallback={<Loader aria-label="正在加载资产库" />}>
        <AssetLibrary
          key={`${tenantId}/${projectId ?? "shared"}`}
          tenantId={tenantId}
          own={own}
          projectId={projectId}
          legacyMedia={section === "media" || !!mediaView}
        />
      </Suspense>
    );
  return (
    <Projects
      tenantId={tenantId}
      own={own}
      members={members.data}
      projectId={projectId}
      contentView={contentView}
      scriptView={scriptView}
    />
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

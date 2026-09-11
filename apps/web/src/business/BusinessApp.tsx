import {
  lazy,
  Suspense,
  useEffect,
  useState,
  useRef,
  useCallback,
} from "react";
import {
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  Select,
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
  Images,
  Archive,
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
import {
  clearUserEditing,
  suspendEditingAccess,
  refreshEditingAccess,
  retireEditingSession,
} from "./use-cut-work";
import { notifyEditingAccess, subscribeEditingAccess } from "./editing-access";
const MediaWorkspace = lazy(() => import("./MediaWorkspace"));
const SceneProductionWorkspace = lazy(
  () => import("./SceneProductionWorkspace"),
);
const AssetWorkspace = lazy(() => import("./AssetWorkspace"));
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
      <AuthenticatedApp hash={hash} />
    </QueryClientProvider>
  );
}
function AuthenticatedApp({ hash }: { hash: string }) {
  const shell = useRef<HTMLDivElement>(null);
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
    document.title = "创作工作台 · 幕序 SceneDesk";
  }, []);
  return (
    <div className={classes.shell} ref={shell}>
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
      <header className={classes.header}>
        <Anchor href="#/app" className={classes.brand}>
          幕序{" "}
          <Text span c="dimmed">
            SceneDesk
          </Text>
        </Anchor>
        <Group gap="sm">
          <Badge>导入素材可用</Badge>
          {health.data?.providerMode === "mock" && <Badge>未连接真实模型</Badge>}
          {health.data?.identityMode === "local_test" && (
            <Badge>本地测试身份</Badge>
          )}
        </Group>
      </header>
      {session.isPending || checkingSession ? (
        <div className={classes.welcome}>
          <Loader aria-label="正在读取会话" />
        </div>
      ) : session.isError ? (
        <div className={classes.welcome}>
          <Stack gap="xl">
            <SectionHeading
              title="进入创作工作台"
              description="整理剧本与参考，在分镜和画布中完成每一场创作。"
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
          <Workspace key={session.data.id} hash={hash} />
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
  return (
    <>
      <div
        className={classes.layout}
        data-production={segments[6] === "production" || undefined}
      >
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
              leftSection={<Archive size={18} />}
              variant="subtle"
              component="a"
              href={`#/app/t/${tenantId}/assets`}
            >
              共享资产
            </Button>
          )}
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
                  onCommitted: () => void finishLogout(),
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
                mediaView={segments[6] === "media"}
                assetView={segments[6] === "assets"}
                productionView={segments[6] === "production"}
                projectSection={segments[6]}
              />
            </ProjectUpdates>
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
  assetView,
  productionView,
  projectSection,
}: {
  tenantId: string;
  section?: string | undefined;
  projectId?: string | undefined;
  contentView?: boolean | undefined;
  mediaView?: boolean | undefined;
  assetView?: boolean | undefined;
  productionView?: boolean | undefined;
  projectSection?: string | undefined;
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
  if (projectId && productionView)
    return (
      <Suspense fallback={<Loader aria-label="正在加载镜头制作" />}>
        <SceneProductionWorkspace tenantId={tenantId} projectId={projectId} />
      </Suspense>
    );
  if (
    (projectId &&
      projectSection &&
      !["content", "media", "assets", "production"].includes(projectSection)) ||
    (!projectId && section && !["media", "assets"].includes(section))
  )
    return (
      <Stack gap="lg">
        <SectionHeading
          title="此入口暂未开放"
          description="当前版本提供剧本、分镜、自由画布与素材创作。"
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
  if (section === "media" || (projectId && mediaView))
    return (
      <Suspense fallback={<Loader aria-label="正在加载素材工作区" />}>
        <MediaWorkspace tenantId={tenantId} own={own} projectId={projectId} />
      </Suspense>
    );
  if (section === "assets" || (projectId && assetView))
    return (
      <Suspense fallback={<Loader aria-label="正在加载资产工作区" />}>
        <AssetWorkspace tenantId={tenantId} own={own} projectId={projectId} />
      </Suspense>
    );
  return (
    <Projects
      tenantId={tenantId}
      own={own}
      members={members.data}
      projectId={projectId}
      contentView={contentView}
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

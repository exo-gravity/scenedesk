import { useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Fieldset,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { allPages, api, ApiError, useSession, type Schema } from "./api";
import { ErrorNotice, tenantPath } from "./common";
import {
  ProjectCreation,
  emptyProjectFields,
  trustedProjectRejection,
  type ProjectFields,
  type ProjectRequest,
} from "./project-creation";
import { projectCreationStorage } from "./project-creation-storage";
import classes from "./workbench.module.css";
const loadingState: ReturnType<ProjectCreation["getSnapshot"]> = {
  record: { fields: emptyProjectFields },
  ready: false,
  recovered: false,
  saved: true,
  busy: true,
  error: undefined,
};
const noSubscribe = () => () => {};
const getLoadingState = () => loadingState;
const rates = ["24/1", "25/1", "30/1", "24000/1001", "30000/1001"].map(
  (value) => ({
    value,
    label: {
      "24/1": "24 fps",
      "25/1": "25 fps",
      "30/1": "30 fps",
      "24000/1001": "23.976 fps（24000/1001）",
      "30000/1001": "29.97 fps（30000/1001）",
    }[value]!,
  }),
);
export function CreateProjectForm({
  tenantId,
  own,
  onCreated,
}: {
  tenantId: string;
  own: Schema<"Membership">;
  onCreated: (id: string) => void;
}) {
  const session = useSession(),
    cache = useQueryClient();
  const [controller, setController] = useState<ProjectCreation>();
  useEffect(() => {
    const handleAccess = (error: unknown) => {
      if (error instanceof ApiError && [401, 403].includes(error.status)) {
        void cache.invalidateQueries({ queryKey: ["session"] });
        void cache.invalidateQueries({
          queryKey: ["user", session.userId, `${tenantPath(tenantId)}/members`],
        });
      }
      throw error;
    };
    const checkAccess = async () => {
      try {
        const current = await api<Schema<"Session">>("/v1/session", {
          signal: AbortSignal.timeout(15000),
        });
        if (current.id !== session.id || current.userId !== session.userId)
          throw new ApiError(
            401,
            "SESSION_CHANGED",
            "登录已改变，请重新打开项目创建。",
          );
        const members = await allPages<Schema<"Membership">>(
          `${tenantPath(tenantId)}/members`,
          AbortSignal.timeout(15000),
        );
        if (
          !members.some(
            (member) =>
              member.id === own.id &&
              member.userId === session.userId &&
              member.status === "active" &&
              ["owner", "admin"].includes(member.role),
          )
        )
          throw new ApiError(
            403,
            "FORBIDDEN",
            "当前身份不能创建工作室项目，请重新核对访问权限。",
          );
      } catch (error) {
        handleAccess(error);
      }
    };
    const create = async (request: ProjectRequest) => {
      try {
        let response: Response;
        try {
          response = await fetch(request.path, {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            signal: AbortSignal.timeout(15000),
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
              "Idempotency-Key": request.idempotencyKey,
            },
            body: JSON.stringify(request.body),
          });
        } catch {
          throw new ApiError(
            0,
            "CONNECTION_LOST",
            "连接中断，创建结果尚未确认。请保留并恢复原请求。",
          );
        }
        const body: unknown = await response.json().catch(() => undefined);
        if (!response.ok) {
          const problem = body as
            { code?: unknown; message?: unknown } | undefined;
          throw Object.assign(
            new ApiError(
              response.status,
              typeof problem?.code === "string" ? problem.code : "UNAVAILABLE",
              typeof problem?.message === "string"
                ? problem.message
                : "服务回包无法确认，请保留原创建请求。",
            ),
            {
              trustedBusinessRejection: trustedProjectRejection(
                response.status,
                body,
              ),
            },
          );
        }
        if (response.status !== 201)
          throw new Error("服务器未返回完整创建回执，请保留并恢复原请求。");
        return body;
      } catch (error) {
        return handleAccess(error);
      }
    };
    const next = new ProjectCreation(
      projectCreationStorage(session.userId, tenantId),
      { checkAccess, create },
      tenantId,
      own.id,
    );
    setController(next);
    void next.load();
    return () => next.close();
  }, [tenantId, own.id, session.id, session.userId, session.csrfToken, cache]);
  const state = useSyncExternalStore(
    controller?.subscribe ?? noSubscribe,
    controller?.getSnapshot ?? getLoadingState,
  );
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!state.saved) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.saved]);
  const record = state.record,
    pending = !!record.request && !record.request.rejected;
  const proceed = async () => {
    const project = await controller?.submit();
    if (!project) return;
    void cache.invalidateQueries({ queryKey: ["user", session.userId] });
    onCreated(project.id);
  };
  const edit = (key: keyof ProjectFields, value: string) =>
    controller?.edit({ ...record.fields, [key]: value });
  if (!state.ready)
    return (
      <Stack>
        <Loader aria-label="正在核对项目创建记录" />
        <ErrorNotice
          error={state.error ?? null}
          retry={() => void controller?.load()}
        />
      </Stack>
    );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void proceed();
      }}
    >
      <Stack gap="lg">
        {state.recovered ? (
          <Alert
            title={
              record.result
                ? "发现已确认的项目创建"
                : pending
                  ? "发现待确认的项目创建"
                  : "发现本标签页的项目草稿"
            }
          >
            <Text>
              {pending
                ? "原请求可能已经创建成功。恢复记录后，请明确核对同一次创建。"
                : record.result
                  ? "服务器已确认项目，本机整理尚未完成。"
                  : "恢复后可继续填写，关闭或刷新不会自动提交。"}
            </Text>
            <Group mt="sm">
              <Button onClick={() => controller?.restore()}>
                恢复项目创建记录
              </Button>
              {!record.request && !record.result && (
                <Button
                  variant="subtle"
                  onClick={() => void controller?.discard()}
                >
                  放弃本地项目草稿
                </Button>
              )}
            </Group>
          </Alert>
        ) : record.result ? (
          <Alert title="项目已创建，本机整理待完成">
            <Text>
              {record.result.name}
              。整理完成后才会打开项目；重试整理不会再次创建。
            </Text>
            <Button mt="sm" loading={state.busy} onClick={() => void proceed()}>
              重试整理并打开项目
            </Button>
          </Alert>
        ) : record.request ? (
          <Alert
            title={
              record.request.rejected
                ? "本次项目创建未提交"
                : "项目创建结果待确认"
            }
          >
            <Text>
              {record.request.rejected?.message ??
                "原项目输入已固定。请明确恢复原请求，关闭或刷新不会另建项目。"}
            </Text>
            <Text mt="xs" size="sm">
              原项目名称：{record.request.body.name}
            </Text>
            {record.request.rejected ? (
              <Button
                mt="sm"
                loading={state.busy}
                onClick={() => void controller?.returnToEditing()}
              >
                保留输入，返回编辑
              </Button>
            ) : (
              <Button
                mt="sm"
                loading={state.busy}
                onClick={() => void proceed()}
              >
                恢复原项目创建请求
              </Button>
            )}
          </Alert>
        ) : (
          <Text size="xs" c="dimmed" aria-live="polite">
            {state.saved
              ? "本标签页的项目草稿已保留；创建需明确提交。"
              : "正在保存本机项目草稿…"}
          </Text>
        )}
        <Fieldset
          variant="unstyled"
          disabled={
            state.busy || state.recovered || !!record.request || !!record.result
          }
        >
          <Stack gap="lg">
            <TextInput
              required
              maxLength={160}
              label="项目名称"
              value={record.fields.name}
              onChange={(event) => edit("name", event.currentTarget.value)}
            />
            <div className={classes.grid}>
              <Select
                required
                label="画幅"
                data={[
                  { value: "portrait", label: "竖屏 · 1080 × 1920" },
                  { value: "landscape", label: "横屏 · 1920 × 1080" },
                ]}
                value={record.fields.format}
                onChange={(value) => value && edit("format", value)}
              />
              <Select
                required
                label="目标帧率"
                data={rates}
                value={record.fields.rate}
                onChange={(value) => value && edit("rate", value)}
              />
            </div>
            <TextInput
              required
              label="语言"
              value={record.fields.language}
              onChange={(event) => edit("language", event.currentTarget.value)}
            />
          </Stack>
        </Fieldset>
        <ErrorNotice error={state.error ?? null} />
        {!record.request && !record.result && (
          <Button
            variant="filled"
            type="submit"
            loading={state.busy}
            disabled={
              state.recovered ||
              !record.fields.name.trim() ||
              !record.fields.language.trim()
            }
          >
            创建项目
          </Button>
        )}
      </Stack>
    </form>
  );
}

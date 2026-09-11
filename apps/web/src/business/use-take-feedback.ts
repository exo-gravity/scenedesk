import { useEffect, useState, useSyncExternalStore } from "react";
import { allPages, api, ApiError, useSession, type Schema } from "./api";
import { assistantStorage } from "./assistant-storage";
import { registerAssistant } from "./assistant-lifecycle";
import { subscribeEditingAccess } from "./editing-access";
import { projectPath } from "./common";
import {
  TakeFeedbackSession,
  trustedFeedbackRejection,
  validFeedback,
  type FeedbackDraft,
  type FeedbackIntent,
} from "./take-feedback";
const entries = new Map<string, TakeFeedbackSession>();
export function useTakeFeedback(
  tenantId: string,
  projectId: string,
  take: Schema<"Take">,
) {
  const session = useSession(),
    path = projectPath(tenantId, projectId);
  const [controller] = useState(() => {
    const key = JSON.stringify([session.id, path, take.id]);
    const existing = entries.get(key);
    if (existing) return existing;
    const local = assistantStorage<FeedbackDraft>(
      session.userId,
      `${path}/takes/${take.id}/feedback`,
      session.id,
    );
    const created = new TakeFeedbackSession(
      {
        read: async () => (await local.read())?.draft,
        write: (draft) =>
          local.write({ schemaVersion: 1, draft, previous: [] }),
        clear: local.clear,
      },
      {
        read: async () => {
          const current = await api<Schema<"Session">>("/v1/session", {
            signal: AbortSignal.timeout(15000),
          });
          if (current.id !== session.id || current.userId !== session.userId)
            throw new ApiError(401, "SESSION_CHANGED", "登录身份已改变。");
          const actual = await api<Schema<"Take">>(`${path}/takes/${take.id}`, {
            signal: AbortSignal.timeout(15000),
          });
          if (
            actual.shotId !== take.shotId ||
            actual.shotRevisionId !== take.shotRevisionId
          )
            throw new Error("候选固定来源不一致。");
          const reviews = await allPages<Schema<"Review">>(
            `${path}/reviews?takeId=${take.id}`,
          );
          if (
            reviews.some((r) => !validFeedback(r, "review", projectId, take.id))
          )
            throw new Error("候选意见列表不完整。");
          const comments = (
            await Promise.all(
              reviews.map((r) =>
                allPages<Schema<"Comment">>(`${path}/reviews/${r.id}/comments`),
              ),
            )
          ).flat();
          if (
            comments.some(
              (c) =>
                !reviews.some((r) => r.id === c.reviewId) ||
                !validFeedback(c, "comment", c.reviewId),
            )
          )
            throw new Error("意见正文列表不完整。");
          return { reviews, comments };
        },
        send: async (intent: FeedbackIntent) => {
          const url =
            intent.kind === "review"
              ? `${path}/reviews`
              : `${path}/reviews/${intent.reviewId}/comments${intent.kind === "change" ? `/${intent.commentId}` : ""}`;
          const response = await fetch(url, {
            method: intent.kind === "change" ? "PATCH" : "POST",
            credentials: "same-origin",
            cache: "no-store",
            signal: AbortSignal.timeout(15000),
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": session.csrfToken,
              ...(intent.kind === "change"
                ? { "If-Match": `"${intent.revision}"` }
                : { "Idempotency-Key": intent.key }),
            },
            body: JSON.stringify(intent.body),
          });
          const value: unknown = await response.json().catch(() => undefined);
          if (!response.ok) {
            const body = value as Partial<Schema<"Error">> | undefined;
            throw Object.assign(
              new ApiError(
                response.status,
                typeof body?.code === "string" ? body.code : "UNKNOWN_RESPONSE",
                typeof body?.message === "string"
                  ? body.message
                  : "意见保存结果待核对。",
              ),
              {
                trustedBusinessRejection: trustedFeedbackRejection(
                  response.status,
                  value,
                ),
              },
            );
          }
          if (response.status !== (intent.kind === "change" ? 200 : 201))
            throw new Error("保存回包状态不完整，请保留原请求核对。");
          return value;
        },
      },
      projectId,
      take.id,
      session.userId,
    );
    entries.set(key, created);
    return created;
  });
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  useEffect(() => {
    const unregister = registerAssistant({
      controller,
      userId: session.userId,
      sessionId: session.id,
      tenantId,
      projectId,
    });
    const verify = () => {
      controller.suspend();
      void controller.verify();
    };
    const unsubscribe = subscribeEditingAccess((hint) => {
      if (
        hint.userId === session.userId &&
        hint.sessionId === session.id &&
        (hint.kind === "session" ||
          (hint.tenantId === tenantId && hint.projectId === projectId))
      )
        verify();
    });
    window.addEventListener("focus", verify);
    window.addEventListener("online", verify);
    void controller.verify();
    return () => {
      unregister();
      unsubscribe();
      window.removeEventListener("focus", verify);
      window.removeEventListener("online", verify);
    };
  }, [controller, tenantId, projectId, session.id, session.userId]);
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
  return { controller, state };
}

import { createContext, useContext, useRef } from "react";
import {
  useMutation,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type MutateOptions,
} from "@tanstack/react-query";
import type { components } from "@drama/contracts";

export type Schema<T extends keyof components["schemas"]> =
  components["schemas"][T];
export type Session = Schema<"Session">;
export type Page<T> = { items: T[]; nextCursor?: string };
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      0,
      "CONNECTION_LOST",
      "连接中断。请保留当前内容，恢复连接后重试。",
    );
  }
  const body =
    response.status === 204
      ? undefined
      : await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      response.status,
      body.code ?? "UNAVAILABLE",
      body.message ?? "服务暂时不可用，请稍后重试。",
    );
  return body as T;
}
export const SessionContext = createContext<Session | null>(null);
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("Session context missing");
  return session;
}
export function useResource<T>(path: string, enabled = true) {
  const session = useSession();
  return useQuery({
    queryKey: ["user", session.userId, path],
    queryFn: ({ signal }) => api<T>(path, { signal }),
    enabled,
  });
}
export function usePages<T>(path: string, enabled = true) {
  const session = useSession();
  return useInfiniteQuery({
    queryKey: ["user", session.userId, path, "pages"],
    initialPageParam: "",
    enabled,
    queryFn: ({ signal, pageParam }) =>
      api<Page<T>>(
        `${path}${path.includes("?") ? "&" : "?"}limit=30${pageParam ? "&cursor=" + encodeURIComponent(pageParam) : ""}`,
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}
export type Command = {
  path: string;
  method?: "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  version?: number;
};
type CommittedCommand<T> = Command & { onCommitted?: (result: T) => void };
export function useCommand<T>() {
  const session = useSession(),
    cache = useQueryClient();
  const pending = useRef<{ fingerprint: string; key: string } | undefined>(
    undefined,
  );
  const mutation = useMutation<T, Error, CommittedCommand<T>>({
    retry: false,
    mutationFn: async (command) => {
      const { onCommitted: _callback, ...request } = command;
      const fingerprint = JSON.stringify(request);
      if (pending.current?.fingerprint !== fingerprint)
        pending.current = { fingerprint, key: crypto.randomUUID() };
      const result = await api<T>(command.path, {
        method: command.method ?? "POST",
        headers: {
          "X-CSRF-Token": session.csrfToken,
          "Idempotency-Key": pending.current.key,
          ...(command.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
          ...(command.version === undefined
            ? {}
            : { "If-Match": `"${command.version}"` }),
        },
        ...(command.body === undefined
          ? {}
          : { body: JSON.stringify(command.body) }),
      });
      pending.current = undefined;
      return result;
    },
    onSuccess: (result, command) => {
      // Mutation-owned callbacks survive observer unmounts. Persist the receipt
      // before invalidation can replace or unmount the editor that submitted it.
      command.onCommitted?.(result);
      return cache.invalidateQueries({ queryKey: ["user", session.userId] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401)
        void cache.invalidateQueries({ queryKey: ["session"] });
      if (error instanceof ApiError && error.status === 412)
        void cache.invalidateQueries({ queryKey: ["user", session.userId] });
    },
  });
  return {
    ...mutation,
    mutate: (
      command: Command,
      options?: MutateOptions<T, Error, CommittedCommand<T>> & {
        onCommitted?: (result: T) => void;
      },
    ) => {
      const { onCommitted, ...callbacks } = options ?? {};
      mutation.mutate(
        { ...command, ...(onCommitted ? { onCommitted } : {}) },
        callbacks,
      );
    },
  };
}
export async function allPages<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T[]> {
  const results: T[] = [];
  let cursor: string | undefined;
  do {
    const url = new URL(path, location.origin);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const page = await api<Page<T>>(
      `${url.pathname}${url.search}`,
      signal ? { signal } : {},
    );
    results.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return results;
}
export function useList<T>(path: string, enabled = true) {
  const session = useSession();
  return useQuery({
    queryKey: ["user", session.userId, path],
    queryFn: ({ signal }) => allPages<T>(path, signal),
    enabled,
  });
}

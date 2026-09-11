import type { FastifyInstance } from "fastify";
import { setTimeout as delay } from "node:timers/promises";
import { operationDefinition } from "@drama/contracts/validation";
import type { Database } from "../../kernel/database.js";
import { Problem, requireThat } from "../../kernel/errors.js";
import { sessionCookie, type ApiContext } from "../../kernel/routes.js";
import type { Schema } from "../content/model.js";

type ProjectScope = { tenantId: string; projectId: string };
type ProjectEvent = Schema<"Event">;

/** Each batch authenticates again and releases its transaction before delivery. */
export function readProjectEvents(
  database: Database,
  token: string,
  scope: ProjectScope,
  after?: string,
) {
  return database.transaction(token, { ...scope, write: false }, async (tx) => {
    await tx.sql.query("SELECT relay_project_events($1)", [scope.projectId]);
    const {
      rows: [head],
    } = await tx.sql.query(
      "SELECT seq,pruned_seq FROM project_event_heads WHERE project_id=$1",
      [scope.projectId],
    );
    let events: ProjectEvent[];
    // Compare decimal strings before passing a bounded cursor to PostgreSQL.
    // Even an oversized, syntactically valid browser cursor means reset.
    const cursor = after?.replace(/^0+(?=\d)/, "");
    if (
      cursor === undefined ||
      cursor.length > 19 ||
      BigInt(cursor) < BigInt(head.pruned_seq) ||
      BigInt(cursor) > BigInt(head.seq)
    ) {
      events = [{ seq: head.seq, type: "reset" }];
    } else {
      const { rows } = await tx.sql.query(
        "SELECT seq,resource_kind,resource_id,resource_revision FROM project_events WHERE project_id=$1 AND seq>$2 ORDER BY seq LIMIT 200",
        [scope.projectId, cursor],
      );
      events = rows.map((row) => ({
        seq: row.seq,
        type: "resource_changed",
        resourceKind: row.resource_kind,
        resourceId: row.resource_id,
        resourceRevision: Number(row.resource_revision),
      }));
    }
    return { userId: tx.session.userId, events };
  });
}

export function projectEventRoutes(app: FastifyInstance, context: ApiContext) {
  const streams = new Map<AbortController, { project: string; user: string }>();
  let closing = false;
  app.addHook("preClose", async () => {
    closing = true;
    for (const controller of streams.keys()) controller.abort();
  });
  const operation = operationDefinition("streamProjectEvents");
  app.get(
    operation.path.replace(/\{([^}]+)\}/g, ":$1"),
    async (request, reply) => {
      const token = sessionCookie(request);
      requireThat(
        operation.validateInput({
          path: request.params,
          query: request.query,
          header: request.headers,
        }),
        422,
        "INVALID_REQUEST",
        "请求字段不符合接口要求。",
      );
      const params = request.params as ProjectScope;
      const scope = {
        tenantId: params.tenantId.toLowerCase(),
        projectId: params.projectId.toLowerCase(),
      };
      let cursor = request.headers["last-event-id"] as string | undefined;
      let batch = await readProjectEvents(
        context.database,
        token,
        scope,
        cursor,
      );
      requireThat(
        !closing,
        503,
        "STREAM_UNAVAILABLE",
        "更新通知暂不可用，请稍后重试。",
      );
      const projectStreams = [...streams.values()].filter(
        (stream) => stream.project === scope.projectId,
      );
      requireThat(
        projectStreams.length < 500 &&
          projectStreams.filter((stream) => stream.user === batch.userId)
            .length < 5,
        429,
        "PROJECT_STREAM_LIMIT",
        "打开的项目页面过多，请关闭不再使用的页面后重试。",
      );
      const controller = new AbortController(),
        { signal } = controller;
      streams.set(controller, { project: scope.projectId, user: batch.userId });
      const close = () => controller.abort();
      request.raw.once("aborted", close);
      reply.raw.once("close", close);
      reply.raw.once("error", close);
      const finish = () => {
        streams.delete(controller);
        if (!reply.raw.writableEnded) reply.raw.end();
      };
      signal.addEventListener("abort", finish, { once: true });
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      reply.raw.flushHeaders();
      // Bound pending bytes: wait for drain before producing another batch.
      const write = async (value: string) => {
        if (signal.aborted) return;
        if (reply.raw.write(value)) return;
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            reply.raw.off("drain", done);
            signal.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(() => {
            reply.raw.destroy();
            controller.abort();
            done();
          }, 5_000);
          reply.raw.once("drain", done);
          signal.addEventListener("abort", done, { once: true });
          if (signal.aborted) done();
        });
      };
      try {
        await write("retry: 3000\n\n");
        let lastWrite = Date.now();
        while (!signal.aborted) {
          for (const event of batch.events) {
            if (signal.aborted) break;
            await write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
            cursor = event.seq;
            lastWrite = Date.now();
          }
          if (Date.now() - lastWrite >= 15_000) {
            await write(": keepalive\n\n");
            lastWrite = Date.now();
          }
          await delay(2_000, undefined, { signal });
          batch = await readProjectEvents(
            context.database,
            token,
            scope,
            cursor,
          );
        }
      } catch (error) {
        if (
          !signal.aborted &&
          error instanceof Problem &&
          [401, 403, 404].includes(error.status)
        )
          await write(
            `data: ${JSON.stringify({ seq: cursor ?? "0", type: "access_revoked" } satisfies ProjectEvent)}\n\n`,
          );
        // A transient read failure closes the transport; reconnect reauthorizes.
      } finally {
        controller.abort();
        request.raw.off("aborted", close);
        reply.raw.off("close", close);
        reply.raw.off("error", close);
        signal.removeEventListener("abort", finish);
      }
    },
  );
}

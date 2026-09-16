import type { FastifyInstance } from "fastify";
import { operationDefinition } from "@drama/contracts/validation";
import { canonical, digest } from "../../kernel/crypto.js";
import { audit } from "../../kernel/database.js";
import { Problem, requireThat } from "../../kernel/errors.js";
import { registerAction, sessionCookie } from "../../kernel/routes.js";
import { services, type MediaContext } from "../media/model.js";
import {
  DELIVERY_LIMITS,
  selectedDeliverySnapshot,
} from "./selected-delivery-model.js";
import { prepareDeliveryArchive } from "./selected-delivery-archive.js";

type Ticket = { fingerprint: string; expiresAt: number };
const ticketContext = (
  tenant: string,
  project: string,
  scene: string,
  actor: string,
) => `selected-delivery:v1:${tenant}:${project}:${scene}:${actor}`;

export function selectedDeliveryRoutes(
  app: FastifyInstance,
  context: MediaContext,
) {
  registerAction(app, context, "previewSelectedDelivery", async (tx, input) => {
    services(context);
    const snapshot = await selectedDeliverySnapshot(tx, input.params.sceneId!);
    const expiresAt = Date.now() + DELIVERY_LIMITS.ticketMs;
    return {
      body: {
        manifest: snapshot.manifest,
        expiresAt: new Date(expiresAt).toISOString(),
        ticket: context.secrets.seal(
          {
            fingerprint: digest(canonical(snapshot)),
            expiresAt,
          } satisfies Ticket,
          ticketContext(
            tx.tenantId!,
            tx.projectId!,
            input.params.sceneId!,
            tx.session.userId,
          ),
        ),
      },
    };
  });

  const operation = operationDefinition("downloadSelectedDelivery");
  const active = new Set<string>();
  app.post(
    operation.path.replace(/\{([^}]+)\}/g, ":$1"),
    { bodyLimit: 4096 },
    async (request, reply) => {
      const session = sessionCookie(request);
      const params = request.params as Record<string, string>;
      requireThat(
        operation.validateInput({
          path: params,
          query: request.query,
          header: request.headers,
          body: request.body,
        }),
        422,
        "INVALID_REQUEST",
        "下载请求无效，请重新查看交接清单。",
      );
      requireThat(
        request.headers.origin === context.origin,
        403,
        "ORIGIN_REJECTED",
        "请求来源无效。",
      );
      requireThat(
        typeof request.headers["x-csrf-token"] === "string" &&
          context.secrets.equal(
            request.headers["x-csrf-token"],
            context.secrets.csrf(session),
          ),
        403,
        "CSRF_REJECTED",
        "会话校验失败，请刷新后重试。",
      );
      const tenantId = params.tenantId!.toLowerCase(),
        projectId = params.projectId!.toLowerCase(),
        sceneId = params.sceneId!.toLowerCase();
      const scope = { tenantId, projectId, write: false };
      const ticket = (request.body as { ticket: string }).ticket;
      const fixed = await context.database.transaction(
        session,
        scope,
        async (tx) => {
          let value: Ticket;
          try {
            const parts = ticket.split(".");
            if (
              parts.length !== 3 ||
              parts.some(
                (part) =>
                  !part ||
                  Buffer.from(part, "base64url").toString("base64url") !== part,
              )
            )
              throw new Error("Non-canonical download ticket");
            value = context.secrets.open<Ticket>(
              ticket,
              ticketContext(tenantId, projectId, sceneId, tx.session.userId),
            );
          } catch {
            throw new Problem(
              422,
              "DELIVERY_PREVIEW_INVALID",
              "交接清单无效，请重新查看。",
            );
          }
          requireThat(
            value.expiresAt > Date.now(),
            409,
            "DELIVERY_PREVIEW_EXPIRED",
            "交接清单已过期，请重新查看后下载。",
          );
          const snapshot = await selectedDeliverySnapshot(tx, sceneId);
          requireThat(
            value.fingerprint === digest(canonical(snapshot)),
            409,
            "DELIVERY_CHANGED",
            "镜头顺序、说明或选用已变化。请重新查看清单，确认后再下载。",
          );
          return { ...value, snapshot, actorId: tx.session.userId };
        },
      );
      requireThat(
        !active.has(fixed.actorId) && active.size < DELIVERY_LIMITS.concurrent,
        429,
        "DELIVERY_BUSY",
        "正在准备其他原片包，请等下载开始或取消后再试。",
      );
      active.add(fixed.actorId);
      const controller = new AbortController();
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(DELIVERY_LIMITS.preparationMs),
      ]);
      const onClose = () => {
        if (!reply.raw.writableFinished) controller.abort();
      };
      reply.raw.once("close", onClose);
      let archive:
        Awaited<ReturnType<typeof prepareDeliveryArchive>> | undefined;
      let released = false;
      const cleanup = async () => {
        if (released) return;
        released = true;
        try {
          await archive?.cleanup();
        } finally {
          active.delete(fixed.actorId);
          reply.raw.off("close", onClose);
        }
      };
      try {
        archive = await prepareDeliveryArchive(
          fixed.snapshot,
          services(context).store,
          signal,
        );
        signal.throwIfAborted();
        // Permission and selected identities are re-read after IO, never trusted from a ticket.
        await context.database.transaction(session, scope, async (tx) => {
          const current = await selectedDeliverySnapshot(tx, sceneId);
          requireThat(
            fixed.fingerprint === digest(canonical(current)),
            409,
            "DELIVERY_CHANGED",
            "准备期间镜头顺序、说明或选用已变化。请重新查看清单后再下载。",
          );
          await audit(tx, "downloadSelectedDelivery", sceneId, {
            selections: current.manifest.entries.map(
              (entry) => entry.selectionId,
            ),
            fileCount: current.manifest.entries.length,
          });
        });
        signal.throwIfAborted();
        const stream = archive.stream(
          AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(DELIVERY_LIMITS.transferMs),
          ]),
        );
        stream.once(
          "close",
          () =>
            void cleanup().catch(() =>
              request.log.error(
                { code: "DELIVERY_CLEANUP_FAILED" },
                "Delivery temporary cleanup failed",
              ),
            ),
        );
        stream.once("error", () => controller.abort());
        return reply
          .header("Cache-Control", "no-store")
          .header(
            "Content-Disposition",
            `attachment; filename="SceneDesk-${sceneId}-selected.zip"`,
          )
          .header("Content-Length", archive.bytes)
          .type("application/zip")
          .send(stream);
      } catch (error) {
        await cleanup();
        if (error instanceof Problem) throw error;
        throw new Problem(
          503,
          signal.aborted
            ? "DELIVERY_INTERRUPTED"
            : "DELIVERY_SOURCE_UNAVAILABLE",
          signal.aborted
            ? "原片包准备已中断或超时。请保留清单，稍后重试。"
            : "原片包未完成，未发送下载文件。请检查原片服务后重试。",
        );
      }
    },
  );
}

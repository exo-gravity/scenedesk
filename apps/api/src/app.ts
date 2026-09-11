import { generationRoutes } from "./modules/generation/routes.js";
import Fastify from "fastify";
import type { Pool } from "pg";
import { readFileSync } from "node:fs";
import { Database } from "./kernel/database.js";
import { Secrets } from "./kernel/crypto.js";
import { installProblemHandler } from "./kernel/routes.js";
import { identityRoutes } from "./modules/identity/routes.js";
import { projectRoutes } from "./modules/projects/routes.js";
import { proposalRoutes } from "./modules/content/proposals.js";
import { contentRoutes } from "./modules/content/routes.js";
import { creativeRoutes } from "./modules/creative/routes.js";
import { taskRoutes } from "./modules/tasks/routes.js";
import { candidateRoutes } from "./modules/candidates/routes.js";
import { editingRoutes } from "./modules/editing/routes.js";
import { canvasRoutes } from "./modules/canvas/routes.js";
import { editingPresenceRoutes } from "./modules/editing-presence/routes.js";
import { projectEventRoutes } from "./modules/project-events/routes.js";
import { assetRoutes } from "./modules/assets/routes.js";
import { mediaRoutes } from "./modules/media/routes.js";
import type { MediaServices } from "./modules/media/model.js";
import { invitationRoutes } from "./modules/identity/invitations.js";
import { oidcRoutes } from "./modules/identity/oidc.js";
import type { Configuration } from "openid-client";
import { verifyRuntimeRole } from "@drama/database";

export type BusinessOptions = {
  origin: string;
  secret: string;
  schema?: string;
  localIdentity?: boolean;
  media?: MediaServices;
  auth?: { pool: Pool; config: Configuration };
};

export function buildApp(pool?: Pool, business?: BusinessOptions) {
  const app = Fastify({ logger: false });
  const database =
    pool && business ? new Database(pool, business.schema) : undefined;
  installProblemHandler(app);
  if (database && business) {
    const origin = new URL(business.origin);
    if (
      origin.origin !== business.origin ||
      (origin.protocol !== "https:" &&
        !(
          origin.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)
        ))
    )
      throw new Error(
        "Application origin must use HTTPS, or HTTP on loopback for local development",
      );
    const context = {
      database,
      secrets: new Secrets(business.secret),
      origin: business.origin,
      secureCookies: origin.protocol === "https:",
    };
    app.addHook("onReady", () => database.verify());
    identityRoutes(app, context);
    invitationRoutes(app, context);
    projectRoutes(app, context);
    contentRoutes(app, context);
    generationRoutes(app, context);
    proposalRoutes(app, context);
    creativeRoutes(app, context);
    taskRoutes(app, context);
    candidateRoutes(app, context);
    editingRoutes(app, context);
    canvasRoutes(app, context);
    editingPresenceRoutes(app, context);
    projectEventRoutes(app, context);
    assetRoutes(app, context);
    mediaRoutes(app, {
      ...context,
      ...(business.media ? { media: business.media } : {}),
    });
    if (business.media)
      app.addHook("onReady", () => business.media!.store.verify());
    if (business.auth) {
      app.addHook("onReady", async () => {
        const client = await business.auth!.pool.connect();
        try {
          await verifyRuntimeRole(client, database.schema);
        } finally {
          client.release();
        }
      });
      oidcRoutes(
        app,
        { ...context, pool: business.auth.pool, schema: database.schema },
        business.auth.config,
      );
    }
  }
  app.get("/health/live", async () => ({
    status: "ok",
    phase: business ? "s1" : "s0",
    productionReady: false,
    providerMode: "mock",
    identityMode: business?.localIdentity
      ? "local_test"
      : business?.auth
        ? "oidc"
        : "unconfigured",
  }));
  app.get("/health/ready", async (_request, reply) => {
    if (!pool)
      return reply
        .code(503)
        .send({ status: "not_ready", reason: "DATABASE_NOT_CONFIGURED" });
    try {
      if (database) {
        await database.verify();
        await pool.query("SELECT 1");
        await business?.media?.store.verify();
        return {
          status: "ok",
          scope: business?.media
            ? "identity_projects_content_and_media"
            : "identity_projects_and_content",
          businessReady: true,
          completeMvp: false,
        };
      }
      const result = await pool.query(
        "SELECT value FROM drama.runtime_metadata WHERE key='implementation_phase'",
      );
      if (result.rows[0]?.value !== "s0") throw new Error("Bootstrap missing");
      return {
        status: "ok",
        scope: "engineering_bootstrap_only",
        businessReady: false,
      };
    } catch {
      return reply.code(503).send({
        status: "not_ready",
        reason: "DATABASE_BOOTSTRAP_UNAVAILABLE",
      });
    }
  });
  app.get("/design/openapi.json", async (_request, reply) =>
    reply
      .type("application/json")
      .send(
        readFileSync(
          new URL("../../../docs/implementation/openapi.json", import.meta.url),
          "utf8",
        ),
      ),
  );
  app.setNotFoundHandler((request, reply) =>
    reply.code(request.url.startsWith("/v1/") ? 501 : 404).send({
      code: request.url.startsWith("/v1/")
        ? "BUSINESS_API_NOT_IMPLEMENTED"
        : "NOT_FOUND",
      message: "S0 engineering scaffold",
      requestId: request.id,
    }),
  );
  return app;
}

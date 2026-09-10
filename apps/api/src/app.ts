import Fastify from "fastify";
import type { Pool } from "pg";
import { readFileSync } from "node:fs";

export function buildApp(pool?: Pool) {
  const app = Fastify({ logger: false });
  app.get("/health/live", async () => ({
    status: "ok",
    phase: "s0",
    productionReady: false,
    providerMode: "mock",
  }));
  app.get("/health/ready", async (_request, reply) => {
    if (!pool)
      return reply
        .code(503)
        .send({ status: "not_ready", reason: "DATABASE_NOT_CONFIGURED" });
    try {
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
      return reply
        .code(503)
        .send({
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
    reply
      .code(request.url.startsWith("/v1/") ? 501 : 404)
      .send({
        code: request.url.startsWith("/v1/")
          ? "BUSINESS_API_NOT_IMPLEMENTED"
          : "NOT_FOUND",
        message: "S0 engineering scaffold",
        requestId: request.id,
      }),
  );
  return app;
}

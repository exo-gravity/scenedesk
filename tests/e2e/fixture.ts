import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test as base, expect } from "@playwright/test";
import { preview } from "vite";
import type { components } from "@drama/contracts";
import { buildApp } from "../../apps/api/src/app.js";
import { Secrets } from "../../apps/api/src/kernel/crypto.js";
import { issueSession } from "../../apps/api/src/modules/identity/sessions.js";
import { databaseFixture } from "../support/database.js";

type Schema<K extends keyof components["schemas"]> = components["schemas"][K];
type Session = Awaited<ReturnType<typeof issueSession>>;
type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** Real production API and built Web, with isolated synthetic identity bootstrap. */
export async function startWorkspaceRuntime() {
  const databaseURL = process.env.DATABASE_URL;
  if (!databaseURL || !/^\/drama_e2e(?:_|$)/.test(new URL(databaseURL).pathname))
    throw new Error("E2E requires a dedicated drama_e2e or drama_e2e_* database");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(databaseURL).hostname))
    throw new Error("E2E database must be a disposable loopback PostgreSQL service");
  if (process.env.PROVIDER_MODE !== "mock")
    throw new Error("E2E requires explicit PROVIDER_MODE=mock; paid calls are forbidden");
  const root = fileURLToPath(new URL("../../apps/web/", import.meta.url));
  await access(`${root}/dist/index.html`);
  const port = Number(process.env.SCENEDESK_E2E_PORT ?? 4461);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
    throw new Error("SCENEDESK_E2E_PORT must be a non-privileged TCP port");
  const origin = `http://127.0.0.1:${port}`;
  const cleanup: (() => void | Promise<void>)[] = [];
  let stopped = false;
  async function stop() {
    if (stopped) return;
    stopped = true;
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) {
      try { await close(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, "E2E cleanup failed");
  }
  try {
    const database = await databaseFixture({ after: (close) => { cleanup.push(close); } });
    const secret = randomBytes(32).toString("base64url"), secrets = new Secrets(secret);
    const app = buildApp(database.runtime, {
      schema: database.schema, secret, origin, localIdentity: true,
    });
    cleanup.push(async () => {
      app.server.closeAllConnections();
      await app.close();
    });
    const apiOrigin = await app.listen({ host: "127.0.0.1", port: 0 });
    const web = await preview({
      configFile: false, root, logLevel: "error",
      build: { outDir: "dist" },
      preview: {
        host: "127.0.0.1", port, strictPort: true,
        proxy: { "/v1": apiOrigin, "/health": apiOrigin },
      },
    });
    cleanup.push(() => new Promise<void>((resolve, reject) => {
      if ("closeAllConnections" in web.httpServer) web.httpServer.closeAllConnections();
      web.httpServer.close((error) => error ? reject(error) : resolve());
    }));
    const identity = (label: string) => issueSession(database.auth, {
      issuer: "urn:scenedesk:e2e:synthetic", subject: `${label}-${randomUUID()}`,
      email: `${label}@example.test`, emailVerified: true,
      displayName: `E2E ${label}`,
    }, { schema: database.schema });
    async function request<T>(who: Session, method: Method, path: string, body?: unknown, revision?: number) {
      const response = await fetch(`${origin}${path}`, {
        method, signal: AbortSignal.timeout(15_000),
        headers: {
          cookie: `session=${who.token}`, origin,
          "x-csrf-token": secrets.csrf(who.token), "idempotency-key": randomUUID(),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(revision === undefined ? {} : { "if-match": `"${revision}"` }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const value = response.status === 204 ? undefined : await response.json();
      return { status: response.status, value: value as T };
    }
    async function command<T>(who: Session, method: Method, path: string, body?: unknown, revision?: number) {
      const result = await request<T>(who, method, path, body, revision);
      assert.equal(result.status, method === "POST" ? 201 : method === "DELETE" ? 204 : 200,
        `Synthetic fixture ${method} ${path}: ${JSON.stringify(result.value)}`);
      return result.value;
    }
    return { origin, database, identity, request, command, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

export type WorkspaceRuntime = Awaited<ReturnType<typeof startWorkspaceRuntime>>;

async function seedWorkspace(runtime: WorkspaceRuntime) {
  const owner = await runtime.identity("owner");
  const command = <T>(method: Method, path: string, body?: unknown, revision?: number) =>
    runtime.command<T>(owner, method, path, body, revision);
  const tenant = await command<Schema<"Tenant">>("POST", "/v1/tenants", {
    name: "E2E 合成工作室", currency: "CNY",
  });
  const tenantPath = `/v1/tenants/${tenant.id}`;
  const members = await command<{ items: Schema<"Membership">[] }>("GET", `${tenantPath}/members`);
  const project = await command<Schema<"Project">>("POST", `${tenantPath}/projects`, {
    name: "E2E 雨夜来信", leadMembershipId: members.items[0]!.id,
    spec: { width: 1080, height: 1920, fpsNum: 24, fpsDen: 1, language: "zh-CN" },
  });
  const path = `${tenantPath}/projects/${project.id}`;
  const content = () => command<Schema<"ContentTree">>("GET", `${path}/content`);
  const scripts = () => command<{ items: Schema<"ScriptRevision">[] }>("GET", `${path}/scripts`);
  const first = await command<Schema<"ScriptRevision">>("POST", `${path}/scripts`, {
    text: "第一稿：林在雨夜发现一封没有署名的信。",
  }, (await content()).revision);
  const current = await command<Schema<"ScriptRevision">>("POST", `${path}/scripts`, {
    text: "定稿：林推开咖啡店的门。\n信中写着：明天去旧车站。", parentRevisionId: first.id,
  }, (await content()).revision);
  const episode = await command<Schema<"Episode">>("POST", `${path}/episodes`, {
    title: "第一集 · 合成数据", position: 0, status: "active",
  }, (await content()).revision);
  const scene = await command<Schema<"Scene">>("POST", `${path}/scenes`, {
    episodeId: episode.id, title: "雨夜咖啡店", position: 0,
    summary: "林阅读来信。", state: {}, status: "active",
  }, (await content()).revision);
  const asset = await command<Schema<"Asset">>("POST", `${tenantPath}/assets`, {
    scope: "project", projectId: project.id, kind: "character", name: "林 · 合成角色",
  });
  await command("POST", `${tenantPath}/assets/${asset.id}/revisions`, {
    definition: { description: "合成角色的固定设定：寻找来信人。", references: [], looks: [] },
  }, asset.revision);
  const basePath = `/#/app/t/${tenant.id}/p/${project.id}`;
  return { runtime, owner, tenant, project, path, tenantPath, basePath,
    command, content, scripts, first, current, episode, scene, asset };
}

export type WorkspaceFixture = Awaited<ReturnType<typeof seedWorkspace>>;
export const test = base.extend<{ workspace: WorkspaceFixture }, { runtime: WorkspaceRuntime }>({
  runtime: [async ({}, use) => {
    const runtime = await startWorkspaceRuntime();
    try { await use(runtime); } finally { await runtime.stop(); }
  }, { scope: "worker", timeout: 120_000 }],
  workspace: async ({ runtime, context }, use) => {
    const workspace = await seedWorkspace(runtime);
    await context.addCookies([{ name: "session", value: workspace.owner.token,
      url: runtime.origin, httpOnly: true, sameSite: "Lax" }]);
    await use(workspace);
  },
});
export { expect };

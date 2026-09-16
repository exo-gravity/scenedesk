import { fileURLToPath } from "node:url";
import type { TestContext } from "node:test";
import { preview } from "vite";
import { test as base, expect } from "@playwright/test";
import { imageGenerationFixture } from "../support/image-generation.js";

/** Real API, restricted DB roles and transactional queue; provider stays explicitly synthetic.
 * We stop at queued/unknown in these browser tests; no media decoding or AI quality claim. */
export async function startCanvasGenerationRuntime(
  port = Number(process.env.SCENEDESK_E2E_PORT ?? 4461) + 2,
) {
  if (process.env.PROVIDER_MODE !== "mock")
    throw Error("Canvas E2E requires PROVIDER_MODE=mock");
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
    throw Error("Invalid fixture port");
  const cleanups: (() => void | Promise<void>)[] = [];
  const origin = `http://127.0.0.1:${port}`;
  const lifecycle = {
    after: (close: () => void | Promise<void>) => {
      cleanups.push(close);
    },
  } as TestContext;
  let web: Awaited<ReturnType<typeof preview>> | undefined;
  let fixture: Awaited<ReturnType<typeof imageGenerationFixture>> | undefined;
  async function stop() {
    if (web)
      await new Promise<void>((resolve, reject) => {
        if ("closeAllConnections" in web!.httpServer) web!.httpServer.closeAllConnections();
        web!.httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    fixture?.app.server.closeAllConnections();
    const failures: unknown[] = [];
    // node:test after hooks are registered in dependency order by imageGenerationFixture.
    for (const close of cleanups)
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    if (failures.length)
      throw new AggregateError(
        failures,
        "Canvas generation fixture cleanup failed",
      );
  }
  try {
    fixture = await imageGenerationFixture(lifecycle, undefined, { origin });
    const apiOrigin = await fixture.app.listen({ host: "127.0.0.1", port: 0 });
    web = await preview({
      configFile: false,
      root: fileURLToPath(new URL("../../apps/web/", import.meta.url)),
      logLevel: "error",
      build: { outDir: "dist" },
      preview: {
        host: "127.0.0.1",
        port,
        strictPort: true,
        proxy: { "/v1": apiOrigin, "/health": apiOrigin, "/design": apiOrigin },
      },
    });
    return { ...fixture, origin, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
export const test = base.extend<{
  generation: Awaited<ReturnType<typeof startCanvasGenerationRuntime>>;
}>({
  generation: [
    async ({ context }, use) => {
      const f = await startCanvasGenerationRuntime();
      try {
        await context.addCookies([
          {
            name: "session",
            value: f.owner.token,
            url: f.origin,
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
        await use(f);
      } finally {
        await f.stop();
      }
    },
    { timeout: 120_000 },
  ],
});
export { expect };

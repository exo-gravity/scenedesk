import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { startWorkspaceRuntime, seedWorkspace } from "./fixture.js";
import { startShotMedia } from "./shot-media.js";
import { seedShotList } from "./shot-list-fixture.js";

// Standalone synthetic acceptance harness, never imported by a product entrypoint.
process.env.SCENEDESK_E2E_HOST ??= "127.0.0.2";
process.env.SCENEDESK_E2E_PORT ??= "4464";
const host = process.env.SCENEDESK_E2E_HOST;
const storage = await startShotMedia();
let runtime: Awaited<ReturnType<typeof startWorkspaceRuntime>> | undefined;
let bootstrap: ReturnType<typeof createServer> | undefined;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (bootstrap)
    await new Promise<void>((resolve, reject) => {
      bootstrap!.closeAllConnections();
      bootstrap!.close((error) => (error ? reject(error) : resolve()));
    });
  try {
    await runtime?.stop();
  } finally {
    await storage.stop();
  }
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => void stop().then(() => process.exit(0)));
try {
  runtime = await startWorkspaceRuntime({ media: storage.media });
  const w = await seedWorkspace(runtime);
  await seedShotList(w);
  bootstrap = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/") {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(303, {
      "Set-Cookie": `session=${w.owner.token}; HttpOnly; SameSite=Lax; Path=/`,
      "Cache-Control": "no-store",
      Location: `${w.runtime.origin}${w.basePath}/canvas`,
    });
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    bootstrap!.once("error", reject);
    bootstrap!.listen(0, host, resolve);
  });
  console.log(
    `Synthetic shot-list preview: http://${host}:${(bootstrap.address() as AddressInfo).port}/`,
  );
  console.log(
    "Open the loopback link to enter the synthetic identity. Ctrl-C removes the isolated schema and both servers.",
  );
} catch (error) {
  await stop();
  throw error;
}

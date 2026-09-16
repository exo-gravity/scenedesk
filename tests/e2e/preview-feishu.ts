import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { startWorkspaceRuntime, seedWorkspace } from "./fixture.js";
import { docxFixture } from "../support/docx.js";

// Isolated synthetic CUA acceptance harness. Never imported by product code.
process.env.SCENEDESK_E2E_HOST = "::1";
process.env.SCENEDESK_E2E_PORT ??= "4347";
const runtime = await startWorkspaceRuntime();
const workspace = await seedWorkspace(runtime),
  fixture = runtime.feishu;
fixture.config.tenantId = workspace.tenant.id;
const bindings = [
  { projectId: workspace.project.id, url: fixture.sourceUrl },
  { projectId: workspace.project.id, url: fixture.wikiUrl },
];
fixture.config.sources = bindings;
const bootstrap = createServer((request, response) => {
  if (request.method !== "GET" || request.url !== "/") {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(303, {
    "Set-Cookie": `session=${workspace.owner.token}; HttpOnly; SameSite=Lax; Path=/`,
    "Cache-Control": "no-store",
    Location: `${runtime.origin}${workspace.basePath}/script`,
  });
  response.end();
});
await new Promise<void>((resolve, reject) => {
  bootstrap.once("error", reject);
  bootstrap.listen(0, "::1", resolve);
});
await mkdir(".runtime", { recursive: true });
const control = ".runtime/feishu-preview-control";
await writeFile(control, "allow");
let previous = "allow";
const interval = setInterval(() => {
  void readFile(control, "utf8")
    .then((text) => {
      const command = text.trim();
      if (command === previous) return;
      previous = command;
      if (command === "deny") fixture.state.denied = true;
      if (command === "allow") {
        fixture.state.denied = false;
        fixture.config.sources = bindings;
      }
      if (command === "unbound") fixture.config.sources = [];
      if (command === "updated") {
        fixture.state.bytes = docxFixture(
          "<w:p><w:r><w:t>合成飞书更新稿：林夏在窗边读信。</w:t></w:r></w:p>",
        );
        fixture.state.revision++;
      }
      console.log(
        `Synthetic Feishu control: ${["deny", "allow", "unbound", "updated"].includes(command) ? command : "ignored"}`,
      );
    })
    .catch(() => {});
}, 250);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(interval);
  bootstrap.closeAllConnections();
  await new Promise<void>((resolve) => bootstrap.close(() => resolve()));
  await runtime.stop();
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => void stop().then(() => process.exit(0)));
console.log(
  `Synthetic Feishu bootstrap: http://[::1]:${(bootstrap.address() as AddressInfo).port}/`,
);
console.log(`Synthetic source: ${fixture.wikiUrl}`);
console.log(
  `Control file: ${control} accepts allow / deny / unbound / updated. All provider responses are synthetic; business API and persistence are real.`,
);

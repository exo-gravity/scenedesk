import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const commands = [
  ["npm", ["run", "check"]],
  ["npm", ["run", "db:migrate"]],
  ["npm", ["run", "test:db"]],
  ["npm", ["run", "worker:check"]],
  ["npm", ["run", "mock:scenarios"]],
  ["npm", ["audit", "--json"]],
  [".venv/bin/python", ["docs/implementation/check_design.py"]],
];
const report = {
  checkedAt: new Date().toISOString(),
  node: process.version,
  npm: spawnSync("npm", ["--version"], { encoding: "utf8" }).stdout.trim(),
  scope: "S0 infrastructure and static contract; no business acceptance",
  checks: [],
  fileHashes: {},
};
const reportPath = `output/engineering/${report.checkedAt.replace(/[:.]/g, "-")}-checks.json`;
for (const [command, args] of commands) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 60_000,
  });
  const check = {
    command: [command, ...args].join(" "),
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error?.message,
  };
  report.checks.push(check);
  console.log(`${result.status === 0 ? "PASS" : "FAIL"} ${check.command}`);
  if (result.status !== 0) {
    console.log(result.stderr || result.stdout);
    break;
  }
}
for (const file of [
  "package-lock.json",
  "compose.yaml",
  "docs/implementation/openapi.json",
  "packages/contracts/src/generated.ts",
  "apps/web/src/App.tsx",
  "apps/web/src/main.tsx",
  "apps/web/src/style.css",
])
  report.fileHashes[file] = createHash("sha256")
    .update(readFileSync(file))
    .digest("hex");
report.passed =
  report.checks.length === commands.length &&
  report.checks.every((item) => item.exitCode === 0);
mkdirSync("output/engineering", { recursive: true });
writeFileSync(
  reportPath,
  JSON.stringify(report, null, 2) + "\n",
);
console.log(`Report: ${reportPath}`);
if (!report.passed) process.exitCode = 1;

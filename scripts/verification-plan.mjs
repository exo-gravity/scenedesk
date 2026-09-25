import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const stages = ["docs", "check", "db", "worker", "media", "e2e", "preview", "deploy", "recovery"];
export const expensive = ["db", "media", "e2e", "preview", "deploy", "recovery"];
export const isDocumentation = (file) => /\.md$/i.test(file) || file.startsWith("output/") ||
  /^docs\/.*\.(png|jpe?g|webp|svg|gif|pdf)$/i.test(file);

// Shared runtime inputs fall back to all checks; this maps impact, not just changed tests.
export function classify(files) {
  const selected = new Set(files.length ? ["docs"] : []);
  const reasons = {};
  const add = (file, names) => {
    for (const name of names) {
      selected.add(name);
      (reasons[name] ??= []).push(file);
    }
  };
  for (const file of files) {
    if (isDocumentation(file)) continue;
    add(file, ["check"]);
    if (/^(\.github\/workflows\/|\.githooks\/|scripts\/(preflight|verification-plan)\.mjs$|scenedesk-preflight\.sh$|tests\/preflight\.test\.ts$)/.test(file)) {
      continue;
    } else if (/^(package(-lock)?\.json|\.nvmrc|tsconfig[^/]*\.json)$/.test(file) || /\/package(-lock)?\.json$/.test(file)) {
      add(file, stages);
    } else if (file.startsWith("apps/web/")) {
      add(file, ["e2e"]);
      if (/^apps\/web\/(src\/pages\/|public\/design\/)/.test(file)) add(file, ["preview"]);
    } else if (file.startsWith("tests/e2e/")) {
      add(file, ["e2e"]);
    } else if (file.startsWith("tests/integration/")) {
      add(file, ["db"]);
    } else if (file.startsWith("tests/media/")) {
      add(file, ["db", "worker", "media"]);
    } else if (/^tests\/[^/]+\.test\.ts$/.test(file)) {
      continue;
    } else if (file.startsWith("deploy/")) {
      add(file, ["deploy", "recovery"]);
    } else if (/^(packages\/(media|queue|provider)\/|apps\/worker\/)/.test(file)) {
      add(file, ["db", "worker", "media"]);
    } else if (file.startsWith("apps/api/")) {
      add(file, ["db", "e2e"]);
      if (!file.startsWith("apps/api/src/modules/") || /^apps\/api\/src\/modules\/(media|generation|assets|candidates)\//.test(file)) {
        add(file, ["worker", "media"]);
      }
    } else if (file === "scripts/check-script-preview.ts") {
      add(file, ["e2e", "preview"]);
    } else {
      // Database, contracts, domain, shared fixtures, executable docs and unknown paths are cross-cutting.
      add(file, stages);
    }
  }
  return { files, stages: stages.filter((stage) => selected.has(stage)), reasons };
}

export function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}
const split = (value) => value.split("\0").filter(Boolean);
const commit = (ref) => git(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]).trim();

export function changedFiles({ base = process.env.BASE ?? "origin/main", ci = false } = {}) {
  if (ci) {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    if (process.env.GITHUB_EVENT_NAME === "pull_request") {
      return split(git(["diff", "--name-only", "--no-renames", "-z", `${commit(event.pull_request.base.sha)}...HEAD`, "--"]));
    }
    if (process.env.GITHUB_EVENT_NAME === "push" && event.before && !/^0+$/.test(event.before)) {
      return split(git(["diff", "--name-only", "--no-renames", "-z", commit(event.before), "HEAD", "--"]));
    }
    if (process.env.GITHUB_EVENT_NAME === "workflow_dispatch" && git(["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(" ").length > 1) {
      return split(git(["diff", "--name-only", "--no-renames", "-z", "HEAD^", "HEAD", "--"]));
    }
    // An initial push/root commit has no previous snapshot; inspect the whole tree.
    return split(git(["ls-files", "-z"]));
  }
  return [...new Set([
    ...split(git(["diff", "--name-only", "--no-renames", "-z", `${commit(base)}...HEAD`, "--"])),
    ...split(git(["diff", "--name-only", "--no-renames", "-z", "HEAD", "--"])),
    ...split(git(["ls-files", "--others", "--exclude-standard", "-z"])),
  ])].sort();
}

export function plan({ files, all = false, heavy = false, e2e = false, skipHeavy = false }) {
  if (skipHeavy && (all || heavy || e2e)) throw new Error("--skip-heavy 不能与 --all、--heavy 或 --e2e 同用");
  const result = classify(files);
  const wanted = new Set(result.stages);
  if (all) for (const stage of stages) wanted.add(stage);
  if (heavy) for (const stage of ["docs", "check", "deploy", "recovery"]) wanted.add(stage);
  if (e2e) for (const stage of ["docs", "check", "e2e"]) wanted.add(stage);
  result.omitted = skipHeavy ? stages.filter((stage) => wanted.has(stage) && expensive.includes(stage)) : [];
  result.stages = stages.filter((stage) => wanted.has(stage) && !result.omitted.includes(stage));
  result.complete = result.omitted.length === 0;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => !["--ci", "--stdin", "--all"].includes(arg))) throw new Error("Unknown planner option");
    const files = args.includes("--stdin") ? JSON.parse(readFileSync(0, "utf8")) : changedFiles({ ci: args.includes("--ci") });
    if (!Array.isArray(files) || files.some((file) => typeof file !== "string")) throw new Error("Expected a JSON array of file paths");
    const result = plan({ files, all: args.includes("--all") || process.env.SCENEDESK_VERIFY_ALL === "true" });
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, stages.map((stage) => `${stage}=${result.stages.includes(stage)}\n`).join(""));
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(import.meta.dirname, "..");
const planner = join(root, "scripts/verification-plan.mjs");
type Plan = { files: string[]; stages: string[]; omitted: string[]; complete: boolean };
const full = ["docs", "check", "db", "worker", "media", "e2e", "preview", "deploy", "recovery"];
function classify(files: string[]): Plan {
  return JSON.parse(execFileSync(process.execPath, [planner, "--stdin"], {
    input: JSON.stringify(files), encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: "", SCENEDESK_VERIFY_ALL: "false" },
  }));
}

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "scenedesk-preflight-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const put = (path: string, content: string) => {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), content);
  };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: directory, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.name", "Verification fixture");
  git("config", "user.email", "verification@example.test");
  for (const file of ["scripts/verification-plan.mjs", "scripts/preflight.mjs", "scenedesk-preflight.sh"]) {
    mkdirSync(dirname(join(directory, file)), { recursive: true });
    cpSync(join(root, file), join(directory, file));
  }
  put(".gitignore", "/bin/\n/.runtime/\n/node_modules/\n");
  put("README.md", "Fixture\n");
  put("docs/README.md", "Fixture docs\n");
  put("apps/web/src/page.tsx", "original\n");
  put("packages/media/src/probe.ts", "original\n");
  git("add", "."); git("commit", "-qm", "fixture baseline"); git("branch", "baseline");
  put("bin/command", `#!${process.execPath}
const fs=require('node:fs');
const path=require('node:path');
const name=path.basename(process.argv[1]);
const args=process.argv.slice(2);
if (args[0]==='--version') { console.log(name==='npm'?'10.9.8':'Python 3.14'); process.exit(0); }
if (args.join(' ')==='-m pip freeze') { console.log('fixture==1'); process.exit(0); }
fs.mkdirSync('.runtime',{recursive:true});
fs.appendFileSync('.runtime/commands.jsonl',JSON.stringify([name,...args])+'\\n');
if (fs.existsSync('.runtime/fail') && name==='npm' && args.join(' ')==='run check') process.exit(7);
if (fs.existsSync('.runtime/change-during-check') && name==='npm' && args.join(' ')==='run check') fs.appendFileSync('apps/web/src/page.tsx','changed');
if (fs.existsSync('.runtime/wait') && name==='npm' && args.join(' ')==='run check') {
  fs.writeFileSync('.runtime/check-started','1');
  setInterval(()=>{},1000);
}
`);
  for (const name of ["npm", "python", "docker"]) {
    cpSync(join(directory, "bin/command"), join(directory, `bin/${name}`));
    chmodSync(join(directory, `bin/${name}`), 0o755);
  }
  const env = {
    ...process.env, PATH: `${join(directory, "bin")}:${process.env.PATH}`, PYTHON: join(directory, "bin/python"),
    DATABASE_URL: "postgresql://fixture:synthetic@127.0.0.1:5432/drama_e2e_gate", BASE: "baseline",
  };
  const run = (...args: string[]) => spawnSync("bash", ["scenedesk-preflight.sh", ...args], { cwd: directory, env, encoding: "utf8" });
  const selection = (...args: string[]): Plan => {
    const result = run("--plan", ...args);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const commands = (): string[][] => {
    try { return readFileSync(join(directory, ".runtime/commands.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
    catch { return []; }
  };
  return { directory, put, git, env, run, selection, commands };
}

test("verification selection follows changed behavior and conservatively includes shared inputs", () => {
  const cases: [string[], string[]][] = [
    [[], []],
    [["README.md", "docs/design/screen.png", "output/documentation-checks/report.json"], ["docs"]],
    [["apps/web/src/business/Projects.tsx", "apps/web/src/studio/studio.module.css"], ["docs", "check", "e2e"]],
    [["apps/web/src/pages/Preview.tsx"], ["docs", "check", "e2e", "preview"]],
    [["tests/e2e/studio-entry.spec.ts"], ["docs", "check", "e2e"]],
    [["apps/api/src/modules/projects/routes.ts"], ["docs", "check", "db", "e2e"]],
    [["apps/api/src/modules/media/routes.ts"], ["docs", "check", "db", "worker", "media", "e2e"]],
    [["packages/media/src/probe.ts"], ["docs", "check", "db", "worker", "media"]],
    [["apps/worker/src/main.ts"], ["docs", "check", "db", "worker", "media"]],
    [["tests/integration/canvas.test.ts"], ["docs", "check", "db"]],
    [["tests/canvas.test.ts"], ["docs", "check"]],
    [["deploy/Dockerfile"], ["docs", "check", "deploy", "recovery"]],
    [["scripts/preflight.mjs", ".github/workflows/ci.yml"], ["docs", "check"]],
    [["packages/database/migrations/next.sql"], full],
    [["packages/contracts/src/generated.ts"], full],
    [["docs/implementation/canvas_contract.py"], full],
    [["docs/implementation/sample-payloads.json"], full],
    [["package-lock.json"], full],
    [["apps/web/package.json"], full],
    [["tests/support/storage.ts"], full],
    [["new-runtime/config.yml"], full],
  ];
  for (const [files, expected] of cases) assert.deepEqual(classify(files).stages, expected, files.join(", "));
});

test("local planning includes staged renames, deleted files, unstaged and untracked paths", (t) => {
  const f = fixture(t);
  f.git("mv", "packages/media/src/probe.ts", "docs/moved.md");
  f.put("apps/web/src/page.tsx", "changed\n");
  f.put("tests/integration/new.test.ts", "new\n");
  const result = f.selection();
  assert.ok(result.files.includes("packages/media/src/probe.ts"), "renamed source must keep its original impact");
  assert.ok(result.files.includes("docs/moved.md"));
  assert.ok(result.files.includes("tests/integration/new.test.ts"));
  assert.deepEqual(result.stages, ["docs", "check", "db", "worker", "media", "e2e"]);
  assert.equal(f.commands().length, 0, "planning must not start dependencies or tests");
  assert.notEqual(f.run("--plan", "--base", "missing-ref").status, 0);
});

test("CLI overrides expose omitted checks and reject contradictory flags", (t) => {
  const f = fixture(t);
  f.put("packages/media/src/probe.ts", "changed\n");
  assert.deepEqual(f.selection("--all").stages, full);
  const skipped = f.selection("--skip-heavy");
  assert.deepEqual(skipped.stages, ["docs", "check", "worker"]);
  assert.deepEqual(skipped.omitted, ["db", "media"]);
  assert.equal(skipped.complete, false);
  assert.notEqual(f.run("--plan", "--skip-heavy", "--all").status, 0);
  assert.notEqual(f.run("--base").status, 0);
});

test("CI plans use the PR merge base or push before SHA and fail closed for missing history", (t) => {
  const f = fixture(t);
  const before = f.git("rev-parse", "HEAD").trim();
  f.git("mv", "packages/media/src/probe.ts", "docs/moved.md");
  f.git("commit", "-qm", "move fixture");
  const eventFile = join(f.directory, ".runtime/event.json"), output = join(f.directory, ".runtime/outputs");
  const ci = (event: object, name: string) => {
    f.put(".runtime/event.json", JSON.stringify(event));
    return spawnSync(process.execPath, [planner, "--ci"], { cwd: f.directory, encoding: "utf8",
      env: { ...f.env, GITHUB_EVENT_PATH: eventFile, GITHUB_EVENT_NAME: name, GITHUB_OUTPUT: output, SCENEDESK_VERIFY_ALL: "false" } });
  };
  for (const [event, name] of [[{ pull_request: { base: { sha: before } } }, "pull_request"], [{ before }, "push"], [{}, "workflow_dispatch"]] as const) {
    const result = ci(event, name);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).stages, ["docs", "check", "db", "worker", "media"]);
    assert.match(readFileSync(output, "utf8"), /media=true\ne2e=false/);
  }
  assert.notEqual(ci({ pull_request: { base: { sha: "missing" } } }, "pull_request").status, 0);
});

test("docs run without npm, databases or Docker and only successful identical static inputs are reused", (t) => {
  const f = fixture(t);
  f.put("README.md", "changed\n");
  let result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.commands(), [["python", "docs/implementation/check_design.py"]]);
  result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /复用 docs/);
  assert.equal(f.commands().length, 1);
  f.put("README.md", "changed again\n");
  assert.equal(f.run().status, 0);
  assert.equal(f.commands().length, 2, "changed content invalidates the receipt");
});

test("frontend runs browser checks but no media; failure invalidates a previous static success", (t) => {
  const f = fixture(t);
  f.put("apps/web/src/page.tsx", "changed\n");
  assert.equal(f.run().status, 0);
  assert.deepEqual(f.commands().filter(([command]) => command === "npm"), [["npm", "ci"], ["npm", "run", "check"], ["npm", "run", "test:e2e"]]);
  f.put("README.md", "documentation only\n");
  const docsOnly = f.run();
  assert.equal(docsOnly.status, 0);
  assert.match(docsOnly.stdout, /复用 check/, "documentation changes do not invalidate unchanged code checks");
  assert.doesNotMatch(docsOnly.stdout, /复用 docs/);
  assert.equal(f.commands().filter((command) => command.join(" ") === "npm run test:e2e").length, 2, "integration results are never cached");
  f.put(".runtime/fail", "1");
  const failed = f.run("--no-cache");
  assert.notEqual(failed.status, 0);
  assert.doesNotMatch(failed.stdout, /所选范围的门禁通过/);
  const lastBefore = f.commands().length;
  const failedAgain = f.run();
  assert.notEqual(failedAgain.status, 0, "failed forced rerun must discard the older success");
  assert.deepEqual(f.commands().slice(lastBefore), [["npm", "ci"], ["npm", "run", "check"]]);
  rmSync(join(f.directory, ".runtime/fail"));
  assert.equal(f.run().status, 0);
});

test("changed inputs during execution and changed environments cannot reuse success", (t) => {
  const f = fixture(t);
  f.put("apps/web/src/page.tsx", "changed\n");
  f.put(".runtime/change-during-check", "1");
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /执行期间输入发生变化/);
  rmSync(join(f.directory, ".runtime/change-during-check"));
  assert.equal(f.run().status, 0);
  f.env.DATABASE_URL = "postgresql://fixture:synthetic@127.0.0.1:5433/drama_e2e_other";
  const next = f.run();
  assert.equal(next.status, 0);
  assert.doesNotMatch(next.stdout, /复用/);
});

test("a running or orphaned verification lock blocks another checkout and unsafe database targets fail early", (t) => {
  const f = fixture(t);
  f.put("README.md", "changed\n");
  f.put(".git/scenedesk-verification/running/owner.json", JSON.stringify({ pid: process.pid }));
  assert.match(f.run().stderr, /已有 preflight/);
  const other = join(f.directory, ".runtime/other");
  f.git("worktree", "add", "--quiet", "--detach", other, "HEAD");
  writeFileSync(join(other, "README.md"), "changed\n");
  const concurrent = spawnSync("bash", ["scenedesk-preflight.sh"], { cwd: other, env: f.env, encoding: "utf8" });
  assert.match(concurrent.stderr, /已有 preflight/, "worktrees share the same execution lock");
  f.put(".git/scenedesk-verification/running/owner.json", JSON.stringify({ pid: -1 }));
  assert.match(f.run().stderr, /未清理锁/);
  assert.equal(f.commands().length, 0);
  rmSync(join(f.directory, ".git/scenedesk-verification/running"), { recursive: true });
  f.put("apps/web/src/page.tsx", "changed\n");
  f.env.DATABASE_URL = "postgresql://fixture:private_password@db.example.test/prod";
  const unsafe = f.run();
  assert.notEqual(unsafe.status, 0);
  assert.doesNotMatch(unsafe.stderr, /private_password/);
  assert.equal(f.commands().length, 0);
});

test("interruption releases the lock without retaining a previous static success", async (t) => {
  const f = fixture(t);
  f.put("apps/web/src/page.tsx", "changed\n");
  assert.equal(f.run().status, 0);
  f.put(".runtime/wait", "1");
  const running = spawn("bash", ["scenedesk-preflight.sh", "--no-cache"], { cwd: f.directory, env: f.env, stdio: "ignore" });
  t.after(() => running.kill("SIGTERM"));
  const finished = new Promise<number | null>((accept) => running.once("exit", accept));
  const deadline = Date.now() + 10_000;
  while (!existsSync(join(f.directory, ".runtime/check-started")) && Date.now() < deadline) await delay(25);
  assert.ok(existsSync(join(f.directory, ".runtime/check-started")), "wait until the check is executing");
  running.kill("SIGTERM");
  assert.equal(await finished, 1);
  assert.equal(existsSync(join(f.directory, ".git/scenedesk-verification/running")), false);
  rmSync(join(f.directory, ".runtime/wait"));
  const next = f.run();
  assert.equal(next.status, 0, next.stderr);
  assert.doesNotMatch(next.stdout, /复用 check/);
});

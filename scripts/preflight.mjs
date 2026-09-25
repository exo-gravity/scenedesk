import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { changedFiles, git, isDocumentation, plan } from "./verification-plan.mjs";

const help = `用法: bash scenedesk-preflight.sh [选项]
默认根据分支提交、暂存区、工作区和未跟踪文件选择检查，串行执行。
  --plan         只输出检查计划，不安装依赖或运行检查
  --base REF     比较基线（默认 BASE 或 origin/main）
  --all          强制完整检查，包括媒体、部署、浏览器及隔离恢复
  --heavy        在自动计划上追加部署、四镜像、smoke 和隔离恢复
  --e2e          在自动计划上追加浏览器回归
  --skip-heavy   仅静态/单元/Worker 检查；列出省略项，不算完整门禁
  --no-cache     重新执行静态检查，不复用本脚本的成功记录
  --help         显示帮助
纯 Markdown/文档图片只检查文档；可执行契约及未知路径保守扩大范围。
静态成功记录仅在文件、依赖锁和环境指纹一致时复用。集成检查不缓存。
PYTHON 指向已安装 validation-requirements.txt 的 Python，默认 .venv/bin/python。
需要数据库的本地检查须显式指定回环 DATABASE_URL，库名以 drama_e2e 开头。`;

const options = { all: false, heavy: false, e2e: false, skipHeavy: false };
let base = process.env.BASE ?? "origin/main", dryRun = false, reuse = true;
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  switch (args[index]) {
    case "--help": case "-h": console.log(help); process.exit(0); break;
    case "--all": options.all = true; break;
    case "--heavy": options.heavy = true; break;
    case "--e2e": options.e2e = true; break;
    case "--skip-heavy": options.skipHeavy = true; break;
    case "--no-cache": reuse = false; break;
    case "--plan": dryRun = true; break;
    case "--base": base = args[++index]; if (base) break; /* falls through */
    default: console.error(`无效参数: ${args[index] ?? "--base 缺少参数"}`); process.exit(2);
  }
}

let child, interrupted = false;
const stop = (signal) => {
  interrupted = true;
  if (child?.pid) {
    try { process.kill(process.platform === "win32" ? child.pid : -child.pid, signal); } catch { /* already exited */ }
  }
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
async function run(command, argv, env = process.env) {
  if (interrupted) throw new Error("检查已中止");
  console.log(`> ${command} ${argv.join(" ")}`);
  await new Promise((accept, reject) => {
    child = spawn(command, argv, { stdio: "inherit", env, detached: process.platform !== "win32" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      child = undefined;
      if (code === 0 && !interrupted) accept();
      else reject(new Error(`${command} 未完成（${signal ?? code}）`));
    });
  });
}
const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; }
};

let heldLock;
try {
  const selection = plan({ files: changedFiles({ base }), ...options });
  if (dryRun) { console.log(JSON.stringify(selection, null, 2)); process.exit(0); }
  console.log(`改动 ${selection.files.length} 个文件；检查: ${selection.stages.join(", ") || "无"}`);
  if (selection.omitted.length) console.log(`已显式省略: ${selection.omitted.join(", ")}；本次不构成完整门禁。`);
  if (!selection.stages.length) process.exit(0);
  if (selection.stages.some((stage) => ["db", "media", "e2e", "deploy"].includes(stage))) {
    let url;
    try { url = new URL(process.env.DATABASE_URL); } catch { /* reported without exposing credentials */ }
    if (!url || !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !/^\/drama_e2e[a-zA-Z0-9_]*$/.test(url.pathname)) {
      throw new Error("请显式提供回环一次性 drama_e2e* 测试库的 DATABASE_URL；未启动检查。");
    }
  }

  const state = resolve(git(["rev-parse", "--git-common-dir"]).trim(), "scenedesk-verification");
  mkdirSync(state, { recursive: true });
  const lock = resolve(state, "running");
  try { mkdirSync(lock); } catch (error) {
    if (error.code !== "EEXIST") throw error;
    // Fail closed for stale/incomplete locks too: an orphan child could still own containers.
    let owner;
    try { owner = JSON.parse(readFileSync(resolve(lock, "owner.json"), "utf8")); } catch { /* incomplete lock */ }
    throw new Error(owner && alive(owner.pid)
      ? "本仓库已有 preflight 在执行；请等待完成，避免跨 worktree 争抢资源。"
      : `上轮 preflight 未清理锁；核对残留进程后移除 ${lock}`);
  }
  heldLock = lock;
  writeFileSync(resolve(lock, "owner.json"), JSON.stringify({ pid: process.pid }));

  const python = process.env.PYTHON ?? ".venv/bin/python";
  const versions = { node: process.version, platform: process.platform, arch: process.arch };
  if (selection.stages.includes("docs")) {
    versions.python = execFileSync(python, ["--version"], { encoding: "utf8" }).trim();
    versions.pythonPackages = execFileSync(python, ["-m", "pip", "freeze"], { encoding: "utf8" }).trim();
  }
  if (selection.stages.some((stage) => stage !== "docs")) {
    versions.npm = execFileSync("npm", ["--version"], { encoding: "utf8" }).trim();
    // Reinstall from the lock before reusing a code check; modified node_modules cannot validate a receipt.
    await run("npm", ["ci"]);
  }
  const fingerprint = (stage) => {
    const hash = createHash("sha256");
    hash.update(JSON.stringify({ stage, versions, env: Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b)) }));
    const files = new Set(git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean));
    for (const name of readdirSync(".")) if (name.startsWith(".env")) files.add(name);
    for (const file of [...files].sort()) {
      if (file.startsWith("output/") || (stage === "check" && isDocumentation(file))) continue;
      hash.update(`${file}\0`);
      if (!existsSync(file)) { hash.update("deleted\0"); continue; }
      const stat = lstatSync(file);
      hash.update(`${stat.mode}\0`);
      hash.update(stat.isSymbolicLink() ? readlinkSync(file) : stat.isFile() ? readFileSync(file) : "directory");
    }
    return hash.digest("hex");
  };
  const staticCheck = async (stage, command, argv) => {
    const key = fingerprint(stage), receipt = resolve(state, `${stage}-${key}.json`);
    if (reuse && existsSync(receipt)) {
      const previous = JSON.parse(readFileSync(receipt, "utf8"));
      if (previous.passed === true && previous.key === key) {
        console.log(`复用 ${stage}：${previous.completedAt} 的完整成功记录（输入与环境一致）`);
        return;
      }
    }
    rmSync(receipt, { force: true });
    await run(command, argv);
    if (key !== fingerprint(stage)) throw new Error(`${stage} 执行期间输入发生变化；不记录成功，请重新检查`);
    writeFileSync(receipt, JSON.stringify({ key, passed: true, completedAt: new Date().toISOString() }));
  };
  const integrationEnv = { ...process.env, PROVIDER_MODE: "mock" };
  const deployEnv = { ...process.env };
  delete deployEnv.DATABASE_URL;
  const nodeTests = async (directory, env) => run(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1",
    ...readdirSync(directory).filter((name) => name.endsWith(".test.ts")).sort().map((name) => `${directory}/${name}`)], env);
  for (const stage of selection.stages) {
    console.log(`\n==> ${stage}`);
    switch (stage) {
      case "docs": await staticCheck(stage, python, ["docs/implementation/check_design.py"]); break;
      case "check": await staticCheck(stage, "npm", ["run", "check"]); break;
      case "db": await run("npm", ["run", "db:migrate"], integrationEnv); await run("npm", ["run", "test:db"], integrationEnv); break;
      case "worker": await run("npm", ["run", "worker:check"], integrationEnv); break;
      case "media": await run("npm", ["run", "test:media:prepare"], integrationEnv); await run("npm", ["run", "test:media"], integrationEnv); break;
      case "e2e": await run("npm", ["run", "test:e2e"], integrationEnv); break;
      case "preview": await run("npm", ["run", "check:design-preview"]); break;
      case "deploy":
        await run("sh", ["deploy/check.sh"], deployEnv);
        await nodeTests("deploy/integration", integrationEnv);
        for (const [target, name] of [["api", "api"], ["web", "web"], ["media-worker", "worker"], ["generation-worker", "generation"]]) {
          await run("docker", ["build", "-f", "deploy/Dockerfile", "--target", target, "-t", `scenedesk-private-${name}:local`, "."], deployEnv);
        }
        await run("bash", ["deploy/smoke/run.sh"], { ...deployEnv, SCENEDESK_IMAGE_TAG: "local" });
        break;
      case "recovery":
        await run("npm", ["run", "test:media:prepare"], deployEnv);
        await nodeTests("deploy/recovery", deployEnv);
        break;
    }
  }
  console.log(selection.complete ? "所选范围的门禁通过。未选中的套件不计为已执行。" : "部分检查通过；省略的检查仍未完成。");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (heldLock) rmSync(heldLock, { recursive: true, force: true });
}

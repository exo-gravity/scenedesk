# Private workspace deployment package

This package builds a static production web image, a same-origin HTTPS gateway/API, a separate media worker for imports and already-received generated files, and an optional generation executor for verified-provider paid model calls (gated behind the `generation` Compose profile; see "生成执行器" below). It does not enable a paid model by default, supply a real identity provider, or represent a completed production deployment.

The original package procedure and credential contract are recorded in [implementation note 47](../docs/implementation/47-private-deployment-package.md). The current image-mainline integration, strict generation audit and independent CI are described in [implementation note 52](../docs/implementation/52-private-deployment-integration.md).

For the first workspace owner after a trusted login, follow [the private operator bootstrap](../docs/implementation/55-private-owner-bootstrap.md). It uses the existing authenticated API, defaults to read-only preflight and requires an explicit apply. An unknown creation is never resent; selecting an existing workspace verifies current ownership without claiming it is the original request result.

Enabled model capability records do not mean this deployment can execute them. Until `api.json` sets `"generationExecutor": true` (together with the `generation` profile below), the API returns `503 GENERATION_EXECUTOR_UNAVAILABLE` for new verified-provider generation jobs, preserving plan preparation, history and original-file archive recovery. The read-only audit refuses unresolved submissions or archive states without a fixed `generation_media_outputs` record; it never disables capabilities or clears jobs to pass a check.

Check the deployment entrypoints, configuration boundaries and private operator files after `npm ci`:

```sh
sh deploy/check.sh
```

The independent `SceneDesk deployment package` workflow also tests the audit against an isolated PostgreSQL database, builds all four images and runs the API/queue/browser-contract smoke. It does not push an image or deploy external resources.

Build from the repository root:

```sh
docker build -f deploy/Dockerfile --target api -t scenedesk-private-api:local .
docker build -f deploy/Dockerfile --target web -t scenedesk-private-web:local .
docker build -f deploy/Dockerfile --target media-worker -t scenedesk-private-worker:local .
docker build -f deploy/Dockerfile --target generation-worker -t scenedesk-private-generation:local .
```

Configuration examples deliberately cannot start unchanged. Copy them outside the checkout, replace the placeholders, and mount only each service's own file. Do not run local development setup scripts against a real deployment.

`SCENEDESK_DECODER_SOCKET` is required and must name the absolute socket path of a dedicated decoder daemon (for example `/run/scenedesk-decoder/docker.sock`). Compose has no default host Docker socket. Confirm that daemon owns only the decoder workload before setting `dedicatedDecoderHost: true`; the JSON assertion does not create host isolation. The smoke override mounts its own daemon's socket volume instead.

## 生成执行器

`generation-worker` 是可选服务，只有显式启用 `generation` profile 才会启动，用来在 `PROVIDER_MODE=verified` 下真正调用付费模型（MiniMax、Volcengine/Ark）。它的配置文件示例是 `deploy/examples/generation.json`，和其他私有配置一样：复制到检出目录之外、替换占位符（数据库 URL、对象存储密钥、`vendors` 的 `apiKey`/`baseUrl`、`connections` 的账号绑定），再只把这一份文件挂载给这一个服务。

启动前，数据库必须已用 `deploy/runtime/provision.ts --apply` 供给：迁移期 `provision.json` 里的 `generationRole` 字段（例如 `scenedesk_generation`）就是执行器登录用的受限角色，供给脚本会把它写入 `generation_runtime_identity`，只授予该角色 schema 的 `USAGE` 和一组固定 `SECURITY DEFINER` 生成函数（包括判断连接是否已供给的 `list_verified_connection_versions()`）的 `EXECUTE` 权限，不授予对任何表的直接读写。执行器进程启动时用这个角色执行 `SELECT drama.generation_worker_login()` 自检；返回不是 `true` 就以 `GENERATION_ROLE_REQUIRED` 失败退出，不会把连接误当作已授权。

执行器上线的同时，把 `api.json` 加上 `"generationExecutor": true` 并重建 `api` 容器；否则网关后的 API 仍以 `503 GENERATION_EXECUTOR_UNAVAILABLE` 拒绝真实模型的新任务（fixture 任务不受影响）。启动执行器：把 `SCENEDESK_GENERATION_CONFIG` 指到本机上那份私有 `generation.json`（Compose 的 `generation_config` secret 会把它挂载为容器内的 `config.json`），再用 `generation` profile 拉起服务：

```sh
SCENEDESK_GENERATION_CONFIG=/absolute/path/to/generation.json \
  docker compose -f deploy/compose.yaml --profile generation up generation-worker
```

只有显式加上 `--generation-executor` 参数，只读审计（`node deploy/runtime/audit.ts --generation-executor`）才会把执行器视为“已配置”，允许 `executor_required_jobs` 非零并把 `newGenerationSubmissionsEnabled` 报告为 `true`；不带该参数时（例如 `operations` 服务的默认调用）审计继续把执行器视为不可用，任何尚未终结的生成任务都会让审计失败——这样就不会在没有真正部署执行器的情况下悄悄放行新的付费提交。

执行器在 4314 端口暴露 `/health/ready`，供 Compose 健康检查和外部探针确认数据库连接与对象存储版本化仍然可用。

演示箱（实现记录 83 的那台）一条命令完成开通：`deploy/demo/enable-generation.sh` 会在本机不回显地读入两家 API key、经 ssh 标准输入写成箱子上的 `secrets/generation.json`，顺带创建 `scenedesk_generation` 角色、补 `provision.json` 的 `generationRole`、`.env` 与 `compose.demo.yaml` 的执行器叠加层，然后调用 `deploy/demo/deploy.sh --force` 完成构建、迁移、能力行发布与执行器启动；最后在明确输入 `yes` 之后跑付费冒烟并只开启冒烟通过的档案。箱子上存在 `generation.json` 时，`deploy/demo/remote.sh` 的每次 rollout 都会带上 `--generation-executor` 审计并拉起 `generation` profile。

`stop_grace_period` 设为 200 秒：200 秒覆盖单个观察租约（180 秒）加余量；一次扫描最多顺序处理 100 个任务，忙时停机会在某次观察中被强制结束，未完成的观察由租约到期后重新领取，不会丢失回执。

The isolated local check creates and removes only its own Compose project and volumes. It requires installed Chrome/Chromium for the original browser contract compiler; set `SCENEDESK_SMOKE_CHROME` to its executable if discovery cannot find it. Missing Chrome fails explicitly rather than skipping that check:

```sh
bash deploy/smoke/run.sh
```

Its OIDC service supplies discovery metadata only and cannot authenticate a user. Its dedicated Docker-in-Docker service is a local test harness, not a production deployment recommendation. It uses port 4338, real PostgreSQL TLS, versioned private object storage, separate API/worker storage users and the pinned networkless decoder image. The harness prefetches the pinned decoder image into its dedicated daemon; task execution does not pull images. The harness leaves private diagnostic files under `.runtime/deploy-smoke-*` for local investigation and never prints credentials. Remove that individual directory when the diagnostic retention period ends.

To retain a failed test project for diagnosis, set `SCENEDESK_SMOKE_KEEP_ON_FAILURE=1`; clean it with the exact project name and configuration paths printed/created by that run. The default cleans up its containers and volumes and reports any cleanup failure. Only fixed stage names and exit codes are printed to CI; private runtime files and browser profiles are not uploaded. The browser proof page is mounted only by the smoke override, never included in the production web image; the browser ignores only the harness certificate while separate curl GET/HEAD checks verify TLS using the ephemeral CA. The harness closes its own browser after verifying the serialized DOM, and fails if the assertion does not arrive within 60 seconds.

## Demo box: one-command deploy

`deploy/demo/deploy.sh [ref] [--force] [--dry-run]` deploys a git ref (default `origin/main`) to the demo box using the operator's own SSH access; the repository holds no host credentials. It exports the ref with `git archive`, rsyncs it to the box, verifies both trees by SHA-256, builds the three images on the box (pausing the co-hosted platform's worker and scheduler for the build), takes a database dump, runs `provision --apply`, the read-only audit and both `--check` entrypoints, recreates the changed containers with `up -d --wait`, writes `DEPLOYED_REVISION` on the box and finishes with the public acceptance checks. `deploy/demo/remote.sh` is the box-side half and is uploaded on every run. Host, domain and paths are overridable through `SCENEDESK_DEMO_HOST`, `SCENEDESK_DEMO_DOMAIN`, `SCENEDESK_DEMO_SRC` and `SCENEDESK_DEMO_HOME`. The previously running images stay tagged `:previous` (and by their short revision) for a manual rollback. The box-specific runbook is kept outside the repository, and this script does not run from CI.

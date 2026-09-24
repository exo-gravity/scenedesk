# 86 真实供应商执行器落地记录

2026-09-22，基线 `bfe55b2`。依据[真实供应商接入设计](../superpowers/specs/2026-09-22-verified-provider-integration-design.md)、[实施计划](../superpowers/plans/2026-09-22-verified-provider-integration.md)、[07 模型接入](07-provider-adapter.md)、[58 异步生成任务](58-async-generation-lifecycle.md)。

## 目的

把画布生成流程里的本地测试适配器换成两家厂商（MiniMax、火山方舟）的真实付费适配器：新增一个独立的生成执行器进程、三条数据库迁移、一份配置文件、一个能力开通脚本和一个人工付费冒烟脚本；现有的任务状态机、队列、归档协议、取消与恢复语义不改。首版落地 7 条模型档案（`minimax/MiniMax-H3` 视频；`volcengine/doubao-seedance-2-0-260128`、`-2-0-fast-260128`、`-2-0-mini-260615` 视频；`volcengine/doubao-seedream-5-0-pro-260628`、`-5-0-flash-260915`、`-5-0-260128` 图片）。落地过程中发现两处需要回写设计的偏差：执行器读参考素材不再靠 `roles.ts` 给 `media` 表加列权限，而是新增 SECURITY DEFINER 函数（`media` 表启用了 RLS，直接授权读不到行）；能力条目在数据库层是不可变身份，开通脚本靠发布新 revision 行而不是原地更新 `definition`。两处已回写[设计文档](../superpowers/specs/2026-09-22-verified-provider-integration-design.md)的 §5、§10。真实账号验证见文末表：MV-01 已于 2026-09-23 在演示箱上对三个档案通过，H3 的 768P 16:9／9:16 实测 1344x768／768x1344 已写回档案，MV-02 证实 H3 接受多张 `reference_image` 后 `reference_v1` 已加回；其余条目仍待执行。

## 模块

与[实施计划的 File Structure](../superpowers/plans/2026-09-22-verified-provider-integration.md#file-structure)一致：

| 文件 | 职责 |
|---|---|
| `packages/provider/src/verified/profiles.ts` | 档案类型、7 条档案、`capabilityDefinition`、`estimateCost`、`resolveOutput`、`findProfile` |
| `packages/provider/src/verified/http.ts` | `jsonRequest`：有界、分类、不重试 |
| `packages/provider/src/verified/inputs.ts` | `MediaResolver`／`ResolvedMedia` 类型、`referenceRoles`、`dataUri`、`referenceLegend` |
| `packages/provider/src/verified/outputs.ts` | `archiveBytes`：字节或 URL → 临时文件 → `publish` → 回执 |
| `packages/provider/src/verified/minimax/client.ts` | MiniMax v2 三个接口 |
| `packages/provider/src/verified/minimax/adapter.ts` | `createMinimaxAdapter` |
| `packages/provider/src/verified/volcengine/client.ts` | 方舟视频三个接口 + 图片同步接口 |
| `packages/provider/src/verified/volcengine/adapter.ts` | `createVolcengineAdapter` |
| `packages/provider/src/verified/config.ts` | `parseGenerationConfig`：`vendors`、`connections` 形状校验（不含数据库与存储） |
| `packages/provider/src/verified/index.ts` | `createVerifiedAdapters(config, deps)` |
| `packages/provider/src/index.ts` | 追加导出 `./verified/index.js`、`./verified/profiles.js`、`./verified/config.js` |
| `packages/database/migrations/0117_verified_provider_runtime.sql` | 放开 verified 回执；租约 180 秒；`read_generation_media_sources(uuid)` |
| `packages/database/migrations/0118_verified_media_plan_source.sql` | `guard_generation_plan_source` 放行 `verified_provider` 能力（`frames_v1`／`reference_v1`） |
| `packages/database/migrations/0119_verified_connection_versions.sql` | `list_verified_connection_versions()`，执行器启动自检用 |
| `packages/database/src/roles.ts` | `generationFunctions` 追加 `read_generation_media_sources(uuid)`、`list_verified_connection_versions()` |
| `apps/api/src/modules/generation/media-input.ts` | 门禁接受 verified 模式 |
| `apps/api/src/modules/generation/model.ts` | 验收门禁改为 `verifiedAt`；真实 `estimateCost`；`costStatus: "pending"` |
| `apps/api/src/modules/generation/worker.ts` | 查询／取消时限 120 秒（原 30 秒） |
| `packages/media/src/generated-output.ts` | 视频时长容差 ±1 秒 |
| `apps/worker/src/verified-runtime.ts` | `createVerifiedGenerationRuntime`：媒体解析、适配器组装、扫描循环 |
| `apps/worker/src/generation-verified.ts` | 本地入口（`APP_ENV=local`，读 JSON 配置） |
| `deploy/runtime/config.ts` | `generationConfiguration`；`PROVIDER_MODE` 接受 `verified` |
| `deploy/runtime/generation-worker.ts` | 生产入口，健康端口 4314，支持 `--check` |
| `deploy/runtime/provision.ts` + `deploy/examples/provision.json` | `generationRole` 授权 |
| `deploy/runtime/deployment-audit.ts` + `deploy/runtime/audit.ts` | `executorConfigured`（`--generation-executor`） |
| `deploy/compose.yaml`、`deploy/Dockerfile`、`deploy/examples/generation.json` | `generation-worker` 服务（`profiles: [generation]`，密钥 `generation_config`）、镜像目标 `generation-worker`、示例配置 |
| `scripts/provision-verified-capabilities.ts` | 从档案写能力行；`--enable` |
| `scripts/verified-smoke.ts` | 人工付费冒烟 |
| `tests/verified-*.test.ts` | 单元测试（假服务器） |
| `tests/integration/verified-plan.test.ts` | API 计划准入（`verifiedAt` 门槛）与真实 `estimateCost` |
| `tests/integration/verified-runtime.test.ts` | 迁移守卫（`read_generation_media_sources` 仅 worker 可调、180 秒租约）+ worker 走假方舟服务端到端归档 |
| `deploy/tests/config.test.ts` | `generationConfiguration` 用例 |
| `docs/implementation/86-verified-provider-runtime.md` | 本记录 |

执行器读参考素材、检查连接版本均不直接查 `media`／`generation_capabilities` 表，而是走 `packages/database/migrations/0117_verified_provider_runtime.sql` 的 `read_generation_media_sources(jobId)`（只返回该 job 所属计划已引用、租户匹配、状态为 `ready` 的原始媒体行）和 `0119_verified_connection_versions.sql` 的 `list_verified_connection_versions()`；两者均为 SECURITY DEFINER 函数，注册在 `roles.ts` 的 `generationFunctions`，只授予 `EXECUTE`，不授予对表的直接读写。`0118_verified_media_plan_source.sql` 把计划来源触发器 `guard_generation_plan_source` 从只认 `test_fixture` 扩到同时认 `verified_provider` 能力（`mode` 为 `frames_v1` 或 `reference_v1`），否则该计划永远到不了 `ready`。

厂商适配器内部：`prepareSubmission` 产出的 `PreparedSubmission` 带 `legend`（由参考图用途生成的说明文本，实际生成形如"参考素材：图片1为角色形象参考；图片2为场景地点参考。"，标签取自 identity／look／style／location／prop／composition），两家适配器原样使用；参考图以 data URI 内联进请求体。视频结果在 `query` 阶段下载并在返回 `completed` 之前 publish 到私有对象存储；图片结果随创建请求的同步响应以 Base64 返回，同样先 publish 再返回 `completed`。

## 配置文件字段

`generation.json`（示例见 `deploy/examples/generation.json`，与 `api.json`／`worker.json` 同一套精确键校验，部署时复制到检出目录之外并替换占位符）：

```json
{
  "databaseUrl": "postgresql://scenedesk_generation:…",
  "media": { "endpoint": "…", "region": "…", "bucket": "…", "accessKeyId": "…", "secretAccessKey": "…" },
  "vendors": {
    "minimax":    { "apiKey": "…", "baseUrl": "https://api.minimax.cn" },
    "volcengine": { "apiKey": "…", "baseUrl": "https://ark.cn-beijing.volces.com/api/v3", "accountTier": "personal" }
  },
  "connections": [
    { "vendor": "minimax",    "connectionId": "<uuid>", "connectionVersionId": "<uuid>", "accountIdentityLabel": "…" },
    { "vendor": "volcengine", "connectionId": "<uuid>", "connectionVersionId": "<uuid>", "accountIdentityLabel": "…" }
  ]
}
```

`accountTier` 只决定火山 Seedance 能力行的 `max_inflight`（personal 3，enterprise 8，取档案值且不超过 8）。部署时该文件作为 Compose secret `generation_config` 挂载为容器内的 `config.json`；本机演练用 `SCENEDESK_GENERATION_CONFIG` 指向宿主机上的私有文件。

## 开通流程

能力行的 `enabled` 与 `verifiedAt` 是准备 ready 计划的必要条件；提交还须通过当前权限、限额和 API 的 `generationExecutor` 配置检查。未声明真实执行器时 API 返回 503，计划仍保持 ready。`PROVIDER_MODE` 门禁执行器进程，不能单独代表整条付费执行链已开通。单执行器按顺序扫描最多 100 个任务，每次观察最长 120 秒，一个慢下载会推迟其它任务的 5 秒轮询；多实例与并行观察是后续工作。

1. `deploy/runtime/provision.ts --apply`：按 `provision.json` 的 `generationRole` 字段（例如 `scenedesk_generation`）创建执行器登录用的受限数据库角色，只授予 schema `USAGE` 和 `generationFunctions` 列出的 SECURITY DEFINER 函数 `EXECUTE`，不授予任何表的直接读写。
2. `scripts/provision-verified-capabilities.ts --config generation.json --tenant <id>`：按 `PROFILES` 逐条档案、逐个模式写 `generation_capabilities`。首次写入 `enabled=false`；`definition` 或 `max_inflight` 有变化时发布新的 `revision+1` 行并把旧行 `enabled` 置为 false（`generation_capabilities` 行本身不可变，`guard_generation_immutable` 只放行 `enabled` 列的 UPDATE）；`definition` 与 `max_inflight` 都不变时是 no-op（`unchanged`）。
3. `scripts/verified-smoke.ts --config generation.json --vendor <minimax|volcengine> --kind <image|video> --out output/verified/<date>`：人工付费冒烟，直接用 vendor client，不经过能力条目，把请求摘要、任务 ID、查询观察、输出尺寸／时长、`usage` 写入 `<out>/record.json`，产物写入 `<out>/result.mp4`／`<out>/result.jpg`。CI 不跑这个脚本。
4. 冒烟通过、MV 证据保存后，`scripts/provision-verified-capabilities.ts --config generation.json --tenant <id> --enable <profileId>`：只在该 profile 最新一行还没有 `verifiedAt` 时写入（重复运行仍是 no-op）。
5. 起执行器：`SCENEDESK_GENERATION_CONFIG=/绝对路径/generation.json docker compose -f deploy/compose.yaml --profile generation up generation-worker`，健康检查在 4314 端口的 `/health/ready`；命令行加 `--check` 只跑启动自检不常驻。完整参数与 `stop_grace_period` 依据见 [deploy/README.md「生成执行器」](../../deploy/README.md#生成执行器)，不在此重复。
6. 部署审计需要显式加 `--generation-executor`（`node deploy/runtime/audit.ts --generation-executor`）才会把执行器视为已配置、放行 `executor_required_jobs` 非零；不带该参数时任何未终结的生成任务都会让审计失败。

## 输出规格规则

尺寸、名义画幅与厂商档位沿用能力行已有的 `outputs` 配对；前端和 API 共用 `supportsVisualOutput`，不再用像素宽高的精确比值否定显式配对。没有配对表的旧能力仍按精确几何校验；`aspectRatio` 仍可省略，不新增字段或配置开关。资源上限、时长和音轨继续由原校验负责。

计划固定能力快照后，适配器在读取参考或发出请求前核对当前尺寸映射与快照中的画幅、档位；不兼容则明确拒绝 `OUTPUT_PROFILE_CHANGED`。缺少配对表的旧计划保留现有映射路径，但已声明的画幅仍须一致。实际产物继续按真实像素和媒体验收规则检查，不用名义画幅放宽归档。

## 状态映射

复制自[设计 §8](../superpowers/specs/2026-09-22-verified-provider-integration-design.md#8-错误与状态映射)：

| 厂商情形 | 回执 | 说明 |
|---|---|---|
| 创建 2xx 带 ID | `accepted` | |
| 图片 2xx 带结果 | `completed` | 先归档再返回 |
| 400 参数、422／涉敏、401、402／403 欠费、404 模型未开通 | `rejected(code)` | code 用厂商错误码原文加前缀，如 `MINIMAX_insufficient_balance_error`、`ARK_ModelNotOpen` |
| 创建 429 | `rejected(PROVIDER_RATE_LIMITED)` | 任务失败，用户可重新提交；靠 `max_inflight` 把它压到罕见 |
| 创建超时、连接错误、5xx | `unknown` | 现有 `submission_unknown`，不重提 |
| 查询 404、429、5xx、超时 | `unavailable` | 退避重查 |
| 任务 `failed` | `failed(error.code)` | |
| 火山 `expired` | `failed(ARK_EXPIRED)` | 创建时 `execution_expires_after` 设 6 小时 |
| 查询窗口外（7 天） | `unavailable` | 交人工核对 |

## 明确不做

复制自[设计 §12](../superpowers/specs/2026-09-22-verified-provider-integration-design.md#12-明确不做)：租户自带密钥与 connections 表；回调端点；参考视频、参考音频、MiniMax 文件上传；组图、图层拆分、再生成 2K、H3-Context-IR；确认费用入账、预算扣减与 K 预留；丢失提交自动找回；多执行器实例与租约续期；界面里的原型占位文案（`Seedance · 待接入`）属于原型页，不在生产路径。

## 验证记录（MV-01 至 MV-10）

条目定义见 [07 §5 连接验证清单](07-provider-adapter.md#5-连接验证清单)。2026-09-23 用 `deploy/demo/enable-generation.sh` 在演示箱上跑了首轮付费冒烟（`scripts/verified-smoke.ts`，同一提示词，三个档案各一次），证据在操作者本机 `output/verified/2026-09-23/<档案>/record.json`（已脱敏）与同目录产物，不进仓库。每条通过后把实际证据路径填进"预期证据"列并更新状态。

| ID | 必须验证 | 状态 | 预期证据 |
|---|---|---|---|
| MV-01 | 最小输入到可播放输出 | 通过（2026-09-23，三个档案） | `output/verified/2026-09-23/{seedream-flash-image,seedance-mini-video,minimax-h3-video}/record.json` 及产物。实测：Seedream 5.0 flash `1024x1024` jpeg，`usage.output_tokens` 4096，同步返回 12 秒；Seedance 2.0 mini 720p 16:9 5 秒 → `1280x720`、24 fps、5.04 秒、h264 + aac，`usage.completion_tokens` 108,900（与文档估算一致），创建到成功 84 秒；MiniMax H3 768P 16:9 5 秒 → **`1344x768`**（非文档推测的 1366x768）、24 fps、5.17 秒、h264 + 立体声 aac，`usage.output_seconds` 5，创建到成功 114 秒；同日 `h3-9x16-reference/`：H3 768P 9:16 4 秒（带 2 张参考图）→ **`768x1344`**、24 fps、4.46 秒，创建到成功 114 秒。H3 档案的 `outputs` 只登记这两条实测尺寸，其它比例与 2K 各需一次同样的实测（`deploy/demo/smoke.sh minimax video <名字> --ratio … --duration 4`）。截至 2026-09-23 下午，演示箱已开启 flash、mini 与 H3 |
| MV-02 | 同人物多参考／所选造型，或该模式替代输入路径 | 部分通过（2026-09-23：H3 接受 2 张 `reference_image`） | `output/verified/2026-09-23/h3-9x16-reference/record.json`：`scripts/verified-smoke.ts --image ×2 --role reference_image`，MiniMax 创建 200、成功返回 `usage.input_image_count` 2、`prompt_tokens` 26,040，按秒计费 2 元、图片未计费。据此 H3 档案加回 `reference_v1`（角色名 `reference_image`）；2 张以上的上限、"同人物"效果的人工审看，以及火山 Seedance 的 reference 模式仍待验证 |
| MV-03 | 双人对白与短动作 | 待真实账号 | 待定：需要真实素材与人工听审，非脚本自动产出 |
| MV-04 | 创建超时、进程中断、租约过期后回执到达 | 待真实账号 | `output/verified/<date>/record.json`（真实超时／限流观察）；"实际调用栈不自动重 POST"半句已由 `tests/integration/verified-runtime.test.ts`（走假方舟服务，`assert.equal(posts.length, 1)`）覆盖，不依赖真实账号 |
| MV-05 | 已知 ID 查询、限流与暂时错误 | 部分（2026-09-23：已知 ID 轮询） | `output/verified/2026-09-23/*/record.json` 的 `observations`：H3 12 次、Seedance 9 次查询全部 200，状态 queued/running → succeeded；限流与暂时错误尚未观察到 |
| MV-06 | 输出 URL 过期／下载中断 | 待真实账号 | `output/verified/<date>/record.json`（下载失败或链接过期时的观察记录） |
| MV-07 | 取消与成功竞态 | 待真实账号 | 待定：需要真实取消请求与成功回执的竞态记录，人工核对消费 |
| MV-08 | 用量、分笔／乱序账单与终局性核对 | 待真实账号 | 待定：需要真实账单核对，非脚本自动产出 |
| MV-09 | 真人素材与所选服务访问条件 | 待真实账号 | 待定：账号权限与素材资格的人工核查记录 |
| MV-10 | 同账号秘密轮换、误填跨账号秘密、停用及旧任务查询 | 待真实账号 | 待定：秘密轮换与停用操作的人工记录 |

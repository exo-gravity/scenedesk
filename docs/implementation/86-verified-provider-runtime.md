# 86 真实供应商执行器落地记录

2026-09-22，基线 `bfe55b2`。依据[真实供应商接入设计](../superpowers/specs/2026-09-22-verified-provider-integration-design.md)、[实施计划](../superpowers/plans/2026-09-22-verified-provider-integration.md)、[07 模型接入](07-provider-adapter.md)、[58 异步生成任务](58-async-generation-lifecycle.md)。

## 目的

把画布生成流程里的本地测试适配器换成两家厂商（MiniMax、火山方舟）的真实付费适配器：新增一个独立的生成执行器进程、三条数据库迁移、一份配置文件、一个能力开通脚本和一个人工付费冒烟脚本；现有的任务状态机、队列、归档协议、取消与恢复语义不改。首版落地 7 条模型档案（`minimax/MiniMax-H3` 视频；`volcengine/doubao-seedance-2-0-260128`、`-2-0-fast-260128`、`-2-0-mini-260615` 视频；`volcengine/doubao-seedream-5-0-pro-260628`、`-5-0-flash-260915`、`-5-0-260128` 图片）。落地过程中发现两处需要回写设计的偏差：执行器读参考素材不再靠 `roles.ts` 给 `media` 表加列权限，而是新增 SECURITY DEFINER 函数（`media` 表启用了 RLS，直接授权读不到行）；能力条目在数据库层是不可变身份，开通脚本靠发布新 revision 行而不是原地更新 `definition`。两处已回写[设计文档](../superpowers/specs/2026-09-22-verified-provider-integration-design.md)的 §5、§10。真实账号验证（MV-01 至 MV-10）尚未执行，见文末占位表。

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

1. `deploy/runtime/provision.ts --apply`：按 `provision.json` 的 `generationRole` 字段（例如 `scenedesk_generation`）创建执行器登录用的受限数据库角色，只授予 schema `USAGE` 和 `generationFunctions` 列出的 SECURITY DEFINER 函数 `EXECUTE`，不授予任何表的直接读写。
2. `scripts/provision-verified-capabilities.ts --config generation.json --tenant <id>`：按 `PROFILES` 逐条档案、逐个模式写 `generation_capabilities`。首次写入 `enabled=false`；`definition` 或 `max_inflight` 有变化时发布新的 `revision+1` 行并把旧行 `enabled` 置为 false（`generation_capabilities` 行本身不可变，`guard_generation_immutable` 只放行 `enabled` 列的 UPDATE）；`definition` 与 `max_inflight` 都不变时是 no-op（`unchanged`）。
3. `scripts/verified-smoke.ts --config generation.json --vendor <minimax|volcengine> --kind <image|video> --out output/verified/<date>`：人工付费冒烟，直接用 vendor client，不经过能力条目，把请求摘要、任务 ID、查询观察、输出尺寸／时长、`usage` 写入 `<out>/record.json`，产物写入 `<out>/result.mp4`／`<out>/result.jpg`。CI 不跑这个脚本。
4. 冒烟通过、MV 证据保存后，`scripts/provision-verified-capabilities.ts --config generation.json --tenant <id> --enable <profileId>`：只在该 profile 最新一行还没有 `verifiedAt` 时写入（重复运行仍是 no-op）。
5. 起执行器：`SCENEDESK_GENERATION_CONFIG=/绝对路径/generation.json docker compose -f deploy/compose.yaml --profile generation up generation-worker`，健康检查在 4314 端口的 `/health/ready`；命令行加 `--check` 只跑启动自检不常驻。完整参数与 `stop_grace_period` 依据见 [deploy/README.md「生成执行器」](../../deploy/README.md#生成执行器)，不在此重复。
6. 部署审计需要显式加 `--generation-executor`（`node deploy/runtime/audit.ts --generation-executor`）才会把执行器视为已配置、放行 `executor_required_jobs` 非零；不带该参数时任何未终结的生成任务都会让审计失败。

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

条目定义见 [07 §5 连接验证清单](07-provider-adapter.md#5-连接验证清单)。首版尚未拿到真实账号与预算，全部标"待真实账号"；每条通过后把实际证据路径填进"预期证据"列并更新状态。

| ID | 必须验证 | 状态 | 预期证据 |
|---|---|---|---|
| MV-01 | 最小输入到可播放输出 | 待真实账号 | `output/verified/<date>/record.json`（`scripts/verified-smoke.ts --kind video\|image`）及同目录 `result.mp4`／`result.jpg` |
| MV-02 | 同人物多参考／所选造型，或该模式替代输入路径 | 待真实账号 | 待定：`verified-smoke.ts` 目前不带参考图输入，需先扩展脚本或走完整能力条目人工验证 |
| MV-03 | 双人对白与短动作 | 待真实账号 | 待定：需要真实素材与人工听审，非脚本自动产出 |
| MV-04 | 创建超时、进程中断、租约过期后回执到达 | 待真实账号 | `output/verified/<date>/record.json`（真实超时／限流观察）；"实际调用栈不自动重 POST"半句已由 `tests/integration/verified-runtime.test.ts`（走假方舟服务，`assert.equal(posts.length, 1)`）覆盖，不依赖真实账号 |
| MV-05 | 已知 ID 查询、限流与暂时错误 | 待真实账号 | `output/verified/<date>/record.json` 的 `observations` 数组（查询轮询记录） |
| MV-06 | 输出 URL 过期／下载中断 | 待真实账号 | `output/verified/<date>/record.json`（下载失败或链接过期时的观察记录） |
| MV-07 | 取消与成功竞态 | 待真实账号 | 待定：需要真实取消请求与成功回执的竞态记录，人工核对消费 |
| MV-08 | 用量、分笔／乱序账单与终局性核对 | 待真实账号 | 待定：需要真实账单核对，非脚本自动产出 |
| MV-09 | 真人素材与所选服务访问条件 | 待真实账号 | 待定：账号权限与素材资格的人工核查记录 |
| MV-10 | 同账号秘密轮换、误填跨账号秘密、停用及旧任务查询 | 待真实账号 | 待定：秘密轮换与停用操作的人工记录 |

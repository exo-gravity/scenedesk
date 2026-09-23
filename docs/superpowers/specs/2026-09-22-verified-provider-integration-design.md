# 真实供应商接入设计：MiniMax 与火山方舟视频、图片生成

2026-09-22。依据 [调研](../../research/2026-09-22-minimax-seedance-official-api.md)、[07 模型接入](../../implementation/07-provider-adapter.md)、[58 异步生成任务](../../implementation/58-async-generation-lifecycle.md)、[ADR 0003](../../adr/0003-uncertain-provider-submission.md)。已确认的决定：平台级密钥；首版接 MiniMax-H3 视频、Seedance 2.0 系列视频、Seedream 5.0 图片；方案 A（厂商适配器 + 模型档案）；务必不过度设计。

## 1. 目标与边界

**目标**：把现有的"本地测试适配器"替换成两家厂商的真实适配器，让画布里已有的图片、视频生成流程在生产上真的调模型、真的归档、真的估价。现有的任务状态机、队列、归档协议、取消与恢复、能力校验一律不改语义。

**首版做**：

- 7 条模型档案：`minimax/MiniMax-H3`；`volcengine/doubao-seedance-2-0-260128`、`-2-0-fast-260128`、`-2-0-mini-260615`；`volcengine/doubao-seedream-5-0-pro-260628`、`-5-0-flash-260915`、`-5-0-260128`。
- 两个厂商适配器，一个新的生成执行器进程，一份配置文件，一条迁移，一个开通脚本。
- 文生、首尾帧、参考图三种输入；参考图以 Base64 内联。
- 真实的费用估计；实际用量保存为证据。

**首版不做**（见 §12）：租户自带密钥、回调接收、参考视频与参考音频、MiniMax 文件上传、组图与图层拆分、确认费用入账与预算扣减、丢失提交自动找回、多执行器实例。

## 2. 架构总览

三个概念，职责分开：

| 概念 | 是什么 | 谁维护 | 变化频率 |
|---|---|---|---|
| 厂商适配器 | 实现现有 `AssistanceAdapter`：发请求、查进度、取结果、存文件。一家厂商一个实例，服务该连接版本下所有能力，不含任何模型专属分支 | 代码 | 加厂商时 |
| 模型档案 | 一个模型一条数据：厂商模型 ID、模式、`宽x高` 到厂商分辨率与宽高比的映射、时长与音频约束、参考素材规则、价格与 `pricingRevision` | 代码（`profiles.ts`） | 加模型或改价时 |
| 能力条目 | 数据库 `generation_capabilities` 行，按租户、按"模型 + 模式"一行，`definition` 由档案派生，`enabled` 由操作者控制 | 开通脚本写入 | 给租户开通时 |

一次生成的路径：

```
画布选能力与参数
→ API 按能力条目校验，按档案估价，固定计划
→ 队列 / generation_work
→ 生成执行器领任务（SQL 先写 attempt 与 dispatching）
→ 按 connectionVersionId 找厂商适配器
→ 适配器按档案翻译参数，参考图转 Base64，发创建请求（不重试）
→ 视频：拿任务 ID，每 5 秒查一次；图片：同步返回
→ 成功：下载字节 → 校验 → publish 到私有对象存储 → 返回现有形状的回执
→ 现有归档协议 → media ready → 候选可见
→ usage 记入证据；费用估计已在计划上
```

## 3. 模块与职责

新增目录 `packages/provider/src/verified/`，适配器不访问数据库，所有外部依赖注入。

| 文件 | 职责 |
|---|---|
| `http.ts` | `jsonRequest(url, {method, headers, body, signal, maxBodyBytes})`。Bearer 头由调用方给。响应体上限 4 MiB（图片 Base64 响应单独放宽到 64 MiB）。把结果分成：HTTP 2xx 成功、4xx 明确拒绝、超时／连接错误／5xx／429 为"未知或不可用"。没有重试 |
| `profiles.ts` | 档案类型与 7 条档案；`capabilityDefinition(profile, mode)`、`estimateCost(profile, resolvedInput)`、`usageSummary(profile, providerUsage)`、`resolveOutput(profile, "宽x高")` |
| `inputs.ts` | `MediaResolver` 接口；`references → 厂商角色` 映射；`dataUri(media)`；参考图说明文本（火山要求提示词按"图片1、图片2"引用素材） |
| `outputs.ts` | `archiveBytes({bytes | url, mime, store, signal, maxBytes})`：下载或解码、sha256、`store.publish(file, …, "originals")`，返回 `{kind:"fixture_object", object, sha256, mime}` |
| `minimax/client.ts` | `createVideoTask`、`getVideoTask`、`cancelVideoTask`，字段按 v2 文档 |
| `minimax/adapter.ts` | `AssistanceAdapter` 实现：purpose=video → H3 |
| `volcengine/client.ts` | `createContentTask`、`getContentTask`、`deleteContentTask`、`generateImages` |
| `volcengine/adapter.ts` | `AssistanceAdapter` 实现：purpose=video → Seedance，purpose=image → Seedream |
| `index.ts` | `createVerifiedAdapters(config, deps): AssistanceAdapter[]` |

注入的依赖（结构化类型，不引入包依赖）：

```ts
type VerifiedDeps = {
  store: { publish(file, data, "originals", signal): Promise<VerifiedObject>; download(...) };
  resolveMedia(tenantId: string, mediaIds: string[]): Promise<ResolvedMedia[]>; // 只读 media 行
  fetch: typeof fetch;
  tmpdir: string;
};
type ResolvedMedia = { id; kind; mime; bytes; sha256; width?; height?; object: { key; versionId } };
```

适配器如何知道用哪条档案：`resolvedInput.capabilitySnapshot.modelVersion` 就是档案 ID，`capabilitySnapshot.mode` 是模式；两者在计划固定时已冻结。找不到档案或厂商不匹配时返回 `rejected(PROFILE_NOT_CONFIGURED)`，不发请求。

`apps/worker/src/generation-verified.ts`（新入口）：读配置，建 `MediaStore`，用生成执行器数据库角色实现 `resolveMedia`，`createVerifiedAdapters`，交给现有 `createAssistanceWorker` 并挂 `scheduleArchive`。现有 fixture 入口不动。

## 4. 模型档案

```ts
type ModelProfile = {
  id: string;                       // 写入能力 modelVersion，如 "volcengine/doubao-seedance-2-0-260128"
  vendor: "minimax" | "volcengine";
  purpose: "video" | "image";
  providerModel: string;            // 厂商 model 字段
  modes: ("frames_v1" | "reference_v1")[];
  outputs: Record<string, { resolution: string; ratio: string }>; // "1280x720" → {"720p","16:9"}
  duration?: { min: number; max: number };
  audioOutput?: boolean;
  referenceImage: { maxCount: number; maxBytes: number; mimeTypes: string[] };
  pricing: { revision: string } & (
    | { kind: "per_second"; microsPerSecond: Record<string, number>; extraImageMicros: number; freeImages: number }
    | { kind: "per_token"; microsPerMillion: Record<string, number> }   // 键为分辨率档
    | { kind: "per_image"; microsPerImage: Record<string, number>; extraInputImageMicros?: number; freeInputImages?: number } // 键为像素档
  );
  inflight: { personal: number; enterprise: number } | number;
};
```

规则：

- `outputs` 只列官方像素表里的组合。Seedance、Seedream 用官方表；H3 官方无像素表，档案里 `outputs` 留空，`capabilityDefinition` 对空表拒绝生成条目，MV-01 实测后再填。
- 模式：`frames_v1` 的 `supportedPurposes` 是 `start_frame`、`end_frame`，各至多 1；`reference_v1` 是 `identity`、`look`、`style`、`location`、`prop`、`composition`，合计至多 `referenceImage.maxCount`。两种模式都允许零参考（纯文生）。图片模型只有 `reference_v1`。
- 参考图 `maxBytes` 首版 4 MiB，`mimeTypes` 为 png、jpeg、webp。
- `capabilityDefinition` 输出现有 `Capability` 契约字段：`purpose`、`mode`、`modelVersion`、`supportedPurposes`、`allowedResolutions`（`outputs` 的键）、`allowedAspectRatios`（由键算出并与厂商 ratio 一致）、`minDurationSeconds`／`maxDurationSeconds`、`audioOutput`、`inputRules`、`maxReferences`、`cancelSupported`（视频 true，图片 false）、`recoverySupported`（false）、`executionMode: "verified_provider"`、`notes`（`pricingRevision` 与核验日期）。不新增契约字段。

## 5. 数据与配置

**配置文件** `generation.json`，与 `api.json`／`worker.json` 同一套读取与精确键校验：

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

`accountTier` 只决定 Seedance 能力行的 `max_inflight`（personal 3，enterprise 8）。

**能力条目**：`scripts/provision-verified-capabilities.ts --config generation.json --tenant <id>`，对每条档案的每个模式，按 `(tenant_id, definition->>'modelVersion', definition->>'mode')` 幂等写入或按 `revision+1` 更新 `definition`，`execution_mode='verified_provider'`，`enabled=false`，`max_inflight` 取档案值且不超过 8，`max_daily_jobs` 默认 200。开启由操作者用同一脚本 `--enable <modelVersion>` 完成，只在 MV 通过后。（Task 14 核实）`generation_capabilities` 行在数据库层是不可变身份，除 `enabled` 外的列不可更新；开通脚本据此在 `definition` 变化时发布新的 `revision+1` 行并把旧行 `enabled` 置为 false，不做原地更新。

**数据库改动（三条迁移 + 角色）**：

- 替换 `finish_generation_output`：把 `p.execution_mode<>'test_fixture'` 的拒绝改为 `execution_mode NOT IN ('test_fixture','verified_provider')`，其余校验原样保留。
- 替换 `claim_generation_observation`：租约从 60 秒改为 180 秒，配合 §6 的下载时限。
- 新增 SECURITY DEFINER 函数 `read_generation_media_sources(jobId)`：只返回该 job 所属计划已引用、租户匹配、状态为 `ready` 的原始媒体行（id、kind、mime、bytes、sha256、width、height、object），执行器不直接读 `media` 表；`roles.ts` 的 `generationFunctions` 追加该函数签名。
- （Task 14 核实）`0118_verified_media_plan_source.sql`：计划来源触发器 `guard_generation_plan_source` 放行 `verified_provider` 能力（`mode` 为 `frames_v1` 或 `reference_v1`），任何 verified 计划要到达 `ready` 都依赖这一条。
- （Task 14 核实）`0119_verified_connection_versions.sql`：新增 SECURITY DEFINER 函数 `list_verified_connection_versions()`，供执行器的启动自检使用；同样注册在 `roles.ts` 的 `generationFunctions`。

**API 改动**：`media-input.ts` 的门禁改为：`test_fixture` 要求 `mode = <kind>_fixture_v1`；`verified_provider` 要求 `mode ∈ {frames_v1, reference_v1}` 且 `modelVersion` 在档案表里。`model.ts` 的估计改为调用 `estimateCost`，找不到档案时按现状返回阻断。

## 6. 执行流程

**提交（`submitOnce`）**

1. 由 `capabilitySnapshot` 取档案；`resolveOutput(profile, output.resolution)` 得厂商分辨率与宽高比。
2. `resolveMedia` 读参考图行，`store.download` 到临时文件，转 data URI；按模式映射角色。总请求体估算超过 60 MiB 直接 `rejected(INPUT_TOO_LARGE)`。
3. 组装提示词：`resolvedInput.prompt` 原文；`reference_v1` 模式下追加一段说明，按顺序写"图片1：<purpose 中文>；图片2：…"，两家都用同一段文本。回执的 `correlation` 按现有约定等于 `attemptId`；实际请求体的 sha256 只写执行器的结构化日志，密钥与 Base64 内容既不进日志也不进证据。
4. 视频：调创建，`accepted(providerJobId)`。图片：调生成，`watermark=false`、`response_format=b64_json`、`output_format=jpeg`、`size` 用显式 `宽x高`；仅 lite 追加 `sequential_image_generation=disabled`（Seedream 没有 `n` 参数；pro／flash 不支持组图参数）；响应里取一张 → `archiveBytes` → `completed(output, usage)`。
5. 错误分类见 §8。任何抛错交给现有 worker 变成 `unknown`。

**查询（`query`，仅视频）**

1. `getTask(providerJobId)`。`queued → pending`，`running → running`，`cancelled → cancelled`，`failed / expired → failed(code)`。
2. `succeeded`：取 `video_url`／`content.url`，`archiveBytes` 下载（上限 128 MiB）并 publish，返回 `completed(output, usage)`。下载失败或超时返回 `unavailable`，由现有退避重查，链接失效前会重试；MiniMax 链接过期可重查刷新，火山 24 小时内有效。
3. 现有 worker 的查询时限从 30 秒提高到 120 秒（一个常量），与租约 180 秒配合。首版只运行一个执行器实例。

**取消（`requestCancel`，仅视频）**：调删除接口；2xx → `cancelled`；厂商回"不是 queued" → `cancel_unsupported`；其它 → `cancel_unknown`。

**找回（`recoverSubmission`）**：固定返回 `null`。

## 7. 费用

计划固定时由 API 计算 `CostEstimate`：

- MiniMax：`durationSeconds × microsPerSecond[分辨率档] + max(参考图数 − 5, 0) × extraImageMicros`。
- 火山视频：`durationSeconds × 宽 × 高 × 24 / 1024 / 1e6 × microsPerMillion[分辨率档]`；不含视频输入，最低 token 门槛不适用。
- Seedream：`microsPerImage[像素档]`，5.0 pro 另加 `max(参考图数 − 1, 0) × extraInputImageMicros`。

`holdMargin` 统一为基础金额的 20%，`totalReservation = base + margin`，`pricingRevision` 取档案值，`basisNote` 写公式与档案 ID。成功回执里的 `usage` 原样进证据（现有 `record_generation_evidence` 已保存）。`confirmedCost` 与 `costStatus` 的真实结算不在首版，`jobRecord` 对 `verified_provider` 返回 `costStatus: "pending"`，`confirmedCost` 保持 0。

## 8. 错误与状态映射

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

## 9. 输出校验容差

- 尺寸：请求里用显式 `宽x高`（Seedream）或档案映射的档位（Seedance、H3），能力只允许官方像素表里的组合，归档时现有"尺寸完全一致"校验不变。
- 视频时长：现有一帧容差对真实模型不成立（火山返回的 `duration` 是向下取整的秒数）。把 `validateGeneratedOutput` 的视频时长容差改为 ±1 秒，全局生效，fixture 不受影响。
- 音轨：`withAudio` 与实际音轨仍须一致；H3 只出有声，其能力 `audioOutput=true` 且界面不提供关闭。

## 10. 部署与门禁

- `deploy/compose.yaml` 增加 `generation-worker` 服务，`profiles: [generation]`，镜像目标复用 worker 镜像，入口 `generation-verified`，密钥文件 `generation.json`，与媒体 worker 相同的网络与 TMPDIR 约定。
- `deploy/runtime/config.ts`：新增 `generationConfiguration()`；`PROVIDER_MODE` 合法值改为 `mock | verified`；`apps/api/src/main.ts` 与 `apps/worker/src/main.ts` 的同名门禁同步。
- 部署审计 `requireGenerationAudit`：增加参数 `executorConfigured`，为真时 `executor_required_jobs > 0` 不再报错。
- 生成执行器的启动自检：配置齐全、两家 `baseUrl` 为 HTTPS、`connections` 的 UUID 在能力表里至少出现一次；不做任何厂商调用。（Task 14 核实）该自检通过 SECURITY DEFINER 函数 `list_verified_connection_versions()` 读取已存在的连接版本 ID 集合，不直接查询 `generation_capabilities` 表。

## 11. 测试与验收

- 单元：档案派生的 `definition` 通过契约校验；`estimateCost` 对三种计价各一个已知数；`resolveOutput` 拒绝表外尺寸；参考图角色映射与互斥。
- 适配器：仿照 `tests/helpers/async-provider-http.ts` 起本地假服务，分别模拟两家的创建、查询、取消、同步图片、429、5xx、超时、涉敏拒绝、链接下载失败，断言回执种类与错误码；断言创建请求只发一次。
- 数据库：迁移后 `finish_generation_output` 接受 `verified_provider` 回执且仍拒绝多对象或不一致回执；租约 180 秒。
- 付费冒烟：`scripts/verified-smoke.ts`，人工运行，直接使用 `verified/<vendor>/client.ts` 而不经过能力条目，每次只创建一个 5 秒 720p 视频或一张 1K 图片，打印请求摘要、任务 ID、查询观察、实际输出尺寸与时长、归档对象与 `usage`，写入 `output/verified/` 供 MV-01、MV-04、MV-05、MV-06 记录。H3 的 `outputs` 像素表由这一步实测得到后再填入档案。CI 不调厂商。
- 开启顺序：H3 视频 → Seedance 2.0 → Seedream flash／lite → 其余档案；每条能力在 MV 证据保存后才 `--enable`。

## 12. 明确不做

租户自带密钥与 connections 表；回调端点；参考视频、参考音频、MiniMax 文件上传；组图、图层拆分、再生成 2K、H3-Context-IR；确认费用入账、预算扣减与 K 预留；丢失提交自动找回；多执行器实例与租约续期；界面里的原型占位文案（`Seedance · 待接入`）属于原型页，不在生产路径。

## 13. 后续扩展

- 加同厂商模型：`profiles.ts` 加一条，跑开通脚本。
- 加新厂商：`verified/<vendor>/client.ts` 与 `adapter.ts`，`index.ts` 注册，配置加一段 `vendors.<vendor>` 与一条 `connections`。
- 租户自带密钥：把 `connections` 从配置文件搬到表，执行器启动时按表加载适配器；档案与适配器不变。
- 确认费用：在 `record_generation_evidence` 之后加一张费用证据表，由 `usageSummary` 写入，`jobRecord` 聚合；档案与适配器不变。

# MiniMax 与火山方舟视频、图片生成官方 API 接入调研

核查日期：2026-09-22。范围只覆盖两家的视频与图片生成模型：MiniMax 开放平台国内站（文档 `platform.minimax.cn`，接口 `api.minimax.cn`）的视频生成 v2（MiniMax-H3、H3-Max）与图片生成（image-01）；火山方舟国内北京区（`ark.cn-beijing.volces.com`）的视频生成 API（Seedance 2.0 系列）与图片生成 API（Seedream 4.0 到 5.0）。不涉及两家的文本、语音或 3D 模型。只读公开官方文档；没有登录、开通、调用、付费或测量质量。本文为适配器实现提供约束，不是接口认证；所有"未核实"项在真实账号上按 [07 §5](../implementation/07-provider-adapter.md) 的 MV 清单验证后才能启用。

## 1. 结论

1. **视频接口两家同构，直接用 HTTP。** 都是 Bearer API Key、创建返回任务 ID、GET 轮询、成功后拿一个有时效的下载 URL。火山官方 SDK 只有 Python／Go／Java，MiniMax 视频 v2 没有 SDK。本仓库是 Node，直接 `fetch`，创建请求不做任何隐式重试，与 [ADR 0003](../adr/0003-uncertain-provider-submission.md) 一致。
2. **图片接口两家都是同步的，没有任务 ID 可查。** 火山 Seedream 与 MiniMax image-01 都在一次 POST 里直接返回图片 URL 或 Base64。请求超时或连接中断后无法找回结果，也无法通过查询确认是否已计费。同步接口在本仓库的 `submitOnce` 里直接返回 `completed`，`unknown` 只能等账单核对。
3. **视频任务没有创建幂等键，也不能按客户端关联 ID 找回丢失的提交。** 列表接口只能按状态、模型（火山按接入点 ID）、任务 ID 过滤，窗口 7 天。`submission_unknown` 只能靠"时间窗 + 模型 + 状态"启发式核对，不能自动重提。
4. **结果链接短命，任务记录只留 7 天。** 火山视频与图片 URL 都是 24 小时；MiniMax 图片 URL 24 小时，视频 URL 未写明时效但过期后可重新查询再取。两家视频任务记录都只保留 7 天。归档必须在成功后立即完成，费用核对也必须在 7 天内做完。
5. **视频状态机几乎一致。** `queued → running → succeeded | failed`，加 `cancelled`；火山另有 `expired`（默认 48 小时超时，可设 1 到 72 小时）。两家都只能取消 `queued` 状态的任务。
6. **回调只能当查询提示。** 两家视频接口都有 `callback_url`，推送体与查询响应一致。MiniMax 有 challenge 校验，火山没有；两家都没有签名或来源校验。与 07 §1 的默认立场一致：回调唤醒查询，不直接写可信证据。
7. **费用证据可以自动取得，但形式不同。** MiniMax 视频返回 `usage.output_seconds / input_seconds / input_image_count`，按秒单价直接算钱；图片按张。火山视频返回 `usage.completion_tokens`（含最低 token 门槛），图片返回 `usage.generated_images` 与 `output_tokens`，按张与像素档计价。两家都只对成功生成计费。
8. **限流。** MiniMax H3：RPM 300、在途任务 30；MiniMax 图片生成：RPM 10，很紧。火山 Seedance 2.0 系列：企业账号 RPM 600、并发 10；个人账号 RPM 180、并发 3；4k 档 RPM 15、并发 1。火山 Seedream 全系：IPM 500 张/分钟。仓库里 `max_inflight` 上限 8，落在两家配额之内。
9. **开通门槛。** 火山开通 Seedance 2.0 系列需要余额大于 200 元，或 200 元档节省计划，或资源包；Seedream 未见门槛说明。MiniMax 视频资源包不支持 H3，只能按量付费。
10. **真人人脸。** 火山 Seedance 2.0 系列拒绝含真人人脸的参考图和参考视频，只接受本账号 30 天内模型产物、预置虚拟人像或已授权素材；错误码表里也有"输入图片可能包含真人"，Seedream 是否同样拦截需实测。MiniMax 文档未见同类限制，image-01 还提供 `subject_reference` 人物参考。这直接影响短剧角色一致性方案，对应 MV-09。
11. **水印默认值不同。** 火山 Seedream 的 `watermark` 默认 `true`，必须显式传 `false`；Seedance 与 MiniMax 默认不加水印。
12. **本仓库的三处硬阻断。** 迁移 `0094` 只接受 `test_fixture` 的媒体回执；API、worker、deploy 三处启动门禁强制 `PROVIDER_MODE=mock`；worker 强制 `GENERATION_ADAPTER=test_fixture`。见 §7.4。

## 2. 视频接口对照

| 项目 | MiniMax 开放平台（H3 / H3-Max） | 火山方舟（Seedance 2.0 系列） |
|---|---|---|
| 基址与鉴权 | `https://api.minimax.cn`，`Authorization: Bearer {API_key}` | `https://ark.cn-beijing.volces.com/api/v3`，`Authorization: Bearer {ARK_API_KEY}`（长效 API Key） |
| 创建 | `POST /v2/video_generation` → `{task_id}` | `POST /contents/generations/tasks` → `{id: "cgt-…"}` |
| 查询 | `GET /v2/query/video_generation/{task_id}` | `GET /contents/generations/tasks/{id}` |
| 列表 | `GET /v2/query/video_generation`，过滤 status／task_ids／model／task_type，分页 | `GET /contents/generations/tasks`，过滤 status／task_ids／model（接入点 ID）／service_tier，分页 1 到 500 |
| 取消／删除 | `DELETE /v2/video_generation/{task_id}`：queued 取消不计费；succeeded／failed 删记录；running 报错 | `DELETE /contents/generations/tasks/{id}`：只取消 queued；cancelled 记录 24 小时后自动删除 |
| 状态 | queued／running／succeeded／failed／cancelled | queued／running／succeeded／failed／cancelled／expired |
| 任务保留 | 7 天，窗口 `[T-7天, T)` | 7 天，从 `created_at` 起 |
| 结果链接 | `content.url` 有时效，未写明时长；过期可重新查询获取 | `content.video_url` 24 小时；可选 `last_frame_url` 同样 24 小时 |
| 幂等／找回 | 无幂等键；列表不能按客户端 ID 过滤 | 无幂等键；列表不能按客户端 ID 过滤；`safety_identifier` 会原样回显但不能作为过滤条件 |
| 回调 | `callback_url`，先 POST challenge 要求 3 秒内原样返回，之后每次状态变化推送查询响应体 | `callback_url`，每次状态变化推送查询响应体；succeeded／failed 若 5 秒内未确认则重试三次；无校验 |
| 输入引用 | 公网 URL、`mm_file://{file_id}`（先上传，7 天有效）、data URI；请求体 ≤ 64 MB | 公网 URL、`data:` Base64、`asset://`（平台素材库）；请求体 ≤ 64 MB，大文件不要用 Base64 |
| 输出 | 一个 mp4，原生立体声；768P／2K（H3）或 480P／768P（H3-Max）；4 到 15 秒（H3-Max 5 到 15） | 一个 mp4，单声道有声（可关）；2.0：480p／720p／1080p／4k，fast／mini：480p／720p；4 到 15 秒或 `-1` 由模型选；24 fps |
| 限流 | H3 RPM 300、在途 30；提额邮件 3 到 5 个工作日 | 企业 RPM 600 并发 10；个人 RPM 180 并发 3；4k RPM 15 并发 1 |
| 计费证据 | `usage` 含 output_seconds、input_seconds、input_image_count、input_audio_seconds | `usage.completion_tokens`（含最低 token 门槛），`total_tokens` 等于它 |
| 开通门槛 | 按量付费；视频资源包不支持 H3 | 余额 > 200 元，或 200 元档节省计划，或资源包 |
| 官方 SDK | 无（SDK 页只列对话用的 Anthropic／OpenAI 兼容 SDK） | Python（`arkruntime`）、Go、Java；无 Node |

## 3. MiniMax 视频生成（H3 / H3-Max）

### 3.1 创建任务字段

`POST https://api.minimax.cn/v2/video_generation`

| 字段 | 必填 | 取值 |
|---|---|---|
| `model` | 是 | `MiniMax-H3`（768P／2K）或 `MiniMax-H3-Max`（480P／768P） |
| `content[]` | 是 | 恰好一个非空 `text` 元素，加可选图片／视频／音频元素，见 3.2 |
| `resolution` | 是 | `480P`、`768P`、`2K`，按模型 |
| `duration` | 是 | 整数秒；H3 4 到 15，H3-Max 5 到 15 |
| `ratio` | 视场景 | `adaptive`（默认）、`21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16`；纯文本生视频必填且不能为 adaptive |
| `callback_url` | 否 | 见 3.4 |
| `aigc_watermark` | 否 | 默认 false |
| `extra.prompt_expansion_mode` | 否 | `disabled`／`balanced`（默认）／`quality`，仅 H3-Max |

成功响应 `{"task_id": "…"}`。错误响应 `{"type":"error","error":{"type","message","http_code"},"request_id"}`，类型：`bad_request_error` 400、`authorized_error` 401、`insufficient_balance_error` 402、`unprocessable_entity_error` 422（涉敏）、`rate_limit_error` 429、`server_error` 500。

### 3.2 content 元素与三种场景

| 元素 | role | 数量与限制 |
|---|---|---|
| `text` | 无 | 最多 7000 字符，必须有且只有一个非空 |
| `image_url.url` | `first_frame`（默认）或 `last_frame` | 每种 role 至多 1 张；jpg／jpeg／png／webp／heic／heif；≤ 30 MB；边长 256 到 5760 px；宽高比 0.4 到 2.5 |
| `video_url.url` | `reference_video` | 至多 3 个；mp4／mov，H.264／H.265，AAC／MP3；≤ 50 MB；单个 2 到 15 秒，合计 ≤ 15 秒；23.976 到 60 fps |
| `audio_url.url` | `reference_audio` | 至多 3 个；wav／mp3；≤ 15 MB；单个 2 到 15 秒，合计 ≤ 15 秒 |

首尾帧生视频与多模态参考互斥，不能在同一请求里混用 `first_frame/last_frame` 和 `reference_*`。视频生成指南另列参考上限为 9 张图、3 段视频、3 段音频、合计 12 个文件；与创建接口页的图片"每种 role 至多 1 张"并不一致，多参考图的实际上限需实测。H3-Max 是否支持多模态参考，官方指南与七牛云模型卡说法相反（后者称仅支持文生和首尾帧），需实测。

### 3.3 查询、列表、取消

查询响应字段（文档以 `task.*` 路径列出，包装层以实测为准）：`id`、`status`、`task_type`（generation／h3_context_ir／regeneration）、`modality`、`content.url`、`resolution`、`duration`、`usage`（成功时）、`error.code` 与 `error.message`（失败时，示例 `1026` 视频描述涉敏）。文档建议 10 秒轮询。

`usage` 字段：`total_seconds`、`input_seconds`、`output_seconds`、`input_image_count`、`input_audio_seconds`、`total_tokens`、`prompt_tokens`、`completion_tokens`。

列表：`page_num`（从 1 起）、`page_size`、`filter.status`、`filter.task_ids[]`、`filter.model`、`filter.task_type`；返回 `items[]` 与 `total`，只覆盖最近 7 天。

取消／删除返回 `{task_id, action: "cancelled" | "deleted", status}`。

### 3.4 回调

配置 `callback_url` 后，MiniMax 先发送含 `challenge` 字段的 POST，服务端须在 3 秒内原样返回该值完成验证；之后每次任务状态变更向该地址 POST，推送体结构与查询接口响应一致。文档没有签名、重试次数或去重说明。

### 3.5 文件上传与配套任务

`POST /v1/files/upload`，multipart 字段 `purpose=video_generation_input` 与 `file`；图片 ≤ 30 MB、参考视频 ≤ 50 MB、参考音频 ≤ 15 MB；返回 `file_id`，有效期 7 天，在 content 里以 `mm_file://{file_id}` 引用。这条路径避免了把私有素材做成公网 URL。

`POST /v2/video_regeneration`：把符合 H3 768P 输出规格的视频再生成为 2K，`source_task_id` 或 `content.base_video` 二选一，`resolution` 只能 `2K`，共享查询与取消接口，任务类型 `regeneration`。国内官方价 0.30 元/秒。H3-Context-IR 是独立的提示词理解任务（`task_type=h3_context_ir`），输出结构化提示词到 `content.prompt`，按 token 计费。两者首版不需要。

### 3.6 限流与错误码

视频生成限流页：Hailuo 系列 RPM 20；MiniMax-H3 RPM 300、最大在途任务 30；H3-Max 未单列。超限返回 429 直到窗口过去；提额联系客户或邮件 `api@minimaxi.com`，3 到 5 个工作日。

错误码页的 `base_resp.status_code` 体系（1002 频率超限、1004 鉴权、1008 余额不足、1026 输入涉敏、1027 输出涉敏、2013 参数错误、2045 频率增长超限、2049 无效 Key、2056 超出 Token Plan）面向 v1 接口，图片生成也用它；v2 视频接口按 3.1 的 HTTP 错误类型返回，任务级失败在 `error.code`。

### 3.7 未核实项

- `content.url` 的具体有效时长，以及重新查询是否总能重新签发。
- 回调是否重试、是否有序、是否会重复。
- 多参考图的实际上限，以及 H3-Max 是否接受参考元素。
- 失败或审核拦截是否在按量付费下也不计费（视频资源包页写明不扣点，按量付费页未单独写）。
- 输出 mp4 的编码参数（H.264 与否、音轨编码），关系到 `packages/media` 的严格解码路径。

## 4. 火山方舟视频生成（Seedance 2.0 系列）

### 4.1 创建任务字段

`POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks`

| 字段 | 默认 | 取值与说明 |
|---|---|---|
| `model` | 必填 | `doubao-seedance-2-0-260128`、`doubao-seedance-2-0-fast-260128`、`doubao-seedance-2-0-mini-260615`；也可传接入点 `ep-…` 以获得独立限流、监控与前付费 |
| `content[]` | 必填 | 见 4.2 |
| `resolution` | `720p` | 2.0：`480p`／`720p`／`1080p`／`4k`；fast／mini：`480p`／`720p`。4k 为 10bit H.265 |
| `ratio` | `adaptive` | `16:9`、`4:3`、`1:1`、`3:4`、`9:16`、`21:9`、`adaptive` |
| `duration` | 无 | 2.0 系列 4 到 15 整数秒，或 `-1` 由模型选；返回值为 `floor(总帧数/24)` |
| `generate_audio` | `true` | 单声道；对白建议放在双引号里 |
| `watermark` | `false` | 右下角"AI 生成"水印 |
| `return_last_frame` | `false` | 成功后额外返回 `last_frame_url`（jpeg，24 小时），用于串接下一镜头首帧 |
| `callback_url` | 无 | 见 4.5 |
| `execution_expires_after` | `172800` | 3600 到 259200 秒；超时任务标 `expired` |
| `priority` | `0` | 0 到 9，只影响同接入点内排队顺序 |
| `safety_identifier` | 无 | 终端用户哈希，≤ 64 字符，查询时原样回显 |
| `tools[{type:"web_search"}]` | 无 | 仅纯文本输入；用量在 `usage.tool_usage.web_search` |
| `frames`、`seed`、`camera_fixed`、`service_tier=flex` | | 仅 1.0 系列；2.0 系列不支持离线推理 |
| `output_format`、`omni_reference_task_type` | | 仅 2.5 |

成功响应 `{"id": "cgt-…"}`。HTTP 错误体含 `code`、`message` 与 Request ID；常见：`InvalidParameter` 400、`SensitiveContentDetected.*` 与 `Input*/Output*SensitiveContentDetected` 400、`AuthenticationError` 401、`AccountOverdueError` 403、`ModelNotOpen` 404、`RateLimitExceeded.*`／`ModelAccountRpmRateLimitExceeded` 429、`QuotaExceeded`（排队任务数超限或免费额度用尽）429、`InflightBatchsizeExceeded` 429、`ServerOverloaded`／`RequestBurstTooFast` 429、`InternalServiceError` 500。任务异步失败时错误落在查询响应的 `error.code`，例如 `OutputVideoSensitiveContentDetected`。

### 4.2 content 元素与三种互斥场景

| 元素 | role | 2.0 系列限制 |
|---|---|---|
| `text` | 无 | 中文建议 ≤ 500 字，英文 ≤ 1000 词；提示词必须用"图片1／视频1／音频1"按数组顺序引用素材 |
| `image_url.url` | `first_frame`（默认）、`last_frame`、`reference_image` | jpeg／png／webp／bmp／tiff／gif／heic／heif；< 30 MB；边长 300 到 6000 px；宽高比 0.4 到 2.5；首帧 1 张、首尾帧 2 张、参考图 1 到 9 张 |
| `video_url.url` | `reference_video` | mp4／mov，H.264／H.265；单个 2 到 15 秒，至多 3 个，合计 ≤ 15 秒；≤ 200 MB；24 到 60 fps；总像素 407,696 到 8,295,044 |
| `audio_url.url` | `reference_audio` | wav／mp3；单个 2 到 15 秒，至多 3 段，合计 ≤ 15 秒；≤ 15 MB；不能单独输入，至少配 1 张图或 1 段视频 |

首帧生视频、首尾帧生视频、全模态参考（参考图／视频／音频）是三种互斥场景。首尾帧宽高比不一致时以首帧为准裁剪尾帧。全模态参考可以在提示词里指定某张参考图作首帧或尾帧，但要严格一致时官方建议用首尾帧场景。2.0 系列不接受含真人人脸的参考图／视频，三条替代路径见"便利创作含肖像视频"教程。

### 4.3 输出规格与 token 用量

2.0 系列各分辨率的像素值（用于估算 token 与费用）：

| 分辨率 | 16:9 | 9:16 | 1:1 | 4:3 | 3:4 | 21:9 |
|---|---|---|---|---|---|---|
| 480p | 864×496 | 496×864 | 640×640 | 752×560 | 560×752 | 992×432 |
| 720p | 1280×720 | 720×1280 | 960×960 | 1112×834 | 834×1112 | 1470×630 |
| 1080p（仅 2.0） | 1920×1080 | 1080×1920 | 1440×1440 | 1664×1248 | 1248×1664 | 2206×946 |
| 4k（仅 2.0） | 3840×2160 | 2160×3840 | 2880×2880 | 3326×2494 | 2494×3326 | 4398×1886 |

token 估算公式：`(输入视频时长 + 输出时长) × 宽 × 高 × 24 / 1024`。720p 16:9 五秒约 108,000 token，与文档示例的 108,900 相符。输入含视频时有最低 token 用量，按分辨率、宽高比、时长查官方表或计算器；准确用量以 `usage.completion_tokens` 为准。首帧或首尾帧图片与目标像素不一致时平台居中裁剪，图生视频画面跳变的官方解法是先裁到上表像素或用 `adaptive`。

### 4.4 查询、列表、取消与过期

查询响应：`id`、`model`、`status`、`content.video_url`、`content.last_frame_url`、`usage.completion_tokens`、`usage.total_tokens`、`usage.tool_usage.web_search`、`error.code`、`error.message`、`created_at`、`updated_at`、`seed`、`resolution`、`ratio`、`duration` 或 `frames`、`framespersecond`、`service_tier`、`execution_expires_after`、`generate_audio`、`priority`、`draft`、`safety_identifier`。URL 24 小时有效，官方建议配置 TOS 数据订阅自动转存（本仓库不走这条路，见 §7.3）。

列表：`filter.status`、`filter.task_ids`（重复参数名传多个）、`filter.model`（接入点 `ep-` ID，用 Model ID 调用时是否可过滤未核实）、`filter.service_tier`、`page_num`、`page_size`，返回 `items[]` 与 `total`。

取消只对 `queued` 有效，响应空对象；`cancelled` 记录 24 小时后删除。任务在 `queued` 或 `running` 超过 `execution_expires_after` 会被标为 `expired`，这是一个本仓库状态机里没有的终态，需要映射为失败并核对是否计费（未核实）。

### 4.5 回调

任务状态变化时方舟向 `callback_url` POST，请求体与查询响应一致；状态含 queued、running、succeeded、failed、expired。succeeded 与 failed 若 5 秒内未收到成功回执会重试三次。文档没有来源校验、签名或 challenge，任何人都能伪造，只能当唤醒信号。

### 4.6 限流、开通与配额

模型列表页：2.0 系列企业账号 RPM 600、最大并发 10；个人账号 RPM 180、并发 3；2.0 的 4k 档企业与个人都是 RPM 15、并发 1。RPM 与并发是否也计入 GET 查询未写明。错误码 `QuotaExceeded` 另说明"排队中任务数超过限制"。开通 2.0 系列需余额大于 200 元、200 元档节省计划或资源包。限时折扣（mini 4 折、fast 75 折，至 2026-10-07 14:00）仅企业用户，且有 token 用量上限。

### 4.7 未核实项

- 用 Model ID 直接调用时，列表 `filter.model` 能否匹配；`ModelIDAccessDisabled` 错误说明部分账号只能用接入点。
- `expired` 与审核拦截是否计费。
- 2.0 的 1080p 输出编码（4k 明确是 10bit H.265）；H.265 会影响本仓库解码与浏览器播放。
- 个人账号与企业账号的判定方式。
- 创建接口是否对 `X-Client-Request-Id` 做任何去重（此前 SDK 核查未见承诺）。

## 5. 图片生成

### 5.1 火山方舟 Seedream

`POST https://ark.cn-beijing.volces.com/api/v3/images/generations`，同步返回，没有任务 ID 与查询接口。模型列表页给出的当前版本：

| 模型 ID | 能力 | 尺寸档位 | 输出价（元/张） |
|---|---|---|---|
| `doubao-seedream-5-0-pro-260628` | 文生图、单图／多图（≤ 10）生图、图层拆分、交互编辑；不支持组图与流式 | 1K／1.5K／2K（默认 2K），或自定 921,600 到 4,624,220 像素 | ≤ 261 万像素 0.30，以上 0.60；输入图首张免费、第 2 张起 0.02 |
| `doubao-seedream-5-0-flash-260915` | 同 pro，速度优先 | 同 pro | 0.12 |
| `doubao-seedream-5-0-260128`（同 `-lite-260128`） | 文生图、单图／多图（≤ 14）生图、组图（≤ 15 张）、流式、联网搜索 | 2K／3K／4K，或自定 3,686,400 到 16,777,216 像素，默认 2048x2048 | 0.22 |
| `doubao-seedream-4-5-251128` | 同 lite，无联网 | 2K／4K | 0.25 |
| `doubao-seedream-4-0-250828` | 同 lite，无联网 | 1K／2K／4K，或自定 921,600 到 16,777,216 像素 | 0.20 |

请求字段：`model`（必填）、`prompt`（中文建议 ≤ 300 字，英文 ≤ 600 词；文生图必填）、`image`（字符串或数组；公网 URL 或 `data:image/…;base64`；jpeg／png／webp／bmp／tiff／gif／heic／heif；≤ 30 MB；宽高比 1/16 到 16；总像素 196 到 3600 万）、`size`（档位或 `宽x高`，两种方式不可混用；档位方式下宽高比靠提示词描述）、`response_format`（`url` 默认，24 小时有效；或 `b64_json`）、`output_format`（`jpeg` 默认或 `png`，仅 5.0）、`watermark`（**默认 true**）、`sequential_image_generation`（`disabled` 默认或 `auto`，仅 lite／4.5／4.0）与 `sequential_image_generation_options.max_images`（1 到 15，参考图数 + 生成数 ≤ 15）、`stream`（仅 lite／4.5／4.0）、`optimize_prompt_options.mode`（`standard` 默认，`fast` 仅 pro）、`background=transparent`（仅 5.0 pro／flash，图生图且输入 1 张带透明通道的图）、`layer_decomposition`（仅 5.0 pro／flash）、`tools=[{type:"web_search"}]`（仅 lite）。

响应：`created`、`model`、`data[]`（每张 `url` 或 `b64_json`、`size`、`output_format`；组图里单张失败时该项带 `error`）、顶层 `error`（整个请求无图时）、`usage`（`generated_images` 只计成功张数、`input_images`、`output_tokens = Σ(宽×高)/256`、`total_tokens`）。组图场景中审核不通过的单张不影响其余图片继续生成，内部 500 则中止。

5.0 pro／flash 的档位像素映射（用于估算档位价格）：1K 1:1 1024x1024、16:9 1424x800、9:16 800x1424；1.5K 1:1 1536x1536、16:9 2048x1152、9:16 1152x2048；2K 1:1 2048x2048、16:9 2816x1584、9:16 1584x2816。1.5K 与 1K 同价。lite／4.5／4.0 的 2K 为 2048x2048 或 16:9 2848x1600，4K 为 4096x4096 或 16:9 5504x3040。

限流：全系 IPM 500 张/分钟；超限返回 `ModelAccountIpmRateLimitExceeded` 429。错误码与 4.1 同一张表，图片输入涉敏为 `InputImageSensitiveContentDetected`，输出涉敏为 `OutputImageSensitiveContentDetected`，输入图含真人为 `InputImageSensitiveContentDetected.PrivacyInformation`（是否对 Seedream 生效未核实）。开通条件与免费额度未在 API 页写明。

### 5.2 MiniMax image-01

`POST https://api.minimax.cn/v1/image_generation`，同步返回。文档只列 `image-01` 与 `image-01-live` 两个模型，没有更新的图片模型。

请求字段：`model`、`prompt`（≤ 1500 字符）、`aspect_ratio`（`1:1` 默认、`16:9`、`4:3`、`3:2`、`2:3`、`3:4`、`9:16`、`21:9`）、`width`／`height`（512 到 2048，8 的倍数，仅 image-01，优先级低于 aspect_ratio）、`n`（1 到 9）、`response_format`（`url` 默认或 `base64`）、`seed`、`prompt_optimizer`（默认 false）、`aigc_watermark`（默认 false）、`subject_reference[]`（图生图；`type` 目前只有 `character`，`image_file` 为公网 URL 或 data URL，jpg／jpeg／png，< 10 MB）、`style`（仅 image-01-live）。

响应：`id`、`data.image_urls[]` 或 `data.image_base64[]`、`metadata.success_count` 与 `failed_count`、`base_resp.status_code` 与 `status_msg`。URL 24 小时有效。错误用 `base_resp` 体系：0 成功、1002 限流、1004 鉴权、1008 余额不足、1026 涉敏、2013 参数错误、2049 无效 Key。

价格 0.025 元/张，不分尺寸。限流页写图片生成 RPM 10（免费与付费相同），主账号与子账号合计。`id` 只是本次生成的标识，没有配套的查询接口。

### 5.3 同步接口对本仓库的含义

- `submitOnce` 直接返回 `completed`，但返回前必须已经把图片字节写入私有对象存储（见 §7.3）。用 `b64_json`／`base64` 可以省掉一次外部下载，也避开 24 小时链接失效；图片体积通常在几 MB 内，可以接受。
- 超时、连接中断、5xx 都只能是 `unknown`，且没有任何找回路径：火山不返回 ID，MiniMax 的 `id` 没有查询接口。`readCostEvidence` 只能靠账单，首版按 07 §3.2 保留未决并人工核账。同步调用的超时要放宽到官方生成时长之上，且不能重试。
- 首版每个 job 只生成 1 张（`n=1`、`sequential_image_generation=disabled`），与"一个计划、一个作业、一个媒体"的现有模型一致；组图与图层拆分留到后续。
- 火山 `watermark` 必须显式传 `false`，否则每张图右下角带"AI 生成"。

## 6. 官方价格（国内，元）

视频：

| 模型 | 480P | 720P／768P | 1080P／2K | 5 秒 720P 一条 |
|---|---|---|---|---|
| MiniMax H3 | – | 0.50/秒 | 0.80/秒（2K） | 2.50 |
| MiniMax H3-Max | 0.33/秒 | 0.50/秒 | – | 2.50 |
| Seedance 2.0 | 46 元/百万 token（1080p 51；4k 26） | 同左 | 同左 | 4.97（480p 2.31，1080p 12.39，4k 25.27） |
| Seedance 2.0 fast | 37 元/百万 token（限时 75 折） | 同左 | 不支持 | 4.00（限时约 3.00） |
| Seedance 2.0 mini | 23 元/百万 token（限时 4 折） | 同左 | 不支持 | 2.48（限时约 1.00） |

MiniMax 视频附加：参考图前 5 张免费、之后 0.20 元/张；参考音频免费；输入视频按输入时长与输出分辨率同价计费。火山含视频输入时单价降为 28／22／14 元/百万 token，但输入时长计入 token 且有最低门槛。

图片：Seedream 5.0 pro 0.30 或 0.60 元/张（按输出像素档），flash 0.12，lite 0.22，4.5 0.25，4.0 0.20；MiniMax image-01 0.025 元/张。两家都只对成功生成计费。价格来源见 §8，实施时以控制台当日刊例价为准并记入 `pricingRevision`。

## 7. 对本仓库的映射

### 7.1 适配器接口已经存在

真实适配器实现 [packages/provider/src/assistance.ts:65](../../packages/provider/src/assistance.ts) 的 `AssistanceAdapter`：`executionMode`、`connectionVersionId`、`submitOnce`、`recoverSubmission`、可选 `query` 与 `requestCancel`。回执类型：提交 `accepted | rejected | unknown | completed`，查询 `pending | running | cancelled | completed | failed | unavailable`。视频走 `accepted` 加轮询，图片走 `completed`。[tests/helpers/async-provider-http.ts:275](../../tests/helpers/async-provider-http.ts) 是一份基于 `fetch` 的完整参考实现，含有界读取响应体、关联校验和错误到 `unknown / unavailable` 的映射。执行入口 [apps/api/src/modules/generation/worker.ts](../../apps/api/src/modules/generation/worker.ts) 在 SQL 里先写 attempt 与 `dispatching` 再调 `submitOnce`，任何异常都变成 `unknown`，不重试。

### 7.2 状态映射

| 供应商状态 | 适配器回执 | 本仓库 job 状态 |
|---|---|---|
| 视频创建返回 ID | `accepted` | `provider_pending` |
| 图片同步返回并已归档 | `completed` | `archiving → succeeded` |
| HTTP 4xx 参数、涉敏、余额、鉴权 | `rejected`（带错误码） | `failed` |
| 超时、连接中断、5xx、429 | `unknown` | `submission_unknown`，不重 POST；图片无找回路径 |
| `queued` | `pending` | `provider_pending` |
| `running` | `running` | `provider_running` |
| `succeeded` + URL 已下载并发布 | `completed` | `archiving → succeeded` |
| `failed`，火山 `expired` | `failed`（带 `error.code`） | `failed` |
| `cancelled` | `cancelled` | `cancelled` |
| 查询 404、429、超时、7 天窗口外 | `unavailable` | 保持原状，退避重查 |

两家视频都不支持找回丢失提交，`recoverSubmission` 首版返回 `Unresolved`，`recoverySupported=false`；`cancelSupported=true` 但只对 `queued` 有效，`running` 时返回 `unsupported`。图片没有取消。

### 7.3 结果归档

[packages/media/src/generation-work.ts:35](../../packages/media/src/generation-work.ts) 明确不抓取供应商 URL；`videoOutput` 与 `imageOutput` 要求回执里是 `{kind:"fixture_object", object:{key,versionId,bytes}, sha256, mime}`，key 匹配 `staging/<uuid>` 或 `originals/<uuid>`。所以适配器在看到成功结果时必须自己取字节（视频从 URL 下载，图片优先用 Base64 响应），经 `MediaStore.publish` 写入私有对象存储，再返回 `completed`。下载要有大小上限与 `AbortSignal`；4k 与 2.5 的 1080p 是 10bit H.265，`packages/media` 的严格解码与浏览器播放都要先验证，首版建议只开 720p／768P 与 2.0 的 1080p、H3 的 2K。图片首版建议 Seedream 用 2K 以内，jpeg 或 png 都在现有图片解码路径内。

### 7.4 三处硬阻断

- [packages/database/migrations/0094_generation_terminal_semantics.sql:39](../../packages/database/migrations/0094_generation_terminal_semantics.sql)：`p.execution_mode<>'test_fixture'` 直接抛错。迁移只增不改，需要新迁移放开 `verified_provider` 并保留同样的"恰好一个对象、与回执一致"校验。
- [apps/api/src/main.ts:13](../../apps/api/src/main.ts)、`apps/worker/src/main.ts:13`、`deploy/runtime/config.ts:139`：`PROVIDER_MODE` 非 `mock` 拒绝启动。
- [apps/worker/src/generation.ts:17](../../apps/worker/src/generation.ts)：要求 `GENERATION_ADAPTER=test_fixture`，且存在 API 密钥类环境变量就拒绝启动。真实适配器需要另一条显式的启动路径。

### 7.5 能力配置草案

`generation_capabilities.definition` 的字段可以直接承载四类能力；下面是按官方文档填的首版值，`verifiedAt` 留空直到 MV-01 通过。

| 字段 | MiniMax H3（video） | Seedance 2.0（video） | Seedream 5.0 pro（image） | MiniMax image-01（image） |
|---|---|---|---|---|
| `modelVersion` | `MiniMax-H3` | `doubao-seedance-2-0-260128` | `doubao-seedream-5-0-pro-260628` | `image-01` |
| `mode` | 首版 `text` 与 `first_last_frame`；`reference` 待 MV-02 | 同左 | 首版 `text` 与 `image_reference` | 首版 `text` 与 `character_reference` |
| `allowedResolutions` | `768P`、`2K` | `480p`、`720p`、`1080p` | `1K`、`1.5K`、`2K` | 由宽高决定，512 到 2048 |
| `allowedAspectRatios` | `16:9`、`9:16`、`1:1`、`4:3`、`3:4`、`21:9`（文生必填） | 同左加 `adaptive` | 靠提示词或 `宽x高`，1/16 到 16 | `1:1`、`16:9`、`4:3`、`3:2`、`2:3`、`3:4`、`9:16`、`21:9` |
| `minDurationSeconds` / `max` | 4 / 15 | 4 / 15 | – | – |
| `maxReferences` | 待实测（文档 9 图 3 视频 3 音频） | 9 图 3 视频 3 音频 | 10 张图 | 待实测（`subject_reference` 数组） |
| `audioOutput` | true，不可关 | true，可关 | – | – |
| `cancelSupported` | true（仅 queued） | true（仅 queued） | false | false |
| `recoverySupported` | false | false | false | false |
| `max_inflight` | ≤ 8（供应商 30） | 个人 3、企业 8（供应商 10） | ≤ 8（IPM 500） | 受 RPM 10 约束 |

`inputRules` 要把真人人脸限制（火山）、单张 30 MB、参考视频 15 秒合计、MiniMax 参考图 10 MB 等写成规则，而不是布尔值。Seedance 2.0 mini 与 fast 只是 `modelVersion` 与分辨率集合不同，复用同一定义模板。

### 7.6 费用估计与核对

`CostEstimate` 目前固定为 0（[apps/api/src/modules/generation/model.ts:456](../../apps/api/src/modules/generation/model.ts)），没有价格表和 `confirmedCost` 写入路径。首版估计输入：

- MiniMax 视频：`output_seconds × 单价[resolution] + input_video_seconds × 单价[resolution] + max(参考图数 − 5, 0) × 0.20`。成功后用 `usage` 直接得到 `final`。
- 火山视频：`(输入视频秒 + 输出秒) × 宽 × 高 × 24 / 1024 × 单价[分辨率, 是否含视频] / 1e6`，含视频输入时再取最低 token 门槛的较大值；门槛表首版可用余量覆盖。成功后用 `usage.completion_tokens × 单价` 得到 `final`。
- Seedream：`generated_images × 单价[模型, 像素档] + max(input_images − 1, 0) × 0.02`（后一项仅 5.0 pro）。成功后用 `usage.generated_images` 与 `data[].size` 得到 `final`。
- MiniMax 图片：`n × 0.025`；成功后用 `metadata.success_count` 得到 `final`。

两家文档都写只对成功计费，但按 07 §3.2，失败任务的 `final 0` 仍要保存查询到的 `error` 作为证据，不能由状态推断。视频任务记录 7 天后消失，同步图片接口根本没有记录，`readCostEvidence` 超过窗口或遇到 `unknown` 只能返回 `unavailable`。

### 7.7 凭据与连接

仓库里没有 `connections` 表，连接版本目前只是 worker 的一个环境变量。两家各建一个连接版本：service 分别为 `minimax-open-platform` 与 `volcengine-ark`，region 分别为 `cn` 与 `cn-beijing`，账号身份用平台可读的账号标识而不是密钥字符串。同一连接版本下按 purpose 挂多条能力（视频与图片各一条）。火山的个人／企业账号类型决定限流，要记入连接版本。

### 7.8 建议顺序

1. 新迁移放开 `verified_provider` 的媒体回执，加 `expired` 到失败映射的错误码常量。
2. 新的显式启动路径：`PROVIDER_MODE=verified`、按连接版本注册适配器、密钥从受控位置读取，保留现有 fixture 路径不变。
3. 先接 MiniMax H3 视频：按秒计费简单、没有 200 元开通门槛、RPM 300 宽松、mm_file 上传能避开公网 URL。跑通 MV-01、MV-04、MV-05、MV-06、MV-08。
4. 再接 Seedance 2.0 视频：复用同一 `query` 与下载归档逻辑，补 token 估价、最低门槛、`expired`、真人人脸拦截（MV-09）与并发 3／10 的槽位限制。
5. 图片先接 Seedream 5.0 flash 或 lite（便宜、同步、Base64 返回），再视角色一致性需求评估 5.0 pro 的多图参考与 MiniMax image-01 的 `character` 参考。同步接口的超时、`unknown` 无找回、账单核对路径要单独走一遍 MV-04 与 MV-08。
6. 回调两家都先不接；现有 5 秒起步、300 秒封顶的轮询已经满足，且回调没有可信来源校验。

## 8. 证据链接

MiniMax：[视频生成指南](https://platform.minimax.cn/docs/guides/video-generation)、[创建视频生成任务 v2](https://platform.minimax.cn/docs/api-reference/video-generation-v2-create)、[查询任务](https://platform.minimax.cn/docs/api-reference/video-generation-v2-query)、[查询任务列表](https://platform.minimax.cn/docs/api-reference/video-generation-v2-list)、[取消或删除任务](https://platform.minimax.cn/docs/api-reference/video-generation-v2-delete)、[视频再生成](https://platform.minimax.cn/docs/api-reference/video-generation-v2-regeneration)、[H3-Context-IR](https://platform.minimax.cn/docs/api-reference/video-generation-v2-h3-context-ir)、[文生图](https://platform.minimax.cn/docs/api-reference/image-generation-t2i)、[图生图](https://platform.minimax.cn/docs/api-reference/image-generation-i2i)、[文件上传](https://platform.minimax.cn/docs/api-reference/file-management-upload)、[速率限制](https://platform.minimax.cn/docs/guides/rate-limits)、[错误码](https://platform.minimax.cn/docs/api-reference/errorcode)、[按量计费](https://platform.minimax.cn/docs/guides/pricing-paygo)、[视频资源包](https://platform.minimax.io/docs/guides/pricing-video)、[SDK 接入](https://platform.minimax.cn/docs/guides/quickstart-sdk)、[文档索引](https://platform.minimax.cn/docs/llms.txt)。

火山方舟：[创建视频生成任务](https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh)、[查询视频生成任务](https://docs.volcengine.com/docs/ark/get-video-generation-task-api?lang=zh)、[查询任务列表](https://docs.volcengine.com/docs/ark/list-video-generation-tasks-api?lang=zh)、[取消或删除任务](https://docs.volcengine.com/docs/ark/cancel-or-delete-video-generation-tasks-api?lang=zh)、[图片生成 API](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh)、[错误码](https://docs.volcengine.com/docs/ark/error-codes?lang=zh)、[模型列表](https://docs.volcengine.com/docs/ark/model-list?lang=zh)、[Seedance 2.0 系列教程](https://docs.volcengine.com/docs/ark/seedance-2-0?lang=zh)、[模型价格](https://www.volcengine.com/docs/82379/1544106)、[安装及升级 SDK](https://www.volcengine.com/docs/82379/1541595)。火山文档页为前端渲染，本次通过浏览器读取折叠段落原文。

仓库内相关文档：[07 模型接入](../implementation/07-provider-adapter.md)、[58 固定异步生成任务](../implementation/58-async-generation-lifecycle.md)、[48 视频生成运行时](../implementation/48-video-generation-runtime.md)、[ADR 0003](../adr/0003-uncertain-provider-submission.md)、[2026-09-07 模型接入证据](2026-09-07-implementation-model-evidence.md)。

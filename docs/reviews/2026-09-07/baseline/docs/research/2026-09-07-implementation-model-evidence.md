# 实施前模型接入证据：Seedance 优先

核查日期：2026-09-07。服务范围分别为国内火山方舟、海外 BytePlus ModelArk、海外 BytePlus LAS；不互相外推。仅访问公开官方文档与官方 SDK，没有登录、开通、生成、付费或测量质量。本报告为实现设计提供约束，不是已完成的接口认证。

## 1. 本轮最重要的结论

1. **生成提交通道必须检查 SDK 自带重试。** 本次核查的火山 Python SDK 默认重试两次，底层会重试超时及部分错误；没有找到对应视频创建接口的服务端幂等承诺。只在业务层加锁不能避免底层重复提交。[SDK 常量][sdk-constants]、[SDK 请求实现][sdk-base]
2. **请求结果未知是一种需要处理的生产状态。** 已持久化本地操作与预算，仍可能在供应商接受任务后失去返回的任务 ID。当前证据不足以保证自动恢复所有此类任务。
3. **任务、素材和费用必须分别落库。** 供应商完成、媒体转存可用、人工采用、费用核对不是同一状态变化。
4. **具体算子与具体模型要分开。** LAS 的增强视频编辑算子含自己的重试、结果诊断和存储方式，不能把这些处理能力当作全部 Seedance API 的原生契约。[LAS 编辑算子][las-edit]

其中第 2、3 项是本项目的架构推论；第 1、4 项的供应商事实见下文。

## 2. 官方证据与适用范围

### 2.1 国内火山方舟：本次确认到 SDK 表面

本次读取 `volcengine/volcengine-python-sdk` 官方仓库；另通过公开 GitHub API 取得当时 `master` 的提交 `bd7d94433803d213a85f918ff2eb049067655eff`（提交时间 2026-09-03）。以下五份文件的固定提交与当时 `master` 内容逐一比对相同。实施应选择并锁定实际发布的 SDK 版本，不能仅依赖分支名。[固定提交][sdk-commit]

| 接口 | 官方源码行为 | 本次无法证明的部分 |
|---|---|---|
| 创建 | `POST /contents/generations/tasks`，返回任务 ID；支持取得原始响应 | 创建请求的服务端幂等键与去重窗口 |
| 查询 | `GET /contents/generations/tasks/{task_id}` | 各模型的查询期限、状态延迟与 SLA |
| 列表 | 支持按任务 ID、模型、状态、服务层级过滤 | 按客户端请求 ID 精确恢复失联提交 |
| 删除 | `DELETE /contents/generations/tasks/{task_id}` | 哪些状态可以取消、取消竞态、退款和删除结果语义 |

上述路径相对于 SDK Base URL；源码默认 Base URL 为国内北京方舟 `https://ark.cn-beijing.volces.com/api/v3`。任务接口本身没有给取消状态条件或幂等保证，不能由方法名称补全这些契约。[任务接口源码][sdk-tasks]、[SDK 常量][sdk-constants]

SDK 输入类型包含文字、图片、音频、视频、草稿任务；媒体包含独立 `role` 字符串。类型没有枚举所有角色含义，也没有验证不同模型允许的组合。因此“SDK 能传入”不等于“选定模型接受”。[输入类型][sdk-input]

查询类型包含供应商任务 ID、模型、状态、错误、输出链接、时间戳、实际时长/帧率/比例、音频开关及 token 用量；这些是可保存的结果证据，不保证每种结果均返回全部字段，也不能直接把 token 转为金额。[结果类型][sdk-output]

### 2.2 SDK 默认重试与请求关联

`DEFAULT_MAX_RETRIES = 2`。底层在超时、连接异常和部分响应状态下尝试重新执行请求；视频 `create` 使用相同底层 POST 路径。本次源码未显示针对视频创建的单独防重保护。[SDK 常量][sdk-constants]、[SDK 请求实现][sdk-base]、[任务接口源码][sdk-tasks]

默认头部含 `X-Client-Request-Id`；底层构建请求时可生成此值。仅看到该关联字段不意味着服务器按它去重，也不意味着可以通过它取得任务 ID。[SDK 请求实现][sdk-base]

**设计建议：** 为付费生成提交使用关闭自动重试的独立客户端配置，例如选定 SDK 支持并验证的 `max_retries=0`；同时检查 HTTP 包装器、队列处理器和代理是否再次重试 POST。查询使用另一种退避策略。保存稳定的本地提交关联 ID、实际请求头关联值和返回头，以便排查；不要把它们命名为已验证的供应商幂等键。

### 2.3 BytePlus LAS：已取得完整正式接口正文

以下仅适用于 LAS 文档中的柔佛服务，更新于 2026-08-17：[增强／基础视频生成][las-generation]

| 主题 | 已核实事实 |
|---|---|
| 异步协议 | Bearer API Key；创建返回 `id`，随后按 ID 查询；提供 `callback_url` |
| 保存期限 | 任务 ID 保留 7 天；输出预签名 URL 有效 24 小时 |
| Seedance 2.5 | 列有 `dreamina-seedance-2-5-260628`；输出 480p/720p、4–30 秒 |
| 参考输入 | 支持媒体 URL、部分 Base64 和白名单资产 ID；临时 URL 需覆盖执行期 |
| 人脸参考 | 真人脸图像／视频不能直接上传，授权素材通过开通后的资产库 ID 使用 |
| 声音 | 列明 `generate_audio` 与声音参考能力；未见独立人声／音乐／音效轨输出契约 |
| 费用 | 与输入／输出视频时长及规格相关；仅成功生成收费，估算以账单核对 |

同页视频输入段存在疑似复制错误，不据此编码 2.5 参考视频数量／时长。回调状态列表与查询状态列表并不完全一致。回调签名、取消操作与创建幂等语义未在该页核实。此处的人脸条件也不能外推为“所有 AI 虚构写实角色均不可用”。[增强／基础视频生成][las-generation]

### 2.4 BytePlus LAS：增强编辑为独立算子

`las_video_seedance_replace` 使用 `/api/v1/submit`、`/api/v1/poll`，提供人物、场景、物体替换，结果可写入有权限的 TOS 路径，并返回诊断文件。它与视频生成任务路径属于不同适配契约。[增强视频编辑][las-edit]

该算子允许自动评估后重试；官方明确每次重试另行计费，响应包含尝试次数与选中尝试序号。人物替换要求相应资产库白名单。以上不能外推到国内 API 或普通多参考生成。[增强视频编辑][las-edit]

**设计建议：** MVP 未验证这一算子时不暴露其能力；将来接入时，默认关闭供应商内部质量重试，或明确显示最大尝试数与相应预算。保存算子版本和内部尝试信息，避免一个外层任务掩盖多次消费。质量返工与网络重试使用不同控制项。

### 2.5 回调：已核实的保证仅覆盖明确列出的 LAS 算子

LAS 异步回调文档明确说明尽力送达，没有严格有序或恰好一次保证，需要轮询补偿；支持列表包含上述增强编辑算子。文档使用 `callback.url`，列出 HTTPS、直接 POST、尽快返回等要求。本次未取得可验证的回调签名契约。[LAS 异步回调][las-callback]

该文档同时有中间与终态通知，却建议按任务 ID 去重。**本项目设计不能把“处理过此任务的任意通知”作为丢弃后续通知的条件。** 应保存事件／内容指纹、观测状态和更新时间，允许排队后接收完成；重复的同一次状态效果只落一次。若无法核验事件真实性，则通知只唤醒后端，持供应商凭证查询后再改变权威状态。不要直接使用未知回调中的媒体 URL 下载。

此页的协议不自动适用于 `callback_url` 风格的普通生成接口。[LAS 异步回调][las-callback]

### 2.6 未取得正文的入口与不能混用的相邻服务

- 国内[创建][volc-create]、[查询][volc-get]、[删除][volc-delete]文档本次跳转后未取得有效正文；结论是未核实，而不是服务未开放。
- 海外 ModelArk [创建][ark-create]、[取消／删除][ark-delete]与[真人资产上传][ark-assets]页面本次只取得标题和更新时间，未用其他转售商抄录补齐参数。
- 火山 VOD 的[媒体处理幂等说明][vod-idempotency]确实有 `ClientToken` 契约，但它列明的是点播媒体处理接口。不能把这一行为移植成 Seedance 视频生成的已知能力。
- BytePlus 的[参考与资产 FAQ][assets-faq]说明资产 ID 与临时访问 URL 生命周期不同；不应据此假定资产 ID 跨账号、地区或服务通用。

## 3. 对落地方案的具体建议（均为本项目设计）

### 3.1 供应商适配器边界

最少表达 `validate/prepareInputs/submit/query/archive`；`cancel`、`recoverSubmission`、`verifyCallback` 只有契约确认后才启用。恢复可以返回“无法判断”，取消可以返回“不支持／已过可取消阶段”，不要通过布尔值隐藏不确定性。

每条能力配置绑定：服务产品、地区、账号连接、具体模型或算子版本、输入模式、输出规格、计费规则版本、已验收状态。API 适配配置与官方模型宣传信息分开。

### 3.2 提交结果未知的处理

| 时点或结果 | 本地处理 |
|---|---|
| 请求尚未发出 | 事务保存输入快照、预算预占、尝试记录和待执行事件 |
| 供应商明确返回任务 ID | 保存 ID，进入查询；后台崩溃可按 ID 恢复 |
| 已开始发送但没有可确定结果 | 进入 `submission_unknown`，不自动新建另一次 POST、不立即释放预占 |
| 取得已核实的精确关联恢复能力 | 核对同一连接、模型及实际输入后关联原任务 |
| 只能找到时间相近的候选任务 | 不自动认领；保留证据并进入待核对 |
| 用户决定另发一次生成 | 明示原次仍可能计费，建立新的尝试与预算，不覆盖原记录 |

预算预占不应无期限且无人处理；配置告警时限与管理员核对入口。超过任务保留期仍未知时，业务可结束等待并保留“执行／费用待核对”记录，不能伪造“确认未执行”。

### 3.3 素材准备与结果归档

- 保存源媒体版本、内容摘要与本次用途；上传到供应商的句柄另存为连接与地区作用域内的映射。
- 输入地址在提交前检查可访问性及剩余有效期；覆盖可预期排队与执行期，源文件仍由平台保存。供应商不支持请求头鉴权时，使用受控的限时读取地址；不把签名 URL 当持久素材身份。
- 供应商完成后立即持久化输出描述并调度归档；下载、校验、媒体探测、代理／缩略图各可恢复。归档失败先恢复归档，不自动重新生成。
- 保存实际帧率、时长、音轨和媒体区间。对混合音轨只声明实际存在的轨道，避免 UI 承诺原生分轨。
- 同一长片可以关联多个镜头区间；采用使用平台媒体版本，不能直接采用临时供应商链接。

### 3.4 状态与账本

执行、归档、采用、审阅和费用使用分开的状态。终态与乱序事件按明确规则合并，未知供应商枚举保存原文并告警。费用保留估算、实际用量、供应商账单和调整记录；供应商成功但归档失败仍可能产生费用。

若采用带内部重试的增强算子，最大支出应包括获准的全部尝试；若无法取得内部细项，显示账单待核对，不把顶层任务数当作生成次数或最终消费金额。

## 4. 启用真实生成前的有界验证包

| 验证 | 必须得到的证据 | 尚未验证时的默认行为 |
|---|---|---|
| 正式接入 | 选定地区、产品、账号、模型 ID、配额、供应商允许的用途与素材路径 | 功能标记未开通；支持模拟适配器推进实现 |
| 输入组合 | 同一虚构写实角色的角色／首尾帧／声音／视频参考通过指定通路 | 只开放通过校验与实测的模式 |
| 提交与恢复 | 创建、查询、网络异常、进程崩溃；自动重试次数确认为零 | 结果未知进入待核对 |
| 取消 | 排队到运行竞态、已完成时点击取消、费用与记录影响 | 仅撤销本地未提交任务；不承诺停止供应商执行 |
| 归档 | 输出过期前保存、重复下载、归档中断、旧链接恢复资格 | 告警并重试归档；不重新生成 |
| 通知 | 签名或查询确认、重复／缺失／乱序／非法任务通知 | 使用持久轮询；回调可不启用 |
| 质量与成本 | 同一场戏的对白、多人、道具、返工，以及实际账单 | 无可交付质量与整剧费用承诺 |

这些验证不要求当前扩大模型数量或引入所有高级编辑接口；目标是让首条制作路径可恢复、可核对，并在达到标准的样片上正式启用。

## 来源

[sdk-commit]: https://github.com/volcengine/volcengine-python-sdk/commit/bd7d94433803d213a85f918ff2eb049067655eff
[sdk-tasks]: https://github.com/volcengine/volcengine-python-sdk/blob/bd7d94433803d213a85f918ff2eb049067655eff/volcenginesdkarkruntime/resources/content_generation/tasks.py
[sdk-base]: https://github.com/volcengine/volcengine-python-sdk/blob/bd7d94433803d213a85f918ff2eb049067655eff/volcenginesdkarkruntime/_base_client.py
[sdk-constants]: https://github.com/volcengine/volcengine-python-sdk/blob/bd7d94433803d213a85f918ff2eb049067655eff/volcenginesdkarkruntime/_constants.py
[sdk-input]: https://github.com/volcengine/volcengine-python-sdk/blob/bd7d94433803d213a85f918ff2eb049067655eff/volcenginesdkarkruntime/types/content_generation/create_task_content_param.py
[sdk-output]: https://github.com/volcengine/volcengine-python-sdk/blob/bd7d94433803d213a85f918ff2eb049067655eff/volcenginesdkarkruntime/types/content_generation/content_generation_task.py
[las-generation]: https://docs.byteplus.com/en/docs/byteplus_las/video_gen_enhanced
[las-edit]: https://docs.byteplus.com/en/docs/Byteplus_LAS/Enhanced_video_editing
[las-callback]: https://docs.byteplus.com/en/docs/Byteplus_LAS/Asynchronous_callback_API
[volc-create]: https://www.volcengine.com/docs/82379/1520757
[volc-get]: https://www.volcengine.com/docs/82379/1521309
[volc-delete]: https://www.volcengine.com/docs/82379/1521720
[ark-create]: https://docs.byteplus.com/en/docs/ModelArk/1520757
[ark-delete]: https://docs.byteplus.com/en/docs/ModelArk/1521720
[ark-assets]: https://docs.byteplus.com/en/docs/ModelArk/2315856
[vod-idempotency]: https://www.volcengine.com/docs/4/1218689
[assets-faq]: https://ai.byteplus.com/en/help/article/how-do-i-use-reference-images-virtual-characters-and-the-asset-library-correctly

# AI 短剧工作台：生成 API 与创作协作产品核查

访问日期：2026-09-07。范围：不超过 10 人的短剧工作室，围绕镜头生产、资产连续性、生成任务、成本与审阅进行有界调研。仅采用供应商文档、官方 SDK 源码与第一方产品页面；没有注册、付费或真实生成。以下“已核查”表示公开文档或源码中存在该能力，不代表真实账号已获准调用、质量经过测试或具体套餐已购买。

## 结论及设计影响

1. **生成任务与镜头必须分开建模。** 火山官方 SDK 与 Runway 文档均呈现先提交任务、再查询结果的流程；一个业务镜头需要多次候选生成是本工作台的设计推论。应保留每次输入快照、供应商任务 ID、状态、输出和费用，再由人选择当前采用版本。
2. **供应商返回结果后还需要素材入库。** Runway 输出 URL 明确会过期。因此“模型生成成功”不等于“团队素材已就绪”，需另有下载、校验、存储、缩略图/代理文件状态。不能直接把供应商 URL 当长期素材地址。
3. **角色资产管理能改善输入一致性，不能承诺画面一致性。** 公开资料确认参考图片/素材输入和 LTX Elements 复用；本次没有测试跨镜头人物、服装、场景、中文对白、多人交互等质量。产品应把“引用哪个角色版本”与“这一镜是否过审”分开。
4. **模型能力与费率应版本化配置。** 参数组合、时长、格式、输入计费项因服务和模型而异，不适合把所有模型压成统一的“文案 + 5 秒 + 1080p”接口。
5. **以镜头审阅和生产记录为工作台核心。** LTX 已覆盖剧本拆解、元素复用与分镜；Runway 已把共享评论和团队资产纳入协作产品。我们的潜在价值是把镜头责任人、重做原因、采用版本、成本和交付连接起来。这是待工作室访谈验证的产品判断，不是竞品缺失能力的断言。

## 火山方舟 / Seedance：可验证事实与边界

火山文档链接发生域名跳转后，本次文本抓取未取得正文。尝试了原文档、跳转后文档、语言参数与公开页面 HTML；没有使用社区文章、非官方 API 转售商或第三方抄录来填补参数事实。改用 `volcengine` 官方 GitHub 组织维护的 Python SDK 交叉核查，因此以下结论仅限 SDK 接口表面。

| 主题 | 本次核查结果 | 设计含义（推论） |
| --- | --- | --- |
| 异步任务 | SDK 创建接口向 `/contents/generations/tasks` 发 POST，返回 `ContentGenerationTaskID`；`get` 按任务 ID 查询。另有列表、删除方法。 | 后端持久化任务，不依赖浏览器页面保持在线；支持恢复查询。 |
| 创建参数 | `create` 暴露 `callback_url`、`return_last_frame`、`duration`、`frames`、`resolution`、`ratio`、`seed`、`generate_audio`、`draft` 等字段。 | 适配器应保留供应商原始请求，能力表决定用户可选项。字段存在不代表每个模型均支持。 |
| 输入结构 | 内容类型定义包含文本、图片 URL、音频 URL、视频 URL；媒体结构含 `role`。 | 将角色/场景等业务资产编译成一次生成请求；不把 URL 本身当角色身份。 |
| 查询输出 | 任务类型包含状态、错误码/信息、`video_url`、`last_frame_url`、模型、seed、分辨率、时长、帧率和时间戳。 | 保存请求参数与实际输出参数两套记录；采用版本关联真实素材。 |
| 用量 | 返回类型含 `usage.completion_tokens` 与可选 `total_tokens`。 | 账本至少同时保留供应商原始用量、估算金额、结算金额及估算/已核对状态。不能直接把该 token 数当金额。 |

来源：[官方 SDK 任务接口](https://github.com/volcengine/volcengine-python-sdk/blob/master/volcenginesdkarkruntime/resources/content_generation/tasks.py)、[官方输入类型](https://github.com/volcengine/volcengine-python-sdk/blob/master/volcenginesdkarkruntime/types/content_generation/create_task_content_param.py)、[官方任务与用量类型](https://github.com/volcengine/volcengine-python-sdk/blob/master/volcenginesdkarkruntime/types/content_generation/content_generation_task.py)。分支为访问当日的 `master`，实现阶段应锁定 SDK 版本重新核对。

**未核实，不能写入产品承诺：** 当前中国账号实际可开通的 Seedance 模型 ID/版本；各模型首帧、尾帧、参考模式的具体组合与数量限制；允许的时长和分辨率；生成 URL 保存期限；任务记录保存期限；回调鉴权、重试、顺序、送达保证；取消何时生效和是否收费；视频 token 计算公式与人民币费率；真实人物参考限制与账号审核条件；地区可用性、并发配额和服务 SLA。

本次发现 `callback_url` 字段，只能确认 SDK 支持传递回调地址，不能由此断言送达语义。对接默认方案应是“经核验的回调 + 定期查询对账”，回调是否可启用以接入验证为准。

待重新打开的第一方入口：[创建视频生成任务](https://www.volcengine.com/docs/82379/1520757)、[Seedance 使用文档入口](https://www.volcengine.com/docs/82379/1366799)。国际 BytePlus 的[创建任务页](https://docs.byteplus.com/en/docs/ModelArk/1520757)本次也只抓到标题与更新时间，未用其规则替代中国火山服务规则。

## Runway API：作为任务架构与备用适配器的对照

| 主题 | 官方可验证事实 | 对工作台的影响（推论） |
| --- | --- | --- |
| 创建与查询 | 官方入门示例提交 `image_to_video` 后返回任务 ID，SDK 用 `waitForTaskOutput` 等待；输出文档给出 `GET /v1/tasks/:id`。 | 供应商适配器至少具有 submit、getStatus、fetchOutputs；轮询应在服务端执行。 |
| 输出寿命 | 输出 URL 在访问 API 后 24–48 小时内过期，官方明确要求下载并存入自己的存储，不直接暴露在产品中。 | 完成后立即安排素材转存；转存失败优先重试下载，而非重新生成视频。 |
| 输入传递 | 支持 HTTPS URL、data URI、临时上传；URL 需正确 MIME/长度头、支持 HEAD，不跟随重定向。 | 提交前媒体探测与可访问性校验；使用自身对象存储的可读取地址。 |
| 临时上传 | `runway://` URI 有效 24 小时，可重复使用；上传有文件大小和频率约束。 | 临时上传缓存必须记录到期时间；重试时检查并刷新，源素材仍归自身保存。 |

来源：[API 入门](https://docs.dev.runwayml.com/guides/using-the-api/)、[API 输出](https://docs.dev.runwayml.com/assets/outputs/)、[输入约束](https://docs.dev.runwayml.com/assets/inputs/)、[临时上传](https://docs.dev.runwayml.com/assets/uploads/)。

模型与输入模式也不可互换：官方模型目录在访问日列有 Runway 自有模型及第三方模型。Gen-4.5 支持文本或图片生成视频；Gen-4 Image 支持带标签的参考图输入，官方示例在提示词中引用参考图标签。这支持“先由角色参考生成镜头静帧，再由静帧生成视频”的可选流程，但不能据此保证角色每次完全一致。[模型目录](https://docs.dev.runwayml.com/guides/models/)、[参考图调用示例](https://docs.dev.runwayml.com/guides/using-the-api/)。

分辨率/时长的一个**有明确服务归属的例子**：Runway 输入文档把其 `Seedance 2.5` 接口写为 480p、720p、1080p，4–30 秒；Gen-4.5 文生视频仅列出横版 `1280:720` 和竖版 `720:1280`，图生视频可选更多比例。这里只用它证明“能力约束必须按供应商 + 模型 + 输入模式配置”，不将 Runway 参数套用到火山 Seedance。[Runway 输入约束](https://docs.dev.runwayml.com/assets/inputs/)。

计费并非统一按生成次数：官方价格页采用 credits，视频常按秒计费，部分模型还计入输入或参考视频秒数；不同输出格式可能追加费用，某些处理按输出帧计费。模型路由返回实际使用模型和实际 credit 成本。工作台宜保存费率版本、出入媒体秒数、分辨率、数量、估算值、供应商原始用量及最终对账值；短剧预算应追踪“所有尝试的消耗”和“采用镜头的有效成本”。本报告不以具体价格测算商业可行性。[官方计费](https://docs.dev.runwayml.com/guides/pricing/)。

并发上限与每日配额也不同：超并发的任务可进入 `THROTTLED`，超每日生成配额可返回 429，且可因供应商负载低于最大并发。官方配额页对“按模型分别限制”与“同模态共享限制”存在不够一致的措辞，本次不复制具体额度。工作台仍需自己的团队预算、提交节流、优先级和在途任务可视化。[官方配额说明](https://docs.dev.runwayml.com/usage/tiers/)。

**未核实：** Runway 生成 API 的通用 webhook 保证、请求幂等键、各失败原因的退款规则、中国工作室注册/付款/网络可用性、真实账号并发、全部模型的时长枚举。未发现文档不等于能力不存在，接入前需针对所选模型验证。

## 第一方创作产品对照

| 产品 | 核查到的能力 | 可以借鉴的设计 |
| --- | --- | --- |
| LTX Studio | 第一方更新说明：从剧本自动拆场景与镜头；人物、物件提取成 Elements，可修改、标记、复用；生成前可审视结构并选择模型/比例。 | 将剧本拆解结果做成可修改的生产计划，在昂贵视频生成之前确认人物与镜头。 |
| LTX Studio | 官方产品页写有项目/board/frame 三级编辑、协作与 MP4 / PDF 分镜导出。 | 同一组镜头支持表格管理、分镜预览和交付导出，不另建互不关联的数据。 |
| LTX Studio | 官方帮助页有 Viewer / Editor / Owner。Editor 可生成/删除项目资产；Owner 管访问和删除项目；Viewer 可看/下载、不可生成或编辑；共享项目访问者需要登录。 | 小团队先做少量清晰权限，把“能花钱生成”和“仅审阅”分开。 |
| Runway | 官方套餐帮助页明确 Team 及以上提供多席位、共享评论、更多项目和品牌资产工具。 | 协作与公共素材是成熟创作产品的一部分，生产工作台应从第一版包含共享资产和反馈记录。 |

来源：[LTX 分镜更新](https://ltx.io/blog/ltx-storyboard-generator-update)、[LTX 分镜产品页](https://ltx.io/studio/platform/ai-storyboard-generator)、[LTX 项目共享帮助](https://help.ltx.io/hc/en-us/articles/33649840422802-Sharing-your-project)、[Runway 团队方案帮助](https://help.runwayml.com/hc/en-us/articles/21664961171475-Which-plan-is-right-for-me)。

LTX 第一方博客另描述时间点评论、自动生成版本、对照审阅及审批关卡，但本次未登录测试这些细节。其另一篇教程的“外部人员无需完整平台访问”与共享帮助页“所有项目访问者需登录”不能直接合并成“免注册审阅”。核心设计可以自行提出定时点评论、版本审批与可撤销审阅链接，但应把它们标为我们的设计，而不是已验证竞品操作事实。[LTX 预演工作流文章](https://ltx.io/blog/how-to-build-a-complete-pre-visualization-pipeline)、[LTX 使用教程](https://ltx.io/blog/ltx-studio-tutorial)、[LTX 共享帮助](https://help.ltx.io/hc/en-us/articles/33649840422802-Sharing-your-project)。

## 进入实施前的最小验证包（建议，非本次执行）

1. 选定一个中国可用的官方主供应商、一个具体模型和一种主要风格，以已有账号核验开通、参考输入、时长、输出、计费与取消语义。
2. 用同一角色资产制作 5–10 个代表镜头，覆盖近景/全景、动作、换景、双人、对白；由真实导演记录可用候选率、平均重做次数、每个采用镜头的总耗时和总支出。
3. 验证浏览器关闭后继续生成、重复提交、回调重复/缺失、轮询恢复、供应商成功但下载失败、输入地址过期等情况，确认任务与素材状态不混淆。
4. 让 3–5 人协作完成一段完整样片，检查镜头认领、角色版本变更、退回重做、剪辑交接与成本核对是否替代了原来的人工记录。

这些验证用于选定接入与 MVP 边界，不应在尚无质量/账号数据时承诺“一键整剧”或预设整剧生成成本。

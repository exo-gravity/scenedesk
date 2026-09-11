# 单视频生成：固定任务、原视频和独立预览

本片将已有单图后端闭环扩展到单视频，继续使用原 `GenerationPlan`、`GenerationJob`、attempt、Media 与画布协议。执行能力只有显式本地 `video_fixture_v1`，输出事先发布的两秒技术测试图案及可选测试音轨，不运行模型、不解释提示，也不构成真实 AI 效果验收。默认迁移不创建或启用任何能力。已发布的 image、提示目标和文本能力身份不变，不因 purpose=video 就使旧描述型能力可执行。

## 输入、版本与原 API

API 路径均沿原 `/v1/tenants/{tenantId}`。`POST /generation-plans` 接收原 `PlanInput`，`POST /generation-jobs` 只接收 `{planId}`。请求 video 时必须选择一个或多个固定 shot revision，或一个真实已保存的 video draft。不会引用未选择的场次文字、邻近节点或最新镜头版本。`assistanceSource` 仅保留固定建议修订的出处，执行提示和参考仍由完整 `resolvedInput` 决定。

共享视觉 resolver 固定实际提示、capability/connection version、镜头要求、启用上下文与参考的用途、顺序、subjectAssetId、assetRevisionId。原图路径保留兼容入口和错误语义；视频仅新增其输出参数校验：

- `resolution` 必须是当前能力明确允许的 `宽x高`；只有一个允许值时可采用该默认值。
- 可选 `aspectRatio` 必须在能力允许值内，并与宽高按整数交叉乘积完全一致。
- `durationSeconds` 必填，为正整数，位于能力的 min/maxDurationSeconds 范围，且不超过媒体处理安全上限 7200 秒。
- `withAudio` 可省略，固定解析为 false；true 要求能力 `audioOutput=true`。本地技术配置只有两秒、256x144、16:9，允许无音轨或单条 AAC 混合测试音轨。它不声明对白、分轨、配音、口型或真实生成效果。
- 实际引用逐项受 `inputRules` 约束。当前本地视频能力只允许最多四张明确用途的 PNG/JPEG/WebP 图片参考；不把任意视频或音频作为隐式支持的输入。

画布继续调用 `POST /projects/{projectId}/scenes/{sceneId}/canvas/generation-plans`，提供保存成功的 canvas If-Match 和原 body。video draft 的 prompt/model/output 必须与保存内容一致。语义 fingerprint 包含真实生成输入，排除坐标、标题、大小、分组和停用边；只移动节点不会使计划过期。执行前实际来源内容变化时阻断旧计划。execute 成功后，画布后续编辑不会修改或否决已经固定的 job；job 读接口仍如实显示 `inputOutdated`。

## 耐久回执与媒体验证

每个计划只有一个 job，每个 job 只有一个提交 attempt。发送前按原规则重新检查当前创作者权限、启用能力身份和固定引用的可用性。未知响应保留 `submission_unknown`，只能通过原关联证据恢复；本地归档重做不调用 submit。视频 transport 与图片使用同一个受限适配接口，完成回执只包含一个固定私有对象版本、字节数、SHA-256 和 MIME=video/mp4，不接收任意外部 URL、签名访问地址或文件系统路径。

视频使用既有 `generation_media_outputs` 和 `media_generation` 队列提示，不建立第二套任务表。原回执、独立 `Media(status=processing, sourceJobId)` 和归档提示在同一事务衔接；队列写入失败时本地效果回滚、耐久回执仍保留，下次只重做入库。旧图片回执仍使用 images 集合，新内部视频回执使用 videos 集合，二者均限定一个结果，不能交叉解释。

原媒体 worker 使用固定版本下载与哈希核对，进行签名识别、受限完整解码、尺寸和音轨验证，再发布独立 immutable original。只在这些步骤成功之后，事务才令 Media ready、Job succeeded、mediaIds 可见。它保留真实 `durationUs`、`fpsNum/fpsDen` 和 `hasAudio`。

本地视频 profile 允许至多一帧的容器时间量化误差，以 probe 报告的有理数帧率作精确核对：

`abs(actualDurationUs - requestedSeconds × 1_000_000) × fpsNum ≤ 1_000_000 × fpsDen`

JavaScript 使用 BigInt，数据库使用精确整数/NUMERIC 乘法，两层都拒绝缺失、非正或无效时间依据。超界、尺寸或音轨不符会使原输出不可验收；不裁剪、补帧、补音轨，不伪造请求时长覆盖真实元数据。后续真实服务必须按实际验证能力决定其输出容差，不能从技术 fixture 继承质量结论。

ready 视频在同一事务建立独立 poster 和 proxy 记录及各自队列提示。两者走已有实际解码及 H.264/AAC 预览流水线，预览的状态不会覆盖原视频成功事实。可通过原 `/media/{mediaId}/access` 当前授权取得 ready proxy；代理尚未就绪或失败时，ready original 仍允许 inline 授权访问。本地 fixture 原文件本身为 H.264/yuv420p MP4，可选 AAC 音轨。API 不返回内部对象 key/versionId。

临时归档错误最多处理六次，耗尽后进入 `archive_failed`。用户经原 `/generation-jobs/{jobId}/recover-archive` 明确恢复同一文件的归档，递增步骤，使旧提示失效；不增加模型 attempt。原文件损坏、缺失或输出与固定请求不符属于不可重试问题，不能转化为再次生成授权。不同终局回执冲突仍保留 `reconciliation_required` 及先前已验证原媒体，不因迟到事件覆盖状态。原队列 repair 也扫描视频归档，无需新恢复服务。

## 结果历史与人工放置

`GET /projects/{projectId}/canvases/{canvasId}/generation-plans` 仍按原计划、origin 和 jobId 取回历史；原 draft 删除后记录仍在。`POST /projects/{projectId}/canvases/{canvasId}/results` 使用原 If-Match 与幂等键，验证 job 来自当前 canvas、所选媒体确是该成功 job 的 ready 结果后，显式建立 kind=video 的独立媒体节点。

原 unique(canvas, job, media) 继续防止重复身份；结果节点删除后再次明确添加恢复原 nodeId。CAS 冲突保留可恢复结果，不触发生成。任务成功不会自动写画布、建立 Take、候选、镜头绑定或采用，也不启动剪辑或渲染。

## 本地配置和身份隔离

应用 0060–0064 后需通过原升级入口重新授予已有受限角色。归档函数的 owner 新增 Media 时间列更新权限；generation worker 不获得媒体存储或调度身份凭据。媒体 worker 使用已有 queue 与原处理入口，图片、导入和预览接口保持兼容。

显式配置使用本地迁移和媒体处理身份运行 `scripts/extend-local-video-fixture.ts <tenant UUID>`。脚本只允许 APP_ENV=local、本地 drama_* 数据库及已注册的 generation/media/scheduler，发布全新不可变 capability/connection version，并将两个实际 MP4 固定源写入权限 0600 的 `.runtime/video-fixture.json`。遇到已有能力或 manifest 会拒绝重复覆盖。

generation worker 仅加载自己的 `.env.generation-worker`，额外设置 `GENERATION_VIDEO_FIXTURE_FILE` 为私有 manifest 的绝对路径。可与原 IMAGE fixture 同时启用。不要向 generation 进程加载 API、迁移、媒体 worker 或 scheduler 凭据；原入口继续拒绝混合身份。新 capability 只绑定自己的 connection version 与视频 purpose，不复用任何旧描述型目标。

## 验证记录与剩余工作

证据见 `output/engineering/video-generation-results.json`。完整 check 53 项、串行视频数据库 5 项与图片数据库 10 项通过，0060–0064 首次应用后冻结。最小真实文件验证 3 项完整通过：无声原片 2,000,000 微秒，AAC 原片 2,021,333 微秒，两者均 24/1 fps；实际 poster/proxy 完整解码通过，原文件 hash/bytes 未改变。无声代理实际 2,000,000 微秒，AAC 代理实际 2,026,667 微秒，预览元数据独立保存，不覆盖原片。

完整视频归档专项首轮在既有存储测试夹具 `mc admin/policy/attach` 配置阶段达到 30 秒单步上限，总耗时约 80.6 秒；尚未进入业务数据库、MP4 或 worker 路径。失败日志摘要及哈希保留，不放宽产品时限、不盲目重跑、不将最小文件或模拟 SQL 结果声称为完整存储归档验收。主线程安排在独立 CI 与持续业务环境验证完整视频归档/恢复、图片媒体兼容性及整合后的全数据库回归。主线程负责持续环境升级、实际 API/浏览器整合及 GitHub 验证和合并，本工作树不改运行环境或推送。

真实 provider 的 staging、提交、状态查询、回调验签、原文件安全归档 transport、地区/账号/费用授权和样片质量验收仍待后续。独立 audio 生成、多结果、真实 prepare_rework 来源同样未在本片实现。商业计费、运营、公开团队注册和后期制作继续后置。

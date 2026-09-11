# 单图生成：固定计划、独立媒体归档与画布结果取回

本片实现原契约的单图生成后端业务路径。执行适配器目前只有显式本地 `image_fixture_v1`，返回事先发布的固定蓝色 PNG；没有模型推理、真实供应商、质量验收或费用授权。默认迁移不启用任何能力。旧 `target_profile_fixture` 和 `structured_text_fixture` 的 image 描述继续只能作为提示准备目标，不能执行生成，也不会被升级为新能力。

## 固定输入与能力

`POST /tenants/{tenantId}/generation-plans` 继续接收 `PlanInput`，`POST /tenants/{tenantId}/generation-jobs` 继续只接收 `{planId}`。不增加聊天接口或平行画布任务。

image 必须明确选择一个或多个固定 `shotSources`，或一个实际已保存的 image draft `canvas_draft`。选择的旧 shot revision 不隐式替换为最新修订；不会自动读取单集、场次、项目或邻近画布文字。只解析显式上下文及启用边，固定其文本、参考用途、顺序、subjectAssetId 和 assetRevisionId。按原引用覆盖规则生成最终引用，校验当前项目/共享授权、实际可用媒体及目标能力的用途、数量、格式、字节和尺寸限制。

`ResolvedInput.capabilitySnapshot` 固定当前不可变能力身份，`ResolvedInput.output` 固定解析后的输出。首片只接收 capability 明确支持的单图 resolution；唯一允许值可解析为默认值。可选 aspectRatio 必须与尺寸精确相符，不支持时长、音频或多输出。提示采用 append/replace，明确复制的 `assistanceSource` 只提供固定建议修订的来源记录，不覆盖手工提示或添加引用。

画布 `prepareCanvasGeneration` 使用保存成功的 canvas If-Match；草稿模型、prompt、output 必须匹配实际保存内容。origin 保留 nodeId、canvasId、canvas revision、启用来源 nodeIds 与独立固定快照。语义 fingerprint 包含实际生成输入，排除坐标、大小、标题、分组和停用边。布局变化不会令原计划失效，启用内容变化会阻止尚未执行的旧计划。用户确认 execute 后的画布编辑不改写固定 job。

## 一次提交与媒体归档

每个计划唯一 job、每个 job 唯一持久 attempt。未知提交保持 `submission_unknown`；恢复只能读取原关联回执，不重发 submit。发送前重核创作者的当前项目权限、能力版本及固定图片引用可用性；权限或引用已变化时取消尚未发送的任务，不创建供应商 attempt。执行后仅归档原回执，不再次解析当前画布。

供应商完成回执是内部固定私有对象版本、字节数、SHA-256 与 MIME，不接受任意 URL、访问凭据、文件路径或“已成功”声明。当前只允许 `fixture_object` 技术适配边界；真实供应商下载 transport 尚未实现。

在同一数据库事务内建立 `Media(status=processing,sourceJobId)`、不可变 `generation_media_outputs` 与 `media_generation` 队列提示，任务进入 `archiving`。队列写入失败会回滚这些结果，先前持久回执仍保留；下一次本地处理只重做最终入库，不重新提交。

`media_generation` 与现有导入、预览共用内部媒体队列和独立媒体 worker 身份。原 MediaStore 固定版本下载，限制实际字节并校验哈希；原 probe 流水线识别文件签名、完整解码、拒绝动画/恶意内容并核对输出尺寸；随后发布独立 immutable original。只有此验证完成后，事务才使 Media ready、Job succeeded、mediaIds 可见，并建立 poster 及其队列提示。生成不会建立 Take、候选、采用或剪辑引用。

poster 与 original 有独立状态。poster 尚未就绪或失败时，已验证原图和 job 成功事实保留，可通过原 `media/{mediaId}/access` 的 `original` 变体当前授权读取。外部 API 不返回内部对象 key/versionId。

暂时归档失败最多自动处理 6 次；耗尽后 `archive_failed`，用户经原 `recoverJobArchive` 明确恢复同一文件的下载/归档，递增步骤并使旧提示失效，不新增生成 attempt。损坏或缺失原文件为不可重试的归档失败，不能被解释为再次生成授权。丢失队列提示由统一 repair 扫描补回。项目在提交后归档时仍保存已返回原始结果，后续访问依当前授权判断。

不同完成/拒绝回执冲突后保持 `reconciliation_required`。即使冲突先于原图验证完成，也保留首个验证通过的 Media 身份；不会擅自改为成功、覆盖结果或放置到画布。

## 画布呈现是明确的后续操作

`listCanvasPlans` 按 canvas/nodeId 查询原计划、origin 和 jobId，即使原草稿已删除仍能恢复来源。`materializeCanvasResults` 使用 canvas If-Match 与幂等键，验证 job 确来自该 canvas，所选媒体确是该已成功任务的 ready 结果。

`unique(canvas_id,job_id,media_id)` 保证回执及重复明确添加不生成多个身份。删除结果节点后重新添加会恢复原 nodeId；复制节点仍按原普通画布操作产生新呈现身份。CAS 冲突不改动画布，不触发生成。媒体结果自动出现只读任务状态，实际画布文档必须经用户明确添加。

## 本地运行

先沿原业务升级流程应用 0040–0046 并重新授予 API、generation、media、scheduler 的已有受限角色权限。0040 对 `generation_plans_ready_cost_check` 按名称存在条件补回，兼容主线程的 0034；不改已应用迁移。generation worker 只有原执行函数和新增队列 producer 权限，不获得媒体存储、调度或 API 身份凭据。

显式本地技术配置步骤：

1. 已有本地 tenant、受限 generation worker 和媒体存储/worker/queue。
2. 使用本地迁移及媒体处理配置运行 `scripts/extend-local-image-fixture.ts <tenant UUID>`。它创建全新不可变 capability/connection version，生成并发布真实 PNG，将固定来源写入权限 0600 的 `.runtime/image-fixture.json`，并授予 generation 身份队列 producer 权限。不会覆盖已存在 manifest 或原能力身份。
3. generation worker 仅加载自己的 `.env.generation-worker`，额外设置 `GENERATION_IMAGE_FIXTURE_FILE` 为上述私有文件的绝对路径；如使用非默认队列，只传 `QUEUE_SCHEMA`。不要加载 `.env.queue`、迁移、API 或媒体工作者凭据。worker 会拒绝其他身份凭据。
4. 原媒体 worker 继续消费 `media_generation`，原修复循环也扫描该类型。fixture 输出不受提示内容影响，界面必须保持技术测试标识。

主线程负责在持续环境统一升级、实际 API/浏览器联调和 GitHub 合并。本片工作树不改主环境配置、不推送或合并。

## 验证与范围

验证证据写入 `output/engineering/image-generation-results.json`：完整 check 51 项、串行完整数据库 174 项、单图数据库 10 项、真实图像原图/预览 5 项、原导入业务 10 项、真实存储 7 项通过。并行全库中旧画布容量一次超时式失败，原样保留并串行复验通过；未修改该容量业务。独立 MinIO 健康检查早于 S3 初始化的一次明确 503，已在测试夹具增加仅针对该状态的 20 秒有界 S3 就绪检查，3 项边界测试及真实存储复验通过。数据库协议测试对受限 SQL 的模拟字节元数据，只能证明事务和约束；真实文件归档另由独立 MinIO、真实 PNG、严格解码和原图/poster访问测试验证。二者均不构成真实 AI 质量验收。

已经交付的剧本拆解及 prepare_prompt 继续使用原持久 Proposal/AssistanceArtifact 路径。prepare_rework 等待真实 review/comment/fixedCut 来源；video、audio、多媒体输出、真实供应商 transport/回调与对应真实模型验收仍待后续。后期编辑、商业计费、运营与公开团队注册均不是此片依赖。

# 固定镜头提示准备与建议修订

本片在 [41 的耐久文本执行协议](41-generation-assistance.md) 上实现 `prepare_prompt` 后端：明确固定镜头与上下文 → GenerationPlan → 唯一 Job/attempt → AssistanceArtifact → 人工追加修订。它没有调用真实模型、生成媒体或自动应用建议；测试适配器只能证明持久化、授权和恢复行为，不能证明真实 AI 的效果或上线验收。产品语义遵循 [14 §3](14-scene-mvp-closure.md)、[07](07-provider-adapter.md)、[04](04-state-execution-and-budget.md)、[11](11-transaction-and-implementation-blueprint.md) 及 [18](18-canvas-workspace-contract.md)。

## 固定输入与能力边界

沿用 `createGenerationPlan`，请求 `purpose=creative_assistance`、`assistance.kind=prepare_prompt`，必须显式选择至少一个 `shotSources={shotId,shotRevisionId}`。所选固定修订必须属于当前项目的活动镜头及活动场次/单集；镜头后续有新修订时，旧计划仍保留原 spec，不追随最新版。所选镜头修订用类型化外键投影保存，数据库延迟约束校验投影与固定 spec 一致。

`targetCapabilityId/targetCapabilityRevision` 指定已配置、启用的 image/video/audio 目标能力描述，完整保存到 `resolvedInput.targetCapabilitySnapshot`，连接版本保存到 `targetConnectionVersionId`。执行前检查原能力身份和启用状态；不会替换成其他版本。当前只有显式 fixture transport，媒体目标描述也仅用于测试建议，不开放媒体执行。

实际参与输入的是固定镜头 spec（包含其明确参考），用户提交的 `contextSources`、`additionalReferences` 和 `referenceOverrides`。不会读取未选场次、Production 或默认资产以补齐内容。覆盖按用途和可选镜头/对象作用，无法映射的用途、超出目标参考总数、不可用媒体或未引入的资产版本明确拒绝；参考不会被静默丢弃。原计划的镜头/上下文/参考及目标能力会回显在 resolvedInput。

`contextSources.kind=canvas_draft` 是原 SourceDependency 身份的兼容补充，objectId **只能是持久化草稿节点 ID**，revision 是读取时的画布修订。来源必须是当前场次画布中的 draft，任意文字或媒体节点不冒充草稿。其语义内容指纹包含草稿类型、prompt、connection/capability、output，以及启用入边的实际源内容、purpose、position、subjectAssetId 和 note。布局、标题、停用入边及其源内容不影响指纹。所选草稿的启用媒体参考进入实际参考列表并重新授权。只有画布、没有镜头的请求仍不符合 AssistanceArtifact 必须有 shotSources 的原契约。

## 结果与人工修订

沿用 4 个既有 API：

| API | 行为 |
|---|---|
| `listAssistanceArtifacts` | 按当前项目、shotId、kind 和搜索词读取当前修订 |
| `getAssistanceArtifact` | 返回当前建议及 ETag |
| `editAssistanceArtifact` | PUT body + If-Match，仅追加 body 修订；返回新 ETag |
| `getAssistanceRevision` | 按修订号码读取原始输出或历史人工修改 |

成功 Job 返回 `assistanceArtifactId`，与 Proposal 结果互斥。原模型 body 和每次人工编辑分别持久化；generationJobId、request、shotSources、resolvedInput 和来源能力不可修改。输出仅能建议计划中实际选中的参考身份，不能让模型伪造新媒体、资产、操作或来源。数据库也校验原 body 等于该 attempt 的完成证据。

人工编辑可明确增加当前有权限、可用的参考。每个修订的媒体、固定资产版本和主体资产均有类型化外键；已归档的原有参考允许原样保留，移除后不能当作新参考加回。并发修改以原修订 CAS 仲裁；响应丢失后可以 GET 当前修订及固定历史确认事实，无需重新调用模型。

建议保存或编辑不会改镜头、资产、画布或候选选择。后续媒体计划必须由用户明确复制已选修订的内容，并携带原 `assistanceSource={artifactId,revision}`；媒体计划的真实执行以自身固定 resolvedInput 为准。本片未实现媒体计划执行，也未将“建议已生成”描述为“已经应用”。

## 耐久执行与授权

复用 41 的唯一 attempt、执行前落盘、限额、未知提交保留和原 attempt 查询机制，不新增聊天 API。未知响应不能自动 submit；过期 Idempotency-Key 后，consumed plan 仍绑定原唯一 Job。迟到的不同完成证据使任务进入 reconciliation_required，保留先前 artifact，不覆盖已保存历史。

artifact list/get/history/edit、plan 和 Job 均检查当前项目权限，包括缓存重放。撤销成员权限后，未派发 Job 被 worker 取消且不调用适配器。发生在派发后的证据仍按原任务保存；是否能由用户读取始终取决于当前授权。

Job 和 Artifact 的 `inputOutdated` 通过实际固定依赖计算：选定可变上下文的语义变化、目标能力停用、所选镜头或实际参考不可用会显示过期；无关内容及画布布局变化不会误报。过期建议仍可在有权限时查看和人工修改，不会重新解析为新来源。

## 本地配置与验证

新建本地 fixture 的 `scripts/setup-local-assistance-fixture.ts` 会显式建立 script_analysis、creative_assistance 和测试 image 目标描述，沿用隔离 worker 身份。已有 41 的 fixture 可使用：

```sh
node --env-file=.env --import tsx scripts/extend-local-prompt-fixture.ts <tenant-uuid> <existing-analysis-fixture-capability-uuid>
```

扩展命令要求 APP_ENV=local 和明确现有 fixture 身份，复用原 connectionVersion 与 worker，不改私密 worker 配置、不创建第二个 worker、不调用供应商。同样输入再次执行会复用已有两个目标描述。默认迁移不创建任何能力，未配置时 capabilities 为空。

新增迁移 0030–0033；每次已运行的迁移保持不变，后续 SQL 修正采用追加迁移。整合时发现 0030 对自动命名约束的判断错误，误删 ready 计划必须有估算且无阻塞原因的数据库检查；0034 用明确名称补回，数据库负例分别验证缺少估算及存在阻塞原因均被拒绝。接口仍保持原校验，没有将商业计费重新加入首发。`upgrade:business` 同时重授已配置 generation worker 的受限函数权限，复用既有身份。API 无权创建原始 artifact 或改写其修订，worker 只能调用受限执行函数，不能直接读取任意镜头/剧本文本表。

验证记录见 [prompt-assistance-results.json](../../output/engineering/prompt-assistance-results.json)。数据库测试使用隔离 schema、受限 API/worker 登录和真实 PostgreSQL 事务，媒体记录为明确的关系夹具，没有媒体字节验收。测试覆盖固定镜头闭环、CAS/history、未知执行与过期幂等恢复、输出引用注入、旧镜头版本、可变上下文与画布语义、参考归档/私有项目隔离、权限撤销、迟到冲突与运行时权限。前端整合、浏览器闭环、持续环境升级与 GitHub CI/merge 由主线程统一执行。

## 明确剩余工作

前后端已在主线程整合并通过[实际生产网页与受限 worker 闭环](../../output/playwright/2026-09-11-prompt-integrated/verification.md)：真实回执丢失后仅通过 GET 恢复同一任务与人工修订，原镜头未改变，明确追加保留手工原文和固定来源。完整检查 69 单元、172 数据库通过，0034 加强后的提示专项 13 项通过；[PR #19](https://github.com/exo-gravity/scenedesk/pull/19) 已于 2026-09-11 合入 main（ff5bb6a）；精确提交 bc4cd830 的两组 CI（34599727920、34599759473）均通过 69 单元／173 数据库／61 媒体，无失败、取消或跳过。

后续[57 候选意见与修改建议](57-take-feedback-rework.md)已补齐真实Take review/comment及不可变评论修订，开放明确固定候选和意见版本的 `prepare_rework`。原意见来自实际持久记录；Cut来源和正式审片仍未开放，不能用自由文本或伪造ID代替。

真实供应商适配、凭据与地区、实际能力验证、花费授权和真实模型效果验收仍未完成。后续[图片](44-image-generation-runtime.md)、[视频](48-video-generation-runtime.md)及[音频](50-audio-generation-runtime.md)已实现fixture执行、实际输出归档与明确的assistanceSource关系；canvas-only 的建议产物仍不放宽原shotSources要求。商业计费运营、公开注册、团队管理及后期剪辑仍按 [38](38-first-release-scope-review.md) 后置。

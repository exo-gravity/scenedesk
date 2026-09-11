# 固定计划到持久分镜建议

日期：2026-09-11。当前发布范围仍以 [38](38-first-release-scope-review.md) 为准，本批交付原定三类有限 AI 中的第一条业务链路。这里的“执行通过”均指显式测试适配器连接实际 API 业务事务与 PostgreSQL；没有真实模型调用，也没有真实 AI 质量或上线验收。

## 已实现的业务边界

`script_analysis` 在当前项目中固定剧本版本、Unicode codepoint 选区和明确的 `append_to_scene` 目标。用户可另选场次、剧目、固定镜头要求或已获授权资产版本作为上下文；不默认读取整部剧、全部资产或其他项目。服务端读取来源、验证版本、生成实际文本快照与语义 hash；请求不接受自报 hash。参考媒体不被隐藏送给文本模型。

创建 `GenerationPlan` 与执行是两个独立确认步骤。计划保存完整 `input`／`resolvedInput`、连接版本、能力修订、选区、目标、内容基线及十分钟有效期。被选中的可变上下文内容变化会拒绝执行；固定剧本版本或无关场次编辑不会偷偷改成最新输入。任务读取和列表的 `inputOutdated` 根据当前实际来源计算，旧计划与旧结果继续可读。

执行事务重新检查当前项目权限、能力启用、有效期和明确依赖，创建唯一 `plan_id` 的 Job、消费计划、耐久工作提示及项目事件；幂等回包在同一事务保存。缓存期外用同一计划再次执行仍返回同一个 Job，不能购买第二次。工作提示只是扫描入口，业务状态和唯一 attempt 才决定是否允许发送。能力上限按跨项目共享根加锁计算，每日任务数量和未决任务均有限制。

独立 worker 通过受限数据库登录及仅供 worker 的函数扫描工作、持久化唯一 attempt 后调用 `submitOnce`。attempt 固定连接版本、请求 hash、关联 ID 和截止时间。进程在分派后消失时，过期记录进入 `submission_unknown`，不会返回 queued 或自动重 POST。未知提交占用在途名额；`recoverSubmission` 只核对原 attempt。没有核对证据就保持未决。queued 可在执行前取消；已经开始的同步文本调用不伪装为确认取消。

回执独立追加，允许截止时间之后到达，按原 attempt 与证据摘要去重。回执的关联 ID 必须匹配耐久 attempt；互相冲突的终局回执使任务进入 `reconciliation_required`，保留已保存的原提案，不改写既有来源或建议。开始分派前撤权会取消排队任务；开始后已取得的原任务证据继续保存，不因操作者失去访问而丢弃结果。

模型输出被限制为最多一百条分镜建议；服务端生成操作 ID、临时镜头 ID、目标场次、顺序和原文来源。输出不能注入创建其他类型对象、跨场目标、参考媒体、已有对象 ID 或归档动作。只有全部结构有效并在事务内保存 Proposal 与第一修订后，Job 才变成 succeeded。无效输出保留回执并标记 `INVALID_ASSISTANCE_OUTPUT`，不会留下部分提案或新镜头。

提案复用既有列表、详情、历史修订、人工编辑及明确勾选采纳。原始来源、固定内容基线与最初模型输出保留。模型不会自动改写镜头；已有内容变化后仍需要人工核对并明确更新提案基线。采纳产生新镜头及来源证据，已存在镜头和当前采用保持原事实。

## 接口与运行

沿用原 OpenAPI：`listCapabilities`、`createGenerationPlan`、`getGenerationPlan`、`executeGenerationPlan`、`listGenerationJobs`、`getGenerationJob`、`cancelGenerationJob`、`requestJobReconciliation`。`listGenerationJobs` 增加可选 `planId` 查询，用于执行回包丢失后的只读找回。Capability、GenerationPlan 和 GenerationJob 的 `executionMode` 区分 `test_fixture`／`verified_provider`；本次实际可执行的实现只有前者。

没有配置时能力列表为空，准备未知能力返回 `MODEL_NOT_CONFIGURED`。未完成真实接入验收的能力不能成为可执行计划；不会自动安装测试能力，也不会使用 fixture 作为实际模型降级。

迁移 0023–0027 增加固定计划、任务、唯一 attempt、追加回执及工作提示，修改提案来源约束，并为同步任务增加项目通知。升级时必须重新执行 `hardenAuthorizationFunctions`／`grantRuntimeAccess`。worker 登录只能调用自己的扫描、分派、证据与完成函数，不能读取身份会话、任意剧本文本或直接修改业务表。

需要明确验证本地完整页面链路时，可在**本地技术夹具环境**执行下面的显式准备命令。它只为指定已有工作室建立标有测试身份的能力；私有 worker 配置文件以 0600 新建，不覆盖已有身份。不要在真实部署中把此命令当作模型配置。

```sh
APP_ENV=local node --env-file=.env --import tsx scripts/setup-local-assistance-fixture.ts <existing-tenant-id>
node --env-file=.env.generation-worker --import tsx apps/worker/src/generation.ts
```

worker 不读取迁移、API 或身份登录的凭据。此本地入口不执行付费服务，输出始终注明测试 fixture。`packages/provider/src/assistance.ts` 提供固定输入、单次提交和按原身份恢复的适配边界；它也为原契约 `prepare_prompt`／`prepare_rework` 的输出保留类型接口，但没有声称这些用途的来源解析与 `AssistanceArtifact` 持久化已经完成。

## 验证证据与剩余工作

[数据库业务验证](../../tests/integration/generation-assistance.test.ts)覆盖固定 Unicode 选区与明确上下文、原内容不自动变化、并发消费与 worker 竞争、缓存外同计划去重、任务只读找回、提案修订与明确采纳、未知提交只核对、分派后进程消失与迟到证据、非法结构、已选内容改变、撤权前后边界、在途容量、跨项目每日上限、冲突终局证据、停用能力和受限登录。分派截止时间使用隔离测试库内显式时间故障夹具，不声称运行了生产恢复演练。

完整检查与数据库结果记录见 [验证结果](../../output/engineering/generation-assistance-results.json)。CSV 提案原有业务回归单独运行，防止来源字段扩展影响原有手工导入与采纳。页面接入、生产浏览器的创建／恢复／采纳和部署环境验证由后续整合证据补充；仅有这些后端测试不能证明页面可用。

仍需按原计划完成 `prepare_prompt`、`prepare_rework`、`AssistanceArtifact` 修订、图像／视频／音频生成、画布固定生成输入与结果取回，以及真实供应商传输、经验证的账号与地区、使用限制、实际用量证据和真实创作验收。商业计费后台与后期编辑渲染继续后置。没有真实服务与费用授权，不发出付费请求，也不以显式测试费用为零替代实际服务的未知消费。

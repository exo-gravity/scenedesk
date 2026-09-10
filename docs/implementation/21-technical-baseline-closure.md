# 21 任务执行、编辑恢复与历史生命周期定案

日期：2026-09-10。实施设计包 v1.3，OpenAPI 1.3.0。依据：[技术方向确认](../design/technical-direction-confirmation-2026-09-10.md)及用户随后授权继续收尾。本文是下一阶段实施规范；未执行业务迁移、安装队列、真实模型调用、媒体渲染或用户验收。

## 1. 决策与模块责任

架构主干保留。此次选择独立 CutWorkDraft、有条件整画布 CAS、有限恢复历史及成熟队列适配。短剧主场景、每场双模式、轻量剪辑和固定稿审阅不变。

| Module | 对调用者提供的业务操作 | 内部拥有的事实 |
|---|---|---|
| GenerationExecution | prepare／execute／cancel／reconcile／recordEvidence | plan、job、attempt、费用关联、输入快照、执行资格；不公开队列表为业务模型 |
| Editing | saveWork／normalize／applyNormalized／freeze | 共享编辑工作稿、精确编排、工作稿来源、固定版本；调用者无需自行组织双对象事务 |
| CanvasWorkspace | save／readHistory／prepareInputs／materializeResults | 当前文档、恢复修订、节点身份及来源关系；不维护采用或审阅状态 |
| 内部调度适配 | 在既有事务内 schedule 一步任务，运行注册 handler | 领取、延期、重试、超时和回收；不取得绕过授权与费用的权限 |

不引入通用工作流 DSL、事件溯源、CRDT 或多 Agent 执行平台。pg-boss 的接口封装只覆盖实际使用的调度操作，不为尚不存在的多个引擎建设抽象框架。依据见[原评审](../reviews/2026-09-10-technical-options-review.md)、[队列研究](../research/2026-09-10-task-execution-review.md)及 ADR [0007](../adr/0007-durable-editing-work-before-renderable-cut.md)／[0008](../adr/0008-reuse-queue-keep-business-execution-authority.md)。

## 2. 队列与业务执行

### 2.1 选择、事务及运行身份

优先验证 pg-boss；尚未锁定安装版本。当前研究版本只是候选证据，正式接入重新锁定兼容版本与许可证。必须在同一 PostgreSQL 连接／事务里写业务事实和入队，不能只共用 Pool。pg-boss 官方提供调用者事务 Adapter，是否满足本项目最小权限须实际验证。[事务 Adapter](https://pgboss.io/api/adapters)

`executeGenerationPlan` 的成功事务写 plan 消费、job、reservation、预算投影、队列命令和幂等结果；需要 UI 通知时另写事件 outbox。任一步失败整体回滚。归一、渲染、归档和导出也在其业务记录事务中入队。**删除自研 worker_tasks 的迁移安排**，不保留 outbox→worker_tasks→第三方队列的三层转发。

事件 outbox 专用于提交后通知及 project_events，使用现有最小 relay；并非内部执行的第二事实源。队列完成与业务完成分别记录，不因为队列记录过期就丢掉作业历史。

| 身份 | 可做的事 | 限制 |
|---|---|---|
| migration | 维护业务及队列 schema／grant | 不用于业务请求；运行进程关闭自动 schema 升级 |
| API 运行身份 | 可信租户事务、最小队列入队权限 | 非 owner／superuser／BYPASSRLS；不能消费全租户任务 |
| 调度身份 | 领取最小命令信封与完成／延期队列步骤 | 信封只含 taskKind、业务 ID、stepRevision、epoch；不含提示全文、URL、密钥 |
| Worker 业务身份 | 根据可信业务根建立 SET LOCAL 上下文后处理任务 | 队列 payload 的 tenantId 不直接成为授权；媒体资源隔离，供应商秘密只在服务端解析 |

候选门槛QV-01分两段：T01先验证同事务回滚、受限grant、关闭运行时迁移及内部任务中断恢复，允许用候选推进导入媒体切片；G02形成真实业务状态后补齐未知提交、账号额度及隔离恢复，全部通过后才关闭门槛并启用付费创建。失败记录事实并重新裁决，不以开放权限或双写作为通过。

### 2.2 步骤、重复执行与额度

| 步骤 | 一次 handler 的结束点 | 后续安排 |
|---|---|---|
| submit | 记录固定 attempt 后最多一次外部创建；回执入账或进入未知 | 已知 ID 安排 poll；未知安排 reconcile，不能重 POST |
| poll | 一次可信查询及状态持久化 | 未结束则事务中安排下一次延时查询；结束安排 archive |
| archive | 获取并验收输出，建立不可变媒体 | 成功才将媒体作业 succeeded；失败恢复同一归档 |
| normalize／render／package | 按已固定业务输入处理并提交输出事实 | 无供应商创建；可恢复同一内部工作，不创建新生成意图 |

每种业务作业保存所需的 `step_revision`、`next_action_at`、`recovery_epoch` 和当前业务状态。队列信封带这些值；handler 先匹配业务状态，过时／重复命令无操作退出。状态推进与安排下一步在同一事务完成；随后队列 ack 丢失，重投仍由业务版本收敛。不在跨网络事务内持锁。

队列的租约和重试参数按候选及实测配置，不继续把“60 秒租约、20 秒心跳”作为自研必做协议。业务状态回写以业务版本／attempt 身份防止过期执行者覆盖；可信迟到回执继续走追加证据入口。已存在 dispatching／attempt 的 submit 重投只能核对；即使崩溃发生在真正发包前，没有未提交证据也不能自动再买。

低频修复扫描只查业务记录中已到期、尚未完成的下一动作，重新 schedule 同一步；它不是另一套带 lease／重试计数的队列表。重复入队即使不能被组件永久去重，也不能越过业务资格。扫描已知任务、缺失任务和扫描间隔均纳入观测。

**三个上限分别控制**：Worker 在本机占用的执行槽位；按账号／接口计算的请求速率；供应商账号已接受及无法排除已接受的在途任务数。等待外部生成时释放 Worker 槽位，保留在途额度和费用预占。以稳定 providerAccountIdentity 关联账号额度，多个连接版本／同账号密钥不能绕过上限。

首版每个经验证的供应商账号身份只归属一个租户；同租户可有多连接／密钥版本，跨租户重复启用返回不泄露另一租户信息的账号冲突。内部provider_account_limits按服务／地区／账号身份唯一，具体账号识别以07验证为准。平台配额只约束平台路径，供应商控制台等外部消费仍需监测和429退避。

`provider_inflight_claims`以job唯一，在授权 dispatch 事务中锁账号配额并占用。排队等待额度不建立 attempt；明确未发送、被拒绝或已终止且证据充分才释放。未知提交和仅发出取消请求不释放。默认未知会阻断该额度继续复用；真实最大数与速率来自验证后的账号配置。组件 groupConcurrency 不是严格远端额度。[pg-boss 并发边界](https://pgboss.io/api/workers)

恢复库时仍执行 11 的 epoch／quarantine。旧队列信封不能自动取得新代次资格，删除或清空队列不能视为已核清供应商消费。

## 3. 编辑工作稿与可渲染编排

### 3.1 对象与保存资格

每个 `editingMode=timeline` 的 Cut 有至多一份团队共享 CutWorkDraft，供有编辑权的成员接手；不按用户生成相互独立的正式稿。本机恢复副本仍按用户隔离。external_file Cut 不能创建工作稿。

| 对象 | 可以包含的内容 | 不能代表什么 |
|---|---|---|
| CutWorkDraft | 结构及引用合法的编辑文档、未处理事项、起始 Cut 版本 | 归一通过、声音完成、可渲染、已批准 |
| CutDraft（Cut 当前内容） | 经过确认的归一结果和精确媒体映射 | 固定稿、审阅通过；初建空 Cut 仍不能冻结 |
| CutRevision | 已固定编排及其渲染过程／文件 | 最新工作稿已经包含在此版本 |

工作文档包含WorkTimeline、dramaBindings、unresolvedEdits和timingOrigins。WorkTimeline 允许无主视频、空轨、空字幕、零时长、临时空洞／重叠及越界放置；这些是待修复问题。负数／非有限数、反向源区间、重复 ID、轨道类型错误、伪造额外字段或越权引用仍拒绝。源媒体必须真实存在；首次引入需 ready，上传未完成只留在本机待添加列表，不伪造 mediaId。

`unresolvedEdits` 保存明确尚未决定的声音、字幕、替换或对白关联事项，含稳定 ID、相关 clipIds、说明；全部属于渲染阻断项。服务端另计算 timeline／binding 的诊断，不信任客户端说“已通过”。删除片段后残留的 clip 关联可作为问题保留，但其 shotRevision／dialogue／voice 引用仍必须有权且合法。缺失 clip 与越权源是不同错误。

默认单工作文档 ≤4 MiB，≤32 轨、合计≤5,000 条目、≤5,000精确来源、≤5,000绑定、≤500 待处理事项；上限可配置，超过返回 413 并保留本机内容。这是初始防滥用设计，不是已测容量。

### 3.2 版本及读写接口

`GET /projects/{projectId}/cuts/{cutId}/work-draft` 无记录时返回 revision=0 的虚拟工作稿，从当前 Cut 复制初始内容，baseCutRevision 为当前版本；GET 不创建数据库记录。首次 PUT 使用 If-Match:"0" 原子创建 revision=1；后续使用工作稿自己的 ETag，不能使用 Cut 的 ETag。

PUT 正文为 `{baseCutRevision, document}`。第一次保存 base 必须匹配当前 Cut；已有工作稿可继续保存原 base，即使 Cut 已变化，以免丢失未完成工作，同时返回 baseChanged=true。要改为当前 Cut 基线，必须由客户端明确比较并提交合并后的完整文档和当前 base；不接受任意第三个历史版本，也不自动重算。服务端存 baseNormalizationId 和对应固定内容依赖，保障恢复及未改片段的精确边界。

`timingOrigins`逐片段记录可选的同Cut历史normalizationId。首次从已确认Cut建立工作稿时为已有条目填入来源；归一应用后改为新normalization。手工比较重选Cut基线时，保留本地的片段仍保留原精确来源，取自新稿的片段使用新稿来源，新增素材可无来源。服务器验证同Cut、ready、条目身份及授权；分别比较源区间与放置坐标是否仍等于该来源的回显值，未改变的分量复用精确整数边界，改变的分量按11重算。不能只因Cut基线变更就从旧回显微秒再次吸附。引用的归一结果及映射纳入历史依赖保护；重复clipId来源或来源条目缺失拒绝。

工作稿响应带cutId、revision、baseCutRevision、currentCutRevision、document、documentHash、updatedAt、updatedBy、issues、baseChanged、hasUnappliedChanges。revision=0 时 updatedAt／updatedBy 不出现；后续均有值。diagnostics 是读取时计算的诊断，不是另一个可写状态机；当前 Cut／素材变化可令诊断变化而不递增工作稿 revision。ETag 只用于写 CAS，GET 不使用仅凭工作稿 revision 的 304 缓存判断。

PUT 的事务顺序为授权／项目→Cut 根→工作稿根→适用依赖锁，完成文档、修订、引用索引及事件通知一起提交。保存工作稿绝不转码、执行模型、采用候选或更新 Cut 当前内容。

### 3.3 从工作稿到固定稿

1. 前端等待当前工作稿保存成功，确保没有未同步输入。
2. `normalizeCutDraft` 改接收 `{cutId,baseCutRevision,workDraftRevision}`，不再接收另一份 timeline。服务端锁 Cut→工作稿，要求双版本匹配且工作稿基线为当前 Cut，固定文档、hash、profile 与依赖后异步归一。返回的 NormalizationResult 必含 `workDraftSource {revision,documentHash}`。
3. `previewCutReplacement` 也要求 workDraftRevision，在这份工作稿上构造明确替换；输入仍须完整时长政策及声音字幕决定，不改工作稿。未完成的替换可先以工作稿及待处理事项保存；归一预览不代替恢复保存。
4. 归一 ready 后展示边界变化，用户确认再调用原 `saveCutDraft`。事务同时检查 Cut If-Match 和 normalization.workDraftSource 是否仍对应当前工作稿；任何人又编辑了工作稿，返回 409 WORK_DRAFT_CHANGED，不能悄悄应用旧结果。现有必需变更确认规则继续有效。
5. 同事务更新 Cut 可渲染内容及其 revision，并将工作稿内容置为此次明确确认的 effectiveTimeline／bindings、为已有条目重设timingOrigins到新归一结果、清除已处理事项、基线移至新Cut、工作稿 revision 加一，保存恢复历史和两项资源通知。即使预览与原文档不同，也以此次明确确认的结果为准；返回 Cut 后重新读取工作稿。浏览器响应到达前的新输入只保留在 local draft，不能被覆盖，须显式比较后继续。
6. 冻结仍使用 Cut If-Match，同时必须提交 `expectedWorkDraftRevision`（不存在时为0）。双版本均需匹配。若有未应用工作，默认 409 WORK_DRAFT_UNAPPLIED；用户明确选择“仅固定上次已确认编排”后可传 `excludeUnappliedWorkDraft=true`，固定记录保存被排除的工作稿 revision。它不清除、不审批那份工作。

工作稿未完成不影响播放既有固定稿。主按钮“生成审片版本”默认先完成当前工作稿的归一确认；不能静默渲染旧 Cut。已存在的normalization与Cut精确时间映射、原片归档例外、字幕时长规则保持不变。timingOrigins也包含在固定请求hash及显式引用保护中；所有待处理事项均解决并通过归一后才可应用；服务端不自动修复遗漏决定。

```mermaid
flowchart LR
  W[编辑工作稿：允许未完成] -->|保存明确版本后请求| N[归一与变化预览]
  N -->|确认变化并检查双版本| C[Cut：可渲染编排]
  C -->|确认当前工作是否全部应用| R[固定版本与渲染]
  R --> V[在实际文件上审阅]
  N -->|仍有问题：保留工作| W
```

### 3.4 错误及恢复

| 场景 | 响应／行为 |
|---|---|
| 工作稿版本已变化 | 412 WORK_DRAFT_VERSION_CONFLICT；保存本地差异，重新比较 |
| 当前 Cut 已变，继续保存旧基线工作 | 200 保存成功，baseChanged=true；禁止直接归一／应用 |
| 归一请求基线不是当前 Cut | 409 CUT_BASE_CHANGED；工作稿保留，明确重选基线 |
| 归一后工作稿被修改 | 409 WORK_DRAFT_CHANGED；旧结果只读，重新确认当前输入 |
| 临时字幕越界／空主轨／待处理事项 | 工作稿 PUT 成功并返回 issues；归一返回具体阻断或 failed 结果 |
| 历史正文已清理 | 授权后 410 EDIT_HISTORY_EXPIRED；不把旧 revision 当当前稿，不自动重放 |
| 引用被撤权／项目归档 | 拒绝写入、停止发送；保留服务器审计引用，前端失权内容禁止展示并清除缓存 |

网络超时先 GET 对照所发 baseCutRevision＋documentHash。完全一致可确认写入；仍为原版本可重送同 PUT；第三种情况进入比较。即使后续有人改回相同内容，确认的是当前内容已保存，不证明它必然来自某一次请求。并发诊断变化不当作用户编辑。

## 4. 画布协作与恢复历史

### 4.1 协作边界和编辑提示

整画布 CAS 沿用 18，A 改节点甲、B 移节点乙仍可能冲突；没有后台智能合并或独占锁。默认主责操作、同伴异步接手。需要持续同时编辑的团队须先验证任务完成阻力，再决定是否重开对象级命令或 CRDT；不得在销售或界面中称为实时共同编辑。

新增项目内 `GET／PUT /editing-presence`。目标 kind 为 canvas 或 cut_work_draft，objectId 分别指 Canvas 或 Cut；服务端解析实际父对象，验证 scope。浏览页每30秒提交 clientSessionId 和 viewing／editing，服务端时间计 lastSeenAt，90秒过期；活动编辑前检查可编辑资格。返回 membershipId、clientSessionId、activity、lastSeenAt、expiresAt，不发送光标、选中文本或提示词。

presence 不递增画布／工作稿 revision，不触发内容自动保存；不阻止他人打开或写入，不构成执行授权。离开停止心跳即可，过期自动消失；退出／撤权主动删除并重新授权读取。服务不可用时显示“编辑状态暂不可用”，CAS 继续保护写入。按用户每目标最多5个活动客户端、每目标最多500个活动客户端的初始容量限制，超限429；不同标签页有不同 clientSessionId。

### 4.2 保留策略

画布及工作稿的当前内容始终保存；修订号只增不回退。“不可变”表示保留期间不改写正文，**不表示所有自动保存永久保留**。恢复历史与收费记录、已确认归一、固定审阅及交付证据分开管理。

| 层次 | 首版默认 | 容量与含义 |
|---|---|---|
| 当前内容 | 对象存在期间保留 | 不因历史容量清理而删除；项目归档不会自动删当前稿 |
| 近期自动保存 | 最近24小时内最多100个修订，另保留当前版本的前一版 | 允许逐次取回近期内容；不是24小时每次保存都保证可恢复 |
| 周期检查点 | 15分钟一个桶取最后修订，保留7天；一天一个桶取最后修订，保留30天 | 不创建无变化的虚假修订；UTC 分桶；当前未结束桶可替换候选 |
| 固定业务依赖 | 被业务引用时保留，不受普通历史 TTL 影响 | 必须显式标记 owner；引用计数由实际关联核对 |

每对象未固定历史正文初始预算256 MiB，按去重后**未压缩 canonical JSON 字节**计量；这样不把压缩比当保证。达到预算时先丢弃最旧的非必要自动保存，再丢弃最旧检查点；当前及前一版和被固定的依赖不淘汰。历史列表准确显示实际存在的恢复点和保留策略，不展示虚假的全量连续历史。此预算不限制媒体文件总额；固定依赖另计工作室容量，超额告警／阻止新的超额写入，不删除证据。

读取历史时保持其原schemaVersion，不自动把历史正文重写为新结构；当前首版schemaVersion=1。后续格式升级需可重复的迁移器，对历史只生成新的当前稿并记录源修订，原固定输入及渲染仍按原版本解释；不能通过加字段后原样重算hash冒充同一修订。

同一对象相同 canonical hash 的正文去重，使用 PostgreSQL JSONB／TOAST 存储作为初版；是否增加应用压缩由容量验证决定，不新增必装压缩服务。canonical hash 必须按固定版本规则生成：对象键按 Unicode 码点排序、数组保序、不改变字符串内容，有限数字使用统一的 ECMAScript JSON 表示，-0 规范为0，UTF-8 SHA-256；实现时跨语言夹具验证。hash 不包含作者、时间和诊断。引用与版本信息仍以关系约束为准，不能只依赖 hash 作授权。

### 4.3 引用保护、取回与清理事务

画布当前版本及仍保留的历史各有 media／asset 引用索引；历史过期并解除引用后，素材仍须通过完整依赖检查才可物理清理。取回旧内容相当于一次新的编辑：旧画布内容不是“既有当前引用”，新引入的归档素材仍按新增引用规则拒绝；失权素材不能靠恢复历史重新获得访问。

生成计划已经独立保存确切输入和 origin.source_snapshot，保护的是这些实际输入，不为了追溯一次生成永久固定全场布局。canvasRevision 是来源编号；可随计划读取固定源快照，完整旧画布可能已过期。canvas_plan_origins 不设指向可清理历史正文的强外键。收费／采用／固定稿的实际依赖不得随画布历史清理。

工作稿 baseNormalizationId 及其精确映射在当前工作稿和可恢复历史引用期间受保护。processing 归一先固定自身请求快照，之后工作稿历史可正常轮换；ready且已应用结果、Cut及CutRevision依赖长期保护。未应用的 processing 不过期删除；failed／未应用 ready 结果默认7天可查，超过期限且无引用才清理。错误恢复必须明确结果已过期，不能静默重算旧确认。

清理事务按授权范围／对象根→历史元数据→正文／引用取得固定顺序的锁，再核查当前、前一版、检查点、业务 pin、处理中请求和其他引用。解除引用与删除正文指针同事务；后台物理媒体清理另做延迟复检。新增 pin 与清理争用同一对象锁，先清理的版本无法再被 pin；先 pin 的版本不可被清理。清理可重入，崩溃不留下有引用却无正文的状态。

历史 API 按 revision 倒序、固定对象游标分页；清理期间可能少返回条目，但不得跨对象。get 历史在项目授权后，对于已使用且已过期的 revision 返回410；未来版本／不存在对象为404。过期头部可保留90天审计后清除；根的单调序号仍可区分已使用区间，绑定修改也必须产生有正文关联的修订。清理不复用 nodeId、work item ID 或回退 revision。

前端持有本机基线时仍可比较；本机基线也不存在时禁止假造三方合并，提供逐项查看当前稿与本地副本、复制仍有权内容为新修改。撤销超过历史范围不承诺跨会话回退。画布本机7天／20份上限沿用，工作稿同样采用用户隔离和清除策略，合计配额可观测。

## 5. 数据迁移与 API 变更

| 记录 | 必需字段／约束 |
|---|---|
| cut_work_drafts（M05） | tenant/project/cut_id 唯一、revision、base_cut_revision、base_normalization_id可空、document、document_hash、updated_by；与 Cut 同范围复合FK |
| cut_work_draft_revisions（M05） | cut_id＋revision 唯一、base及来源归一、body_hash、actor、created_at、checkpoint flags、精确来源依赖；正文保留规则见§4 |
| edit_history_bodies（M05/M07共用内部存储） | tenant/project、owner_kind、owner_id、hash、hash_version、document、canonical_bytes；同对象hash唯一；owner以明确canvas／cut外键互斥表示，不能用任意字符串绕过FK |
| editing_history_pins／media refs | 指向有实际owner和存在正文的修订；owner范围同项目；清理与加pin互斥；去重及正向使用位置可查 |
| canvas_revisions（M07调整） | 改为正文hash引用、actor、created_at、checkpoint元数据；当前canvas文档仍随CAS更新；不永久复制全部JSON |
| cut_normalizations（M05调整） | 增 work_draft_revision／hash、确切输入快照；已应用结果绑定 Cut修订；不靠可过期历史重建输入 |
| cut_revisions（M05调整） | 冻结时记录 observed_work_draft_revision、excluded_work_draft_revision可空；未完成编辑不进入渲染文件 |
| provider_account_limits（M04） | tenant、provider_service、region、provider_account_identity、max_inflight、rate_policy；经验证账号身份唯一绑定一个租户；实际上限来自账号配置 |
| provider_inflight_claims（M04） | job唯一、tenant、账号身份、状态、占用和释放证据；按账号配额锁事务计数 |
| 业务作业（M04/M05） | 对需要调度的作业增 step_revision／next_action_at／recovery_epoch；结果身份仍属原业务表 |
| editing_presence（M07） | tenant/project、目标canvas或cut的明确FK、membership、client_session_id、activity、last_seen_at、expires_at；唯一目标＋成员＋客户端；TTL可清理 |
| 队列schema（M03之前） | 候选库维护，迁移与运行权限分离；删除原 M06 worker_tasks 自研安排 |

新增7个操作：getCutWorkDraft、saveCutWorkDraft、listCutWorkDraftHistory、getCutWorkDraftRevision、listCanvasHistory、getEditingPresence、updateEditingPresence。保持现有 normalize／saveCutDraft／freeze 操作身份，但修改输入及并发语义；未上线契约升为1.3.0，不同时维护旧请求形式。

公开 Schema 与路由由 `editing_contract.py` 作为设计生成器扩展统一生成；响应旧客户端未知字段行为不作为兼容保证。保存成功仍不自动生成／采用／批准。状态码、ETag、CSRF和POST幂等纳入06与机器契约；字段样例不证明依赖、权限和事务通过。

## 6. 前端状态与实施门槛

| 状态 | 明确责任 |
|---|---|
| Query | 服务端快照及失效通知，重取不覆盖 dirty；工作稿诊断不以ETag作永久缓存 |
| 编辑 store | objectId、baseRevision、baseDocument、localDocument、pendingPayload、dirty、撤销与恢复；同对象最多一个内容写请求在途 |
| 视图偏好 | 选择、视口、面板；不改变共同文档／输入指纹／播放顺序 |

工作稿沿用800ms停顿、持续修改最多5秒一次的保存节流；离开页面前flush为尽力而为，本机先保留，收到服务器响应才显示“已保存”。中文输入组合态不切分正文或截断候选；响应、重连、跨模式和重新挂载不得清空新输入。保存状态与“还有N项待处理／可生成审片版本”分别显示。

契约接入沿用 Ajv2020 单一输入规则，服务端结构校验后执行授权／关系校验；Fastify 默认校验器及响应序列化须通过真实端点验证，禁止手写第二套不一致规则。此次仅生成类型与静态验证，不实现运行store或真实路由。

新增 AT-64–75、设计工作包 T01／E05A／CX06 在08与16登记。队列候选验证属于获准后的 T01；设计文件完整并不等于候选已过门槛。后续按“导入→工作稿恢复→归一→固定渲染→审阅交付”的真实纵向切片落地，禁止用新的接口数量替代业务证明。

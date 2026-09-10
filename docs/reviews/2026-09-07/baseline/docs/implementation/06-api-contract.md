# 06 API 协议与跨字段业务规则

[openapi.json](openapi.json) 是机器可读的设计契约，[操作目录](api-operations.md) 给出全部路径、operationId、需求和权限。本节规定无法仅靠字段类型表达的授权、事务和行为。当前没有运行服务；后续实现必须满足结构契约和本节规则。

## 1. 协议与版本

- JSON API 前缀为 /v1；除登录回跳和 SSE，正文使用 application/json。返回 ID 均为 UUID，时间为 UTC RFC 3339，金额按 Money 的微货币字符串表示。
- 同源服务端会话；写操作携带 X-CSRF-Token。登录、接受邀请和生成下载 URL 仍有各自授权规则，不能因路径在工作室外跳过验证。
- 字段默认拒绝未声明属性，避免静默接收客户端以为已经生效的参数。可选属性省略表示未提供，不能用任意 null 清空；PUT 为所定义业务结构整体替换，PATCH 按该接口定义处理。
- 新增兼容的可选响应字段可在 v1 演进；改变金额、时间、授权或版本语义需要新契约版本和迁移。首版客户端也不能直接把响应对象原样回传到写接口。
- 所有实例字段只描述逻辑语义；数据库 snake_case、API camelCase 由边界转换，不将内部密钥、对象 key 或原始供应商回执直接暴露。

## 2. 权限标识的准确含义

| x-permission | 规则 |
|---|---|
| public | 仅登录入口和受校验回调；不返回业务内容 |
| authenticated / authenticated_verified_email | 有效会话；接受邀请另需邮箱验证和匹配 |
| tenant_member | 有效工作室成员；列表只返回其允许的内容 |
| owner / owner_admin | 工作室 Owner／Owner 或 Admin；不得跨租户 |
| owner_admin_with_role_restrictions | Owner 可任免 Admin；Admin 只能管理普通成员，不能修改自己权限或 Owner |
| project_member | Owner／Admin 或该项目有效负责人／协作者 |
| project_lead_or_admin | 该项目负责人或工作室管理者 |
| scope_member | 项目对象要求项目访问；共享对象要求有效工作室成员；每个结果逐范围过滤 |
| project_member_or_shared_admin | 项目范围制作要求项目成员；共享范围制作／修改只允许 Owner／Admin |
| project_lead_or_shared_admin | 项目资产确认要求负责人／管理者；共享资产确认要求管理者 |
| project_member_working_or_lead_final | 工作包允许项目成员；final 只允许负责人／管理者且最新审阅已批准 |

这些标识是固定策略名称，不是用户可配置的权限表达式。scope=project 必须提供 projectId；scope=shared 必须省略 projectId。路径、请求正文和源对象项目不一致立即拒绝。无权项目子资源对普通调用统一返回 404，避免用 ID 探测存在性；已知资源上动作权限不足返回 403。

普通项目成员可查看本项目预算和消费，不能因此列出工作室总账及其他项目金额；工作室预算和总用量仅管理者可见。因工作室总额度不足阻断时，可以告知“工作室额度不足，请联系管理员”，不返回无权读取的账本数据。

changeTask：协作者只可修改分配给自己的任务 status／note，其余字段必须保持原值；负责人／管理者可重分配和修改所有定义字段。changeComment：仅原作者可改正文；项目有权成员可标记处理状态；修改均保留审计。审阅关闭后不更改正式决定，补充讨论可新增评论；评论解决不代表通过审片。

## 3. 版本、并发与幂等

可变资源返回 revision；客户端以 `If-Match: "7"` 提交，服务器锁定对象并比较。过期返回 412 REVISION_CONFLICT，客户端保留本地草稿并显示差异，不能自动全量覆盖。缺失必需版本／幂等头为 400。不可变输入源变化等业务基线冲突为 409。

| 操作 | If-Match 对象 |
|---|---|
| reviseScript、createEpisode／Scene／Shot、reorderContent、applyProposal | getContent 返回的 ContentTree.revision |
| updateEpisode／Scene／Shot | 被修改对象 revision；事务同时递增 ContentTree.revision |
| selectTake／clearSelection | Shot.revision；与其他镜头修改竞争同一版本 |
| changeProduction、changeProject、归档／恢复／交接 | 对应根对象 revision |
| reviseAsset | Asset.revision；不能覆盖旧 AssetRevision.definition |
| confirmAssetRevision | 待确认 AssetRevision.revision |
| saveCutDraft／freezeCut | Cut.revision，冻结的是该时点草稿 |
| decideReview／changeComment／changeTask／changeBudget | 对应目标对象 revision |
| removeProjectMember | 成员列表中的 ProjectMember.revision |

所有受认证 POST 都需要 Idempotency-Key，默认保存 24 小时，键作用域为 actor＋tenant＋operation＋规范化请求路径。请求哈希覆盖请求体和影响语义的版本头。同键同请求返回原业务结果；同键不同请求返回 409 IDEMPOTENCY_CONFLICT；并发同键只执行一份事务。回放前重新验证当前会话与资源权限，不用缓存绕过撤权。

幂等记录只缓存服务端已提交的业务结果，不把在途锁或失败占位永久当作完成。事务前校验失败可修正后用新键重试；事务结果未知时保持原键重查。生成计划一对一作业、渲染版本、账单唯一键等约束跨过缓存期限继续有效。新键不等于重新生成许可：已消费 planId 始终返回原作业或明确已消费冲突。

access 接口也使用 POST；同键回放可能返回已过期 URL，客户端需要新键申请新的短时授权，服务器再次验证权限。Idempotency-Key 从不作为供应商幂等能力的证明。

## 4. 结构与跨字段校验

| 对象／操作 | 除 schema 外必须执行的校验 |
|---|---|
| 项目／成员 | 负责人是同租户有效成员；一个项目一位负责人；停用或移除负责人前交接；归档禁止新制作写入，允许原任务归档和读历史 |
| 结构修改 | 父对象有效且同项目；重排提供当前全部有效子 ID 且无重复；编号可变，身份不变；归档有子内容时明确级联隐藏而不删除历史 |
| 提案 | purpose=script_analysis，scope=project，sourceScriptRevisionId 必填且有效；固定 baseContentRevision；不接受镜头引用冒充脚本范围 |
| 提案采纳 | 服务端给 create 操作预分配 temporaryId（UUID）；proposed 内父 ID 可以指向同提案预分配身份。勾选子操作必须包含未创建的依赖父操作，否则 422；同一事务按父子顺序写入，重复应用返回原映射；update/archive 必须指明 existingId 且类型一致 |
| 角色造型 | lookId 与 lookAssetRevisionId 成对出现，属于指定 characterAssetId；造型内媒体、声音版本逐项授权；不同造型是不同稳定 ID |
| 资产／媒体 | 项目引用共享版本前已有 shared_import；参考中的 mediaId 必须存在于其声明资产版本的引用内；共享发布检查依赖闭包，不能携带私有 source ID；归档停止新引用，已有冻结引用仍可读 |
| 上传 | 实际字节、哈希、类型、可解码性和范围验收通过，最终 key／版本不可被客户端覆盖，才返回 ready；意图已过期不签新写 URL |
| 计划 | connection/capability/币种/服务范围匹配；purpose 与模式一致；输入规则逐项满足；提交时重查源版本、权限、预算及能力修订；不支持的 output 字段拒绝而非忽略 |
| 候选 | ready video、合法源区间；shotRevisionId 属于该镜头；同项目或授权共享；相同修订、媒体与区间去重；从旧候选继续必须明确新镜头修订，不能静默升版 |
| 采用 | take 属于该镜头且其修订是当前要求；若需要沿用旧候选，先显式创建关联到当前要求的新 take，并保留 sourceTakeId；采用不更新 Cut |
| 时间线 | track.kind 与 item.kind 匹配；media kind 匹配；范围在媒体内且 take 范围内；takeId／selectionId 与 mediaId 对应；所有 item ID 全局唯一；最多一个主视频轨且无重叠空洞；音轨可叠加，字幕同轨不重叠 |
| 剪辑规格 | 新草稿默认项目规格；已有草稿保留自己的规格，项目规格变更不会暗改草稿／旧版本；修改草稿规格需整体验证；episodeId／sceneId 至多一个且同项目 |
| 评论 | 目标可播放；若有 endUs 必有 startUs，0≤startUs≤endUs≤审阅时长；单点 startUs 必须落在有效范围；parentCommentId 必须同 review |
| 审阅 | subject 恰好一个；单镜头用 take 局部时间，cut 用文件时间；同一 subject 最多一个 open；number 串行增加；决定只能作用于 open，不能更改决定历史 |
| 最终交付 | 必须提供 reviewId 且是该 cut revision 最新一轮 approved；必须整集或绑定集的外部成片；working 不要求批准；includeSrt=true 但无可导出字幕时 422，不能制造空字幕宣称完成 |
| 预算 | 上限非负、周期起点早于终点；同租户同项目层级周期不重叠；修改已有账户只变上限，project/currency/period 不可变；降低到 spent+reserved 以下需明确拒绝而非自动清除消费 |

构图／身份等参考用途是平台语义；是否能映射为独立模型参数取决于已验证模式。文本拼接也须回显真实解析结果。AI 生成提案不能执行权限变更、任意网络访问或系统命令。

## 5. 错误与恢复

标准错误包含 code、message、requestId、可选 details。message 面向用户；details 只携带已授权对象的冲突版本和可执行动作，不含密钥、供应商完整正文或签名 URL。

| HTTP／code | 用户与客户端下一步 |
|---|---|
| 400 INVALID_REQUEST / REQUIRED_HEADER_MISSING | 修正请求；不盲目重试 |
| 401 SESSION_EXPIRED | 重新登录，再获取最新授权与对象状态 |
| 403 ACTION_FORBIDDEN | 解释所需角色；不能仅隐藏按钮代替后端拦截 |
| 404 RESOURCE_NOT_FOUND | 资源不存在或当前无权访问；不暴露其他租户信息 |
| 409 PLAN_STALE / CAPABILITY_CHANGED / INPUT_ARCHIVED | 重新准备并展示计划；不自动提交新的付费任务 |
| 409 IDEMPOTENCY_CONFLICT / PROPOSAL_BASE_CHANGED / REVIEW_ALREADY_OPEN | 返回明确冲突，刷新相关对象或取原结果 |
| 412 REVISION_CONFLICT | 保留本地修改并获取最新版本，用户明确处理 |
| 422 INVALID_REFERENCE / INVALID_TIMELINE / DEPENDENCY_MISSING / REVIEW_REQUIRED | 精确指出字段或有权对象，修正后重新提交 |
| 422 BUDGET_EXCEEDED / COST_ESTIMATE_UNAVAILABLE | 不能提交；联系管理员或选择已验证模式 |
| 429 RATE_LIMITED | 按 Retry-After 退避；GET 可重试，业务 POST 保持同一键 |
| 503 DEPENDENCY_UNAVAILABLE | 若业务事务未提交可按同键重查；不能据此断言供应商未收到 |

供应商已接单后失败、取消、归档失败属于 Job 资源状态，不能把所有异步错误转换为原 execute HTTP 500。客户端 execute 请求超时先以同一键重放平台请求获取原 job，再查状态。submission_unknown 由管理员核对，不呈现“原任务重试生成”按钮。

## 6. 查询、分页和事件

列表默认 limit=30、最大 100，稳定排序使用 createdAt＋id（内容结构单独按 position＋id）。cursor 为签名不透明令牌，包含作用域、筛选和排序边界；变更筛选需从第一页开始。每页重新授权；数据随写入可变化，不宣称分页快照。列表 q 仅针对声明的名称／标题／标签，不自动搜索私有剧本全文。

projectId 查询条件不授予项目权限；若路径已有 projectId，查询参数只能省略或与其一致。类型不适用的筛选拒绝；不把忽略筛选导致的大列表当正确结果。未提供 projectId 时仅聚合有权项目或按 scope 返回共享对象。列表中不可见的私有来源字段应省略，不能返回 null 旁路暗示。

SSE 的 data 是 Event JSON，id 是项目 stream_seq。通知为 resource_changed、reset 或 access_revoked，不携带私有正文。Last-Event-ID 过期发送 reset；客户端重新获取当前工作区的对象。断线后始终刷新正在等待的作业。接到旧 revision 的通知可忽略，仍须防止较早发出的 GET 响应覆盖较新状态；按资源 revision 归并。事件序列由已提交 outbox 的投递器分配，详见 [04](04-state-execution-and-budget.md)。

## 7. 内部运营接口边界

公共契约的 requestJobReconciliation 仅请求原连接查询和费用核对，不允许管理员写任意“成功”状态或金额。确需人工账单校正时，由受限运营命令读取证据文件、校验连接／job 对应关系、追加不可变费用条目，并输出审计回执。命令设计及测试列入 S2；首版不必搭建运营后台网页。供应商回调走独立受限入口，其鉴别和内容验证遵循 Adapter 配置，不允许直接调用公开 API 写终态。

## 8. 可校验示例与契约演进

[sample-payloads.json](sample-payloads.json) 提供有效与故意无效的 JSON Schema 样例；[验收计划](08-verification-and-delivery-plan.md) 提供需要数据库、并发或真实媒体才能验证的业务样例。结构样例验证通过只能说明契约与示例相符，不能证明权限、费用、模型接入或播放正确。

修改协议时先改 build_contract.py，再生成 openapi.json 和操作目录，运行 check_design.py。生成器只是设计文件工具，不在产品运行时执行，不接入模型，也不替代未来服务端实现与迁移。

交付清单包含输出规格、已知时间线、文件 SHA-256、批准者和批准时间。files 不包含 manifest.json 自身，避免循环自校验；整个交付包的 SHA-256 由 Delivery 返回。文件名由服务端生成并去除路径跳转，不能让素材原名写出包外目录。externalTimelineKnown 表示外部时间线是否已知，当前外部回传固定为 false；平台版本仍可带自己的 timeline。

recoverDelivery 仅对同一交付记录恢复打包：重查操作者当前权限，但使用创建时已固定的版本、批准证据和文件清单；不切换到新审稿，也不再次发起生成。ready 记录返回原结果，failed 记录由内部任务重新打包；若需要采用新批准或新素材，必须创建另一条交付。

transferOwnership 在同一事务将目标有效成员设为唯一 Owner，并将原 Owner 变为 Admin，保留项目参与和审计；不自动移除原 Owner。邀请列表不返回 invitationUrl／令牌；创建响应可返回短时有效的邀请链接供管理员分享，撤销后即使链接仍在也不能接受。

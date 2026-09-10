# 06 API 协议与跨字段业务规则（实施基线 v1.3）

[openapi.json](openapi.json) 是机器可读契约，[操作目录](api-operations.md) 列出全部路径。03／04／本节及 11 规定结构类型无法独立证明的授权、事务和制作行为。契约覆盖 MVP 终态，已实现路由与验收状态见[22 实施进度](22-implementation-progress.md)；接口数量不代表运行完成度。

## 1. 基础协议、授权与版本

JSON API 前缀为 /v1，使用同源 HttpOnly／Secure 会话。除登录回跳和 SSE 外使用 application/json；写操作验证 CSRF 和可信 Origin。ID 为 UUID，日期 UTC，金额为微货币整数的十进制字符串；类型拒绝未声明字段。可选属性省略不等于随意清空，只有契约明确允许的 null 才有清空含义。

| 权限标识 | 准确含义 |
|---|---|
| public | 仅登录入口／受校验回调，不返回业务内容 |
| authenticated / authenticated_verified_email | 有效会话；接受邀请另需邮箱已验证且匹配 |
| tenant_member | 有效工作室成员，只能读取相应授权内容 |
| owner / owner_admin | 唯一 Owner／Owner 或 Admin；不可跨租户 |
| owner_admin_with_role_restrictions | Owner 可任免 Admin；Admin 仅管理普通成员，不自提权或改变 Owner |
| project_member | Owner／Admin 或该项目有效负责人／协作者 |
| project_lead_or_admin | 本项目负责人或工作室管理者 |
| scope_member | 项目对象需项目访问，共享对象需有效工作室成员；列表逐项过滤 |
| project_member_or_shared_admin | 项目内制作需项目成员，共享制作／修改只允许管理者 |
| project_lead_or_shared_admin | 项目资产确认需负责人／管理者，共享确认需管理者；draft 可用于项目试作 |
| project_member_working_or_lead_final | 项目成员可建立工作包；final 要求负责人／管理者且匹配最新批准 |

scope=project 必须有 projectId；scope=shared 必须省略。路径、正文、父对象和被引用资源作用域必须相符。无权项目对象返回 404，已知对象但动作不允许返回 403；列表、使用位置、事件、原片及派生链接都需同等授权。

项目成员可看本项目预算，工作室总账只有管理者可看。总额度不足时普通成员看到联系管理员的原因，不得到其他项目或工作室消费详情。changeTask：协作者只改分配给自己的 status／note／result；负责人可分配任务和改变其他字段。createTask 仍由负责人／管理者执行，协作者可以在评论中提交处理意见，不能借任务分配扩大项目权限。

正式审阅决定不可覆盖。作者可改评论正文并留审计；项目成员可标记处理状态，但不等于批准。资产确认表示团队基准，既不认证模型效果，也不强制每次试作重新审批。共享发布仍是管理员一次明确动作，草稿试作不会自动共享。

可变对象带 revision，以 `If-Match: "7"` 做 CAS。过期返回 412 并保留浏览器本地修改。createEpisode／Scene／Shot、reviseScript、reorderContent、importShotList、applyProposal 使用 ContentTree.revision；updateEpisode／Scene／Shot 用目标自身 revision，并递增内容根。仅重排／改名不产生新镜头要求修订。selectTake 用 Shot.revision；reviseAsset 用 Asset.revision；confirmAssetRevision 用该修订的 revision；saveCutWorkDraft用自己的revision（首次0）；saveCutDraft／freezeCut用Cut.revision并按21检查工作稿来源；editProposal／editAssistanceArtifact 用各自 revision；applyProposal 另须正文 proposalRevision 防止建议被并发编辑。其余带 CAS 的接口用所修改对象版本。

## 2. 幂等和敏感响应

所有受认证 POST 使用 Idempotency-Key，默认保留 24 小时，唯一范围为非空 scope_key＋actor＋operation＋规范化路径＋key。工作室操作 scope_key=tenant:{id}；创建工作室等全局操作用 user:{id}，不能依赖可为空 tenant_id 的普通唯一索引。请求摘要覆盖正文和有语义的版本头，敏感值不写日志。

同键同请求在重新授权后回放已提交业务结果，同键不同请求 409。缓存之外仍由 plan_id、渲染版本、账单来源等业务约束防重。execute 超时使用原键获取原 job，再查询；不能换键自动购买新任务。幂等仅针对平台业务，不证明供应商支持创建幂等。

幂等记录的敏感响应加密、限期保留；邀请查验使用令牌哈希，创建响应为了同键重放可受控保存邀请链接密文，列表不返回链接。转移所有权事务将原 Owner 变为 Admin，目标有效成员成为唯一 Owner，项目参与不自动清除。access 同键回放可能得到已过期短时 URL，客户端用新键重新授权申请，不把幂等当延长 URL 生命周期。

## 3. 剧本、状态和输入解析

**文本范围。** TextRange 使用固定 ScriptRevision.text 内 Unicode 码点偏移，[startOffset,endOffset)，不是字节、行号或媒体微秒。ScriptExcerpt.quote 必须与原文完全匹配；服务端与浏览器使用一致的码点计数。script_analysis 必须带 sourceScriptRevisionId＋scriptRange，只分析选区及明确显示的所需上下文，不能暗中发送整剧。

**分镜建议与导入。** AI 与 CSV 首版只产生 create 提案。CSV 模板见 [13](13-production-quality-and-handoff.md) 的相关交接模板与 [分镜导入样例](templates/shot-list-import.csv)；解析不调用付费模型。API 预分配 temporaryId，子操作父 ID 可以指向同提案身份，勾选时必须包含尚未创建的依赖父项。一次采纳事务按父子顺序应用，重复请求回原结果。重复导入的源摘要＋目标内容基线应返回原提案；相同标签不是身份，遇已有同名结构显示冲突说明，用户需明确确认新增独立结构或取消；target=new_structure 时按提案内父子关系创建；target=append_to_scene 时只新增 shot，proposed.sceneId 必须等于保存的 target.sceneId，并校验同项目、episodeId、sceneRevision。CSV 此模式须确认所有行归同一场，跨场输入不静默合并。复杂 AI update/archive 后置，人工结构编辑可用；人工拆合镜保留 sourceShotIds／sourceExcerpts，检查句子新去向和既有剪辑影响。

**状态。** Scene.state 是场次默认入口；ShotSpec.entryState 是本镜覆盖，exitState 是期望出口。每层 characters 按 characterAssetId、props 按 propAssetId 合并；同层重复对象拒绝。未提供字段继承，明确 holderCharacterAssetId=null 表示无人持有，不能把缺字段当清除。人物造型的 lookId／lookAssetRevisionId 必须成对，属于指定角色。不同造型并存；角色默认声音在 AssetDefinition.defaultVoiceAssetRevisionId，单句或状态可覆盖。模型 succeeded 不写回剧情事实，不自动把前镜期望出口当下一镜已确认入口。

**参考和一次性修改。** GenerationPlan.input 保存完整原始请求，resolvedInput 保存实际可执行结果，两者不混用。每次准备按固定 resolver 版本执行下表，结果逐项回显来源、所属对象、用途和固定媒体／版本。

| 来源／操作 | 确定规则 |
|---|---|
| 剧目默认 | 展开指定资产版本的根 references；只展开当前状态明确选择的造型，不加入所有 looks |
| 场次默认 | 对同一 subjectAssetId＋purpose 的明确引用组替换剧目同组；其他对象保留 |
| 镜头参考 | 同组明确选择高于场次；身份、造型、道具、声音用途分别处理 |
| 本次 referenceOverrides | replace 替换该组，append 去重追加，exclude 清空该组；同一层同组不可发相互冲突的多条指令；可用 shotId 限定多镜头计划中的一镜 |
| 本次 additionalReferences | 作为显式追加，去重后保留顺序；不能又 exclude 同一组再追加而不改原决定 |
| promptPolicy=append | 在解析出的要求后追加本次说明；不会改写镜头规格 |
| promptPolicy=replace | 以明确的一次性文本替换本次生成文本，参考仍按上表处理；检查面板显示被替换来源，不静默回存 |

所属对象优先从 assetRevision 的固定资产身份核对；显式 subjectAssetId 必须与其相符。无所属对象的通用风格／构图用独立公共组，不覆盖任何人物。两个角色同为 identity 不能互相替换。多镜头输出各保留 resolvedShots 及其入口／出口；若一份模型输入无法表达不同镜头的矛盾造型或状态，则阻断 MULTI_SHOT_INPUT_CONFLICT，要求拆计划或明确统一，不任选第一个镜头。

一次性修改、排除项与 promptPolicy 随原请求保留；从旧计划重新准备时复用这些显式选择，不让继承项自动回流。要改变镜头要求须显式 updateShot。resolvedInput.dependencies 只包含实际参与的来源：current 按相关内容 hash 检查变化，fixed 按固定版本／权限／可用性检查，不跟随父资产最新指针。无关排序、媒体改名、别的场次和未用造型变更不使计划失效。过期估计、能力修订或参与输入变化要求重新准备，不能静默升级。

## 4. 媒体、候选与声音

媒体 displayName／tags 可改；originalFileName 为安全原名。默认生成名使用已知对象、用途和尝试序号。q 检索 displayName、originalFileName 和 tags，公开来源说明按共享策略复制，原始字节及 SHA-256 不随改名变化。来源记录不意味着平台认证使用许可。

Media.derivatives 返回 poster／proxy 的状态和 profile。getMediaAccess 必须指定 variant；original 返回验收原文件，proxy／poster 返回匹配 ready 派生，不能悄悄回退另一种内容。派生处理中返回 409 DERIVATIVE_NOT_READY，失败可 recoverMediaDerivative，仅重做派生。所有分支按原媒体授权；waveform 后置。

实施补充：UploadIntent、Media、MediaDerivative 的可选 issue 提供公开错误代码、说明及 retryable。共享读者查询上传状态不取得上传凭证。访问签发先按当前范围重新授权，再允许幂等重放；URL 有效期独立于幂等记录，到期须以新请求标识再次签发。文本及 SRT 强制下载。服务实现和恢复边界见 [30 素材导入服务](30-media-import-service.md)。

ready 媒体必须指向不可变内容。上传完成后核对字节、类型、SHA-256、解码及固定快照，再复制到服务端独占 key；旧 staging URL 不能改变 ready 内容。归档禁止新增引用；保存旧草稿、冻结及恢复原交付时允许原有且仍授权的引用继续存在，对新增项单独校验。

Take 是单个连续视频区间，必须处于验收时长内；(shotRevisionId,mediaId,inUs,outUs) 去重。当前 selection 是该镜头的偏好，不表示叙事已经完整覆盖。时间线可用同镜头多个 take 的不连续片段，也可继续使用非当前偏好；越过 Take 边界须显式派生新候选。沿用旧要求下的 take 时建立关联到当前要求的新 take 并保留 sourceTakeId，不自动认为旧结果满足新要求。

MediaClip.kind=audio 且 streamSelection=embedded_audio 时可读取 video 媒体已有混合音轨，前提是探测到可用音频；default/audio 使用音频媒体，default/video 使用视频媒体。提取混合轨不等于对白声源分离。原视频保留混合轨时再叠替代对白会有双声风险，需显式静音／替换决定。

DramaDialogueBindings 放在短剧层，与通用 Timeline 并列。每条用 shotRevisionId＋dialogueId 关联 clipId、实际 sourceRange 和可选声音版本；字幕条目通过 usage=subtitle 关联。要求改词／表演即使时长相同，也根据绑定列出需要复查的声音和字幕，不自动改写。非对白音频可以不关联；未知外部成片不伪造绑定。

## 5. 剪辑、两种替换与归一

createCut 只创建空草稿及项目默认规格，允许先组织工作，空稿不能冻结。已有草稿不随项目规格变更自动调整。平台稿 editingMode=timeline；外部稿为 external_file，无可编辑时间线，saveCutDraft 不接受外部根。

normalizeCutDraft接收cutId、baseCutRevision、workDraftRevision，从已保存工作稿读取timeline与dramaBindings，返回带workDraftSource的processing记录；GET 得到 ready 的 NormalizationResult 后预览实际边界、总帧数、音频与字幕变化。规范化算法、VFR／原 PTS 映射和复用未改条目的规则由 [11](11-transaction-and-implementation-blueprint.md) 固定。normalizedItems 是权威整数帧／样本坐标；effectiveTimeline 微秒只是兼容显示，不能再成为另一套时间事实。

saveCutDraft 只提交 normalizationId 和 acknowledgedChangeIds，并用 If-Match 匹配 Cut。归一记录必须属于该 cut、同一 base revision、固定 requestHash，所有要求确认的变化已确认，并且workDraftSource仍匹配当前工作稿；服务器原子写effectiveTimeline、normalizedItems、绑定和依赖，同时更新工作稿内容及新基线。过期返回 412，保留客户端替换方案，重新基于当前稿归一，不能把旧结果覆盖新稿。

previewCutReplacement要求workDraftRevision匹配当前已保存工作稿，从该稿构造替换并记录来源；它产生归一预览，不直接修改任何草稿：

- keep_duration：新源片段必须足以实现原片段的有效帧数，显式选取同长度范围；后续视频位置不变，不慢放／循环／补帧。
- change_duration：主视频目标段按新有效帧数替换，之后主视频按同一差值顺延；预览列出所有后续及跨切点声音／字幕。客户端为每个受影响条目明确 keep／move／replace／remove，遗漏即 422 TRACK_DECISION_REQUIRED。move 提供新 timelineStartUs，replace 提供完整新条目；跨切点可明确保留但必须确认理由及影响。早于本次范围且不相关条目保持原样。

两条路径都校验 source range 在 take 中、clip ID 唯一、绑定目标一致、恰一非空顺序主视频轨；音轨可叠，字幕同轨不可重叠。主视频决定成片长度，音频／字幕越界拒绝，必须由人明确裁切或重编视频。不能在渲染时通过 longest／shortest 默认选项偷偷决定片长。

freezeCut须带expectedWorkDraftRevision（不存在为0），有未应用工作时默认拒绝；显式excludeUnappliedWorkDraft=true才允许仅固定上次确认编排，记录被排除的版本。随后固定当前已保存的normalization、有效时间线、来源映射、profile/renderer 版本与实际长度目标；不重新计算裁切。渲染验收固定输出 media、真实参数和哈希，媒体就绪才可审阅。外部视频原样验收，其字幕检查编码、时间区间与该文件长度，实际缺字幕时不制造空 SRT。

## 6. 审阅、返工链与交付

ReviewSubject 恰为一个 take 或 cut revision。take 评论使用候选局部时间，映射到原源偏移；cut 评论以已验收文件时间映射 normalizedItems。单点或区间不得超过审阅时长；父评论须同 review。

从评论发起轻任务时固定 origin(reviewId,commentId)。新审阅携带 sourceReviewIds 与 reworkItems：列出旧意见被替换、保留或未解决，并关联新 take／新片段区间；保留需非空理由。结果属于当前新稿且同项目，不能用别稿成果冒充修复；处理条目不移动旧评论。正式批准展示全部相关旧意见，未改或未解决项须在 acceptedExceptions 中逐项记录理由，否则返回 REWORK_DECISION_REQUIRED。处理状态与批准分开，任何例外都保留到固定决定。

createReview、decideReview、createDelivery(final) 争用同一固定 subject 锁，取锁后重新检查最新轮次和 readiness。final 必须匹配最新 approved 的整集或绑定集的外部成片。新轮次先提交会阻断旧批准；合法旧交付先提交则保存当时依据，不被后续决定倒改。

工作包有两种互斥目标：cutRevisionId 得到 cut_package；sourceSelection(takeIds,extraMediaIds,sourceBindings) 得到 source_package，后者仅允许 working 且包含明确源素材，不依赖先建时间线或渲染。先固定所选 take、额外媒体及可公开来源元数据，再异步打包。默认只包含已选实际素材，完整原文件去重；未采用候选不默认附带。已有 cut 的包附实际时间线、声音绑定及可用预览，源包明确没有平台时间线。

包内含人可读 README／镜头 CSV 和机器 manifest；原片范围、实际使用区间、原生音轨处理、独立声音、已知字幕及文件哈希按 [13](13-production-quality-and-handoff.md) 约定。files 不包括 manifest 自身，包 SHA-256 在 Delivery 中返回。source_package 的 outputSpec 仅为项目目标，不能宣称它代表不存在的成片实测规格；cut_package 若有已验收预览则用实际规格；尚无预览的工作包用固定timeline规格，并以outputSpecBasis明确区分，不能称作实测。文件名服务端生成，禁止路径跳转。

由 working 包发起的 importExternalCut 自动带 handoffDeliveryId，可附 subtitleMediaId；再次回传使用现有 external_file cutId 形成新版本。独立回传允许来源包未知；MP4＋SRT 仍 externalTimelineKnown=false。回传版只使用与之绑定的字幕，不借用旧平台稿的 SRT。includeSrt=true 但目标没有已验收字幕时 422。

recoverDelivery 只恢复该记录已固定输入、名称、批准证据与清单，不改为最新稿；ready 回原结果，failed 恢复同一打包任务。旧包恢复与新建 final 的资格检查不同：前者重查当前访问权限并保留创建时批准，后者需最新批准。

## 7. 错误、分页、事件与运营

Error 含 code、message、requestId、受授权限制的 details，不含密钥、原供应商正文或签名 URL。已接单后的生成失败属于 Job 状态，不倒改最初 execute HTTP 结果。

| HTTP | 主要 code 与恢复 |
|---|---|
| 400 | INVALID_REQUEST、REQUIRED_HEADER_MISSING；修请求，不盲重试 |
| 401／403／404 | SESSION_EXPIRED／ACTION_FORBIDDEN／RESOURCE_NOT_FOUND；重新授权或返回有权工作区 |
| 409 | PLAN_STALE、CAPABILITY_CHANGED、IDEMPOTENCY_CONFLICT、PROPOSAL_BASE_CHANGED、REVIEW_ALREADY_OPEN、DERIVATIVE_NOT_READY、CONNECTION_ACCOUNT_IN_USE；按对应资源重查，不自动新建付费计划 |
| 410 | EDIT_HISTORY_EXPIRED、NORMALIZATION_EXPIRED；授权后告知历史／未应用结果过期，不能假装重算的是原结果 |
| 412 | REVISION_CONFLICT、WORK_DRAFT_VERSION_CONFLICT；保留用户编辑，重新归一／比较 |
| 422 | INVALID_REFERENCE、MULTI_SHOT_INPUT_CONFLICT、INVALID_TIMELINE、TRACK_DECISION_REQUIRED、DEPENDENCY_MISSING、REVIEW_REQUIRED、REWORK_DECISION_REQUIRED、BUDGET_EXCEEDED、COST_ESTIMATE_UNAVAILABLE；指明可修正字段和有权对象 |
| 429 | RATE_LIMITED，按 Retry-After 退避；平台 POST 保持原 key |
| 503 | DEPENDENCY_UNAVAILABLE；若提交结果不明先重查原业务，不能断言供应商未收到 |

列表默认 30、最大 100，稳定排序 createdAt＋id；内容结构用 position＋id。签名 cursor 固定作用域、筛选和排序边界，改变筛选重开；每页重新授权，不宣称动态列表是快照。路径已有 projectId 时同名查询只能一致。q 仅搜索声明的名称／标签，不默认搜索私有剧本全文。

SSE 只发资源失效通知及 revision；GET 是权威状态。项目序列在 outbox 已提交后由 relay 持锁分配；重复通知可接受，旧 GET 不覆盖新 revision。游标过期 reset 并刷新当前工作区。重连重查待完成 job；撤权关闭流，事件不含私有正文或签名 URL。

公共 requestJobReconciliation 仅触发原连接核对。recordSubmissionEvidence、费用完整性结清、恢复隔离与未分配消费处理使用受限运营命令及追加证据，普通客户端不能指定成功状态或任意金额；蓝图见 11。外部回调默认唤醒可信查询，不直接写终态。

## 8. 契约维护

修改 build_contract.py 后生成 OpenAPI 与操作目录，再运行 check_design.py。样例文件覆盖正反输入结构，验收表覆盖依赖数据库、媒体和用户的事实；两者不互相代替。新增精确来源、归一和费用字段后必须同时复审 03／04／07／11，不能只让 JSON Schema 通过。

## 13. 二次复核补充契约

CSV Proposal 固定 sourceHash 与 CSV 来源记录，空项目导入不要求已有 script revision；AI 提案另必需固定 sourceScriptRevisionId 和 scriptRange。两种提案都只新增；均必须带 target，支持新结构或明确追加到已有场次，实际应用以项目内容基线、提案修订与幂等为准。

无 cut 的 sourceBindings 用 SourceMediaBinding 关联已选媒体与源区间、用途及说明，可选明确 shotRevisionId/dialogueId、voiceAssetRevisionId 和适用成片媒体 appliesToMediaId。它表达已知来源，不要求伪造 clip。每个引用及适用媒体均需同范围授权并包含在固定包依赖；dialogueId 与 shotRevisionId 必须成对有效，未知对应关系仅记 reference 与说明，不猜测。存在实际时间线时，dramaBindings 仍以真实 clip 身份定位，两者不混用。

替换预览请求的 dramaBindings 是本次草稿完整预期绑定：界面先载入旧绑定，标出目标、删改音轨及台词变更的关联项，用户明确重新关联、修正区间或删除后再提交；服务端拒绝悬空 clip、超源区间及与新 shot revision 不符的条目。未受影响绑定可以原样提交，不能自动把新声源判断为已实现新台词。NormalizationResult 固定检查后的完整绑定，按同一次 CAS 保存。

ReworkItem.outcome=replaced 必须至少指向一项实际结果 take／clip／cut revision／media；外部成片返工使用 resultCutRevisionId 固定 MP4 与 SRT 组合，补充来源可用 resultMediaId。所有结果重查同项目／授权；clip 必须属于本次新审阅 subject 或与 resultCutRevisionId 明确绑定，不允许裸 ID 指向其他草稿。任务完成记录不替代正式审阅。

### 可离线理解的固定交付清单

DeliveryManifest 固定 deliveryId、kind、createdAt、availability、outputSpecBasis、missingItems、unknownItems 和人读文件位置。工作包首版includeMedia必须为true，源文件按full_originals附带；final可明确省略源素材，此时sourcePolicy=not_included。预览未就绪的cut工作包可以建立，availability.preview=not_ready，outputSpecBasis=frozen_timeline；包创建时固定缺项，恢复不顺便加入后来渲染出的文件，需要新包才会改变内容。

files逐项列实际README、镜头表、声音表、媒体及证据文件，不含manifest自身。相同源字节去重后mediaIds保留全部已授权引用别名；mediaId可保留主身份，不能丢其他引用。source package的selections只快照已有真实选择记录；本次显式takeIds是包选材范围，不能为未曾采用的候选伪造历史决定。没有时间线、没有批准、没有实测成片规格时用对应availability与basis清楚表达。缺字幕且includeSrt=true仍拒绝，不能靠missingItems规避本次明确请求。

## 2026-09-09 场次主场景补充

[14 收口基线](14-scene-mvp-closure.md) 规定当前场次提案、持久提示与返工建议、正式创作依据和场次主责的字段及事务。它们已进入同版 OpenAPI，属于本期范围。新结果仍不自动采用／更新剪辑，确认创作依据与审片通过分别记录；历史费用、版本及来源规则不变。

## 场次画布协议扩展（最初引入于OpenAPI 1.2.0）

新增12个操作，详见[18 §7](18-canvas-workspace-contract.md#7-接口清单与事务)。saveCanvas、节点绑定、prepareCanvasGeneration、结果取回使用 canvas If-Match；个人场次偏好使用自己的 revision，GET 无记录返回0，首次 PUT 接受 If-Match:"0"，不修改画布。生成仍经既有 executeGenerationPlan 显式执行。节点正文禁止伪造 job／Take／批准；相关媒体、身份、跨场绑定、候选区间与输入指纹须由服务器校验，Schema 通过不替代此类校验。快照、归档引用例外、不可变节点及全局锁顺序以18及11共同规定。

## 工作稿、历史与编辑提示（OpenAPI 1.3.0）

完整字段以生成契约为准，跨字段、原子性、恢复及保留默认值见[21](21-technical-baseline-closure.md)。新增操作：

| operationId | 路径后缀（项目内） | 关键协议 |
|---|---|---|
| getCutWorkDraft／saveCutWorkDraft | GET／PUT /cuts/{cutId}/work-draft | 团队共享；无记录GET虚拟0；PUT工作稿If-Match；正文baseCutRevision＋document；结构／授权合法的未完成工作可保存 |
| listCutWorkDraftHistory | GET /cuts/{cutId}/work-draft/revisions | 仅列实际保留点、当前revision与策略；按revision倒序分页 |
| getCutWorkDraftRevision | GET /cuts/{cutId}/work-draft/revisions/{revisionNumber} | 正整数版本；只读；诊断依据当前权限和Cut，过期410 |
| listCanvasHistory | GET /canvases/{canvasId}/revisions | 只列实际保留点；原getCanvasRevision增加410 |
| getEditingPresence／updateEditingPresence | GET／PUT /editing-presence | GET query kind＋objectId；PUT target＋clientSessionId＋activity；本人身份由会话确定，服务器时间和90秒TTL；无内容CAS或独占锁 |

所有写操作校验CSRF和实际项目成员／可编辑范围。已归档项目只读；external_file不接受工作稿写入。新媒体引用需ready，原有归档引用按原例外；越权源拒绝，暂时缺clip的对白绑定可作为待处理问题保存。内容最大4MiB、总条目上限等跨字段数量在服务器校验，超出413。

新409原因包括CUT_BASE_CHANGED、WORK_DRAFT_CHANGED、WORK_DRAFT_UNAPPLIED、EDITING_MODE_UNSUPPORTED；412区分Cut与工作稿冲突。hasUnappliedChanges按工作文档与当前已确认编排及未处理事项比较，不只看更新时间。工作稿响应ETag仅作写CAS，不能据此缓存会变化的诊断。getCutNormalization对授权后已过期未应用结果返回410 NORMALIZATION_EXPIRED。

normalize旧版直接传timeline的请求在1.3.0被拒绝；replacement预览仍保留显式dramaBindings作为本次替换提案的一部分并复验来源，不允许它绕过工作稿版本。历史恢复通过读取旧文档、用户选择合法内容、向当前对象PUT形成新revision，不新增“回滚并执行旧任务”接口。

实施补充：提案详情可返回只读 `baseContentSnapshot`（固定导入／复核基线）与 `application`（实际采纳修订、所选操作、实际创建对象和结果内容版本）；列表可省略。历史详情的内容按指定修订返回，采纳事实仍属于当前提案。写入类型不接受这些服务端字段。实现与验收见 [25 CSV 提案](25-csv-proposals.md)。

实施补充：创作依据列表可按 `subjectId` 与 `kind` 查找未确认快照；只读 `number` 表示同一主体内依据次序，`isCurrentSource`／`currentConfirmationId` 表示读取时当前来源和正式指针，不改写历史快照。确认历史返回 `note`。实现及固定稿限定用途的当前边界见 [26 创作依据](26-creative-bases.md)。

实施补充：任务详情和不可变处理历史分别由 `getTask` 与 `listTaskRevisions` 读取。`assigneeAvailable` 为当前成员／项目资格，不改写历史受派人。场次筛选同时匹配仅绑定该场镜头的任务；显式同时绑定场与镜的任务禁止镜头悄然跨场。当前一般任务、协助及场次主责可用；正式返工及结构化成果需真实审稿、意见与媒体来源，暂不接受裸引用。见 [27 场次主责与任务](27-scene-tasks.md)。

资产实施补充：增加 `getAssetRevision` 读取确切固定修订，详情和引用无需加载全部历史；增加 `listSharedImports` 读取当前项目已明确引入的固定版本，刷新不会丢失引入状态。二者沿用现有授权、分页和读权限，不改变确认、发布或升级语义。

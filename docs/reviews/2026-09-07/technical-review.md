# 独立技术架构评审：冻结设计的实施前检查

评审日期：2026-09-07。评审身份：独立的资深技术架构师 AI 评审角色，不代表真人专家、供应商认证或已运行的工程验收。本报告只评审 `docs/reviews/2026-09-07/baseline/`，没有修改基线、主设计或其他评审报告，也未读取其他评审结论。

**结论：架构主干可以保留，可以继续工程初始化与模拟纵向集成；费用结清、审阅／交付并发、渲染时间语义三项 P0 应先修订，再实现对应核心事务。另有七项 P1 应在受影响功能进入试点前闭合。** 这些问题不要求增加微服务、工作流引擎或复杂权限，也不要求现在决定画布。

本报告采用：P0＝阻断相关实现正确性，应先修设计；P1＝试点前必修，可与其他工程准备并行；P2＝后续改善。本轮没有为了凑数单列 P2。尚待落实的真实模型账号、预算、存储服务、样片质量与 UX-01 不重复列作缺陷。

## 评审范围与实际核查

已阅读实施包 README、01–10 主要 Markdown、API 操作目录、静态检查报告、`build_contract.py`、`check_design.py` 和关键 OpenAPI 定义，结合完整产品主稿、领域词汇及两份冻结官方证据进行交叉检查。

- [完整产品主稿](baseline/docs/ai-drama-workbench-product-design-v1.0.md)
- [实施文档入口](baseline/docs/implementation/README.md)
- [基础设施官方证据](baseline/docs/research/2026-09-07-implementation-infra-evidence.md)
- [模型官方证据](baseline/docs/research/2026-09-07-implementation-model-evidence.md)

实际执行了只读契约检查：解析生成器 AST，仅在内存执行第 287 行写文件之前的构造逻辑，将生成的 document 与冻结 `openapi.json` 作对象比较，结果相同；104 个操作、122 个 Schema。冻结 OpenAPI SHA-256 为 `5640f59d07d28d8681d52466a5f940aa75056bed2ff0c9454d33b1d1924fb4dc`。没有执行会重写冻结文件的 `check_design.py`，没有运行产品、数据库、供应商或媒体管线。以下是设计反例与最小修订，不声称已复现运行故障。

| 编号 | 级别 | 问题 | 最晚处理点 |
|---|---|---|---|
| TECH-01 | P0 | 分笔费用没有“账单已完整”的结清事实 | Budget／Adapter 结清接口实现前 |
| TECH-02 | P0 | 新审阅轮次与 final 创建未规定同一把锁 | ReviewDelivery 事务实现前 |
| TECH-03 | P0 | 帧归一、成片长度和来源映射未形成冻结事实 | Editing／渲染契约实现前 |
| TECH-04 | P1 | 实际生成输入及其解析来源版本回显不完整 | 真实生成开放前 |
| TECH-05 | P1 | 连接可换凭据，旧作业没有明确账号／秘密版本绑定 | 真实连接轮换前 |
| TECH-06 | P1 | 租约失效后的迟到回执缺少独立接收路径 | S2 故障恢复验收前 |
| TECH-07 | P1 | 派生预览有数据表，公开 API 无法选取 | S3 浏览器媒体验收前 |
| TECH-08 | P1 | 原始素材缺可检索身份与可携带来源记录 | S1 素材流程及 S3 交付前 |
| TECH-09 | P1 | 共享制作缺工作室单层预算分支 | 开放共享生成前 |
| TECH-10 | P1 | 旧备份恢复缺可执行的隔离集合与放行条件 | S4 恢复演练前 |

## TECH-01 · P0 · 分笔费用确认不能等同整项费用结清

**定位。** [03 数据模型 L102–108](baseline/docs/implementation/03-domain-data-model.md#L102) 只有一个 reservation 金额和 held／settled／released；[04 费用规则 L80–88](baseline/docs/implementation/04-state-execution-and-budget.md#L80) 同时允许分笔收费；[07 Adapter L42](baseline/docs/implementation/07-provider-adapter.md#L42) 的 `Confirmed(entries)` 没有完整性标志。`GenerationJob` 也只有 `actualCost` 和 `reservationStatus`，见 [生成器 L102](baseline/docs/implementation/build_contract.py#L102)、OpenAPI `GenerationJob`（L11927）。

**失败场景。** 作业预占 8 元，第一次只取得其中 3 元的可靠费用条目。如果按“取得实际费用后结清”释放剩余 5 元，第二项作业可以消耗这 5 元；稍后原作业的另 5 元到账，预算被可预知地提前释放。若实现者反过来一直保留原 8 元再加已确认 3 元，界面和准入又会重复占用。`Confirmed` 只能证明这些条目真实，不能证明供应商不会再发来其他条目。

**最小修订。** Adapter 返回费用证据的完整性：`pending / partial / final / unavailable`，并附最终结清依据。平台分开保存累计已确认消费、尚未确认的预占余额、结清状态与证据引用。只有有完整账单／确定无后续费用的证据，才能释放全部余量；部分确认采用一项明确的余额计算规则，避免重复占用。无法提供终局证据的模式走受控人工结清并保存依据。金额更正仍追加行。

**验收事实。** 在 AT-18 增加“3 元→重复 3 元→最终累计 8 元”的分段到达；中间态不把 8 元原预占和已确认 3 元重复计入，也不把仍有依据的未决 5 元提前放行。重复／乱序账单、最终更正、取消但账单未完整都收敛到同一结果。未知终局状态不得伪装成 settled。

## TECH-02 · P0 · 创建最终交付必须与开启新审阅竞争同一 subject 锁

**定位。** [04 L96–98、121](baseline/docs/implementation/04-state-execution-and-budget.md#L96) 规定 final 使用目标版本最新 approved 轮次，并规定新轮次锁 subject 分配 number；却没有规定 `createDelivery` 也持有同一 subject 锁。[06 L74–75](baseline/docs/implementation/06-api-contract.md#L74) 只有校验规则。[AT-26](baseline/docs/implementation/08-verification-and-delivery-plan.md#L44) 未明确交付创建与新轮次的交错执行。

**失败场景。** 事务 A 查到审阅 #1 是最新且 approved；事务 B 锁定 cut subject，创建并提交 open 的 #2；A 随后插入 final，使用 #1。A、B 都在各自事务内，也没有覆盖已存在的决定，但 final 插入时最新轮次已经未批准。只锁 #1 review 行不能阻止新增 #2。

**最小修订。** `createReview`、`createDelivery(kind=final)` 对同一固定 subject 使用相同锁与顺序；取锁后重新查询最新轮次、批准和 readiness，再写固定批准证据。可以锁 cut_revision／take 身份行，或建立一行审阅聚合根；也可明确采用覆盖这些事务的 Serializable 策略及重试规则，不能仅写“同一事务”。已有交付恢复仍使用其已固定批准证据。

这项判断是对本设计交错次序的推论。PostgreSQL 行锁只会阻塞对相应行的冲突写入或取锁，并不会自动把所有关联表的插入串行化。[PostgreSQL 18 官方锁说明](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-ROWS)

**验收事实。** 用事务屏障固定上述交错：若 #2 先取得 subject 锁并提交，A 拒绝；若 A 先取得锁完成 final，#2 等待后开启，既有 final 作为当时合法交付保留。两种顺序均不能出现“#2 已经先提交，A 仍凭 #1 新建 final”。

## TECH-03 · P0 · 归一后的时间线和成片长度必须是冻结内容的一部分

**定位。** [03 L37、118–124](baseline/docs/implementation/03-domain-data-model.md#L37) 以微秒记录裁切与来源；[05 L81–85](baseline/docs/implementation/05-architecture-and-operations.md#L81) 要求任意裁切按帧归一、统一输出规格并回显；[06 L71](baseline/docs/implementation/06-api-contract.md#L71) 只检查视频无重叠空洞、音频可叠加。`Timeline`／`CutRevision` 没有区分请求裁切与有效裁切，也没有输出时长、音频尾部或映射规则，见 [生成器 L108–116](baseline/docs/implementation/build_contract.py#L108)。

**失败场景。** 两个片段在微秒时间线中相接，但各自裁切在渲染阶段被取到帧边界，合成后实际边界改变；SRT 和 cut_items 仍按未归一的时间线生成。多次拼接后，评论指向错误源位置。另一个合法输入是 46 秒视频配 60 秒音频：当前规则未决定输出应为 46 秒、60 秒、拒绝，还是补画面。不同实现都可能“FFmpeg 成功”，却得到不同审片文件。原始媒体仅记平均／有理 fps，也不足以定义 VFR、非零起始 PTS 的源时间映射。

**最小修订。** 定义唯一的时间线规范化函数，在保存／冻结前返回并让界面使用有效源区间、输出帧区间和实际总时长；freeze 固定规范化结果及规则版本。源探测保留时间基、起始 PTS、帧率模式及必要映射，或先生成具有明确源映射的规范化制作副本。明确主视频决定输出长度，音频／字幕越界是拒绝还是显式裁切；首版渲染要求恰有一个非空主视频轨。固定音频采样率／声道、色彩解释与 renderer/profile 标识；不要求增加专业剪辑功能。

FFmpeg 官方说明 `trim/atrim` 不自动重置时间戳，`concat` 会受各段流长度影响；因此退出码不能替代本平台对长度与映射的定义。以上修订是本项目设计选择。[FFmpeg 官方 trim／concat 说明](https://ffmpeg.org/ffmpeg-filters.html#concat)

**验收事实。** AT-23 增加大量非整帧裁切、29.97 fps、VFR、非零起始时间、无声视频和超过视频末端的音频／字幕。保存回显、冻结 timeline、cut_items、渲染文件、SRT 与评论映射使用同一组有效边界；误差按输出 fps 的一帧衡量，不只验总文件时长。AT-24 同时验证 render task 的 renderer/profile 标识确实持久化。

## TECH-04 · P1 · 生成计划尚不能完整回显“解析后实际输入”及其来源基线

**定位。** [02 L38–40](baseline/docs/implementation/02-interaction-spec.md#L38) 与 [07 L46](baseline/docs/implementation/07-provider-adapter.md#L46) 要求实际角色、造型、媒体用途、文本和费用依据可核查。[03 L96–98](baseline/docs/implementation/03-domain-data-model.md#L96) 只有一个 source_content_revision 及镜头／媒体关联；[生成器 L98–99](baseline/docs/implementation/build_contract.py#L98) 的响应复用 `PlanInput`，另加 resolvedPrompt、总 estimate，未规定 `input` 是原始请求还是解析后的规范输入，也未提供角色造型选择、来源根版本、费用公式／余量的结构。

**失败场景。** 用户请求只含镜头，后端从 Production 和 Scene 默认项补出角色与声音。前端若把 `input.references` 当原始请求，只展示局部参考；若把它当实际列表，又无法说明其来自哪个默认项和造型。计划形成后 Production.brief／defaultAssetRevisionIds 改变，`changeProduction` 使用独立 Production.revision，而内容 CAS 只规定结构变更递增；实现无法仅凭 source_content_revision 一致判定旧计划是否过期。一个总 estimate 也无法按 04 L76 展示估算余量与报价依据的区别。

**最小修订。** 明确 `GenerationPlan.input` 就是服务端规范化且可执行的完整输入，或单列 `resolvedInput`；固定来源清单 `{kind,id,revision,purpose}`，包括实际参与解析的 Production／Scene／Shot 与造型固定版本。以精确依赖判断过期，避免任意无关编辑都让全项目计划失效。估计附定价版本、计量输入、基础估计与预占余量。输入摘要排除会变化的签名凭据，实际上传／提交另存受控映射与请求证据。

**验收事实。** 用隐式场次默认参考形成计划，页面回显与模拟 Adapter 实际提交逐项一致；修改被使用的 Production 默认项后提交旧计划得到指定冲突；修改未使用的另一个造型不会误改旧输入。账本预占值能从显示的估计与余量解释。跨租户来源字段仍按权限过滤。

## TECH-05 · P1 · 作业需要固定供应商账号身份和可恢复的连接版本

**定位。** [05 L64](baseline/docs/implementation/05-architecture-and-operations.md#L64) 明确旧任务按原账号查询并保留必要秘密版本；[03 L52、99–100](baseline/docs/implementation/03-domain-data-model.md#L52) 只有当前 connection_id／credential_secret_ref，没有连接修订关系或作业账号快照；[生成器 L91–95、225](baseline/docs/implementation/build_contract.py#L91) 允许修改 credential 和 status。能力验证又明确绑定账号，见 07 L16。

**失败场景。** 管理者把连接 C 的密钥从供应商账号 A 换成账号 B。旧 job 只知道 C，恢复时取到 B 的密钥，原任务查询失败；同时 C 的旧已验证能力可能被继续展示为已启用。即使操作只是在同账号内正常轮换，数据库也没有说明如何选取当前仍有效的同账号密钥，或如何证明秘密服务中的历史版本对应哪个 job。

**最小修订。** 将连接的服务／地区／供应商账号身份做成不可变修订，plan／attempt／job 绑定该修订；秘密引用保存明确版本或经验证的同账号后继版本关系。轮换时验证账号身份；更换账号应新建连接或新修订并重新核验能力，不能沿用旧验证。对外只返回脱敏身份与修订，不返回秘密正文。

**验收事实。** 扩展 AT-19／MV-10：A 账号运行中的任务，分别经历同账号轮换、误填 B 账号凭据、停用连接。旧任务始终在 A 的身份下核查；B 不继承已验证能力；历史引用可从持久记录恢复，不能依赖运营人员记忆。

## TECH-06 · P1 · 迟到的真实回执不能因旧 lease_token 被一并丢弃

**定位。** [04 L72、113–119](baseline/docs/implementation/04-state-execution-and-budget.md#L72) 要求过期 Worker 不覆盖新持有者；[03 L100、132](baseline/docs/implementation/03-domain-data-model.md#L100) 在 attempt 和 worker_tasks 中保存 lease_token，却没有区分“接收供应商证据”和“改变权威作业状态”的写入边界。

**失败场景。** Worker A 提交任务后网络阻塞超过租约。恢复者 B 将作业置为 submission_unknown；A 稍后收到真实 providerJobId。若所有回写一律要求当前 lease_token，唯一可精确找回任务的回执会被拒绝保存。若为保存回执放开旧 Worker 的状态写入，又可能覆盖 B 已核查的状态或取消事实。

**最小修订。** 增加幂等、追加式的 `recordSubmissionEvidence(attemptId, receipt)` 内部入口，允许过期持有者提交可验证证据，但不允许其直接覆盖 job 状态。有效持有者／恢复器再核对连接修订、请求摘要、唯一 providerJobId 关联，按合法状态转移收敛。冲突回执保留并进入核查，不丢证据、不重 POST。普通用户和未经鉴别回调不能调用该入口。

**验收事实。** AT-13 增加“响应在租约失效后返回”的确定性夹具：只发生一次供应商 POST，真实回执最终入库，旧 Worker 不能回滚取消／终态，新恢复者可以凭同一回执继续查询归档。重复迟到回执不会产生第二项作业或消费。

## TECH-07 · P1 · 代理视频、缩略图和波形缺少可用的 API 入口

**定位。** [03 L83](baseline/docs/implementation/03-domain-data-model.md#L83) 已有 media_derivatives；[05 L77](baseline/docs/implementation/05-architecture-and-operations.md#L77) 要求原文件与代理分离。可是 [生成器 L85、89、220–221](baseline/docs/implementation/build_contract.py#L85) 的 `Media` 没有派生列表／状态，`AccessRequest` 只有 inline／attachment，`getMediaAccess` 无法指定原片、代理、海报或波形。

**失败场景。** 后端已归档原片，代理失败或仍在生成；前端只能看到原片 ready，然后申请一个语义不明的 inline URL。它既无法知道当前是否可用代理，也无法区别“原片可下载、预览恢复中”。即使首条模型输出恰好能直接播放，资产网格的缩略图和声音波形仍无契约可调用。

**最小修订。** `Media` 返回派生种类、状态、profileRevision 及必要播放参数；访问请求增加明确的 variant 或 derivativeId，并继续在原媒体范围下授权。规定 unavailable／processing 的返回与恢复方式。是否首版提供 waveform 可以裁减，但公开设计中保留的 poster／proxy 必须贯通；不把内部对象 key 暴露给浏览器。

**验收事实。** 原片 ready＋代理失败时可以下载原片，界面正确显示预览待恢复；恢复只重做派生。指定 proxy 获得代理内容而非偶然原片，指定 original 获得清单中的原始校验值。撤权后所有派生申请同样拒绝。

## TECH-08 · P1 · 媒体检索与来源交接尚缺实际可保存的生产元数据

**定位。** [01 PR-06](baseline/docs/implementation/01-product-requirements.md#L22)、[02 资产页 L21](baseline/docs/implementation/02-interaction-spec.md#L21) 要求成功媒体可检索并查看来源；[06 L102](baseline/docs/implementation/06-api-contract.md#L102) 指定 q 查询名称／标题／标签。但 [03 L81–82](baseline/docs/implementation/03-domain-data-model.md#L81) 和 [Media／UploadInput L85–88](baseline/docs/implementation/build_contract.py#L85) 仅上传请求有 fileName，持久逻辑字段与 Media 响应没有名称、原名、标签、来源说明；也没有素材元数据修改接口。Manifest 只携带文件身份与校验信息。

**失败场景。** 剪辑导入“林夏台词第 2 版.wav”和几份配乐，数周后另一位成员只能按 UUID、时间和媒体类型查找，无法按文件名检索。共享复制后私有 upload/job ID 被正确隐藏，但可向共享读者展示的来源说明也没有保存位置。真实试点要求实施团队准备合法声音／图片（10 L9），目前无法随素材交接其来源和已记录的使用依据，只能另靠聊天补充。

**最小修订。** 媒体持久保存安全原名、可编辑 displayName／tags、来源类别与说明；上传、生成、共享复制各定义默认命名。增加受相同项目／共享权限控制的元数据接口与 q 字段映射。允许保存最小来源／使用依据附件或引用、记录人和确认时间，并区分可随共享转发的信息与内部私有血缘。这里要求的是证据随素材保留，不是建设版权裁决器，也不推断任何素材自动获得商用许可。

**验收事实。** 导入及生成素材均能按声明的名称／标签检索；重命名不改变字节、SHA-256 或旧交付。无源项目权限者能看到允许共享的来源说明，无法获得私有 upload/job／项目详情；交付清单中的已知来源可以由持久记录解释，未知项如实标记。

## TECH-09 · P1 · scope=shared 的作业需要明确工作室单层预算规则

**定位。** [01 L70](baseline/docs/implementation/01-product-requirements.md#L70) 允许管理者公共制作；[06 L29](baseline/docs/implementation/06-api-contract.md#L29) 要求 shared 省略 projectId；[生成器 L98、227–229](baseline/docs/implementation/build_contract.py#L98) 允许共享计划／执行。但是 [03 L102–103](baseline/docs/implementation/03-domain-data-model.md#L102) 的 reservation 同时列 workspace_budget_id／project_budget_id，[04 L78](baseline/docs/implementation/04-state-execution-and-budget.md#L78) 无条件要求同时检查两个账户，未声明共享分支。

**失败场景。** Owner 为共享角色生成参考图，请求合法且无 projectId。Budget.reserve 无从选择项目预算：实现者可能拒绝全部共享生成、借用任意项目、创建虚假项目，或跳过本应存在的工作室预占；这些结果都与当前公开行为或消费归属冲突。

**最小修订。** 明确 project 作业约束工作室＋项目账户，shared 作业只约束工作室账户；reservation 的项目账户按 scope 条件为空，并有 CHECK／范围约束。费用查询、结清、退款和跨周期规则均覆盖 shared。若不想在首版实现公共生成，应显式关闭对应 capability／入口并修订范围，不能保留可提交契约却让 Budget 临时猜测。

**验收事实。** 与 AT-12 相同的工作室余额下并发提交共享与项目作业，二者共同消耗工作室可用额度；共享作业不改变任何项目 spent／reserved。普通 Member 不能创建共享作业或读取工作室总账，管理者可以对共享消费核账。

## TECH-10 · P1 · 恢复规程需要定义旧 queued 的隔离集合，而不只识别“备份后创建的任务”

**定位。** [05 L108](baseline/docs/implementation/05-architecture-and-operations.md#L108) 正确要求先关闭外部创建、核对后恢复调度；[AT-32](baseline/docs/implementation/08-verification-and-delivery-plan.md#L50) 尚未定义核对失败时哪些任务可放行。[03 的 attempt／outbox／worker_tasks](baseline/docs/implementation/03-domain-data-model.md#L99) 都与业务数据库处于同一恢复时间点；模型证据也明确不能保证所有无 ID 提交精确找回。

**失败场景。** T0 备份中已有 queued 作业 J；T1 Worker 提交 J，供应商接受；T2 数据库灾难后恢复 T0。J 的 created_at 早于备份，看起来仍是正常 queued，T1 attempt 已丢失。即使运维核对了“备份后新建 job”，仍可能漏掉 J。另有 T1 才创建且已被接受的 K，恢复库中根本没有 K；若供应商账单不能精确关联，仅凭“恢复完成”不能宣称预算与提交记录已经完整。

**最小修订。** 在 S4 runbook／受限命令中固化恢复代次、恢复切点、受影响连接和隔离集合：恢复出来的所有可能进入过外部提交的非终态任务默认隔离，包含创建早于备份的 queued；原 attempt 的缺席不能当作未提交证据。逐项按可靠证据归类，无法证明未执行的留在 reconciliation_required；新作业使用恢复后的执行代次。对恢复点后完全缺失的作业，规定外部账单／独立审计材料的核对与未分配费用处理，并将记录损失纳入恢复结果。首版可用受控命令与导出证据文件，不必建设第二套在线业务数据库。

**验收事实。** AT-32 同时覆盖 J、K，以及确实未提交的排队作业；任何无法排除已提交的旧 job 都不会自动 POST。账单关联不全时保留未决金额及受影响范围，放行条件可重复执行且有审计。恢复报告分别列出元数据、媒体、外部作业与消费是否完整，RPO 达标不自动宣称费用已核清。

## 可以保留的设计与复杂度判断

当前模块化 API、独立执行／媒体 Worker、PostgreSQL 事务、受控对象存储的选型与规模目标相称。Generation.execute 与 Budget.reserve 共用本地事务、外部请求不放进重试事务闭包，是正确边界。outbox 与 worker_tasks 的职责可以保留，但实施时应各有单一状态推进者；不需要引入第二消息系统来处理本报告中的一致性问题。

稳定镜头身份、不可变修订、一个 plan 最多一个 job、新结果不自动采用、采用不自动改剪辑、审片基于固定媒体、外部成片不虚构时间线，均应继续作为不变量。媒体复制至客户端不可覆盖的最终对象、共享记录与私有来源分离、复合范围约束、运行角色不绕过 RLS、回调默认只唤醒可信查询，也都有清楚的工程理由。

预算并非供应商消费的绝对硬封顶，静态估计可偏离实际；当前允许事实账单超过预算并阻止后续执行是合理的。TECH-01 要修的是已知未决费用被提前释放，不是要求平台伪造一个永不超支的供应商保证。物理存储、转码、打包和带宽成本继续与生成成本分列，并在 G-06／S4 按真实量确定配额与容量告警，不需要现在制作客户充值系统。

104 个操作代表设计覆盖面，不应成为“先逐个写齐 104 个路由，再做一次真实流程”的研发方式。按已有 S0–S4 先贯通导入视频→候选→剪辑→冻结→审阅→交付，再接可靠生成；对暂时不使用的共享生成或波形，可以在范围中明确关闭。不要为了未来广告现在抽象通用节点图、任意审批 DSL、权限表达式、多个空 Adapter 或跨模块 RPC。广告底层复用仍由明确的公共生成／媒体／编辑接口承担。

## 静态评审不能关闭的外部验证

1. **服务与账号。** G-02／G-03、MV-01–10 仍需要指定 Seedance 服务／地区／账号、真实素材通路、报价和账单证据。冻结研究中海外 LAS 的期限、真人素材条件或计费方式不能迁移成国内方舟的事实，本报告也没有作这种外推。
2. **媒体正确性。** 需要实际 FFmpeg 构建、字体、编码器、浏览器和存储链路验证。TECH-03、07 的字段修订只让目标可测试，不能证明音画／字幕已经一致。
3. **权限与运行。** 实际 RLS 角色、连接池上下文、复合外键、签名 URL 的撤权窗口、SSRF 防护、恢复命令必须做集成与故障演练。S3 已签 URL 的有效性不会随本平台数据库成员行自动撤销，相关说明可以保留。[Amazon S3 官方预签名 URL 说明](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
4. **生产价值。** 46 秒夹具只验证一段流程，不能替代目标工作室的连续制作、跨集复用和完整人工／现金成本记录。主稿提出的连续两集与试点工作室证据、AT-35／36 的质量及返工结果仍要实际获得。UX-01 继续后续验证，不由本技术评审决定最终主界面。

建议裁决顺序：先在契约与事务文档中关闭 TECH-01–03；S2 开放真实执行前关闭 TECH-04–06、09；素材和编辑纵向集成中关闭 TECH-07–08；S4 前把 TECH-10 变成演练可运行的恢复命令与证据。每项关闭应同时更新相应行为用例，不能仅以 Schema 再次通过作为完成事实。

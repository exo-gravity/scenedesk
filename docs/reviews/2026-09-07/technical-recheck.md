# 技术二次复核 · 2026-09-07

评审身份：独立资深技术架构师视角的 AI 复核，不代表真人专家签署。本轮只读当前 `docs/implementation/03、04、05、06、07、11` 与 `build_contract.py`，针对首轮 TECH-01–10 的修订、跨文件一致性及无需 cut 的素材包路径复核；未读取其他评审输出，未更改主设计或冻结基线。首轮报告保留于 [technical-review.md](technical-review.md)。

**结论：首轮 TECH-01–10 及本轮反馈的四项 P1 均已在设计层面闭合；当前未保留未修 P0/P1。可以据此进入实施，真实试点仍须完成下述数据库、媒体、账号和恢复验收。这里的“设计闭合”只指文字、数据及接口能表达同一行为，不能代替实施和真实验收。**

## 首轮问题追踪

| 首轮编号／原严重度 | 当前设计判断 | 复核依据与仍需执行的事实 |
|---|---|---|
| TECH-01 / P0：部分费用与结清 | 设计闭合；跨费用身份补充见 RTECH-02 | [04 §5](../../implementation/04-state-execution-and-budget.md#5-预算与实际消费)、[11 TX-03](../../implementation/11-transaction-and-implementation-blueprint.md#5-tx-03-费用证据与结清) 区分 pending/partial/final/unavailable、累计确认 C、基础余额 max(E−C,0) 与额外控制预留 K；只有完整性证据可结清。待测重复分项、累计账单先到、final 后修正、非 final 耗尽预占与受控追加 K。 |
| TECH-02 / P0：新审阅与 final 竞态 | 设计闭合 | [11 TX-05](../../implementation/11-transaction-and-implementation-blueprint.md#7-tx-05-审阅与最终交付) 的 createReview、decideReview、createDelivery(final) 取得固定 subject 锁，锁内重查最新轮次、权限及 readiness。待用真实事务屏障分别证明 final 先锁与新轮次先锁的结果。 |
| TECH-03 / P0：归一、片长与来源映射 | 设计闭合；本轮补充见 RTECH-01、04 | [11 §6](../../implementation/11-transaction-and-implementation-blueprint.md#6-tx-04-采用规范化草稿与冻结) 给出单一 normalization-v1、异步结果与确认协议、主视频 N 帧、48 kHz 样本边界、VFR/非零 PTS 映射、制作副本及固定构建。save 仅引用确认后的 normalizationId，freeze 不重算。待运行实际信号、字幕及 AAC 有效采样验收。 |
| TECH-04 / P1：解析输入与源版本 | 设计闭合 | [03 §6](../../implementation/03-domain-data-model.md#6-生成执行与费用)、[04 §2](../../implementation/04-state-execution-and-budget.md)、生成器 SourceDependency/ResolvedInput/CostEstimate：requested 与 resolved 分开，fixed/current、内容 hash、resolverVersion、分项费用进入快照。待测相关来源变化拒绝执行，无关改名/重排不误报，最终 Adapter 请求与回显一致。 |
| TECH-05 / P1：连接与秘密版本 | 设计闭合 | [05 §3](../../implementation/05-architecture-and-operations.md#3-访问与数据隔离)、[07](../../implementation/07-provider-adapter.md)、[11 TX-02](../../implementation/11-transaction-and-implementation-blueprint.md#4-tx-02-一次分派与迟到证据) 固定 connectionVersionId 的服务、地区及账号身份；旧任务仅用原秘密或经验证的同账号后继；跨账号新建连接重验能力。待在指定账号证明轮换及查询恢复。 |
| TECH-06 / P1：过期租约迟到回执 | 设计闭合 | [03 submission_evidence](../../implementation/03-domain-data-model.md#6-生成执行与费用)、[11 TX-02](../../implementation/11-transaction-and-implementation-blueprint.md#4-tx-02-一次分派与迟到证据)：recordSubmissionEvidence 只追加受信证据，过期租约不丢 provider ID；当前持有者核验后推进权威状态。待测租约过期、冲突 ID、重复回执及普通回调越权。 |
| TECH-07 / P1：派生访问缺口 | 设计闭合 | [05 §4](../../implementation/05-architecture-and-operations.md#4-媒体验收与渲染)、生成器 MediaDerivative/AccessRequest/RecoverDerivative：poster/proxy 有独立状态及恢复，access 明确 original/proxy/poster；waveform 已明确后置。待测代理失败不阻断原片下载、不得静默退回 original、各变体同范围授权。 |
| TECH-08 / P1：素材检索及来源 | 设计闭合 | [03 §5](../../implementation/03-domain-data-model.md)、[05 §4](../../implementation/05-architecture-and-operations.md#4-媒体验收与渲染)、生成器 Media/MediaMetadataChange：显示名称、安全原名、标签、来源与派生元数据可读写，来源说明不等于许可认证。待测元数据更新不变字节身份，共享和包中来源字段不泄露私有血缘。 |
| TECH-09 / P1：shared 预算 | 设计闭合 | [03 reservations](../../implementation/03-domain-data-model.md#6-生成执行与费用)、[04 §5](../../implementation/04-state-execution-and-budget.md#5-预算与实际消费)、[11 TX-01/03](../../implementation/11-transaction-and-implementation-blueprint.md)：shared 仅锁工作室，项目预算为空；project 锁双层；两类并发共同占用工作室。待测混合并发不会各自穿透相同工作室额度。 |
| TECH-10 / P1：备份恢复缺口 | 设计闭合；未分配费用身份见 RTECH-02 | [05 §6](../../implementation/05-architecture-and-operations.md#6-环境发布与恢复)、[11 TX-06](../../implementation/11-transaction-and-implementation-blueprint.md#8-tx-06-归档与灾难恢复) 定义 epoch/cutoff、关闭旧出口、隔离旧 queued、完全缺失 job 的未分配消费及逐连接放行条件。待真实恢复演练，不因无 attempt 推定从未提交。 |

## 二次复核发现与收口

本节 P1 表示相关模块试点前必须修正并验收；不把已经落入设计的修订再次列为未修阻断。

### RTECH-01 · P1 · 制作副本的去重身份缺少构建版本（已在设计修正）

发现时 [03 production_copies](../../implementation/03-domain-data-model.md#L97) 为 `unique(media,profile,revision)`，而 [11 §6.3](../../implementation/11-transaction-and-implementation-blueprint.md#L79) 规定原媒体 SHA＋profile／renderer／normalization 版本决定副本。相同 profile revision 下升级 renderer 时，旧键会使新算法复用旧副本或因唯一冲突无法建立副本。

当前 03 已补 `source_sha256,renderer_version,normalization_version` 及完整唯一键，与 11 一致。最小修订已落入设计，无需新增服务或队列。验收必须证明相同完整身份复用，任一构建/归一版本改变得到独立副本与映射，旧冻结版本恢复仍读取旧副本。

### RTECH-02 · P1 · 同账号账单及未分配消费需要统一一次费用身份（已在设计修正）

发现时 [03 cost_entries](../../implementation/03-domain-data-model.md#L123) 仅 `unique(connection,provider_charge_key)`；同一账号可登记多个连接，同一 charge 经两个连接取证就会重复记账。当前已改为账号身份＋charge key，闭合这一部分。

另一个具体交错是：恢复任务在 `unallocated_provider_costs` 登记 charge X，正常核账同时在 `cost_entries` 为已找回的 job 登记 X。两表分别去重，或只在之后“分配”时转移投影，不能保证并发首次录入只计一次。 [11 §8](../../implementation/11-transaction-and-implementation-blueprint.md#L154) 已要求分配原子转移，但 DDL 在发现时还未落实两种路径共用的费用身份与串行化机制。

当前 [03 补充约束](../../implementation/03-domain-data-model.md#L200) 已建立共用 `provider_charge_identities(tenant_id,provider_account_identity,canonical_charge_key,allocation_kind,allocation_id)`；两个入口先取得同一费用身份，分配迁移保留原身份并调整投影。这落实了所需最小修订。实现仍须按统一锁序和唯一约束处理并发，不能只用事后核对修正重复消费。

验收事实：两个连接、恢复入口、普通核账入口并发重放同一实际收费，只产生一份工作室有效消费；找回 job 后原子建立归属及适用项目投影，工作室总数不再增加；调整行仍保留前后证据。

### RTECH-03 · P1 · 无 cut 素材包需要可查询、可保留的显式媒体依赖（已在设计修正）

[06 §6](../../implementation/06-api-contract.md#L102) 与生成器已允许 `sourceSelection` 直接创建 working 的 source_package，无需创建 cut、伪造时间线或启动渲染。`sourceBindings` 也改用媒体和源区间，不要求不存在的 clip。接口方向正确。

发现时 [03 deliveries](../../implementation/03-domain-data-model.md#L149) 只有 selection JSON/manifest，缺少与 `cut_draft_media` 同等明确的包输入关系。若额外音乐/字幕仅在 extraMediaIds 或 sourceBindings JSON 中，被选后打包失败再归档，清理与恢复无法靠现有显式引用表确认保留；未来恢复时也容易错误取最新可变来源说明。

当前 [03 补充约束](../../implementation/03-domain-data-model.md#L198) 已建立 `delivery_media_inputs` 及 `delivery_source_bindings`，在创建交付事务中固定原素材、额外声音/字幕、预览及对外证据媒体的关系与校验值；结合 06 的来源快照和恢复规则，依赖不再仅存 JSON。最小修订已经落实，包可以直接依赖媒体及已选 take，无须创建占位 cut。

验收事实：没有任何 cut 的项目能够从已选 take 加独立音频/字幕产生 source_package；输入归档、元数据修改、打包失败恢复后仍使用原固定字节、清单和说明；跨项目或不在固定包集合的 sourceBindings 引用被拒绝；包中不出现伪造时间线或成片实测规格。

### RTECH-04 · P1 · 精确边界与微秒回显的再次编辑接缝（已在设计修正）

发现时 [11 §6.2/6.4](../../implementation/11-transaction-and-implementation-blueprint.md#L75) 只规定“来源、range、位置都未改”才复用精确边界，而新条目严格按微秒检查空洞。24 fps 一帧的精确尾点为 41666⅔ us，回显 41667 us；在该回显位置追加新条目可能被判有 ⅓ us 空洞。48 kHz 的源样本 1 回显为 21 us，只移动放置位置却重新吸附源起点，则 `ceil(21×48000/1000000)=2`，会丢样本。

当前 11 已规定来源与放置分量分别复用，并且请求端点恰等于精确接点的 roundHalfUp 回显时，恢复为同一精确端点再检查；不是任意误差容忍。该最小修订维持整数权威时间，不增加第二套时间模型。

验收事实：24 fps 一帧后在 41667 us 追加成功，在 41668 us 的显式空洞被拒绝；只移动样本 1 开始的音频仍保留相同 sourceInSample；连续打开/保存/改增益不逐次丢帧或样本；新改的裁切分量仍遵守向内吸附。

## 跨文件与契约核查

- **费用语义：** E 包括原计划明确展示的预占余量；C 是去重后的确认累计；基础 `remaining_micros=max(E−C,0)`，额外有限控制预留 K 单列，对外 `reservationRemaining=基础 remaining+K`。非 final 达到 E 不代表未知风险为零，须阻断或按证据受控增加 K；final 在同一事务释放基础余量及适用 K。07 已统一 partial/pending/unavailable 的 K、final 释放及达到或超过 E 的阻断条件。复读确认 11:49 已明确总占用为 C＋基础 remaining＋K，即 C＋API reservationRemaining，原 P2 记号歧义已关闭。
- **事务语义：** 统一先取授权范围和连接根，再按业务/预算顺序取锁；含支出阻断的入账不能反向先锁预算后锁连接。供应商 POST 位于唯一 attempt 的持久授权界点之后且事务之外，纯数据库重试不包含外部付费调用。迟到 receipt 只追加证据，不能绕过新 lease 修改状态。
- **归一语义：** `clipId` 字段一致；video/subtitle 权威边界是 frames，audio 是 samples；有效微秒只回显。当前生成器已补视频/音频必须携带 sourceSha256、sourceMapId、productionCopyId；无需为独立音频再造 frame 边界。RenderVerification 能保留实际帧数、有效采样及呈现/容器时长，而不是拿预期值覆盖实测值。
- **素材包路径：** DeliveryInput 的 cutRevisionId 和 sourceSelection 互斥，sourceSelection 只允许 working 且 includeMedia=true；final 仍需要 cut revision 与批准。source_package manifest 的 origin=selection、externalTimelineKnown=false，禁止 cutRevisionId/timeline。SourceMediaBinding 表达媒体源区间、用途、可选对白/声音关系；应用层继续验证同范围、完整依赖与实际文件。这条路径可以与平台剪辑独立实现。

只读执行生成器 AST 到第一次文件写入之前，得到 **111 个 operations、156 个 schemas、1,462 个可解析的本地 $ref**。未重新生成或覆盖 OpenAPI/操作目录。核查时生成器 SHA-256 为 `cc71c4b3fee2192d6ee63d5ea58304bf85fac11f8513a460a20a5d40c9f41419`；主任务后续修改会产生新摘要。系统 Python 未提供 jsonschema，因此本复核没有声称结构正反样例通过；类型条件的存在仅经源代码检查。

## 可以保留的边界与待运行验收

保留模块化单体、一个 PostgreSQL 任务系统、受控运营命令及私有对象存储。归一记录、制作副本、费用证据身份和交付依赖是在现有边界内补齐事实，不要求引入第二队列、第二在线账本或微服务。通用编辑模块不依赖短剧镜头 ID，短剧关系置于独立 bindings；广告底层复用方向未被本轮修订破坏。普通媒体元数据修改、候选采用和固定剪辑更新仍是不同动作。

以下必须作为真实实施/试点门槛，不能由本报告关闭：

1. 用真实 PostgreSQL 迁移、复合 FK/RLS 和事务屏障验证预算并发、同主体审阅、撤权/分派、账单跨入口去重；Mock 或 JSON Schema 无法证明这些交错。
2. 用固定 FFmpeg/编码/字体构建实际制作并完整解码 30000/1001、VFR、非零 PTS、音轨偏移、字幕与重复编辑夹具；记录源映射、N 帧、A(N) 有效样本和容器时长。本文没有声称已得到一帧内的实际音画精度。
3. 在最终选定的 Seedance 服务、地区和真实账号核验权限、可用能力、秘密轮换、查询/回执恢复、价格计量及账单完整性。模型品牌与静态官方资料不能证明具体账号可用，也不能保证自动 final。
4. 演练 T0 有 queued、T1 已提交后恢复 T0，以及 T1 才创建并收费但 DB 完全缺失的任务；证明旧任务不重复 POST、未分配费用不消失或重复、未知敞口不被伪装为零。RPO/RTO 仍是待测目标。
5. 在真实浏览器与存储权限下验证 original/proxy/poster、派生恢复、素材包 ZIP 及来源字段隔离；使用工作室实际短剧素材验证交接完整性。画布 UX-01 和真人生产质量判断仍按后续计划验证，静态技术复核不代替这些判断。

文件链接已检查 29 处，均能定位到实际文件；链接可用不表示行为已验收。

本次未使用新的外部功能或价格断言；判定依据是当前设计及生成器。原始官方证据仍由主设计研究文件承载。本报告不声明实现已存在、测试已通过或生产能力已核验。

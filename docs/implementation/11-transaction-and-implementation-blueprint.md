# 11 关键事务与实施蓝图

本页把多个模块共同承担的操作写成实施步骤，避免开发者仅凭表名或 HTTP 类型补齐事务语义。生产业务迁移和应用实现尚未执行；S0 迁移运行器与基础演示的执行记录见 15，下述顺序与验证是实施要求。

## 1. 迁移分组与基础约束

| 迁移组 | 先建立 | 后建立／关键约束 |
|---|---|---|
| M01 身份与范围 | users、sessions、oidc_handshakes、tenants、memberships | owner 唯一；auth issuer＋subject 唯一；会话／OIDC state 的哈希、期限与撤销；迁移角色与运行角色分离 |
| M02 项目与制作 | projects、project_memberships、productions、project_content_versions | 集／场次／镜头及不可变要求修订；新增提案目标、建议修订、正式创作确认快照；同租户同项目复合 FK；一项目一负责人 |
| M03 媒体与资产 | upload_intents、media、asset roots/revisions | 来源／检索元数据；延后添加互相依赖的来源 FK；共享映射、造型依赖、poster／proxy、内部制作副本及源映射、显式引用索引 |
| M04 执行与费用 | provider connections/versions、capabilities、plans、jobs、attempts | 连接账号／秘密版本关系、追加回执证据；预算账户、预占、费用条目及完整性证据、outbox；plan→job、job→reservation 唯一 |
| M05 编辑与交付 | takes、selections、cuts、normalization records、cut_work_drafts及恢复历史、cut revisions/items | 归一请求／结果和确认；冻结媒体与源映射依赖、固定 renderer/profile、render tasks、review subject 锁及轮次、deliveries |
| M06 读模型与通知 | project event cursor/events、audit、production tasks | 队列schema在M03前按受限角色建立，不再自建worker_tasks；事件保留与索引、每场主责任务；调度仅取得最小标识 |

在 M03–M05 完成后补齐 media→generation／render／shared origin 的来源约束，不能因为创建先后困难永久省略外键。schema migration、RLS 策略和真实数据库集成测试共同评审；Mock repository 不能证明隔离与并发成立。

## 2. 事务执行约定

身份授权从服务端会话和成员关系取得。任何锁、查询或写入都携带可信 tenant/project 范围；客户端 JSON 的 tenantId 不构成授权。纯数据库事务发生死锁或序列化冲突时可以有限重试，闭包中不得包含模型提交、外部下载或邮件发送。

涉及权限撤销与生成分派时，以持久化 dispatching／attempt 的提交作为执行授权的线性化时点：在该时点之前撤权的 queued 作业不再提交；在该时点已取得执行许可的作业可能发出请求，撤权不承诺取消已经开始的外部操作。dispatch 后每项费用仍归原租户和预算。

统一适用锁偏序为：授权／项目变更记录→connection 根→供应商账号配额（如需）→内容根／scene／审阅 subject→canvas 根→shot 根→工作室预算→项目预算→plan／job／reservation；仅取得该操作实际需要的层，同类多个对象按稳定 ID 排序。画布 prepare 和 execute 均先 connection 后 canvas，不能反向获取；execute 在同一事务固定输入核查、消费计划及预占，提交之后的画布修改不影响已固定 job。费用到达可能阻断连接时仍先 connection 后预算；异步结果不直接修改 canvas，用户取回结果采用 canvas→job 顺序。详细跨模块规则见[18](18-canvas-workspace-contract.md)。网络调用在事务外。跨范围共享发布先完成授权和依赖清单，再在短事务写固定映射，不持锁下载整个文件。

## 3. TX-01 提交计划与预算

1. 验证会话、scope、计划和其明确输入；检查不可变源 ID 与当前有效策略，不将未读到的最新值自动填入。
2. 查找 actor＋非空 scope_key＋operation＋规范化路径＋Idempotency-Key；同键异请求拒绝，原业务已完成则在重新授权后回放。
3. 按第 2 节先锁适用 connection 根；画布来源计划先锁来源 canvas 核查相关输入指纹，再锁工作室账户、适用项目账户和计划。检查计划有效期、未消费、币种、connectionVersionId／能力修订、实际来源版本、执行 epoch 和连接支出阻断。布局改变不使计划失效，提示／启用参考／输入次序等改变则拒绝消费。project 作业同时受工作室与项目账户约束，shared 作业只查工作室，不能借用虚假项目预算。通过唯一 plan_id 再次保护缓存期限以外的重复请求。
4. 在一个事务中建立固定 connectionVersionId 的 job、reservation、预算占用、消费计划标记、同一连接事务内队列命令、事件outbox和幂等结果。原预占估计包含已展示余量；初始 confirmedCost=0 表示尚无已确认条目，costStatus=pending，finalCost 仍未知，reservationRemaining 等于原预占金额。部分结算后的余额按 TX-03 更新，不把原估计与实际消费重复相加。
5. 提交事务后返回 job。没有提交的事务不允许供应商 Worker 看见待执行任务。

## 4. TX-02 一次分派与迟到证据

Worker 先完成不计费的输入准备，再在短事务重查成员／项目／连接、预算预占与执行 epoch，按固定账号额度锁占用inflight claim，再记录唯一自动attempt、已staging请求摘要、connectionVersionId、秘密版本与 dispatching，之后只发出一次外部创建请求。创建 SDK、HTTP 层和代理均关闭隐式重试；若供应商上传本身计费，不能放入隐式准备步骤，必须另有明确费用计划。连接版本固定服务、地区和 providerAccountIdentity，同账号秘密后继关系另有核验证据；跨账号凭据需新连接，不能重解释旧 attempt。

租约只控制谁可以推进内部状态，不提供供应商 exactly-once。内部 `recordSubmissionEvidence(attemptId, receipt)` 按 attempt、受信来源与摘要幂等追加证据，保存真实接收时间，不要求提交者仍持当前 lease；入口不提供 status／金额任意写入。旧 Worker 收到迟到 ID 可走此入口，不能直接覆盖现持有者 job 状态。当前持有者或核对任务在事务中验证 receipt 与固定连接版本／请求的关联，检查 provider ID 的唯一绑定，再按当前状态恢复查询。同一 attempt 出现冲突 ID 时进入 reconciliation_required；重复证据不重复关联、消费或提交。普通用户与未验证回调不能调用可信证据入口。

## 5. TX-03 费用证据与结清

费用条目是已确认消费的追加记录；“全部费用已结清”的证据是另一事实。作业执行完成、第一笔账单到达、取消或归档失败均不能单独证明费用终局。

设原预占估计为 `E`，已去重费用与调整的有效累计为 `C=confirmedCost`，单列控制预留为 `K`。下表的基础 remaining 对应 DB remaining_micros；API reservationRemaining 是基础 remaining＋K。先锁可能更新支出阻断的 connection 根，再按工作室账户→适用项目账户→job/reservation 取锁，在同一事务追加费用条目、更新 C、costStatus、reservationRemaining、预算投影和审计。消费 key 绑定固定供应商账号身份，不能因同账号秘密轮换重复记账。

| 状态／条件 | reservationRemaining 与动作 |
|---|---|
| pending，尚无可靠费用 | 基础 remaining=E，对外 reservationRemaining=E+K；没有实际消费证据时不生成一条伪 0 元消费 |
| partial | 基础 remaining=max(E−C,0)；对外剩余预占另加单列控制预留；已确认消费只计 C，工作室／项目总占用为 C＋基础remaining＋K，即 C＋API reservationRemaining |
| unavailable | 保留此前 C；基础 remaining=max(E−C,0)，对外另加 K；没有自动取证路径不代表免费 |
| final | 完整性证据与 job／连接版本／覆盖范围匹配后，remaining=0；追加结清证据，释放余量 |
| C>=E 且非 final | 基础 remaining=0 仅表示原预占耗尽；对外仍加 K；同事务阻断该连接新提交，保留未知敞口原因 |

原预占耗尽且仍未决时，受控运营命令可在授权预算内明确增加有限控制预留，记录金额、作用范围、依据和负责人；该预留另列，不重写 E 或假称未知风险消失。无法界定的敞口不得通过填 0 放行。所有控制预留同样减少相关层级可用额度；project 作业工作室／项目双层，shared 仅工作室。可信 final 证据使相关控制预留结束时也必须在同一结清事务释放。

确认 3 元→重复 3 元→确认另 5 元时，C 分别为 3／3／8，E=8 时 remaining 为 5／5／0；最后一笔若仍 partial，状态仍未结清。final=0 必须有确定无消费证据。退款和修正使用追加调整行；证据推翻原 final 时重新标记未决并启动相应阻断。晚到旧 partial 观察不自动回滚一个仍有效的完整性证据，但其新增可信费用必须核查是否推翻该证据。终局性详细定义见 [04](04-state-execution-and-budget.md) 与 [07](07-provider-adapter.md)。

## 6. TX-04 采用、规范化草稿与冻结

采用只更新 shot 当前选择及采用历史；新媒体、候选或采用均不直接修改时间线。`createCut` 可以建立空草稿，其内容不能直接冻结。所有可渲染内容必须经过下面唯一的 `normalization-v1` 算法，再明确保存；渲染器没有第二套边界修正规则。

### 6.1 异步规范化与确认协议

1. `normalizeCutDraft`接收`NormalizationInput {cutId,baseCutRevision,workDraftRevision}`，从已保存工作稿固定内容，不再附另一份timeline。服务端查 scope／权限／来源，验证输入结构并在短事务保存请求快照、workDraftSource、规范化requestHash、基线、固定renderProfile／rendererVersion／normalizationVersion 和来源校验值，返回 processing 记录。昂贵探测／制作副本处理复用事务入队的内部媒体任务，不在事务中转码。
2. NormalizationResult 的 status 为 processing／ready／failed；ready 固定 `id,cutId,baseCutRevision,requestHash,effectiveTimeline,dramaBindings,lengthFrames,durationUs,normalizedItems,changes,renderProfile,rendererVersion,normalizationVersion`。失败携带可解释原因；不保存半份可执行时间线。`changes` 的 ID 对该结果稳定，列出源裁切、视频累计时序、帧率转换和必要采样修正等可见变化；每项有变更前后值。
3. `saveCutDraft` 只接收 `normalizationId`、`acknowledgedChangeIds` 及 Cut 的 If-Match。事务中检查结果 ready、归属、结果baseCutRevision等于当前If-Match，workDraftSource仍匹配当前工作稿revision/hash、所有 requiresAcknowledgement=true 的变化均已确认、来源依赖仍可用／有权；客户端不再提交 timeline，requestHash 绑定的是服务器已保存请求。复制该结果的有效内容和显式依赖到草稿，递增 Cut.revision，记录保存后的revision与confirmed normalization绑定，并同事务更新工作稿内容与基线、递增其独立revision。未知 change ID 或遗漏必需确认项拒绝；基线冲突保留归一结果供查看，但不能静默重算覆盖。
4. `previewCutReplacement` 先验证Cut／workDraftRevision及工作稿内原片段身份，按显式 `keep_duration / change_duration` 以及每项受影响声音／字幕的 keep／move／replace／remove 决定构造请求，再返回同一种 NormalizationResult；它本身不保存草稿。keep_duration 要求新素材至少提供原输出帧数，裁切到明确区间；不足即拒绝，不拉伸／循环。change_duration 的视频后续顺序会随新长度变化，每项声音／字幕决定须有明确结果，不能把未答复当作 move。

### 6.2 唯一时基、整数运算与回显

输出帧率记为约分后的 `F=P/Q`，采样率 `S=48000`。`P,Q,S` 都是整数，仅接受固定 profile 声明并已测的规格；UI 的 29.97 选项传 `P=30000,Q=1001`，不可传浮点数当 time base。第 n 个输出帧边界的精确时间为 `T(n)=nQ/P` 秒。所有乘除使用有理数／BigInt，不能经 JS Number 浮点累计。以 `ceilDiv(a,b)`、`floorDiv(a,b)` 和非负数四舍五入 `roundHalfUp(a/b)=floor((2a+b)/(2b))` 实现边界，恰好半单位取较大整数。

帧边界对应的输出采样边界是 `A(n)=roundHalfUp(nQS/P)`。因此总帧数 N 的目标呈现长度为 `NQ/P` 秒，目标音频样本数为 `A(N)`。`durationUs=roundHalfUp(NQ×1,000,000/P)` 仅为响应回显，校验使用精确有理数。微秒不是另一套权威值。

`effectiveTimeline` 的微秒值由精确边界派生，`normalizedItems` 的 frame／sample 整数及固定源映射才是渲染、定位和依赖事实。下一次normalize时，优先按工作稿timingOrigins中同Cut的已确认来源逐分量复用；没有独立来源时再检查baseCutRevision中相同clipId、来源、range 和显式位置均未改动的条目，复用其精确源／采样边界，不从已回显的取整微秒再次推算；输出帧率或归一版本变化则显式重算并列变化。源坐标与放置坐标分别判断是否改变：仅移动片段复用旧精确源区间，仅改裁切时保持未改的精确放置依据；改变任一分量不能迫使其他分量从回显微秒再次吸附。新建／确实修改的分量按下述算法计算。客户端仅改变文字／增益也不能使原片段逐次丢一帧。

### 6.3 源媒体零点与受控制作副本

原始媒体保持不变。首次需要某个目标帧率／制作 profile 时，AssetMedia 建立内部不可变 production copy 和 source map；去重依据为原媒体 SHA-256＋制作 profile／renderer／normalization 版本。副本不公开为新的 access variant，不使用低清 proxy；引用中的媒体身份仍是 sourceMediaId，复制体和映射通过显式依赖固定。

- 视频的逻辑源零点 `t0` 为第一张有效解码视频帧的 presentation timestamp；每帧保留原 stream time base、原 PTS、`PTS×timeBase−t0` 与显示区间，按 presentation order 排列。音频使用同一个 t0，保留相对起始偏移。独立音频以第一份有效解码音频样本的时间为零点。已有源时长和用户 range 都以该逻辑零点表示，不能把文件原始非零 PTS 直接当作用户秒数。
- 视频有效末端 `D` 取末帧的可验证显示结束时刻减 t0；中间帧结束由下一帧 PTS 决定，末帧须有可解释的持续时间／探测依据。时间戳缺失、重复导致歧义、回跳或末端无法解释时，制作副本失败并要求修正／外部转换，不用平均 fps 猜边界。VFR 的合法长帧不等于缺帧。
- 生成 `Nsrc=floor(DP/Q)` 帧的 CFR 制作副本；输出第 k 帧（`0≤k<Nsrc`）采样时刻为 `kQ/P`，选择包含该时刻的原源帧显示区间；等于新帧起点时选新帧。同一 VFR 帧可以映射至多个输出帧，也可以因转换被跳过。保存每帧 k→原 PTS／stream time base 的映射，末尾不足一目标帧的残段不擅自补满。所有转换均由 changes 说明，不用供应商段落描述猜切点。
- 音频制作副本固定 48 kHz 双声道 PCM、固定重采样构建／参数；单声道复制至左右，双声道保留，多于两声道首版拒绝并要求显式外部转换。按源视频 t0 保留音频偏移：负偏移部分明确裁掉，正偏移按 roundHalfUp(offset×S) 补起始静音；音频内部合法间隙按固定采样位置补静音，无法解释的重叠／不连续时间戳拒绝。映射保存原始音轨 time base、PTS／区间、零点、采样转换与补静音区间；不丢失已知音画偏移。

上述采样选择是本平台的确定规则，不能只依赖 FFmpeg 的未声明默认选帧。实现需锁定构建并用探测结果／信号夹具证明实际副本满足映射；这段设计没有宣称 FFmpeg 已经按这些参数实测通过。

### 6.4 视频区间、顺序和帧边界

时间线必须恰有一个非空主视频轨，速度固定 1。请求主轨按 `(timelineStartUs,clipId)` 确定顺序，重复 start／重叠或显式空洞先拒绝；从已保存归一结果修改而来的未改条目使用已有精确边界检查，不用展示微秒重新计算空洞。相邻新条目的 startUs 若恰等于前项精确 end 的 roundHalfUp 微秒回显值，则先恢复为该精确接点再判空洞／重叠；其他值按实际请求处理。该规则也用于改动后显式相接的端点，不能扩大成任意误差容忍；例如 24fps 一帧后在 41667us 追加合法，41668us 的显式空洞须修正。

新建／改变的源区间 `[inUs,outUs)` 在授权媒体及绑定候选允许范围内，向内吸附为：`sourceInFrame=ceil(inUs×P/(1,000,000Q))`，`sourceOutFrame=floor(outUs×P/(1,000,000Q))`。要求 `0≤sourceInFrame<sourceOutFrame≤Nsrc`，不足一帧直接拒绝。向内吸附不会选到请求或候选范围外；每个边界改变小于一目标帧，并在 changes 中回显，不用补帧补足请求时长。

第一个片段 `timelineStartFrame=0`；随后逐个累加 `len=sourceOutFrame−sourceInFrame`，`timelineEndFrame=timelineStartFrame+len`。后一个片段从前一片段 end 开始，最终 N 为 `lengthFrames`。因源区间吸附造成的后续视频位置变化全部列入 changes；确认前不保存。仅主视频顺序如此归一；音频和字幕不因为视频长度变化而自动移动。

每个视频 NormalizedItem 固定 `clipId,kind=video,sourceMediaId,sourceSha256,productionCopyId,sourceMapId,sourceInFrame,sourceOutFrame,timelineStartFrame,timelineEndFrame`。sourceMap 固定原始 PTS／零点映射和自身校验值；该记录不可被更新成另一份映射。take／selection 等短剧关系使用独立 dramaBindings 校验，公共规范化模块不要求广告输入镜头 ID。

### 6.5 音频与字幕边界

**原生音频。** 视频片段的源音频使用 `[A(sourceInFrame),A(sourceOutFrame))`，放在 `[A(timelineStartFrame),A(timelineEndFrame))`。源音频不足的部分用已记录的静音补足；没有音轨的片段也明确静音。两段采样数因取整相位最多相差一个样本：只在段尾裁掉或补一个静音样本，保存 `tailAdjustmentSamples`（−1／0／1）；超过一个样本是实现／来源错误，应拒绝。muted 和 gainDb 在固定样本位置执行。

**独立音轨。** 源区间向内取 `sourceInSample=ceil(inUs×S/1,000,000)`、`sourceOutSample=floor(outUs×S/1,000,000)`，源时长内且至少一个样本。显式放置位置 `timelineStartSample=roundHalfUp(timelineStartUs×S/1,000,000)`，end=start＋源样本数。NormalizedItem 固定 clipId、kind=audio、sourceMediaId／校验值、productionCopyId／sourceMapId 与这些 sample 边界。end 必须≤A(N)，超界就拒绝；归一过程不擅自截短音乐或延长画面。混音到固定 A(N) 样本缓冲；空白是静音，统一 profile 增益／限幅规则，避免因工具默认混音归一使音量意外变化。

**字幕。** 新建／修改字幕起止分别以 roundHalfUp 将显式起点和起点＋duration 映射到输出帧边界，保存 `timelineStartFrame/timelineEndFrame`，至少一帧。要求 `0≤start<end≤N` 且同字幕轨不重叠，否则拒绝，不向片尾强制夹紧。字幕位置同样保持用户显式时间；归一造成的变化需要确认。SRT 从帧边界按 roundHalfUp(T(n)×1000) 导出毫秒，相同边界只转换一次；已静音字幕轨不输出。烧录与 SRT 都来自同一帧区间，不分别从原始微秒算一遍。

### 6.6 冻结、渲染与实际验收

freeze在同一事务锁Cut→工作稿、检查Cut If-Match与expectedWorkDraftRevision、未应用工作及显式排除决定、已保存的 confirmed normalization 与当前草稿绑定、全部来源／权限，固定 effectiveTimeline、normalizedItems、dramaBindings、lengthFrames、renderProfile、rendererVersion、normalizationVersion 和媒体／制作副本／源映射依赖，创建唯一render task、队列命令及事件outbox。冻结时复验保存事实，不再运行新的吸附或取最新 profile。原归一结果已确认且依赖仍有效时，不因别的用户调整项目默认规格就暗改它。

Worker 按精确 frame／sample 边界从固定制作副本渲染，输出 N 帧和目标 A(N) 个有效音频样本。完整解码验收记录实际 frameCount、有效 decodedAudioSamples、各轨起止 PTS、容器 durationUs 与呈现 durationUs；AAC priming／尾部编码填充须依据所锁构建的实际容器／解码行为排除后计算有效采样数，不能直接把压缩包数量当实际音频长度。全片可解码、N 正确、源定位／声音／字幕与已确认边界误差不超一个输出帧后，才将媒体和 cut revision 标为 ready。偏差或无法解释的额外尾部进入 render_failed，不能修正冻结边界来迁就输出。

输出实际验收参数永久保存；预期的 durationUs 不覆盖原探测值。恢复必须使用冻结的构建和 profile；旧构建缺失时明确失败，使用新版本须重新 normalize／确认／freeze。外部成片按自己的验收媒体进入独立版本，normalizedItems 不伪造。

### 6.7 待运行的确定性验收

| 夹具／交错 | 必须观察的事实 |
|---|---|
| 30000/1001 fps、源区间 100000–1100000 us | 新区间向内映射到 source frame 3–32，共 29 帧；有效长度 29×1001/30000 秒；界面先显示两端变化，再允许保存 |
| 数百次非整帧裁切／重开草稿 | 未改变条目复用精确边界；没有微秒回显再次吸附造成的逐次丢帧；SRT 与成片使用相同全局 frame boundaries |
| VFR／首个视频 PTS 非零、原音轨有正／负偏移 | 制作副本每帧都能追到原 PTS，已知声画偏移被保留；平均 fps 不用于猜源位置 |
| 46 秒主视频、60 秒外加音乐，或片尾越界字幕 | normalize 失败并指出越界；只有用户明确裁切／调整后才可 ready，不自动截短或补画面 |
| normalize 基线 r 后另一人保存 r+1 | 旧 normalizationId 不能越过 If-Match 保存；本地／归一结果可保留查看，不覆盖对方稿 |
| replace 选 keep_duration 但新源不足 | 整体拒绝，无重复帧／拉伸；change_duration 必须明确每项受影响声音／字幕政策 |
| 原片 ready、proxy failed | 原片仍可下载，预览明确失败；派生恢复不变更 sourceMap、原字节或 cut 的有效边界 |
| 冻结后构建升级／崩溃恢复 | 使用原构建恢复相同快照；新构建要新确认与版本，旧 ready 结果不被覆盖 |

这些用例补充 AT-21–25 与相关 API 验收，当前均待执行，不能由生成器静态通过推断通过。

## 7. TX-05 审阅与最终交付

创建新审阅轮次、写正式决定、创建 final delivery 必须取得同一 subject（cut revision 或 take）互斥锁，避免分别锁 review 行却让“新轮次已开启”和“旧批准被用于新交付”同时通过。

在锁内分配单调轮次／检查最多一个 open。创建 final 时读取最新一轮且 approved，并将该批准、输出版本与清单输入固定到 delivery。事务顺序决定结果：先创建的新轮次会阻断旧批准；先合法创建的交付保留当时依据，不被之后新轮次倒改。

锁的键取固定 subject 身份，不取当前 review.id；创建轮次、决定和 final 的锁顺序一致。decideReview 在取锁后再校验角色、review 仍 open 及 subject readiness。final 只允许匹配的整集／外部成片范围，锁内再次取最新轮次，不复用锁外的 approved 读结果。受限范围错误不回显私有 subject。待运行测试用事务屏障覆盖“final 先锁／新轮次先锁”两种次序；已有交付恢复按其创建时固定证据，不重新选最新批准。

## 8. TX-06 归档与灾难恢复

媒体归档仅阻止新增的业务引用。已经被草稿、固定版本或交付输入引用的内容，在相同授权范围继续允许保存不变的引用及按原版本打包。更新请求应比较新旧引用集合，对新增项执行 active/ready 校验，对原有项检查原授权和依赖仍存在，不能因素材被归档锁死整个剪辑。

恢复备份先停止旧 Worker 和所有供应商创建出口，再记录 `recovery_epoch`、`cutoff`（数据库实际恢复点）、外部创建已停止的时点和受影响连接版本。恢复者建立持久 quarantine 清单和处理状态；它是运行恢复记录，不是第二队列。所有可能在 cutoff 后被分派过的恢复库非终态任务均在集合内，包括备份前已创建但备份时仍 queued 的作业。执行终态但费用非 final 的条目加入财务核对集合。普通调度不得自行把这些 job 换成新 epoch。

受限恢复命令的结果只有以下有证据的分类：

| 证据／对象 | 处理与放行 |
|---|---|
| 找回原 providerJobId 与明确对应关系 | 固定原连接版本，恢复查询／归档；不再次提交 |
| 有可靠依据证明从未提交 | 保存依据、重查原计划可执行性／权限／预算后，由受限命令赋予新 epoch 的执行资格；过期／源已变则取消旧意图，由用户另建计划 |
| 无法排除曾提交 | reconciliation_required，保留 remaining 与控制预留；不得自动提交 |
| 对象存储有文件而 DB 无对应记录 | 隔离对象，按现存依赖及可恢复来源核对后再登记，未核清不清理 |
| 供应商确认收费而 DB 中 job 完全缺失 | 登记 unallocated costs，按固定账号身份／charge key 去重，先计入工作室已确认消费，不虚构项目归属或 job |
| 金额／对应关系均未知 | 单独记录未知敞口与原因；相关连接保持阻断，无法界定金额不能填 0 |

未分配费用之后找到真实 job 时，在同一预算事务中建立关联、重建适用 job 消费／预占投影并撤销未分配投影；费用条目身份保持唯一，工作室总消费不能再加一次。已确定项目时补足项目预算投影并记录恢复依据。未知项目不借用操作者当前项目。独立审计／账单导出作为恢复证据材料保存校验值与权限，不另建在线账务事实源。

逐连接放行新任务必须同时满足：旧进程／出口已被隔离、新 Worker 与 attempt 检查 epoch、quarantine 项均有持久分类、所有已确认费用（含未分配）进入工作室投影且账本核平、保留预占／有限控制预留足以覆盖已明确界定的未决敞口、原连接身份和秘密关系有效。仍未知且不可界定的敞口禁止放行；关闭旧任务等待状态不等于核清费用。新任务放行不会解除旧任务 quarantine。恢复记录同时报告数据库记录损失、媒体完整性、外部任务未决、金额未决及实际耗时。

历史读取、已授权导入和已知依赖的内部媒体工作可先恢复；清理必须等引用与孤立对象复核。待运行 AT-32 包含：T0 备份有 queued J→T1 供应商接受 J→恢复 T0；T1 才新建且已收费而恢复库完全没有的 K；确实未提交的 L；恢复期间迟到回执。预期 J 不重 POST，K 费用不消失或重复计入，L 只有明确证据和再校验后可重新取得执行资格，迟到回执继续按 TX-02 追加。完整操作顺序见 [05 恢复 runbook](05-architecture-and-operations.md#6-环境发布与恢复)，所有恢复结论仍须真实演练验证。

## 2026-09-09 场次主场景补充

[14 收口基线](14-scene-mvp-closure.md) 规定当前场次提案、持久提示与返工建议、正式创作依据和场次主责的字段及事务。它们已进入同版 OpenAPI，属于本期范围。新结果仍不自动采用／更新剪辑，确认创作依据与审片通过分别记录；历史费用、版本及来源规则不变。

## M07 与 TX-07 场次画布

M07 接续 M01–M06，包含通用画布、不可变修订／节点索引、媒体引用、计划来源与结果节点唯一映射，以及短剧每场唯一 link、镜头绑定和个人视图偏好。表约束与写事务见[18](18-canvas-workspace-contract.md)。TX-07 包含 ensure唯一创建、全量文档CAS、候选创建与绑定原子提交、prepare输入快照、execute指纹检查与消费、materialize幂等取回。所有路径遵守本文第2节锁偏序；不通过删除外键、使用最后写覆盖或复用任务幂等缓存代替永久唯一约束。

## TX-08 工作稿、历史与队列责任收尾

[21](21-technical-baseline-closure.md)规定完整事务：saveWork按Cut→工作稿保存未完成编辑；normalize固定已保存工作稿及精确基线；applyNormalized锁同一对对象，检查Cut及工作稿来源后原子更新；freeze确认未应用工作是否显式排除。历史清理及新增引用在同一对象锁下核查，不删除仍被当前、前一版、归一或固定稿引用的内容。

初次业务创建、状态推进和下一步入队在同一事务，队列ack在事务后；重投只推进匹配的业务step revision。账号配额锁顺序为connection→账号配额→适用内容／预算／job；释放同样遵守，不从job反向取配额锁。候选最小权限、恢复和进程中断验收仍待执行。

### 项目画布事务扩展（2026-09-16）

独立 Web 的项目画布沿用 TX-07：在当前项目权限内锁定 Project 后确保唯一 `project_canvas_links`，首次创建的 Canvas、第一修订与 outbox 同事务提交。创建前与幂等缓存回放前均核对项目仍可编辑。项目/场次 link 以 Canvas 行锁串行校验互斥归属；固定生成与助手输入保留各自来源作用域。私人项目偏好按用户/项目锁及其独立 revision CAS 保存，可写入已归档项目的浏览位置，不能修改 Canvas 业务事实。详见 [71](71-project-canvas-workspace.md)。

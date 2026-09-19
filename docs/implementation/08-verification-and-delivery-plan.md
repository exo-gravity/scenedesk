# 08 验收、实施分解与交付门槛

当前状态：以下为完整 MVP 待执行用例和阶段计划；S0 的有限工程检查单独记录于 15，不能升级为这些业务用例已通过。真实模型样片及用户试点未运行。静态文档／契约检查以最新独立输出报告为准，validation-report.md保留旧快照，不与本表混算。实施顺序以本节阶段门为准，首轮评审问题和裁决见 ../reviews/2026-09-07/decision-log.md。

## 1. 验收的三个层次

1. 契约与业务：输入、权限、版本、预算和状态一致；可用模拟供应商构造确定结果。
2. 真实制作：指定账号生成，真实文件完成编辑、审阅、返工与交付；供应商接入和音画质量必须在此验证。
3. 用户价值：目标工作室用现有工作方式与工作台完成可比任务，记录质量、人工、费用、周期和出错；不能由研发测试代替。

最小制作夹具见 [10](10-production-fixture.md)。F2 的三类返工覆盖同长改词、变长替换及同镜不连续区间。可先用导入素材完成首条切片；完整MVP必须包含场次画布AT-52–63，不能把首条切片当完整验收。

## 2. 必须通过的行为用例

每项记录环境、版本、输入、实际结果及证据，当前全部为待执行。DB 表示需要真实数据库集成；Media 表示真实媒体管线；Provider 表示所选服务与账号；Pilot 表示目标用户任务观察。

| ID | Given／When | Then：验收事实 | 层次 |
|---|---|---|---|
| AT-01 | 两租户有同名项目，用户改路径／正文／关联 ID 读取或写入对方对象 | 全部拒绝；列表、使用位置、SSE、签名 URL 不泄露内容 | DB |
| AT-02 | 两个请求复用连接池连接，分别使用不同租户上下文 | 不串租户；实际运行 DB 角色无 owner/BYPASSRLS 权限 | DB |
| AT-03 | 邀请被撤销、过期、重复接受或由不匹配邮箱接受 | 无新增错误成员；有效重复接受不重复建成员；Owner 必须保持唯一 | DB |
| AT-04 | 协作者试图改预算、任免管理员、批审片；任务被分给未加入项目者 | 拒绝；任务不扩大权限；交接负责人后才允许移除旧负责人 | DB |
| AT-05 | 提案采纳与并发内容修改 | 内容根及提案修订 CAS、new_structure 父子依赖或 append_to_scene 明确目标、只新增与回滚正确 | DB＋UI |
| AT-06 | 角色同时有日常服与晚礼服，修改晚礼服后查看旧计划 | 两种造型身份不变；旧计划仍引用旧版晚礼服，不变成日常服或最新版 | DB＋UI |
| AT-07 | 私有角色发布共享，未加入来源项目者引入 | 可用指定共享版本与媒体；无法读取源剧本、源候选或私有 ID；升级不自动替换旧引用 | DB |
| AT-08 | 上传已验收后继续用原 URL 覆盖 staging；或发送伪扩展名、超量文件 | ready 媒体字节和 SHA-256 不变；非法上传拒绝；无存储路径穿越 | Media |
| AT-09 | 下载跳转到内网／元数据地址，或媒体处理器遇到异常文件 | 下载拒绝；处理有资源上限，不可访问网络或执行注入命令 | Media |
| AT-10 | 计划包含模式不支持的声音／尾帧，或能力版本改变后提交 | 显示具体阻断／冲突，无静默丢弃，无供应商付费请求 | DB＋Adapter |
| AT-11 | 双击执行、响应丢失后同键重发、换键执行同一 plan | 最多一个 job、一份预占、一次自动 submit；同键不同正文拒绝 | DB＋Adapter |
| AT-12 | 同层预算 80 元，20 个请求各预占 8 元并发提交，无费用结算 | 恰有最多 10 个提交通过；spent／reserved 不重复；被拒绝请求无 provider submit | DB |
| AT-13 | provider 接受后回执丢失或在 lease 过期后才到达，重启 Worker | 只有一次 POST；未知不重发；过期持有者可追加回执但不改 job，当前恢复者可继续查询 | DB＋Adapter，随后 Provider |
| AT-14 | SDK／HTTP 层收到 429／500／网络中断 | 创建端无隐式重试；GET 可退避；日志可证明实际 POST 次数 | Adapter＋Provider |
| AT-15 | running 回调重复且晚到，成功回调无可核验签名 | 不回滚终态；未认证回调不能写媒体／费用；可信查询后更新 | DB＋Adapter |
| AT-16 | queued 取消、dispatching 取消，以及取消后成功返回 | 明确未提交才释放；已生成内容可归档；未知费用保持预占 | DB＋Adapter，随后 Provider |
| AT-17 | provider 成功但下载失败／URL 过期，用户点恢复 | 仅重新查询／归档；不能再次生成；不能恢复则清楚保留不可用原因与实际费用 | Media＋Provider |
| AT-18 | 预占8，费用3→重复3→最终累计8；最终6/10、先终局后明细、退款与账单未知 | 部分时C=3/R=5；最终只补差额；无提前释放或累计重复，预占耗尽仍未决阻断；调整有证据 | DB |
| AT-19 | 跨周期、同账号密钥轮换、误换其他账号、成员离职或项目归档 | job固定连接身份版本和预算周期；跨账号不继承能力；分派界点前撤权不提交，界点后继续核账 | DB＋Provider |
| AT-20 | 单媒体映射两个镜头的不同区间，归档通知重复 | 候选范围合法且不重复；不猜切点；采用各自独立 | DB＋UI |
| AT-21 | 新候选生成或替换当前采用后打开多个剪辑和旧审稿 | 新结果不自动采用；采用不自动改剪辑；仅明确选择并保存的草稿改变 | DB＋UI |
| AT-22 | 两人同时改同一剪辑；其中一人冻结 | 工作稿CAS独立；应用及冻结检查Cut和工作稿版本；另一人本地编辑保留，未应用工作不能静默被排除 | DB＋UI |
| AT-23 | 非整帧区间、30000/1001、VFR、非零PTS、原生音轨和越界音频字幕 | 规范化预览与冻结frame/sample映射一致；主视频定长；越界明确拒绝；真实输出/SRT/评论定位正确 | Media |
| AT-24 | 冻结后渲染崩溃，再升级软件并重试 | 冻结输入不变；相同 profile 可恢复；已 ready 文件不被覆盖；无模型调用 | Media＋DB |
| AT-25 | take 源范围 10–16 秒，对局部第 2 秒评论；在整集相应片段评论 | 单镜头定位源第 12 秒；整集按实际 cut item 映射；未知外部映射不伪造 | UI＋Media |
| AT-26 | 用事务屏障交错开启新review、正式决定和凭旧批准创建final | 同一subject锁决定顺序；新轮次先提交则final拒绝，final先合法提交则保留；最多一个open | DB |
| AT-27 | 按批准版本 A 创建交付后改草稿，或试用版本 B 的批准导出 A | 已交付 A 文件与清单不变；错配审阅拒绝；下载 SHA-256 与清单一致 | DB＋Media |
| AT-28 | 外部MP4＋新SRT回传，修改切点与字幕，再按同一外部稿回传下一版 | 每版媒体和字幕固定匹配；externalTimelineKnown=false；不能误用旧平台SRT；外部稿不伪造timeline | Media＋UI |
| AT-29 | 修改别人任务的 assignee／title，修改自己任务的状态；只解决审片评论 | 未授权字段拒绝，自有状态可改；评论处理不自动批准审阅 | DB |
| AT-30 | SSE 重复、乱序、游标过期、断网，以及旧 GET 后返回 | UI 经 GET/revision 收敛；reset 能恢复；不会重新消费或回滚采用 | UI＋DB |
| AT-31 | 撤权后访问旧页面、建立事件流、申请下载；使用之前已签 URL | 新业务请求拒绝，流关闭；已签 URL 的实际有效窗口与产品说明一致 | DB＋Media |
| AT-32 | T0有queued J，T1已提交J并新建K，T2恢复T0 | J及所有可能提交过的旧非终态隔离，K费用进入未分配核对；缺attempt不当未提交证据；新epoch有明确放行条件 | 运维演练 |
| AT-33 | 文本分析返回可用提案、格式错误或越权引用 | 只有合法提案保存为 succeeded，人工采纳后才改结构；非法提案不应用，消费仍核对 | Adapter＋DB |
| AT-34 | 使用 05 的容量夹具运行关键查询、并发提交与事件刷新 | 报告实际 P95 和资源；不以用户人数硬上限掩盖失败；预算与隔离仍成立 | 压测 |
| AT-35 | 按10完成F0/F1两集及F2/F3返工与真实内部后期交接 | 两集各有批准与交付；同长度改词、变句长、长段不连续选用、跨集状态和MP4＋SRT回传可解释 | Provider＋行业评审 |
| AT-36 | 目标团队实际完成场次、连续两集、指定返工及后期接手 | 能自行完成且质量／版本交接正确；人工、费用、等待和帮助完整记录；不要求固定效率百分比；不足样本只报告问题发现 | 用户＋真实任务 |
| AT-37 | 两人物、并存造型、上级声音和一次性排除／表演修改，重复准备计划 | resolvedInput与实际请求逐项一致；排除不回流；无关重排不失效；实际current依赖变更需重计划 | Adapter＋DB＋UI |
| AT-38 | 同场SH-01/03/04分别处于钥匙桌面／拾取／右手持有，跨场复用 | 入口、出口意图明确，重复对象／矛盾绑定拒绝或要求取舍；succeeded不自动写剧情已发生状态 | DB＋制作走查 |
| AT-39 | 同长改一个台词字，并做跨反应镜头J-cut；再改变句长 | 直接定位关联声音与字幕；原生混合轨引用不冒充净对白；无双声、截字或未修口型冲突 | UI＋Media＋Provider |
| AT-40 | 6→4及6→8秒替换，音频/字幕位于前、后及跨切点 | 两模式明确，受影响项逐一决定后预览保存一致；不足不补帧，缺决定拒绝；并发保留方案 | UI＋Media＋DB |
| AT-41 | 仅有已采用take而无cut，导出source_package给另一内部后期 | 包含去重原片、人读源入出点与声音说明，无伪时间线；后期能接手，来源范围仍正确授权；离线清单说明包用途/真实选择/缺项，未就绪预览不伪称实测，恢复不暗添新文件 | UI＋Media＋交接 |
| AT-42 | 昨日相似图/视频/声音按名称查找；原片ready但proxy失败 | 可改名搜索而哈希/旧清单不变；原片可下载，proxy明确不可用且仅恢复派生；共享说明不泄私源 | DB＋Media＋UI |
| AT-43 | 多轮只改字幕/音量重新normalize；修改期间另一人保存，或clip被归档 | 未改条目复用精确边界，不累积丢帧；过期normalization不能保存；已有引用不被归档锁死 | DB＋Media |
| AT-44 | 三条旧意见由两人处理，一条保留原方案，再提交新稿批准 | 新结果/保留理由逐项可查；新稿有完整处理清单，例外显式决定，旧评论时间不漂移 | DB＋UI |
| AT-45 | 空项目从CSV分镜或剧本选区起步，再人工拆合已有镜头 | 无预置对象也能到候选和草稿；CSV不付费、不重复导入；AI 建议只新增且可追加当前场次，原文覆盖及新旧映射可查 | DB＋UI＋Adapter |
| AT-46 | 工作室同一余额下并发shared与project作业及部分结清 | 共用workspace约束；shared不占任何项目；scope/角色/周期正确，未决敞口不被释放绕过 | DB |
| AT-47 | AI／CSV 将新镜头追加到已有场次；提案编辑、采纳与他人编辑交错 | 不新增假集场、不覆盖旧镜；同项目父关系、提案修订与内容根 CAS 同时正确；失败全回滚；原提案可查 | DB＋UI＋Schema |
| AT-48 | 关闭后重开提示／返工建议，编辑后准备媒体计划；旧意见后续编辑 | 保存原输出及修订，固定反馈／目标能力／实际参考；新计划固定所用修订，无隐式新费用或替换；过期输入重新确认 | DB＋UI＋Adapter |
| AT-49 | 制作人员改构图与试作台词，主创确认新正式依据，再审固定旧／新稿 | 构图不触发无关台词审批；协作者不能正式确认；试作允许；新正式内容可查版本，批准按固定实际使用依据核对；旧稿不被新草稿篡改 | DB＋UI＋权限 |
| AT-50 | 场次主责分配／改派／停用，其他成员协助与并发编辑 | 一场唯一主责任务、同项目有效成员；不逐镜强制派单、不扩权；改派留审计，原处理结果和 CAS 输入保留 | DB＋UI |
| AT-51 | 两场固定版本组整集；其中一场另做新稿；整集审阅、交付及下一集复用 | 保持实际使用的场次版本与已知源链；场次新稿不自动替换；整集独立批准后最终交付，下一集引用明确资产版本 | DB＋UI＋媒体＋制作 |

## 3. 需求到实现与验收的追踪

| 需求 | 主要模块／数据 | 关键 operationId | 验收 |
|---|---|---|---|
| PR-01 | IdentityAccess／memberships、invitations | beginLogin、inviteMember、acceptInvitation、changeMember | AT-01–04、31 |
| PR-02 | IdentityAccess／projects、project_memberships | createProject、changeLead、archiveProject | AT-04、19 |
| PR-03 | DramaPlanning／script_revisions、episodes、scenes、shots | reviseScript、importShotList、getShotRevision、updateShot、reorderContent | AT-05、45 |
| PR-04 | DramaPlanning＋Generation／analysis_proposals | createGenerationPlan、getProposal、editProposal、applyProposal、getAssistanceArtifact、editAssistanceArtifact | AT-05、33 |
| PR-05 | DramaPlanning＋AssetMedia／asset_revisions、creative_references | changeProduction、updateScene、confirmAssetRevision、confirmCreativeBasis | AT-06、10、37–39 |
| PR-06 | AssetMedia／media、uploads、shared_imports | createUpload、completeUpload、changeMediaMetadata、recoverMediaDerivative、publishSharedAsset、importSharedAsset | AT-07–09、31、42 |
| PR-07 | Generation／generation_plans、capability 配置 | listCapabilities、createGenerationPlan | AT-10、14 |
| PR-08 | Generation＋Runtime／jobs、attempts、outbox | executeGenerationPlan、cancelGenerationJob、recoverJobArchive | AT-11、13–17、19、30 |
| PR-09 | DramaPlanning／takes、selections | createTake、selectTake、clearSelection | AT-20、21 |
| PR-10 | Editing／cuts、cut_revisions、render_tasks | createCut、getCutWorkDraft、normalizeCutDraft、freezeCut、retryRender | AT-22–24、39、43 |
| PR-11 | ReviewDelivery／reviews、comments | createReview、createComment、decideReview | AT-25、26、44 |
| PR-12 | Editing／cut_draft_media、selections | saveCutWorkDraft、listCutWorkDraftHistory、getCutWorkDraftRevision、previewCutReplacement、saveCutDraft、getCutRevision | AT-21、22、27、40 |
| PR-13 | ReviewDelivery／deliveries、external cut_revision | importExternalCut、createDelivery、getDeliveryAccess | AT-27、28、41 |
| PR-14 | TaskTracking／production_tasks | createTask、changeTask | AT-29、44 |
| PR-15 | Budget＋Runtime／reservations、cost_entries | createBudget、listUsage、requestJobReconciliation | AT-12、18、19、32、34、46 |

## 4. 实施阶段与任务边界

时间排期取决于研发配置、首发服务采购和样片难度，本包不虚构固定人周。每阶段均应有可演示结果与可复现证据，不能以“接口都写了”替代流程完成。

| 阶段 | 可直接拆分的工作包 | 退出条件 |
|---|---|---|
| S0 初始化与契约 | D0.1 工程/锁版本/CI；D0.2 M01–M07迁移计划与真实DB约束样例；D0.3 模拟Adapter及故障脚本；D0.4 首发服务/身份/存储配置与测试预算准备；D0.5 现有流程基线和任务对协议 | 文档/契约通过；模拟输入和错误可复现；外部账号不阻碍S1，未具备授权前真实生成关闭 |
| S1 导入素材的纵向闭环 | D1.1 身份项目与固定角色；D1.2 文本/CSV初始结构与项目资产；D1.3 上传验收/元数据/原片代理；D1.4 take/selection；D1.5 基本normalize/剪辑/冻结/评论/批准；D1.6 源包和cut包 | 用合法导入素材跑F0的制作与一处返工，另一成员可接手；形成固定审稿与工作包；不把它当模型通过 |
| S2 真实生成与费用恢复 | D2.1 确切输入解析、当前场次分镜建议与两类持久创作建议；D2.2 报价/双层或shared预占/费用完整性；D2.3 一次提交/迟到证据/轮换；D2.4 查询/取消/归档/派生；D2.5 受限核账命令 | 主路径MV适用项及AT-10–20、30、37、46通过；未决提交与费用不会触发重复购买；真实账号和预算实际可用 |
| S3 连续两集与交接补齐 | D3.1 F0/F1复用与状态；D3.2 台词绑定/J-cut/不等长返工；D3.3 新稿处理清单；D3.4 完整源包、人读表、外部MP4＋SRT；D3.5 基础共享发布和评论轻任务 | 两集工程夹具＋F2三类返工＋一次真实内部后期交接F3通过，旧稿不漂移；AT-21–29、35、38–45有证据，第一集46秒不能独自解锁 |
| S4 受控真实工作室试点 | D4.1 容量/恢复/撤权演练；D4.2 观测与开关；D4.3 12的工作流走查与连续两集代表内容；D4.4 缺陷与收益原因裁决 | AT-31、32、34、36通过；质量及错交付约束满足；实际人工/现金/等待/协助完整记录；不足样本只报告问题发现 |

开发中尽早纵向贯通一条“已导入视频 → 候选 → 剪辑 → 审阅”的路径，以便媒体与交接团队不等待供应商开通；真实生成接入后替换来源。无论开发如何拆分，不能在费用和未知状态未实现时开放真实付费提交。

每个研发任务包含需求 ID、契约操作、事务边界、错误恢复、验收用例及演示数据。只有更改或新增契约时重跑相关全量静态校验；业务测试按影响范围运行，再在阶段门执行完整关键流程。

## 5. 上线门槛与后续迭代

- 接入门槛：明确服务／地区／账号／能力版本，实际参考输入可用；创建无隐式重试；归档、取消和费用有可解释结果。
- 产品门槛：有可播放的整集、一次返工、批准记录、交付文件和清单；人物、对白、动作与连续性达到样片预先约定标准。
- 工程门槛：租户隔离、不可变媒体、预算并发、版本错配和恢复用例通过；真实秘密不进入日志；严重问题有处置开关。
- 试点门槛：用户与样本已确定，现有方式基线已记录，支持与费用承担方式明确；目标在执行前填写，而非结果出来后倒推。

V1 优先减少已观察到的返工：直接使用影响提示、候选比较效率、第二条高价值制作路径、批量任务与费用管理。场次自由画布已纳入首版；UX-01继续验证操作、默认视图和任务收益，不重开是否提供画布的决策。

广告作为独立后续里程碑，在公共闭环稳定且已有真实营销任务时验证入口：营销 brief、商品／课程事实与品牌素材、创意方案、短视频变体和营销交付。复用媒体、生成、剪辑及预算机制；广告候选、采用和最终资格由自己的业务模块定义，不让营销人员填写虚拟集场镜，不强制等待某个短剧版本号。只有出现真实外包参与需求时增加 Guest、限定资源分享与更细策略，保持现有角色默认可用。

## 6. 当前设计可以解锁什么

本轮29项独立意见已进入裁决台账。设计关闭表示受影响规则、字段和验收已补齐，不表示上述运行测试通过。实施以S0/S1开始；S2真实调用前落实账号和金额授权，S3完成机制验收，S4才判断工作室价值。完整操作目录是契约清单，辅助共享、任务聚合和复杂AI重拆不能反向阻挡首条纵向切片。

## 7. S0 本轮交付与下一批工作

工程准备的实际范围、命令和结果见 [15](15-engineering-readiness.md)；任务顺序与依赖见 [16](16-implementation-backlog.md)。S0/S1 同期核实服务账号和能力，实际付费试验只在 G-02/G-03 落实后运行。新增 AT-47–63 在对应业务实现时执行，不能用 S0 单元示例代替。

## 8. 画布新增验收与追踪（均待实际执行）

| ID | Given／When | Then：验收事实 | 层次 |
|---|---|---|---|
| AT-52 | 两人并发首次进入同一场次，再进入另一个场次 | 每场唯一画布；GET不新建；不同场次不串内容；幂等重放不覆盖后续revision | DB＋UI |
| AT-53 | 同场6镜、两份共用参考及未归镜头内容，来回切分镜／画布并定位 | 同一canvas；节点、草稿、媒体身份保留；排序不重排画布；无关联内容在本场探索找回 | UI＋DB |
| AT-54 | 两成员基于revision7编辑不同节点及相同节点 | 只允许一个保存revision8；另一方412保留输入；明确重应用不会无条件覆盖同伴内容 | DB＋UI |
| AT-55 | 保存回执丢失、旧GET迟到、断网刷新、首次保存偏好 | 按document hash核实，不重复付费；dirty不被refetch覆盖；偏好GET返回0不写库，PUT0唯一创建 | DB＋UI |
| AT-56 | 改tenant/project/scene/node/job/media关联ID并在打开后撤权 | 服务端拒绝越权；历史修订、来源、SSE和本机恢复不泄露；不能通过旧偏好恢复权限 | DB＋UI |
| AT-57 | 准备后移动节点，再改启用引用／用途／输入顺序，execute与save交错 | 布局不改指纹；实际输入变化使计划过期；相同锁偏序无死锁，执行与保存有明确先后；固定job不跟随后改 | DB＋Adapter |
| AT-58 | job完成时节点已删除，两人重复取回结果且缓存过期 | result映射永久去重，恢复原nodeId；每个媒体都可找回；CAS冲突不丢结果、不再生成 | DB＋UI |
| AT-59 | 图片绑定候选、视频越界、跨场镜头、一个视频分两镜及绑定冲突 | 图片不能成为Take；范围／归属校验；合法Take与binding原子提交；无自动采用／剪辑 | DB＋Media |
| AT-60 | 输入中文、选择文字、播放seek、Delete／Space／撤销、指针与键盘定位 | 事件互不抢占；必要操作有键盘入口；画布撤销不撤付费、绑定或批准 | UI |
| AT-61 | 300／2000节点、共享素材、多个视频进入视口并拖动缩放 | 记录具体硬件与P95指标；仅活动播放器解码发声；容量错误保留草稿；大型列表和视频分别测 | UI＋性能 |
| AT-62 | 媒体归档后移动别的节点；同nodeId换媒体／type；删除后复用历史ID | 仍授权旧引用可保留；新引用需ready；拒绝改媒体身份与ID复用，旧Take/来源不被伪装 | DB＋UI |
| AT-63 | 团队从戏文到场次生成、双模式返工、剪辑、整集与后期交接 | 两种模式使用同一批成果、计划、费用及审阅身份；断点与质量真实记录，不以模拟替代客户结果 | Pilot＋Provider＋Media |
| AT-64 | 一场多镜：多选节点一次准备，逐项核对后确认提交；其中一项被配额拒绝；画布随后被改动；提交空选择 | 一项一固定计划，全部基于同一画布修订；不可用节点保留阻断原因；空选择与未列节点被拒绝，不会退化为整批；被拒项保留可执行计划并能在同一批次重试，同批其它项的任务不被重跑；作业已失败的项需重新准备；已移动画布的项不被提交；提交不自动采用或建立候选 | DB＋UI＋Provider |

| 需求 | 模块／数据 | 关键操作 | 验收 |
|---|---|---|---|
| PR-16 | CanvasWorkspace＋DramaPlanning／canvas与scene关联 | ensureSceneCanvas、getSceneCanvas、getCanvas、bindSceneCanvasNode、unbindSceneCanvasNode、prepareCanvasGeneration、listCanvasPlans、materializeCanvasResults、prepareCanvasGenerationBatch、getCanvasGenerationBatch、executeCanvasGenerationBatch | AT-52、53、57–59、63、64 |
| PR-17 | CanvasWorkspace／修订与个人偏好 | saveCanvas、getCanvasRevision、listCanvasHistory、getEditingPresence、updateEditingPresence、getSceneWorkspacePreference、saveSceneWorkspacePreference | AT-54–56、60–62 |

CX01–05与E/G/C工作包对应见[16](16-implementation-backlog.md)，结构与行为边界见[18](18-canvas-workspace-contract.md)。S1可先完成CX01–03；S2/CX04贯通生成；S3退出须全部完成，S4实际工作室任务不得跳过双模式。

## 9. 技术收尾新增验收（AT-64–76，均待实际执行）

| ID | Given／When | Then：验收事实 | 层次 |
|---|---|---|---|
| AT-65 | 重排六镜，留下越界字幕、空主轨或未决定音轨，保存后关闭重开 | 工作稿恢复完整且有问题提示；Cut保持原编排；未完成稿不能直接应用或渲染；修复后按固定来源归一 | DB＋UI＋Media |
| AT-66 | 归一r5后同伴写r6；或应用与冻结相交错 | 旧归一不能应用；Cut与工作稿原子更新；冻结双版本匹配，有未应用工作时默认阻断，显式排除才渲染旧编排并留版本证据 | DB＋UI |
| AT-67 | 首次两个If-Match0并发；Cut基线改变；external_file请求工作稿 | 仅一个共享工作稿；旧基线编辑仍能保存但不能直接归一；人工重新比较才更新基线；外部稿拒绝 | DB |
| AT-68 | 工作稿PUT响应丢失、保存期间继续输入、断网或撤权后重开 | 对照hash和基线识别结果；新输入不丢；本机隔离与清除有效；不重放生成、不把本机副本说成服务端备份 | DB＋UI |
| AT-69 | 连续保存跨24小时、7天、30天且达到历史预算；大量同内容修订 | 当前／前一版保留；桶内取最后修订、同对象正文去重、实际列表准确、过期410；按未压缩字节预算清理可淘汰历史 | DB＋容量 |
| AT-70 | 历史清理与新增pin／规范化请求／归档媒体恢复交错并中断 | 被引用正文／精确基线不丢；加pin与清理互斥；生成确切源快照仍可读；旧历史不绕过新增引用或撤权；重跑清理无孤立依赖 | DB |
| AT-71 | 两人同画布改不同节点；多标签心跳、90秒过期、失权或提示服务失败 | 提示不构成锁；CAS冲突可恢复；提示不改内容revision；本人身份不可伪造，失权与跨目标越权拒绝；记录真实协作阻力 | DB＋UI＋Pilot |
| AT-72 | 受限角色业务事务中入队，任意一步失败回滚，再模拟提交成功响应丢失 | 业务／队列同连接原子提交；无孤立作业；运行身份无迁移／越权能力；重试返回原业务；不建自研worker_tasks | DB＋Queue |
| AT-73 | submit记录attempt前后、供应商接受后未存ID、后续入队后未ack分别杀进程 | 无第二次未知购买；迟到回执可恢复；重投和回调／轮询竞争按业务版本收敛；队列ack丢失不使后续工作消失 | DB＋故障供应商 |
| AT-74 | 同账号多个连接并发提交，配额1；供应商仍running／unknown，Worker已释放 | 最多一份有效在途占用；未知和仅请求取消不释放；请求速率单独限制；不得靠groupConcurrency宣称严格额度成立 | DB＋故障供应商 |
| AT-75 | 恢复库含旧queued／dispatching信封，外部已有任务或费用；普通扫描重新入队 | epoch与quarantine仍阻断重POST；扫描不赋新资格；费用、已知原任务查询和归档按原协议恢复 | DB＋恢复演练 |
| AT-76 | 一个真实工作稿端点接通Ajv2020、授权、事务与响应；Query聚焦重取、两模式切换 | 正反输入与输出一致，无隐式剥字段／类型转换；快照刷新不覆盖dirty，浏览器不以仅工作稿ETag缓存动态诊断 | API＋DB＋UI |

追踪补充：PR-08／15 → AT-72–75；PR-10／12 → AT-65–71、76；PR-16／17 → AT-69–71、76。队列候选门槛QV-01由AT-72／73／74／75对应部分关闭。原AT-01–63不变；新增AT-64为画布批量生成，原AT-64–75顺延为AT-65–76。实际媒体边界和工作室效果仍分别执行。

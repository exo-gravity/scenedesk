# 08 验收、实施分解与交付门槛

当前状态：以下为待执行用例和阶段计划，尚未运行产品、真实模型样片或用户试点。静态文档／契约检查另见 validation-report.md，不与本表混算。

## 1. 验收的三个层次

1. 契约与业务：输入、权限、版本、预算和状态一致；可用模拟供应商构造确定结果。
2. 真实制作：指定账号生成，真实文件完成编辑、审阅、返工与交付；供应商接入和音画质量必须在此验证。
3. 用户价值：目标工作室用现有工作方式与工作台完成可比任务，记录质量、人工、费用、周期和出错；不能由研发测试代替。

最小制作夹具见 [10](10-production-fixture.md)。其中两次返工分别检验单镜头采用和跨版本剪辑更新。没有强制要求将无限画布做完才开展以上验证。

## 2. 必须通过的行为用例

每项记录环境、版本、输入、实际结果及证据，当前全部为待执行。DB 表示需要真实数据库集成；Media 表示真实媒体管线；Provider 表示所选服务与账号；Pilot 表示目标用户任务观察。

| ID | Given／When | Then：验收事实 | 层次 |
|---|---|---|---|
| AT-01 | 两租户有同名项目，用户改路径／正文／关联 ID 读取或写入对方对象 | 全部拒绝；列表、使用位置、SSE、签名 URL 不泄露内容 | DB |
| AT-02 | 两个请求复用连接池连接，分别使用不同租户上下文 | 不串租户；实际运行 DB 角色无 owner/BYPASSRLS 权限 | DB |
| AT-03 | 邀请被撤销、过期、重复接受或由不匹配邮箱接受 | 无新增错误成员；有效重复接受不重复建成员；Owner 必须保持唯一 | DB |
| AT-04 | 协作者试图改预算、任免管理员、批审片；任务被分给未加入项目者 | 拒绝；任务不扩大权限；交接负责人后才允许移除旧负责人 | DB |
| AT-05 | 同时保存剧本、重排或应用旧提案；提案缺少新建父操作 | 旧 CAS／基线失败且保留本地内容；依赖不全整体拒绝，历史素材仍可读 | DB＋UI |
| AT-06 | 角色同时有日常服与晚礼服，修改晚礼服后查看旧计划 | 两种造型身份不变；旧计划仍引用旧版晚礼服，不变成日常服或最新版 | DB＋UI |
| AT-07 | 私有角色发布共享，未加入来源项目者引入 | 可用指定共享版本与媒体；无法读取源剧本、源候选或私有 ID；升级不自动替换旧引用 | DB |
| AT-08 | 上传已验收后继续用原 URL 覆盖 staging；或发送伪扩展名、超量文件 | ready 媒体字节和 SHA-256 不变；非法上传拒绝；无存储路径穿越 | Media |
| AT-09 | 下载跳转到内网／元数据地址，或媒体处理器遇到异常文件 | 下载拒绝；处理有资源上限，不可访问网络或执行注入命令 | Media |
| AT-10 | 计划包含模式不支持的声音／尾帧，或能力版本改变后提交 | 显示具体阻断／冲突，无静默丢弃，无供应商付费请求 | DB＋Adapter |
| AT-11 | 双击执行、响应丢失后同键重发、换键执行同一 plan | 最多一个 job、一份预占、一次自动 submit；同键不同正文拒绝 | DB＋Adapter |
| AT-12 | 同层预算 80 元，20 个请求各预占 8 元并发提交，无费用结算 | 恰有最多 10 个提交通过；spent／reserved 不重复；被拒绝请求无 provider submit | DB |
| AT-13 | provider 已接受但回执在保存前丢失，重启 Worker | submission_unknown；不再 POST；预占仍在；可以用可靠证据找回或保持未决 | DB＋Adapter，随后 Provider |
| AT-14 | SDK／HTTP 层收到 429／500／网络中断 | 创建端无隐式重试；GET 可退避；日志可证明实际 POST 次数 | Adapter＋Provider |
| AT-15 | running 回调重复且晚到，成功回调无可核验签名 | 不回滚终态；未认证回调不能写媒体／费用；可信查询后更新 | DB＋Adapter |
| AT-16 | queued 取消、dispatching 取消，以及取消后成功返回 | 明确未提交才释放；已生成内容可归档；未知费用保持预占 | DB＋Adapter，随后 Provider |
| AT-17 | provider 成功但下载失败／URL 过期，用户点恢复 | 仅重新查询／归档；不能再次生成；不能恢复则清楚保留不可用原因与实际费用 | Media＋Provider |
| AT-18 | 估计 8 实际 6，估计 8 实际 10，失败但未知，同账单重复到达 | 分别结清 6／10、超限阻断新作业、保留未知、费用仅一次；退款追加调整 | DB |
| AT-19 | 预算跨周期、连接轮换、操作者离职或项目归档 | 旧任务按原账号及预算归档核账；未提交任务停用；新任务使用新配置 | DB＋Provider |
| AT-20 | 单媒体映射两个镜头的不同区间，归档通知重复 | 候选范围合法且不重复；不猜切点；采用各自独立 | DB＋UI |
| AT-21 | 新候选生成或替换当前采用后打开多个剪辑和旧审稿 | 新结果不自动采用；采用不自动改剪辑；仅明确选择并保存的草稿改变 | DB＋UI |
| AT-22 | 两人同时改同一剪辑；其中一人冻结 | 只按匹配 revision 保存／冻结；另一人本地编辑保留；冻结内容与提交时一致 | DB＋UI |
| AT-23 | 不同帧率／分辨率／音频采样率素材经过任意裁切、组接、混音、字幕 | 全片可解码；裁切与字幕误差在约定一帧内；无默认重复对白、黑洞或时间戳跳变 | Media |
| AT-24 | 冻结后渲染崩溃，再升级软件并重试 | 冻结输入不变；相同 profile 可恢复；已 ready 文件不被覆盖；无模型调用 | Media＋DB |
| AT-25 | take 源范围 10–16 秒，对局部第 2 秒评论；在整集相应片段评论 | 单镜头定位源第 12 秒；整集按实际 cut item 映射；未知外部映射不伪造 | UI＋Media |
| AT-26 | 同一 subject 并发发起审阅／决定，或旧批准后开启新一轮审阅 | 最多一个 open；决定不可覆盖；新一轮未批准不能使用旧批准新建 final | DB |
| AT-27 | 按批准版本 A 创建交付后改草稿，或试用版本 B 的批准导出 A | 已交付 A 文件与清单不变；错配审阅拒绝；下载 SHA-256 与清单一致 | DB＋Media |
| AT-28 | 回传无工程映射的外部 MP4，并要求导出不存在的 SRT | 独立固定版本审阅；externalTimelineKnown=false；缺少字幕时明确拒绝该选项 | Media＋UI |
| AT-29 | 修改别人任务的 assignee／title，修改自己任务的状态；只解决审片评论 | 未授权字段拒绝，自有状态可改；评论处理不自动批准审阅 | DB |
| AT-30 | SSE 重复、乱序、游标过期、断网，以及旧 GET 后返回 | UI 经 GET/revision 收敛；reset 能恢复；不会重新消费或回滚采用 | UI＋DB |
| AT-31 | 撤权后访问旧页面、建立事件流、申请下载；使用之前已签 URL | 新业务请求拒绝，流关闭；已签 URL 的实际有效窗口与产品说明一致 | DB＋Media |
| AT-32 | 从旧备份恢复，备份之后供应商已接受部分任务 | 先冻结外部创建并核对，不能将旧 queued 全部重放；媒体清单可对账 | 运维演练 |
| AT-33 | 文本分析返回可用提案、格式错误或越权引用 | 只有合法提案保存为 succeeded，人工采纳后才改结构；非法提案不应用，消费仍核对 | Adapter＋DB |
| AT-34 | 使用 05 的容量夹具运行关键查询、并发提交与事件刷新 | 报告实际 P95 和资源；不以用户人数硬上限掩盖失败；预算与隔离仍成立 | 压测 |
| AT-35 | 指定账号跑完制作夹具并发生一轮实际重生成和剪辑返工 | 可播放整集、已批准版本、交付包和成本账齐全；模型质量由人评估 | Provider＋行业评审 |
| AT-36 | 目标工作室用现有方式和工作台完成可比任务 | 记录人工、费用、周期、错误交接及成片质量；未达预设目标不得只用生成成功率宣称有效 | Pilot |

## 3. 需求到实现与验收的追踪

| 需求 | 主要模块／数据 | 关键 operationId | 验收 |
|---|---|---|---|
| PR-01 | IdentityAccess／memberships、invitations | beginLogin、inviteMember、acceptInvitation、changeMember | AT-01–04、31 |
| PR-02 | IdentityAccess／projects、project_memberships | createProject、changeLead、archiveProject | AT-04、19 |
| PR-03 | DramaPlanning／script_revisions、episodes、scenes、shots | reviseScript、createScene、updateShot、reorderContent | AT-05 |
| PR-04 | DramaPlanning＋Generation／analysis_proposals | createGenerationPlan、getProposal、applyProposal | AT-05、33 |
| PR-05 | DramaPlanning＋AssetMedia／asset_revisions、creative_references | changeProduction、updateScene、confirmAssetRevision | AT-06、10 |
| PR-06 | AssetMedia／media、uploads、shared_imports | createUpload、completeUpload、publishSharedAsset、importSharedAsset | AT-07–09、31 |
| PR-07 | Generation／generation_plans、capability 配置 | listCapabilities、createGenerationPlan | AT-10、14 |
| PR-08 | Generation＋Runtime／jobs、attempts、outbox | executeGenerationPlan、cancelGenerationJob、recoverJobArchive | AT-11、13–17、19、30 |
| PR-09 | DramaPlanning／takes、selections | createTake、selectTake、clearSelection | AT-20、21 |
| PR-10 | Editing／cuts、cut_revisions、render_tasks | createCut、freezeCut、retryRender | AT-22–24 |
| PR-11 | ReviewDelivery／reviews、comments | createReview、createComment、decideReview | AT-25、26 |
| PR-12 | Editing／cut_draft_media、selections | saveCutDraft、getCutRevision | AT-21、22、27 |
| PR-13 | ReviewDelivery／deliveries、external cut_revision | importExternalCut、createDelivery、getDeliveryAccess | AT-27、28 |
| PR-14 | TaskTracking／production_tasks | createTask、changeTask | AT-29 |
| PR-15 | Budget＋Runtime／reservations、cost_entries | createBudget、listUsage、requestJobReconciliation | AT-12、18、19、32、34 |

## 4. 实施阶段与任务边界

时间排期取决于研发配置、首发服务采购和样片难度，本包不虚构固定人周。每阶段均应有可演示结果与可复现证据，不能以“接口都写了”替代流程完成。

| 阶段 | 可直接拆分的工作包 | 退出条件 |
|---|---|---|
| S0 契约与接入准备 | D0.1 初始化工程与 CI、锁版本；D0.2 数据迁移／RLS 策略样例；D0.3 模拟 Adapter 与故障夹具；D0.4 选定服务、账号、测试预算与 OIDC；D0.5 内部低保真验证制作／返工行为 | 契约检查通过；核心事务与失败场景可运行；MV-01 和调用重试边界有实际证据后进入真实生成集成 |
| S1 剧本与资产可用 | D1.1 登录／工作室／成员／项目；D1.2 集场镜与提案选择；D1.3 资产版本／造型／共享；D1.4 上传验收、检索及访问；D1.5 内容 CAS 与空状态 | 从已有剧本准备一个场次所需依据；AT-01–10、33 中相应场景通过；可导入合法素材继续工作 |
| S2 可靠生成闭环 | D2.1 计划解析及报价依据；D2.2 预算预占与账本；D2.3 一次提交、查询与未知核对；D2.4 输出归档与候选；D2.5 SSE／取消／账单核对运营命令 | 主路径真实生成并保存候选；AT-11–20、30 通过；MV-01–10 的适用项有结论，未知关键项不得放行 |
| S3 审阅与返工交付 | D3.1 轻量剪辑及音轨／字幕；D3.2 冻结与隔离渲染；D3.3 时间码意见和正式决定；D3.4 明确采用与指定草稿更新；D3.5 工作包、最终交付、外部回传；D3.6 基础人工任务 | AT-21–29、35 通过；完整样片与至少一轮实际返工，下载文件与清单相符 |
| S4 受控试点 | D4.1 备份恢复／容量／撤权测试；D4.2 上线观测与连接开关；D4.3 目标工作室导入与任务对照；D4.4 缺陷修复和范围调整 | AT-31、32、34、36 有结果；严重隔离、重复扣费和版本错配问题清零；试点目标事先约定 |

开发中尽早纵向贯通一条“已导入视频 → 候选 → 剪辑 → 审阅”的路径，以便媒体与交接团队不等待供应商开通；真实生成接入后替换来源。无论开发如何拆分，不能在费用和未知状态未实现时开放真实付费提交。

每个研发任务包含需求 ID、契约操作、事务边界、错误恢复、验收用例及演示数据。只有更改或新增契约时重跑相关全量静态校验；业务测试按影响范围运行，再在阶段门执行完整关键流程。

## 5. 上线门槛与后续迭代

- 接入门槛：明确服务／地区／账号／能力版本，实际参考输入可用；创建无隐式重试；归档、取消和费用有可解释结果。
- 产品门槛：有可播放的整集、一次返工、批准记录、交付文件和清单；人物、对白、动作与连续性达到样片预先约定标准。
- 工程门槛：租户隔离、不可变媒体、预算并发、版本错配和恢复用例通过；真实秘密不进入日志；严重问题有处置开关。
- 试点门槛：用户与样本已确定，现有方式基线已记录，支持与费用承担方式明确；目标在执行前填写，而非结果出来后倒推。

V1 优先减少已观察到的返工：直接使用影响提示、候选比较效率、第二条高价值制作路径、批量任务与费用管理。UX-01 独立验证后，决定是否以及在哪些任务引入画布，不按竞品功能表自动上马。

V2 在短剧闭环稳定后验证广告入口：营销 brief、商品／课程事实与品牌素材、创意方案、短视频变体和营销交付。复用媒体、生成、剪辑、审阅与费用；不让营销人员填写集场镜。只有出现真实外包参与需求时增加 Guest、限定资源分享与更细策略，保持现有角色默认可用。

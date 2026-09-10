# 综合裁决与最终修订记录

日期：2026-09-07。用户明确授权自主评审和裁决。首轮由三个隔离上下文的 AI 角色评审；没有外部真人专家签字、客户访谈或真实样片执行。原报告不被修订结果覆盖。

## 综合判断

保留短剧优先、公共制作底座、固定版本与简单内部权限。首轮29项意见为8项P0、20项P1、1项P2；前28项补充本期规则与验收，P2修正当前复用表述并将广告业务实现保留在独立里程碑。下列“关闭”只指设计，不声称功能已经运行。

优先让已有资料能够进入制作、返工可操作、后期可接手、模型费用可核对。MVP选择结构化分镜工作台；复杂AI更新、波形、分轨/口型修复、专业NLE、广告入口与Guest后置。精确时间与费用完整性虽然增加实现工作，但直接关系错帧、错账及错误交付，纳入本期。

## 逐项裁决

| 发现 | 等级 | 处理 | 最终规则与理由 | 修改文档 | 待执行验收 |
|---|---|---|---|---|---|
| [TECH-01](technical-review.md) | P0 | 采纳 | 新增费用完整性与单列控制预留；部分条目不触发整项结清。累计账单与明细按账号级费用身份去重，不能因多连接或恢复双计。 | [03](../../../docs/implementation/03-domain-data-model.md)、[04](../../../docs/implementation/04-state-execution-and-budget.md)、[07](../../../docs/implementation/07-provider-adapter.md)、[11](../../../docs/implementation/11-transaction-and-implementation-blueprint.md) | AT-18、AT-46 |
| [TECH-02](technical-review.md) | P0 | 采纳 | 新审阅、正式决定和final建立竞争同一固定subject锁，以事务先后决定资格。 | [03](../../../docs/implementation/03-domain-data-model.md)、[04](../../../docs/implementation/04-state-execution-and-budget.md)、[06](../../../docs/implementation/06-api-contract.md)、[11](../../../docs/implementation/11-transaction-and-implementation-blueprint.md) | AT-26、AT-27 |
| [TECH-03](technical-review.md) | P0 | 修改采纳 | 采用唯一normalization-v1并固定精确帧、样本、源映射和构建；先归一确认再保存。不扩大为专业时间线，首版只支持顺序视频与显式音频字幕。 | [03](../../../docs/implementation/03-domain-data-model.md)、[05](../../../docs/implementation/05-architecture-and-operations.md)、[06](../../../docs/implementation/06-api-contract.md)、[11](../../../docs/implementation/11-transaction-and-implementation-blueprint.md) | AT-23、AT-24、AT-43 |
| [TECH-04](technical-review.md) | P1 | 采纳 | 明确requested/resolved输入、来源追踪、计量项和价格版本，实际参考可回显并与请求比对。 | [03](../../../docs/implementation/03-domain-data-model.md)、[06](../../../docs/implementation/06-api-contract.md)、[07](../../../docs/implementation/07-provider-adapter.md) | AT-10、AT-37 |
| [TECH-05](technical-review.md) | P1 | 采纳 | 连接账号身份与版本不可变，同账号凭据后继须核验；跨账号新建连接，旧任务不读取当前账号。 | [03](../../../docs/implementation/03-domain-data-model.md)、[05](../../../docs/implementation/05-architecture-and-operations.md)、[07](../../../docs/implementation/07-provider-adapter.md)、[11](../../../docs/implementation/11-transaction-and-implementation-blueprint.md) | AT-19 |
| [TECH-06](technical-review.md) | P1 | 采纳 | 过期持有者仅追加不可变回执；当前有效Worker核验后推进，失效租约不丢弃provider ID也不重复购买。 | [04](../../../docs/implementation/04-state-execution-and-budget.md)、[07](../../../docs/implementation/07-provider-adapter.md)、[11](../../../docs/implementation/11-transaction-and-implementation-blueprint.md) | AT-13、AT-14、AT-15 |
| [TECH-07](technical-review.md) | P1 | 修改采纳 | 开放original/proxy/poster及派生状态/恢复；波形后置。代理失败不静默退回原片，不阻断已就绪原片下载。 | [03](../../../docs/implementation/03-domain-data-model.md)、[05](../../../docs/implementation/05-architecture-and-operations.md)、[06](../../../docs/implementation/06-api-contract.md) | AT-42 |
| [TECH-08](technical-review.md) | P1 | 采纳 | 媒体可读名称、标签、来源与搜索进入API；更改元数据不改变原字节和历史清单。 | [03](../../../docs/implementation/03-domain-data-model.md)、[05](../../../docs/implementation/05-architecture-and-operations.md)、[06](../../../docs/implementation/06-api-contract.md) | AT-08、AT-42 |
| [TECH-09](technical-review.md) | P1 | 采纳 | shared只占工作室预算，project双层；共享生成与项目并发竞争同一工作室余额。 | [03](../../../docs/implementation/03-domain-data-model.md)、[04](../../../docs/implementation/04-state-execution-and-budget.md)、[07](../../../docs/implementation/07-provider-adapter.md)、[11](../../../docs/implementation/11-transaction-and-implementation-blueprint.md) | AT-12、AT-46 |
| [TECH-10](technical-review.md) | P1 | 采纳 | 恢复epoch与旧未终局任务quarantine覆盖queued及备份缺失消费；未分配费用有账本身份，逐连接核平后放行。 | [03](../../../docs/implementation/03-domain-data-model.md)、[05](../../../docs/implementation/05-architecture-and-operations.md)、[11](../../../docs/implementation/11-transaction-and-implementation-blueprint.md) | AT-32、AT-46 |
| [PROD-01](product-review.md) | P0 | 修改采纳 | 分别定义工程贯通、实际模型制作和工作室价值门槛；S1先用导入素材贯通，S3两集夹具，S4真实连续两集，不以46秒替代MVP。 | [01](../../../docs/implementation/01-product-requirements.md)、[08](../../../docs/implementation/08-verification-and-delivery-plan.md)、[10](../../../docs/implementation/10-production-fixture.md)、[12](../../../docs/implementation/12-mvp-workflows-and-pilot.md) | AT-35、AT-36 |
| [PROD-02](product-review.md) | P0 | 采纳 | 两种片段替换政策明确；不够长不自动变速/补帧，声轨字幕逐项决定，新台词绑定明确处理。 | [02](../../../docs/implementation/02-interaction-spec.md)、[06](../../../docs/implementation/06-api-contract.md)、[11](../../../docs/implementation/11-transaction-and-implementation-blueprint.md)、[12](../../../docs/implementation/12-mvp-workflows-and-pilot.md) | AT-39、AT-40、AT-43 |
| [PROD-03](product-review.md) | P0 | 采纳 | 按剧目/场次/镜头/本次输入确定覆盖顺序，按角色用途分组；排除不回流，一次性修改不暗改镜头。 | [02](../../../docs/implementation/02-interaction-spec.md)、[06](../../../docs/implementation/06-api-contract.md)、[12](../../../docs/implementation/12-mvp-workflows-and-pilot.md) | AT-10、AT-37 |
| [PROD-04](product-review.md) | P1 | 修改采纳 | 固定文本与CSV入口，空项目无需假剧本；AI与CSV只新增，导入后人工移动。复杂AI修订和任意文档解析后置。 | [01](../../../docs/implementation/01-product-requirements.md)、[02](../../../docs/implementation/02-interaction-spec.md)、[06](../../../docs/implementation/06-api-contract.md)、[12](../../../docs/implementation/12-mvp-workflows-and-pilot.md) | AT-05、AT-33、AT-45 |
| [PROD-05](product-review.md) | P1 | 采纳 | 原素材包无需cut；完整源文件去重，附人读区间与已知声音说明，外部MP4/SRT固定配套版本。 | [02](../../../docs/implementation/02-interaction-spec.md)、[06](../../../docs/implementation/06-api-contract.md)、[13](../../../docs/implementation/13-production-quality-and-handoff.md) | AT-28、AT-41 |
| [PROD-06](product-review.md) | P1 | 采纳 | 从旧评论建立任务与新稿处理链；保留例外有理由，外部返工可指向固定cut revision，完成任务不等于批准。 | [02](../../../docs/implementation/02-interaction-spec.md)、[03](../../../docs/implementation/03-domain-data-model.md)、[06](../../../docs/implementation/06-api-contract.md) | AT-29、AT-44 |
| [PROD-07](product-review.md) | P1 | 修改采纳 | 草稿可试用；项目确认由负责人/管理者承担，共享发布由管理者承担。不引入复杂审批工作流。 | [01](../../../docs/implementation/01-product-requirements.md)、[02](../../../docs/implementation/02-interaction-spec.md)、[06](../../../docs/implementation/06-api-contract.md) | AT-04、AT-06、AT-07 |
| [PROD-08](product-review.md) | P1 | 采纳 | 媒体名称和标签检索、来源记录及固定交付快照进入日常工作流。 | [02](../../../docs/implementation/02-interaction-spec.md)、[03](../../../docs/implementation/03-domain-data-model.md)、[06](../../../docs/implementation/06-api-contract.md) | AT-42 |
| [PROD-09](product-review.md) | P1 | 采纳 | 每对任务各用一种流程，任务单位为连续两集；一次准备、增量、失败和未决分别报告，20%/10%为预设待验假设。 | [08](../../../docs/implementation/08-verification-and-delivery-plan.md)、[12](../../../docs/implementation/12-mvp-workflows-and-pilot.md)、[13](../../../docs/implementation/13-production-quality-and-handoff.md) | AT-35、AT-36 |
| [PROD-10](product-review.md) | P2 | 修正文案；业务后置 | 修正复用承诺：公共执行/媒体等可复用，现有Take/Selection仍属短剧；广告目标与审批在独立里程碑设计，不现在制造空通用实体。 | [05](../../../docs/implementation/05-architecture-and-operations.md)、[09](../../../docs/implementation/09-decisions-and-open-items.md) | AT-36 |
| [DRAMA-01](drama-review.md) | P0 | 采纳 | 角色、道具和空间入口/出口状态及分层优先级固定；生成成功不能确认叙事连续性。 | [03](../../../docs/implementation/03-domain-data-model.md)、[06](../../../docs/implementation/06-api-contract.md)、[10](../../../docs/implementation/10-production-fixture.md)、[13](../../../docs/implementation/13-production-quality-and-handoff.md) | AT-37、AT-38 |
| [DRAMA-02](drama-review.md) | P0 | 采纳 | 固定台词修订与实际声音/字幕使用分开；剪辑有clip绑定，无cut素材包有sourceBindings，同长改词也提示影响。 | [03](../../../docs/implementation/03-domain-data-model.md)、[06](../../../docs/implementation/06-api-contract.md)、[10](../../../docs/implementation/10-production-fixture.md)、[13](../../../docs/implementation/13-production-quality-and-handoff.md) | AT-39、AT-44 |
| [DRAMA-03](drama-review.md) | P1 | 修改采纳 | 支持原生混合轨、独立音轨及跨反应镜头声音；混合轨静音须说明损失。自动分轨/口型修复后置，质量仍人工复查。 | [02](../../../docs/implementation/02-interaction-spec.md)、[06](../../../docs/implementation/06-api-contract.md)、[10](../../../docs/implementation/10-production-fixture.md)、[13](../../../docs/implementation/13-production-quality-and-handoff.md) | AT-23、AT-39、AT-40 |
| [DRAMA-04](drama-review.md) | P1 | 修改采纳 | 文本选区和quote固定；AI只新增，人工拆合保留sourceExcerpts/sourceShotIds并检查覆盖，不自动重写已有制作。 | [03](../../../docs/implementation/03-domain-data-model.md)、[06](../../../docs/implementation/06-api-contract.md)、[10](../../../docs/implementation/10-production-fixture.md) | AT-05、AT-45 |
| [DRAMA-05](drama-review.md) | P1 | 采纳 | Take保持单连续区间，时间线允许同镜多Take多次使用；偏好selection与实际叙事覆盖分开。 | [03](../../../docs/implementation/03-domain-data-model.md)、[06](../../../docs/implementation/06-api-contract.md)、[10](../../../docs/implementation/10-production-fixture.md)、[13](../../../docs/implementation/13-production-quality-and-handoff.md) | AT-20、AT-21、AT-40 |
| [DRAMA-06](drama-review.md) | P1 | 采纳 | 两种工作包与最终交付分开；无cut不造时间线；源区间/声音/版本交接真实接手验证，MP4/SRT回传不猜工程映射。 | [06](../../../docs/implementation/06-api-contract.md)、[10](../../../docs/implementation/10-production-fixture.md)、[13](../../../docs/implementation/13-production-quality-and-handoff.md) | AT-28、AT-41 |
| [DRAMA-07](drama-review.md) | P1 | 采纳 | 样片质量依据包含具体关键剧情错误、非关键例外、前后接点/场次复查和整集完整观看。 | [06](../../../docs/implementation/06-api-contract.md)、[10](../../../docs/implementation/10-production-fixture.md)、[13](../../../docs/implementation/13-production-quality-and-handoff.md) | AT-35、AT-39、AT-44 |
| [DRAMA-08](drama-review.md) | P1 | 采纳 | 增加接续第二集、换装复用、同长改词/变长/多区间返工和真实内部后期F3，工程与用户试点分开。 | [08](../../../docs/implementation/08-verification-and-delivery-plan.md)、[10](../../../docs/implementation/10-production-fixture.md)、[13](../../../docs/implementation/13-production-quality-and-handoff.md) | AT-35、AT-39、AT-40、AT-41 |
| [DRAMA-09](drama-review.md) | P1 | 采纳 | 费用按job唯一及真实外部成本汇总，初始投入和第二集增量分开；预设尝试/人时停止规则，不以失败样本删除制造收益。 | [10](../../../docs/implementation/10-production-fixture.md)、[12](../../../docs/implementation/12-mvp-workflows-and-pilot.md)、[13](../../../docs/implementation/13-production-quality-and-handoff.md) | AT-18、AT-35、AT-36 |

## 二次复核中的集成修订

三位角色完成首轮独立评审后，部分参与所负责规范的限定编辑；再复核主任务整合的契约与跨文档行为。二次复核是修订验证，不重新声称盲评，也不代替研发测试。

| 二次发现 | 最终处理 |
|---|---|
| CSV 空项目仍强制有脚本版本；提案父对象映射无入口 | Proposal按来源条件要求脚本；CSV保存摘要。首版只新增，导入后人工移动 |
| 无cut的声音与台词说明无合法clip；外部返工成果无固定身份 | SourceMediaBinding独立表达已知源关系；ReworkItem支持外部cut revision/media |
| 变长／同长改词替换缺新声音字幕绑定 | CutReplacementInput提交完整明确绑定，悬空／越界／版本错配拒绝 |
| 两集／三集与配对、人时口径冲突 | 全部统一两集；每对两种流程，32人时按一项连续两集任务的一条流程计 |
| 制作副本去重未包含渲染及归一版本 | 唯一键固定源hash、profile、renderer、normalization |
| 同账号多连接及未分配费用可能双记 | 账号级provider_charge_identities统一费用身份，迁移分配及预算投影同事务 |
| 无cut交付缺独立媒体依赖 | delivery_media_inputs固定额外声音／字幕、源素材及可公开证据媒体 |
| 精确旧接点与回显微秒冲突；仅移动又吸附源区间 | 分量分别复用；相接回显值还原精确端点，24fps一帧后41667us追加可接受 |

复核报告：[技术](technical-recheck.md)、[产品](product-recheck.md)、[短剧制作](drama-recheck.md)。三份首评保留于[评审入口](README.md)。机器清单见[decision-log.json](decision-log.json)。

## 最终清单复核

产品角色另外复核了可离线交接的manifest：用途、创建时间、实际可用项、缺项／未知、原素材策略和人读文件均显式保存；无预览工作包使用固定时间线规格，不能写作成片实测。原素材包不伪造历史采用，final可按约定不附原片。该补充已写入06及契约，并增加正反结构样例。

## 实施与发布边界

可进入S0/S1工程准备与导入素材贯通。G-01–08事实缺口、AT-01–46、MV-01–10及F0–F3按阶段落实；真实付费账号与预算、供应商行为、媒体解码渲染、数据库事务隔离、恢复容量、工作室价值尚未验收。静态检查仅证明契约及文档所列结构一致。

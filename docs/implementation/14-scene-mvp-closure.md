# 14 场次主场景与 MVP 收口基线

日期：2026-09-09。设计状态：最新讨论已并入主稿 v1.3、实施包v1.3和OpenAPI1.3.0（09-10技术协议补充见21）。工程执行状态见 [15](15-engineering-readiness.md)。本文规定新增行为及跨模块事务；旧评审快照保留历史，不作为当前范围。客户研究、真实模型制作和完整 MVP 验收仍待执行。

## 1. 范围与完成定义

**当前范围：** 用户将每场次分镜／自由画布纳入第一版，工作区覆盖整个场次；新增数据、接口、保存冲突、模式互通和验收设计已补入[18](18-canvas-workspace-contract.md)及OpenAPI1.3.0。原S0检查保留历史；最新静态／隔离验证见[19](19-design-closure-and-implementation-entry.md)，真实业务待实现。

首期核心场景：一位 AI 制作人员主责一场戏，从已有戏文及部分参考开始，准备分镜、试作与比较多个镜头、组接声音画面、接受主创意见并返工，得到可进入整集的场次版本。其他成员按需协助资产、声音、后期与接手，不要求逐镜派单。

| 层次 | 本期需要完成 | 不能据此声称 |
|---|---|---|
| 首条工程切片 | 导入素材完成一场戏，能明确选择、编排、审阅、返工、交接 | 全部 MVP 或真实模型质量已完成 |
| 完整 MVP | 上述流程加实际生成、场次分镜／自由画布双模式、整集编排与独立确认、第二集复用、真实内部后期交接回传、预算和异常恢复、简单成员与共享 | 完整专业后期、任意可编程节点和 Agent 工作流已支持 |
| 团队试点 | 实际团队能自行完成约定业务，没有必须靠研发改库的断点；主创与后期确认质量和交接 | 差异化、规模化产能或固定效率收益已得到证明 |

“场次可交付”须满足：故事和动作连续、身份及道具关系正确、正式台词正确、基本音画同步与必要叙事声音可用，所需字幕准确且可编辑／导出；主创对完整场次的固定版本确认。保留采用原片、实际使用区间、已有音轨／字幕及来源。整集后期承担跨场节奏、统一调色、音乐混音和包装；关键剧情、身份和台词错误不能借后期兜底。

现代少人物对白、反应和简单道具动作是首轮验证样本，不是长期题材、人数、时长或输入硬限制。优先正式可用的 Seedance 等领先服务；品牌网页能力不等于具体 API 账号能力。

## 2. 页面与能力边界

场次制作是核心创作页。镜头制作、剪辑和审阅共享项目、场次、镜头、采用与版本身份。顶部在场次标题旁切换“镜头制作／剪辑”，右侧单独显示带版本与状态的审阅稿入口；审阅继续使用完整工作区，不作为第三个同级编辑页签。制作视图以镜头内容为中心，参考就在当前对象旁；剪辑视图决定实际画面声音字幕；审阅工作区只评论和判断指定固定稿件。离开视图不丢待编辑输入，深链接恢复对象并重新授权。此导航关系已于 2026-09-09 确认，主体采用场次双模式。2026-09-10 已进一步确认当前镜头大预览、中央有界输入、底部分镜条／整场自由画布，以及非模态助手和参考浏览；见[核心体验](../design/scene-walkthrough-review-v0.3.md)与[18](18-canvas-workspace-contract.md)，不改变业务能力范围。

当前采用、剪辑实际使用、已批准 v1 与新草稿 v2 可同时存在。自动状态来自对应事实，不用一个“已完成”字段覆盖全部状态。图片可并排比较，视频先切换播放；场次自由画布支持参考整理和从结果继续尝试。通用可编程流程、多视频同步比较与实时共同编辑继续后置。

## 3. 三类有限 AI 与保存语义

| 用户入口 | 执行与结果 | 使用结果 |
|---|---|---|
| 生成分镜建议 | purpose=script_analysis；固定选区、明确 contextSources 和 proposalTarget；返回 Proposal | 编辑建议后勾选，按指定目标新增镜头；不改已有镜头 |
| 准备本次提示 | purpose=creative_assistance，assistance.kind=prepare_prompt；固定镜头修订、实际参考和目标生成能力版本；返回 AssistanceArtifact | 人工修改后，复制其内容到新的媒体 GenerationPlan，并携带 assistanceSource |
| 按意见准备修改 | 同一目的，kind=prepare_rework；另固定 review/comment、对应版本及 sourceTakeId 或 sourceCutRevisionId | 建议列出保留／修改要求，准备新尝试；不移动旧意见、不自动替换或解决评论 |

文本辅助本身若收费，同样走明确模型、费用估计和执行确认，不能藏在免费“准备”里。AI 结果保存失败或结构无效时不得标作可用建议，实际费用仍记录。三类入口没有跨项目自由搜索、自动改剧情、自动无限重试、任意工具调用或 Skills 平台。

contextSources 只表达用户明确选择的来源及版本；服务端授权后读取文本并保存 contextSnapshots。不能相信请求中的自报 hash，不能把整部剧和所有资产默认为选区上下文。准备修改还保存 feedbackSnapshot（评论修订、正文、观看对象和时间），来源评论后续编辑不改变历史建议。

AssistanceArtifact 原始模型输出与每次人工编辑分别保存为修订。editAssistanceArtifact 用 If-Match；来源只读，body 可改，旧修订可按号码取回。source job 不变，人工编辑不再收费。新视频计划的 assistanceSource 固定 artifactId/revision，只建立来源关系；实际执行以计划完整 resolvedInput 为准，不能运行时偷偷补入建议中的最新文本或参考。建议过期可以查看和复制，但要复查新计划的输入及目标能力。

## 4. 提案直接进入当前场次

proposalTarget/Proposal.target 为判别联合：

- new_structure：仅在当前项目新建提案内 episode/scene/shot 和可选资产建议；未勾选的依赖父项须提示补选。
- append_to_scene：固定 sceneId、sceneRevision、episodeId；仅允许 kind=shot，proposed.sceneId 必须匹配目标。默认在现有镜头之后按提案内顺序追加，position 由事务重新分配，不能利用模型自报位置插入或重排旧镜头。

CSV 两种目标均不调用模型；追加模式先确认行到当前场的映射，跨场输入必须拆批或选择新建结构，不能按同名猜父对象。源摘要、目标和源基线一致时复用原导入提案；不同 target 不是同一次导入。文本 AI 新增镜头保留原文选区与来源。

listProposals 按项目／sceneId 列出 AI 与 CSV 提案，使关闭页面后无需重新导入就能找回。getProposal 可带 revisionNumber 读取历史内容，省略则读当前修订；历史内容只读，生命周期状态反映当前提案状态，采纳仍检查当前修订。

editProposal 保存新的人工修订，保留最初输出及旧修订；仅 proposed 状态可编辑。不得通过编辑改成 update/archive、移除来源证据、引用越权资产或任意换父对象。修改 target 必须重新明确选择有权目标，重新校验整个操作图。

采纳事务依次授权／锁内容根→校验 If-Match=ContentTree.revision、正文 proposalRevision、保存的 baseContentRevision 及 target 当前归属／版本→校验所有选择和依赖→只新增选定内容→递增根版本并固定本次采纳结果。任一项失败全部回滚。applied 提案不能以另一个选择集合再采纳；同键同请求重放原结果，遗漏未选项保留在历史，继续制作可另建新提案。基线过期返回 412 或 PROPOSAL_BASE_CHANGED；editProposal 可在用户看过差异后明确提供新的 baseContentRevision 与 target，不能由后台自动改基线。

## 5. 主创确认与自由试作

制作人员决定镜头划分、景别构图、镜头语言、提示与参考尝试、候选选择及剪辑实验。剧情、正式台词和已确认共同设定发生实质变化时，由项目负责人／管理者作创作确认。新方向先确认，已有已确认资产直接引用，不重复逐镜审批；疑难镜头可提前讨论。

使用不可变 CreativeBasisRevision 保存依据，再以 CreativeConfirmation 记录确认，保持编辑内容与正式依据分开：

| basis.kind | objectId/revision 的来源对象 | 服务端保存的内容 |
|---|---|---|
| script | ScriptRevision.id / revision | 该固定剧本文本；新修订不自动替换正式文本 |
| production | Production.id / revision | brief 与共同默认资产修订 |
| scene | Scene.id / revision | 场次剧情摘要、人物与道具状态、默认资产修订 |
| shot_dialogue | ShotRevision.id / revision | 台词条目与说话人；保留文本来源 |

来源发生受保护内容变更时，在同一保存事务产生 CreativeBasisRevision，包含 snapshot、source object revision、subjectId、contentHash 和 hashVersion。未确认内容同样保存，不依赖先存在确认记录。GenerationPlan 解析实际使用版本；freezeCut 从实际使用依赖和明确审核过的依据中固定 creativeBasisRevisionIds，绝不以冻结时“项目最新值”覆盖已使用旧版本。场次／剧目根后来修改，不丢失旧稿所需的未确认依据。新创建且尚无制作数据的空对象无需伪造完整依据。

资产本身仍复用 confirmAssetRevision，不另建通用审批引擎。confirmCreativeBasis 接收 basisRevisionId 和以下用途；正文不能提交批准者、自报 hash 或任意 snapshot：

- usage=project_default：设置该 subject 的当前正式依据，必须提交 expectedCurrentConfirmationId（首次为 null）。锁定正式指针、校验此前 ID、授权及固定依据后追加确认并切换指针；冲突返回 412。可以明确选定历史依据，不能在用户选择之后静默换成最新对象内容。
- usage=cut_revision：只确认某个固定稿件所引用的依据，必须提交 cutRevisionId，且该稿确实引用此 basisRevisionId。锁定稿件／审阅 subject 并校验授权后追加确认，不改变项目当前正式指针；因此可在新草稿存在时继续审核旧稿。

确认记录保留使用范围、确认者、时间与不可变快照；project_default 另留前次指针。相同作用域、依据、确认用途的幂等重放返回原记录；不能跨稿件复用 cut_revision 限定确认。已有项目默认确认可用于新稿中语义相同的固定依据；新确认只影响明确的使用关系，不倒改旧稿。

contentHash 用版本化的规范化规则计算受保护含义：剧情正文、人物／道具叙事状态、共同资产版本；台词为稳定对白身份、说话人和准确文字。镜头编号、构图、运镜、提示措辞、表演试作备注和显示顺序不计入台词确认 hash；来源修订 ID 仍另行留存。换镜头表达但继承相同对白身份与准确文本，不要求重批同一句话。不能把 AI 自称“语义相同”当作正式台词不变。新拆／合后对白身份无法明确对应，须人工核对再确认；不得因长度相同就认作无变化。

编辑旧内容仅产生新草稿／修订，旧正式依据继续存在；使用草稿可试作，生成检查展示偏离正式依据的项，不把确认做成每次生成许可。冻结场次时固定实际 creativeBasisRevisionIds、当时已有的 creativeConfirmationIds 及实际镜头／台词修订；主创批准前，系统列出所用内容与确认记录的缺失／不一致，需按 project_default 或 cut_revision 明确确认匹配的固定依据后再批准。审批时新增的确认记录在 Review.creativeConfirmationIds 及审计中固定，不改写冻结稿原有确认列表。批准旧稿按该稿的固定内容判断，不要求后来新草稿退回旧状态。系统检验引用与文字关系，人工判断实际画面、表演和声音；不得把确认文本误当已经在视频中实现。

确认创作内容不等于审片通过。前端可以在一次审片会话中逐项确认变更再作正式决定；中途失败保留已完成确认，明确尚未批准，不伪装成一次全成功。对审核对象没有足够来源关系的外部稿，主创对固定文件及所声明正式依据人工检查，来源未知如实保留，不能生成虚假的逐镜证据。

## 6. 场次主责与整集闭环

Task.kind=scene_owner 是每场唯一的主责任务，必须关联同项目 sceneId 和有效项目成员；禁止同时绑定一个 shotId 使责任范围含混。任务完成后仍保留主责历史，负责人改派更新同一任务并留审计。协作者可更新自己的处理状态与结果，不可改派、扩大范围或确认他人的正式创作依据。失去项目资格的成员不能继续工作；页面显示原负责人及待重新分配，不隐式给其他成员扩权。

协助／返工另建 kind=assist/rework，可按需关联 scene/shot/comment；有 scene 和 shot 时必须同属。通用任务 kind=general 保留。场次主责并不独占编辑锁，CAS 冲突仍需保留输入、比较后保存。

整集可把已固定场次渲染媒体作为主轨片段组接，沿 media.sourceRenderTaskId 保留到场次 CutRevision 的固定来源；剪辑改动不会替换场次旧版。评论先映射本集所用媒体及源区间，支持打开对应固定场次版本继续定位；不承诺跨多次外部精剪自动还原源镜头。全包需要保留已知平台依赖闭包中的原片和可读关系；无映射的外部内容明确未知，不伪造原始素材。

场次批准表示可进入整集；新场次版本不继承批准，整集也不继承场次批准。最终交付必须绑定已批准的整集／外部整集固定稿。第二集引用明确角色／造型／场景版本，升级须主动选择；不强制复制上一集所有媒体。

## 7. 新增数据、接口与验收

| 落地点 | 本轮新增内容 |
|---|---|
| M02 | analysis_proposals.target；analysis_proposal_revisions（原输出／人工修订／基线）；assistance_artifacts 与 assistance_artifact_revisions；creative_basis_revisions、creative_confirmations 与明确的当前正式指针／固定依据关系 |
| M04 | PlanInput 的 proposalTarget/contextSources/assistance/assistanceSource，解析来源快照；Job 的 assistanceArtifactId；文本辅助仍走预算和未知提交协议 |
| M05 | 固定稿及审阅决定记录创作确认 ID；不把确认关系存成无法授权或检索的 JSON-only ID 数组 |
| M06 | production_tasks.kind/scene_id 与每场唯一主责；审计改派／停用影响 |
| 接口 | listProposals、getProposal（可选修订号码）、editProposal；list/get/editAssistanceArtifact、getAssistanceRevision；getCreativeBasisRevision、listCreativeConfirmations、confirmCreativeBasis；原 createGenerationPlan/applyProposal 等补充新字段 |
| 验收 | AT-47 当前场次提案；AT-48 持久建议与新计划；AT-49 创作确认；AT-50 场次责任；AT-51 场次进入整集及新版本独立批准 |

基础 SQL 必须带 tenant/project 复合 FK；提案／建议原始输出不可改，修订 unique(root_id,number)。creative basis revision、formal confirmation 的实际来源与 subject 外键按受支持类型使用明确列及 CHECK，不能允许任意 target_type/id 指向其他对象。创作确认、范围权限与版本检查放在业务模块，按钮显隐不构成保护。完整状态、预算、剪辑及恢复不变量继续按 03／04／06／11。

## 8. 本轮决定与后续验证分开

已定：短剧优先、场次主责、两类编辑视图与独立固定稿审阅、三类有限 AI、明确生成与替换、正式创作依据、场次和整集独立审阅、完整 MVP 含整集及跨集复用。仍待事实：真实账号与预算、真实输入和模型效果、实际工作室可用性、容量与恢复演练。后续研究：画布净收益、方法／Skills 沉淀、更多 Agent 自动化、广告入口及外包。这些研究不构成重新选择既定范围的前置条件；正式工程仍遵循用户暂停要求，待明确开工后按16实施。

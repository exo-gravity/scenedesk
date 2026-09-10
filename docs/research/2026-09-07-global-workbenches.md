# 国际 AI 叙事制作工作台调研：LTX Studio、Google Flow、Morphic、Katalist

访问日期：**2026-09-07**。研究对象是中小 AI 短剧工作室的团队生产，**不把团队规模限定为 10 人**。本报告独立检索市场产品，未读取、未以本项目既有 v0.1 方案选择结论。

## 证据边界

- **文档核实**：已读取官方帮助中明确的操作流程、限制或角色定义。它证明官方有相应产品说明，**不等于本次实测成功**。
- **官网宣称**：产品页、销售页、公告或套餐卡片写明，但本次未实际执行。
- **待核实**：本次官方资料不足、不同官方页面冲突，或必须进入账号/付费流程才能确认。**资料缺失不等于产品不支持**。
- 本次实际完成的是公开网页与官方文档核查；没有付费、没有生成影片，没有验证长剧一致性、中文对白、并发稳定性、真实成片率、导出保真度或售后响应。因此不做画质、效果或“最好”排名，也不把营销效率数字用作产能基线。
- 四个产品均经过 web 搜索和网页打开。Morphic 部分帮助页对 web 读取器返回 `text/markdown` 不兼容，补用其**官方同址 `.md` 文档**读取正文；未使用第三方评测替代。旧搜索摘要与当前正文冲突时，以读取到的正文说明情况。

## 核心观察

国际工作台已经跨过“接几个生成模型”的阶段：**剧本/分镜规划、参考资产复用、局部重做、素材编排和交付**构成共同竞争面。区别主要在它们如何组织故事、让团队判断版本，以及如何计算多人生产成本。

| 产品 | 当前更突出的组织方式与定位 | 对短剧工作室最值得对照的部分 |
|---|---|---|
| LTX Studio | 剧本拆场拆镜、Elements、分镜与镜头编辑；官网同时面向电影人、广告公司和内部制作团队 | 生成前的结构确认；跨镜头资产引用；局部 Retake；创意方案和剪辑交付并行。[产品首页][L0]、[分镜更新][L1] |
| Google Flow | 项目内资产/集合、角色引用、Agent、镜头历史、Scenebuilder | 已有可追溯的镜头迭代和视觉/声音角色引用；不能再按最初的单段生成器理解。[Agent 帮助][F1]、[资产帮助][F2]、[编辑帮助][F3] |
| Morphic | Project → File/Canvas，Copilot、共享资产库、Compose，以及同画布协作 | 把视觉探索、团队共享、空间/时间评论和成片编排连接起来；组织共享额度是实质性的团队能力。[项目帮助][M1]、[评论帮助][M3]、[额度帮助][M8] |
| Katalist | 分镜/Story Canvas/Timeline 路径仍有帮助文档；**当前首页主轴已是效果广告团队、素材复用和产品替换** | 剧本与角色/场景卡片的引用关系、分镜到剪辑工程交付；其当前商业入口和旧自助套餐存在口径差异。[当前首页][K0]、[Story Canvas 帮助][K1] |

这四者都不是“已证明适合批量生产完整短剧”的结论。应区分 **有一个完整创作路径**、**团队可以同时使用**、**能持续按期交付多集短剧**这三件事；本次只对前两项的公开证据进行核查。

## 1. LTX Studio：以结构化分镜和共享创意控制为中心

| 核查项 | 证据与边界 |
|---|---|
| 剧本与故事层次 | **官网宣称，有步骤说明**：2026-01-06 更新公告写明，上传剧本后先拆成 scenes/shots，显示每场镜头数和每镜脚本文字，再检查提取的 Elements 后生成。支持“先审结构，再花生成成本”的流程。未核实独立的剧集/季结构、稳定镜头编号或剧本变更传播规则。[分镜更新公告][L1] |
| 一致性与资产 | **官网宣称**：Elements 可保存角色、地点、对象及品牌元素，在场景和项目间复用。它是可引用资产机制；“保持一致”是官方效果承诺，本次未测角色转身、换装、多人同框及跨集漂移。[Shot Editor][L2] |
| 镜头编辑与重做 | **官网宣称**：控制景别、机位、构图、时长；Retake 可改局部片段动作、情绪或对白，避免全片重生。未核实哪些操作受生成模型/套餐约束，也未测试重做后其余片段是否完全不变。[Shot Editor][L2] |
| 音频、剪辑、导出 | **官网宣称**：编辑器可加入旁白和音乐，支持 timeline、MP4/XML/自动 pitch deck 输出。XML 的具体剪辑软件兼容性、音频分轨/字幕/转场保留范围未实测；不可把独立 **LTX Desktop** 的 NLE 能力直接归到网页 Studio。[Shot Editor][L2]、[网页视频编辑器][L3] |
| 团队与权限 | **文档核实，2026-04-01 更新**：Owner/Editor 均可编辑；Editor 可生成和删除资产，但不能删整个项目或改访问权限；Owner 可调整角色、共享链接和所有权。Pro 每项目最多 **3 位编辑协作者，包含本人**；Enterprise 支持更多协作者。[协作者帮助][L4] |
| 多人额度的关键限制 | **文档核实**：邀请协作者加入项目，不会把对方加入自己的订阅。每人用自己的套餐功能和 credits；该协作路径没有共享池，也不能转额度。不能把“3 collaborators”解读成购买一个 Pro 得到三个付费席位。[协作者帮助][L4] |
| 审片边界 | 官网写有反馈和实时协作，但本次未获得足够文档证明其时间码批注、必经审批、锁版、客户只读审片、逐版本签核等完整流程。不能据此断言不支持。[产品首页][L0] |

**套餐快照（官网标价，美元；未进入结账）**：Free 一次性 800 credits；Lite $15/月；Standard $35/月、28,000 credits/月；Pro $125/月、110,000 credits/月。年付分别显示 Lite $12/月、Standard $28/月、Pro $100/月。商业使用许可证从 Standard 起；Free/Lite 是个人用途。Standard 列 AI Storyboards、保存/创建 Elements、Pitch Decks；Pro 列 3 人项目协作。Enterprise 询价，列组织级额度分配/用量报告、SSO、集中账单及不限协作者。**企业额度管理是单独套餐承诺，不能用来推翻自助 Pro 的个人额度规则。**[当前定价页][L5]

定价页仍混有 2025-12-12 到期的促销脚注，以及 credits/Computing Seconds 两种文案。以上只取清楚的基础标价与套餐门槛，不把过期促销、赠额或“无限生成”写进预算；购买时应核实账号实际权益。[当前定价页][L5]

**可借鉴的产品决定（研究判断）**：让剧本拆解、角色/场景确认和画幅在第一次批量生成前可审；将镜头作为持续修改的对象；保留向剪辑师和客户分别交付的出口。差异化不应建立在“它没有团队协作”上，而应检验自家能否把编剧、分镜、生成、美术、配音和审片的责任与版本连起来。

## 2. Google Flow：镜头迭代、可复用角色和 Agent 正在进入工作台层

| 核查项 | 证据与边界 |
|---|---|
| 剧本与故事层次 | **文档核实**：Agent 可规划 storyboard、mood board，把概念变为可执行提示；也能批量生成、编辑和整理素材。项目下有资产、可嵌套 Collections、Scenes 和 Scenebuilder。未找到可证明“导入完整剧本 → 持久 scene/shot 表 → 与原剧本双向更新”的资料，不把 Agent 会讨论故事等同于完整剧本数据模型。[Agent][F1]、[项目与资产][F2] |
| 一致性参考 | **文档核实**：Ingredients 复用人物/对象参考；可设置首尾帧。角色对象可打包视觉与声音引用，至少需一张图；声音引用使用有具体生成模式限制。文档中的严格一致性表述仍是效果承诺，未实测跨镜稳定率。[视频生成][F4]、[角色与资产][F2] |
| 镜头编辑、重做、版本 | **文档核实**：编辑不丢原视频，History 保存旧版本和生成提示，可将旧版重新保存进项目。可提取画面作后续引用；Extend 当前仅限 Veo 生成视频；扩展片段不能再用部分编辑模式。上传视频精修还有大小、时长和区域限制，不能宣传成无限时长任意修改。[编辑帮助][F3] |
| 剪辑与交付 | **文档核实**：Scenebuilder 能排序、裁切片头片尾、预览并下载 scene；项目/集合/单项资产均有下载入口。此证据不证明专业 NLE 工程互换、多轨混音或整集字幕工作流。角色声音/原生音频是生成能力，也不自动等于配音导演和音频后期能力。[编辑帮助][F3]、[项目与资产][F2] |
| 协作与审片 | **文档核实**：公开图片/视频分享链接，持链接者可查找和使用内容，可选附带输入；文档写撤销该分享需删除原创作。该入口不能当作私密客户审片室。项目编辑角色、受限审片访客、时间码审批状态，本次未充分核实。[分享帮助][F2] |
| 企业账号与额度管理 | **官方公告核实**：2026-01-16 公告（1 月 14 日起推出）将 Flow 作为 Workspace additional service，管理员可按域、组织单位和群组启停。2025-10-21 Ultra for Business 公告说明按用户额度、超额开关/上限及审计日志。这些是账号/费用治理，不等于同一项目内的创作协作权限。[Workspace 公告][F6]、[超额管理公告][F7] |

**套餐与时效**：当前额度帮助显示，无订阅有每日 50 credits；Plus/Pro/Ultra $100/Ultra $200 对应月度额外 200/1,000/10,000/25,000 credits；月度额度不结转，单次请求可能产生多项计费生成。此处美元名称沿用帮助页，并非所有地区的含税结账价。可增购性存在**官方冲突**：Flow 帮助列 Plus 可增购，Google One 的购买页却明确只允许 Pro/Ultra、排除 Plus 和日本。因此不能承诺 Plus 可持续追加产能。[Flow 额度帮助][F5]、[Google One 增购帮助][F8]

同一帮助的部分平台/语言版本仍把每日免费额和付费月额描述为替换关系，而本次英文主页面写每日额另加月额。入门页又将订阅列为访问条件，同时额度页允许非订阅尝试。这些是**入口/页面同步问题，未通过账户验证**，不宜据此计算每天可产多少镜头。免费额度还不适合作为团队交付保障。[额度页][F5]、[入门页][F9]

**商业使用口径**：入门 FAQ 指向整体服务条款，并说明 Google 不主张生成原始内容的所有权；它不是“付费即获得一切第三方权利”的承诺。官网列有 Workspace 用户入口，也不应套用 Vertex AI 的采购、赔偿或数据承诺。[入门 FAQ][F9]

**动态证据**：Google 2026-05-20 的 I/O 公告已介绍 Flow 中的对话式视频修改和身份/声音一致性，当前帮助也有可操作说明。因此使用 2025 年早期资料评估 Flow 会漏掉重大能力。[I/O 2026 公告][F10]

**可借鉴的产品决定（研究判断）**：一个镜头下保存生成历史、提示和输入；可从已认可的画面继续生成；用可复用角色对象连接外形和声音；让 Agent 操作落在项目实体上，同时保留成本控制。要继续验证的差异在“批量短剧的生产治理”，而不是仅有的镜头生成能力。

## 3. Morphic：共享视觉画布、资产评论和成片编排

| 核查项 | 证据与边界 |
|---|---|
| 剧本与层次 | **文档核实**：Copilot 可按脚本生成分镜，把故事拆成视觉场景；Project 内可管理多个 File，每个 File 有自己的 Canvas。另有参考图和九宫格分镜方法。未证明每幅图都天然是带稳定编号、对白、资产引用和审批状态的生产镜头。[剧本分镜帮助][M0]、[Projects][M1] |
| 一致性资产 | **文档核实**：组织资产库收纳上传/生成内容，跨 File 可用；官网介绍角色模型与分层编辑，创作指南建议对角色、地点、产品建立参考图。共享资产是真实的文档机制，“完全保持一致”的效果未实测。[Assets][M2]、[产品页][M5]、[制作指南][M10] |
| 镜头编辑与续接 | **文档核实**：可提取末帧或指定帧回到 Canvas，作为新生成的首帧/参考；生成后用 Compose 拼接。**官网宣称**有图层、局部移除/替换、逐项变化探索。没有验证编辑后的时序稳定性，也不把画布中的 variations 自动等同完整审计历史。[续接帮助][M6]、[产品页][M5] |
| 音频与剪辑 | **文档核实**：可从视频添加音轨，也可先生成 speech/music/SFX；支持音轨切分、拖动和边缘裁切。Compose 的官网说明支持图像、视频、音频、文字和转场进入时间线，切分/修剪/移动；续接帮助写最高 4K 导出。对字幕工程、AAF/XML/EDL、复杂混音和重链保真度未核实。[音频帮助][M7]、[产品页][M5]、[续接帮助][M6] |
| 实时协作 | **文档与公告核实**：2026-02-11 Live Collab 发布，同 Canvas 可同时生成/编辑，显示光标并跟随成员视角；图像、视频、图层和 variations 共享。当前帮助限定 Team plans。[Live Collab 公告][M4]、[Live Collab 帮助][M11] |
| 权限与资产审片 | **文档核实**：组织角色有 Admin/Member；资产评论可附在整体、点、区域和视频时间戳，支持线程回复、解决/重新打开、查找和评论链接。因此不能把 Morphic 说成“只有白板、没有审片”。但外部客户只读访客、强制签核、批准版本冻结、跨客户资产隔离粒度仍待核实。[成员帮助][M9]、[评论帮助][M3] |

**套餐快照与团队成本**：当前定价页列 Basic/Standard 为单人；Pro 为 1 人另可加 4 人，Pro Max 为 1 人另可加 9 人，Enterprise 定制。文档明确额外席位 **$10/人/月**，组织用户上限分别 5/10，组织内共享 credits；月额先用、月末未用不结转，另购包按有效期保留，只有组织管理员可买包。**10 人是某个自助套餐上限，不是这类工作台或目标市场的团队规模定义。**[定价页][M12]、[额度文档][M8]

定价网页本次可读取金额中同时出现基础数字 `$9/$24/$45/$170` 和动态 `$0` 占位，故这些不是已核实应付月费；应在结账/销售报价中确认。可清楚读取的月额度为 1,100/3,625/6,350/24,650，Pro 两档共享。页面列付费方案商业使用和无水印；本次未评估完整合同许可。搜索摘要里的旧充值包金额/点数与当前正文已不同，本报告不用旧索引计算成本。[定价页][M12]、[额度文档][M8]

**可借鉴的产品决定（研究判断）**：制作与反馈共用资产对象；批注定位到画面区域或具体时刻；共享库和共享成本池面向组织。自由 Canvas 适合探索，但面向多集短剧，还应验证是否需要一个独立于空间排布的镜头台账、负责人和批次进度视图。该建议是需求假设，并非 Morphic 已被证明缺失这些能力。

## 4. Katalist：分镜到 Timeline 路径之外，当前主打广告资产复用

| 核查项 | 证据与边界 |
|---|---|
| 当前定位 | **官网宣称**：首页面向 performance teams/agency，强调复用表现好的视频、产品替换、角色/声音替换、本地化、多 SKU 和多客户扩展。保留脚本 → 分镜 → 视频路径，但不能再把首页定位概括为只面向叙事电影人。[当前首页][K0] |
| 剧本与层次 | **文档核实**：Story Canvas 导入剧本后，Script Sidebar 自动分 scenes/shots；把 scene 加入 Canvas，再生成角色、地点和镜头卡片。旧帮助又会把 scene/frame 混称；不要据此推导严格的数据模式或跨集编排能力。[Story Canvas][K1]、[完整教程][K2] |
| 一致性与镜头控制 | **文档核实**：先生成角色/地点，角色会自动赋给引用它的 frame card；各卡可改提示、画幅、分辨率等。支持静帧转视频、单镜重生。旧完整教程列角色姿势、裁切、区域修改、景别/视角；本次未验证这些旧编辑入口在新版 Canvas 中逐项保留。[Story Canvas][K1]、[完整教程][K2] |
| 音频与口型 | **文档核实**：旁白在 Timeline 选择 TTS，或上传 MP3/WAV 并对齐；2025-11-07 文档明确初始视频创建不再自动从剧本生成音频。2026-07-09 口型帮助写 paid plans 可用、试用不可用，建议短对白并避免一镜多说话人。不能用营销页“自动临时配音”推断所有项目自动完成对白。[旁白帮助][K3]、[口型帮助][K4] |
| 剪辑与导出 | **文档核实**：Timeline 可排列片段后整片导出；Premiere 交付为 ZIP，内含 XML 和媒体，导入后按顺序形成 sequence。字幕、场景元数据、复杂音轨/转场是否无损保留需要实测；Agentic 页面对此有更强宣称，不能当成已测试结果。[Story Canvas][K1]、[Premiere 导出帮助][K5]、[Agentic 页面][K6] |
| 团队与审片 | **套餐/官网宣称**：旧定价页 Unlimited 含实时协作和 2 seats；Enterprise 列 unlimited users。Agentic 页面写客户评论可被 Agent 理解并生成新版本。没有足够当前帮助证明角色矩阵、客户可见范围、强制审批或意见冲突的处理；“comments → iterations”也没有本次实测。[旧定价页][K7]、[Agentic 页面][K6] |

**不能忽略的商业入口冲突**：当前首页 FAQ 写免费注册领 credits、无需信用卡，额度用完后预约通话选择方案；仍在线的旧定价页则写 7 天试用和自助 Essential $19、Pro $39、Unlimited $99/月，其中 Unlimited 无限的是图像额度，视频仍列 3,000 credits/月，并含 2 seats。年付区块还保留不同价格/权益文案。因此这些只是**仍在线旧页面的套餐快照，不保证新用户能按相同条款购买新版 Canvas**。[首页][K0]、[定价页][K7]

旧定价页列 Essential 5 项目/1 自定义角色、Pro 20 项目/10 角色，Unlimited 不限项目/角色并列 200+ frames/project；但 2026-01-29 教程建议项目保持 50–100 frames 以避开性能问题，并建议长项目拆分。它们是不同性质的证据：**套餐允许量不等于推荐稳定工作量**。[定价页][K7]、[完整教程][K2]

**商业使用条款也需单独确认**：官网合并的 Privacy/Terms 页面 §2.7 说用户保留上传及生成内容权利；§2.1 又对 Site 访问使用写个人非商业许可。不能只摘一句“内容归你”得出“任何套餐均可直接承接商业项目”的合同结论。此处记录官方文案冲突，不替供应商作法律解释；采购应获取适用新版服务和套餐的明确条款。[Privacy/Terms][K8]

**可借鉴的产品决定（研究判断）**：从剧本中建立角色/地点与镜头的引用关系，在昂贵视频生成前确认分镜；向既有剪辑软件输出可继续工作的工程包。其广告变体方向还提示：复用的不应只是提示词，也应包括已经验证过的参考资产、镜头方案和客户修改。面向短剧则要验证跨集叙事连续性，而不是直接照搬商品替换入口。

## 对中小短剧工作室 MVP 的启发

以下是基于上述产品路径提出的**产品假设**，不是对竞品缺失能力的判定，也不是本项目已经确定的需求。

1. **把可审核的剧本拆解作为第一份产物。** 创建“项目/剧集（可选）→ 场 → 镜头”结构，镜头保留原文锚点、对白、时长意图、人物/场景引用。先允许人改拆分，再批量生成。验证点是拆解校正是否减少后续返工，不是能否一次产出最多图。
2. **镜头应长久存在，生成结果是它的候选版本。** 保留引用资产版本、输入、关键参数、生成状态/成本、当前采用版本和返工原因。Flow 的 History 与 LTX 的 Retake 表明这类能力已进入竞争基线；更深的价值可能是把它和导演选片、后续剪辑采用状态连接。
3. **资产复用需要可追踪的引用，而不只是文件夹。** 同一角色的形象、服装状态、声音和地点参考应能被多个镜头显式引用；替换参考时列出受影响镜头，避免默认全量重生。这里的引用追踪是建议，不是已验证的竞品实现。
4. **团队最小闭环是分工、评论、返工和认可版本。** 至少区分管理、制作、审阅权限；评论能指向镜头版本与时间点，且有解决/重开。Morphic 已有空间/时间评论，只有通用聊天室很难形成充分差异。是否需要客户访客、最终签核、锁版，应通过工作室访谈确认。
5. **成本呈现以可交付镜头和返工为单位。** 团队人数、可编辑协作者、付费席位、生成额度、商业许可是不同维度。Morphic 的组织共享、LTX 的个人额度、Google 的按用户超额控制展示了不同方案；MVP 应明确账户责任、生成前预估、余额不足和重试成本，不把 credits 数跨供应商直接相加比较。
6. **先做到可信的剪辑交付，再决定完整 NLE 范围。** 成片预览、基本裁切/排序、旁白与音乐对齐、单镜下载、媒体包和镜头清单可以形成闭环；优先实测 XML/字幕/音轨等交付约定，再决定是否扩大多轨编辑。Katalist 的 XML+素材说明是比“支持导出”更有用的对照。

**建议下一阶段统一验证任务**：用同一份原创中文小剧本，覆盖两位重复角色、一个复用地点、一次服装状态变化、对话与反打，以及至少一轮导演退回。记录拆镜纠错耗时、每镜尝试次数、资产漂移、多人冲突、审片闭环和剪辑工程保留内容。只有这一层验证才能比较工作室真实交付成本；本报告没有用官网 showcase 替代这项测试。

## 来源台账与重要日期

以下链接全部为官方来源，访问日期统一为 **2026-09-07**；“未标明”表示正文没有稳定的绝对更新日期。动态页面无法据搜索引擎抓取时间反推功能发布日期。

| 编号 | 官方来源 | 正文日期/用途 |
|---|---|---|
| L0 | [LTX Studio 首页][L0] | 未标明；当前定位、协作概述 |
| L1 | [Storyboard Generator 更新][L1] | **2026-01-06**；结构和生成前确认 |
| L2 | [Shot Video Editor][L2] | 未标明；Retake、Elements、音频和导出宣称 |
| L3 | [AI Video Editor][L3] | 未标明；网页 Studio 编辑入口 |
| L4 | [Adding collaborators][L4] | **2026-04-01**；角色、3 人含本人、个人套餐额度 |
| L5 | [LTX 当前定价页][L5] | 未标明；包含 **2025-12-12** 到期促销残留 |
| F1 | [Flow Agent][F1] | 未标明；Agent 操作、项目会话、生成确认 |
| F2 | [Flow 项目/资产/集合][F2] | 未标明；角色、引用、分享与下载 |
| F3 | [Flow 编辑和 Scenebuilder][F3] | 未标明；版本、修改限制、场景编排 |
| F4 | [Flow 视频生成][F4] | 未标明；Ingredients、首尾帧与声音引用 |
| F5 | [Flow 额度][F5] | 未标明；当前月额/日额，注意平台版本冲突 |
| F6 | [Workspace additional service 公告][F6] | **2026-01-16**，推出开始 **2026-01-14** |
| F7 | [企业超额额度管理][F7] | **2025-10-21**，超额计费开始 **2025-11-01**；历史公告，不等同本次报价 |
| F8 | [Google One 增购帮助][F8] | 未标明；与 Flow 的 Plus 增购口径冲突 |
| F9 | [Flow 入门与 FAQ][F9] | 未标明；访问和商业使用口径 |
| F10 | [Google I/O 2026 汇总][F10] | **2026-05-20**；Flow 对话编辑和声音/角色更新 |
| M0 | [Morphic 剧本分镜][M0] | 相对更新日期；当前路径由 workflows 转到 how-tos |
| M1 | [Morphic Projects][M1] | 未标明；官方 Markdown 正文 |
| M2 | [Morphic Assets][M2] | 未标明；官方 Markdown 正文 |
| M3 | [Morphic Comments][M3] | 未标明；官方 Markdown 正文，不能沿用旧搜索摘要判缺失 |
| M4 | [Morphic Live Collab 发布][M4] | **2026-02-11** |
| M5 | [Morphic 产品页][M5] | 未标明；Canvas/Compose/图层/角色模型宣称 |
| M6 | [Morphic Extend video][M6] | 未标明；官方 Markdown 正文、Compose 和 4K 出口 |
| M7 | [Morphic Audio generation][M7] | 未标明；官方 Markdown 正文、音轨编辑 |
| M8 | [Morphic Plans & Credits][M8] | 未标明；当前 Markdown，避免旧索引的 credits 表 |
| M9 | [Morphic Members][M9] | 未标明；官方 Markdown 正文、Admin/Member |
| M10 | [Morphic 完整制作指南][M10] | 未标明；创作/音频/Compose 宣称 |
| M11 | [Morphic Live Collab 帮助][M11] | 未标明；官方 Markdown 正文、Team plans |
| M12 | [Morphic Pricing][M12] | 未标明；金额读取有动态占位，不视为结账价 |
| K0 | [Katalist 当前首页][K0] | 未标明；广告团队定位、新试用/销售入口 |
| K1 | [Katalist Story Canvas][K1] | 页面只写 “Updated over a month ago”；不推算确切日期 |
| K2 | [Katalist 完整教程][K2] | **2026-01-29**；旧编辑流程与 50–100 帧建议 |
| K3 | [Katalist 旁白帮助][K3] | **2025-11-07** |
| K4 | [Katalist 口型帮助][K4] | **2026-07-09**；付费/试用限制 |
| K5 | [Katalist Premiere 导出][K5] | **2025-07-16**；ZIP/XML/媒体路径 |
| K6 | [Katalist Agentic Storyboarder][K6] | 未标明；自动评论返工等宣称 |
| K7 | [Katalist 仍在线定价页][K7] | 未标明；与当前首页商业入口冲突 |
| K8 | [Katalist Privacy/Terms][K8] | 未见明确当前生效日；商业许可措辞需要澄清 |

[L0]: https://ltx.io/studio
[L1]: https://ltx.io/blog/ltx-storyboard-generator-update
[L2]: https://ltx.io/studio/platform/shot-video-editor
[L3]: https://ltx.io/studio/platform/ai-video-editor
[L4]: https://help.ltx.io/hc/en-us/articles/33650434265362-Adding-collaborators-to-your-project
[L5]: https://ltx.io/studio/pricing
[F1]: https://support.google.com/flow/answer/17093911?hl=en
[F2]: https://support.google.com/flow/answer/16935308?hl=en
[F3]: https://support.google.com/flow/answer/16935718?hl=en
[F4]: https://support.google.com/flow/answer/16353334?hl=en
[F5]: https://support.google.com/flow/answer/16526234?hl=en
[F6]: https://workspaceupdates.googleblog.com/2026/01/flow-available-additional-google-service-workspace.html
[F7]: https://workspaceupdates.googleblog.com/2025/10/ai-credit-overages-admin-control-and-related-billing.html
[F8]: https://support.google.com/googleone/answer/17103110
[F9]: https://support.google.com/flow/answer/16353333?hl=en
[F10]: https://blog.google/innovation-and-ai/technology/ai/google-io-2026-all-our-announcements/
[M0]: https://morphic.com/docs/how-tos/storyboarding/storyboarding-using-a-script
[M1]: https://morphic.com/docs/getting-started/dashboard/projects.md
[M2]: https://morphic.com/docs/getting-started/assets.md
[M3]: https://morphic.com/docs/collaboration/comments.md
[M4]: https://morphic.com/blog/introducing-live-collab
[M5]: https://morphic.com/studio
[M6]: https://morphic.com/docs/how-tos/extend-video.md
[M7]: https://morphic.com/docs/audio/audio-generation.md
[M8]: https://morphic.com/docs/pricing/plans-and-credits.md
[M9]: https://morphic.com/docs/account-and-billing/settings/members.md
[M10]: https://morphic.com/resources/how-to/solo-creator-full-production
[M11]: https://morphic.com/docs/collaboration/live-collab.md
[M12]: https://morphic.com/en/pricing
[K0]: https://www.katalist.ai/
[K1]: https://help.katalist.ai/en/articles/16298583-how-to-build-your-storyboard-and-videos-in-story-canvas
[K2]: https://help.katalist.ai/en/articles/10643422-how-to-make-complete-ai-videos-with-katalist-full-tutorial
[K3]: https://help.katalist.ai/en/articles/12743528-how-can-i-add-and-customize-a-voiceover-in-katalistai
[K4]: https://help.katalist.ai/en/articles/12781817-how-to-add-a-lip-sync-in-katalist
[K5]: https://help.katalist.ai/en/articles/11785146-how-to-export-a-katalist-project-for-adobe-premiere-pro
[K6]: https://www.katalist.ai/agentic-storyboarder
[K7]: https://www.katalist.ai/katalist-pricing
[K8]: https://www.katalist.ai/privacy-policy

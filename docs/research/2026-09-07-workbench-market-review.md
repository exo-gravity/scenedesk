# AI 短剧内容工作台：市场复核与方案调整

资料状态：本文保留当次市场证据及历史方案建议。第 4–5 节的迭代安排（包括早期客户审片建议）已被后续范围讨论更新；当前优先级和 MVP 以 [整体基线](../ai-video-platform-mvp-plan-v0.2.md) 与 [短剧主稿](../ai-drama-workbench-product-design-v1.0.md) 为准。研究快照不自动成为当前研发清单。

调研日期：2026-09-07。目标：为中小 AI 短剧工作室团队设计产品，不设 10 人上限。本文汇总本轮独立研究，并审查上一版方案；当前设计见 [v0.2](../ai-drama-workbench-core-design-v0.2.md)。

## 1. 选择产品的依据

“值得对标”按与目标工作流的相关性、创作链路完整度、多人生产证据以及官方资料可核查程度判断，不是画质或市场份额排名。没有把某个基础视频模型直接列为工作台，也没有以宣传片数量、融资额、注册量或厂商效率百分比判断好坏。

先分别重新发现国内、国际候选，再对照创作、资产、局部重做、视听交付和协作。两份地区研究未读取旧方案；主研究在取得证据后进行 review。LibTV 属同日补充复核，其官方指南本轮重新打开超时，详细操作沿用上一轮同日已读正文，已在专项记录标明。

证据分三种：**文档确认**（官方给出步骤或限制）、**官网宣称**（产品页/发布说明）、**未知**（不足以判断或官方页面冲突）。这三种都不是付费实测。本轮没有执行生成质量盲测、多人同时制作或剪辑工程往返，不能宣称某产品能稳定量产完整短剧。

## 2. 优先对标清单

以下排序是研究优先级，不代表效果高低。

| 产品 | 主要参照价值 | 本轮证据支持的重点 | 边界与设计含义 |
|---|---|---|---|
| LTX Studio | 结构化叙事与导演制作流程 | 剧本拆场拆镜、Elements、镜头参数、Retake、MP4/XML；协作规则有帮助文档 | 生成前确认结构值得借鉴；Pro 协作者各用个人套餐/额度，不能当共享生产账户。[分镜公告](https://ltx.io/blog/ltx-storyboard-generator-update)、[镜头编辑器](https://ltx.io/studio/platform/shot-video-editor)、[协作者规则](https://help.ltx.io/hc/en-us/articles/33650434265362-Adding-collaborators-to-your-project) |
| LibTV | 中文剧本、资产、分镜与模型工具的衔接 | 同日已读指南覆盖脚本资产化、镜头编辑、按范围批量生成，画布与脚本共存 | 可作为直接流程参照；团队权限/预算细则不足以判断，不能将它们当成已知缺口。[脚本指南](https://resonate.feishu.cn/wiki/Loxfw6XHziYRk0kKzdjcFfp9nhb#Gp7IdiGn5oIWygxc9xecnVzPnfb) |
| Higgsfield Cinema Studio | 影视创作控制和团队共同导演 | 项目与镜头参数分层、Elements、原生音频、共享项目、Project Brief、区域编辑 | 说明创作控制和共享设定需要前移；公开页面对版本、时长有差异，具体模式必须核验。[操作帮助](https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-cinema-studio)、[团队创作发布说明](https://higgsfield.ai/blog/cinema-studio-4-0) |
| Morphic | 视觉探索、共享资产、反馈与成片编排 | Project/File/Canvas、组织资产、Compose、音轨、同画布协作、时间/区域评论 | 不能把“画布产品”视为缺少协作或审片；应提供创作与管理多视图，而不是增加一套重复录入。[项目帮助](https://morphic.com/docs/getting-started/dashboard/projects.md)、[评论帮助](https://morphic.com/docs/collaboration/comments.md)、[音频帮助](https://morphic.com/docs/audio/audio-generation.md) |
| 有戏 AI | 国内短剧/漫剧的完整路径和团队共创 | 分集、主体、分镜、多候选、批量生成、成片与剪映草稿；操作 FAQ 暴露具体限制 | 对非破坏修改、声音独立、费用与权限一致性有直接启发；导出兼容性尚未实测。[官方指南](https://xih9dyxxwc2.feishu.cn/docx/FKnxdoPeKobckTxO7Wqc92V5ngd) |
| Runway | 可重复生产方法和组织治理 | Workflows、Agent、模板/App、执行历史、共享参考与团队用量 | 制作方法复用应是重要迭代；项目级和角色能力要区分 Team/Enterprise，不把全部企业能力套到普通订阅。[Workflows](https://help.runwayml.com/hc/en-us/articles/45763528999699-Introduction-to-Workflows)、[团队角色](https://help.runwayml.com/hc/en-us/articles/10312703076371-Workspace-members-roles) |
| Google Flow | 镜头修改、角色参考和一段戏的编排 | Agent、视觉/声音角色引用、History、Scenebuilder 和下载 | 不能沿用早期单段生成器印象；公开分享不等于私密客户审片，组织账号管理不等于项目制作权限。[角色/资产](https://support.google.com/flow/answer/16935308?hl=en)、[编辑与场景编排](https://support.google.com/flow/answer/16935718?hl=en) |
| 纳米大片流水线 | 国内批量生产和失败恢复 | 角色/场景/分镜相关目录、选中失败镜头重试、消费流水、企业充值 | 需要区分拼接、预览与人工剪辑；官方 FAQ 尚称未提供时间轴剪辑，更新时间未知，不能断言最新所有模式均没有。[失败镜头 FAQ](https://faq.bbs.360.cn/#/answer/6294)、[剪辑 FAQ](https://faq.bbs.360.cn/#/answer/6302)、[当前官网](https://www.namistory.com/) |

辅助参照：**ShortsCrew** 官网直接描述预算分配、岗位权限、素材审核和进度，证明团队生产管理本身也有直接竞争者；但本轮资料不足以评价其质量与成熟度。[官网](https://shortscrew.com/)

**Katalist** 的 Story Canvas 和 Premiere XML 交付有参考价值，但当前首页转向广告资产复用与效果营销，旧套餐/试用说明与新版入口存在冲突，因此降低为邻近对照。[当前首页](https://www.katalist.ai/)、[Premiere 交付帮助](https://help.katalist.ai/en/articles/11785146-how-to-export-a-katalist-project-for-adobe-premiere-pro)

巨日禄、白日梦、柚漫和天工等进入候选发现，但本轮未获得足够一手操作资料，不用二手 SEO 教程补齐它们的功能。未选入深度表不代表产品较差。

## 3. 比“有没有这个功能”更重要的差异

### 上游修改是否损坏已经花钱完成的内容

有戏官方 FAQ 15 说明导入分镜表会清空此前故事板；FAQ 16 说明重新智能分镜并确认覆盖，会清空已有图片、视频和提示词。这个具体限制支持我们把差异导入、保留历史、预览影响范围纳入 MVP。它不等于所有有戏编辑都是破坏性的，也不能推出其他竞品没有版本保护。[FAQ 15](https://xih9dyxxwc2.feishu.cn/docx/FKnxdoPeKobckTxO7Wqc92V5ngd#MSIzdCvDqoVP9wxYMcDcCZuOnJV)、[FAQ 16](https://xih9dyxxwc2.feishu.cn/docx/FKnxdoPeKobckTxO7Wqc92V5ngd#JqecdeWiuodyEcxTdQKcTNxsngc)

Flow 官方帮助明确编辑后保留原视频，在 History 中保留旧版本和生成提示。因此“版本历史”已经是竞争能力，不能单独作为差异化；更值得验证的是把历史与剧本依据、设定、采用决定和交付关联。[Flow 编辑历史](https://support.google.com/flow/answer/16935718?hl=en)

### 角色一致性包含声音与表演

有戏第九部分指出，剧情剧和旁白剧的参考生视频模式不因角色同名而保留跨镜头音色，主体页预设音色在该模式无效；音频参考也不构成稳定锁定。这是特定模式的说明，不应泛化到所有生成方式。[音频说明](https://xih9dyxxwc2.feishu.cn/docx/FKnxdoPeKobckTxO7Wqc92V5ngd#KBTCd9lpRo1Vrsx52AMcPmqjnWd)

新设计应明确保存台词、声线、音轨、口型方式和画面之间的关系，允许替换配音而保留画面，允许改画面而继续采用原配音。Flow 的角色声音引用、LTX 的声音集成及 Morphic 的独立音轨说明，声音已是内容工作台共同竞争的一部分；声音不能只是素材库里另一种文件格式。

### 共享项目不一定共享费用和能力

| 产品案例 | 已核查的规则 | 对本产品的启发 |
|---|---|---|
| LTX 自助 Pro | 协作者各自使用自己的套餐及额度 | 管理者必须看清谁付费、谁有权生成，不能只看协作者数量 |
| Morphic 团队方案 | 组织共享额度，成员数和额外席位受套餐约束 | 团队席位、预算池、用量归因分别建模 |
| 有戏项目共创 | 创建者付算力；成员不自动继承批量等会员权益 | 付费账户和制作权限不应出现难以理解的断裂 |
| Runway | Team 有共享额度，部分项目/角色治理属 Enterprise | 基础项目隔离应与本产品目标客户相符，不直接照搬厂商的商业分层 |

来源：[LTX](https://help.ltx.io/hc/en-us/articles/33650434265362-Adding-collaborators-to-your-project)、[Morphic](https://morphic.com/docs/pricing/plans-and-credits.md)、[有戏](https://xih9dyxxwc2.feishu.cn/docx/FKnxdoPeKobckTxO7Wqc92V5ngd#FC1qdpsIHoWuAIxKXz2cKNtJnjf)、[Runway](https://help.runwayml.com/hc/en-us/articles/10312703076371-Workspace-members-roles)。这些是访问日的规则快照，不是采购报价。

### 导出 MP4、可编辑工程和客户交付不是一回事

有戏文档列剪映草稿，Katalist 明确描述 ZIP 内包含 XML 和素材供 Premiere 导入。它们提供了接入现有剪辑流程的具体路径，但不能据此认为所有字幕、音轨、转场、代理媒体都可无损往返。[有戏导出](https://xih9dyxxwc2.feishu.cn/docx/FKnxdoPeKobckTxO7Wqc92V5ngd#HIsvdI3DaoJxQ1xjkVacMiBAngh)、[Katalist 导出](https://help.katalist.ai/en/articles/11785146-how-to-export-a-katalist-project-for-adobe-premiere-pro)

MVP 应明确最小交付包，V1 优先验证一个主剪辑软件的工程出口，避免一开始建立完整 NLE 又没有可靠交付约定。

## 4. 对旧方案的最终 review

**需要调整，属于定位与首版范围的实质修订；原有可靠性架构多数仍然成立。**

| 方向 | 复核结论 | 新版本处理 |
|---|---|---|
| 目标规模 | 10 人上限不符合用户修正，竞品套餐人数也不是市场定义 | 工作室/项目分层，不设人数硬上限；试点包含大于 10 人团队 |
| 产品前提 | 自用优先是假设，不能继续当要求 | 面向多个工作室的产品，邀请制试点，多租户基础进入 MVP |
| 产品重心 | 旧方案管理侧更充分，视听创作侧还偏概念化 | 创作基准、导演参数、分镜预览、声音和生成闭环前移 |
| 差异化 | 分工、共享、历史、批量、审片都有竞争产品覆盖 | 验证质量达标下的返工可控性、团队复用和交付总成本，不宣称独有 |
| 交互载体 | 单一镜头表格不足以表达导演的工作 | 故事板/场次为创作入口，表格/看板为生产视图；共用数据 |
| 生成粒度 | 单镜头需要保留，但多镜头一段戏已进入产品能力 | 允许镜头组生成；素材、候选、来源区间和镜头多对多关联 |
| 模板 | 旧方案后续范围过泛 | 明确为 V2 核心迭代，版本化、可选择重跑、保留中间结果 |
| 项目协作 | 不止账号数量 | MVP 固定角色/项目权限/共同预算；V1 工序任务/项目组；V3 企业定制 |
| 技术架构 | 用户规模调整不构成微服务理由 | 维持模块化单体，补工作室级公平调度、权限与预算一致性 |

## 5. 版本路线摘要

| 版本 | 完整产品价值 | 主要范围 |
|---|---|---|
| MVP | 团队完成一段有对白、可返工、可交付的 AI 短剧 | 剧本/基准、故事板、图像与视频、声音/字幕、基础剪辑、版本审片、团队权限、预算和导出 |
| V1 | 多项目持续制作，减少交接和质量返工 | 工序任务、资产影响分析、连续性与声音检查、局部视频修改、一个剪辑工程出口、基础客户审片 |
| V2 | 成功制作方法跨成员、跨项目复用 | 版本化模板、批量重做、保留中间结果、模型质量/成本对照、产能调度、按需求加入节点编辑 |
| V3 | 扩展客户协作、商业和跨语言交付 | 外包/客户门户、多语言与多规格、自动订阅结算、开放接口、按需求企业部署 |

细项、依赖、验收和可调整优先级以 [核心设计 v0.2](../ai-drama-workbench-core-design-v0.2.md) 为准。当前没有研发资源和质量实测，故不给虚构日历工期。

## 6. 必须用实测回答的问题

选择首发内容形态，用同一原创脚本和参考素材比较 3–4 个最相关产品与工作室现有工具组合。覆盖双角色对白、同场景反打、造型变化、局部台词修改、失败重试、重拆分镜、审片和剪辑交接。

同时记录质量、总费用、人工操作/修订时间、排队等待、候选采用率和可恢复性。安排真实制片、制作、导演、剪辑分别操作；模板复用需由另一位成员重复完成。完整流程通过之后，再讨论“更好”与付费意愿。

## 7. 详细研究记录

- [国际工作台：LTX / Flow / Morphic / Katalist](2026-09-07-global-workbenches.md)
- [国内工作台：有戏 / 纳米 / ShortsCrew 与候选名单](2026-09-07-china-drama-workbenches.md)
- [LibTV / Higgsfield / Runway 专项复核](2026-09-07-libtv-higgsfield-runway-review.md)

以上记录保留来源、套餐/版本限定和资料冲突；动态厂商页面后续变化时应重新核验。

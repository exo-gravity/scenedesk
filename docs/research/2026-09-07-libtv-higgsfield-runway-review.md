# LibTV、Higgsfield、Runway：独立复核记录

访问日期：2026-09-07。目标：比较内容工作台，而非比较底层模型跑分；目标团队为中小工作室，不设 10 人上限。

## 方法与限制

重新搜索并打开厂商产品页和官方帮助文档，按创作控制、可重复工作流、团队和交付分开核查。本轮没有付费生成、双账号协作测试或质量盲测。“官方帮助有操作说明”只证明文档覆盖，不能等同生产质量已经验证。

LibTV 官网本轮再次读取，但主页文本抓取较少；官方飞书指南在浏览器重新打开时连续超时，因此该产品的细节沿用同日上一轮已读的官方正文，明确不标为本轮重新实测。独立复核的新判断主要来自另外两家新读取的官方资料。上一轮记录见 [LibTV 调研](2026-09-07-libtv-and-review.md)。

## LibTV：直接工作流参照

官网提供画布、模型工具和 Agent 入口。同日官方新版脚本正文覆盖文本拆解、角色/场景/道具提取、分镜编辑及按范围批量生图/视频；指南公告也涉及剪辑和片段重拍。[官网](https://www.liblib.tv/)、[新版脚本指南](https://resonate.feishu.cn/wiki/Loxfw6XHziYRk0kKzdjcFfp9nhb#Gp7IdiGn5oIWygxc9xecnVzPnfb)

设计判断：可作为中文创作者从自由探索进入结构化制作的参照。不能将剧本拆解、资产引用、局部重做等宣称为我们独有。团队席位、预算池、项目权限和批准流程本轮没有新增可靠证据，保持未知。CLI 存在也不能直接说明商业后端接入条件已满足。[CLI 官方入口](https://www.liblib.tv/cli)

## Higgsfield Cinema Studio：创作控制与团队创作参照

官方帮助把电影类型、视觉风格、光线等项目设置与每镜头的摄影参数区分开；Elements 保存角色、地点和道具。AI Director 可拆镜头并填写参数，生成前仍由用户查看和触发。新版操作说明包括延长片段、视频区域编辑和原生音频。[Cinema Studio 官方操作说明](https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-cinema-studio)

2026-08-12 发布的 4.0 文章介绍同项目多人生成、共享 Elements、创作说明 Project Brief 和文件夹组织。它们说明“共享创作上下文”已成为成熟工作台竞争的一部分；该文章关于物理准确性和一致性的效果表述本轮未验证。[官方 4.0 说明](https://higgsfield.ai/blog/cinema-studio-4-0)

Canvas 文档介绍节点串联、并行生成、对比、模板复用和同时协作。其参考输入行为因模型不同：某些连接被当作首帧，角色参考可能需要另建元素并用标签引用。Canvas 生成按积分扣费，网页其他入口的 Unlimited 权益不能直接套用。[Canvas 帮助](https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-canvas)

存在资料口径差异：当前 Cinema Studio 落地页宣传每次最长一分钟，操作帮助及 4.0 博客仍写最长 30 秒；部分帮助的协作说明突出 3.5，而博客介绍 4.0 的团队扩展。不能拼接成对所有版本、模型和套餐都成立的承诺。本轮仅以这些资料支持“场次/多镜头控制、原生音频、共享创作”方向；精确长度和账号权益待实际核验。[产品页](https://higgsfield.ai/cinematic-video-generator)、[操作帮助](https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-cinema-studio)

设计启发：首版需要可操作的创作基准和镜头导演参数；参考图不是简单文件附件，输入语义应清楚。自由画布可以降低跨模型素材搬运，但不能代替镜头与交付版本的结构化记录。

## Runway：可重复制作方法与团队治理参照

Workflows 官方帮助包括模型节点连线、模板、批量参数编辑、单节点执行、锁定输出、并行执行和工作区分享；项目级共享描述带 Enterprise 条件。工作流中已有可追踪的节点历史和复用输出路径。[工作流介绍](https://help.runwayml.com/hc/en-us/articles/45763528999699-Introduction-to-Workflows)、[首次创建与执行历史](https://help.runwayml.com/hc/en-us/articles/45769159004691-Building-your-first-Workflows)

Agent 文档说明可从对话构建、寻找、调整或运行有权访问的工作流，执行 Agent 创建的工作流要求 Standard 或更高套餐。工作流成功仍可能有个别节点无输出，文档要求逐节点检查。[Agent 与工作流](https://help.runwayml.com/hc/en-us/articles/53645211363475-Building-and-running-Workflows-with-Agent)

工作流可发布成带精简输入界面的 App，隐藏或固定部分设置；共享参考资料和自定义 Skills 也有官方操作说明。[工作流发布为 App](https://help.runwayml.com/hc/en-us/articles/47865876793747-Publishing-Workflows-as-Apps)、[共享参考](https://help.runwayml.com/hc/en-us/articles/52963720640275-Using-reference-media-to-guide-your-generations)、[Agent Skills](https://help.runwayml.com/hc/en-us/articles/53907039424915-Using-Agent-Skills)

成员帮助在访问日列出 Team 和 Enterprise 协作，Team 支持 2–9 个计费席位，并描述共享积分池；项目级成员管理和部分角色操作是 Enterprise 能力。该页对 Viewer 的 Team/Enterprise 适用描述有不一致处，故不据此给出普通 Team 免费审阅者的确定结论。[成员与角色](https://help.runwayml.com/hc/en-us/articles/10312703076371-Workspace-members-roles)

项目成员能访问该项目的会话、工作流和素材；移除成员后，其已加入项目的素材仍对项目可见。企业成员管理页也展示用量字段。[项目成员与可见性](https://help.runwayml.com/hc/en-us/articles/52475027943059-Managing-Project-Members-and-Visibility)、[企业成员管理](https://help.runwayml.com/hc/en-us/articles/43198398846611-Managing-Workspace-Members)

设计启发：把熟练成员的方法沉淀成团队可复用的制作模板，重要性高于“接更多模型”。模板需固定版本、明确输入、支持保留已确认中间结果；自动化的成功应按所需产物齐全判断。团队预算必须说明谁付费、谁可花费、费用归属何处。

## 对旧方案的独立判断

1. 版本追溯、异步作业和素材持久化继续成立，但不能仅靠这些宣称差异化。
2. 创作能力应前移：项目风格、人物表演、声音、镜头语言、分镜预览和局部修改要进入首版体验。
3. 单镜头是稳定的内容管理对象；实际生成范围可以是多个镜头组成的一段戏，不应被单文件单镜头的界面假设限制。
4. 团队模板是重要早期迭代；无需先实现任意节点图编辑器，也能通过固定的、可版本化的制作步骤交付价值。
5. 人数边界来自套餐和试运行容量，不应成为产品领域模型中固定的“10 人”条件。

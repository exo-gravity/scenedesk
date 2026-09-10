# Agent 任务推进机制深挖：TapNow，及 Seko 的系列上下文补充

调研日期：2026-09-08。用途：支持主文档附录，不预先决定我们的产品路线。本轮读取官方文档及产品介绍，未登录、未生成作品、未调用付费服务。以下操作为依据文档重建的路径，不能当作实际成功率或完整制作实测。

证据标记：**D**＝官方操作文档；**P**＝官方公开主张；**F**＝公开前端线索；**I**＝本研究的归纳或建议；**U**＝尚无证据。本篇主要使用 D；Seko、Octo 使用 P。产品文档描述操作存在，不等于相关生成结果能稳定达到交付标准。

## 1. 为什么可以归为同一类，为什么选 TapNow

**I：建议把 TapNow、Dreamina Octo、Seko 合并为“任务委托与人机接手”类。** 它们共享的机制是：用户提供目标和创作上下文，Agent 决定并执行一部分下一步工作，成果留在可继续操作的工作空间，人从具体成果上修改后可以再次委托。交互入口可以是对话，长期价值来自任务与成果之间的连续关系。

TapNow 作为主代表，理由是它公开了输入引用、执行确认、会话分支、输出管理和人工工具的实际操作，足以检查这套机制怎样落地。[TapNow Agent](https://docs.tapnow.ai/en/docs/agent/tapnow-agent) Seko 更适合作为“系列内容如何利用项目积累及专业方法”的补充；Octo 的公开介绍强调共创和会话连续性，但本轮未取得同等深度的操作文档。[Seko 介绍](https://www.sensetime.com/cn/news/seko-3-0-ai-1)、[Octo 介绍](https://dreamina.capcut.com/ai-video/octo)

**I：四类划分可以是创作关系、叙事结构、可执行工艺、任务委托。** 同一产品可以覆盖数类，分类描述主机制；“项目上下文／资产／Skill 积累”是横向维度，“按默认阶段推进”是执行策略。不能因为都有步骤就把预设流水线与用户可编排工艺视为同一机制，也不必因加入系列记忆而再拆出一类。

## 2. TapNow 的最小工作循环

**D：其官方任务说明将上下文读取、计划、执行、局部修改和交付准备连接起来。** 人确定方向及关键要求；Agent 分解任务并调用 Apps；遇到不清楚或矛盾的信息可以先澄清。用户能限定“只分析”“只写脚本”“生成前停下”等边界。[任务说明](https://docs.tapnow.ai/en/docs/agent/tapnow-agent)

**I：机制可概括为：选定依据 → 委托有限任务 → 检查可见行动 → 得到可接手成果 → 局部修订 → 再委托。** 其中有三个重要连接：材料进入本次任务，行动产生可保存成果，成果被下一轮明确采用。少一个连接，对话就容易退化成素材生成入口。

### 依据官方功能重建九步操作

以下用“已有角色参考和一段戏，准备三个镜头”作研究示例。情节、数量与分工为 **I**，所用入口为 **D**；不是官方案例的复制，也不是实操记录。

1. **放入本次材料。** 将角色图、场景参考和戏文放入工作空间，保持各节点独立。画布保存素材关系，生成新成果后仍可查看来源。[画布入口](https://docs.tapnow.ai/en/docs/canvas/explore-the-canvas)
2. **选定上下文并委托。** 打开 Agent，通过输入框旁的添加入口选画布材料；用 `@` 指明“人物依据”和“只借鉴光线”的不同作用。输入上方可核对已附引用。[对话及引用](https://docs.tapnow.ai/en/docs/agent/chat-with-agent)
3. **把模糊方向变为制作依据。** 若戏的表达尚不清楚，可先用 Brainstorm 讨论选项、关系与关键情节；方向已清楚则直接发任务。它的作用是把探索形成的决定转成后续可用资料。[Brainstorm](https://docs.tapnow.ai/en/docs/agent/find-ideas-with-brainstorm)
4. **保存可复用的文字成果。** 脚本、brief、表格等通常在当前画布的侧栏 Outputs 保存，打开检查后可添加为画布节点，也可送回对话修改；图像、视频、音频通常直接成为节点。不能统称所有输出都自动落在画布中央。[产物管理](https://docs.tapnow.ai/en/docs/agent/manage-agent-outputs)
5. **检查这一次要执行什么。** 在 Ask 模式查看生成确认卡，核对并调整参考、模型、数量与可用参数；点击 Generate 才开始。Auto 则在参数就绪后继续执行，不逐次等待确认。[生成模式](https://docs.tapnow.ai/en/docs/agent/choose-a-generation-mode)
6. **运行时安排后续工作。** 下一条指令可进入 Queue，待当前工作结束依次执行；要求错了应先 Stop 再纠正。换创作方向可分支，换任务则新建会话并重新给定有效依据。[会话管理](https://docs.tapnow.ai/en/docs/agent/manage-conversations)
7. **在成果上接手。** 选择视频节点即可进入工具栏；例如裁切会产生新节点并保留原片。创作者因此能从 Agent 已完成的结果接着操作，不必先下载再另建一次制作。[视频工具](https://docs.tapnow.ai/en/docs/canvas/generate-and-edit-video)
8. **检查片段连接。** 多选视频建立 Playlist，排序、裁切、预览后可合并导出或把结果送回画布。它承担时间顺序，素材在画布中的位置不应被解释为正式剪辑顺序。[播放列表](https://docs.tapnow.ai/zh/docs/canvas/use-playlists)
9. **交给同伴继续。** 团队画布共享节点、连接和 Agent 输出，成员可以编辑并跟随对方视口演示。视口跟随不会代替节点操作。[团队创作](https://docs.tapnow.ai/en/docs/projects/create-with-your-team)

## 3. 哪些关键功能承载了这个机制

表中“行为”为 D，“机制作用”为 I。它们共同组成一次委托能否被理解、检查和接续的设计；不是独立功能数量的比较。

| 核心功能 | 用户可见行为 | 机制作用 | 直接证据 |
|---|---|---|---|
| 显式引用 | 添加上下文，再用 `@` 说明不同材料的用途 | 区分“项目中存在”与“本次实际使用” | [Chat](https://docs.tapnow.ai/en/docs/agent/chat-with-agent) |
| 生成确认卡 | Ask 模式可改设置再执行 | 把自然语言意图转为可检查的具体行动 | [Mode](https://docs.tapnow.ai/en/docs/agent/choose-a-generation-mode) |
| 独立产物入口 | 文档可重开、送回对话、添加为节点 | 让成果脱离聊天滚动记录而继续被使用 | [Outputs](https://docs.tapnow.ai/en/docs/agent/manage-agent-outputs) |
| 会话分支与新会话 | 分支继承此前消息；新会话重新引用有效资料 | 将讨论历史与当前制作依据分开 | [Conversations](https://docs.tapnow.ai/en/docs/agent/manage-conversations) |
| Apps | Agent 组织任务，App 执行限定能力；外部连接需授权，实际能力依账户而定 | 将意图组织与工具执行分开，多步骤之间留下可检查成果 | [Apps](https://docs.tapnow.ai/en/docs/agent/apps) |
| 直接操作节点 | 上游可以连接到下游，生成时仍应确认具体引用 | 提供人工控制路径，并使来源关系可读 | [Connections](https://docs.tapnow.ai/zh/docs/canvas/understand-nodes-and-connections) |
| 资产、主体和模板 | Library 保存材料；Element 聚合一个主体的参考；Template 保存节点与连接 | 三种复用分别服务文件、主体依据、制作结构 | [Library](https://docs.tapnow.ai/en/docs/canvas/use-library-and-templates)、[Elements](https://docs.tapnow.ai/en/docs/canvas/create-and-use-elements) |
| 画布评论 | 评论作为画布节点，支持回复；目前没有 resolved 状态 | 能讨论局部成果，但不等于已具备正式返工与审阅闭环 | [Comments](https://docs.tapnow.ai/en/docs/projects/comment-and-send-feedback) |

**D：Apps 文档要求在多工具阶段间留下可检查的节点或文件；来源及用途仍应按任务明确给定。** 授予某个连接访问权限，不表示本轮任务应该读取其所有内容。[Apps](https://docs.tapnow.ai/en/docs/agent/apps)

**I：一个特别值得借鉴的设计是“产物和控制入口共同保留”。** 人既能看到 Agent 做出了什么，也能进入素材、文本或时间线工具继续处理。若只有聊天里的“已经完成”，没有明确成果入口，就难以组织真实生产交接。

## 4. 具体看一次“改一个镜头”

研究情境 **I**：三镜头已经组接，第二镜头人物位置正确，但衣服不符定妆。以下是公开机制所允许的路径组合，不保证模型能只改衣服。

1. 从 Playlist 的片段菜单定位原视频节点，明确问题对应哪份源片。[Playlist](https://docs.tapnow.ai/zh/docs/canvas/use-playlists)
2. 选定问题节点与定妆参考，委托：“修正服装；保留人物位置、构图和时长，先做一个候选。”这是将修改项、保留项和权威参考同时交给 Agent 的用法。[局部修订说明](https://docs.tapnow.ai/en/docs/agent/tapnow-agent)
3. 若要人工精确指定目标，可使用视频 Replace：定位清楚帧、框选对象、选择参考后执行，生成带来源连接的新结果；支持范围及效果应实际核查。[Replace](https://docs.tapnow.ai/en/docs/canvas/generate-and-edit-video)
4. 新结果不能只检查衣服。还要检查人物、动作及衔接是否受到意外影响；是否采用由制作人员判断。此为 **I** 的质量检查要求。
5. 文档给出的返回路径是将新视频加入 Playlist，再调整所用片段，而非证明存在自动、保长的一键替换。源片保留，播放列表中的裁切只改变使用范围。[Playlist](https://docs.tapnow.ai/zh/docs/canvas/use-playlists)

**I：这条路径说明“会生成新结果”和“完成镜头修改”之间还有采用、时间线更新和复查。** 借鉴时应完整设计后半段，而不能把 Agent 输出新视频视为返工结束。

## 5. 状态、边界及尚未证实的部分

**D：公开操作有待确认、执行中、停止、后续指令排队、结果可查看与失败排查入口。** Queue 不是供应商生成任务的状态。文档建议失败后检查引用、余额和网络，并缩小任务。[会话管理](https://docs.tapnow.ai/en/docs/agent/manage-conversations) 视频生成中、只读状态或账户未开放时，部分工具隐藏。[视频工具](https://docs.tapnow.ai/en/docs/canvas/generate-and-edit-video)

**U：本轮没有证实以下事项：** Stop 能否取消已提交模型及如何计费；断线重试与重复提交处理；部分 Apps 成功后的精确恢复点；不可变版本、审计日志、批准权限；多人同时让 Agent 改同一对象的冲突解决；“只改衣服”在模型层面的效果保证。不能从存在聊天记录推导这些能力。

**I：还应区分用户标签和正式状态。** 官方建议把当前脚本、待确认材料标识清楚，但不足以证明系统存在不可变批准版本。共同编辑和评论提供协作基础，也不能代替生产负责人、任务完成条件和交付批准。

## 6. Seko 与 Octo：同类机制的不同侧重

**P：Seko 3.0 官方介绍称，Agent 在续集创作中调用前序剧本、角色、场景和视觉风格；Skill 封装叙事、角色与分镜等专业经验并按意图调用。** 这是项目积累与方法积累共同参与执行的公开产品方向。[Seko](https://www.sensetime.com/cn/news/seko-3-0-ai-1)

**U：未取得足够资料说明 Seko 的 Skill 作者界面、参数与输入契约、版本发布、团队私有范围、试运行和回滚设计。** 也不能把“杜绝漂移”等宣传作为经过验证的生产事实。

**P：Octo 海外介绍强调 Agent 结合会话及工作空间持续发展创意，连接故事、角色、素材与视频。** 本轮用它说明任务委托也可以从模糊创意开始；其“记住整个会话”属于产品主张，未验证实际上下文范围，更不能直接外推至国内即梦。[Octo](https://dreamina.capcut.com/ai-video/octo)

**I：这三者的区别宜作为同类中的侧重：TapNow 的显式任务边界及人工接手、Octo 的连续共创、Seko 的系列积累及方法调用。** 它们没有构成必须互斥选择的三条产品线。

## 7. 对我们后续设计的借鉴建议

以下均为 **I**，需要结合目标团队判断，尚未进入当前方案决策。

- **把一次任务的依据放到可见位置。** 角色、场景、镜头要求和版本可从业务对象自动带入，成员只核对必要项；避免让每次生成都变成重复组织材料。
- **在执行前展示实际行动。** 对关键生成呈现数量、目标对象、允许修改范围和停止点；稳定任务可以减少逐步等待，但人工接手入口保持一致。
- **让人和 Agent 操作同一批成果。** 剧本、资产、候选、镜头和剪辑应能被直接编辑，并作为下一次任务输入；不要只在对话里保存一套与业务记录脱节的成果。
- **把修改一直设计到采用与复查。** 新结果返回原工作对象附近，明确影响哪个镜头及当前剪辑，成员能决定替换范围。自动更新应有清楚适用条件。
- **区分三种长期复用。** 主体参考解决“用什么”；项目决定解决“必须遵守什么”；Skill 或工艺解决“怎样做”。先观察团队已有方法，再决定封装和自动化方式。
- **不因界面名称复制实现。** 明确上下文和可接手成果可以由分镜页、资产页和任务侧栏承载；是否需要无限画布，应由多方案并行、跨素材组合和讲解需求决定。

## 8. 关键截图候选

以下链接来自官方文档中的演示动图。建议在所属页截取关键画面，标注“官方演示截图／2026-09-08 访问”，不要写为本轮实操。web 图片解析器返回 `Unsupported content-type: image/gif`，不影响正文读取；截图应由主调研统一采集与检查。

| 候选 | 所属页与原始演示 | 截图要说明什么 |
|---|---|---|
| 显式 `@` 引用 | [对话页](https://docs.tapnow.ai/en/docs/agent/chat-with-agent)；[原 GIF](https://files.tapnow.media/api/conversation/storage/uploads/a435c880-5d92-4f69-b528-faf4561620b1?variant_name=high) | 输入旁素材与指令中的引用如何共同限定本次上下文 |
| Ask 确认卡 | [模式页](https://docs.tapnow.ai/en/docs/agent/choose-a-generation-mode)；[原 GIF](https://files.tapnow.media/api/conversation/storage/uploads/dc2b6391-5331-4f10-8373-fea05ecef122?variant_name=high) | Agent 的下一步如何成为人可检查和修改的操作 |
| 侧栏 Outputs | [产物页](https://docs.tapnow.ai/en/docs/agent/manage-agent-outputs)；[原 GIF](https://files.tapnow.media/api/conversation/storage/uploads/ce4c0c9e-0746-4453-9518-4d38ea813106?variant_name=high) | 保存的成果如何获得独立入口，而非只存在于聊天气泡 |

## 9. 来源访问台账

全部于 2026-09-08 重新访问；TapNow 正文成功读取，图像异常单独见上。没有把第二天重复访问视为另一次实测。

| 来源 | 类型 | 用途与访问结果 |
|---|---|---|
| [TapNow Agent](https://docs.tapnow.ai/en/docs/agent/tapnow-agent) | D | 任务生命周期和修订边界；正文可读 |
| [Chat with Agent](https://docs.tapnow.ai/en/docs/agent/chat-with-agent) | D | 输入与引用；正文可读 |
| [Generation mode](https://docs.tapnow.ai/en/docs/agent/choose-a-generation-mode) | D | Ask、Auto 和确认卡；正文可读 |
| [Conversations](https://docs.tapnow.ai/en/docs/agent/manage-conversations) | D | 新任务、分支、Queue、失败；正文可读 |
| [Outputs](https://docs.tapnow.ai/en/docs/agent/manage-agent-outputs) | D | 文档产物与节点差别；正文可读 |
| [Apps](https://docs.tapnow.ai/en/docs/agent/apps) | D | 执行能力和阶段交接；正文可读 |
| [Brainstorm](https://docs.tapnow.ai/en/docs/agent/find-ideas-with-brainstorm) | D | 前期探索承接；正文可读 |
| [Canvas](https://docs.tapnow.ai/en/docs/canvas/explore-the-canvas) | D | 节点、来源及给 Agent；正文可读 |
| [Connections](https://docs.tapnow.ai/zh/docs/canvas/understand-nodes-and-connections) | D | 连接与本次引用；正文可读 |
| [Video tools](https://docs.tapnow.ai/en/docs/canvas/generate-and-edit-video) | D | 直接操作、源片与新结果；正文可读，未验证具体模型 |
| [Playlist](https://docs.tapnow.ai/zh/docs/canvas/use-playlists) | D | 时间线与素材回接；正文可读 |
| [Team](https://docs.tapnow.ai/en/docs/projects/create-with-your-team) | D | 共编与跟随；正文重开后完整 |
| [Comments](https://docs.tapnow.ai/en/docs/projects/comment-and-send-feedback) | D | 评论无完成状态；正文可读 |
| [Library](https://docs.tapnow.ai/en/docs/canvas/use-library-and-templates)、[Elements](https://docs.tapnow.ai/en/docs/canvas/create-and-use-elements) | D | 三种复用对象；正文可读 |
| [Seko 3.0](https://www.sensetime.com/cn/news/seko-3-0-ai-1) | P | 2026-07-29 官方发布，系列上下文与 Skill 主张；未取得作者操作手册 |
| [Dreamina Octo](https://dreamina.capcut.com/ai-video/octo) | P | 海外产品共创定位及简要流程；不证明国内即梦一致 |

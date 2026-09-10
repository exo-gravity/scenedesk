# 附录研究：以作品结构组织制作——Katalist、LTX Studio 与纳米的不同实现

研究日期：2026-09-08。用途：供《AI 短剧工作流产品：设计内核、形成原因与我们的选择策略》合并为附录；不替代实施方案。

证据标记：**D**＝官方操作说明；**P**＝官方产品宣称；**F**＝公开前端线索；**I**＝我们的设计推论；**U**＝本次未知。D 说明存在可追溯操作说明，不代表我们完成了账号实测。本次未登录、未生成、未验证多人协作；重新读取官方资料，未用旧摘要代替核查。

## 1. 为什么归为同一组，为什么选择这些代表

**I｜建议将这一组称为“以作品结构组织制作”。** 共同点是先把要交付的作品变成可定位、可填充、可调整的内容单位，使制作人员知道每次生成服务于作品的哪一部分。它与执行流程的区别，在于组织的是“作品由什么组成”，不只是“调用什么工具”。

Katalist 的新 Story Canvas 帮助文档提供了较完整的脚本到视频操作链，适合作主代表；LTX 的 Elements 和多工作空间说明补充了共享设定与局部探索的连接。Katalist 当前 Story Canvas 落地页明显面向效果广告、品牌和电商，选它是因为叙事制作机制可借鉴，不意味着它就是中国短剧团队系统。[D：Katalist 操作链](https://help.katalist.ai/en/articles/16298583-how-to-build-your-storyboard-and-videos-in-story-canvas)、[P：目标用户定位](https://www.katalist.ai/story-canvas-early-access)

纳米可放在本组的“阶段推进”亚型：正式披露确认其把自动化流程、分镜和可返回调整的画布结合起来。但公开资料不足以把其细节写成与 Katalist 同等可信的操作教程。[P：三六零披露，第 3 页](https://static.cninfo.com.cn/finalpage/2026-04-30/1225257364.PDF)

## 2. Katalist：从官方资料重建的一条制作路径

以下 1—6 以新 Story Canvas 为主，7—9 补充其他官方教程。声音、角色库及 Premiere 指南跨越不同发布时间和界面，**这些功能的同版互通尚待实操确认**。

1. **从需求进入项目。** 已有剧本可进入新画布路径；只有故事概念时，旧版 Generate Script 教程也提供按场景生成拆解的入口。因此“结构驱动”不等于只能接收定稿剧本。[D：概念拆解](https://help.katalist.ai/en/articles/13015366-how-do-i-create-a-script-breakdown-in-katalist)
2. **将文本转成可见骨架。** 新建项目选 Start from a script，上传确认后，在 Script Sidebar 查看自动拆出的场景与镜头；按场景 Add to Canvas。[D：新画布指南](https://help.katalist.ai/en/articles/16298583-how-to-build-your-storyboard-and-videos-in-story-canvas)
3. **准备反复使用的视觉依据。** 角色可从描述、可选面部参考开始，先预览、重试，再保存；旧版还记录名称、服装与声音，支持角色库及 `@` 引用。[D：角色制备](https://help.katalist.ai/en/articles/10720071-how-to-personalize-your-characters-in-katalist)
4. **填充已展开的画面。** 新画布预置角色、地点与画面生成卡。生成角色后，会分配给引用它的画面卡；之后逐卡制作画面，可分组、命名或导入已有媒体。[D：新画布指南](https://help.katalist.ai/en/articles/16298583-how-to-build-your-storyboard-and-videos-in-story-canvas)
5. **把选好的画面继续做成视频。** 对画面执行 Add to New Video，补充视频设置与提示，再生成；不满意可以重试。[D：新画布指南](https://help.katalist.ai/en/articles/16298583-how-to-build-your-storyboard-and-videos-in-story-canvas)
6. **补入外部已确定的成果。** 官方另有上传地点参考、替换角色参考及在新画面中上传自有图片的说明，使流程能够接住外部制作。[D：自有图片](https://help.katalist.ai/en/articles/13015400-how-to-add-custom-images-to-your-storyboard-in-katalistai)
7. **按需要处理对白口型。** 2026-07-09 指南从 Storyboard 的 Edit 进入 Video／Dialogue，填对白并 Apply，检查后可改对白重生成；文档建议避免同一场景多说话人，并说明限付费方案。[D：口型指南](https://help.katalist.ai/en/articles/12781817-how-to-add-a-lip-sync-in-katalist)
8. **在时间线处理连续观看与声音。** 新画布将视频拖入时间线排序；旧版声音指南支持 TTS 或音频上传、对齐。2025-11 声音文档称初次视频生成不会自动带出剧本音频，该结论不能扩大为所有当前模型的能力限制。[D：声音指南](https://help.katalist.ai/en/articles/12743528-how-can-i-add-and-customize-a-voiceover-in-katalistai)、[D：新画布指南](https://help.katalist.ai/en/articles/16298583-how-to-build-your-storyboard-and-videos-in-story-canvas)
9. **交付视频或可接续编辑的材料。** 新画布支持片段下载与时间线导出；另有 Premiere 导出教程，以 ZIP 中的 XML 和媒体恢复片段顺序，再由外部编辑完成后期。该教程没有证明双向回传、字幕和所有轨道都无损保留。[D：Premiere 交接](https://help.katalist.ai/en/articles/11785146-how-to-export-a-katalist-project-for-adobe-premiere-pro)

## 3. 哪些具体设计把机制落到了操作上

下表“作用”均为 I；功能行为按 D/P 分开，不把公开名词推断为内部数据库结构。

| 功能与公开对象 | 关键交互／行为 | 对机制的作用 | 证据 |
|---|---|---|---|
| 剧本侧栏、场景、镜头、画面卡 | 按内容单位展开待制作材料 | 同时保留叙事位置与制作入口 | D：[新画布](https://help.katalist.ai/en/articles/16298583-how-to-build-your-storyboard-and-videos-in-story-canvas) |
| 角色预览与角色库 | 生成预览，接受后保存；通过命名引用复用 | 角色先成为可决定的方案，随后成为镜头依据 | D：[角色指南](https://help.katalist.ai/en/articles/10720071-how-to-personalize-your-characters-in-katalist) |
| 自有地点、角色及画面图片 | 各自有导入位置，不只作为最终附件上传 | 外部准备的结果能进入制作链的中间位置 | D：[自有图片](https://help.katalist.ai/en/articles/13015400-how-to-add-custom-images-to-your-storyboard-in-katalistai) |
| 视频局部编辑 | 上传视频后可自动按切点拆开；对单片段 Edit This Video，以 `@` 引用替换参考，再添加到时间线 | 修改范围可以缩到具体片段，形成已成片内容的再制作入口 | D：[产品替换教程](https://help.katalist.ai/en/articles/16297383-how-to-do-product-swaps-on-your-existing-videos-in-katalist)；保留其他内容的效果是 P |
| 独立的时间线音频操作 | 音频可拖放定位、删除及重新生成 | 声音能独立返工，不要求与画面一次同时做对 | D：[声音操作](https://help.katalist.ai/en/articles/10702096-how-to-add-a-voiceover-to-your-katalist-project) |
| 结构化后期交接 | XML 与媒体一起导出，外部恢复有序片段 | 交付对象可以是可继续加工的序列，而不止最终 MP4 | D：[Premiere 教程](https://help.katalist.ai/en/articles/11785146-how-to-export-a-katalist-project-for-adobe-premiere-pro) |
| 意见进入迭代 | Agentic Storyboarder 宣称共享画板后，成员评论可触发新版本 | 叙事结构也可成为 Agent 接收局部反馈的定位依据 | P：[Agentic 页面](https://www.katalist.ai/agentic-storyboarder)；该页含 Early Access，不视为默认已上线机制 |

**I｜最值得借鉴的连接是“内容位置→制作所需参考→局部结果→连续编排”。** 如果只复制自动拆镜和卡片列表，却让成员重新寻找参考、重新上传结果，仍没有得到这套机制。

## 4. LTX 补充：共享设定与局部试作如何并存

**D｜先展示计划，再花生成资源。** 2026-01 的 Storyboard 更新说明：上传剧本后能查看场景、镜头数量和各镜头文本；预先设定画幅、选择图像模型，并检查提取的 Elements，再生成视觉画面。这里可借鉴的是明确的生成前检查点，速度和一致性效果只属于 P。[官方更新](https://ltx.io/blog/ltx-storyboard-generator-update)

**D｜资产既可专门准备，也可从探索结果晋升。** Elements 可生成或上传创建，Gen Space 的结果也能 Save as Element；镜头描述中的 `@` 将其明确关联。共享项目成员使用相同 Elements。**I：这把“做出一个好结果”与“确立一个可复用依据”接了起来。** 但该说明没有给出批准、锁定、负责人及并发冲突规则。[Elements 教程](https://ltx.io/blog/getting-started-with-elements)

**D｜造型变化有独立操作。** 角色指南描述 Duplicate 后调整服装字段并另命名，例如同一人物的不同穿着。**I：业务上要明确本次引用的具体造型，不能仅靠全局覆盖角色参考。** 文中所称面部完全一致是 P，未实测。[角色变体教程](https://ltx.io/blog/how-to-create-a-consistent-character)

**D｜一个项目容纳多个职责不同的空间。** Projects 说明将 Gen Space、Storyboard、Timeline 和 Pitch Deck 归入项目；Sessions 可按概念、镜头、角色或尝试整理生成记录；Storyboard 负责画面意图与顺序，Timeline 提供批量插入、吸附和撤销等编排动作。**I：生成试验的顺序可以与作品顺序不同。** 该说明发表于 2025-08，只用于解释组织机制，不用于断言所有旧工具目前仍在。[Projects 更新](https://ltx.io/blog/introducing-projects)

## 5. 最需要谨慎理解的“修改传播”

LTX Elements 教程说更换资产图片会应用到标记它的位置；但 2026-05 的 Color Elements 操作文档明确：旧生成不会因 HEX 改动而自动更新，需要重新生成；修改 HEX 没有撤销，官方建议创建新 Element。[D：Color Elements 的修改限制](https://help.ltx.io/hc/en-us/articles/35494322496786-How-to-use-Color-Elements)

**I｜因此不能将“更新引用的设定”写成“自动修改全部既有画面、视频和成片”。** 上述细则直接覆盖颜色类型；其他 Element 的逐项传播规则仍需验证。我们借鉴时应分别定义：输入引用更新、待制作内容需要复查、已有结果需要重制、剪辑采用需要替换。它们可以在前台组成连续动作，但不能以一句“全局同步”掩盖差异。

**I｜局部修改示例，以下为设计演绎，未在产品中操作。** 双人在咖啡厅交接钥匙，导演希望只把拿钥匙的手部镜头拉近。基于这一组机制，可以从作品结构定位该画面，保留人物与地点依据，调整构图后制作新候选，再检查它与前后镜头的接续，最后放入序列。若改的是角色服装，则应先区分本场造型变化和全剧设定变化，再决定哪些镜头需要重做。**U：Katalist 是否自动列出所有受影响镜头、保留并排候选、锁住已采用结果，本次资料不能确认。**

## 6. 状态、异常和协作：公开证据的边界

- **D：** Katalist 对被限制的剧本提供编辑后重新上传及请求人工复核的路径。该文只支持输入受限后的处理，不能证明局部内容映射会无损保留。[受限剧本处理](https://help.katalist.ai/en/articles/12841944-what-is-considered-objectionable-content-in-katalistai-scripts-and-how-can-i-resolve-flagged-issues)
- **U：** 能重新生成，不等于有完整候选历史、版本回滚、采用状态和审片批准。新画布教程没有说明重复 Add to Canvas、重复拆解、上游删除及生成失败后的关系如何处理。
- **P／U：** Katalist 宣称团队同步及 Agent 解析评论，LTX 描述成员共享资产；尚不足以推断任务分配、锁定、审片粒度、角色权限和并发编辑冲突。因此这组产品可证明组织制作的操作思想，不能直接证明其覆盖短剧工作室的全部协作。
- **D／U：** LTX Color Elements 当前不能直接用于视频标签输入，需先用于图像再将图像用于视频。该限制只适用于本次核查的类型和路径，不能据此强制我们所有模型先图后视频。[能力边界](https://help.ltx.io/hc/en-us/articles/35494322496786-How-to-use-Color-Elements)

## 7. 对后续设计与分组的结论

以下均为 I，供选择而非既定方案：

1. **保留作品骨架，但让它成为操作入口。** 每个内容单位应能就地准备依据、尝试制作、选结果并交接。
2. **资产准备与镜头生产之间要有明确连接。** 可从探索结果保存基准，并明确哪些画面引用哪个具体造型。
3. **生成记录与作品编排分别管理。** 允许大量尝试，作品只纳入选择后的内容；同时保留回到制作上下文的入口。
4. **为外部成果留中途入口与后期出口。** 覆盖业务工作流可以包含外部制作，但交接应保留足够结构。
5. **把纳米的阶段推进视为这一组的一种组合策略。** 它增加“下一步如何推进”的默认安排，不必与叙事结构并列成互斥内核；局部回退如何处理依赖仍是关键待验证项。
6. **不要给产品贴永久单组标签。** Katalist 同时有空白画布、局部视频编辑和 Agentic 宣称；LTX 还提供 Flows。分类对象应是机制。同一产品可以为多个组提供代表证据。

## 8. 配图候选与核验要求

本文件只记录官方图源，不将其标成账号实操截图；主文整合时应先视觉核验。下列图源已由官方页面链接或 HTML 确认，图像本身在本研究环境读取失败，不能据图源推断未见控件。

| 候选 | 官方页面位置与直接来源 | 建议解释什么 |
|---|---|---|
| Katalist 整体画布官方示意 | [页面](https://www.katalist.ai/story-canvas-early-access) 中 “Your entire production lives in one canvas now”；[图源](https://cdn.prod.website-files.com/6468ed584d728a73522a74ce/69d8b064d57e2feea5c9c55d_unnamed.png) | 内容结构展开后，参考与画面制作如何同时可见；需先验图 |
| LTX Element 标签输入官方截图 | [Color Elements 教程](https://help.ltx.io/hc/en-us/articles/35494322496786-How-to-use-Color-Elements) 中 “Tag a Color Element.png”；[图源](https://help.ltx.io/hc/article_attachments/35522941787794) | 共享设定通过明确标签进入本次生成，配合正文解释传播边界 |
| Katalist 脚本到画布官方演示 | [指南](https://help.katalist.ai/en/articles/16298583-how-to-build-your-storyboard-and-videos-in-story-canvas) 所嵌 [Loom](https://www.loom.com/embed/91cb1424e2084a91a335de815b289d06) | 如可观看，截取 Script Sidebar／Add to Canvas 和角色卡引用位置；未观看，不编造时间戳 |

## 9. 来源台账

所有访问日期均为 **2026-09-08**。正文已就近提供直接 URL；同页在不同段落出现不代表多份独立证据，未使用长引文。

| 来源 | 文档日期／状态 | 本次采用范围 |
|---|---|---|
| Katalist 新 Story Canvas 制作指南 | 显示更新超过一个月 | D：脚本、引用分配、图转视频及时间线 |
| Katalist Script Breakdown | 2025-12-05 | D：故事概念作为入口；旧界面 |
| Katalist 角色制备 | 2025-09-01 | D：预览、保存、角色库；旧界面 |
| Katalist 自有图片 | 2025-12-05 | D：参考及画面导入 |
| Katalist Product Swaps | 显示更新超过三周 | D：切分、明确引用、单片段编辑；P：其他内容保持效果 |
| Katalist Lip Sync | 2026-07-09 | D：局部操作与付费范围；P：自然口型效果 |
| Katalist Voiceover 两篇 | 2025-03-04、2025-11-07 | D：音频制作与定位；跨版本适用待验证 |
| Katalist Premiere 导出 | 2025-07-16 | D：XML 与媒体、序列交接；未做导入验收 |
| Katalist 受限剧本处理 | 2026-07-09 | D：异常输入处理 |
| Katalist Story Canvas／Agentic 落地页 | 页面含 Early Access | P：定位与协作；F：官方图像链接 |
| LTX Storyboard 更新 | 2026-01-06 | D：生成前的结构与资产检查 |
| LTX Elements 教程 | 页面标注 2025-10-28，正文可能持续更新 | D：生成结果转资产、标签、共享；P：一致性效果 |
| LTX 角色变体 | 2025-07-28 | D：复制与造型字段；P：完全一致效果 |
| LTX Projects 更新 | 2025-08-13 | D：工作空间与 Session 的职责；不据此确认旧功能现状 |
| LTX Color Elements | 更新 2026-05-20 | D：引用修改、旧生成不变与能力边界；F：截图链接 |
| 三六零正式披露 | 2026-04-30，第 3 页 | P：流水线与画布组合；未采用效率、成功率为验证结论 |


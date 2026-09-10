# 可复用工艺执行机制深挖：FLORA Techniques，及 Runway、LTX 的互补设计

调研日期：2026-09-08。用途：供产品内核文档末尾附录整合；不改变当前产品方案。

证据标记：**D**＝官方操作文档或发布记录明确描述；**P**＝官方定位或效果主张；**F**＝公开前端可观察线索；**I**＝研究者的归纳、设计建议或示例；**U**＝未确认。本次是公开资料研究，没有登录产品、运行生成或验证计费。本篇未将官网效果文案当作制作保证，也未使用 F 证据补足未知。

## 1. 归类结论与代表选择

**I｜本类的共同机制是：作者把一套制作步骤定义为有输入、输出和执行规则的工艺，使用者替换输入后重复运行。** FLORA Technique、Runway Workflow/App、LTX Flow 可并在这一类研究，无须按三个品牌建立三个并列内核。它们的区别主要落在封装、运行控制和使用入口。

选 FLORA 为主代表，因为它把“搭建—封装—发布—简化使用—继续修改”表达为一套完整产品机制。Runway 用于补充输出锁定、App 可见参数和 Agent 调用；LTX 用于补充依赖变化与缓存失效。选择依据是机制完整和资料可核查，不是市场份额或制作质量排名。

**I｜固定工作流、Agent Skill、素材上下文不适合同层分类。** 前者规定如何执行；Skill 向 Agent 提供方法指引；素材与上下文提供任务事实。Runway 官方也明确区分聊天指令式 Skill 与独立节点式 Workflow，并说明 Agent 可使用两者。[D：Runway Agent 与 Workflows](https://help.runwayml.com/hc/en-us/articles/53645211363475-Building-and-running-Workflows-with-Agent)

建议将“自由创作探索、故事结构组织、工艺执行、Agent 任务推进”作为可组合的工作组织机制，再以资产、项目上下文和方法积累作为横向能力。固定流水线通常属于工艺执行的一种默认配置；是否允许动态规划和局部跳回，应另看具体行为。

## 2. 主代表 FLORA：从有效做法到团队可用工具

以下九步是按官方功能重建的典型操作链，不是本次实操记录，也不表示每次使用都必须经过全部步骤。

1. **搭建一次制作。** 在画布添加并连接文本、图像、视频等节点；模型决定参考图可充当哪些输入。多输入可调整次序，节点可先连线、运行时再检查就绪情况。[D：Canvas](https://docs.flora.ai/editor/canvas)
2. **比较和修正试验。** 多选兼容节点修改共同参数；批量结果中可以只重跑一个格子。对完整历史的复制、试运行错误展示也有明确发布记录。[D：5 月 1 日更新](https://flora.ai/updates/bulk-parameters-grid-reruns-node-sharing)、[D：5 月 8 日更新](https://flora.ai/updates/new-plans-and-creative-code-actions-2026-05-08)
3. **进入封装。** Builder 临时锁住画布编辑，以稳定图结构；选择已经有结果的源节点和末端节点作为输入、输出，路径中的中间节点随之保留。[D：Technique Builder](https://docs.flora.ai/nodes/technique-builder)
4. **定义使用接口。** 输入／输出可命名、写短说明，并以当前内容作为示例；生成输出可按作者选择开放模型或参数修改。发布前检查连接、循环和节点配置。[D：Technique Builder](https://docs.flora.ai/nodes/technique-builder)
5. **发布给适当范围。** 提供私有、工作区与社区可见性；社区上架需要官方审核。发布后还有 App 链接访问范围设置，不能把目录可见性直接视作链接权限。[D：Technique Builder](https://docs.flora.ai/nodes/technique-builder)
6. **成员调用。** Technique 以单节点提供明确端口；也可从 App Mode 提交材料。运行前验证输入并检查用量；可开放的参数变化会重新计算使用成本。[D：Techniques](https://docs.flora.ai/nodes/techniques)
7. **查看批量产物。** 2026-05-27 的更新明确内部批量分发已进入 Technique，集合结果显示在 Builder、App Mode 和运行输出中。[D：Batch Techniques 发布记录](https://flora.ai/updates/batch-techniques-drive-import-2026-05-27)
8. **继续制作或保存。** 输出可以接入后续节点。API 另提供将上次结果作为新一轮参考的做法；需长期保存的结果不能只依赖生成 URL。[D：Techniques](https://docs.flora.ai/nodes/techniques)、[D：Iterate on outputs](https://developer.flora.ai/recipes/iterate-on-outputs/)
9. **维护工艺。** 作者修改并重新发布会更新原 Technique，下次运行使用新版本；取消编辑可恢复原画布。资料未给出调用者固定旧发布版本或回滚发布的操作。[D／U：Technique Builder](https://docs.flora.ai/nodes/technique-builder)

这里的编辑锁定服务于封装过程，社区审核服务于公开上架，都不能推断为短剧的资产批准、镜头采用或审片通过。

## 3. 支撑机制落地的关键功能

下表“机制作用”均为 I；“具体行为”按所标 D 来源确认。功能之间应作为连续设计借鉴，不能只抄一个“保存模板”按钮。

| 核心功能 | 具体行为与证据 | 机制作用（I） |
|---|---|---|
| 类型与输入语义 | FLORA API 要求调用方按工艺实际输入 ID 和类型传值；图像、视频与文本有各自类型。[D：Technique API](https://developer.flora.ai/guides/techniques/) | 工艺使用依赖可检查的接口，帮助人和程序明确要交什么材料 |
| 共同参数编辑 | 多选时只显示所有所选节点共有的参数；不同值显示 Mixed。[D：Canvas](https://docs.flora.ai/editor/canvas) | 批量保持设置一致，同时避免把不存在的参数强加给其他模型 |
| 局部失败处理 | 格子级重跑；Builder 工作流覆盖层可展示试运行错误，Status 页展示试运行结果。[D：5 月 8 日更新](https://flora.ai/updates/new-plans-and-creative-code-actions-2026-05-08) | 让方法作者在发布前看到失败发生在哪一步 |
| 封装接口与示例 | 源／末端选择、端口名称、示例内容、作者开放的输出参数见上节。[D：Builder](https://docs.flora.ai/nodes/technique-builder) | 分开“方法设计者”和“方法使用者”的复杂度；示例也承担使用说明 |
| 单节点与 App Mode | 同一 Technique 可留在画布连到后续步骤，也可在简化界面独立运行。[D：Techniques](https://docs.flora.ai/nodes/techniques) | 重复制作不必每次打开整张执行图 |
| 批量集合 | 内部 fan-out 及集合输出已有正式发布记录。[D：5 月 27 日更新](https://flora.ai/updates/batch-techniques-drive-import-2026-05-27) | 把“一个结果”扩展成可逐项查看的结果集，仍需另行设计逐项采用 |
| 可读与可拆 | Technique 能只读查看内部图，也能拆开为节点继续编辑；普通拆开不能直接还原为封装节点。[D：Techniques](https://docs.flora.ai/nodes/techniques) | 简化使用与专业接手同时存在，避免封装成为无法理解的黑箱 |
| 执行身份与结果 | API 返回独立 run ID、进度、状态及结果；重试可带幂等键。[D：Technique API](https://developer.flora.ai/guides/techniques/) | 模板定义与一次执行分开，给后续 Agent 调用提供稳定接入点 |
| 产物资产化 | 资产有单独 ID 和就绪状态，可供工艺输入并关联项目；生成 URL 不保证永久可用。[D：Assets](https://developer.flora.ai/guides/assets/)、[D：API 入门](https://developer.flora.ai/api/) | 执行成功和成果长期归档是两项不同职责 |

**U｜历史的边界。** 复制节点带历史、旧输出能继续引用，尚不能证明每次 Technique 运行都向用户暴露了完整的图版本、输入快照和全部中间产物。不能把“保留历史”写成完整可复现保证。

## 4. 互补代表：Runway 与 LTX 分别补了什么

**Runway：明确局部重跑与对使用者开放的控制。** 节点可单独运行，也可整图运行；Lock node 保留该节点输出，使其在整图重跑时不再次生成。输入端口用颜色区分类型，必填项有标记。分享链接打开为只读，接收者可以复制；此分享方式不包含生成输出素材。[D：Introduction to Workflows](https://help.runwayml.com/hc/en-us/articles/45763528999699-Introduction-to-Workflows)

Workflow 发布为 App 时，作者设置输入输出标签及显隐，保留关键配置；可返回原流程更新 App，也可取消发布而保留原流程。文档没有说明能否让某个使用者固定旧 App 发布版。[D／U：Publishing Workflows as Apps](https://help.runwayml.com/hc/en-us/articles/47865876793747-Publishing-Workflows-as-Apps)

**I｜三种“锁”应分开。** FLORA Builder 的临时锁保护封装操作；Runway 节点锁选择重用既有输出；App 的配置限制控制调用者能改什么。它们都不是业务质量审批。

**LTX：把依赖变化转化为重新执行范围。** 官方教程说明未改变的输入可复用已有结果，修改视频参数时重新执行视频与其后放大步骤；也可强制重跑指定节点。Prompt Iterator 与 Image Iterator 可组合出批量输入，组合数量会乘算。[D：LTX Flows 教程](https://ltx.io/blog/ltx-studio-flows)

**I｜缓存与显式锁定也应分开。** 缓存判断此前计算是否仍适用；显式锁定表达创作者希望继续使用某个结果。我们的借鉴重点应是向用户解释将重做哪些、保留哪些，而不是默认所有依赖变化都必须触发付费调用。

## 5. 一个短剧制作方法的复用与修改示例

**I｜示例不是产品已有模板或效果承诺。** 假设团队摸索出“角色参考＋场景参考＋镜头描述 → 提示组织 → 图像候选 → 视频”的稳定做法，准备给镜头制作成员使用。

作者先定义业务输入：“本镜头角色造型”“所在场景”“动作与机位说明”，附上合格输入示例；输出定义为“视频候选”，不能直接称作已采用镜头。常用比例等可作为预设，但日常操作者是否能改变模型，应按团队实际分工决定。

成员只换镜头资料运行，发现画面满意而运动不合适时，需要只改运动步骤、保留画面。这个交互可分别借鉴 Runway 的输出锁定和 LTX 的局部重新执行；不能据此声称 FLORA 封装节点已经提供完全相同的内部锁定行为。

当方法作者改用另一模型，下一次运行怎样升级更值得注意。FLORA 的原位更新适合快速维护，但连续剧项目可能要求在一批镜头内继续使用同一工艺版本。我们应评估“新任务默认新版、已开始任务保留旧版、明确提示迁移”的策略，而不是无条件照搬自动取新版本。

最后，Agent 可以选用这一工艺并填写输入。Runway 已描述了读取开放输入、映射聊天材料、追问缺项以及执行共享工艺；对于他人拥有的流程，Agent 不直接修改而建议复制。[D：Agent 与 Workflows](https://help.runwayml.com/hc/en-us/articles/53645211363475-Building-and-running-Workflows-with-Agent) 因此 I：先沉淀有明确定义的业务操作和输入，比第一阶段就要求团队手工画完所有流程更基础。

## 6. 借鉴清单与仍需核验的边界

**I｜优先借鉴**：明确命名的业务输入；有效示例；作者配置与使用者配置分离；单项与批量共用工艺；局部修复时说明保留范围；执行结果留在项目；方法编辑、方法发布、一次运行分别记录。这些能力可由表单、工作台抽屉或画布承载，不要求把节点画布设为所有人的首页。

**U｜发布版本**：FLORA 和 Runway 的文档均不足以确认旧发布版固定、迁移策略、审计及回滚能力。**U｜权限**：目录、链接、源输入、生成输出与图编辑权限不能合并推断。**U｜失败恢复**：格子重跑不等于支持任意内部步骤恢复，取消运行也不等于未计费。

**D／I｜文档冲突处理**：FLORA Builder 末尾仍有“Batch 不支持”的提示，同页其他章节支持 Batch；5 月 27 日正式更新明确增加该能力。本篇采用后者判断功能方向，遗留提示视为疑似未同步；数量上限和复杂嵌套可运行边界仍待实际验证。[Builder](https://docs.flora.ai/nodes/technique-builder)、[正式更新](https://flora.ai/updates/batch-techniques-drive-import-2026-05-27)

**P｜不采纳为事实的效果话术**：同一工艺并不能保证每次相同质量，内部步骤含生成模型就仍然需要结果检查。本类机制主要减少重复组织步骤，并使执行方法可共享。

## 7. 官方截图候选与阅读目的

以下是从官方页面定位到的原图链接，不是本次登录截图；尚未完成本地视觉检查。合并主文档时应先查看，确认读得清再采用，避免截图承担其未显示的动态行为。所有图片版权归对应发布方。

| 候选 | 所在页及具体位置 | 原图链接 | 建议解释 |
|---|---|---|---|
| FLORA 批量参数动图 | [5 月 1 日更新](https://flora.ai/updates/bulk-parameters-grid-reruns-node-sharing)，Bulk parameter editing 下 | [官方 GIF](https://framerusercontent.com/images/qSRMPiPx6WjwX00o99ldnFXzX3w.gif) | 多选后统一设置参数；不据此推断封装内部参数开放方式 |
| Runway 输入输出端口 | [Introduction](https://help.runwayml.com/hc/en-us/articles/45763528999699-Introduction-to-Workflows)，Understanding nodes | [官方图片](https://help.runwayml.com/hc/article_attachments/45812843115027) | 端口与类型、输入／输出方向；适合解释工艺接口 |
| LTX Iterator 批量图 | [Flows 教程](https://ltx.io/blog/ltx-studio-flows)，Step 8 | [官方 PNG](https://cdn.prod.website-files.com/68c6ddbeb26cbd692adc0291/6a159d2cdebfa5f28bf8a4b3_6a004cede8f51a1f8ff6a340_step8.png) | 多个输入经过同一条下游流程；缓存行为以正文为证 |

FLORA Builder 与 App Mode 的关键封装界面，本次没有取得已检视且可直接引用的静态官方图，不能用普通画布图假装展示了发布步骤。已通过公开浏览器页面确认 Builder 文档仅嵌入[官方视频教程](https://www.youtube.com/watch?v=yhamKrHAmII)，没有这些步骤的静态截图；尝试进一步打开视频时，子代理浏览器能力受限，未取得或推断视频时间点。此视频可供主代理补充 Input／Output／Publish 界面的视觉证据。

## 8. 来源台账

均于 **2026-09-08** 访问。下列为本篇实际使用的一手来源；事实就近引用，台账用于复核与更新。

| 来源 | 类型 | 用途与边界 |
|---|---|---|
| [FLORA Canvas](https://docs.flora.ai/editor/canvas) | D | 连线、输入排序、多选参数；不证明业务组织能力 |
| [FLORA Techniques](https://docs.flora.ai/nodes/techniques) | D/P | 调用、参数开放、App Mode、展开；质量保证类话术未采信 |
| [FLORA Technique Builder](https://docs.flora.ai/nodes/technique-builder) | D | 输入输出、发布、更新；Batch 段落冲突已注明 |
| [FLORA 2026-05-01 更新](https://flora.ai/updates/bulk-parameters-grid-reruns-node-sharing) | D | 单格重跑、批量参数、上游链高亮、图片来源 |
| [FLORA 2026-05-08 更新](https://flora.ai/updates/new-plans-and-creative-code-actions-2026-05-08) | D | 节点复制历史、试运行错误和结果 |
| [FLORA 2026-05-27 更新](https://flora.ai/updates/batch-techniques-drive-import-2026-05-27) | D | 内部 Batch 及集合输出正式发布 |
| [FLORA Technique API](https://developer.flora.ai/guides/techniques/) | D | 输入契约、异步执行身份、幂等；未实际调用 |
| [FLORA API 入门](https://developer.flora.ai/api/) | D | 结果 URL 生命周期、执行返回；未申请密钥 |
| [FLORA Assets](https://developer.flora.ai/guides/assets/) | D | 资产身份、就绪、项目关联 |
| [FLORA Iterate on outputs](https://developer.flora.ai/recipes/iterate-on-outputs/) | D | 结果继续作为参考；代码示例输入名称并非所有模板通用 |
| [Runway Introduction to Workflows](https://help.runwayml.com/hc/en-us/articles/45763528999699-Introduction-to-Workflows) | D | 类型、锁定、局部运行、分享边界 |
| [Runway Publishing Workflows as Apps](https://help.runwayml.com/hc/en-us/articles/47865876793747-Publishing-Workflows-as-Apps) | D | 接口显隐、发布、更新与取消发布 |
| [Runway Agent 与 Workflows](https://help.runwayml.com/hc/en-us/articles/53645211363475-Building-and-running-Workflows-with-Agent) | D | Skill 区别、Agent 映射输入、他人工艺修改限制 |
| [LTX Flows 教程，2026-05-07](https://ltx.io/blog/ltx-studio-flows) | D/P | 缓存与批量操作；效率效果主张未实测 |

访问受限项：FLORA Batch Node、Export Node、Collaboration & Sharing 的直接正文读取返回内容类型错误或 403，因此没有把索引标题当成功能证明；相关必要事实改用明确的正式更新与 API 页面核对。

# 产品机制研究：截图来源与观察记录

采集及视觉核验日期：2026-09-08（Asia/Shanghai）。全部在研究专用浏览器会话 `drama-research` 中打开公开来源并截图。没有登录产品、运行生成或模拟竞品 UI。采集方式为 Playwright 浏览器元素截图，未对界面图进行内容重绘。

## C-1 · Katalist：剧本结构

- 文件：[katalist-script-structure.png](images/katalist-script-structure.png)
- 尺寸：1600 × 1023。
- 一手来源：[Story Canvas 官方指南](https://help.katalist.ai/en/articles/16298583-how-to-build-your-storyboard-and-videos-in-story-canvas)。
- 原演示：[How to Build Storyboards and Videos](https://www.loom.com/embed/91cb1424e2084a91a335de815b289d06)，00:24；页面显示总长约 03:42。
- 观察：Script Breakdown 侧栏列场景与镜头，场景有 Add to Canvas，中间画布尚未展开。
- 范围：官方录像中的界面，不是本轮产品操作；不能推断生成或全剧协作效果。

## C-2 · Katalist：内容展开与参考卡

- 文件：[katalist-script-canvas.png](images/katalist-script-canvas.png)
- 尺寸：1600 × 1023。
- 一手来源：同上官方指南与视频，00:45。
- 观察：Man 与 Frozen Tundra Plains 卡片、Frame 1—3 参考标识、画面描述及动作选项可见。
- 范围：图支持可见对象关系；自动分配及后续制作规则由官方文字指南支持。

## D-1 · TapNow：连线与本次引用

- 文件：[tapnow-reference-connection.png](images/tapnow-reference-connection.png)
- 一手来源：[认识节点与连接](https://docs.tapnow.ai/zh/docs/canvas/understand-nodes-and-connections)，连接节点动图。
- [官方原动图](https://files.tapnow.media/api/conversation/storage/uploads/1cdf3cac-ceff-4218-856c-3472cb1e070f?variant_name=high)。
- 观察：左图连到右侧生成节点，提示区域包含引用缩略图及 `@` 使用说明。
- 范围：动图公开播放时的单帧，无精确播放时间记录；不代表本轮执行。

## E-1 · TapNow：Ask 确认卡

- 文件：[tapnow-ask-confirmation.png](images/tapnow-ask-confirmation.png)
- 一手来源：[Choose a generation mode](https://docs.tapnow.ai/en/docs/agent/choose-a-generation-mode)，Confirmation card 动图。
- [官方原动图](https://files.tapnow.media/api/conversation/storage/uploads/dc2b6391-5331-4f10-8373-fea05ecef122?variant_name=high)。
- 观察：提示、模型、画幅、分辨率、数量和费用与确认操作集中在卡片内。
- 范围：模型与价格为演示画面，不作为当前报价或推荐。静态图不证明执行后的行为。

## E-2 · TapNow：可重新打开的文字成果

- 文件：[tapnow-agent-outputs.png](images/tapnow-agent-outputs.png)
- 一手来源：[Manage Agent outputs](https://docs.tapnow.ai/en/docs/agent/manage-agent-outputs)，Agent outputs in the sidebar panel 动图。
- [官方原动图](https://files.tapnow.media/api/conversation/storage/uploads/ce4c0c9e-0746-4453-9518-4d38ea813106?variant_name=high)。
- 观察：中间打开 Space Travel Story 文档，上方有 Add to Canvas 与 Discuss；右侧保留对话。
- 范围：选取的是打开文档后的状态，未以此声称截图显示完整 Outputs 列表。

## F-1 · Runway：输入输出端口

- 文件：[runway-typed-ports.png](images/runway-typed-ports.png)
- 尺寸：798 × 492（原图 797 × 491，浏览器截图含边缘）。
- 一手来源：[Introduction to Workflows](https://help.runwayml.com/hc/en-us/articles/45763528999699-Introduction-to-Workflows)，Understanding nodes。
- [官方原图](https://help.runwayml.com/hc/article_attachments/45812843115027)。
- 观察：左侧 Prompt、Image 输入与必填标记，右侧 Video 输出，节点有 Run。
- 范围：官方解释性图片，本轮通过浏览器截图保留；不是 App 发布界面，也不证明锁定机制。

## 未采用与受限来源

- Katalist 落地页的营销拼贴可打开，但不足以解释具体交互，未纳入文档。
- TapNow 产物动图初次截到对话起始画面，已替换为能显示文档与操作入口的画面。
- FLORA Builder [官方视频](https://www.youtube.com/watch?v=yhamKrHAmII) 要求登录验证，未进一步访问；未用其他图冒充。正文以明确标识的 Mermaid 研究示意解释封装机制。

图片版权归对应发布方。本文仅用于内部产品研究与讨论。

# 即梦与 LibTV 画布能力全景清单

日期：2026-09-18。用途：**掌握两个产品画布功能的完整设计,作为 SceneDesk 画布对等实现的依据。**

## 0. 证据等级与本次实测范围（先读，决定每条结论能用在哪）

| 来源 | 强度 | 覆盖 | 限制 |
|---|---|---|---|
| **即梦线上生产 JS 包** | 一手·代码级 | 图层模型、插件注册表、右键菜单 20 动作、悬浮工具条 49 工具、标题组件、生成落点常量 | 调研者未登录、未渲染页面 |
| **即梦实机走查（本机 Playwright + 用户登录态）** | 一手·现场 | 入口、空态两选一、输入条 722×176、右侧面板 440×901、结果卡片结构、Agent 意图分析/任务规划、快捷键 | `/ai-tool/canvas` 每次开新空项目；**用户已存项目入口未取到** |
| **LibTV 官方前端文案字典** | 官方·文案·间接 | 节点类型全表、连线 CLI 语义、协作/离线冲突、Agent 工具集、保存状态机 | 引用 672 个 key 已逐条校验存在；**未登录、未操作真实画布** |
| **LibTV 官方 CLI 1.0.2 + 官方 Agent 仓库** | 官方·站点 | 节点/分组/连线的命令行级语义 | — |
| **LibTV 实机走查（本机，已登录）** | 一手·现场 | **画布内部已取到**：节点类型菜单、工具箱、角色库、完整快捷键表、Agent 抽屉、发布分享、底部工具轨与状态栏、空态预设 | 已存项目的画布结构未展开（可继续） |

**凡本文件写「未确认」的,均不得据以实现。**

---

# 第一部分:即梦画布能力清单

## 1.1 心智模型

- **对外名称**:「无限画布」(`web_canva_feature_entry_title`),副标题「自由创作」。**【代码】**
- **不是固定版式**:插件注册表自证 —— `snapping-plugin`(吸附,`dragThreshold:8, scaleThreshold:6`)、`edge-pan-plugin`(边缘平移)、`scrollbar-plugin`(双向滚动条)、`minimap-plugin`(自述 "MiniMap plugin for **infinite canvas**")、`placeholder-plugin`。**【代码】**
- **元素关系 = 位置 + 画板归属 + 生成溯源**;画布上**存在可见连线**(用户截图证实),但**连线的 UI 实现未定位到**。**【已推翻原「无连线」结论】**

## 1.2 元素（图层）类型 —— 已确证存在的 6 类 + 1 特殊

| 类型 | 说明 |
|---|---|
| `image` | 图片图层 |
| `video` | 视频图层(可拖拽、可变换) |
| `text` | 文本图层 |
| `text-card` | 文本卡 |
| `frame` | **画板** —— **二维网格容器**,`children[row][col]`,`frame.addRow` / `removeRow`,空行与空画板自动清理 |
| `free-layout-frame` | 自由布局画板(不走行列) |
| (对话卡片) | 生成会话以卡片形式存在于画布,`card-item-*` |

**容器模型**:`layerPosition.containerType ∈ { "document"(画布根,按 index 排层) , "frame"( frameId + row + col ) , "free-layout-frame" }`。**【代码】**

⚠️ 调研者已自行降级:该表**不是全集**(用户截图中的节点卡片在此表中无对应物)。

## 1.3 新建元素

- **左侧工具栏是一个可插拔的工具注册表**:模块导出 `LeftToolbar / ToolbarRegistry / AddBoardTool / AddBoardHandlers / AddTextTool / AddTextHandlers / AddImageHandlers / AddVideoHandlers`。**【代码】**
- **实机确认的入口**:空态呈现「这次创作想从哪里开始?」+ **平级两项「本地上传」「选择资产」**;底部输入条可直接写提示词交给 Agent。**【现场】**
- **上传后行为**:「本地上传」的文件进入**本次会话的临时参考资源**(`removeWhenUnreferenced: true`),未被引用即回收,**不自动入库**。**【代码 + 现场吻合】**

## 1.4 元素操作 —— 两套并行入口

### A. 右键上下文菜单（`attribute-menu`）20 个动作 / 4 组**【代码】**

动作形状:`{name, group, text, shortKey, shouldMenuDisable(), shouldHide()}`。

| 组 | 动作 |
|---|---|
| `0-basic` | 复制 · 粘贴 · **创建副本** · Copy as image · 删除 · 重命名 · 导出 · 批量下载 · **合并导出** · 下载图片 · **生成信息** |
| `1-special` | **Add to chat**(加入对话) · **创建主体** · **新建画板** · 生成视频 |
| `3-layer` | 上移一层 · 下移一层 · 置顶 · 置底 |
| `4-basic` | 翻转(水平/垂直) |

**两个条件判定值得照抄**:`Export.shouldHide = () => selectedLayerIds.length !== 1`(仅单选出现);`Frame.shouldMenuDisable = () => selectedLayerIds.length < 2` —— **「编组」的语义就是「装进画板」,且需选中 ≥2 个**。

### B. 悬浮选择工具条（`suspend-tool`）49 个工具**【代码】**

- **位置算法**:浮在选中元素上/下方;`const e = (fixedAtBottom) || y.y < 145 ? "below" : "above"`,即**选区顶部 y<145 时自动翻到下方**,避免顶出视口。
- **工具分组**:

| 类别 | 工具 |
|---|---|
| 对齐 | 左/居中/右/顶部/垂直/底部对齐 |
| 排列 | 水平均匀分布 · 垂直均匀分布 · **自动排列** |
| 画板 | 画板设置 · 自定义尺寸 |
| **图像编辑** | **局部重绘** · 超清 · Creative upscale · **抠图** · **扩图** · 多角度 · 消除笔 · **融图** · 画面微调 |
| 文字 | 文字重绘 · **改文字** · 字体大小 · 文本对齐 · 加粗 |
| 生成 | Generate video · 生成信息 · **再次生成** · **重新编辑** |
| 视频 | AI音效 · 补帧 · AI配乐 |
| 对话/资产 | Add to chat |
| 下载 | 下载 · 批量下载 · 合并导出 · 下载图片 · 下载视频 |

**关键设计观察**:AI 编辑动作(局部重绘/扩图/抠图/融图/改文字/超清)与几何操作(对齐/置顶)**在同一条工具条上** —— 对图做 AI 编辑不需要先切"AI 模式"。

### C. 多选与变换**【代码】**

- `hasMultiSelected = selectedLayerIds.length > 1`;全选 **⌘A / Ctrl A**;批量动作统一埋点 `reportCanvasBatchAction(action, layers, actionMethod="right_click_menu")`。
- 多选共用**同一份**悬浮工具条,各动作自行 `shouldHide/shouldMenuDisable`。
- 变换:`updateLayout({layerId, layout:{x,y,width,height,rotation,scale:{x,y}}})`;**旋转后跨容器拖拽需按角度做坐标换算**。

### D. 图层标题可编辑**【代码 + 现场】

- `new TitleWidget({stage, titles, maxLength:25, iconUrl, emptyDisplayText})`;图片空标题回退显示「图片」、视频回退「视频」;可**双击改名**、`setTitleVisible(bool)`。
- 实机确认:结果卡片标题行有**铅笔图标**(显式重命名按钮,`reportRenameFrame(id,"button")`)。**【现场吻合】**

## 1.5 生成在工作流里的位置**【现场 + 代码】**

- **画布底部常驻输入条**(实机 722×176 @ 439,762),内含:Agent 模式切换 · 自动 · 灵感搜索 · 创意设计 · 发送键(`lv-btn-primary` 36×36)。
- 提交后 Agent 先输出**意图分析**与**任务规划**,再自行决定生成数量。实机原文:

> 意图分析:用户需要生成一张极简风格的图片…属于纯平面极简图形创作需求。
> 任务规划:使用文生图工具,生成4张符合要求的图片,选择1:1正方形画布适配正圆形的居中构图…**给用户提供细节质感略有差异的多样选择**。

- **结果落点在提交瞬间即绑定**:`_bindLayerPositionAfterTaskSubmit(task, …)`;N 个结果按 `placeSize = u + (N-1)*s` 规划成**一行横向排列**,共用 `placementSubmitGroupId`(同一次提交)与 `placementStep`(水平步距)。**【代码】**

## 1.6 结果展示与"采用"

- **没有任何「选用/采纳」按钮**。结果按 `placementStep` **在画布上并排铺开**,只有三个动作:**重新编辑 / 再次生成 / 使用修改**。**【代码 + 现场】**
- 结果卡片实机结构(即梦):

```
[标题行]  ▢ old-key-sh04-a            ✎(重命名)
[提示词]  以这张静帧为参照生成视频：镜头极轻微缓慢推近，全程约 5%；人物自然地对镜头说话…
[参数]    ◫ Seedance 2.0 Fast VIP · 5s · 16:9 · 720P · 详细信息 ⓘ
[媒体]    <视频/图片>
[操作]    ⟳ 重新编辑   ⟳ 再次生成   ⋯
```

- **生成溯源**:每个图层记录「我是哪次生成的产物」——`aiGeneratorReference`(`{layerId: {recordId, itemId, type, layerType}}`),`getLayerIdsByConvId(convId)` 可按会话取图层。**【代码】**
- **草稿侧有节点树**:`class DANode` + `childNodes()`(下游子节点)、`AbilityParam extends DANode`;序列化键 `gen_video / merge_video / lip_sync / video_workflow / ai_camera / video_audio_effect / video_bgm`;断言「文生图/AI特效/Speech **只能作为根节点**存在」——即**「单根 + 子节点」的有向节点树表达一次生成任务**。**【代码,见 §12.4】**

## 1.7 导航与组织**【代码】**

- 插件级:吸附(`snapping`,阈值 8/6 px)、边缘平移、双向滚动条、**小地图**、占位符。
- 容器级:画板(网格)/ 自由布局画板;画板可设置、可自定义尺寸。
- 自动排列(`auto_distribute`)、水平/垂直均匀分布。

## 1.8 AI 交互**【代码 + 现场】**

- **右侧 Agent 面板**:`right-panel`,实机 **440×901**,从右侧滑出,默认关闭;可拖拽调宽(`resize-handle`,CSS 变量 `--right-panel-width`)。
- 面板内空态:「和Agent聊聊你的想法」「从已有素材开始」「上传参考图」。
- **会话本身就是画布上的卡片**(未读角标/封面/可就地改名);画布内用 `@` 引用素材。
- **删会话不删产物** —— 原文:「删除的会话记录将无法恢复,**生成的内容将保留在画布上**」;「删除对话后,**仍可在「资产」中找回已生成的内容**」。**【代码】**

## 1.9 持久化与协作**【代码】**

- **动作级自动保存 + 多人实时协同**(`ICollaborationService` / `changeset.actionInfoList` / `commitId`),**无保存按钮**;远端变更 `canUndoRedo:false` **不进本地撤销栈**。
- 界面用**区域注册表**(`getAreaContent / registerAreaContent`)而非写死布局。

## 1.10 界面区域（实机实测）

| 区域 | 实测 |
|---|---|
| 顶栏 | 左「未命名项目 ⌄」+ 刷新;右「+N 会员 会员中心」「对话」 |
| 左轨 | 4 个图标 36×36 @ x≈12(上传 / 添加 / 网格 / 文字) |
| 中央 | 无限画布 |
| 底部输入条 | 722×176 有边框容器 |
| 右侧面板 | 440×901 滑出 |
| 缩放 | 左下「− 11% + ▷」(zoom 可为 1%/11% 等) |
| 画布自带引导 | 「按住空格或鼠标中键切换光标的移动和点选模式」「在画布底部输入你的需求,交给 Agent」「点击右上角对话按钮,在侧边栏查看 Agent 对话和历史生成记录」「选中图片或视频,展开更多后编辑能力」 |

## 1.11 即梦第二画布：`/ai-tool/ai-canvas`（本机登录后实测，2026-09-18）★关键发现

**这是与 `/ai-tool/canvas` 完全不同的第二个画布实现**,且是**独立构建**:

| 项 | `/ai-tool/canvas` | **`/ai-tool/ai-canvas`** |
|---|---|---|
| 静态资源根 | `…/ies/dreamina/web/jimeng/static/js/` | `…/ies/**lvweb/octo_web**/static/js/` |
| runtime | `runtime.9ccfaac15c.js` | `builder-runtime.cc7a800f6e.js` + **`async-canvas-feature-runtime`** + **`async-canvas-collaboration-runtime`** + **`async-canvas-generation-node-draft-runtime`** |
| 入口 | 首页「画布」 | `/ai-tool/ai-canvas`(`from_page=assets` 时从资产页进入) |
| 节点类型 | 未确认(空态只有两选一) | **左轨 9 个显式类型** |

> **这解释了 §12 的取证漏洞**：调研者枚举的是 `jimeng/` 下的 298 个 chunk，而**节点/连线/生成的实现位于 `lvweb/octo_web/` 这一独立构建**。他的方法前提「入口 HTML → runtime → chunk 映射 = 全部前端资源」对独立构建不成立 —— 他的判断是对的。

### 左轨 9 个节点类型（实测，40×40，x=20）

`文本`(y308) · `图片`(y350) · `视频`(y392) · `音频`(y434) · **`时间线`**(y476) · **`主体`**(y518) · **`导演台`**(y560) · `资产库`(y616) · `上传`(y658)

### 顶栏与状态栏（实测）

- 顶栏：`Canvas title: 未命名项目` · 搜索 · **生成历史** · `Credits: 151 · 基础会员` · 用户菜单
- 状态栏：`选择工具` · **`小地图`** · **`显示连线`** · `Zoom options, 100%`
- 右下：**`与 AI 对话`**(118×34)
- **画布自报状态（实测原文，含 node/edge/selection 三元组）**：

```
1 node, 0 edges, 1 selected. Editable. Room connected. 已保存.
时间线: 1 visual track, 0 audio tracks, 0 clips.
Empty subject: main missing, 0 auxiliaries, voice missing…
No resources: 0 ready, 0 processing, 0 failed.
```

→ **`edge` 是画布数据模型里的一等概念**,并且**「Room connected」证实实时协作房间**。

### 各类节点的生成参数面板（实测，`generation-input-panel-shell` 680×196~208）

| 节点 | 面板实测内容 |
|---|---|
| **文本** | 双击编辑文本;节点标题「文本 1」;`背景色`(样式属性,非生成) |
| **图片** | `添加参考` · **选择模型: 图片 5.0 Lite** · **图片尺寸选项: 1:1 · 2K · 1** · **`Current price 3 / 张`** · `生成` · 占位「上传参考图、输入文字或 主体，描述你想生成的图片」 |
| **视频** | `添加参考` · **生成模式: 全能参考** · **选择视频生成时长: 4s** · 模型 **即梦 Seedance 2.0 VIP** · `16:9` · `720P` · `1` · **`Current price 56`** · `生成` |
| **音频** | `添加参考` · **创作类型: 音频生成** · **选择模型: SeedAudio 1.0 (New)** · **音频生成: 全能配音** · **音色: 音色库** · `显示折扣详情`(**12 / 原价 24 / 积分5折**) · 占位「输入台词并描述声音，可上传参考音频，通过 @ 引用多个音色，使用**时间戳**编排人声、音效与配乐。」 |
| **时间线** | **完整剪辑器**:`00:00 / 00:00` 时间码 · **`全屏编辑`** · 时间标尺 `00:05 / 00:10 / 00:15 / 00:20 / 00:25 / 00:30` · `添加素材到时间线` · **`Drag clips to reorder them. With the keyboard, press Shift + Left or Right Arrow.`** · 轨道计数 `1 visual track, 0 audio tracks, 0 clips` |
| **主体** | `主体 1` + `添加描述...` · **`导入主体`(三路: 从画布选择 / 从资产库选择 / 本地添加)** · `添加主媒体`;状态 `Empty subject: main missing, 0 auxiliaries, voice missing…` |
| **导演台** | 已创建成功(节点数 +1);**面板内容未取到**(截图已存 `jc2-导演台.png`) |
| 资产库 / 上传 | 未弹出面板(直接进入选择/上传流程) |

### 与 SceneDesk 的直接关系（重要）

这版画布的结构**与 SceneDesk 的目标高度重合**:

| 即梦 ai-canvas | SceneDesk 对等物 |
|---|---|
| `文本 / 图片 / 视频 / 音频` 节点 | 文字 / 图片草稿 / 视频草稿 / 声音草稿 |
| **`时间线`节点(多轨道、可拖拽重排、Shift+方向键、全屏编辑)** | Shot 排序与选用(SceneDesk 目前是镜头列表,不是时间线) |
| **`主体`节点(主媒体 + 辅助 + 音色,三路导入)** | 角色/道具/场景资产 + 固定版本 |
| **`导演台`节点** | 无对口能力(与 LibTV 的导演台同名) |
| **`edge` 一等概念 + `显示连线` 开关** | 节点连线(来源与引用) |
| `Room connected` | `canvas-reconcile.ts` |
| **生成面板内联价格(`3 / 张`、`56`、折扣原价)** | 估价与执行许可(有,但不在画布节点上) |

## 1.12 即梦未确认清单（不得据以实现）

连线 UI 的数据结构/创建手势/`+` 手柄语义 · 双击空白是否新建 · 图层锁定 · 解组 · 多结果比对视图 · 撤销栈深度 · 协作光标/人数上限 · 评论 · 版本历史面板 · 三块 toolbar 的实际内容 · 除右面板 440px 外**全部布局尺寸** · 结果「封面素材」如何产生。

---

# 第二部分:LibTV 画布能力清单

## 2.1 心智模型 —— 官方新手引导原文（最硬的一条）**【官方文案】**

> 欢迎来到哩布TV的创作画布。你可以从一个简单想法开始,把图片、视频、音频、脚本和模型连接成完整流程。**每个节点代表一次创作动作,每条连线代表素材和能力之间的关系。**无论是生成分镜、制作短片,还是整理灵感,复杂的视频创作都可以变得更清晰、更自由。

- 连线与建节点**是同一个交互的两种结果**:`dragOrClickSelectNodeType = 拖拽连线或点击选择节点类型`。
- **存在不承载依赖的连线**:`nodeTypeReferenceDesc = 备忘文本；连线仅为示意`。
- 「无限」指**单个画布内的空间**,不是数量:`workspaceCanvasLimit = 每个项目最多只能有 {max} 个画布`。

## 2.2 节点类型全表（20 项）**【官方文案】**

| 分类 | 类型 | 描述文案 |
|---|---|---|
| 生成类 | **文本** | 剧本、广告词、品牌文案 |
| | **图片** | 海报、分镜、角色设计 |
| | **视频** | 创意广告、动画、电影 |
| | **音频** | 音效、配音、音乐 |
| | **脚本**(V2 / 旧版) | 创意脚本、生成故事板 |
| 编辑类 | **智能剪辑** | 多个视频片段合为一个 |
| 组织类 | **分组** / **视频组** | — |
| 专用类 | **导演台** | 搭建3D场景,截图作为构图参考 |
| | **Director Studio** | — |
| | **逐帧拉片** | 拆解视频的风格、运镜与音频 |
| | **720°全景** | — |
| | **参考节点** | 备忘文本;连线仅为示意 |
| 其它 | 风格 / 特效 / 自定义 / 临时 | — |

**另一层命名:生成器节点** —— 文本生成器 / 图片生成器 / 视频生成器 / 音频生成器 / 脚本生成器。即**「生成能力」与「承载内容的节点」是分开表述的**。

## 2.3 连线语义（CLI 直述,本报告最硬证据）**【官方 CLI】**

| 能力 | 证据 |
|---|---|
| 入边 | `--left <node>` 入边(确保)、`--left-add`(追加)、`--left-rm`(移除) |
| 出边 | `--right` / `--right-add` / `--right-rm` |
| 默认行为 | 「无写参且标准输入为逐行 JSON 则**补入边,缺边则创建**」 |
| **顺序即引用顺序** | `--left` 的连线顺序 = 上游引用顺序;prompt 里用 `{{Image 1}}` `{{Image 2}}` `{{Video 1}}` 引用第 N 个上游 |
| 合法性规则 | `notifyConnectRuleViolation = 不符合连线规则`、`cancelConnect = 取消连线` |
| 断开有后果说明 | `disconnectEdgeMessage = 断开后脚本关联关系将消失，重新生成时将不再关联脚本信息了` |
| 显隐 | `showNodeEdges / hideNodeEdges / edgesGuideTip = 点击可显示/隐藏画布上的连线` |
| 计数 | `nodesBatchCountSummary = 共 {nodeCount} 个节点、{connectionCount} 条连线` |

## 2.4 新建元素 —— 五个入口**【官方文案 + 第三方】**

1. **双击画布**:`onboardingStep1Desc = 双击或右键创建新节点`;`presetSeedanceImageTitle = 双击画布 - 上传 - 选择图片文件（也可选择视频/音频文件）`
2. **右键菜单**:`addNode = 添加节点`
3. **从连线端点拖出**:`dragOrClickSelectNodeType`、`connectionHandlerNode = 新节点`、`connectionHandlerNode2 = 源节点`;端点拖出可直接选到"生成什么"这一步(`connectionHandlerPromptImageGenerate = 根据图片生成提示词`)
4. **节点类型菜单**:含 2.2 全表 + **「上传」**(`uploadToCanvas`)+ **「添加资源」**(`addResource`,`uploadMediaHint = 可上传图片、视频、音频文件`)+ 两个库入口 `nodeTypeMenuStyle = 风格库`、`nodeTypeMenuText0024f2 = 特效库`
5. **命令面板**:`createCanvasAndAdd = 新建画布添加`

**第三方描述**:「在画布空白处双击,即可快速新建节点。也可以直接将图片、视频、音频文件拖入画布。」

## 2.5 节点操作**【官方文案】**

- **可达性**:`nodeKeyboardA11yDescription = 按 Enter 或空格键选择节点。按 Delete 键删除节点，按 Esc 键取消选择。`
- **多选**:`selectedCount = 已选择 {count} 项`、`selectAll = 全选`、`deselectAll = 取消选择`
- **复制的两种语义（最值得借鉴）**:

| 动作 | 文案 | 语义 |
|---|---|---|
| 复制节点(轻) | `copyNodeTip = 仅复制当前节点`、`copyNodeOnlyTip = 仅复制节点本身` | 只拿节点 |
| 复制节点和连线 | `copyNodeAndEdges = 复制节点和连线`、`copyAllWithEdges = 复制全部，包括连线` | 连边一起 |
| **创建副本(参数克隆)** | `createCopy = 创建副本` | **复制全部生成参数 + 只复制上游连线 + 不继承生成任务**,并把边界写进提示原文 |

`createCopyTip` 原文:

> 复制当前所有参数，方便你尝试不同提示词和参考内容；请注意**仅支持复制上游连线，下游连线需根据新需求手动连接**。

- **编组**:`groupNodes = 打组` / `groupUngroup = 解组`;整组执行 `groupRunAll = 整组执行`、`groupStop`、`groupRegenerate`;**组的类型化** `normalGroupLabel = 分组` / `storyboardGroupLabel = 分镜图` / `storyboardGroupContextLabel = 分镜组` / `videoGroupDefaultTitle = 视频组`,可互转(`groupConvertToStoryboard` / `convertToNormalGroupLabel`,后者附大段后果说明)。
- **分镜组有结构约束**:`storyboardGroupDisabledReason = 分镜组仅支持图片节点，且组内节点数量不可超过25个`;宫格 `storyboardGridLabel = 宫格 {cols}×{rows}`。
- **对齐/整理**:仅 `tidyCanvas = 整理画布`;**未找到对齐/分布控件**。
- **锁定/旁路**:未找到通用节点锁定;找到的 lock 均属导演台、参数锁定或协作锁。**不能声称支持"禁用节点"。**
- **批量工具条**:`batchOperation = 批量操作` → `batchOrganize = 整理` / `batchGenerate = 批量生成` / `batchDelete = 批量删除`(带确认);并含 `multiSelectionToolbarSave = 保存到团队资产` 等入库动作。
- **画布级**:`canvasStoreCanvas = 清空画布`、`canvasStoreCanvas2 = 重置画布`。

## 2.6 生成位置与参数分层**【官方 CLI + 文案】**

- **生成是「节点内的一次执行」**,分三层:**单节点** `libtv node ... -r, --run` / **整组** `groupRunAll = 整组执行` / **脚本节点建分镜图组** `libtv script storyboard`。
- **参数分两层(CLI 直述)**:

| 写入位置 | CLI | 语义 | 校验 |
|---|---|---|---|
| `data.params.*` | `-s, --set k=v` | **生成器参数**(喂给模型的) | 走模型 schema 校验,表外键被拒 |
| `data` 顶层 | `-u, --update k=v` | **节点自身属性**(不影响模型) | 仅白名单 |

  CLI 例:`-s model=可灵O1 -s ratio=16:9 -s count=2`;`-u content='["Hello"]' -u contentWidth=720`。并明确**类型创建后不可改**、展示名走 `--name`。
- **模型 ↔ 已连素材的前置校验(设计得最细的一处)**:`modelRequiresMediaInput = 该模型不支持纯文字生成，需要连入素材`、`videoModelRequiresMedia`、`needImageAndVideo`、`modelUnsupportedMediaTypes = 该模型不支持当前连入的{types}素材`、`modelLockedByStyle = 当前节点已使用风格，模型不可切换`。**不合法组合在参数层就被拦住并说明理由,不等生成失败。**
- **生成中的可控性**:`cancelGeneration = 取消生成`,附代价告知 `cancelConfirmCostWarning = 停止将不退还已消耗算力。`;并发上限与排队 `groupRunConcurrencyWaitToast = 已达并发任务上限，超出的任务将自动排队重试`。

## 2.7 结果比较与采用**【官方文案】**

- **没有「选用/采纳」按钮**。三件套:**星级评级 + 重新生成 + 生成历史**。
- 评级:`ratingButton = 评级`、`ratingRated = 已评级：{rating}`;**多结果时评级要选作用范围** —— `ratingMultiConfirmMessage = 该节点包含多个素材，请选择 {rating} 星评级的作用范围`,可选 `ratingMultiConfirmAll = 全部评级` / `ratingMultiConfirmCover = 仅封面素材`。
- **评级回灌筛选**:`historyRatingStars = {count}星`、`historyMinRatingOption = {count}星及以上`、`ratingFilterMulti = 多个评级`。
- 在节点内翻看多结果:`historyGallery = 历史图库`、`selectFromHistory = 从生成历史选择`、`imageReplacePickHistory`。
- 对比:`compareOriginal = 对比原图`。
- **结果应用回画布**:`apply = 应用`、`notifyApplyToCanvas = 已应用到画布`、`notifyApplyMultipleToCanvas = 已应用 {count} 项到画布`。
- **未确认(最大缺口)**:找不到任何"设为当前版本"的动作;`ratingMultiConfirmCover` 里的「封面素材」如何产生未确认 → **采用是否隐式无法证实**。

## 2.8 画布上的 Agent**【官方文案 + 仓库】**

- **Agent 能读写画布**:读取类 `chatToolCallStatusMetaCanvasProcessing3 = 正在读取画布`、`chatToolCallStatusMetaCanvasNodeProcessing = 正在读取画布节点`;**编排类** `chatToolCallStatusMetaCanvasProcessing2 = 正在编排画布`、`chatToolCallStatusMetaCreateCanvasProcessing = 正在创建画布`、`chatToolCallStatusMetaCreateGenerateProcessing = 正在创建生成任务`。
- **Agent 媒体工具集**:生图/生视频/生音频 · `chatToolMetaCompositeProcessing = 成片合成中` · 裁剪 · 字幕添加 · 转场添加 · 首尾帧提取 · 参考视频分析 · `chatToolMetaDirectorApplyProcessing = 正在搭建3D场景` · 正在编写导演台效果。
- **输入框**:`chatInputPlaceholder = 开始你的创作，或者 @ 引用工作流/节点/资源`;`agentWelcomeTitle = 想创作点什么？`
- **自主性与花费治理**:三档自主性 `低自主 / 平衡 / 高自主`(**文案各不相同**,低自主「会更频繁地询问」、高自主「优先自主推进」);`chatModeManual = 手动模式`(每次生成前询问) vs `chatModeAuto = 自动模式`;`agentSettingsAutoGenerateMedia`(开启后"**可直接消耗积分,提交图片/视频生成,无需逐次确认**");**积分预算闸** `agentSettingsPowerBudget` + `chatPowerBudgetThresholdDesc = 本项目已消耗 {amount}，达到设置的{link}，是否继续生成？`
- **排队/插队**:`chatUnlimitedQueueQueueForFree = 免费排队` / `chatUnlimitedQueueCostsCredits = 消耗积分` / `chatUnlimitedQueueSkippedToast = 已消耗 {power} 积分插队`。
- **只读态**:`agentReadOnlyInputHint = 当前为只读查看模式，不可发送消息或修改会话`。
- **技能沉淀**:`chatSkillSummaryRecommendTitle = 要把这次流程总结成 Skill 吗？`、`chatToolMetaSkillCreatorDone = 已保存为个人 Skill`。
- **外部接入**:官方 `libtv-labs/libtv-skills`(npx skills add …);产品内列出了 OpenClaw / Claude Code / Claude / OpenAI / CodeBuddy / Hermes。

## 2.9 持久化与协作（信息量最大的一节）**【官方文案】**

- **协作画布实时同步,无需手动保存**:`collabSyncTip = 协作画布会实时同步，无需手动全量保存`;`collabSyncRetryTip`(点击重试失败的**增量同步**)。
- **同步状态机**:`已同步 / 同步中 / 待同步 / 已离线 / 连接中 / 同步冲突，点击重试 / 同步失败，点击重试`;`syncStatusIndicatorSave = 离线待保存`、`syncStatusIndicatorHttpErrorTooltip = 同步失败（状态码 {code}），点击重试`。
- **非协作画布仍有显式保存** + **失败保护**:`saveFailedRefreshCanceled = 保存失败，已取消刷新以避免丢失内容`。
- **节点级编辑锁(协作冲突预防)**:`collabNodeEditing = 该节点正在被其他用户编辑`、`nodeReadonlyTooltipGenerateProcessing = 其他成员正在生成中`、`nodeLockedCannotCopy = 其他成员正在编辑该节点，无法复制`、`collabNodeSyncRetry`。
- **在线成员与跟随视角**:`collabPresenceBarHeader = 协作者 · {count}`、`collabFollowMemberAriaLabel = 跟随 {name} 的视角`、`collabFollowControllerFollowingNamed = 正在跟随 @{name}`、`collabPresenceCycleDetected = @{nickname} 正在跟随你，无需再跟随 TA`。
- **离线编辑冲突显式让人裁决**:`offlineReplayConflictTitle = 离线编辑需要你确认`、`offlineReplayConflictDescriptionMultiple = 重新上线后发现 {count} 个节点的离线修改与云端任务结果冲突`;逐项 `覆盖远端 / 放弃本地 / 放弃并复制`,批量 `全部覆盖远端 / 全部放弃本地`。
- **协作会话**:`collabSessionExpiredDescription = 此协作画布已在其他标签页打开`。
- **撤销/重做**:`undo / redo` 存在;`Ctrl+Z` 在资产合并处明确写出。**未确认**:栈深度、是否跨用户、是否覆盖 Agent 动作。
- **其它**:发布保护(水印/不可见,单画布上限 30 节点)、回收站(`recycleNoPermission = 仅团队管理员或所有者可恢复`)。

## 2.10 LibTV 画布实机走查（本机登录后实测，2026-09-18）

画布 URL 形态：`https://www.liblib.tv/canvas?spaceId=<spaceId>&projectId=<projectId>`（从项目页点缩略图进入，**会新开标签页**）。

### 顶栏（实测）

| 位置 | 控件 |
|---|---|
| 左 | 项目名称输入框（`input` 100×21 @78,21）· **「画布 1」**（画布切换）· **工作流** · **故事板** |
| 右 | **发布与分享** · 积分超市 · 积分数（94）· **打开 Agent** |

**发布与分享**（Popover 360×166）只有两项:「在LibTV上发布——发布你的作品和创作过程,让更多创作者看到。」「分享链接——拥有此链接的人可以查看并复制你的画布。」

### 空画布态：4 个预设（实测）

「**双击画布**」「自由生成节点」+ 四个预设按钮(240×56):**故事脚本生成** · **角色三视图** · **全能参考生视频 SD 2.5** · **音频生视频 SD 2.5**。

### 底部中央工具轨（实测，8 项）

`添加节点` · `移动` · `打开工具箱` · `素材库` · `角色库` · `生成历史` · `快捷键` · `教程`（各 32×32）

### 底部左侧状态栏（实测，7 项）

`资产管理` · **`整理画布，Option+Shift+F`** · `切换小地图` · `隐藏节点连线` · `网格吸附` · `缩放选项`

### 添加节点菜单（实测，`z-(--z-panel)` 220×476，带搜索框）

**「搜索画布节点」** 输入框 + 节点类型项：

| 项 | 标注 |
|---|---|
| 文本 · 图片 · 视频 · 音频 · 脚本 | — |
| **智能剪辑** | `Beta` |
| **导演台** | `NEW` |
| **逐帧拉片** | `SD 2.5` |
| 素材库 | — |
| **添加资源** | — |
| **上传** | — |
| **从生成历史选择** | — |

→ 与 §2.2 的 i18n 全表对照：**实测菜单比文案表少**(未出现 分组/视频组/Director Studio/720°全景/参考节点/风格/特效/自定义/临时),说明**并非所有节点类型都在菜单里直接可选**,部分可能通过其它路径产生。

### 工具箱（实测）

「我的工具箱 / 工具箱模板说明」+ 模板列表(每项带「使用」):故事脚本生成 · 角色三视图 · 全能参考生视频 SD 2.5 · 音频生视频 SD 2.5 …(可滚动,共 16 个「使用」按钮)。

### 素材库面板（实测）

两项:**风格库**「新增风格节点 NEW」· **特效库**「新增特效节点 NEW」。

### 角色库面板（实测，含量化数据）

`角色筛选` · `最近使用` · `应用至画布` + 角色类型标签:**甜妹/清新少女 · 霸总/精英大佬 · 温柔熟男/理想男友 · 清冷千金/白切黑女主 · 古风男主 · 古风女主 · 恶毒女配/白莲花 · 正派长辈/父 · 正派长辈/母 · 反派长辈/势利亲戚 · 生活方式普通人 · 时尚感亚洲男生 · 时尚感亚洲女生 · 时尚感欧美男生 · 时尚感欧美女生 · 小男孩 · 小女孩**。

→ **这是短剧角色库的产品化样板**,覆盖了角色类型、年龄性别、地域风格三档,且选中后可「应用至画布」。

### 快捷键面板（实测原文，1152×436）

| 功能 | 快捷键 |
|---|---|
| 创作成组 | `G` |
| 合并分镜组 | `⌥G` |
| 解组 | `⇧G` |
| 连线 | `L` |
| 复制节点和连线 | `D` |
| **生成** | `Enter` |
| 新建节点 | `Tab` |
| 节点复制 | `Option+拖动节点` |
| 创建副本 | `Option+拖动` |
| 放大 / 缩小 / 适应画布 | — / — / `0` |
| 移动 | `V` |
| 抓手工具 | `H` |
| 整理画布 | `⌥⇧F` |
| **撤销 / 重做** | `Z` / `⇧Z` |
| 触控板 / 鼠标 / 键盘 | `Space`(三种输入方式的说明分组) |

**关键观察**:LibTV 把「**生成**」绑定在 `Enter`、「**连线**」绑定在 `L`、「**新建节点**」绑定在 `Tab` —— 即画布的核心动作全部键盘可达,这是 SceneDesk 目前完全没有的一层。

### Agent 抽屉（实测，右侧 400×950）

`新对话`(当前已是新对话) · `历史对话` · **`新对话无法分享`** · `Agent 设置` · `LibTV Plugin` · 关闭
空态:**「选一个 Skill,让创作更快一步换一批」** + Skill 卡片(**皮克斯动画广告 · 爆款拉片复刻 · 新中式美学TVC · 古典武侠电影全流程导演**)
底部输入条:`添加附件` · `选择模型` · `Skill` · `生成模式`(自动) · `Send`;占位文案实测为 **「开始你的创作,或者 @ 引用工作流/节点/资源」**(与 i18n 中 `chatInputPlaceholder` 一致)
另有 `开启浏览器通知,及时获取最新消息开启`

**入口细节**:点「故事板」也会打开同一个 Agent 抽屉(400 宽),且此时顶栏出现 `放大图片` / `放大视频` —— 说明**故事板与 Agent 共用右侧抽屉**。

### 整页可点区域（实测 27 个控件）

`退出跟随`(**协作跟随功能的退出入口,实机存在**)· 画布 1 · 工作流 · 故事板 · 发布与分享 · 积分超市 · 94 · 打开 Agent · 项目名称 · 4 个空态预设 · 添加节点 · 移动 · 打开工具箱 · 素材库 · 角色库 · 生成历史 · 快捷键 · 教程 · 资产管理 · 整理画布 · 切换小地图 · 隐藏节点连线 · 网格吸附 · 缩放选项

**未能验证**:双击画布空白**没有**弹出节点菜单(实测无浮层) —— 与官方文案「双击或右键创建新节点」不一致,可能是我的双击落点不在可交互层,或该引导针对新版画布;**此项标记为未确认,不得据以实现**。

## 2.11 LibTV 画布引擎：React Flow（实测，2026-09-18）

在 LibTV 画布 DOM 中实测到 **`react-flow__edgelabel-renderer`** 类名 —— **LibTV 的画布引擎是 React Flow**,与 SceneDesk 使用的 `@xyflow/react` **是同一个库**。这解释了两者节点/手柄/连线形态的高度相似,也意味着:

- LibTV 的连线交互(手柄拖拽、边增删、边标签)可直接**对照 SceneDesk 现有实现**读懂,不需要重新猜交互范式;
- §2.3 的 CLI 语义(`--left` / `--right` / 顺序即引用顺序 / `{{Image 1}}` 占位)**就是这套 React Flow 边的业务语义层**;
- `隐藏节点连线` / `网格吸附` / `整理画布` / `小地图` 这些状态栏开关,都是 React Flow 生态里的标准能力,SceneDesk 可直接对等实现。

**未能完成的部分（如实记录）**:本轮尝试用「添加节点 → 菜单项」自动建节点未成功(菜单项文本定位到了其它同名元素),因此**节点卡片内部结构、选中后的悬浮工具栏、手柄位置、边的创建手势**仍未取到。截图存 `output/reviews/2026-09-18-workspace-usability-round-2/probes/lbb-*.png`。

## 2.12 LibTV 节点结构（实测建成,2026-09-18）

用文档化快捷键 **`Tab` 打开节点类型菜单**并选择「文本」,成功建成节点。**菜单实测在画布顶部居中弹出**(206×36/项),完整项:

> 文本 · 图片 · 视频 · **智能剪辑** · **导演台** · **逐帧拉片** · 音频 · **脚本** · **素材库** · **上传** · **从生成历史选择**

**文本节点实测结构**:

```
.react-flow__node.react-flow__node-text   (nopan selected selectable draggable)
  尺寸 350×350
  标题      文本节点 1
  节点内动作  「自己编写内容」「文生视频」「图片反推提示词」「文字生音乐」「GVLM 3.1」
  连线手柄    .react-flow__handle-left  @(805,655)
             .react-flow__handle-right @(1153,655)     ← 左右各一个,即入边/出边
  内部渲染    .markdown-content(节点内是 Markdown 渲染区)
  底部输入    div 635×80(y867) —— 画布级输入条
```

**这印证了 LibTV 的节点模型**:节点 = **一次创作动作的容器**,节点内**并列多个可执行动作**(自己编写 / 文生视频 / 图片反推提示词 / 文字生音乐),左右手柄用于建立依赖。与官方引导原文「每个节点代表一次创作动作,每条连线代表素材和能力之间的关系」完全一致。

**同时实测到的 Agent 面板内容**(右侧抽屉):

| 项 | 内容 |
|---|---|
| Skill 列表 | 皮克斯动画广告 `/pixar-animated-ad-creator` · 爆款拉片复刻 `/viral-video-replicator` · 新中式美学TVC `/neo-chinese-aesthetic-tvc` · 古典武侠电影全流程导演 `/hujinquanwuxia` |
| 提示 | 「新对话」「Skill 全开,故事走起」「换一批」 |
| 协作跟随 | **「正在跟随」+「取消ESC」+「按 ESC 退出」**(实测到跟随视角的 UI) |

### 文本生成节点内部（实测，2026-09-18）

```
文本节点 1
待确认后生成                                   ← 生成前的确认语义
写下你想讲的故事、场景或角色设定。
例如：一个来自未来的机器人，在城市屋顶看星星。   ← 提示词占位（真实文案）
GVLM 3.1                                       ← 模型
6                                              ← 计费数值
```

**「待确认后生成」是重要语义**:LibTV 在提交生成前有一个**用户确认**步骤,与它 Agent 的「手动模式:Agent 在每次生成前询问」一致 —— 即**默认不自动消耗积分**。

### 三项未取到的能力（如实记录，不得据以实现）

用文档化快捷键与真实点击尝试后,**以下三项未能复现**:

| 项 | 实测结果 | 说明 |
|---|---|---|
| **全选 / 多选批量** | `Ctrl+A` **只选中 1 个**节点;多选工具条未出现 | 快捷键面板虽列 `G`「创作成组」等,但实测按 `G` 无反应 |
| **成组** | 按 `G` 后无分组产生(无 `group` 节点、正文无分组字样) | 可能与选中数量不足(需 ≥2)或快捷键上下文有关 |
| **拖拽建立连线** | 手柄存在但**实测 0×0**,且三个节点的左右手柄坐标完全重合(左 805 / 右 1153,y 655);**拖拽后边数仍为 0** | 手柄尺寸为 0 说明**未 hover 时不渲染实际命中区**;自动化难以命中,故手势仍未确认 |

→ 与之对照,LibTV 的 `groupRunAll = 整组执行`、`batchGenerate = 批量生成`、`copyNodeAndEdges = 复制节点和连线` 等**批量能力在官方文案里存在**,只是**本轮未能在实机上复现其触发路径**。实现时若依赖这些能力,**必须先补实测**。

## 2.13 LibTV 未确认清单（不得据以实现）

节点类型菜单的形态(列表/环形/搜索)与键盘导航 · 双击与右键是否同一菜单 · 通用节点锁定/旁路 · 对齐/分布控件 · `-s`/`-u` 完整字段清单与默认值 · 参数是否有高级折叠区 · 并发上限数值 · **结果采用环节(最大缺口)** · 缩放范围/网格吸附粒度/小地图是否可点选跳转 · 画布内搜索的匹配范围 · Agent 工具 schema 与是否进撤销栈 · 同步机制(CRDT/OT/自研) · 撤销栈深度 · 区域尺寸与折叠行为 · `topToolBar`/`rightToolBar`/`bottomToolBar` 实际内容 · 是否存在画布级底部时间线。

---

# 第三部分:横向对比与对 SceneDesk 的实现含义

## 3.1 两者的根本差异

| 维度 | 即梦 | LibTV |
|---|---|---|
| 关系表达 | 位置 + **画板归属** + 生成溯源;连线已证实存在但语义未定位 | **连线即依赖**,有合法性规则、顺序即引用顺序 |
| 容器 | `frame` = **二维网格容器** + `free-layout-frame` | 分组 / 视频组 / **分镜组(宫格,≤25 图片节点)** |
| 生成位置 | **底部常驻输入条(Agent)** + 画布浮层 + 光标模式 | **节点内执行**(`--run`),分单节点/整组/脚本三层 |
| 参数模型 | 未确认分层 | **两层**:`data.params.*`(过模型 schema) vs `data` 顶层 |
| 结果处理 | 提交即绑定落点,N 张一行并排;重新编辑/再次生成 | 星级评级 + 生成历史 + 应用回画布;**无采用动作** |
| AI 交互 | 右侧 440px 面板,**会话即画布卡片**,删会话不删产物 | Agent **能编排画布/建画布/建生成任务**,三档自主性 + 积分预算闸 |
| 协作 | 动作级自动保存 + 实时协同,远端变更不进本地撤销栈 | 实时增量同步 + **节点级编辑锁** + **跟随视角** + **离线冲突让人裁决** + 显式保存兜底 |
| 工具条 | **49 个工具**的悬浮条,AI 编辑与几何操作同级 | 批量工具条(整理/批量生成/批量删除/入库) |

## 3.2 两个产品共有、而 SceneDesk 目前没有的能力（按实现价值排序）

| # | 能力 | 即梦证据 | LibTV 证据 | SceneDesk 现状 |
|---|---|---|---|---|
| 1 | **整组/批量生成** | — | `groupRunAll = 整组执行`、`batchGenerate = 批量生成` | **无**;只有单节点生成,「选中并定位整组」仅导航 |
| 2 | **模型 ↔ 已连素材的前置校验** | — | 6 条 `model*` 文案,参数层拦截并说明理由 | **无** |
| 3 | **参数分层**(生成参数 vs 节点属性) | — | `-s`/`-u` 两层,类型创建后不可改 | 未分层:`{type, prompt, output}` |
| 4 | **对齐/分布工具** | 6 对齐 + 2 分布 + 自动排列 | 未找到 | **无**(只有分组) |
| 5 | **标准容器语义**(网格/自由布局) | `frame` 网格 + `free-layout-frame` | 分镜组宫格 `{cols}×{rows}` | 分组(可解散),无网格 |
| 6 | **AI 编辑动作与几何操作同级** | 49 工具条含局部重绘/扩图/抠图/融图/改文字 | 智能剪辑等独立节点类型 | 无 |
| 7 | **"创建副本"= 复制参数 + 只复制上游连线** | `web_canva_create_copy` | `createCopy` + 明确边界提示 | 有「复制」,无语义区分 |
| 8 | **节点重命名(双层:卡片标题 + 铅笔按钮)** | `TitleWidget` maxLength 25 + `reportRenameFrame` | 未确认 | 未查到 |
| 9 | **结果落点在提交瞬间绑定** | `_bindLayerPositionAfterTaskSubmit`、`placeSize` | — | 有 `canvas-result-placement`,是否同语义未查 |
| 10 | **协作:节点级编辑锁 / 跟随视角 / 离线冲突裁决** | 协作服务 + 远端变更不入本地撤销栈 | 完整状态机 + 冲突逐项裁决 | 有 `canvas-reconcile.ts`,能力未对照 |
| 11 | **生成花费治理(积分预算闸 / 自主性分档)** | — | 三档自主性 + 阈值提醒 + 自动消耗开关 | 有预算与限额(见 `04-state-execution-and-budget.md`),未对照 |
| 12 | **小地图 / 吸附 / 双向滚动条** | 5 个插件,吸附阈值 8/6px | 未确认 | 实测**无 minimap**(`hasMiniMap:false`) |
| 13 | **节点级"生成溯源"可查** | `aiGeneratorReference` + 「生成信息」动作 | `assetBoundLabel = 已绑` / `cardJumpToNode` | 有来源记录,呈现方式未对照 |

## 3.3 SceneDesk 已确认**不要照抄**的部分（领域不变量）

1. **结果采用**:两个参考产品都**没有**显式采用动作(即梦靠落点与再生成,LibTV 靠评级与历史)。SceneDesk 必须保留 **可用素材 / 候选选用 / 明确采用 / 成片使用** 的区分 —— 这是根 `AGENTS.md` 的不变量。
2. **Model 改名**:不得为外观照抄而改供应商模型标识。
3. **生成结果自动采用**:两个产品的"结果落在画布上"隐含了某种默认倾向,SceneDesk **不得**让生成结果自动采用或替换成片。
4. **节点小尺寸与自由布局**:SceneDesk 已批准的 `primary-canvas-approved-2026-09-14.md`(无强制"一个镜头一个大容器")与两产品的自由节点模型一致,**不需要改**。
5. **每场一张画布**:短剧业务的组织规则,与 LibTV 的"每项目多画布"不冲突,保留。

## 3.4 若要"实现完整一样的功能",还缺的取证

| 缺口 | 为什么卡住 | 解法 |
|---|---|---|
| 即梦连线 UI 语义 | 画布是登录后按项目加载;`/ai-tool/canvas` 每次开新空项目 | 提供任一含连线节点的画布 URL,或我登录后从项目列表逐个打开(我的选择器未匹配上项目条目) |
| LibTV 画布内部 | 缺登录态;且未取到画布内的 DOM | 在 LibTV 窗口登录一次,我即可自己建画布走查 |
| 两个产品多结果/采用的真实界面 | 需实际跑生成(即梦已跑过一次,4 张;未能定位结果所在项目) | 同上 |
| 全部布局尺寸 | 两份调研均未渲染页面 | 实机走查补齐 |

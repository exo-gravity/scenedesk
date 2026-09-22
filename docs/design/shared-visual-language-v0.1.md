# 共同视觉语言 v0.1

日期：2026-09-10。状态：**共同语言、核心布局与导航已确认；当前明暗样例继续沿用。未展示的品牌标志、命名及营销页面不在确认范围。**

用户在比较 TapNow 官方演示、LibTV 截图与我们的 A／B 提案后，确认以“中性、轻包装、媒体优先、工具就近展开”作为整体视觉方向。早期 A 优先的建议不再作为选色依据。

## 1. 五项已确认原则

| 原则 | 应怎样呈现 | 避免 |
|---|---|---|
| 媒体优先、轻包装 | 自由画布以完整画幅为主体；名称、必要状态轻量附着；选中后展开当前操作 | 每份素材都套标题区、外框、状态栏和常驻按钮 |
| 全局紧凑、局部舒展 | 导航和公共工具克制；当前图片、参考与提示词获得充足空间；必要文字可读 | 所有区域同时高密度，或为了留白隐藏工作必需信息 |
| 工具就近展开 | 选中后出现相应工具和局部输入；低频参数进入更多菜单；关键入口可发现、可键盘到达 | 常驻多个完整侧栏；仅靠 hover 发现必要动作 |
| 形状表达层次 | 媒体边缘克制；浮动输入面板较柔和；工具组紧凑；明度、边界与少量阴影说明层次 | 全部元素同样圆角、同样边框、同样卡片套卡片 |
| 中性底色、克制用色 | 灰阶和排版承担日常秩序；颜色用于关键动作及明确状态；状态辅以文字／图标 | 品牌色填满导航、标签和提醒；对媒体加滤镜表示选中 |

自由画布采用轻量、自由的素材呈现；分镜模式保留统一、有序、易扫描的条目，两者共用字体、控件和状态规则。项目、剧本、剪辑与审阅按工作需要调整密度，不逐页拼接不同风格。

## 2. 视觉简化不能丢失的含义

- 当前选中、当前采用、剪辑使用、固定版本审阅是不同事实；边框只表示选中。
- 必要的失败、待核对、冲突与返工信息保留在对应对象附近，不能一律藏入更多菜单。
- 未选中时保留必要身份与摘要；选中后呈现实际输入、模型与操作；费用、执行仍按既有生成计划处理。
- 助手按需展开、可以收起；与直接操作共享明确引用，不假定读取全部画布。
- 画布的位置和连线不代表镜头播放顺序；本次不改变场次双模式范围。

## 3. 历史同布局明暗对照与当前入口

当前布局及明暗样例见[核心体验 v0.3](scene-walkthrough-review-v0.3.md)和[专项 v0.4](production-detail-design-v0.4.md)。本节下方是早期固定布局对照及当时验证边界，不替代当前布局。

[打开历史对照页](http://127.0.0.1:4311/#/directions/?study=shared&tone=light&state=edit)。

使用同一个 Mantine 页面和同一组素材，只替换隔离的表面、文字、边界、焦点和动作色阶；明暗之间不改变字体、字号、圆角、素材尺寸、位置、控件内容或操作状态。品牌色尚未定稿，低饱和动作色只是对照候选。

| 状态 | 本轮判断的问题 |
|---|---|
| 未选中 | 界面退后后，是否仍能辨认全场素材、当前采用和工作关系 |
| 局部制作 | 候选 B 的选中态、局部工具与提示词是否清楚，输入是否舒展 |
| 助手展开 | 增加对话后，当前对象与制作空间是否仍易辨认，明暗分层是否成立 |

主题与状态写入 URL；提示词和助手草稿只在本次页面会话中保留，切换明暗不丢失。A／B 共用既有静帧示意，不声称呈现实际生成差异。

已从同一浏览器页面导出六张原图（1512px 宽），便于离线评审：

| 状态 | 浅色 | 深色 |
|---|---|---|
| 未选中 | [查看](../../apps/web/public/previews/shared-language-v1/light-idle.png) | [查看](../../apps/web/public/previews/shared-language-v1/dark-idle.png) |
| 局部制作 | [查看](../../apps/web/public/previews/shared-language-v1/light-edit.png) | [查看](../../apps/web/public/previews/shared-language-v1/dark-edit.png) |
| 助手展开 | [查看](../../apps/web/public/previews/shared-language-v1/light-assistant.png) | [查看](../../apps/web/public/previews/shared-language-v1/dark-assistant.png) |

这是设计预览：只切换明暗、三种预设状态并编辑示例输入。导航、模型、添加、生成和聊天发送不执行真实业务。画布采用固定坐标，空间不足时可滚动，并非完整平移、缩放；未接入 React Flow、供应商或新的持久化。

## 4. 确认边界与后续

已确认：五项共同原则、v0.3 核心工作区和导航。四项专项 v0.4 的本轮评审暂无异议，暂时收口。后续设计应复用当前中性明暗样例，不再要求在早期 A／B／C 方向中选一个。

保留调整空间：真实工作室任务下的精确尺寸和默认呈现；未展示的品牌标志、命名、营销页面。浅色为当前原型入口，深色对照继续保留，不由此宣称已有最终品牌系统。

实际数值以 `apps/web/src/theme/shared-language-study.ts` 为当前独立原型来源，早期根主题仍存在；后续正式页面迁移需集中归一，不能把两套主题都称作全站已统一。用法见[UI Agent 规范](mantine-ui-agent-spec-v0.1.md)，确认依据见[设计基线](approved-baseline-2026-09-10.md)。

## 5. 参考与实现

- TapNow：[图片工具](https://docs.tapnow.ai/zh/docs/canvas/generate-and-edit-images)、[画布说明](https://docs.tapnow.ai/zh/docs/canvas/explore-the-canvas)。借鉴对象工具、局部输入与弱包装，不据此推定业务或效率。
- LibTV：用户截图，见[既有证据记录](../research/2026-09-09-scene-canvas-interactions.md)。借鉴白灰分层和完整媒体，不照搬长工具栏或常驻空侧栏。
- [预览页面](../../apps/web/src/pages/SharedLanguagePrototype.tsx)、[隔离色阶](../../apps/web/src/theme/shared-language-study.ts)、[样式](../../apps/web/src/pages/shared-language-prototype.module.css)。
- [上一轮三方向](visual-directions-review-v0.1.md)保留为历史探索，已确认内容以本稿为准。

## 6. 创作台变量（2026-09-21）

核心创作区重建（[决定](creative-workspace-rebuild-libtv-2026-09-21.md) §8）沿用本文的颜色与字体阶梯，结构、密度与交互照 LibTV。凡共享尺度没有对应值的数值，加 `--ws-studio-*` 变量而不是写死在样式里；颜色角色只是把现有调色板放进 LibTV 的位置，日后若要换一套外观，只改这组值。

| 变量 | 值 | 用途 |
|---|---|---|
| `--ws-studio-topbar-height` | 48px | 顶栏 |
| `--ws-studio-toolbar-height` | 48px | 底部工具条 |
| `--ws-studio-tool-size` | 36px | 顶栏胶囊与工具按钮高度 |
| `--ws-studio-composer-width` | 660px | 输入面板宽度 |
| `--ws-studio-reference-size` | 56px | 参考缩略图 |
| `--ws-studio-dock-width` | 400px | 助手与任务停靠时的宽度，创作台让出同样的宽度 |
| `--ws-studio-port-size` | 10px | 卡片端口 |
| `--ws-studio-dot-size`、`--ws-studio-dot-gap` | 1.5px、20px | 点阵背景 |
| `--ws-studio-canvas`、`--ws-studio-dot` | canvas、dot | 创作台底色与点 |
| `--ws-studio-chrome`、`--ws-studio-chrome-border` | surface、line | 顶栏胶囊、工具条、面板 |
| `--ws-studio-card`、`--ws-studio-card-border`、`--ws-studio-card-selected` | surface、line、selection | 卡片本体、细边、选中边 |
| `--ws-studio-card-label` | secondary | 卡外标题、未选中的视图名 |
| `--ws-studio-placeholder` | field | 空卡居中的浅灰图标 |
| `--ws-studio-submit`、`--ws-studio-on-submit` | action、onAction | 圆形提交按钮 |
| `--ws-studio-shadow` | shadow | 浮层阴影 |

尺寸在 `apps/web/src/theme/tokens.ts` 的 `studio`，颜色映射在 `theme.ts` 的 `scheme()`，浅深各一组；浅色为准，深色只保证可读不坏。分片记录见[85](../implementation/85-studio-rebuild.md)。

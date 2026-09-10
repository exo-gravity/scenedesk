# MVP 通用 React UI 选型评估

日期：2026-09-09。范围：通用界面、表单、主题和多面板布局；播放器、拖拽、虚拟列表与媒体编排由相邻专项评估负责。

## 决策

**推荐 Mantine 9.6.0 作为本项目唯一通用 UI 组件库，使用 CSS Modules 和集中主题配置适配现有深色视觉。** 首批使用 `@mantine/core`、`@mantine/hooks`、`@mantine/form`；通知、文件投放等扩展按实际页面需要加入，不整套预装所有扩展。

这是针对“团队规模有限、希望尽量少维护基础交互、需要高密度创作页面和生成表单”的工程判断，不是所有 React 产品的统一排名。判断依据是现有功能覆盖、定制方式和维护责任，不使用 stars、品牌或出现年代替代质量结论。

Kumo 为通用 UI 备选。只有在实际场次页面中 Mantine 的主题、组合或交互存在具体障碍，才重开备选评估。shadcn/ui、Base UI 直接组合、React Aria 直接组合均可实现目标，但把更多基础组件组合与样式维护留给本项目，暂不优先。

**多面板先复用 Mantine Splitter，react-resizable-panels 保留为备选。** Splitter 已提供我们需要的主要界面能力，不能仅因最初参考清单出现另一个库，就引入重复职责。

本文件是选型研究结论。未安装组件、未迁移应用、未修改现有原型业务。下文的兼容性核实是官方声明和包元数据核实，不能替代本地编译与浏览器集成验证。

## 当前项目与评估标准

本地读取 `apps/web/package.json`：React / React DOM 19.2.8、Vite 7.3.6、Phosphor Icons 2.1.10，尚未使用通用组件库。现有 `apps/web/src/style.css` 使用普通 CSS 和自有语义变量，未配置 Tailwind。已有视觉以深灰、暖杏色强调、较紧凑间距为主。

优先顺序为：

1. 生成配置、候选选择、确认弹窗、审阅反馈、资产筛选等真实工作流有现成控件支持。
2. 键盘、焦点、弹层和字段错误等基础交互有可复用实现。
3. 可通过公开主题与样式 API 实现既定视觉，少复制、少改第三方源代码。
4. 适配现有 React / Vite / TypeScript；没有必要时不增加新的样式体系。
5. 核心功能免费可商用，实际依赖版本和许可证可追踪。

统一通用组件库不意味着所有业务组件都由它提供。镜头卡、候选比较、固定版本审阅、时间标注和场次剪辑依然属于产品业务组件。

## 当前版本与许可证事实

以下为 2026-09-09 对官方 npm registry 的实时读取；不是已经安装的依赖，也不是建议自动跟随 `latest`。版本固定后仍需用 lockfile 锁定传递依赖。

| 候选 | 当前发布版本 | React peer 范围 | 已核实许可证 | 对当前项目的含义 |
|---|---|---|---|---|
| `@mantine/core` | 9.6.0 | `^19.2.0`，React DOM 相同；要求同版 hooks | MIT | 当前 19.2.8 满足；core/hooks/form 保持同版 |
| `@mantine/form` | 9.6.0 | `^19.2.0` | MIT 元数据 | 可与 core 一起管理表单状态与错误 |
| `@cloudflare/kumo` | 2.13.2 | `^18.0.0 \|\| ^19.0.0`，React DOM 相同 | MIT | 当前 React 满足；现有 Phosphor 版本也满足 |
| `@base-ui/react` | 1.8.0 | `^17 \|\| ^18 \|\| ^19` | MIT | 当前 React 满足；是无样式原语 |
| `shadcn` CLI | 4.21.0 | CLI 不代表组件运行时版本 | MIT | Node 要求 `>=20.18.1`；组件源码和所选原语依赖需分别记录 |
| `@heroui/react` | 3.2.4 | `>=19.0.0`，React DOM 相同 | 发布包 LICENSE 为 Apache-2.0；见下述差异 | 当前 React 满足，但需 Tailwind 4 和 React Aria 相关 peers |
| `react-aria-components` | 1.21.1 | 包声明包含 `^19.0.0-rc.1` 等范围 | Apache-2.0 | 该 semver 范围容纳稳定 React 19；仍须实装验证 |

元数据来源：[Mantine core](https://registry.npmjs.org/@mantine%2fcore/9.6.0)、[Mantine form](https://registry.npmjs.org/@mantine%2fform/9.6.0)、[Kumo](https://registry.npmjs.org/@cloudflare%2fkumo/2.13.2)、[Base UI](https://registry.npmjs.org/@base-ui%2freact/1.8.0)、[shadcn CLI](https://registry.npmjs.org/shadcn/4.21.0)、[HeroUI](https://registry.npmjs.org/@heroui%2freact/3.2.4)、[React Aria Components](https://registry.npmjs.org/react-aria-components/1.21.1)。另在内存中读取了上述包的发布 tarball LICENSE；不执行包内代码。

Kumo 的 `echarts`、`zod` 在 `peerDependenciesMeta` 中为可选项，不能把它们描述成所有页面都必须额外安装的运行依赖。包解压大小也不能作为实际页面 bundle 大小的替代。

HeroUI 存在需准确记录的发布信息差异：3.2.4 npm 元数据标 MIT，实际发布包 `package/LICENSE` 为 Apache-2.0，当前官网也写 Apache-2.0，而仓库 main 的 LICENSE 显示 MIT。两种许可都允许商业使用，但正式许可证清单应依据实际使用的发布内容核实，不能只抄 npm `license` 字段。[HeroUI 当前官网](https://heroui.com/en/docs/react/getting-started)、[仓库 LICENSE](https://github.com/heroui-inc/heroui/blob/main/LICENSE)、[3.2.4 发布包](https://registry.npmjs.org/@heroui/react/-/react-3.2.4.tgz)

## 各候选的事实、适配与维护责任

### Mantine：主选

已核实事实：

- 9.0 起要求 React 19.2+；当前官方文档为 9.6.0，提供 Vite 安装和 TypeScript 指引。推荐的 Vite 路径为预编译组件样式、`MantineProvider`、CSS/PostCSS 配置，不要求采用 Tailwind。[版本要求](https://mantine.dev/changelog/9-0-0/)、[Vite](https://mantine.dev/guides/vite/)、[TypeScript](https://mantine.dev/guides/typescript/)
- `useForm` 覆盖嵌套字段、列表、值更新、错误、异步校验、提交以及 dirty/touched 状态。它提供现成表单状态机制，但业务校验、模型能力约束和服务端字段错误仍由应用负责。[useForm](https://mantine.dev/form/use-form/)
- 现成 `NumberInput`、`Slider`、`FileInput` 和 `Combobox` 能承载数量/参数、音量/区间控制、文件选择和可搜索选择等常见交互；实际上传、素材版本和生成能力不会随控件自动具备。[NumberInput](https://mantine.dev/core/number-input/)、[Slider](https://mantine.dev/core/slider/)、[FileInput](https://mantine.dev/core/file-input/)、[Combobox](https://mantine.dev/core/combobox/)
- Provider 统一主题与色彩模式；Styles API 暴露内部元素的 `classNames` 和 CSS 变量，可集中调整控件高度、颜色、间距与圆角。官方建议复杂样式优先使用 `classNames`，而不是到处堆内联 `styles`。[主题](https://mantine.dev/theming/mantine-provider/)、[Styles API](https://mantine.dev/styles/styles-api/)

本项目判断：上述能力直接对应生成参数、素材选择、审阅意见和团队管理，且能沿用 CSS 的工作方式，减少我们自建表单组件与状态机制的范围。集中 theme/defaultProps 加 CSS Modules 可以维持既定高密度视觉，不需要接受默认外观。

维护边界：基础组件通过升级发布包获得修复；应用维护业务组件、集中主题和少量可解释的样式覆盖。Mantine 的基础 Table 不是完整资产管理系统，复杂行选择、排序、过滤等仍需业务状态，必要时引入 TanStack Table。不能把第三方 Mantine 表格扩展误当成 core 官方内置。[Table](https://mantine.dev/core/table/)

### Kumo：有效备选

已核实事实：基于 Base UI；既提供有样式组件，也重新导出原语。支持 Tailwind 路径和 **不依赖 Tailwind 配置的 standalone CSS**，所以“选 Kumo 就必须迁移 Tailwind”不成立。[安装](https://kumo-ui.com/installation/)

当前组件覆盖 Input、InputArea、Combobox、Select、Dialog、Dropdown、Tabs、Table、Toast 等，并提供机器可读 registry。Input 自带标签、描述、错误展示；复杂 Table 排序、过滤和列宽调整的官方方案是组合 TanStack Table。[组件目录](https://kumo-ui.com/registry/)、[Input](https://kumo-ui.com/components/input/)、[Table](https://kumo-ui.com/components/table/)

本项目判断：Kumo 足以覆盖许多工作台基础控件，默认风格也适合紧凑管理界面；不能因为它相对新而断言不可靠。但就这次目标，Mantine 已有的表单状态、参数控件和 Splitter 形成更直接的组合。Kumo 如被采用，应按完整实际组件清单补齐缺口，而不是强行把每个参数输入都拼成低层原语。没有实测证据时，不宣称两者性能高下。

### shadcn/ui：定制自由度高，基础源码归项目维护

已核实事实：官方将其定义为组件代码分发机制，会将组件源码放入项目；不等价于只升级一个 npm UI 包。现行官方支持 Base UI、Radix 等原语路径；Vite 现有项目指引采用 Tailwind。CLI 版本不代表已经复制的所有组件处在统一版本。[官方定位](https://ui.shadcn.com/docs)、[Base UI 支持](https://ui.shadcn.com/docs/changelog/2026-01-base-ui)、[Vite](https://ui.shadcn.com/docs/installation/vite)

本项目判断：需要独特交互、愿意长期拥有设计系统源码的团队可优先采用；本项目当前更看重减少基础维护，因此排名在 Mantine/Kumo 之后。使用 AI 辅助写代码不会自动消除上游修复对比、源码合并和回归责任。若改用这条路线，应选择一套原语基础，记录 registry 来源/提交和本地修改，不同时混入多套同职责的弹层体系。

### Base UI 直接组合：适合建设自己的设计系统

已核实事实：无样式、可组合，支持 React 17+ 和 Vite；可使用普通 CSS、CSS Modules、Tailwind 等任意样式方案。其原语处理弹层、交互与可访问性，但结构组装和外观仍由调用方编写。[定位与兼容性](https://base-ui.com/react/overview/about)、[组合示例](https://base-ui.com/react/overview/quick-start)

本项目判断：自由度充分，但当前没有需求证明我们需要从原语层建设整套基础组件。选它会增加基础工作，偏离优先把场次制作业务做完整的目标。未来某个专有交互确实无法通过主库公开 API 实现时，可对那个有明确边界的组件单独评估，不能因此预先装第二套通用库。

### HeroUI / React Aria：能力有效，当前没有足够理由改变主选

HeroUI v3 基于 Tailwind 4 和 React Aria Components，官方声明面向 React 19，提供现成样式与可组合结构；包安装和主题方式相对于当前普通 CSS 项目增加了一条样式集成路径。[HeroUI](https://heroui.com/en/docs/react/getting-started)

React Aria Components 提供无样式控件及样式状态钩子，可通过 CSS 或 Tailwind 构造视觉。[React Aria 样式](https://react-aria.adobe.com/styling)

本项目判断：如已有熟练 React Aria/Tailwind 的团队与设计系统，它们是合理选择；当前没有这些既有投入，也没有本项目专项验证证明能显著减少所需工作，因此不引入。这里不是对可访问性质量的否定，也不把官网“可访问”宣称当成完整产品已通过可访问性验收。

## 复用 Mantine Splitter 的具体边界

官方控件已提供横向/纵向、多面板、嵌套、固定 px/rem 与百分比尺寸、min/max、可折叠面板、受控 sizes/onSizeChange 和程序化折叠。底层 `useSplitter` 还处理指针拖动、键盘和 WAI-ARIA Window Splitter 模式。[Splitter](https://mantine.dev/core/splitter/)、[useSplitter](https://mantine.dev/hooks/use-splitter/)

这些能力足以作为现有“镜头区—预览区—参数区”工作区的首选。应用仍负责：

- 保存和恢复布局偏好，按页面/视图保存，不写入镜头或场次领域对象。
- 在容器过窄时切换单栏、抽屉或折叠布局；有 min/max 不代表窄屏信息结构已经设计完毕。
- 处理不同面板组合、嵌套预览、拖拽素材和播放器之间的指针/快捷键冲突。
- 遵循 Pane 必须为 Splitter 直接子元素的约束；封装面板内容，不套一层破坏识别的 Pane 包装组件。

这里只核实了官方文档和源代码机制，没有完成浏览器交互验证。如果本项目集成验证显示布局恢复、动态面板或关键交互无法通过公开 API 可靠实现，再改用 react-resizable-panels；两者不同时承担同一工作区的分割布局。

## 实施建议与验证边界

1. 版本起点采用本次明确核实的稳定版本，`@mantine/*` 对齐 9.6.0。先做独立集成样例，再进入工程页面；不使用 `--force` 掩盖 peer 冲突。
2. 建立唯一 theme 文件，将现有深色背景、暖杏强调、中文字体与密度映射至组件 token。场次布局和专业业务组件保留自主设计。
3. 对现有全局 `button/input/select/svg` 等选择器逐项收窄，尤其当前全局 `svg` 宽高规则可能影响第三方图标和控件。不能靠到处添加 `!important` 掩盖冲突。
4. 普通按钮和输入框直接使用主库。只在需要稳定业务约束时封装 `AssetPicker`、`GenerationForm`、`ReviewDecisionDialog` 等组件；不为每个 Button 创建无意义的透传包装。
5. 复杂表单优先使用 `@mantine/form`。若确有现有表单生态要求才引入另一套 form 状态库；不同时管理同一表单状态。
6. 验证一个生成弹窗、一个可搜索素材选择、一个含错误反馈的表单，以及三面板场次布局。检查 React/TS 编译、样式作用域、Tab/Esc/焦点返回、中文输入、面板调整与恢复、窄屏，以及生产构建产物。
7. 实际 UI 中的“采用候选”“更新剪辑”“固定审阅版本”等动作仍由业务层区分。组件选型不能改变已经确认的领域状态与 MVP 边界。

静态文档核实完成，性能与交互优劣仍以本地集成结果为准。没有运行真实试验时，不给出毫秒级性能承诺、bundle 排名或已经完成可访问性验证的结论。

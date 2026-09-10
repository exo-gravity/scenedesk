# 专业前端组件最终裁决与隔离集成验证

日期：2026-09-09。范围：场次分镜／自由画布 MVP 的画布引擎、播放器、拖拽、查询缓存和虚拟列表。依据用户“完成剩下内容”的授权完成技术裁决；不变更已确认的 Mantine 通用 UI、不修改主应用依赖、不调用真实模型。

## 1. 结论：可以锁定实施基线

**采用 React Flow、Media Chrome、dnd-kit 和 TanStack Query；大列表需要虚拟化时统一采用 TanStack Virtual。** 已完成精确发布包及许可证核对、React 19.2.8／Mantine 9.6.0 隔离安装、TypeScript 编译、生产构建和真实浏览器交互验证。选型可以结束，进入产品集成；生产容量、私有媒体授权和业务保存仍按工程验收完成。

| 职责 | 锁定版本 | 决定 | 使用边界 |
|---|---|---|---|
| 画布引擎 | `@xyflow/react@12.11.6` | 首版主选 | 节点、连线、选择、平移缩放、节点工具条的交互基础；不承担生成执行、业务权限、采用、剪辑或审阅事实 |
| 播放器 | `media-chrome@4.19.2` | 首版主选 | 官方 React 包装＋原生 video/audio，承载平台媒体、时间控制、字幕及业务叠层 |
| 拖拽排序 | `@dnd-kit/react@0.5.0`、`@dnd-kit/helpers@0.5.0` | 首版主选 | 当前 React API，分镜和剪辑序列的排序、明确目标的素材投放；画布内部节点移动由 React Flow 处理 |
| 服务端状态 | `@tanstack/react-query@5.102.8` | 随业务 API 接入 | 查询、缓存、失效刷新；本地脏草稿和画布高频坐标状态独立管理 |
| 大列表 | `@tanstack/react-virtual@3.14.11` | 库已选定，按需安装到对应页面 | 服务端分页／检索基础上的素材与候选可见区渲染，不替代画布视口管理或视频解码策略 |

不同时安装 Media Chrome 与 Vidstack，不混装 dnd-kit 新旧两代 API，不引入第二套通用 UI，也不要求采购 React Flow Pro 示例或商业模板。React Flow 基础引擎为 MIT；当前样例保留官方署名，功能不依赖 Pro。[React Flow 官方说明](https://reactflow.dev/remove-attribution)、[dnd-kit 当前 API](https://dndkit.com/react/quickstart/)

## 2. 版本、兼容性与许可证证据

对 npm 官方 registry 元数据及精确 tarball 的 LICENSE 做了逐包记录，包含 tarball integrity 和实际下载 SHA-256，见[发布包证据](../../output/prototypes/2026-09-09-canvas-stack-closure/package-license-evidence.json)。以下 React 范围来自发布包；实际组合安装及交互另见第 4 节。

| 包 | React peer 范围 | 发布包许可 |
|---|---|---|
| `@xyflow/react@12.11.6` | React／React DOM／types `>=17` | MIT |
| `media-chrome@4.19.2` | 根包未声明 React peer；官方提供 React 包装，本轮实装验证 | MIT |
| `@dnd-kit/react@0.5.0` | React／React DOM `^18.0.0 \|\| ^19.0.0` | MIT |
| `@dnd-kit/helpers@0.5.0` | 无 React peer | MIT |
| `@tanstack/react-query@5.102.8` | React `^18 \|\| ^19` | MIT |
| `@tanstack/react-virtual@3.14.11` | React／React DOM 包含 `^19.0.0` | MIT |
| 备选 `@vidstack/react@1.15.6` | React／types `^18.0.0 \|\| ^19.0.0` | MIT |

官方精确发布来源：[React Flow](https://registry.npmjs.org/@xyflow%2freact/12.11.6)、[Media Chrome](https://registry.npmjs.org/media-chrome/4.19.2)、[dnd-kit React](https://registry.npmjs.org/@dnd-kit%2freact/0.5.0)、[helpers](https://registry.npmjs.org/@dnd-kit%2fhelpers/0.5.0)、[Query](https://registry.npmjs.org/@tanstack%2freact-query/5.102.8)、[Virtual](https://registry.npmjs.org/@tanstack%2freact-virtual/3.14.11)、[Vidstack](https://registry.npmjs.org/@vidstack%2freact/1.15.6)。

本轮 registry 已出现 Mantine 9.6.1。本轮继续使用主应用已安装并验证的 **core／hooks／form 9.6.0**，避免借专业组件收口做无关升级。React 19.2.8、Vite 7.3.6、TypeScript 5.9.3 均沿用现有基线。安装没有使用 `--force` 或 `--legacy-peer-deps`，`npm ls --all` 成功，未发现 peer 冲突。

除了上述直接包，还保存了[锁文件依赖许可清单](../../output/prototypes/2026-09-09-canvas-stack-closure/lockfile-license-inventory.json)，记录 177 个条目，包括未安装的可选平台包及开发工具。传递依赖并非全是 MIT：例如开发工具使用 Apache-2.0，`caniuse-lite` 的数据许可为 CC-BY-4.0。该清单记录元数据及已安装包的根许可文件摘要，不冒充完整法律审计；正式发布时生成对应生产依赖的 Third-party Notices 并保留必要版权和许可文本。

`npm audit` 本次结果为 0 个已报告漏洞，见[audit 原始记录](../../output/prototypes/2026-09-09-canvas-stack-closure/audit-evidence.json)。这是本轮查询快照，不是长期无漏洞保证。以上组件许可允许商业使用，不产生组件席位费；模型、存储、带宽和渲染成本另计。

## 3. 选择理由与替换触发条件

### React Flow：采用交互引擎，业务节点由我们组合

本产品需要独立媒体／文本节点、显式来源连接、画布视口和选择，不需要自建坐标、指针命中及连线路由基础。React Flow 提供自定义 React 节点，能够直接放入 Mantine 输入与 Media Chrome。官方 `nodrag`、`nopan`、`nowheel` 可区分节点移动、内部输入和滚动，本轮实际验证这些公开边界可行。[交互隔离类](https://reactflow.dev/learn/customization/utility-classes)

实施时应采用受控节点／边、固定的 `nodeTypes`、memo 化节点与稳定回调；缩略图默认展示，仅激活的媒体挂载播放器。保存自有版本化 DTO，而不是把第三方内部 store 或整份运行时对象直接当作服务端协议。连线本身不自动开始生成，不等于已批准素材引用，也不强制对应镜头顺序。视口偏好、坐标与业务事实分别保存。[官方性能建议](https://reactflow.dev/learn/advanced-use/performance)

**重新选引擎的触发条件**：按最终容量方案及真实媒体压力优化后仍达不到目标，或关键输入／媒体事件无法通过公开 API 修复，且有可复现证据。当前没有这种阻碍，不并行建设第二个画布引擎。自由绘画、矢量编辑和任意执行图不因为选了 React Flow 自动进入 MVP。

### Media Chrome：当前媒体来源明确，控制层适合独立

平台主要播放自身上传、生成或固定渲染的媒体。Media Chrome 官方 React 控件直接包裹原生媒体元素，适合把播放控制与固定媒体身份、时间码评论、只读审阅状态组合，不要求购买 Mux 服务。[官方 React 指南](https://www.media-chrome.org/docs/en/react/get-started)

Vidstack 1.15.6 是有效备选，其状态与 provider 能力有价值。当前 npm `latest` 仍是 React 18 范围的 0.6.15；1.15.6 的 React 19 兼容与另一代 API 已单独核实。标签差异不构成贬低成熟度的依据。[Vidstack 安装说明](https://vidstack.io/docs/player/getting-started/installation/react/)

**改选 Vidstack 的触发条件**：真实需求要求它能减少的多 provider、字幕／缩略图或媒体状态组装工作，或 Media Chrome 在目标浏览器中有无法通过公开 API 解决的问题。届时用相同私有媒体、字幕、签名 URL 续期和时间定位用例对测后替换播放器适配层；不同时叠两套播放器框架。本轮没有安装并跑 Vidstack，因此没有声称实测胜过 Vidstack。

播放器不负责多素材音画合成，不提供专业帧级剪辑保证；正式连续预览继续依据固定 CutRevision 及媒体 Worker 的结果。需要立即合成时另立媒体引擎验证，不通过换播放器偷偷扩大职责。

### dnd-kit、Query 与 Virtual：责任明确，按切片接入

- **dnd-kit**：只让明确把手启动排序；拖动素材时由业务判断“参考／候选／加入剪辑”。画布节点移动、播放器 seek 和 Splitter 使用自己的指针机制。新 API 的 `DragDropProvider`／`useSortable` 已在严格模式实测，0.x 更新逐次验证。保留按钮／菜单排序入口。若后续原生文件跨窗拖放成为瓶颈，再对具体边界评估 Pragmatic DnD；当前不增加它。[当前快速开始](https://dndkit.com/react/quickstart/)
- **Query**：GET 为权威；资源事件仅失效后重读。query key 含实际租户／项目／对象上下文，登出清理缓存；关键写入 `retry:false`，恢复按业务幂等键，不靠自动重试重新买生成。dirty 表单、未保存画布由本地状态保存；缓存刷新不得覆盖。业务 API 接入时统一使用 Query，不另建重复缓存库。[官方仓库](https://github.com/TanStack/query)
- **Virtual**：统一选 TanStack Virtual，简短分镜条可以先普通列表。素材列表先服务端分页／筛选、缩略图懒加载；有实际 DOM 压力的页面再引入 Virtual。变高行、拖拽穿出可见区、键盘焦点与搜索定位是集成验收，不由本轮固定高度文字行试验代替。[官方定位](https://tanstack.com/virtual/latest/docs/introduction)

## 4. 实测结果与复核方式

隔离样例：[目录入口](../../output/prototypes/2026-09-09-canvas-stack-closure/package.json)。只新增该目录，不改主应用 package.json／lockfile；使用现有组件样例的 4 秒本地技术视频和 VTT，没有下载第三方媒体或调用模型。样例外观用于验证交互边界，不是新的产品效果图。

| 已执行项目 | 结果与证据 |
|---|---|
| 精确安装、严格 TS 与构建 | `npm install --ignore-scripts`、`tsc --noEmit`（`skipLibCheck:false`）、Vite build 成功 |
| React StrictMode | 所选组件共同运行；无 pageerror，控制台仅 React 开发工具提示 |
| React Flow 自定义节点 | 3 个文本／媒体节点；从 1 条连接经真实指针新增至 2 条连接；标题拖动改变坐标 |
| Mantine 节点事件 | 输入中文、Delete 不删除节点也不移动节点；portal Select 可选值 |
| 双模式与恢复 | 切到分镜再返回保留输入、模型、位置和连线；本地保存后刷新恢复一致；离开画布时 video 已卸载 |
| Media Chrome | 原生视频播放、暂停、键盘 seek、指针 seek；1 条字幕轨／2 条 cue；seek 不移动节点 |
| dnd-kit | 指针排序 `SH01,SH02,SH03` → `SH02,SH03,SH01`；键盘排序继续变为 `SH03,SH02,SH01` |
| Query | 模拟 revision 更新刷新；dirty 草稿不变；失败写入仅执行 1 次，没有自动重试 |
| Virtual | 10,000 条固定高度文字行；初始与尾部均只挂载 11 行，末条可到达 |
| 视口 | 滚轮平移与按钮缩放通过 |

原始证据：[构建记录](../../output/prototypes/2026-09-09-canvas-stack-closure/build-evidence.txt)、[主要交互](../../output/prototypes/2026-09-09-canvas-stack-closure/interaction-evidence.txt)、[额外事件边界](../../output/prototypes/2026-09-09-canvas-stack-closure/boundary-evidence.txt)、[截图](../../output/prototypes/2026-09-09-canvas-stack-closure/verified.png)。截图已人工查看。

样例一次加载全部库，JS 约 906.59 kB／gzip 270.50 kB，Vite 提示超过 500 kB chunk。它不是任何单库包体、主产品首次加载指标或速度比较。正式页面按路由与画布模式拆包，播放器只在激活时创建；不得以调大警告阈值代替拆包。

复核命令，在隔离目录执行：

```sh
npm ci --ignore-scripts
npm run check
npm run dev
/Users/gandy/.codex/skills/playwright/scripts/playwright_cli.sh -s=canvas-stack-closure open http://127.0.0.1:4313
/Users/gandy/.codex/skills/playwright/scripts/playwright_cli.sh -s=canvas-stack-closure snapshot
/Users/gandy/.codex/skills/playwright/scripts/playwright_cli.sh -s=canvas-stack-closure run-code --filename=verify-interactions.js
/Users/gandy/.codex/skills/playwright/scripts/playwright_cli.sh -s=canvas-stack-closure run-code --filename=verify-boundaries.js
```

复核后关闭自己开启的 4313 服务与测试浏览器，不影响主应用的 4311 服务。

## 5. 尚待产品集成验收，不阻止当前选型

本轮验证的是**组件可共同运行及关键事件边界**，并没有完成：

1. Safari／Firefox／移动端、真实输入法 composition、完整无障碍与触屏验证。
2. 多场次数据隔离、服务端持久化、乐观并发冲突、撤销跨保存边界、权限和幂等写入。
3. 私有对象 Range／CORS、签名 URL 过期续期、网络失败、媒体代理切换以及旧审阅定位。
4. 多媒体节点、真实高分辨率素材的解码／内存压力和最终约定容量。10,000 条虚拟文字列表不是 10,000 个画布节点或视频的验证。
5. 虚拟化与拖拽组合、变高素材卡、多层分组及大画布的真实数据性能。
6. CutRevision 连续声画、字幕烧录、帧映射和后台渲染一致性。

本地存储只用于隔离验证。正式实现继续使用平台的版本化保存与冲突规则，不把样例的 localStorage 或第三方节点 JSON 直接复制成生产存储设计。

最终状态：**技术选型已完成，可按以上固定版本进入工程；产品功能和生产验收仍需实施。**

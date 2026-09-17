# 前端实施规则

React + Vite + Mantine。业务页面在 `src/business/`;`src/pages/` 是设计原型,不是生产实现。

本文件不重复 `docs/design/` 里已确认的设计决策,只保留代码级规则和少量不可协商的底线。改界面之前先按「改动前先读」找到对应的设计文档。

## 命令

**所有命令都在仓库根目录执行。** `apps/web` 下只有 `dev` / `build` / `preview` 三个脚本,在子目录里跑根脚本会直接报缺失;而且那里同名的 `npm run build` 只是 `vite build`,**不含类型检查**。

```sh
npm run dev:business   # 完整本地工作台(需先 setup:business)
npm run dev:web        # 只起 Web;业务接口不可用,只适合看设计原型
npm run ui:check       # UI 规则检查,规则见「约定」
npm run build          # 类型检查 + 生产构建
npm run test:e2e       # 自己会先跑生产构建;另需回环的一次性 drama_e2e* 库与 Chromium
```

## 代码地图

| 位置 | 职责 |
|---|---|
| `src/business/` | 业务页面、控制器、本机草稿恢复 |
| `src/components/workspace/` | 共享工作区组件(`WorkspaceShell`、`MediaPlayer` …) |
| `src/theme/tokens.ts` | 原始值,并导出 `--ws-*` 语义变量 |
| `src/theme/theme.ts` | Mantine 主题与 CSS 变量解析 |
| `src/pages/` | 设计原型,不是生产实现 |
| `src/style.css` | legacy 层叠层,只用于迁移 |

## 改动前先读

| 要改 | 先读 |
|---|---|
| 导航、壳层、账户菜单 | `docs/design/canvas-navigation-approved-2026-09-16.md`、`docs/design/creative-workspace-approved-2026-09-16.md` |
| 画布、场次工作区、模式切换 | `docs/design/creative-workspace-approved-2026-09-16.md`、`docs/design/primary-canvas-approved-2026-09-14.md` |
| 助手侧栏、模型选择器 | `docs/implementation/68-assistant-conversation-sidebar.md` |
| 镜头列表 | `docs/implementation/76-shot-list-workspace.md`、`80-shot-list-stable-viewer.md` |
| 资产库 | `docs/design/unified-asset-library-2026-09-15.md`、`docs/implementation/69-unified-asset-library.md` |
| 组件与视觉规范 | `docs/design/mantine-ui-agent-spec-v0.1.md`、`docs/design/shared-visual-language-v0.1.md` |

用户决定和场次 MVP 契约优先于任何设计文档。

## 约定

- **只用 Mantine** 作为通用 UI 库,不用 Tailwind 或第二套组件系统;图标用 Phosphor;允许 CSS Modules 与原生语义布局。
- **原始值存 `src/theme/`**,组件里引用语义变量或 Mantine token:

```css
/* 对:语义变量 + Mantine token */
.panel {
  gap: var(--mantine-spacing-md);
  border: 1px solid var(--ws-border);
  color: var(--ws-text);
}
```

```css
/* 错:写死原始值 —— ui:check 会判失败 */
.panel {
  gap: 12px;
  border: 1px solid #e5e7eb;
  font-size: 14px;
  color: #1f2937;
}
```

- **`npm run ui:check` 的硬规则**(不通过就失败,范围是 `src/business/`、`src/components/workspace/` 与 8 个指定页面文件):
  - 出现原始颜色字面量(`#hex`、`rgb()`、`hsl()`)或原始 `font-size:` / `border-radius:` 数值
  - 使用原生 `<button>` / `<input>` / `<select>` / `<textarea>` 而不走 Mantine
  - 引入未批准的依赖或导入
  - 文本对比度低于 4.5:1,或字段边框／焦点低于 3:1
  - `index.html` 没有在抽取的第三方 CSS 之前声明 `@layer legacy, mantine;`
- **先复用** `src/theme/` 与 `src/components/workspace/`;共享变体加到它归属的定义和样例页,再在页面里组合。新页面直接用 Mantine;`components/ui.tsx` 适配器供较旧页面使用。
- **不要把旧的暖色调样例当作当前品牌要求。**
- 业务界面文案用中文;品牌显示英文 `SceneDesk`。
- `WorkspaceShell` 拥有的是布局偏好,**不是生产事实**。
- 设计样例页只在显式开关下可达:`VITE_ENABLE_DESIGN_PREVIEWS=true npm run dev:web`,否则任何路由都渲染业务应用。

## 已知坑

- 保留 `index.html` 里提前声明的 CSS layer,否则生产构建的样式抽取会让 legacy 样式盖住 Mantine。
- 样式改动后要看**生产构建**的实际绘制结果,不要只看开发服务器。
- 截图基线更新必须人工检查,不能盲目重新生成。
- `style.css` 在 `legacy` 层,新规则不要加进去。
- 不要改库源码来绕过样式问题。

## 边界

### ✅ 总是

- 跑 `npm run ui:check`、相应构建与行为检查,并在浏览器里看被改动的页面。
- 保留逐镜头身份、授权失败、明确采用和草稿保留。
- 让用户消息、建议和操作确认来自持久的请求／结果。
- 如实报告原型局限,不要把原型当成生产实现。

### ⚠️ 先问

- 改已确认的布局或导航。
- 更换画布引擎(现用 React Flow / `@xyflow/react`)或更换播放器库。
- 改共享组件的对外样式契约。

### 🚫 绝不

- 移除焦点环,或用媒体颜色表示选中状态(两者都被 `ui:check` 拦截)。
- 为外观修正而重命名真实供应商模型,或改动后端能力标识。
- 让生成结果自动采用或替换某个成片 —— 领域事实的区分以根 `AGENTS.md` 为准。
- 模拟对话,或静默执行模型工作。
- 从当前共享修订推导已引入的卡片。
- 让加载或切换镜头改变弹窗、列表或焦点的几何尺寸。

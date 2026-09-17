# SceneDesk

**AI 短剧制作团队的工作台。** 核心功能:

- **剧本导入与阅读** —— 本地 Word 或团队授权的飞书文档,预览后确认导入
- **画布创作** —— 文字、固定参考、图片／视频草稿、AI 生成、结果比较
- **项目资产库** —— 角色、场景、道具等设定与素材的固定版本
- **镜头整理** —— 排序、候选比较、明确选用
- **原片交付** —— 单个镜头原片或本场选用包
- **团队与权限** —— 租户、成员、项目授权

画布与 AI 是核心能力,**不得退化为轻量白板或纯文字助手**。

npm workspaces monorepo,Node 22 + TypeScript;Python 只用于契约生成与文档检查。业务 API 用 Fastify + PostgreSQL(RLS)+ 持久队列;前端用 React + Vite + Mantine。`apps/web/src/pages/` 下的原型只是布局参考,不是生产代码、不是真实模型验收,**也从不构成编造媒体或模型结果的许可**。

## 命令

**所有命令都在仓库根目录执行。** 子目录里 npm 不会回退到根脚本;`apps/web` 下的 `npm run build` 只是 `vite build`,**不含类型检查**,和根目录的同名脚本不是一回事。

首次在本地起工作台:

```sh
npm ci
cp .env.example .env
npm run db:up              # PostgreSQL(compose,127.0.0.1:55439)
npm run setup:business     # 迁移 + 受限角色 + 写 .env.business(只跑一次)
npm run dev:business       # 身份模拟器 4320 + 业务 API 4310 + Web 4311
```

打开 http://127.0.0.1:4311/#/app。固定测试身份 `fixture@example.test`,界面标注「本地测试身份」。拉取新代码后先 `npm run upgrade:business` 再 `npm run dev:business`。

契约与文档检查需要 Python 依赖,装一次即可(`.venv/` 未提交):

```sh
python3 -m venv .venv
.venv/bin/pip install -r docs/implementation/validation-requirements.txt
```

素材处理另需队列与私有存储,顺序为 `npm run setup:queue` → `npm run setup:media`(会起 Docker 存储)→ `npm run dev:media-worker`。

验证。**改了接口契约时,先改契约模块并运行生成器,再跑下面任何一项:**

```sh
.venv/bin/python docs/implementation/check_design.py   # 契约与文档门禁,见「约定」
npm run check       # 契约生成物、UI 规则、类型、生产构建、单元测试
npm run test:db     # 数据库集成:持久化、授权、RLS
npm run worker:check
npm run test:media:prepare && npm run test:media
npm run test:e2e    # 自己会先跑生产构建;另需回环的一次性 drama_e2e* 库与 Chromium
sh deploy/check.sh  # deploy/ 是独立 tsconfig 项目,npm run check 不覆盖
```

推送前门禁 `bash scenedesk-preflight.sh`:默认跑便宜层**并追加三镜像构建与 smoke**(纯 `docs/**`、`*.md` 改动自动跳过),`--skip-heavy` 只跑便宜层,`--e2e` 再追加浏览器套件。它**不包含** `deploy/recovery/recovery.test.ts`,那一项只在 CI 的 `verify-isolated-recovery` 里跑。

## 入口点

| 要改什么 | 从哪开始 |
|---|---|
| 业务 API 的某个域 | `apps/api/src/modules/<域>/routes.ts`,并在 `apps/api/src/app.ts` 注册 |
| 数据库结构 | `packages/database/migrations/`(只增不改);角色授权在 `packages/database/src/roles.ts` |
| 接口契约 | `docs/implementation/` 下的 `build_contract.py`、`canvas_contract.py`、`editing_contract.py`(由 `build_contract.py` 汇总生成) |
| 前端业务页面 | `apps/web/src/business/`(一个功能一组文件) |
| 共享 UI 组件 | `apps/web/src/components/workspace/` |
| 队列消费与生成执行 | `apps/worker/src/` |
| 部署、镜像与恢复 | `deploy/`(独立 tsconfig,跑 `sh deploy/check.sh`) |

**不要手改**:`packages/contracts/src/generated.ts`、`docs/implementation/openapi.json`、`docs/implementation/api-operations.md`(均由 OpenAPI 生成)、`apps/web/dist/`、`output/**`(证据归档)。

## 改动前先读

| 要改 | 先读 |
|---|---|
| 领域命名与状态区分 | `CONTEXT.md` |
| 数据模型、事务、固定引用 | `docs/implementation/03-domain-data-model.md`、`11-transaction-and-implementation-blueprint.md` |
| 接口 / OpenAPI | `docs/implementation/06-api-contract.md` |
| 生成、供应商、付费执行 | `docs/implementation/07-provider-adapter.md`、`04-state-execution-and-budget.md`、`58-async-generation-lifecycle.md` |
| 页面与交互 | `apps/web/AGENTS.md` |
| 现状与未完成项 | `docs/README.md` 指向的入口 |

## 约定

- **契约单向生成**,且顺序不能颠倒:
  1. 改对应契约模块(`build_contract.py` / `canvas_contract.py` / `editing_contract.py`)
  2. `.venv/bin/python docs/implementation/build_contract.py`
  3. `.venv/bin/python docs/implementation/check_design.py` —— 它会重跑生成器,若 `openapi.json` 或 `api-operations.md` 有变化就判失败,同时校验每个写操作带 `X-CSRF-Token`、每个 POST 带 `Idempotency-Key`、每个操作有 2xx、以及追踪项与验收项清单完整
  4. `npm run contracts:generate`
  改 schema 时同步维护 `docs/implementation/sample-payloads.json`(手工维护,不是生成物)。
- **迁移只增不改**;新增迁移后用 `npm run upgrade:business` 重新应用显式角色授权(`setup:business` 拒绝重跑)。
- **Node 侧相对导入必须带 `.js` 后缀** —— 根 tsconfig 用 NodeNext,覆盖 `apps/api/src`、`apps/worker/src`、`packages/**`、`scripts/**`、`tests/**`。`apps/web` 用 Bundler 解析,不带后缀。
- **测试放在对应层级**:单元 `tests/*.test.ts`、数据库 `tests/integration/`、媒体 `tests/media/`、浏览器 `tests/e2e/*.spec.ts`;`deploy/` 的用例在 `deploy/tests/`、`deploy/integration/`、`deploy/recovery/`,由 `sh deploy/check.sh` 或 CI 运行。`npm test` 只收集 `tests/*.test.ts`。
- **提交信息**和 **PR 标题**用 `type(scope): 摘要`,`type` 取 `feat`/`fix`/`docs`/`test`/`refactor`/`chore`,scope 用受影响区域(如 `workspace`)。
- **分支**用 `feat/`,一个 PR 一个可独立审查的切片;不把无关重构混进功能切片。
- PR 说明要写清**验证计划实际是怎么执行的**,而不只贴检查计数。
- 实现中发现需要改设计或扩大范围时,先回到工作项确认再继续。
- 业务 API 用 `.env.business` 里的受限账户;`.env` 的账号只用于迁移与测试。

## 已知坑

- Node 与 npm 版本锁定在 `.nvmrc` / `package.json`,用其他版本不保证可复现。
- `npm run test:media` 必须先跑 `npm run test:media:prepare`。
- `npm run test:e2e` 会拒绝非回环库和非 `drama_e2e*` 库名,并要求 `PROVIDER_MODE=mock`;不要指向开发库或个人数据库。
- `npm run dev:media-worker` 读取 `.env.media-worker` 与 `.env.queue`;缺文件时 node 直接以非零码退出,先按「命令」里的顺序初始化。
- 文档检查写入 `output/` 下的新目录,**不覆盖历史报告**。
- 文档检查的范围是 `docs/**` 的全部 Markdown **加上** `README.md`、`CONTEXT.md`、`apps/web/AGENTS.md`;根 `AGENTS.md` 不在其中。工作区若存在含绝对链接的**未跟踪**草稿会直接失败,此时用只含已跟踪文件加本次改动的临时树运行。
- 本机的 Docker、存储与高负载条件可能让媒体或部署用例超时。**当前已知的环境现象和未通过的检查只在 `docs/implementation/22-implementation-progress.md` 维护**,本文件不记录会随时间失效的机器状态。

## 边界

### ✅ 总是

- 让每个切片同时覆盖数据库约束、服务、页面和失败恢复;只做完一层不算完成。
- 在服务端强制当前的租户／项目权限,**包括重试和缓存幂等响应**;**共享读取不授予私有源项目的访问权**;运行时数据库角色保持受限,**类型化引用必须来自经过验证的固定定义**。
- **只能追加不可变的内容修订**;可变根使用文档化的修订前置条件。
- 业务效果与其队列提示在**同一个事务**里持久化。
- 供应商尝试必须在提交前持久化;**未知提交保持未决直到证据到达**。
- 模型执行要有安全边界与限额,重复提交要有保护。
- 改动不得削弱既有的执行与恢复不变量。
- 冲突、失败请求和刷新后都保住草稿输入;确认对话框绑定打开时的对象／版本;在结果与本地恢复状态一致之前**不得报告保存完成**。
- 保留 `CONTEXT.md` 的领域命名;区分**可用素材、候选选用、明确采用、成片使用、固定版本批准** —— 它们是不同的事实。
- 区分**原片、预览和制作副本**;帧与采样用精确的整数或有理数运算。
- Mock 产物和本地测试身份必须保持**显式标识**。
- 测试打在公共行为边界上,不写只复述实现细节的测试。
- 测试失败要修原因。**绝不放宽断言、超时或资源限制来让它通过**;也不用 mock 或跳过掩盖失败。
- 证据必须来自**一次完整的实际执行**;不把失败记录或多次运行的计数拼成通过。
- 导入素材可以支撑手工流程,但**不能替代真实 AI 验收**。
- 为受控夹具、真实飞书授权、真实供应商执行和外部部署**分别**保留证据。
- 用具体证据更新相关的实施说明;记录已验证的 PR／合并与实质剩余工作。

### ⚠️ 先问

- 改数据库 schema 或迁移。
- 改公开接口契约。
- 新增依赖。
- 改 CI、部署配置或仓库设置。
- 重新打开已确认的布局或导航(见 `docs/design/`)。

### 🚫 绝不

- 在没有真实服务、凭据和花费授权时发起付费供应商调用。
- 在未持久化尝试记录的情况下提交供应商请求,或让一次未知提交变成自动的付费重试。
- 让队列回执单独确立业务成功。
- 静默升级已固定的资产、造型、声音、计划或审阅引用。
- 修改已经应用的迁移。
- 提交 `.env*`、密钥、私有存储授权、运行时清单或真实客户数据。
- 把原型、静态检查通过、mock 结果或「接口已实现」当成业务验收。
- 把对话、提示或迭代过程写进代码注释、提交信息或 PR 描述 —— 写给没见过这段对话的读者。
- 假设失败是既存的。先证明它在本分支之前就存在,再决定放过。

## 提交与推送

- 合并前做一次**独立审查**:审查真实 diff 而不是只看测试结论,运行相关检查,推送并检查结果的 GitHub CI。
- 一个 PR 只推一次。用 `git rebase -i origin/main` 把证据提交折进它所证明的提交,**不要把 `main` 同步进分支**。
- 推送前跑 `bash scenedesk-preflight.sh`(范围见「命令」)。它覆盖不了 `deploy/recovery/recovery.test.ts`。
- `ci.yml` 是**不过滤**的通用门禁;`deployment.yml` 与 `workspace-e2e.yml` 按路径过滤,触发路径是各自的 workflow 文件、`apps/**`、`packages/**`、`deploy/**`(仅 deployment)、`tests/e2e/**`(仅 e2e)、`scripts/**`、`package.json`、`package-lock.json`、`tsconfig.json`、`tsconfig.base.json`、`.nvmrc`。
- 因此**纯 `docs/`、`output/`、`*.md` 改动要单独提交**,不要和代码改动混在同一次推送里。
- `.githooks/pre-push` 会拦住上述两类提交;用 `git config core.hooksPath .githooks` 启用,`SKIP_PREPUSH=1` 单次绕过。
- 用户的实施与合并授权已覆盖这些常规步骤,不需要额外审批关卡。**但推送需要用户明确要求** —— 未被要求时不要推送。
- 当 GitHub Actions 不可用时可以改用普通手动合并;此时必须记录精确的合并 head、本地证据和**没有运行的检查**,绝不把不可用的 CI 写成通过。这不授权更改仓库可见性、削弱保护,或无视相关的未解决故障。

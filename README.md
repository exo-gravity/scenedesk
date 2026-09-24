# 幕序 · SceneDesk

SceneDesk 是独立 Web 的短剧视觉创作工作台。当前主路径是 **导入剧本 → 创作台连续创作 → 比较与明确选用 → 整理镜头 → 交付原片**。项目创作台（`…/p/{id}/studio`）是唯一创作入口：画布式连续创作、剧本视图与镜头整理视图在同一页面内切换，顶栏在项目与场次创作台之间切换。没有剧本或场次也可以先在项目创作台开始。

| 工作区 | 当前能力 |
|---|---|
| 剧本视图 | 本地 `.docx` 或团队授权的飞书文档，预览后确认导入；阅读当前稿、按需查看历史；Word 原件可下载，选文可带入创作台 |
| 创作台 | 项目级与场次级自由创作、文字与固定参考、图片／视频草稿、结果比较；助手建议和手工编辑作用于同一份草稿 |
| 项目资产 | 管理素材及角色、场景等参考，向创作草稿带入明确版本 |
| 镜头整理 | 按需整理场次内镜头顺序、比较候选、明确选用，下载单个原片或本场选用 ZIP |
| 保存与恢复 | 未保存输入、冲突、刷新和未决任务保持可找回；导入新剧本不会改变旧创作引用 |

当前交互依据[核心创作区重建（2026-09-21 已确认，2026-09-22 合入）](docs/design/creative-workspace-rebuild-libtv-2026-09-21.md)，实现记录见[创作区重建分片记录](docs/implementation/85-studio-rebuild.md)。创作台是唯一工作区，镜头整理按需打开；旧画布、场次工作区、剧本页与分镜台地址一律转向创作台。固定输入、任务、结果和明确选用仍是独立事实，但日常导入不要求操作复杂版本流程。

MiniMax 与火山方舟的图像／视频适配器及独立生成执行器已实现，真实账号验证的范围见[供应商运行记录](docs/implementation/86-verified-provider-runtime.md)。测试适配器与演示媒体保持明确标识；供应商、真实飞书授权、团队文档和外部部署分别验收，当前交付与剩余工作统一见[实施进度](docs/implementation/22-implementation-progress.md)。

后期剪辑／渲染、完整团队管理、开放注册、公共 API 产品及商业运营继续后置，依据[当前首发范围](docs/implementation/38-first-release-scope-review.md)。已实现的后期代码与历史设计保留，不作为本次创作工作区的使用前提。

- [当前文档总入口](docs/README.md)及[实施设计包](docs/implementation/README.md)
- [Word 剧本导入](docs/implementation/72-script-docx-import.md)与[飞书团队应用配置](docs/implementation/75-feishu-script-import.md)
- [创作区重建分片记录（现行界面）](docs/implementation/85-studio-rebuild.md)；引擎来历：[连续创作](docs/implementation/74-canvas-continuous-creation.md)与[镜头列表与原片包](docs/implementation/76-shot-list-workspace.md)
- [端到端用例清单](tests/e2e/README.md)、[私有部署](deploy/README.md)及[隔离恢复验收](deploy/recovery/smoke/README.md)
- [UI 执行规范](docs/design/mantine-ui-agent-spec-v0.1.md)与[历史原型索引](docs/history/README.md)。原型中的虚构内容、内存交互和效果图不是生产实现或业务验收。

## 本地启动

使用 [.nvmrc](.nvmrc) 的 Node 22.23.2 和 npm 10.9.8。已有 Node 22.12+ 可执行，但正式复现以锁定版本为准。

```sh
npm ci
cp .env.example .env
npm run db:up
npm run setup:business
npm run dev:business
```

浏览器打开[业务入口](http://127.0.0.1:4311/#/app)，点击登录。这个命令组合显式启用仅监听本机的身份模拟器，固定使用 `fixture@example.test`，界面标注“本地测试身份”。无须模型或外部登录账号；它不验证真实人员身份。

`setup:business` 执行迁移、创建独立数据库角色，并把随机本地凭据写入权限为 0600、Git 忽略的 `.env.business`；只需首次运行，已有配置不会覆盖。更新代码后执行 `npm run upgrade:business` 应用新增迁移和受限角色授权，再执行 `npm run dev:business`。业务 API 位于 `127.0.0.1:4310`，身份模拟器位于 `127.0.0.1:4320`。`/health/ready` 只证明当前身份、项目与内容服务可运行，`completeMvp` 仍为 false。

需要实际导入和处理素材时，按[素材运行说明](docs/implementation/30-media-import-service.md)初始化队列与私有存储，并另行运行 `npm run dev:media-worker`。

仅查看视觉原型时执行 `VITE_ENABLE_DESIGN_PREVIEWS=true npm run dev:web` 并打开[核心流程原型](http://127.0.0.1:4311/#/journey/?variant=core-flow&screen=script)。原型使用内存演示数据，与持久化业务入口分开。原 S0 `npm run dev` 保留为工程骨架入口；未启用业务配置时，业务接口仍明确返回未实现状态。

`npm run dev:business` 的 Ctrl-C 停止三个本地服务；`npm run db:stop` 停止本项目数据库并保留卷。不要使用 `down -v` 清除希望保留的数据。

## 检查

```sh
npm run check
npm run test:db
npm run worker:check
npm run mock:scenarios
python3 -m venv .venv
.venv/bin/pip install -r docs/implementation/validation-requirements.txt
.venv/bin/python docs/implementation/build_contract.py
.venv/bin/python docs/implementation/check_design.py
```

静态校验默认将本次报告与文件清单写入 `output/documentation-checks/<UTC 时间戳>/`，命令输出实际路径；可用 `--output-dir output/documentation-checks/<新目录>` 指定位置，已有目录不会覆盖。`docs/implementation/` 中旧报告与交付清单保留为历史。`verify-local.mjs`／`verify-visual.mjs` 的运行报告同样按实际时间写入 `output/engineering/`，不再回写 09-09 的结果。

契约有变化时先运行 Python 生成器，再执行 `npm run contracts:generate`。`check` 验证生成类型、前后端类型、前端构建、契约运行时样例与有限基础测试；数据库测试使用单独临时 schema 并清理自己的夹具。CI 定义在 [.github/workflows/ci.yml](.github/workflows/ci.yml)，未推送前不代表远端 CI 已通过。

核心页面的 `npm run test:e2e` 使用生产构建、真实 API 与隔离合成数据库，环境要求见[浏览器回归说明](tests/e2e/README.md)。媒体处理、容器部署和成对备份恢复各自验收，不以单元测试或浏览器 fixture 代替。

协作实现遵循[项目工程约定](AGENTS.md)：以实际业务结果、失败恢复与权限验证判断完成；无模型模式、历史事实和真实验收边界必须保持明确。

## 工程目录

| 位置 | 当前职责 |
|---|---|
| `apps/web` | React/Vite 与 Mantine；剧本阅读导入、项目与场次画布、资产、镜头列表及 IndexedDB 草稿恢复 |
| `apps/api` | Fastify 业务 API、OIDC、项目授权、文档导入、画布保存、固定生成计划、结果与选用、原片交付 |
| `apps/worker` | 素材处理、受控测试生成及独立真实供应商执行器；受限角色、任务消费与恢复 |
| `packages/contracts` | 由 OpenAPI 生成的 TypeScript 与 Ajv 2020-12 校验器 |
| `packages/domain` | 画布文档、固定引用、生成输出配对及精确帧／采样等纯规则 |
| `packages/provider` | 生成与助手测试适配器，以及 MiniMax／火山方舟真实适配器、能力档案与输入输出处理 |
| `packages/queue` | [内部调度](docs/implementation/28-durable-queue.md)：事务入队、受限角色、注册 handler 及中断恢复验证 |
| `packages/media` | [媒体运行基础](docs/implementation/29-media-runtime.md)与[导入服务](docs/implementation/30-media-import-service.md)：固定对象、受限解码、原文件验收和独立预览恢复 |
| `packages/database` | 校验值不可变迁移、身份／项目表、RLS、约束与独立角色授权 |
| `docs/implementation` | 生产行为、数据、接口、验收及工程任务的权威设计 |
| `deploy` | 私有部署镜像、配置审查、隔离部署与恢复检查 |

`.env` 中的数据库示例账号只用于迁移与测试，业务 API 使用 `.env.business` 中受限的运行账户。正式部署仍需真实 OIDC、密钥管理、媒体存储、恢复与容量验收。本地业务启动器限制本机访问；真实生成须按[执行器运行说明](docs/implementation/86-verified-provider-runtime.md)单独配置、验证并取得花费授权。

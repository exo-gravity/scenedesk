# 幕序 · SceneDesk

2026-09-10 更新：用户已授权正式工程实施与 GitHub 合入，当前推进身份、权限、项目与内容结构。先以导入素材及模拟供应商推进，无真实模型也可实施制作、剪辑、审阅与交付。完成情况和实际验收以[实施进度](docs/implementation/22-implementation-progress.md)为准；下文原型和 S0 说明仍描述现有交付，不能视为完整 MVP 已完成。

产品名称已由用户确认：中文名 **幕序**，英文名 **SceneDesk**，中英文组合统一写作 **幕序 · SceneDesk**。产品类型为 AI 影像创作工作台；后续产品界面与现行文档采用这一名称。

短剧优先，长期支持广告。首期核心场景是一位制作人员主责完成一场戏；完整 MVP 包含每场分镜／自由画布双模式，以及整集审阅交付、跨集复用和内部后期接手。

当前已实现：**身份／权限／项目、手工内容结构、CSV 提案、项目默认创作确认与场次任务**，包括工作室、成员邀请、所有权交接、项目与负责人、剧目设定、剧本版本、集场镜、镜头要求与原文历史、归档恢复。有 PostgreSQL 持久化、RLS、CAS、幂等和对应业务页面。[基础运行说明](docs/implementation/23-identity-project-foundation.md)与[内容实现说明](docs/implementation/24-content-structure.md)列出边界。[CSV 提案](docs/implementation/25-csv-proposals.md)支持导入预览、修订、差异复核和一次采纳；[创作依据](docs/implementation/26-creative-bases.md)支持固定快照、正式确认及冲突恢复；[场次主责与任务](docs/implementation/27-scene-tasks.md)支持分派、个人筛选、资格失效提示和不可变处理历史。媒体、生成、编辑渲染和交付仍在后续实施中，完整 MVP 尚未完成。

已确认的视觉原型继续保留，使用虚构内容；核心体验和专项样例仅在页面内存保留，刷新或离开会重置，不能替代业务验收。

- [已确认核心体验](http://127.0.0.1:4311/#/journey/?variant=recommendation&screen=production&mode=storyboard&tone=light&assistant=off)：场次制作、剪辑、固定审阅与返工的设计参照。
- [制作专项设计](http://127.0.0.1:4311/#/journey/?variant=finishing&topic=script&tone=light)：剧本准备、声音字幕、资产版本、保存冲突四项独立演示；本轮评审暂无异议，暂时收口。
- [早期本地视觉预览](http://127.0.0.1:4311/#/scene/production)：故事板、剪辑、审阅、剧本、资产及项目等核心页面。
- [当前 UI 执行规范](docs/design/mantine-ui-agent-spec-v0.1.md)；旧主题、布局和页面演示见[历史索引](docs/history/README.md)。
- [早期场次双模式效果图](http://127.0.0.1:4311/#/layouts/)：自由画布可切换六镜头全场总览和 SH04 局部示意，图中控件不是已实现的画布业务。

- [当前文档总入口](docs/README.md)及[实施设计包](docs/implementation/README.md)
- [技术协议定案与待验证门槛](docs/implementation/21-technical-baseline-closure.md)
- [当前设计收口与后续实施入口](docs/implementation/19-design-closure-and-implementation-entry.md)
- [画布工程设计](docs/implementation/18-canvas-workspace-contract.md)
- [模型、部署与试点执行准备](docs/implementation/20-external-validation-and-launch-plan.md)
- [工程就绪情况与验证记录](docs/implementation/15-engineering-readiness.md)
- [下一批实施任务](docs/implementation/16-implementation-backlog.md)

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

仅查看视觉原型时执行 `npm run dev:web` 并打开上方场次设计链接。原 S0 `npm run dev` 保留为工程骨架入口；未启用业务配置时，业务接口仍明确返回未实现状态。

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

## 工程目录

| 位置 | 当前职责 |
|---|---|
| `apps/web` | React/Vite 工作室／项目／剧本与集场镜页面、IndexedDB 本地草稿；独立设计参照 |
| `apps/api` | Fastify 业务内核、OIDC、工作室／成员／项目／剧目、内容与历史接口 |
| `apps/worker` | 独立 Worker 的数据库预检入口，媒体 handler 随 E03 接入 |
| `packages/contracts` | 由 OpenAPI 生成的 TypeScript 与 Ajv 2020-12 校验器 |
| `packages/domain` | 精确帧／采样整数运算起点，不是完整媒体归一器 |
| `packages/provider` | 无网络、无费用的故障模拟；不作真实供应商 Adapter |
| `packages/queue` | [内部调度](docs/implementation/28-durable-queue.md)：事务入队、受限角色、注册 handler 及中断恢复验证 |
| `packages/database` | 校验值不可变迁移、身份／项目表、RLS、约束与独立角色授权 |
| `docs/implementation` | 生产行为、数据、接口、验收及工程任务的权威设计 |

`.env` 中的数据库示例账号只用于迁移与测试，业务 API 使用 `.env.business` 中受限的运行账户。正式部署仍需真实 OIDC、密钥管理、媒体存储、恢复与容量验收；当前启动器限制本机访问，真实模型模式不可启用。

# 幕序 · SceneDesk

产品名称已由用户确认：中文名 **幕序**，英文名 **SceneDesk**，中英文组合统一写作 **幕序 · SceneDesk**。产品类型为 AI 影像创作工作台；后续产品界面与现行文档采用这一名称。

短剧优先，长期支持广告。首期核心场景是一位制作人员主责完成一场戏；完整 MVP 包含每场分镜／自由画布双模式，以及整集审阅交付、跨集复用和内部后期接手。

当前交付：设计基线、**S0 本地工程骨架**与 **MVP 核心页面视觉预览**。业务 API、真实模型、服务端制作数据和媒体编辑渲染尚未实现。视觉原型使用虚构内容；新核心体验和专项样例仅在页面内存保留，刷新或离开其独立演示会重置；早期页面另有浏览器存储与设置重置。所有样例均不产生真实费用或审批。

- [已确认核心体验](http://127.0.0.1:4311/#/journey/?variant=recommendation&screen=production&mode=storyboard&tone=light&assistant=off)：场次制作、剪辑、固定审阅与返工；设计确认，真实业务工程仍暂停。
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
npm run db:migrate
npm run dev
```

浏览器打开 [场次演示页](http://127.0.0.1:4311)。仅查看视觉原型时执行 `npm run dev:web` 即可，无须数据库或模型账号。开发 API 在 `127.0.0.1:4310`，`/health/live` 检查进程，`/health/ready` 只检查 S0 数据库引导。没有配置数据库时，视觉页面仍可使用本地示例，ready 返回 503；`/v1/*` 返回明确的未实现状态。

`npm run dev` 的 Ctrl-C 停止 API 与页面；`npm run db:stop` 停止本项目数据库并保留卷。不要使用 `down -v` 清除希望保留的数据。

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
| `apps/web` | React/Vite 核心页面与视觉交互原型；未来以真实业务状态替换 |
| `apps/api` | Fastify 开发入口与健康检查；业务路由逐条落地 |
| `apps/worker` | 独立 Worker 的数据库预检入口，尚不消费任务 |
| `packages/contracts` | 由 OpenAPI 生成的 TypeScript 与 Ajv 2020-12 校验器 |
| `packages/domain` | 精确帧／采样整数运算起点，不是完整媒体归一器 |
| `packages/provider` | 无网络、无费用的故障模拟；不作真实供应商 Adapter |
| `packages/database` | 带锁、校验值和事务回滚的迁移运行器；仅 M00 引导迁移 |
| `docs/implementation` | 生产行为、数据、接口、验收及工程任务的权威设计 |

本地数据库示例账号仅用于 S0，无业务隔离承诺；生产接入须按 M01–M07 建立授权、RLS、独立运行角色与真实媒体验收。当前服务限制为本机访问，真实模型模式不可启用。

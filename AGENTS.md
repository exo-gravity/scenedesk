# 工程协作约定

本文件只维护稳定的技术基线与工程纪律。环境搭建见 [README.md](README.md)，设计与进度见 [docs/README.md](docs/README.md)，领域定义见 [CONTEXT.md](CONTEXT.md)。修改子目录前，读取该目录适用的 `AGENTS.md`。

## 技术基线

- npm workspaces monorepo，Node.js + TypeScript；版本以仓库配置为准。
- `apps/web`：React + Vite + Mantine，负责页面与交互。
- `apps/api`：Fastify，负责接口与服务端授权；PostgreSQL 持久化，RLS 实施租户隔离。
- `apps/worker`：消费持久队列，执行异步任务；`packages` 承载跨应用共享模块。
- Python 仅用于契约生成与文档检查。详细架构与设计决策从 [docs/README.md](docs/README.md) 查阅。

## 工作方式

- 先检查工作区和相关实现，明确本次目标、影响范围与验收方式；保留用户和其他任务的改动。
- 保持设计精简、职责清晰。优先复用现有能力；只为当前需求引入抽象、配置和依赖，不预建通用框架或未来扩展点。
- 一次完成一个可独立审查的改动，覆盖实际受影响的调用链与失败路径；不夹带无关重构，不为形式完整而改动无关层。
- 超出已授权范围的设计变更、数据库结构、公开契约、新依赖、CI／部署配置和仓库设置，先说明必要性与影响并确认。已有授权不重复询问。

## 实现约束

- 遵循 `.nvmrc` 和 `package.json` 的 Node／npm 版本；所有项目命令在仓库根目录执行。
- 沿用现有模块边界和代码风格。Node 侧相对导入带 `.js` 后缀；前端遵循自身 TypeScript 配置。
- 保持服务端授权、最小权限、事务、并发控制、幂等与失败恢复约束；不得为简化实现削弱这些保证。
- 数据库迁移只新增，不修改已有迁移；应用后运行 `npm run upgrade:business` 更新受限角色授权。
- 不提交密钥、含凭据的环境文件、私有授权或真实客户数据。破坏性操作和付费外部调用必须有明确授权。
- 不手改生成文件和构建产物，不覆盖或改写 `output/` 中的历史证据。

接口契约修改源模块，并同步维护 `sample-payloads.json`；不要直接编辑 `openapi.json`、`api-operations.md` 或 `packages/contracts/src/generated.ts`。按以下顺序生成，具体约定见 [接口契约](docs/implementation/06-api-contract.md)：

```sh
.venv/bin/python docs/implementation/build_contract.py
.venv/bin/python docs/implementation/check_design.py
npm run contracts:generate
```

## 验证

- 根据改动范围执行相关检查；测试公共行为和失败路径，不写只复述实现的测试。
- 修复失败原因，不通过放宽断言、超时、资源限制或跳过测试掩盖问题；认定为既存失败前，先在基线上复现。
- 如实区分通过、失败和未运行。证据来自完整实际执行，不拼接多次运行结果；原型、mock 和静态检查不能代替真实集成验收。

| 范围 | 检查命令 |
|---|---|
| 常规代码 | `npm run check` |
| 数据库 | `npm run test:db` |
| Worker／媒体 | `npm run worker:check`；`npm run test:media:prepare && npm run test:media` |
| 页面交互 | `npm run test:e2e` |
| 部署 | `sh deploy/check.sh`（独立项目，不在根检查内） |
| 契约与文档 | `.venv/bin/python docs/implementation/check_design.py` |

数据库测试使用隔离环境；E2E 仅用回环地址的一次性 `drama_e2e*` 库和 `PROVIDER_MODE=mock`。环境准备见 [README.md](README.md)，E2E 说明见 [tests/e2e/README.md](tests/e2e/README.md)。

## 提交与交付

- 分支用 `feat/`；提交信息和 PR 标题用 `type(scope): 摘要`，类型为 `feat`、`fix`、`docs`、`test`、`refactor` 或 `chore`。
- 提交前审查实际 diff；合并前独立审查并处理发现的问题，不能只看测试是否通过。
- 仅在用户明确要求时推送。推送前整理提交并运行 `bash scenedesk-preflight.sh`；推送后检查 GitHub CI，不绕过保护或将未运行写成通过。涉及恢复逻辑时，另行验证门禁未覆盖的 `deploy/recovery/recovery.test.ts`。
- 纯文档／证据改动与代码分开提交、分开推送；同步主线用 rebase，不把 `main` merge 进功能分支。
- 注释、提交和 PR 面向未读过对话的维护者，说明改动与必要理由，不记录对话过程。
- 交付说明写清改了什么、实际验证及剩余限制；更新相关文档。当前进度与环境问题统一记在 [实施进度](docs/implementation/22-implementation-progress.md)，不写进本文件。

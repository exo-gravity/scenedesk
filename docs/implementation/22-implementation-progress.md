# 实施进度与验收证据

2026-09-10：用户明确授权完整实施项目并将验收后的功能合入 GitHub，取代此前正式业务工程暂停的要求。依据仍为产品设计 v1.3、核心体验 v0.3、专项 v0.4 和技术协议 v1.3。

当前先使用导入素材及模拟供应商实现和验证业务，不执行真实模型付费调用。真实模型服务与质量验收单列，不以模拟通过代替。部署环境与真实试点条件尚待落实。

## 当前工作

| 工作包 | 状态 | 实际成果／剩余验收 |
|---|---|---|
| 仓库与 CI | 完成 | main 已关联 GitHub；修复不可移植的文档链接，提交 72e95bb 的完整 CI 通过 |
| E01 身份、权限与内容基础 | 已合入 | [身份／项目基础](23-identity-project-foundation.md)经 [PR #1](https://github.com/beyondgravitylab/scenedesk/pull/1) 合入（dd04b77）；[内容层](24-content-structure.md)经 [PR #2](https://github.com/beyondgravitylab/scenedesk/pull/2) 合入（d92c5cc），两组远端 CI 均通过 |
| E02 剧本、结构与提案 | 实施中 | 手工集场镜、不可变剧本／镜头历史、台词与原文引用、本地草稿恢复已实现；[CSV 提案](25-csv-proposals.md)、明确追加、固定基线复核及永久重复采纳保护已通过 [PR #3](https://github.com/beyondgravitylab/scenedesk/pull/3) 合入（feb5ea4），两组 CI 通过；[创作依据与项目默认确认](26-creative-bases.md)已通过 [PR #4](https://github.com/beyondgravitylab/scenedesk/pull/4) 合入（5ae739b），两组 CI 通过；[场次主责与任务分派](27-scene-tasks.md)已通过 [PR #5](https://github.com/beyondgravitylab/scenedesk/pull/5) 合入（427f528），两组 CI 通过；固定稿限定确认随编辑／审阅完成 |
| T01 队列集成 | 基础已合入 | [pg-boss 基础集成](28-durable-queue.md)通过 [PR #6](https://github.com/beyondgravitylab/scenedesk/pull/6) 合入（e3c81c9），两组 CI 通过；同事务回滚、受限角色、延时／重复、SIGKILL 和重试耗尽验证，全套 51 项数据库测试通过；付费执行门槛随 G02 完成 |
| E03–E04 媒体与候选 | 实施中 | [媒体运行基础](29-media-runtime.md)通过 [PR #7](https://github.com/beyondgravitylab/scenedesk/pull/7) 合入（a963678），两组 CI 通过；固定对象版本、受限解码和独立派生的 15 项真实环境测试通过；[素材导入服务](30-media-import-service.md)已接通 9 个操作、原子入队、受限 Worker 及修复扫描，25 项媒体测试通过，已通过 [PR #8](https://github.com/beyondgravitylab/scenedesk/pull/8) 合入（691a8d2），两组 CI 通过；[素材工作台](31-media-workspace.md)已通过实际导入、断网恢复、并发编辑、播放下载和生产构建布局验证，经 [PR #9](https://github.com/beyondgravitylab/scenedesk/pull/9) 合入（2d1511e），两组 CI 通过；[资产固定版本](32-asset-versions.md)已接通 12 个操作及业务页面，独立造型、历史确认、共享声音固定引入、真实 412 恢复和生产构建布局均通过；经 [PR #10](https://github.com/beyondgravitylab/scenedesk/pull/10) 合入（a23bfae）；修复存储冷启动探针等待时提前退出的问题，最终两组远端 CI 的 16 项单元、59 项数据库与 25 项媒体验证通过；[场镜实际引用](33-creative-asset-bindings.md)已通过本地 19 项单元、69 项数据库及 25 项媒体验证，实际绑定、固定历史、使用位置跳转、真实冲突与草稿恢复及生产构建窄屏验收通过，经 [PR #11](https://github.com/beyondgravitylab/scenedesk/pull/11) 合入（a51671c），两组 CI 通过；[候选与明确采用](35-candidates-and-adoption.md)已完成本地业务与生产构建恢复验收，经 [PR #13](https://github.com/beyondgravitylab/scenedesk/pull/13) 合入（22e29ae），两组远端 CI 通过；共享发布及实际用片继续实施 |
| E05A–E06 编辑与场次交付 | 实施中 | [共享剪辑工作稿](36-cut-work-drafts.md)已实现服务、独立 CAS、类型化引用及有限历史，31 项单元与 91 项数据库测试通过；剪辑、源片段、对白／固定声音／字幕、本机恢复及实际 412 逐项重放已通过初步生产浏览器验证，尚未推送／合并；容量与跨标签页恢复、后台维护继续实施；精确归一、固定渲染、审阅返工和工作包待完成 |
| CX01–CX06 场次画布 | 待实施 | 双模式共用事实、文档保存、引用、结果取回、冲突与有限历史 |
| G01–G04 生成与费用 | 待实施 | 先用模拟供应商验证事务及异常；真实生成与核账另记外部验收 |
| C01–C03、U01 完整 MVP | 待实施 | 整集、跨集复用、内部后期交接、恢复容量及用户试点 |

[编辑器提交后恢复](34-editor-completion-recovery.md)已接通命令回执、清理重试及提案单项草稿转移，存储事务中断、刷新、编辑器卸载和失效目标均通过生产构建浏览器验证，经 [PR #12](https://github.com/beyondgravitylab/scenedesk/pull/12) 合入（e0f405d），两组远端 CI 通过。

## 实施规则

每个切片同时交付数据库约束、业务接口、可操作页面、失败恢复和对应验证；不按接口数量宣布完成。使用独立功能分支与 PR，经必要检查和远端 CI 后合入 main。模型采购、真实部署和客户试点依赖真实条件，保持明确状态。

历史评审、校验报告及原型作为当时证据保留。当前状态以本记录及实际代码／CI 为准；详细依赖见[工作包](16-implementation-backlog.md)，行为见[技术定案](21-technical-baseline-closure.md)。

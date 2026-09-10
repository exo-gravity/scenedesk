# 内部队列集成与 QV-01 基础验证

2026-09-11。按 [21 技术定案](21-technical-baseline-closure.md#2-队列与业务执行)接入 pg-boss，关闭 T01 的候选基础验证部分；实际媒体业务随后接入，G02 的付费提交、账号额度与备份恢复门槛仍未关闭。

## 锁定与运行方式

锁定 `pg-boss 12.30.0`（MIT，Node ≥22.12.0，schema 40），使用仓库当前 Node 22／PostgreSQL 16。版本与传递依赖、下载摘要进入 package-lock。官方[版本源码](https://raw.githubusercontent.com/timgit/pg-boss/12.30.0/package.json)、[既有事务接口](https://pgboss.io/api/adapters)及[运行时迁移配置](https://pgboss.io/api/constructor)在接入时重新核对；以下权限和恢复结果来自本项目实际测试。

`packages/queue` 只提供同事务 `schedule`、注册内部 handler、角色预检及迁移安装。预建 `media-probe` 队列用于接下来的媒体导入。消息只含固定 `taskKind`、业务 ID、stepRevision 和 epoch；拒绝额外 tenantId、提示词及 URL。handler 必须从真实业务根解析租户、重新检查版本／状态／代次，再提交结果，不能把信封当授权凭证。

`schedule` 要求调用者传入正在使用的 `PoolClient`，pg-boss 的 `db.executeSql` 直接执行在这个连接上。业务模块先建立自己的事务和授权，业务写入与队列写入一同提交／回滚。没有增加 worker_tasks 或用于转发内部命令的 outbox。

生产者与 Worker 均 `migrate:false`、`schedule:false`，不开 LISTEN/NOTIFY，依靠轮询。Worker 使用组件内置监督、过期回收与重试，不在应用中重做租约表。自动建索引、持久化队列统计分区和警告表关闭；警告交给调用者诊断通道，业务进度仍由业务表保存。

初始内部步骤参数为：本机并发 2（允许显式配置 1–8）、每次领取 1 项、轮询 1 秒、步骤过期 120 秒、心跳 15 秒、最多重试 5 次、指数退避起点 2 秒／上限 60 秒、队列保留 7 天。`short` 策略只减少相同业务版本的排队重复，不承诺永久去重或外部 exactly-once。handler 返回后组件才确认队列项；异常正文不写入队列表，只保留通用错误，详细诊断走服务端回调。

## 权限与安装

迁移身份独立安装 schema、类型、表与函数，使用安装锁串行化；相同版本可重复执行，不自动升级版本不符的已有 schema。PUBLIC 无 schema／表／函数／序列权限。运行身份没有建表、迁移、重建索引或队列管理函数的执行权限。

| 身份 | 实际授予 |
|---|---|
| API／生产者 | queue、version 的读取；预建 job_common 的 INSERT 与 SELECT(id)，不能读取消息正文或领取／修改任务 |
| 调度者 | job、job_common 的 SELECT／INSERT／UPDATE／DELETE（库的重试使用删除再插入）；queue 更新、dependency 读取／更新／清理，version 仅 flow_on／monitor_backoff_on 两列更新 |
| 业务 Worker | 队列模块不授予业务表权限；各业务 handler 使用独立连接和最小授权。调度账号不能读取项目业务表 |

基础测试明确验证运行身份非 owner／superuser／BYPASSRLS，没有 schema CREATE 权限，缺少必要入队／消费权限会阻止启动。监控退避最初因缺少 `monitor_backoff_on` 更新权限失败，核对组件 SQL 后仅补齐该列，再通过恢复测试。

本地在已有 `.env.business` 的基础上执行：

```sh
npm run setup:queue
npm run queue:check
```

首次安装创建独立调度账号，将连接写入 Git 忽略的 `.env.queue`（0600）；已有文件不覆盖、不旋转凭据。预检分别验证生产者与调度者权限，主动刷新队列计数，并返回统计采集时间。安装到持久化数据库的 schema 为 `scenedesk_queue`，schema 40；官方 construction SQL 的 SHA-256 为 `e96f3b33d25f0ff3bb3832652f9303883d49b097d5e50fd38d34db7823db915f`。此摘要包含 schema 名，因此测试隔离 schema 的摘要不同。

当前预检仍显示 `processingEnabled:false`：媒体业务 handler 和独立 Worker 启动器随 E03 接入，不启动一个会把真实媒体命令空处理掉的消费者。`worker:check` 仍为早期数据库检查，队列检查单独执行。

## 实际验证

`tests/integration/queue.test.ts` 在独立 schema 中使用实际 PostgreSQL、业务身份内核及三个受限连接，测试专用业务根遵循版本／epoch／RLS；它不冒充已实现的媒体流水线。

1. 业务插入后入队，再抛错：两者均回滚。撤销入队 INSERT 权限再执行：业务写入同样回滚；成功提交两者各一项。
2. API 不能读消息正文、领取或建表；调度者不能读项目表；无上下文业务 Worker 看不到根；未安装 schema 的运行启动失败且没有建 schema。
3. 延时任务在生产者关闭后保留，到期可领取；相同版本重投及错误 epoch 的重复命令均不再产生业务效果。
4. 独立进程在锁住业务根、提交前 SIGKILL：事务回滚；在业务提交、队列确认前 SIGKILL：结果保留。由组件超时回收并重投后，两种情况最终都只有一次业务效果。测试仅在隔离队列将过期时间压至 2 秒，心跳保持组件支持的最小 10 秒，并手动调用组件监督入口；没有改动库源码或直接伪造队列终态。
5. handler 连续失败直到耗尽重试：队列留下 failed 记录，业务仍 pending、效果为 0，异常中的私有字符串没有进入队列表。

全套数据库集成测试 **51 项通过**；`npm run check` 通过生成契约、类型、构建、14 项单元测试和既有 UI 规则；本地实际安装及 `queue:check` 通过。未调用真实模型、未产生模型费用。

尚未验证：真实媒体资源隔离、业务修复扫描、供应商一次创建／未知提交、账号在途与费用预占，以及备份恢复 quarantine。这些随 E03／G02 实施，不能因队列基础通过就启用付费创建或宣布完整 MVP 完成。

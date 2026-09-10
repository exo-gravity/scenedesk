# 任务执行机制技术复核：PostgreSQL 队列、付费调用与恢复

日期：2026-09-10。状态：**本轮技术复核建议，不改变现行技术基线；尚未安装候选组件、接入业务或运行集成测试。**

审阅对象：[05 技术架构](../implementation/05-architecture-and-operations.md)、[04 执行与费用](../implementation/04-state-execution-and-budget.md)、[11 事务蓝图](../implementation/11-transaction-and-implementation-blueprint.md)。只核查官方文档与官方源码；组件文档描述与本项目可实现性判断分别陈述。

## 1. 结论与首个验证候选

建议保留 **PostgreSQL 作为业务事实源、独立 Node Worker、Generation job/attempt、未知提交与核账协议**，重新审议“自研 `worker_tasks` 调度器”。**首个验证候选选 pg-boss，成功通过下面的集成门槛后再决定是否替代自管队列。** Graphile Worker 是合理备选；当前没有充分理由为首版专门引入 Redis 队列或 Temporal 服务。

理由是当前业务需要可靠的有限步骤执行、延时查询、归档和渲染调度；队列租约、退避、回收和清理属于可复用基础设施。pg-boss 官方提供现有事务内入队、延时执行、重试和心跳机制，贴合已经采用 PostgreSQL / Node 的骨架。选择它的理由不是其首页的 exactly-once 宣称，而是能减少必须自行维护的基础调度代码。[事务接入](https://pgboss.io/api/adapters)、[作业选项](https://pgboss.io/api/jobs)、[Worker](https://pgboss.io/api/workers)

本报告核查的 pg-boss 官方站点版本标识为 **12.30.0**；精确版本源码声明 Node `>=22.12.0`、`pg ^8.23.0`，官方要求 PostgreSQL 13+。[版本源码](https://raw.githubusercontent.com/timgit/pg-boss/12.30.0/package.json)、[官方要求](https://pgboss.io/#requirements)

仓库实际配置为 [`.nvmrc`](../../.nvmrc) 的 Node **22.23.2**、[compose.yaml](../../compose.yaml) 的 PostgreSQL **16.15** 镜像（已固定摘要），以及 [Worker package](../../apps/worker/package.json) 的 `pg 8.23.0`。这些声明版本满足上述最低依赖；不代表已证明运行权限、事务、故障恢复或生产性能兼容。仓库并未使用 PostgreSQL 18。

## 2. 五项高价值发现

### 2.1 应复用调度设施，业务状态仍由平台拥有

目前 05 把 `worker_tasks + outbox` 作为一项默认选型，11 又规定任务去重、租约令牌、事件保留，04 给出 60 秒租约与 20 秒心跳。这不是明显错误，但意味着团队将自行承担完整调度设施的维护成本。当前代码只有 Worker 数据库检查骨架，尚无成熟自研运行器需要保留。

建议保留业务 `GenerationJob`、`Attempt`、费用和媒体状态，队列任务仅表达下一次可执行动作，例如 `submit-generation`、`query-generation`、`archive-output`、`render-cut`。**队列任务完成不等于视频生成成功**：提交步骤完成时，业务作业通常仍是 `provider_pending`；业务成功要等待结果验收归档。

这是模型边界建议，不是新增一套业务状态。Graphile 官方也明确建议在应用自己的表中跟踪业务进度和完成记录，并说明成功任务会从队列删除；不能把队列表当永久制作历史。[Graphile 数据库与跟踪说明](https://worker.graphile.org/docs/schema)

如果采用 pg-boss，移除重复的通用领取、心跳和退避实现；仍保留业务条件更新、唯一 attempt、恢复 epoch 和追加回执校验。队列所有权不能代替这些业务约束。

### 2.2 现有“未知提交”设计应保留，任何队列都不能代替

04 已明确“供应商接受后、ID 保存前崩溃”的窗口，以及未知时不自动重发。这个判断正确，是本方案最应保留的部分。

pg-boss 的异常、心跳丢失或执行过期可能触发重试；BullMQ stalled 任务也可能重新进入等待；Temporal Activity 超时根据 Retry Policy 重新执行。因此它们不能给外部付费 API 提供端到端 exactly-once。[pg-boss 心跳与过期](https://pgboss.io/api/jobs)、[BullMQ stalled](https://docs.bullmq.io/guide/workers/stalled-jobs)、[Temporal Activity Execution](https://docs.temporal.io/activity-execution)

建议具体执行规则：重复收到 `submit-generation` 时，先读取持久 attempt；已有可能发出的提交就进入查询／核对，不能重新 POST。安全读取与归档可以按策略重试；付费创建只有在供应商明确支持且本账号验证过的幂等／恢复契约下才允许重放。单纯把队列 retry 次数改成 0 也不够，仍需重投、人工恢复、SDK 隐式重试和数据库恢复窗口的保护。

### 2.3 同库同事务可以简化内部 outbox 转发，但不能只看“都用 PostgreSQL”

pg-boss 的 `send/insert/fetch/complete` 接受 `db`，通过 `executeSql` 在调用者已有事务中执行；官方说明回滚也回滚队列操作。基于此，API 可以在**同一个连接、同一个事务**中保存 job、预算预占、业务唯一性与队列命令。不能以“使用同一个 Pool”冒充同事务。[pg-boss Transaction Adapters](https://pgboss.io/api/adapters)

Graphile `graphile_worker.add_job()` 是正式 SQL API，可在业务事务中调用。它的 `job_key` 可去重／替换，但队列任务清理后不能代替业务表永久的 plan→job 唯一性。[Graphile SQL 入队](https://worker.graphile.org/docs/sql-add-job)

由此推导：若队列和业务事务已真正原子提交，不必为同一内部命令再堆一层“业务 outbox → 自研 worker_tasks → pg-boss”。但当前 outbox 还承担项目事件与 SSE 通知，**不能整体删除 outbox**。应把“执行命令”和“业务事件投递”职责写清楚。

BullMQ Redis 与 Temporal 服务端调用不在业务 PostgreSQL 本地事务内，仍需 outbox／幂等启动来跨越写入边界。当前 BullMQ 官方也已经提供 PostgreSQL backend，但文档只证明其内部操作事务化和可共享 `pg.Pool`；本轮尚未确认其入队能加入调用者既有事务，因此不能自动套用 pg-boss 的原子提交结论。[BullMQ PostgreSQL backend](https://docs.bullmq.io/guide/postgresql)

### 2.4 视频生成等待应释放 Worker 槽位，供应商在途额度单独控制

04 写了查询退避，但尚未把“整个视频等待多久”和“某个 Worker 步骤执行多久”彻底分开。

建议提交获得 provider ID 后，保存业务状态和下一次查询时间并结束当前步骤。每次 `query-generation` 只进行一次有超时的查询；未完成就原子登记下一次延时查询，然后归还执行槽位。回调可以提前唤醒查询；用业务版本／查询代次使过期查询成为无害重复。不要在一个活跃队列任务中循环 sleep 数分钟等待视频。

pg-boss 提供 `startAfter/sendAfter`，Graphile 提供 `run_at`；Temporal 则用持久 Timer 暂停 Workflow，而不长期占住进程。这些是可用机制，具体轮询间隔、超时和故障行为仍须按供应商验证。[pg-boss 延时](https://pgboss.io/api/jobs)、[Graphile run_at](https://worker.graphile.org/docs/sql-add-job)、[Temporal Timers](https://docs.temporal.io/develop/typescript/workflows/timers)

**不能因归还本地 Worker 槽位就释放供应商在途额度。** 应区分本地步骤并发、API 请求速率、供应商账号在途任务数；后者持续到有可信终态／取消证据。pg-boss 官方说明 groupConcurrency 存在竞争时短暂超过限制的可能，且它统计活跃队列任务，不等于供应商仍运行的视频数量。供应商硬额度和支出限制必须由业务准入事务维护，不能只配置 Worker concurrency。[pg-boss 并发边界](https://pgboss.io/api/workers)

### 2.5 数据库权限与迁移是选型门槛，不是安装细节

当前 05 要求业务运行角色不是表 owner，也不具备 BYPASSRLS。选择队列时不能为了方便把 API／业务 Worker 改为数据库 owner。

pg-boss 默认会创建独立 schema；官方支持 CLI／静态 SQL 单独迁移，并通过 `migrate:false` 让运行实例不进行 schema 变更。这提供了迁移角色分离的路径，但**尚未证明本项目的最小授权组合**。需针对锁定版本验证预建队列、生产者入队、消费者维护、序列／函数／表权限及 RLS 上下文，不能把默认示例当生产权限方案。[安装与迁移](https://pgboss.io/install)、[构造配置](https://pgboss.io/api/constructor)

Graphile 官方说明默认预期数据库 owner 执行；低权限入队需要有授权检查的 `SECURITY DEFINER` 包装等调整。它仍是可行备选，但相较 pg-boss，本项目必须更明确审查该权限接入面。[Graphile 权限](https://worker.graphile.org/docs/schema)、[SQL 入队权限](https://worker.graphile.org/docs/sql-add-job)

Graphile 当前官方要求 Node 22.18+、PostgreSQL 12+：仓库精确 Node 22.23.2 与 PG16.15 满足，但根 package 的 `>=22.12.0 <23` 范围允许更旧 Node；若采用，需要同步 engines 下限。官方最低支持版本不等于推荐使用已结束维护的数据库版本。[Graphile Requirements](https://worker.graphile.org/docs/requirements)

## 3. 选项边界

以下“本项目判断”是基于现有 MVP 范围的技术建议，不是组件官方保证。

| 选项 | 已核实机制 | 本项目判断与转用条件 |
|---|---|---|
| 自管 PostgreSQL worker_tasks | 现有文档设计了领取、租约、恢复与 outbox；尚无已验证完整实现 | 不作为优先实现方向；只有成熟组件确实不能满足必要语义且成本可证明更低时再选 |
| **pg-boss** | PostgreSQL 队列、既有事务接入、延时、失败回收；本轮查看版本为 12.30.0 | **首个验证候选**；必须通过同事务回滚、低权限运行、未知付费提交和延时恢复门槛 |
| Graphile Worker | 至少一次执行、正式 SQL 入队、run_at、成功记录清理；低权限需调整 | 若团队偏 SQL 或已有 Graphile 经验则可优先；不用 PostGraphile 也能用，注意权限与 Node 最低版本 |
| BullMQ | 默认 Redis；当前官方也有 PostgreSQL backend，官方仍称 Redis 为验证最充分选项 | 已有 Redis 与运维经验、需要其成熟调度生态时可选；不能再说它“只能用 Redis”。PG backend 的发行版本、外部事务接入和实际权限需专门验证，不因新增文档就认定与 pg-boss 同等适配 |
| Temporal | Workflow 历史与恢复、Activity 重试、持久 Timer、确定性与代码版本约束 | 复杂多阶段 Agent、长期等待与信号、人机交互恢复成为主要开发成本，或团队已有 Temporal 时再评估；当前固定生成链路尚不足以抵消新增服务与编程模型成本 |

机制依据：[pg-boss](https://pgboss.io/)、[Graphile](https://worker.graphile.org/docs)、[BullMQ PostgreSQL](https://docs.bullmq.io/guide/postgresql)、[Temporal Activity](https://docs.temporal.io/activity-execution)、[Temporal Workflow 约束](https://docs.temporal.io/workflow-definition)。Temporal 控制流持久化不意味着替平台保存预算、审阅、资产和供应商账单；这些仍是业务事实。

## 4. 定案前最小验证清单

1. **事务和权限**：受限业务角色写 job／预算并入队；任一步失败全部回滚；迁移角色单独运行；队列管理不绕过租户 RLS。锁定版本与生产数据库连接方式一同验证。
2. **外部创建故障**：提交前、供应商接受后、回执落库后分别杀 Worker；重复消息、超时、租约丢失不产生未经授权的第二次 POST；迟到证据能恢复原 job。
3. **等待和额度**：长时间模型等待不占本地执行槽位；仍占正确供应商在途额度；回调／轮询竞争、进程重启、延时到期均不漏查、不把过期查询变为重生成。
4. **隔离与恢复**：媒体处理不阻塞 Node 心跳；API／查询／归档／渲染有独立资源上限；同库备份恢复必须继续执行既有 quarantine / epoch 协议，不能恢复后立即自动重发所有队列任务。
5. **可维护性**：明确超时、重试、死信、保留与清理策略；运行视图可以定位业务 job 和实际步骤；业务 UI 不依赖第三方私有队列表。若启用 LISTEN/NOTIFY，要验证会话连接和失联轮询回退；pg-boss 官方明确该功能不能通过 PgBouncer transaction/statement pooling 建立监听。[连接限制](https://pgboss.io/api/constructor)

本轮只完成文档和源码核查，以上验证均未执行。也未对任何供应商声明可安全重发付费请求。现行 04/05/11 的业务恢复语义继续有效；是否替换其调度实现，应在这一轮关键技术决策完成后另行更新基线。

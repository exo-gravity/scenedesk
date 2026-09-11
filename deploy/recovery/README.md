# 私有隔离恢复演练工具

这组 CLI 只操作显式标记的合成演练容器和本地 named volume。它不连接用户部署，不创建或发现服务，不启动 API、媒体 worker 或模型执行器。它验证 PostgreSQL 16 逻辑备份与固定 MinIO 单卷冷快照可以恢复到新的空目标；不是生产 PITR、云对象存储迁移或付费任务恢复工具。

## 使用边界

- 测试 harness 负责创建和清理资源；工具只 inspect 配置中的完整容器 ID 和卷名。源、目标使用同一 `runId`、不同 `side`。所有资源都必须有 `io.scenedesk.recovery.run=<runId>`、`io.scenedesk.recovery.side=source|target`、`io.scenedesk.recovery.synthetic=true` 标签。
- PostgreSQL 和 MinIO 使用 [types.ts](types.ts) 的精确 image digest；单个无 driver options 的 Docker local named volume 分别挂在 `/var/lib/postgresql/data`、`/data`。PGDATA 必须是该路径，MinIO 命令固定为 `server /data`。发布端口只允许 `127.0.0.1`，禁止 privileged/host network。
- 源端列出全部会写入的容器 `writers`；宿主机测试 API、数据库连接和上传客户端必须在调用前关闭。工具停止显式 writers，拒绝其他已连接的数据库客户端，读取并验证所有对象版本后停止 MinIO，复核数据库摘要，导出数据库并停止 PostgreSQL，再归档冷卷。成功后源端保持停止，不自动重启。
- 目标 PostgreSQL 已运行，但没有自定义 schema、表、函数、扩展或角色；MinIO 已创建且停止，卷必须完全为空，包括尚无 `.minio.sys`。目标 writers 必须停止。工具创建原角色、导入数据库、解包冷卷，仅启动目标 MinIO，然后执行只读核验。
- 文件权限要求目录 `0700`、文件 `0600`，属于当前用户。配置和密钥放在 bundle 外。锁、恢复意图及完成记录 fsync 后才开始相应写操作；崩溃遗留锁只能在确认进程停止后人工移除。

## CLI 与配置

在仓库根目录运行，依赖仓库 lockfile 安装的 Node/tsx 和本地 Docker：

```sh
node --import tsx deploy/recovery/cli.ts backup --config /absolute/private/source.json --bundle /absolute/private/backup
node --import tsx deploy/recovery/cli.ts restore --config /absolute/private/target.json --bundle /absolute/private/backup
node --import tsx deploy/recovery/cli.ts verify --config /absolute/private/target.json --bundle /absolute/private/backup
```

`Configuration` 的完整类型见 [types.ts](types.ts)。配置包含 `version: 1`、小写 UUID `runId`、`side`、`sealKeyFile`，以及：

| 字段 | 内容 |
| --- | --- |
| `database` | `containerId`（64 位完整 ID）、`volumeName`、`database`（`scenedesk` 或 `drama_recovery` 开头的安全标识符）、`schema`、`user: "postgres"` |
| `storage` | `containerId`、`volumeName`、`endpoint`（映射到该容器 9000 端口的 HTTP loopback origin）、`region`、`bucket`、`accessKeyId`、`secretAccessKey` |
| `writers` | 显式 writer 容器 ID 数组，最多 16 个；不通过扫描推断 |

sealKeyFile 是独立的 `0600` JSON：`version: 1`，`key` 为 32 个密码学随机字节的 base64url 编码。源和目标使用同一份演练密钥。不要在命令行或 CI 日志写凭据。

成功 stdout 是一行 JSON，包含 `status: "ok"`、`operation`、表/固定对象/全部版本数量、生成任务状态计数、`scope: "isolated_synthetic_restore_only"`、`generationExecution: "disabled"`、`modelRestartSafe: false`。失败 stderr 只包含固定错误码，退出码 1；不输出 Docker、SQL、对象请求的原始诊断。

## Bundle 与验证

完整 bundle 有 `database.dump`、`storage.tar`、最后写入的 `manifest.json`；`intent.json` 表示尝试已开始。缺失任何组成部分、摘要不符或 manifest seal 不符均拒绝恢复。manifest 中 HMAC-SHA256 绑定格式、run/source 身份、镜像、时间、两个文件 SHA-256/大小以及以下清单：

- 全部用户表的行数与有序行摘要、迁移名和原 checksum、角色属性、生成状态计数。
- 数据库引用的原 `key`、`VersionId`、bytes、SHA-256，包括原片、预览、固定 staging 和生成回执引用。
- 桶中全部对象版本与 delete marker 的有序清单，保留原 key/VersionId/latest/lastModified；每个实际对象版本通过 GET 原 VersionId 流式验证 bytes/SHA-256，包括没有当前数据库引用的旧版本。

卷归档保存 MinIO 内部版本元数据，恢复不会逐对象重新 PUT，也不会用新 VersionId 冒充原版本。恢复后重新读全部数据库摘要和全部对象版本，与封存清单比较。固定引用缺失或内容不符为 `RECOVERY_FIXED_OBJECT_MISMATCH`，其他全版本差异为 `RECOVERY_STORAGE_SNAPSHOT_MISMATCH`。

逻辑 dump 保留 owner/ACL，角色仅保存名字、LOGIN/INHERIT/BYPASSRLS 和连接限额，不保存密码；拒绝超级用户、建库/建角色/复制权限、LOGIN+BYPASSRLS 或额外角色成员关系。测试 harness 先验证恢复后的角色与 ACL，再从自身私密内存为受限 LOGIN 测试角色重设密码。公共业务核验仍使用受限连接。

**Bundle 本身是机密数据。** 数据库含会话散列和业务内容，MinIO 冷卷含内部 IAM 元数据。HMAC 提供完整性校验，不提供加密。不得上传原 bundle、配置、seal key 或私有恢复记录作为 CI artifact；只提交脱敏计数和断言证据。

本片有明确合成数据上限：最多 500 张表、每表 10,000 行、1,000 个对象版本/marker、单对象 16 MiB、对象内容合计 256 MiB、PG dump 64 MiB、冷卷 tar 256 MiB、每份 JSON 256 KiB。超限失败，不降级为抽样核验。

## 中断与未决生成

恢复在首次修改目标前写入绑定 bundle 与完整目标身份的 `started` 记录。若中断，后续相同请求报 `RECOVERY_RESTORE_UNCERTAIN`，不会重新导入部分数据库或覆盖部分卷。保留失败目标以核对；另建全新空目标重新演练。成功写入 `verified` 后，相同 restore 只执行在线 verify，不重复导入。verify 不启动服务或修复队列。

临时卷 helper 先以随机唯一名称创建，带本 run 的明确标签，再通过完整 ID 启动。正常、失败、输出超限或超时都 inspect 标签后按精确 ID 强制移除。无法确认清理时返回 `RECOVERY_HELPER_CLEANUP_UNCERTAIN`，停止流程；不会把杀死 Docker CLI 当作卷写入已经停止。

恢复保留 queued、dispatching、unknown 和 provider 状态，报告它们而不运行任务。数据库回滚可能丢失外部已提交证据；本工具没有跨恢复 epoch 的执行隔离/人工对账放行机制，因此 **不能证明恢复后可安全重启真实或付费模型执行器**。生产使用仍需要独立的部署目标、加密/异地保留方案、密钥管理、RPO/RTO 和外部任务对账设计。

## 验证状态

本产品基础提交完成专用 `tsc -p deploy/tsconfig.json`；独立 agent 的实际 PG16/MinIO CLI 演练、历史与权限核验另交测试与结果。类型检查不等于恢复演练成功。

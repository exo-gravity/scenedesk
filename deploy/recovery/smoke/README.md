# 独立恢复验收

在仓库根目录运行：

```sh
npx tsc -p deploy/tsconfig.json --noEmit
npm run test:media:prepare
node --import tsx --test deploy/recovery/recovery.test.ts
```

测试只创建带独立随机 run 标签的 PostgreSQL 16、固定 MinIO 容器和 named volumes，使用仓库锁定镜像。测试身份来自 `urn:scenedesk:test`。配置、seal key、备份和恢复记录都保存在本工作树 `.runtime/recovery-verification-*` 的 `0700` 目录，文件为 `0600`；这些目录不得作为 CI artifact 上传。

源数据通过现有公共 API 创建：项目、镜头两个修订、画布两个有正文的修订，以及一张 32×32 合成 PNG 的真实上传、probe 和 poster。生成能力仅为 `test_fixture` 元数据；queued 经创建计划/任务 API 产生，submission_unknown 经受限的 claim/record/finish 函数产生。测试没有实例化或启动 generation executor，没有模型外呼，也没有用直接 UPDATE/ready SQL伪造媒体就绪。

验收覆盖：

- 成对 dump/冷卷备份、完整性 seal、目录与文件权限、显式 writer sentinel 停止。
- 全新空目标恢复、在线核验和已完成 restore 的只读重复核验。
- 七份原公共表示、镜头/画布历史、当前权限、受限角色属性与 ACL、禁止 runtime 直接改写生成状态。
- 原 key/VersionId/bytes/SHA-256 下载。源桶故意增加同 key 的不同新版本，另有未引用旧对象和 delete marker，防止仅验证 latest 的实现误过。
- queued 不产生 attempt；unknown 保留原 attempt 和状态；恢复不启动执行器。
- 篡改 payload 与 checksum 后仍不能伪造 seal；key 随 bundle 打包、缺失存储半份、同源目标、非空目标均拒绝。
- 第二个全新目标只删除原固定 VersionId，数据库完全不变，核验精确报固定对象丢失。不会删除 API 产生的审计行来迎合快照。
- 实际运行中 inspect helper 的挂载，证明只有所声明的 named volume，PGDATA 是 tmpfs；附件超时后观察 Docker start/destroy 事件并确认没有剩余 helper。

成功结果写入新建的 `output/engineering/private-recovery/<runId>/results.json`，在记录的容器和 named volumes 清理成功后才写出。目录与结果文件拒绝覆盖，因此不会改写已提交的历史证据。完整 TAP 是运行证据；不能只根据旧的结果文件判断新一次运行成功。失败由测试退出码体现，脚手架仍按记录的确切资源清理。

2026-09-12 的最终运行证据在 [独立日期目录](../../../output/engineering/2026-09-12-private-recovery/results.json) 和 [完整 TAP](../../../output/engineering/2026-09-12-private-recovery/verification.tap)：11/11（10 子项和 1 父项）通过，耗时 169.708 秒；专用类型检查通过。随后仅将证据写入改为新的 runId 目录，并复核类型，不重复恢复或修改业务断言。该结果对应产品 `a226fd2`、`4b2e3d0`、`9f8e60a`、`cc33c4c`；最新主线迁移组合由独立 CI 再验证。

实现期间保留了两类失败证据：最早的 seed 因队列 schema 名不符合现有约束被拒，修正的是夹具名称；增加 helper 挂载观测后的首次尝试因固定次数轮询在 `docker create` 完成前耗尽而失败，随后改为有截止时间的等待。没有放宽业务或挂载断言。

首轮完整业务恢复通过时，旧 helper 使用 PG 镜像隐含的匿名卷，移除容器后可能留下空匿名卷。后续产品修复使用 tmpfs 覆盖该路径并精确 `rm --force --volumes`，脚手架 sentinel 同步修正。旧 daemon 的事件缓冲已不含所需 volume/container 映射，无法证明旧匿名卷的归属，因此没有按名称或时间猜测删除；旧首轮不能作为匿名卷清理通过的证据。

本片证明受控隔离恢复，不证明真实部署上线、外部 OIDC、独立云 IAM、PITR、异地保留或真实模型恢复后可安全重启。MinIO 冷卷含内部状态，bundle 应始终作为机密数据管理。

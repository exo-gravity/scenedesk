# 租户隔离与部署演进：官方技术核查

核查日期：2026-09-07。范围仅含数据库隔离、租户部署边界及恢复；未实现或运行验证。以下将官方事实与本项目建议分开。

## 官方事实

1. PostgreSQL RLS 约束普通查询及行级写入；启用后没有适用策略时默认拒绝。它是表权限之外的补充机制。[PostgreSQL 18：Row Security Policies](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)
2. 超级用户与 `BYPASSRLS` 角色始终绕过 RLS；表所有者通常绕过，可用 `FORCE ROW LEVEL SECURITY` 约束所有者。`TRUNCATE`、`REFERENCES` 不受行安全限制；唯一键、主键和外键完整性检查也绕过 RLS。默认 permissive 策略以 OR 合并。[PostgreSQL 18：Row Security Policies](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)
3. `SET SESSION` 可跨事务持续生效；`SET LOCAL` 只在当前事务内有效，事务外使用没有效果。回滚到更早的保存点也会撤销设置。[PostgreSQL 18：SET](https://www.postgresql.org/docs/18/sql-set.html)
4. PgBouncer transaction pooling 只在事务期间分配服务端连接，事务结束后归还连接；其文档明确列出会话级 SET/RESET 的不兼容性，应用必须配合连接池模式。[PgBouncer features](https://www.pgbouncer.org/features.html)
5. Azure 架构指南区分逻辑租户和部署实例，允许多个租户映射到同一部署，也允许租户独享部署；计算、数据库和文件存储可以采用不同隔离程度。共享模式与独享模式可混用。[Azure：Tenancy models](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/tenancy-models)
6. 共享库恢复单个租户，可能需要先把整库恢复到另一资源，再选择性恢复该租户；分片恢复仍可能影响片内多个租户。租户独立恢复、密钥或地域要求可推动更强隔离。[Azure：Storage and data](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/approaches/storage-data)
7. 共享 blob 容器里的普通路径前缀不等同权限隔离；Azure 文档要求结合对应存储能力设计授权，并区分路径、容器和独立存储账户等方案。[Azure：Multitenancy and Storage](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/service/storage)

## 对本项目的设计建议（基于以上事实推导，不是官方框架的保证）

| 问题 | 建议及边界 |
| --- | --- |
| 逻辑与物理边界 | 稳定 `tenant_id` 表示数据与治理边界，另以 placement 表示数据库、存储和 worker 所在部署。迁往独享库不改组织、项目或作品身份；不要拿数据库名当业务租户 ID。 |
| 项目权限 | `tenant_id` RLS 只保证策略所表达的租户条件。某成员可看哪些项目、可否生成/审片/下载/花预算，仍需明确业务授权；若写进 RLS，也必须实现并验证这些具体规则。独享数据库同样不消除内部权限。 |
| 运行角色 | API 和正常 worker 使用非 owner、非 superuser、无 BYPASSRLS 的角色；迁移与运维角色分开。审查 SECURITY DEFINER 路径及默认 permissive 策略组合，避免引入绕过。 |
| 连接池上下文 | 服务端认证并确认成员关系后，在事务开始设置本次可信租户上下文；无上下文默认拒绝。设置与查询必须处于同一事务、同一绑定连接，并验证提交、异常、保存点与连接复用场景；不能依赖上个请求留下的 SET。 |
| 上下文信任 | RLS 若依赖应用可修改的会话变量，它不是抵御已被完全控制的应用连接的独立安全边界；不要把客户端传入的 tenant_id 直接视为授权结果。 |
| 跨租户引用 | 仅有外键不足以证明父子对象同租户。关键关联用含 `tenant_id` 的复合约束或等效强约束，并验证项目、资产版本、作业和费用归属；跨租户共享走明确发布/授权/复制流程。 |
| 后台与回调 | 排队作业固化租户、项目、操作者、计费主体与输入版本。worker 从可信记录建立上下文；供应商回调经鉴别后映射到已记录作业，不能凭回调参数选择租户。成员退出后已受理作业的完成与归属需有明确规则。 |
| 媒体与缓存 | 私有媒体每次签发访问能力前检查业务授权；短时 URL 的有效期独立于数据库权限。缓存键、搜索/向量索引、导出、缩略图及日志访问也必须隔离；RLS 不覆盖这些系统。 |
| 恢复 | MVP 至少演练完整恢复，并明确单租户恢复流程和限制。单租户恢复需恢复元数据与对应媒体，检查引用完整性；供应商已发生费用、支付和审计记录不能跟随内容恢复随意倒退。 |
| 扩展触发 | 先共享部署与公平调度，观测真实并发、存储与等待时间；按负载、恢复目标、地域或企业合同需求增加多个部署和少量独享租户，不以“成员超过 10 人”作为拆库条件。 |

## 最小验证重点

- 跨租户读取、写入、关联与媒体下载均被拒绝；同租户无项目权限也被拒绝。
- 连接复用、异常回滚、worker 重试、导出与回调不会串用租户上下文。
- 普通运行角色实测受 RLS 约束；用管理员角色通过测试不算有效隔离验证。
- 项目停用或成员退出后，新操作被阻止，历史资产仍属于工作室；已受理外部作业按明确规则完成/取消并结算。
- 恢复演练证明媒体引用可用，且不会重放生成请求、重复计费或改变其他租户。

以上为方案设计检查项，尚未执行验证；RLS 策略、连接池配置、恢复时限与独享部署成本需在选定运行环境后实测。

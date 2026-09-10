# 身份、权限与项目基础实现

2026-09-10。正式业务工程的第一个切片；完整 E01 仍需接上集场镜内容层，完整 MVP 尚未完成。

## 已贯通的行为

- OIDC 登录、服务端会话与注销；工作室创建、列表、修改名称。
- 内部成员邀请、已验证邮箱接受、邀请撤销、成员角色与停用管理、所有权交接。创建仅返回邀请链接，由用户交给成员，不自动发送邮件。
- 项目创建与列表、项目成员与负责人交接、项目设置、归档与恢复、剧目设定保存。新项目与负责人关系、剧目和内容版本根同事务创建。
- React 页面通过这些接口读写 PostgreSQL。刷新恢复已保存内容；过期版本失败时保留表单，并展示服务端新版本供明确核对。

项目媒体样片引用和剧目默认资产引用尚未接入；非空引用目前明确拒绝，避免保存无法验证的外部 ID。后续媒体切片必须补上关系校验后开放。

## 身份与数据库边界

`openid-client` 6.8.8（MIT）处理授权码流程；启用 PKCE、state、nonce 及 JWS 签名校验，检查 issuer、audience、过期时间。固定配置发行方与回调站点，返回路径仅允许同站路径。依据官方[授权码校验](https://github.com/panva/openid-client/blob/v6.8.8/docs/interfaces/AuthorizationCodeGrantChecks.md)与[签名校验](https://github.com/panva/openid-client/blob/v6.8.8/docs/functions/enableNonRepudiationChecks.md)。

一次登录握手绑定独立 HttpOnly 浏览器 Cookie，数据库只存 state／浏览器令牌／nonce 摘要和加密的 PKCE 临时材料。回调在交换前原子消费握手，网络失败要求重新登录，重复回调不会再建会话。会话令牌只存 SHA-256 摘要；Cookie 使用 HttpOnly、SameSite=Lax，在 HTTPS 站点加 Secure。写请求校验固定 Origin 与会话绑定 CSRF。

数据库连接区分迁移、身份、业务角色。业务角色不可读写用户和会话原表，不拥有 schema／表、无 superuser／BYPASSRLS／CREATEROLE，也不能切换到特权角色。身份角色只可管理用户、会话、登录握手。授权函数由单独 NOLOGIN、NOINHERIT 角色持有，只有必要表权限；它使用 BYPASSRLS 以避免强制 RLS 的递归授权。业务和身份账户均不是该角色的成员。函数固定 `pg_catalog, schema, pg_temp` 搜索路径；不得由可登录的迁移超级账户持有，启动检查会拒绝这种配置。

API 从有效会话派生 actor，在事务内设置用户与租户上下文。RLS 是对漏写范围过滤的第二道防线，运行账户仍是可信的服务端边界，不将任意客户端 SQL 暴露给它。成员权限变更锁工作室根；项目写入持工作室共享锁及项目排他锁，避免不同项目彼此串行。所有权与负责人交接有延迟完整性约束，保留唯一有效责任人。

可变对象使用严格 ETag／If-Match；所有认证 POST 先重新授权，再按 actor、scope、operation、规范路径和键进行事务幂等。请求摘要含正文与版本头；响应加密保留 24 小时。分页游标加密并绑定用户、工作室、项目及查询范围。浏览器只对读取作有限重试，写入不自动重试；连接失败后的相同提交保留原幂等键。

## 本地运行

按根 README 执行 `npm run setup:business`，再执行 `npm run dev:business`。第一次会迁移本机 `drama_*` 数据库，创建随机命名角色与密码，将凭据及应用加密密钥写入 `.env.business`（0600、Git 忽略）。重启复用该文件，不重复初始化。

本地身份模拟器复用集成测试的真实 HTTP/JWKS/RS256 边界，只监听 127.0.0.1:4320，固定测试身份，绝不作为生产身份提供方。启动必须显式配置 APP_ENV=local 和 OIDC_ALLOW_LOCAL=true；常规 OIDC 配置要求 HTTPS。未接入真实模型，不产生供应商费用。

迁移脚本仍使用 `.env` 的迁移连接。已应用的 SQL 文件受摘要保护，不回写历史。后续新增需要授权的表或函数时，应同步角色授权，并使用迁移账户重新执行授权步骤；不能给运行账户迁移权限。

## 验收与边界

`npm run check` 验证构建、接口生成、UI 源规则及既有单元行为；`npm run test:db` 使用实际密码登录的独立 PostgreSQL 角色与临时 schema，验证越权、RLS、角色交接、CSRF、并发重复提交、旧版本拒绝和签名登录失败等行为。测试完成清理自己的 schema／角色。

浏览器证据见[本地走查](../../output/playwright/2026-09-10-identity-project/verification.md)。这证明已列明的基础链路，不能替代媒体、画布、生成、费用、编辑渲染、整集交付、恢复容量和真实用户验收。当前启动器仍限制本机；公开部署还需登录限流、过期数据清理、代理与日志策略、真实身份提供方及备份恢复运行验收。

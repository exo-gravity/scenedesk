# 55 私有工作台首位 owner 引导

状态：基于 `c9233f6` 的独立切片。本地验证见第 4 节；对应源切片的本机证据不代表真实身份或外部部署验收；主任务整合及GitHub状态见文末。首发范围继续遵循 [38](38-first-release-scope-review.md)，部署前提见 [47](47-private-deployment-package.md) 和 [52](52-private-deployment-integration.md)。

## 1. 最小入口与权限

空数据库完成迁移、真实 OIDC 登录后，新用户没有工作室，私有首页会要求联系操作者。现在操作者可在可信本机，从仓库根目录运行 `deploy/operator/owner-bootstrap.ts`，复用当前登录会话调用既有 `getSession`、`listTenants`、`createTenant`、`getTenant`、`listMembers`。没有新增 API、SQL、公共注册页面或服务进程，没有使用迁移权限写用户、按 email 授权或把开发身份当真实身份。

命令默认只对服务发 GET，同时在本机写私有核对报告；只有 `--apply` 允许首次 POST。createTenant 由服务端当前用户建立工作室及 active owner membership；脚本不提交 owner ID。配置中的 `expectedUserId` 只用于操作者确认当前身份，email 仅展示供人工核对。`currency` 是现有 CreateTenant 的必填领域字段，不启用计费功能。

这是单个私有操作者的一次性入口。使用同一记录路径串行执行；本机锁不构成跨电脑或不同记录文件的全局锁，已有工作室检查也不构成服务端唯一性约束。

## 2. 实际操作

需要 Node 22、仓库匹配的 npm/lockfile（先 `npm ci`）、可通过正常 TLS 验证的工作台 HTTPS origin，以及操作者**已经通过该部署的真实身份服务登录**的会话。没有真实身份服务时，只能执行第 4 节的受控测试，不能用测试 issuer 引导真实安装。

在仓库外建立自己拥有的私有目录；以下是路径示例，替换成当前操作者的绝对路径：

```sh
install -d -m 700 /secure/scenedesk-owner
install -m 600 /dev/null /secure/scenedesk-owner/config.json
install -m 600 /dev/null /secure/scenedesk-owner/session.json
```

通过本机私有编辑器填写配置，不把真实文件提交仓库。初次 `config.json` 不填 expectedUserId：

```json
{
  "origin": "https://workspace.example",
  "name": "我的创作工作室",
  "currency": "CNY"
}
```

在已登录浏览器的开发者工具 Cookie 存储中读取**当前 origin 的 `session` Cookie 值**，只放入自己拥有的 0600 `session.json`。它是敏感凭据，不能粘贴到对话、命令参数、环境变量或运行日志；不要使用应用代码读取 HttpOnly Cookie。会话文件格式如下，占位符不能直接运行：

```json
{
  "origin": "https://workspace.example",
  "token": "REPLACE_IN_PRIVATE_EDITOR_WITH_CURRENT_SESSION_COOKIE"
}
```

origin 必须是精确 HTTPS origin，无尾斜杠、路径、userinfo；两个文件的 origin 必须相等。文件和父目录必须属于当前系统用户，权限分别 0600、0700；文件不能是符号链接。命令先解析真实父目录并规范化路径，拒绝 config/session/record/review/lock 指向相同文件的路径别名。私有 CA 可用 `NODE_EXTRA_CA_CERTS` 指向 CA 文件；没有跳过 TLS 验证开关。

从仓库根目录先运行默认核对：

```sh
node --import tsx deploy/operator/owner-bootstrap.ts \
  --config /secure/scenedesk-owner/config.json \
  --credentials /secure/scenedesk-owner/session.json \
  --record /secure/scenedesk-owner/request.json
```

终端只显示固定状态和已有工作室数量。用本机私有编辑器查看 `request.json.review.json`：核对 origin、currentIdentity.userId/email/displayName、输入名称/币种及已有工作室。报告最多展示 100 条工作室的 ID/名称/状态/owner ID，给出总数和截断标志；所有分页仍用于是否已有工作室的判断。数据超过安全核对上限时明确停止，不忽略后续空间。

确认实际登录用户正确后，将该 `currentIdentity.userId` 写入 config.json 的 `expectedUserId` 字段。UUID 来自已认证 getSession 的结果；不能从 email 推断或填入希望成为 owner 的另一个用户。然后在**同一命令和记录路径**末尾加 `--apply`：

```sh
node --import tsx deploy/operator/owner-bootstrap.ts \
  --config /secure/scenedesk-owner/config.json \
  --credentials /secure/scenedesk-owner/session.json \
  --record /secure/scenedesk-owner/request.json \
  --apply
```

仅当前身份没有任何可访问工作室时执行首次创建。收到完整合法 201 后先持久化 completed，再通过当前 getTenant/listMembers 核对 active owner。报告中的 continueUrl 可在同一登录浏览器打开，进入工作室创建项目；页面仍保留私有导航和无真实模型状态。`created` 或重复执行的 `already_completed` 表示该命令已有原始成功回包并重新核对了当前所有权。

如果已存在工作室，命令阻止新建。可明确选用报告中一个 ID：

```sh
node --import tsx deploy/operator/owner-bootstrap.ts \
  --config /secure/scenedesk-owner/config.json \
  --credentials /secure/scenedesk-owner/session.json \
  --record /secure/scenedesk-owner/request.json \
  --select-existing 00000000-0000-4000-8000-000000000000
```

替换为真实工作室 ID；此命令只 GET 核对 tenant.ownerUserId 等于当前用户，并要求该用户 membership 为 active owner。仅有成员访问权、同名空间、旧成功回包或列表可见均不足以选用。它不会转移所有权。

## 3. 未知结果与保留记录

每次允许的首次发送都先将 actor、origin、原输入、随机幂等 key 和 `unknown` 状态写入 `request.json`，完成文件 fsync、原子 rename 和目录 fsync 后才发送唯一 POST。session token 和 CSRF 不进入请求记录、报告或终端；每次运行重新读取可信 session/CSRF，同一用户续期会话可继续核对，换 origin 或用户会拒绝。

createTenant 没有内容 CAS，服务幂等回包的保留期为 24 小时。即使客户端自认为还在期限内，网络延迟也可能让重放到达已过期的服务端；因此**任何未知发送均永不重发 POST**。超时、代理 4xx、无效回包、201 后本机结果持久化失败、发送前进程退出等均保留原请求，不自动换 key，也没有显式重发开关。重复 `--apply` 只读核对，返回 `original_request_unknown_no_resend`（exit 1）。

未知时可按上节显式 `--select-existing` 选择当前拥有的空间继续试用，报告状态是 `owner_selected_original_request_unknown`，`originalReceiptProven=false`，原请求保持 unknown；这只证明该空间现在可由本人使用，**不证明它是原请求结果**，也不允许该记录再次创建。不能按名称猜测成功、删除原记录后换路径重建，或在 24 小时后重新开始同一意图。没有原回包的创建结果归属仍需人工调查，当前接口没有提供永久结果查询。

仅当前 API 能明确证明发生在业务写入前的结构化拒绝（匹配 Error 合同和非空 requestId 的 INVALID_REQUEST / ORIGIN_REJECTED / CSRF_REJECTED / UNAUTHENTICATED 对应状态）会保存 `rejected`。此后可保留历史并修改输入，再显式 apply。通用 FORBIDDEN、幂等冲突、代理自定义/结构化 4xx、5xx 不被判作可重新创建的拒绝。

崩溃可能留下 `request.json.lock`。先人工核实原进程已经停止，仅移除该锁，保留原 request/review 文件，再执行默认核对；不得通过移除记录绕过 unknown。遗失记录意味着原请求身份遗失，不能由脚本安全重建。私有 JSON 的读写和 API 单个回包均限制 256 KiB；超限会明确失败，API 流会取消读取，不写出下次无法读取的大记录。

## 4. 验证与边界

- `npm run check`：合同生成一致性、UI 规范、TypeScript/生产构建及原有 93/93 测试通过。未改产品页面，因此未重新运行无关画布容量或媒体完整套件。
- `sh deploy/check.sh`：operator 纳入部署专属 TypeScript 检查，配置/文件/流式限制共 7/7 通过。验证 0700/0600、独占锁、规范化/符号父目录别名、拒绝覆盖大文件及不安全 origin。
- `node --import tsx --test --test-concurrency=1 deploy/integration/owner-bootstrap.test.ts`：独立 PostgreSQL 16 数据库，真实迁移/受限 API 与 auth 角色，6/6 通过。覆盖默认零 POST、显式一次创建、同用户会话续期、真实提交后响应丢失、回执过期仍零重发、当前 owner 选用、换 actor/origin 拒绝、真实邀请得到 member 后不得冒充 owner、已知前置拒绝与结构化代理 403 区别。
- 同一专项运行实际 CLI 子进程，通过临时本地 HTTPS 端口和受信任临时证书调用真实 Fastify/API/数据库；未禁用 TLS 校验。核对仅显式 apply 发一次 POST、重复调用不再创建、路径别名在发请求前拒绝且凭据内容未变、stdout/stderr 不泄露会话及身份内容。
- 测试身份只通过测试中的 `issueSession` 和明确测试 issuer 建立；不是外部真实 OIDC 登录验收。临时数据库、schema/角色、HTTPS 服务和私有测试目录已清理，没有启动或修改共享根部服务，没有媒体解码或付费模型调用。
- 文档检查通过：152 operations / 118 paths / 225 schemas / 157 examples；报告写入本 worktree 的全新 `output/owner-bootstrap-validation-final-20260912/`，不覆盖历史报告或提交完整清单。以上结果在 Apple Silicon/macOS、Node 22.22.2/npm 10.9.7 上获得；大小写不敏感文件别名的 CLI 负例在本机实际执行，Linux 按文件系统是否存在别名有条件核对。

新增测试由现有 deployment CI 的 `deploy/tests/*.test.ts` 与 `deploy/integration/*.test.ts` 自动纳入，无需修改既有 workflow。工作室内项目/内容/画布和 AI 能力仍按 22/38 的状态验收；此入口仅补首位 owner 的操作步骤，不能把真实身份、模型执行或外部部署缺口算作已完成。

## 5. 主任务整合

源切片 `f3c1d6e` 已由主任务整合到已合入音频及创作恢复的 main `d161c0c`，没有改写已验证的operator源代码。主任务审查完整diff、状态边界、测试与操作步骤，后端agent独立只读审查无剩余阻断；路径别名/大小写、代理错误和大小上限的发现及修正已包含。本片对应GitHub PR的检查及合并状态以实际记录为准，不以独立分支93项检查代替组合版本CI。

2026-09-12 合入记录：精确提交 `78e9eb8814e2ced0cff5520c679627dafed7d2b6` 的 push/PR 标准CI（34632252968／34632262803）各99单元、202数据库、78媒体全部通过，零失败、取消或跳过；部署两组（34632252993／34632262943）各7配置/私有文件、12数据库与HTTPS检查、三个镜像及完整API/队列/真实浏览器smoke通过。根任务核对四份完整日志后，[PR #26](https://github.com/exo-gravity/scenedesk/pull/26) 于2026-09-11 18:28:18 UTC合入main，合并提交 `279d59c49aa70bcb76faf5b570a0aec87ac79ec5`。真实身份、模型与外部上线仍未验收。

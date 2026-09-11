# 47 私有创作工作台部署包

状态：本地部署包构建及隔离容器验收通过；未创建外部资源、域名或真实身份客户端，未调用付费模型。基线 `origin/main=c939900c4208cac75b0465f9a28e97682d66fac0`。本文落实 [20 的部署拓扑](20-external-validation-and-launch-plan.md#3-默认部署拓扑与容量落实)，范围按 [38 首发范围](38-first-release-scope-review.md) 收敛。

本文保留首片部署包及其验收历史。当前图片主线兼容、生成执行缺口、队列允许种类和独立 CI 由 [52 部署整合](52-private-deployment-integration.md) 更新：已有 enabled capability 不代表当前部署能执行，新任务在网关返回 `GENERATION_EXECUTOR_UNAVAILABLE`；原文件归档需要已持久化的 `generation_media_outputs` 事实。下文首片的“拒绝全部启用生成能力”与“仅导入队列”审计边界已被 52 的分类规则取代，历史证据不覆盖新行为。

52 同时修复了首片误拦截 `/design/openapi.json` 的问题：该公开契约是画布恢复的实际依赖，现已精确放行，其余原型路径仍关闭。下文首片的全部 `/design/` 404 记录只保留为历史证据，不再是当前配置。

## 1. 启动审计与实现边界

已有 `apps/api/src/main.ts` 明确拒绝非 local 环境并只允许 loopback 绑定；`apps/worker/src/main.ts` 同样只支持 local，还无条件要求制作产物桶与后期工作目录。直接给这些入口套镜像不能成为真实配置的部署包。

新增入口位于 `deploy/runtime/`，复用 `buildApp`、OIDC discovery、角色校验、MediaStore、createMediaProcessor、PgBoss 队列及 repairMediaWork；没有修改产品路由、页面、迁移 SQL、队列协议和已有开发工作流。API 绑定容器内部 4310，媒体 Worker 内部健康检查端口 4313；它们不直接发布宿主端口。Nginx 在 8443 终止 TLS，提供静态生产构建，并同源转发 `/v1/` 和 `/health/`，关闭 SSE 缓冲。静态资源长缓存，入口不缓存；`/design/` 不对外暴露。网关日志省略 URL/query/body，避免记录身份回调 code 或素材签名参数。

网关拒绝 cuts、cut-revisions、external-cuts、cut-normalizations 下的 POST/PUT/PATCH/DELETE，返回 `POST_PRODUCTION_DEFERRED`，保留已有 GET 读取和一般素材访问权限路径。剧目 `production` 仍属于创作业务，未禁止。首发首页与导航沿用主线的私有入口；没有重新做视觉设计。

镜像使用仓库 lockfile、Node 22、npm 10，构建时执行现有类型检查/生产前端构建及新增部署配置测试。服务使用非 root 用户、只读根文件系统、明确 tmpfs/媒体临时目录；运行镜像保留 TS workspace 和 tsx 所需依赖，尚未做最小运行依赖裁剪。没有修改既有 CI，本包额外检查需显式运行或由后续 CI 切片接入。

## 2. 配置与凭据入口

所有运行时配置从 `SCENEDESK_CONFIG_FILE` 指向的 JSON 文件读取，默认 `/run/secrets/config.json`。Compose secret 是宿主文件的只读挂载，**不是云密钥管理服务**；秘密应由选定地区的密钥系统写到受控目录，不能提交仓库。宿主目录权限应为 0700；挂载文件需能被对应容器 UID 读取（API/Worker 为 1000、网关为 101），可用相应 owner/group 的 0400/0440。TLS 私钥只给网关，迁移凭据只给一次性的 provision/audit 进程。

| 入口 | 必需配置 | 明确拒绝 |
|---|---|---|
| API | HTTPS origin；API 与 auth 的独立 PostgreSQL URL；32 随机字节编码为 base64url 的 appSecret；HTTPS OIDC issuer/client；API 私有素材桶凭据 | 本地 HTTP issuer、fixture-client、未知字段、相同 DB 角色、跨 DB 目标、开发 dotenv/环境中的管理或共享凭据、关闭 TLS 校验 |
| 媒体 Worker | media 与 scheduler 的独立 DB URL；Worker 素材凭据；独占受支持队列和专用 decoder host 的配置确认 | API/auth/管理秘密；不明确的队列共用；未配置 decoder host/TMPDIR；后期/生成等不支持的未结队列提示 |
| provision/audit | 独立迁移 URL、预先创建的 API/auth/media/scheduler/NOLOGIN 授权 owner 名称 | 自动把管理账号用作服务身份；缺失角色；隐式迁移 |

数据库 URL 强制 `sslmode=verify-full`，不接受关闭验证或其他会覆盖 TLS 的 URL 参数。私有 CA 可以通过只读 CA 文件与 `NODE_EXTRA_CA_CERTS` 配置；不能使用 `NODE_TLS_REJECT_UNAUTHORIZED=0`。应用 origin、OIDC 和自定义对象存储 endpoint 都要求 HTTPS。API/worker 对象存储身份应按 `mediaStoragePolicy(bucket,'api'/'worker')` 分配不同权限，不得共享 root/key。

对象桶需要版本控制，API/worker 启动检查会验证。浏览器直接上传/读取私有对象，存储 endpoint 必须被浏览器实际访问，CORS 只允许工作台 origin，并按真实存储服务配置请求/暴露头（包括对象版本相关头）；不能把容器内部 DNS 地址当作正式浏览器 endpoint。TLS、DNS、CORS 和真实上传下载仍需部署环境联合验收。媒体 Worker 的健康检查不证明浏览器 CORS 正确。

## 3. 可执行部署步骤

1. 在明确授权的地区准备 HTTPS 域名/证书、一个受限 OIDC 客户端、PostgreSQL、版本化私有对象存储和专用媒体解码宿主。OIDC 回调精确为 `https://你的工作台/v1/auth/callback`，返回 email/email_verified；由身份服务限制能使用此客户端的私有用户。现有服务仍会为成功 OIDC 身份建立用户记录，不能把 UI 隐藏注册入口等同于公共身份准入控制。
2. 数据库管理员预建四个 `LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB` 服务角色及一个 `NOLOGIN NOINHERIT NOSUPERUSER BYPASSRLS NOCREATEROLE NOCREATEDB` 授权函数 owner。各自密码只进入对应秘密文件。按 `deploy/examples/` 填好 API、Worker、provision JSON；示例带占位符或 false 条件，不能原样运行。
3. 从仓库根目录构建三个镜像（见 `deploy/README.md`）。停止该数据库/队列的旧生产者和消费者；确认兼容范围、备份及恢复方案。用一次性管理配置运行 `deploy/runtime/provision.ts --apply`，它复用已有 checksum 迁移和显式 grant；没有编辑已应用迁移。重复运行会保留已应用记录并重新授权，但修改 worker/scheduler 名称会变更注册运行身份，因此必须在停工窗口执行。初始化不是整库原子事务，失败时按阶段排查并重跑原配置，不能删除历史 migration 来绕过失败。
4. 在服务启动前用同一管理配置运行只读 `deploy/runtime/audit.ts`。它检查所有未结后期业务记录、未结不支持队列提示、已启用生成能力及未结生成任务；本基线未打包生成执行进程，存在 enabled generation capability 或未结生成任务时会明确拒绝审计通过，不能用关闭能力掩盖未决提交。满足条件的现有数据库可以使用，无须清空或重建。审计结束后移走管理凭据。
5. 用对应秘密文件运行 `api.ts --check` 和 `media-worker.ts --check`；API 检查 OIDC discovery、存储版本化、队列生产权限、API/auth 角色；Worker 检查受支持队列、媒体身份、存储、专用 daemon 中的精确 FFprobe 构建。检查不把任何模型能力自动启用。
6. 设置下方仅含文件路径/监听信息的变量后启动 Compose。默认只绑定宿主 loopback；确定网络边界后才设置实际 bind address。媒体 profile 是导入可用的必要部分。默认不自动重启失败服务，避免错误配置在后台循环消费；排障后显式重启。

```sh
export SCENEDESK_API_CONFIG=/secure/scenedesk/api.json
export SCENEDESK_WORKER_CONFIG=/secure/scenedesk/worker.json
export SCENEDESK_TLS_CERTIFICATE=/secure/scenedesk/tls.crt
export SCENEDESK_TLS_PRIVATE_KEY=/secure/scenedesk/tls.key
export SCENEDESK_MEDIA_DIRECTORY=/var/lib/scenedesk-media
export SCENEDESK_DECODER_SOCKET=/run/scenedesk-decoder/docker.sock
export SCENEDESK_DECODER_GID=0
# 必须在专用 decoder 宿主，预建目录并给予 UID 1000 写入权限。
docker compose -f deploy/compose.yaml config --quiet
# 一次性迁移/审计服务只挂载管理文件，运行时服务不挂载该秘密。
export SCENEDESK_PROVISION_CONFIG=/secure/scenedesk/provision.json
docker compose -f deploy/compose.yaml --profile operations run --rm --no-deps operations \
  node --import tsx deploy/runtime/provision.ts --apply
docker compose -f deploy/compose.yaml --profile operations run --rm --no-deps operations \
  node --import tsx deploy/runtime/audit.ts
unset SCENEDESK_PROVISION_CONFIG
docker compose -f deploy/compose.yaml run --rm --no-deps api \
  node --import tsx deploy/runtime/api.ts --check
docker compose -f deploy/compose.yaml --profile media run --rm --no-deps media-worker \
  node --import tsx deploy/runtime/media-worker.ts --check
docker compose -f deploy/compose.yaml --profile media up -d --wait
```

新数据库的首位真实 owner 和工作室仍需通过既有受权业务入口完成引导；本片未增加公共注册页面或绕过领域规则的直接数据种子。真实身份首登、邀请接入、成员撤销、首位 owner 引导都属于外部试点前待验收项；不能因 health 200 就邀请用户认为上线完成。

后续 [55 首位 owner 引导](55-private-owner-bootstrap.md) 已补私有操作者命令及实际 API/受控身份验证，复用 authenticated createTenant：默认只读，显式 apply，未知发送后永不重放，并允许只读核对后明确选用现有 owner 工作室。该命令提供可执行步骤，没有完成外部真实身份验收，也没有恢复公共注册 UI。

## 4. 媒体解码与队列边界

FFprobe/FFmpeg 镜像固定为 `mwader/static-ffmpeg@sha256:54e55b0cb8f672870fc38ceb2e6c411855cb3b39c505f5f3b2505ee01ed5f2b7`，须由操作者提前装到专用 daemon。已有处理器仍使用 `--pull never`、`--network none`、非 root、只读根、资源限制和单个输入文件挂载；Worker 协调器承担授权存储读写。宿主与 Worker 中 TMPDIR 必须是同一个绝对路径，且专用 daemon 能看到相同文件。导入媒体不需要 production bucket 或后期工作目录。

Docker socket 的只读挂载不限制 Docker API 权限；持有它相当于控制该 decoder 宿主。不得把用户日常电脑或运行其他生产系统的共用 Docker socket 当作已隔离宿主。Compose 强制显式提供专用 daemon socket 的绝对路径，没有默认宿主 Docker socket；`dedicatedDecoderHost` 的配置声明不能代替实际隔离。Compose 提供现有处理器可实际使用的本机 socket 入口；远程专用 daemon 的 TLS 接入、共享路径编排、宿主逃逸防护和正式资源隔离尚未验收。

现有 PgBoss 12.30.0 的 media-probe 队列共用 media_probe/media_derivative/media_production，不能按 taskKind 原子过滤消费。本包只启动导入与预览处理器，启动前只读拒绝不支持的未结提示，且只修复导入媒体工作。只读管理员 audit 额外覆盖当前 scan 尚不会返回的 leased 后期业务记录。运行实例、外部维护脚本和原 API 都必须停止后期生产，不能靠启动时的一次检查证明未来不会混入。

如果运行中仍混入不支持种类，Worker 报诊断并停止。新kind/损坏envelope会在通用wrapper内提前拒绝，部署入口的onError同样停止消费；已识别但延后的media_production也经此边界停机。通用 queue wrapper 会把当前队列尝试记为失败，随后保留重试语义；**这不是“队列完全不变”**。部署入口不会调用后期业务处理器，但该情况必须检查队列与业务事实后恢复，不能让 supervisor 反复重启。默认 Compose restart=no。网关限制只是当前首发边界，不能约束绕过网关的其他生产者。

已与生成后端切片核对：计划中的 media_generation 由同一 createMediaProcessor/repairMediaWork 处理，沿用媒体池/对象凭据，并新增受限函数权限；生成执行仍需独立受限池。本提交基线未包含该实现，因此没有把未交付 kind 自动放入允许清单。后续接入须同时合入对应实现、grants、入口允许种类、只读审计条件和独立生成执行入口，并重跑本包 smoke；不需要另建在线队列或另一种部署拓扑。

## 5. 故障定位

日志只输出固定 stage/code，不打印驱动堆栈、连接串、storage grant 或认证回调参数。

| stage/code | 下一步检查 |
|---|---|
| configuration / CONFIG_* | JSON字段、32字节base64url秘密、独立角色、HTTPS及verify-full；不要加载本地.env文件 |
| oidc_discovery | 容器能否解析/连接issuer；证书链、客户端及发现元数据；测试替身没有登录能力 |
| private_storage | endpoint/region、证书、桶版本控制及API身份的GetBucketVersioning权限 |
| queue_producer_role / business_database_roles | 迁移后是否重做显式grant；是否错用了管理、媒体或auth连接 |
| temporary_directory | 宿主目录已存在、UID1000可写且与容器/daemon路径相同 |
| MEDIA_SANDBOX_UNAVAILABLE | Docker CLI/daemon、socket权限、精确镜像digest和宿主cgroup能力；不能通过放开网络或取消沙箱限制规避 |
| QUEUE_CONTAINS_UNSUPPORTED_WORK / PENDING_POST_PRODUCTION_* | 停止不兼容生产者，核对后期业务与队列事实；本包不会自动清队列或删数据 |
| GENERATION_EXECUTOR_NOT_PACKAGED | 先完成对应生成执行入口集成；本片不把已启用能力自动降级或删除 |

## 6. 本地证据

已完成生产镜像构建、`npm run check`（60项通过）、部署配置边界测试（4项通过）和文档检查（152 operations / 118 paths / 225 schemas / 157 examples）。新增部署入口单独由 `tsc -p deploy/tsconfig.json` 检查；它不在原根目录 tsconfig include 中。

本地首次容器联调已通过独立 PostgreSQL TLS、28条迁移与角色授权、只读业务/队列审计、只提供发现文档的HTTPS身份测试替身、私有版本桶/分离存储身份、API依赖检查和隔离daemon的FFprobe 9.0.1检查。API与媒体Worker均实际进入healthy，同源 `/health/ready` 返回 `businessReady=true, completeMvp=false`。

静态生产站在1365×900和375×812实际渲染；窄屏document scrollWidth=375，无横向溢出，登录入口及导入/模型状态显示正确。浏览器仅对本次临时自签证书使用ignoreHTTPSErrors；HTTPS链路另用curl加本次CA进行完整证书验证。未登录浏览器仅记录预期的session 401，没有资产加载失败。截图：[桌面](../../deploy/smoke/evidence/login-desktop.png)、[窄屏](../../deploy/smoke/evidence/login-mobile.png)。身份替身无法登录或签发令牌，截图不构成真实身份验收。

首次联调定位并修复了四项包装缺陷：Compose tmpfs列表需引用带逗号的完整字符串；appSecret需精确32字节base64url；Docker save/load不会保留这里所需的可寻址manifest digest，改为在专用daemon预取固定digest；DinD须使用官方入口完成cgroup v2 nesting，直接启动dockerd会导致原沙箱的resource配置失败。未通过放松媒体无网络/只读/资源限制绕过问题。

2026-09-12 清醒窗口的最终完整 `bash deploy/smoke/run.sh` 返回成功（exit 0）。使用独立 Compose 项目完成上述依赖初始化，并验证 HTTPS静态页200、同源业务ready、未登录业务401、OIDC安全cookie/302跳转、设计原型404、后期新写入503。运行中注入未知 `future_kind` 后 Worker 以exit 1停止，队列为 `retry:0`：首次失败已记录，尚未发生第二次领取。随后启动前检查拒绝后期任务，记录在检查前后均为 `created:0`。这两条路径的业务含义不同，证据没有将运行时失败称作只读。

该轮的容器、命名卷和网络已全部移除，并再次按该项目标签查询确认无剩余容器和卷。最终预审另收紧了重复 `sslmode` 参数的配置拒绝；该变更通过4项配置边界测试及最终镜像内类型/配置检查，未重复执行媒体流程。专用 decoder socket 缺失的 Compose 检查也实际返回明确错误。可审计的脱敏结果及构建/日志哈希：[verification.json](../../deploy/smoke/evidence/verification.json)。

主任务查明宿主从2026-09-11 21:16:58睡眠，直到2026-09-12 00:09:36 FullWake；此前失败/运行日志保留在本worktree的`.runtime/deploy-*`，不将跨睡眠耗时记作性能指标。最终运行期间仅用 `caffeinate -i` 防止该命令的空闲睡眠，没有更改系统电源配置。环境为Apple Silicon arm64、Docker28.5.1/Compose2.40.0、镜像Node22.23.2/npm10.9.8；共享开发环境，不是独占生产基准。

## 7. 仍未放行的条件

- 真实部署地区、服务账号、域名/证书、OIDC 用户准入与回调、存储 CORS、首位 owner 引导及端到端真实登录。
- 真实模型服务/账号/模式、凭据、金额上限和供应商验收；本包不会主动创建任何付费请求。生成执行/归档入口必须与后续主线能力一同验收，不能把手动导入包称作完整 AI MVP。
- 私有环境的备份/恢复、RPO/RTO、密钥轮换、监控报警、SSE 恢复、并发部署与正式 decoder 宿主隔离；健康检查只报告其注明的依赖范围。
- 与后续主线提交的集成及 GitHub CI/merge 由主任务独立完成，本切片不自行推送或合并。

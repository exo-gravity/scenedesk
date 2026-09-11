# 52 私有部署包与图片主线整合

状态：整合验证中。基于图片主线 `f3b7433f036261db8e36b01249fee5e242ed3886` 与首片部署提交 `a09cf873ba4ebb7528f71844ec9007cebdf164e9`。当前交付是可检查的阶段部署包，不代表真实 AI、身份接入或外部部署已完成。

## 1. 已交付能力与生成执行边界

静态 Web、同源 HTTPS API、独立媒体 worker、迁移入口和只读审计继续使用 [47 的配置及凭据隔离](47-private-deployment-package.md)。没有新增生成执行进程，未把只允许 `APP_ENV=local` 的 `apps/worker/src/generation.ts` fixture 入口移除限制或包装成真实模型。

不能以空 adapters 启动 `createAssistanceWorker` 作为占位：现有处理器会持久记录缺失适配器的拒绝，改变已排队任务。本包不启动它，不领取 generation work，也不更改已有 capability、plan、attempt、receipt 或 job 来通过部署检查。

网关对精确的 `POST /v1/tenants/{tenantId}/generation-jobs` 返回 `503 GENERATION_EXECUTOR_UNAVAILABLE` 和保留计划的提示。计划准备、任务历史读取、明确取消及原文件 `recover-archive` 路径继续进入原授权 API。这个限制也包含复用原任务身份的重复 execute 请求；恢复已有任务请走查询/历史路径。API 容器不发布宿主端口，不能绕过网关运行其他生成生产者。已有 capability 的 `enabled=true` 只保留领域配置事实，**不代表本部署有可运行的执行器**。

后期 cuts、cut-revisions、external-cuts、cut-normalizations 的新写入仍返回 `POST_PRODUCTION_DEFERRED`，设计原型入口仍返回 404。未加入团队、公共注册、运营或备份功能。

本次复审修复了首片遗漏的运行依赖：画布及编辑恢复的 `browserContractCompiler` 会读取 `/design/openapi.json`，首片把整个 `/design/` 返回 404 会阻断编辑规则加载，未登录页面截图未覆盖这一问题。现在只精确放行该公开契约到原 API，其余 `/design/` 路径仍关闭。容器 smoke 检查 HTTPS GET/HEAD 200 与 JSON类型、契约与当前构建的字节哈希相同，并在真实 headless Chrome 中使用原 `browserContractCompiler` 读取同源契约并验证画布文档；这不替代真实身份下的完整画布交互验收。

## 2. 已收到的媒体沿原队列归档

已合入的 [单图链路](44-image-generation-runtime.md) 在持久回执完成后，把 `generation_media_outputs`、待处理 Media、job archiving 与 `media_generation` 提示原子写入数据库。本部署消费这一已有归档事实；不会产生供应商请求。

统一队列允许清单包含 `media_probe`、`media_derivative`、`media_generation`，启动前检查、部署审计和消费者使用同一清单。`createMediaProcessor` 已有 generated-media 分派；`repairMediaWork(includeProduction:false)` 已扫描 `scan_generated_media`，不再把这类合法图片提示误判为后期任务。不支持或损坏的种类继续按 47 的规则拒绝启动或停止当前消费者，保留其真实队列失败语义。

为保持首片配置兼容，Worker JSON 沿用 `exclusiveImportQueue:true` 字段；其当前约束是同一队列只有上述已支持媒体种类，且没有绕过网关的新生成或后期生产者。字段名称和显式声明都不能代替实际进程隔离。

一次性 provision 仍调用当前主线 `grantMediaWorkerAccess`，没有复制或改写授权 SQL：媒体角色可调用 `claim_generated_media` 和 `finish_generated_media`，scheduler 可调用 `scan_generated_media`；媒体角色不能调用 `claim_generation_job`。新增 smoke 实际查询这些授权，并投递不存在业务身份的合法 `media_generation` 提示，验证受限处理器按过期提示完成。该检查证明路由和权限，不代表真实图像解码验收；真实文件验证仍由主线媒体测试承担。

与视频/音频后端已核对，后续仍使用同一 kind、状态和修复协议。视频的多个 derivative envelope 由其对应主线处理器在同一事务中调度，部署入口不解析或复写它。后续整合须应用新增 migration 并重做现有受限授权；本片基线不提前宣称视频/音频归档已验收。

## 3. 严格部署审计不会清理任务

审计在只读事务中输出数量和执行器不可用状态，不输出身份、私有对象位置或秘密。

| 现有事实 | 审计结果 |
|---|---|
| enabled capability，当前没有未结执行工作 | 记录能力数；允许部署检查继续，但新生成仍被网关拒绝 |
| archiving / archive_failed，并有同 tenant/project/job 的固定 generation_media_outputs | 记录原文件归档数，允许按原归档协议继续或人工恢复 |
| archiving / archive_failed，但没有固定归档来源 | `GENERATION_ARCHIVE_SOURCE_MISSING`，exit 1 |
| queued / dispatching / submission_unknown / reconciliation_required 或其他非终态 | `GENERATION_EXECUTOR_UNAVAILABLE`，exit 1；不消费、不降级、不重发 |
| 未完成的后期业务或不支持的队列提示 | 保持原明确诊断，exit 1 |

已有固定来源只证明可以进入归档处理，不证明文件验证已成功；`archive_failed` 的可恢复性仍由原任务/来源状态判断。未知提交即使另有已保存媒体，也不能用归档数掩盖冲突与对账义务。读取历史所需的 API 可以单独启动排查，但严格部署审计失败不能被称为整体验收通过。

真实生成执行的下一步需要确定服务/地区、固定连接版本、权限隔离的执行进程、真实 transport/回执恢复和支出授权，之后再解除网关提交限制并共同验收。当前没有额外 runner 配置，也没有可用真实 provider 的声明。

## 4. 独立 CI 与本地检查

新增 `.github/workflows/deployment.yml`，不改既有业务工作流。它使用仓库锁文件与已有固定版本的 checkout/setup-node actions，单独执行：

1. `npm ci` 后运行 `sh deploy/check.sh`，检查 deploy 专属 TypeScript 入口并执行四项配置边界测试。
2. 在独立 PostgreSQL 测试库串行运行 `node --import tsx --test --test-concurrency=1 deploy/integration/*.test.ts`，验证 enabled capability 保留、queued/unknown 未改变、固定来源归档与缺失来源失败。夹具明确是关系状态验证，无真实模型或文件成功声明。
3. 顺序构建 api、web、media-worker 三个镜像；镜像内部同样运行部署检查，并复用原生产构建。工作流没有 registry 推送、外部部署或真实凭据。
4. 以本次构建的 `ci` 镜像运行本片 API/queue/browser-contract smoke。Chrome/Chromium 缺失时明确失败，可用 `SCENEDESK_SMOKE_CHROME` 指定已安装的可执行文件；不悄悄跳过浏览器检查。

本地完整检查继续使用仓库 `npm run check`。部署容器 smoke 在独立项目运行，仍采用真实 PostgreSQL TLS、私有版本桶、分离身份和专用 decoder daemon；身份替身仅支持 discovery。本轮新增验证生成提交 503、计划与归档恢复仍到达授权层、生成媒体授权与合法过期提示消费。不重复运行完整后期/媒体套件，也不把该检查称为图片质量或真实模型验收。

浏览器证明页只挂在 smoke override 的 `__smoke` 目录，不进入生产 Web 镜像。它用仓库已有的 esbuild 编译原前端模块；headless Chrome 使用独立临时 profile，测试证书仅在该浏览器进程忽略，curl 的 GET/HEAD 仍正常验证临时 CA。浏览器的 CI 启动参数不改变媒体 decoder 的无网络/非 root/只读隔离。Linux runner 上媒体临时目录使用 1777 和私有 0700 父目录以兼容 UID 1000，正式部署目录仍按 47 的明确 owner/group 设置，不被测试脚本改动。

Smoke 只向 CI 输出固定阶段名与退出码，原始日志、临时配置和浏览器 profile 留在本机私有运行目录，不作为 artifact 上传。真实 Chrome 的已序列化 DOM 必须包含成功后的结果元素；脚本源码里单独出现成功字符串不算通过。运行器在断言出现后关闭自己启动的浏览器，60 秒内没有断言则明确失败；浏览器关闭也有强制终止边界，避免后台服务退出拖延阻塞剩余检查。

## 5. 本片验证记录

首个整合候选已通过 `npm run check` 82 项、部署专属类型和4项配置测试、独立真实 PostgreSQL 审计6项（一个父用例与5个场景）。数据库测试容器及其临时数据已清理；只验证关系事实，不声称生成文件解码或模型质量通过。

当前 head 的镜像构建及本轮新的 API/queue/browser-contract smoke 尚待完成，GitHub 独立工作流也待主任务推送执行，不能引用首片旧镜像或未登录截图作为当前 head 通过的证据。镜像源基线、已完成与待完成结果记录在 [整合验证清单](../../deploy/smoke/evidence/integration-verification.json)；后续以独立证据提交补齐。原首片证据仍保留在 `deploy/smoke/evidence/verification.json`，不会覆盖。

2026-09-12，PR 23 的首次部署工作流 `34626832293` 已通过部署类型、配置、数据库审计和三个镜像构建，但 smoke 在任何容器启动之前失败：全新 checkout 没有 `.runtime` 父目录，`prepare.ts` 创建运行目录时报 `ENOENT`。修复只为父目录添加 `recursive:true` 和 `0700` 权限；最终运行目录仍排他创建。已用没有 `.runtime` 的全新临时目录实际运行 prepare：父目录与运行目录均为 `0700`，再次运行报 `EEXIST`，已有配置字节不变。该验证不代表后续容器 smoke 已通过；首次 CI 失败记录保留。

本地 `bf5246f` 三镜像已构建成功，容器 smoke 的 API、真实 Chrome compiler、生成媒体权限、过期归档提示和混队列拒绝断言均通过，资源清理完成。但 Chrome 写出成功 DOM 后没有及时退出，本轮曾人工关闭该独立浏览器再继续，不能把它作为完全自动化验收。新增浏览器生命周期管理及阶段诊断后，将另行记录无人干预的完整结果；已验证“成功 DOM 后终止浏览器”“只有脚本字符串时拒绝”“异常退出时拒绝”和 prepare 失败的固定阶段/退出码输出。

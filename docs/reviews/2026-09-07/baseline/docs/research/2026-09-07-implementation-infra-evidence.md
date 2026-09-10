# 落地基础设施约束核查：数据库、异步生成、媒体与事件

核查日期：2026-09-07。范围：为 AI 短剧工作台的设计文档提供一手技术依据；未部署、未执行真实模型请求、未上传生产媒体。

本报告区分「官方事实」与「设计推论」。PostgreSQL 以 **18 版文档**为核查基线；AWS 以 **Amazon S3 general purpose bucket** 文档为基线，不据此承诺其他 S3 兼容存储的相同行为；FFmpeg 文档随项目更新，实施时必须锁定实际构建及编码器；SSE 以 WHATWG Living Standard 为准。

## 1. 可直接进入技术规格的结论

| 范围 | 需要写入规格的约束 | 不能作出的承诺 |
|---|---|---|
| 租户隔离 | 普通运行角色、显式租户事务、关系约束、项目权限 | 启用 RLS 就自动解决所有权限问题 |
| 任务与费用 | 原子落库、领取租约、幂等消费、未知结果核对 | outbox／队列保证供应商收费调用 exactly-once |
| 媒体上传 | 私有对象、短时签名、服务器验收、不可变素材版本 | 浏览器上传成功即成为可采用素材 |
| 剪辑导出 | 固定时间模型、统一输出规格、音视频一起验证 | 任意输入都可无损且逐帧精确拼接 |
| 进度更新 | 权限内事件、游标回放或快照重置、幂等刷新 | SSE 自动保证不丢状态、只收到一次 |

## 2. PostgreSQL：RLS 的边界与租户上下文

**官方事实。** 启用行安全后，无适用策略时默认为拒绝；表所有者通常绕过 RLS，`FORCE ROW LEVEL SECURITY` 可使所有者受策略约束；超级用户及 `BYPASSRLS` 角色仍绕过。`TRUNCATE`、`REFERENCES` 不受行策略约束，唯一／外键完整性检查也会绕过行策略。策略可区分可读取行与可写入行。[Row Security Policies](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)

**设计推论。**

- migration／表所有者角色与 API／worker 运行角色分离；运行角色不能获得 owner、superuser、BYPASSRLS、DDL 或不必要的整表权限。
- 应用先验证工作室成员和项目权限，再建立可信租户上下文。租户 ID 不能仅取自请求体或路径而不验证身份关系。
- 租户级 RLS 主要防止漏写租户过滤。项目参与、正式审片、共享库发布等业务授权仍有明确服务入口。
- 跨对象关联使用带租户范围的组合唯一键／外键或等价数据库约束，避免合法 ID 被串到另一租户；错误信息不泄露另一租户对象的存在。
- 全局任务调度只暴露必要领取信息。执行媒体读取、状态更新、费用核对时重新进入确定的租户上下文；不能为方便调度让全部 worker 绕过业务数据 RLS。

**官方事实。** `set_config(name, value, true)` 只在当前事务内生效；`false` 作用于会话。`current_setting(name, true)` 在设置不存在时返回空值。[Configuration Settings Functions](https://www.postgresql.org/docs/18/functions-admin.html#FUNCTIONS-ADMIN-SET)

**设计推论。** 租户上下文使用显式事务范围，设置与查询必须走同一连接／同一事务。不要在自动提交的独立语句里设置后，假设下一条语句仍有该上下文。连接池归还、错误回滚、后台批处理也须遵循这一约束。缺失或无效上下文应拒绝读取，不能退回全租户查询。自定义配置本身不是不可伪造身份凭证，不向用户或 Agent 开放任意 SQL。

## 3. 并发、领取租约与 outbox

**官方事实。** `SKIP LOCKED` 跳过立即无法获得行锁的数据，会形成不一致视图；官方明确其适合多个消费者访问队列式表。它只改变行锁等待行为，仍会正常取得必要表锁。[SELECT Locking Clause](https://www.postgresql.org/docs/18/sql-select.html#SQL-FOR-UPDATE-SHARE)

**设计推论。** 可以用短事务领取后台任务，不可用其跳过预算、采用或审批所需的冲突检查。领取时原子保存 `lease_owner`、`lease_until` 与领取代次；外部网络请求不放在持锁事务内。完成写回须校验领取代次，旧 worker 不得覆盖新 owner 的结果。租约超时只表示需要恢复处理，不能直接推断供应商从未收到请求。

**官方事实。** PostgreSQL 会检测死锁并中止其中一个事务；官方建议一致的锁顺序，必要时重试事务，并避免长时间持有事务。Repeatable Read／Serializable 可能出现序列化失败，需要从头重试完整事务。[Explicit Locking](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-DEADLOCKS)、[Transaction Isolation](https://www.postgresql.org/docs/18/transaction-iso.html)

**设计推论。** 工作室预算、项目预算、预占记录按固定顺序加锁并原子提交。选择候选、更新剪辑、创建审阅稿也定义聚合并发规则。数据库死锁／序列化重试限制次数并退避；用户基于旧版本的内容冲突不能被静默重试成覆盖。事务内只产生本地记录和待处理意图，不调用收费生成、发通知或复制大文件。

**官方事实。** Transactional outbox 解决业务数据库写入与发送事件之间的双写不一致；转发可能重复，消费者需幂等，且须明确顺序。[AWS Transactional Outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)

**设计推论：收费生成采用「可恢复、可核对」语义。**

1. 同一数据库事务建立固定输入的生成请求、预算预占、提交意图／outbox。
2. worker 先持久记录一次提交尝试及稳定的业务幂等键，再调用供应商。
3. 只有供应商明确支持幂等且经过验证时，才能依其规则重发；同一幂等键不能更换请求内容。
4. 请求超时、进程退出或回包丢失时，进入结果待核对状态。优先通过供应商任务 ID、幂等查询或其他官方机制恢复，不默认再次收费提交。
5. 成功回调、轮询和手工核对共用幂等更新入口，按任务与事件身份去重。
6. 供应商完成之后，归档失败只重试下载／归档。不得把整个生成重新提交作为默认恢复动作。

Outbox 可以从 PostgreSQL 内部任务表开始，不要求首版引入独立消息系统；是否扩展 broker 由吞吐、隔离和运维需求决定。以上是架构推论，不是数据库能提供跨供应商原子事务的官方承诺。

## 4. S3：签名 URL、上传验收与不可变性

### 4.1 签名只是临时访问能力

**官方事实。** 预签名 URL 是持有者可使用的 bearer token，权限受签发者约束。URL 到期受签名期限及临时凭据有效期影响；已开始的下载可继续跨过到期时间。SigV4 策略可进一步限制签名年龄。[Presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)

**设计推论。** 每次签发都验证实时成员／项目／对象权限；签名 URL 不写入持久业务记录或日志。业务中存对象身份和固定版本，使用时再签发。移除项目成员能阻止新签发，无法仅凭数据库撤权保证已签发 URL 立即失效。需要即时撤权的场景应选择受鉴权代理等独立方案，不能扩大预签名 URL 的语义。

### 4.2 上传限制与验收分层

**官方事实。** S3 POST policy 支持限定对象 key、内容类型等表单条件，`content-length-range` 支持上传大小范围。[POST Policy](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-HTTPPOSTConstructPolicy.html)

**设计推论。** PUT URL 与 POST policy 分别实现，不把 POST 的范围条件当成任意 PUT 已有能力。浏览器直传选型应确定「如何限制对象 key、大小、类型、数量、有效期」。较大视频若使用 multipart，后端负责完成会话验收，不能只依靠前端声明的分片列表或总大小。

**官方事实。** CORS 按 origin、method、headers 匹配；开启 CORS 后，对象 ACL／策略仍生效。[S3 CORS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html)

**设计推论。** 分别验证网页 origin、上传方法、校验和请求头，以及浏览器需读取的 ETag／校验和响应头暴露。CORS 成功不等于对象已授权，CORS 失败也不应被当成生成失败或重复创建上传会话。

**官方事实。** S3 可验证上传校验和；ETag 不是在所有上传、加密和 multipart 情况下都代表完整文件 MD5。[Checking Object Integrity](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html)

**设计推论。** 上传会话保存预期大小／类型／校验算法，完成入口根据存储实际对象核对，再探测媒体并生成代理。保留校验算法及值，不把任意 ETag 重命名为 `sha256` 或内容哈希。客户端提供的校验和只能校验传输一致性，不能证明内容安全或合规。

### 4.3 可重复上传与正式媒体版本

**官方事实。** S3 条件写可以用 `If-None-Match: *` 防止覆盖已有 key；`If-Match` 可对 ETag 作前置检查。条件不满足会失败，multipart 的并发冲突恢复与普通 PUT 不完全相同。[Conditional Writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)

**设计推论。** 一份可用媒体必须绑定不变的对象内容：可采用服务端验收后复制至用户不可再写的独立 key，或固定 VersionId 等经过验证的策略。仅随机 key 仍不足以阻止同一有效上传 URL 再次写入该 key。不要在尚可被替换的 staging key 上完成审片、采用或渲染。S3 条件写在其他存储上的支持需单独验证。

### 4.4 清理不应误删正式资产

**官方事实。** `AbortIncompleteMultipartUpload` 可清理超时未完成会话及分片；该动作不删除已完成对象。[Incomplete Multipart Lifecycle](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html)

**设计推论。** 分开处理：未完成 multipart、已上传未验收 staging、已登记未引用媒体、正式引用媒体、导出临时文件。生命周期不能替代业务引用检查。业务垃圾回收先标记并经过保留窗口，再复核引用后删除；归档成功而数据库提交失败的孤立对象须有核对恢复。保留时间属于待容量／恢复目标确定后的运营参数。

## 5. FFmpeg：时间模型与导出约束

**官方事实。** concat demuxer 要求各文件有相同流、codec 和 time base 等；输入时长错误会影响后续时间戳并产生异常。[Formats: concat](https://ffmpeg.org/ffmpeg-formats.html#concat-1)

**官方事实。** `trim`／`atrim` 不自行重置时间戳；需要时使用 `setpts`／`asetpts`。concat filter 要求各段从时间戳 0 开始，并处理一致的流参数；分辨率需显式转换。不同帧率可能产生 VFR；关联音视频宜一起拼接，较短音频可能被补静音。[Filters: trim / atrim / concat](https://ffmpeg.org/ffmpeg-filters.html#concat)

**官方事实。** `-ss` 在许多输入格式上先定位到目标之前的 seek point；转码且启用 accurate seek 时可解码丢弃前段，stream copy 则可能保留该前段。[ffmpeg: Main Options](https://ffmpeg.org/ffmpeg.html#Main-options)

**设计推论。**

- 内容区间以整数 tick／有理数表示，明确半开区间 `[in, out)`；保存源素材 time base、起始时间、时长、帧率属性和音轨信息。剪辑时间不以浮点累计。
- 项目输出采用明确 fps、有理 time base、分辨率、画幅适配方式、色彩和音频配置。输出预设不能继承供应商文件的偶然参数。
- 吸收 VFR、旋转信息、无声素材、非零起始时间等输入时先探测并建立可审阅代理；保持源文件与代理映射。
- 精确裁切／音量／混音／字幕等需要解码处理。不能把「导出」普遍实现成所有输入 `-c copy`。
- 审片稿、最终片与素材包清单均绑定固定剪辑版本；渲染开始后不跟随动态候选更新。
- 音轨长度、剪辑末端、静音补齐、混音增益、字幕时间和整体时长有显式规则；不能以 FFmpeg 退出码 0 作为成片质量验收。
- 外部回传 MP4 使用自己的时间码；只有实际交换工程格式包含映射时才据此恢复编辑关系。
- 执行以固定参数列表调用受控 FFmpeg 构建；媒体处理进程限制内存、CPU、运行时长和网络权限，不接受用户直接提交 filtergraph／shell 字符串。

## 6. SSE：通知、重连与访问范围

**官方事实。** EventSource 会在重连时发送之前收到的 `Last-Event-ID`；协议使用 `id`、`event`、`data` 等字段。原生构造器只有 URL 与 credentials 配置，没有任意请求头参数；`withCredentials: true` 使用 include credentials 模式。[WHATWG Server-sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html)

**设计推论。**

- 同源 session-cookie API 可复用会话；若采用 Bearer token，必须明确 fetch streaming 或其他方案，不能假设原生 EventSource 能配置 Authorization 头。
- 首次连接、重连与事件读取都检查当前租户和项目权限；现有长连接在成员撤销时关闭或及时重新验证。事件 payload 只含授权范围内所需字段。
- Last-Event-ID 是回放请求线索，服务端仍需持久事件／保留策略。游标过期、非法或范围变化时返回明确重置事件，客户端重新读取权威快照；不能静默从当前位置继续并漏掉状态。
- 事件幂等，以对象版本触发更新或刷新。SSE 断开不取消正在执行的生成；切页、断网也不丢失任务。
- SSE 仅推送进度与失效通知时，可保留轮询／重新聚焦刷新作为恢复路径。心跳、代理缓冲、负载均衡空闲超时在实际部署链路验证。

**序号的额外事实与推论。** PostgreSQL `nextval` 原子分配不同值，但回滚不会收回该值，序列不保证无空洞。[Sequence Functions](https://www.postgresql.org/docs/18/functions-sequence.html)

据此不能把自增 ID 分配顺序等同于事务提交顺序：事务 A 取得 10 后未提交，事务 B 取得 11 并先提交；消费者若推进到 11，随后提交的 10 会被 `id > 11` 漏掉。需要有明确的流排序方案，例如项目内事件计数器在同一行锁与业务事务下分配，并按序发送；或采用受控事件发布序列。无论采用哪种方式，事件流都不替代对象快照。

## 7. 文件探测与供应商结果下载

**官方事实。** OWASP 建议文件扩展名白名单、真实类型校验、服务端文件名、大小限制与隔离存储；不能信任客户端 Content-Type，单一文件签名检测也不足够。[File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

**设计推论。** 用户上传、供应商输出及外部剪辑回传均进入受限探测流程，验证可解码性、时长、尺寸、轨道及资源消耗；保持原始文件隔离，直到符合项目支持格式。剧本导入只接收首版明确支持的文本／文档格式，不因通用解析库存在而开放任意压缩包。

**官方事实。** OWASP SSRF 指引优先推荐已知目标白名单，说明重定向与 DNS 解析可绕过单次 URL 校验；云 metadata、localhost 和内部网络均属于需要保护的目标。[SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)

**设计推论。** MVP 不提供任意 URL 抓取。供应商结果下载只经验证的 adapter 接受已知官方输出域，限制 HTTPS、端口、解析地址、响应大小和时间；需要重定向时逐跳重新验证。网络出口同时阻止内部／metadata 地址，避免只依赖字符串前缀。FFmpeg 处理已归档本地输入，不自由访问素材内嵌的外部播放列表。

## 8. 实施前最小验证清单

这些是后续工程测试要求，本轮没有执行。

| 验证 | 必须观察的结果 |
|---|---|
| 租户上下文与连接池 | 无上下文拒绝、两租户交替不串读、回滚后不残留 |
| runtime 角色权限 | 不拥有表、不绕过 RLS、不能 DDL／TRUNCATE 业务表 |
| 并发预算 | 两人并发提交接近余额上限时，不出现非法双重预占或重复账目 |
| worker 恢复 | 领取后退出、供应商已收未回、回调重复、租约过期均有不同恢复路径 |
| 上传与存储 | URL 重放／超期、大小不符、校验失败、未完成 multipart、并发覆盖均被正确处理 |
| 不可变媒体 | 验收后再次写 staging 不改变已采用／已审媒体内容 |
| 媒体边界样例 | VFR、不同 fps／采样率、无音轨、非零起始、混合画幅和精确裁切符合输出规则 |
| SSE | 断线重连、重复事件、游标过期、并发提交乱序、权限撤回不会留下错误状态 |
| SSRF 与探测 | 重定向到私网、DNS 地址变化、超大／损坏文件不能越权读取或耗尽处理器 |

实施前锁定：数据库与连接池版本、云与存储产品、SDK／签名方式、FFmpeg 构建、浏览器与代理链路。以上选择未完成时，可据本报告设计接口与约束，但不能宣称已经通过生产验证。

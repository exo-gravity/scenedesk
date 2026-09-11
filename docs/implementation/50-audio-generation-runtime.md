# 单音频生成：固定声音来源与独立原音频

本片把已有图片、视频后端闭环扩展到单音频，继续使用原 `GenerationPlan`、`GenerationJob`、attempt、Media 和画布协议。唯一可执行模式为显式本地 `audio_fixture_v1`，执行标识为 `test_fixture`。技术适配器返回预先发布的测试音，不解释提示、不合成对白、不克隆声音，也不构成真实 AI 效果验收。默认迁移不创建或启用能力；已发布的 image、video 和提示目标能力身份保持不变。

## 原 API 与固定输入

`POST /v1/tenants/{tenantId}/generation-plans` 继续接受原 `PlanInput`，`POST /generation-jobs` 继续只接受 `{planId}`。音频输入须包含明确的固定镜头修订，或一个真实已保存的 audio draft；没有镜头的画布环境声草稿合法，不伪造对白或声音资产 ID。公开 DTO、OpenAPI 和生成器没有新增字段。

音频输出参数为必填的正整数 `durationSeconds` 和可选的原有 `seed`。时长必须位于 capability 的 min/maxDurationSeconds 范围，并遵守 7200 秒处理安全上限。音频拒绝 `resolution`、`aspectRatio` 和 `withAudio`，包括显式 false；不能把视频音轨开关解释为独立声音生成。显式本地配置仅支持两秒。

共享媒体 resolver 固定提示、模型能力修订、connection version、输出、明确选定的镜头和上下文、参考用途、顺序、subjectAssetId 与 assetRevisionId。画布沿原 prepare API、保存成功的 If-Match 和语义 fingerprint；移动、重命名、分组或停用边不改变生成输入。真实输入变化会在执行前阻断旧计划；执行后的画布变化不改写既有 job，读取仍如实返回 inputOutdated。`assistanceSource` 只保留固定建议修订的来源，不能代替实际输入或隐式采纳建议。

## 对白与声音资产

原 `resolvedInput.shots[].spec.dialogue` 保留选定修订的对白 ID、文字、characterAssetId 和显式 voiceAssetRevisionId。声音解析只沿已选固定定义扩展：

- 对白或 continuity state 明确包含 voiceAssetRevisionId 时，读取该真实声音修订，固定描述及参考媒体。
- continuity character 没有显式声音、相关对白也没有显式声音时，只有其明确的 lookAssetRevisionId 才能提供该固定角色修订的 defaultVoiceAssetRevisionId。单独 characterAssetId 不读取角色当前版本或最新默认声音。
- 明确选择的声音资产上下文、角色资产修订上下文或场次状态上下文，可扩展其固定声音依赖。未选场次、邻近节点、其他角色和最新资产不进入输入。

声音和角色描述放入已有 `contextSnapshots`，source.kind 为 asset_revision；来源及实际版本进入已有 dependencies。媒体仍放入 references，并固定声音用途和真实声音资产修订。参考数量、MIME、字节数和时长受 capability 的 inputRules 限制；额外参考及 overrides 继续通过原输入规则校验。本地音频能力只接受明确声音用途的音频参考。

服务端解析后，数据库还核对声音快照确实等于当前授权可读的固定资产定义、对白/状态显式声音有对应固定快照、标记了声音资产来源的参考确实属于该声音修订。发送前再次检查这些固定依赖的当前可用性；归档或撤销来源会阻止尚未提交的任务，不能自动换用新版本。任务结果不会自动绑定对白、建立 Take、候选或采用。

## 耐久回执与实际音频验证

原每计划唯一 job、每 job 唯一提交 attempt 不变。未知提交保留待核对状态，只能通过同一关联的证据恢复；归档失败重做不调用模型。内部音频完成回执使用仅含一个结果的 audios 集合，MIME 为 audio/wav，固定私有对象版本、字节数及 SHA-256。它不接收 URL、签名链接、任意文件路径或视频/图片回执集合。

回执通过原 generation_media_outputs、media_generation 队列提示和受限媒体 worker 归档。Media processing、来源及队列在原事务中衔接；队列失败保留耐久回执，重新归档不会重新 submit。固定对象下载、哈希和签名核对、受限完整解码及输出校验通过后，才能发布独立 immutable original，并事务性地令 Media ready、Job succeeded。

音频必须是有音轨、无视频尺寸和帧率的独立音频。保留实际 durationUs、audioSampleRate 和声道证据，不用请求值覆盖真实元数据。技术配置允许一采样以内的容器时间量化误差：

`abs(actualDurationUs - requestedSeconds × 1_000_000) × audioSampleRate ≤ 1_000_000`

JavaScript 使用 BigInt，数据库使用精确 NUMERIC 乘法；缺失或非正时间/采样率、超界时长和混入画面均拒绝。没有裁剪、补静音或重写时长操作。未来真实 provider 必须依据实际能力和服务约束验收，不能继承技术音的效果结论。

ready 音频仅建立独立 proxy 及队列提示，不创建 poster。代理走既有 AAC/audio-mp4 预览流程；失败不会覆盖原音频成功事实。原 `/media/{mediaId}/access` 继续按当前权限授予 ready proxy 或 ready original 的 inline 访问，内部对象 key/versionId 不对外返回。归档临时失败最多处理六次，随后通过原 recover-archive 明确重做同一来源、递增步骤使旧提示失效；输出不符等不可重试错误不能变成再次生成授权。迟到冲突回执继续进入 reconciliation_required 并保留先前验证结果。

## 画布历史和明确放置

audio draft 使用原 `POST /projects/{projectId}/scenes/{sceneId}/canvas/generation-plans`。原 canvas generation-plans 列表保留历史，来源节点删除后仍可取回固定计划和独立结果。原 `POST /projects/{projectId}/canvases/{canvasId}/results` 检查当前权限、If-Match、成功 job 的 canvas 来源和 ready Media 身份后，明确建立 kind=audio 节点。

原 unique(canvas, job, media) 保持唯一结果身份；删除结果节点后再次明确添加恢复原 nodeId。CAS 或网络失败沿原幂等恢复，不能重复生成。结果成功不会自动改写画布或镜头，不涉及剪辑、渲染或后期依赖。

## 迁移和本地身份

新增并冻结 0080–0086：固定媒体源、音频回执 guard、归档回执、实际采样校验、发送时授权、固定声音来源 guard，以及该 guard 的固定 search_path。未改动已应用的 0040–0046、0060–0064 或更早迁移。按原升级入口重授已有受限角色，队列、generation/media worker 身份和 repair 入口均保持兼容，不新增调度队列或凭据池。

`scripts/extend-local-audio-fixture.ts <tenant UUID>` 仅允许显式 APP_ENV=local、本地 drama_* 数据库及已注册的 generation/media/scheduler 身份。它发布新的不可变能力和 connection version，将技术 PCM WAV 固定源写入权限 0600 的 `.runtime/audio-fixture.json`；已有能力或 manifest 时拒绝覆盖。技术文件工厂目标为两秒、48 kHz、单声道、16 bit PCM、440 Hz 测试音，不生成语音或用户声音。

generation 进程只加载自己的受限环境，额外提供 `GENERATION_AUDIO_FIXTURE_FILE` 的私有绝对路径，可与原图片/视频 manifest 同时配置。原进程继续拒绝 API、迁移、媒体 worker 或 scheduler 凭据混装。部署默认不启用 fixture executor，不能把旧提示目标描述变成可执行模型。

## 验证边界

本次本地提交的证据见 `output/engineering/audio-generation-results.json`。完整 check 54 项通过（含构建、契约、UI 规则和单元测试）。数据库音频 7 项通过，覆盖固定输出参数、受限采样校验、原始对白与旧声音修订、角色身份不隐式取最新声音、固定角色默认声音、发送前归档来源取消、未知回执及队列失败恢复、画布删除来源后历史和明确放置。相关图片 10 项和视频 5 项也通过。

第一次相关数据库运行中，音频画布测试把既有 ensureCanvas 的成功 HTTP 200 错写成 201，导致该子项及父级失败，其余 20 项通过。修正测试预期后单独音频 7/7 通过。该失败不是业务成功证据，也没有因此修改产品行为或时限。

最小真实 WAV 验证 1/1 通过，耗时 24.33 秒：实际 PCM 原音频为 2,000,000 微秒、48 kHz、单声道、192,044 字节；独立 AAC proxy 为 2,021,333 微秒，原文件 hash/bytes 未改变。预览实际时长不覆盖原始采样时间。

完整对象存储音频归档测试已编写但本次未运行，待主线程独立 CI 和持续 API/worker 环境验证存储、任务恢复、全数据库及实际浏览器整合。数据库测试明确只提供关系数据证据，最小文件测试也不能代替完整存储归档验收。本次没有盲目重复重型测试或放宽产品时限。

真实模型的提交/查询/回调、安全原文件 transport、地区、账号、费用授权和实际创作效果均未验收。多结果、真实 prepare_rework 来源及完整声音创作业务仍需后续验证和实现；商业计费、运营、公开团队注册和后期制作继续后置。本工作树不推送、不合并、不修改主线程持续运行环境。

## 主线程整合验收（2026-09-12）

已在实际 4311 页面接通 API、受限 worker、数据库及对象存储，镜头与画布分别固定计划、执行并归档原音频；真实 202/201 回包丢失后恢复原任务和唯一结果，手工输入保留，删除来源后历史取回通过。最终整合 check 93/93，52 个迁移升级及重复应用通过。镜头验证脚本的选择器、视口与关闭按钮等待失败和后续只读恢复均保留；没有重新提交该生成。详见[实际整合证据](../../output/playwright/2026-09-12-audio-integrated/verification.md)。最终完整远端 CI 与 PR 合并仍待核对。

# 18 场次双模式与通用画布工程设计

交互同步（2026-09-10）：第 2 节已按[已确认核心体验 v0.3](../design/scene-walkthrough-review-v0.3.md)更新中央输入、非模态辅助栏和参考目标规则；[专项 v0.4](../design/production-detail-design-v0.4.md)暂时收口。技术收尾已补入有限历史和编辑者提示，正文与[21](21-technical-baseline-closure.md)共同适用；正式工程仍暂停。

日期：2026-09-09。状态：纳入实施包 v1.3 的设计基线，授权范围为补齐设计、契约、验证材料和工程准备。本文闭合此前新增画布后尚缺的数据、接口、保存和交互规则；真实业务路由、数据库迁移、多人隔离及性能仍按验收执行。字段以OpenAPI 1.3.0 为准，图像效果不作为像素或运行证据。

## 1. 业务边界与实现单位

一个场次包含多个镜头。分镜模式按镜头顺序组织，当前详情聚焦一个镜头；自由画布在同一个场次空间组织多个镜头、共同参考及未归镜头内容。第一版每场唯一一张画布，首次显式进入创建，之后只读取，不按镜头重建。

CanvasWorkspace 不依赖 Episode／Scene／Shot。它拥有画布身份、文档修订、节点、引用边、分组与生成来源快照；DramaPlanning 提供 scene_canvas_links 和 node_shot_bindings。共同媒体、计划／作业、采用、剪辑、审阅和费用仍属于原模块。无镜头的生成仍合法；广告后续提供自己的上下文接入，不建立虚假的集场镜。

## 2. 页面、定位与信息密度

共同顶部为场次上下文、镜头制作／剪辑及独立固定审阅版本入口。制作区第二层切换分镜／自由画布；素材、历史和助手按需展开。默认首次进入分镜模式，以后恢复该用户上次模式；从明确画布链接进入时尊重链接。

| 行为 | 确定的首版规则 |
|---|---|
| 分镜模式 | 当前镜头大预览＋中央底部有界创作输入＋底部分镜条；全场总览按需展开。要求详情和历史按需查看，直接输入不与助手争用右侧栏 |
| 画布模式 | 独立文字、图片、视频、音频节点；短工具随选中对象出现，长输入稳定在中央底部，最多一份输入区且明确目标；无选择时收起输入，完整媒体不被盖住 |
| 镜头定位 | 按稳定 shotId 查关联节点并适应其包围范围；未摆放时显示“添加到画布”，由用户选择已有候选／参考，不自动生成内容 |
| 场次全览 | “全场镜头”列表可搜索并定位；“适应内容”缩放到节点范围；允许共用参考位于镜头之间，无强制镜头大容器 |
| 分组 | 首版一层可选分组，只用于移动与收纳；使用画布绝对坐标，加入／退出组不修改镜头归属或播放顺序 |
| 没有选中对象 | 隐藏节点工具与输入区，保留添加／手形／选择／缩放；助手上下文显示场次，不猜测最后镜头 |
| 多选 | 移动、删除呈现、分组、共同作为参考；不批量展开输入框、不一键执行多个付费任务 |
| 参考与历史 | 提供列表检索、缩略图懒加载和定位；历史可以取回同一媒体，不产生新作业 |
| 助手 | 默认收起，展开后非模态停靠并占布局空间；明示固定目标和引用，只使用已有有限 AI 入口。浏览其他镜头不静默改变建议接收目标；自由节点无适用动作时只提供直接编辑 |

持续素材浏览与助手均占实际布局空间；短参考选择器可就近展开。笔记本宽度不同时展开两个完整辅助栏，已选关键参考可固定并看。当前样板以 1454px 为双辅助栏阈值，属于可随任务验证微调的尺寸；开关面板不自动缩放全场，不丢输入。固定看一份素材不等于引用它；已打开选择器保持明确接收目标。

复用[交互契约](../design/scene-canvas-interaction-v0.1.md)中的选择、框选、平移、缩放、快捷键和局部继续创作规则。输入框、中文输入法组合态、播放器和端口优先处理自己的事件；在输入焦点下 Space/Delete/Cmd+A/Cmd+Z 不操作画布。原生文件拖入属于上传流程，不由排序库接管。

## 3. 逻辑存储与不变量

新增迁移批次 M07，晚于 M01–M06 所需外键。以下为设计，不生成空业务迁移冒充已实现。

| 表／记录 | 核心字段与约束 |
|---|---|
| canvases | id、tenant_id、project_id、revision、schema_version、document、created_by、updated_by、timestamps；根属于可信租户／项目；文档和节点索引同事务更新 |
| canvas_revisions | canvas_id、revision、body_hash、actor、created_at、checkpoint元数据；unique(canvas_id,revision)；保留期间正文不可改，历史有限保留与去重正文见21，不永久复制全部文档 |
| canvas_node_index | node_id 全局唯一、canvas_id、kind、content_type、media_id 可空、active；派生索引由服务器从文档重建；被移除节点保留身份墓碑，历史引用不级联删除 |
| canvas_media_refs | canvas_id、revision、node_id、media_id、asset_revision_id 可空；复用媒体依赖保护，签名 URL 不进入文档 |
| scene_canvas_links | tenant_id、project_id、scene_id、canvas_id；unique(scene_id)、unique(canvas_id)；同租户同项目复合外键；仅短剧接入层拥有 |
| node_shot_bindings | canvas_id、node_id、shot_id、shot_revision_id、role、take_id 可空；unique(canvas_id,node_id,shot_id,role)；候选必须对应相同媒体与合法视频区间；允许一个节点关联多个本场镜头 |
| canvas_plan_origins | plan_id唯一、canvas_id、node_id、canvas_revision、input_fingerprint、source_snapshot；确切输入独立保留，canvas_revision不强引用可清理的完整历史正文；创建计划同事务写入；job 仍通过原 plan_id 唯一约束关联 |
| canvas_result_nodes | tenant_id、project_id、canvas_id、job_id、media_id、node_id；unique(canvas_id,job_id,media_id)、unique(node_id)；固定结果与呈现身份，移除节点不删除此映射，恢复与文档／索引同事务 |
| scene_workspace_preferences | user_id、scene_id、revision、mode、viewport、selected_node_ids、selected_shot_id 可空、panel preferences；由短剧接入层维护个人偏好，不让通用画布依赖场次视图名称 |

画布封套 schemaVersion=1，document 中 nodes、edges、groups 使用稳定 UUID。文本正文是纯文本，不执行 HTML／脚本。节点分四种 kind；文字只能含 text 内容；图片／视频／音频节点可以引用 ready 媒体，或保存 draft。draft 只含提示、可空模型选择及输出草稿；没有 job 状态、采用、审批或金额字段。

引用边只允许“文字／已验收媒体 → 创作草稿”，携带 enabled、purpose、position。它是当前草稿可用输入，停用边不进入请求；文字 purpose 必须为 prompt，媒体用途复用 Reference。不能连接未完成草稿的未来结果，不执行循环／条件／整图运行。新结果的历史来源关系从 canvas_plan_origins 及对应已归档 job 查询，作为只读连线呈现；不让编辑引用边改写历史执行输入。

所有节点／边／组 ID 唯一、端点存在、节点不自连、分组不嵌套、坐标为有限数；媒体 kind、归属、可访问性、引用资产版本与字节身份在服务端校验。初始防滥用上限为单文档 2,000 节点／5,000 引用边／200 组／4 MiB UTF-8 JSON；这是可配置的首轮容量上限，不是已测性能或镜头数承诺。提前显示容量使用并保留未保存修改；实际值须按 AT-61 压测调优。

视口缩放允许 0.00001–4，使用独立用户偏好保存与版本检查。合法坐标跨度约 2,000,000，加上最大 1,600 节点宽度，在最小缩放下约占 20 像素，小于现有桌面画布最小高度 240 像素扣除适应留白后的空间；实际“适应内容”仍按全部目标节点的测量包围盒计算合适比例，不固定缩到该下限。全场与多节点定位均不能被原 10% 下限裁切；小比例应如实显示，不能四舍五入为 0%。节点坐标 CanvasPoint 仍为 ±1,000,000；视口 x/y 是作用于已缩放内容的屏幕变换，单独允许 ±8,000,000（2 × 最大缩放 4 × 节点坐标上限），容纳极值节点在 400% 时的定位与居中余量。两者不是同一尺度，不能复用节点坐标范围约束视口。视口结束时若超出自己的范围，应同步约束画面后再保存合法偏好。这不改变节点坐标、文档容量、生成输入或 300／2,000 节点的性能验收定义。

节点 kind/content.type 一经建立不可变；媒体节点的 mediaId／assetRevisionId 也固定。换媒体、将草稿变为结果或改变目标媒体类型时创建新节点，不复用 nodeId。恢复墓碑校验原种类与媒体身份；草稿可改提示、模型和参数。相同身份规则覆盖普通复制、结果取回和 PUT，防止原 Take 指向 A 而节点显示 B。

整文档保存按锁定当前基线区分既有和新增引用：已有且仍授权的归档媒体允许原样保留、移动与改标题；新引入媒体必须 ready，归档媒体不能作为新生成输入。权限撤销不适用旧引用例外；读取按当前权限过滤不可访问媒体的展示和访问凭据，并给出引用不可用状态。服务器保留原依赖作审计，不因界面隐藏删除它；用户需明确移除失权引用后才能提交影响该引用的修改。

### 3.1 拖入文件与固定落点（2026-09-11 实施补充）

拖入图片、视频或音频沿用素材导入、字节摘要、验收与不可变原片归档。`UploadInput.canvasTarget` 指定当前项目的真实 canvasId、固定 clientRequestId 和落点；上传意图与 `canvas_upload_placements` 同事务创建，使用原创建幂等键。同一画布、发起人和 clientRequestId 永久唯一；成功回包丢失时，可按本人请求身份读取已有记录，不依赖重新创建，已放入或移除后仍可核对。共享范围、外项目画布和文档类型不能冒充画布媒体上传；文本／SRT 沿用素材库入口。每画布最多 100 份尚未放入且未移除的上传，创建在画布锁内检查；单次页面处理最多 20 份待办，文件依次核对与上传，避免同时缓冲多份大文件。

待上传呈现不属于文档中的媒体节点，不能连线或用于生成。它拥有固定上传身份、未来节点 UUID 与落点；进度和错误在该位置及恢复列表中显示。服务器返回状态和原文件声明，不把上传授权或媒体字节写入画布／本机记录。页面重新选择文件时核对大小及 SHA-256，创建成功但回包丢失仍使用原幂等键。

文件验收通过后，当前发起流程使用普通画布编辑追加确切媒体节点；服务端再次验证已验收上传、媒体与预留节点身份完全一致。Worker 不直接写画布。追加进入原 CAS、恢复和撤销系统，不占用上传进度版本。预留 UUID 不能被其他项目、文字节点或另一媒体抢用；节点索引的永久身份作为“曾经放入”的证据，移除或撤销后不会再次作为自动待放入项出现。

页面在追加前持久记录本次自动放入已处理；任一步骤断开、恢复冲突或刷新后，保留“文件已导入／待放入画布”的明确恢复动作，不在后台重复追加。移除待处理呈现只设置不可逆的 dismissed 标记，保留上传和素材；已放入的节点必须使用普通文档移除。该标记和原始落点不改画布 revision，也不能用它撤销素材导入。创建、查询、恢复和移除都按当前项目权限核对。

## 4. 保存、冲突与撤销

选择整个画布文档的 CAS，暂不引入独占编辑租约、CRDT 或无条件覆盖。服务器 GET 返回 ETag；PUT 携带 If-Match，正文只含 schemaVersion 和文档。所有变更检查项目可编辑及完整文档约束，再在单事务追加修订、更新当前文档与引用索引、发出 outbox 通知。绑定变更与文档保存共用canvas revision；所有修订均关联对应正文hash，绑定变化不复制相同正文。历史按21分层保留。

前端维持 server base、local draft 和 pending save。停止操作 800 ms 后自动保存，持续拖动最多每 5 秒提交一次，pointerup 触发队列；同一画布最多一条写请求在途，期间的新修改排队，响应不得覆盖更新的本地输入。状态明确为“已保存／保存中／本机待同步／保存冲突／保存失败”。

收到 412：停止自动写，保留原基线与本地修改，读取最新服务端版本，展示变化摘要。首版提供“查看最新”和“保留本地副本并重新应用选定修改”；重放只作用于人选择的节点／边／组，删除或同时编辑的对象逐项选择，生成新文档后使用最新 If-Match。没有“强制覆盖全部”的默认按钮，不后台自动变更基线。首版不承诺智能自动合并。

请求超时：先 GET 当前状态。当前 document canonical hash 与所发正文一致即可确认成功；与基线一致时可用原 ETag 重送同一 PUT；第三种情况按冲突处理。重送保存不会执行模型。读取到较旧响应时只按 revision 前进，SSE 只触发重查，不能覆盖 dirty 草稿。

本机恢复副本使用 IndexedDB，以 user/tenant/project/canvas 分隔；只存文本、ID 与布局，不存密钥、签名 URL 或媒体字节。每次编辑节流保存，刷新后先验证身份与项目访问再恢复；退出清除本用户缓存，撤权后禁止展示并清除。默认保留 7 天、最多 20 份近期画布副本，可手动清除；不称作服务端备份。

撤销／重做只针对本次画布文档编辑，最多 100 步，输入文字按短编辑段合并；新变更清空 redo。撤销结果作为新文档保存，不回退 revision。生成执行、候选绑定、采用、剪辑和批准不进入画布撤销栈；仍保留的历史文档可查看，过期返回410；以“取回内容”明确复制为当前草稿，不回滚历史任务。

## 5. 模式切换与制作关联

切换不创建新 canvas，不调用模型，不重排镜头。共享草稿 store 按 scene/shot 或 canvas/node 保存，两种编辑入口关联同一份草稿时只维护一个内容源；无关联节点保持自由上下文，不能自动归到上次镜头。模式切换可在未保存状态下发生，并持续显示待同步／冲突状态。

分镜模式显示已关联参考和 Take，并通过“本场探索”入口找回未归镜头的媒体、文字与草稿。画布中的媒体节点可关联已有镜头：role=reference 只建立待选参考关系，不自动改 ShotSpec 默认参考；role=candidate 只允许 ready 视频，明确 range 后复用 createTake 的合法区间与去重规则；绑定与 Take 创建必须在同一事务提交。关联新镜头先调用现有 createShot（ContentTree CAS），成功后再绑定；绑定失败时保留新镜头并显示可重试的待关联状态，不重复创建。

绑定依赖固定 shotRevisionId；规格后续改变显示过期来源，并使用已有明确沿用／新建候选规则。一个节点关联多个镜头时，不按第一个或距离选择目标；创作和采用前明确选镜头。删除节点只将呈现移除，关联保留为历史且不影响 Take 或 selection；活跃镜头定位只返回当前节点，恢复历史节点后可继续定位。

复制节点产生新 nodeId，但媒体引用可共用；不复制 job、采用或镜头绑定。分组移动不改绑定。镜头归档后画布素材仍在，相关标签显示归档，不允许向该镜头新增候选或采用。项目归档后画布只读，在途结果仍按原任务归档。

## 6. 从画布准备生成到结果回收

1. 将当前草稿保存成功，再用 scene 路由提交 nodeId、明确的 shotSources（可空），If-Match 使用 canvas revision。服务端通过真实 scene_canvas_link 找 canvas；节点必须为 draft，模型和能力已选。
2. 在同一业务事务固定草稿、启用边、来源文字／媒体及资产版本快照，按 position 解析。文字参考形成单独可见输入段，媒体转换为现有 Reference；镜头来源由用户显式选择，按原继承／覆盖规则解析，最终 resolvedInput 必须完整回显。准备不执行模型、不预占付费作业。
3. 生成草稿 fingerprint 仅覆盖 prompt、model/capability、output、已选镜头要求和启用边的确切内容／媒体身份，包含启用边的 purpose、输入顺序 position、subjectAssetId、assetRevisionId 和实际来源内容；不含画布 x/y 坐标、节点大小、组名、节点标题及停用边。createGenerationPlan 的 resolver 与费用估计仍是唯一来源；新增 SourceDependency.kind=canvas_draft（objectId 为 draft nodeId，revision 为保存的 canvas revision，tracking=current，contentHash 为上述相关输入指纹）和不可变 origin。节点身份索引／墓碑保留 objectId；canvasId 与确切输入通过 origin 快照定位，不把位置修改解释为内容过期。
4. 用户查看计划后调用既有 executeGenerationPlan；重新授权并按相关 hash 核查过期。移动节点不使计划失效；更改实际参考、提示或删除草稿使未执行计划过期。已提交 job 不受以后画布编辑影响，也不需要等待画布保持打开。
5. listCanvasPlans 查询固定来源，按计划查 job 和实际 mediaIds；生成输出不异步覆盖 document，也不只挂在内存里。文档节点删除后仍能从历史查到相同 job／媒体。
6. 有新结果时显示可恢复的“添加到画布”入口，可一次选择该 job 的多个 ready 媒体。materializeCanvasResults 用 canvas If-Match 与幂等键，服务器验证 job 确来自此 canvas、mediaIds 是其结果；服务端生成节点 ID、保存独立媒体节点与只读来源映射，返回新画布。客户端只能给建议位置，不自报完成状态。
7. 默认不自动采用、绑定镜头或改剪辑；关联镜头后遵循第 5 节。再次生成新建 draft 和新 plan，保留所有已付费记录。

materialize 以 unique(canvas_id,job_id,media_id) 防止回执或同一结果重复添加；被移除的原结果节点在用户再次添加时恢复原身份，位置可调整。要并排展示同一文件两份，可用复制节点，仍不产生新候选。发生 CAS 冲突时只保留“待添加结果”入口，不覆盖同伴文档；恢复不重新生成。

## 7. 接口清单与事务

全部路径位于 `/v1/tenants/{tenantId}/projects/{projectId}`，使用现有会话、CSRF、项目授权、POST 幂等规则。所有 canvasId／sceneId／nodeId／jobId／mediaId 都校验实际所属关系，不用 URL 字面值或任意 contextType 作为权限。具体 Schema 在 canvas_contract.py 注册并由 build_contract.py 统一生成。

| 操作 | 路径后缀 | 并发与关键限制 |
|---|---|---|
| ensureSceneCanvas | POST /scenes/{sceneId}/canvas | 明确创建／取回；unique(scene_id)，并发首次进入仍一张；GET 不隐式创建 |
| getSceneCanvas | GET /scenes/{sceneId}/canvas | 返回画布及镜头关联；没有则 404/SCENE_CANVAS_NOT_CREATED |
| getCanvas / getCanvasRevision | GET /canvases/{canvasId}，/revisions/{revisionNumber} | 当前／历史；历史只读，访问按当前权限；过期410 EDIT_HISTORY_EXPIRED；新增listCanvasHistory列实际恢复点 |
| saveCanvas | PUT /canvases/{canvasId} | If-Match(canvas)，整文档校验；不接收 jobs／绑定／采用字段 |
| listCanvasUploads | GET /canvases/{canvasId}/uploads | 最多 100 份未放入且未移除的上传，返回固定落点、未来节点身份、声明及验收状态；不返回上传凭证 |
| getCanvasUpload | GET /canvases/{canvasId}/uploads/{uploadId} | 核对本画布的确切上传与呈现身份，放入／移除后仍可查询 |
| getCanvasUploadRequest | GET /canvases/{canvasId}/uploads/by-request/{clientRequestId} | 仅按当前发起人查询确切请求；丢失创建回包后找回同一上传，无记录返回专用 404，不代表失权 |
| dismissCanvasUpload | POST /canvases/{canvasId}/uploads/{uploadId}/dismiss | 原幂等规则；仅移除待处理呈现，保留文件，不推进文档版本；已放入则使用文档移除 |
| bindSceneCanvasNode | POST /scenes/{sceneId}/canvas/nodes/{nodeId}/shot-bindings | If-Match(canvas)＋正文 shotRevisionId；短剧适配器锁 canvas→shot，候选去重与绑定同事务 |
| unbindSceneCanvasNode | DELETE /scenes/{sceneId}/canvas/nodes/{nodeId}/shot-bindings/{bindingId} | If-Match(canvas)；仅解绑，不删除 Take、参考或镜头 |
| prepareCanvasGeneration | POST /scenes/{sceneId}/canvas/generation-plans | If-Match(canvas)，原固定输入／模型／预算估计规则；节点不可用返回明确错误 |
| listCanvasPlans | GET /canvases/{canvasId}/generation-plans | 分页；可按 nodeId 查询；删除节点后仍能找回来源 |
| materializeCanvasResults | POST /canvases/{canvasId}/results | If-Match(canvas)＋幂等；只写已归档结果的呈现 |
| getSceneWorkspacePreference / saveSceneWorkspacePreference | GET／PUT /scenes/{sceneId}/workspace-preference | 当前用户专属；无记录时 GET 返回虚拟 revision=0，不写库；首次 PUT If-Match:"0" 原子创建，后续按偏好版本 CAS；不改共同文档 |

全局适用锁偏序统一为：授权／project 记录→connection 根（如需）→供应商账号配额（如需）→内容根／scene／审阅 subject（如需）→canvas 根→shot 根（如需）→工作室预算→项目预算→plan／job／reservation；同类多个对象按 UUID 排序，缺失层跳过。ensure 先锁 scene 再创建唯一 link 与画布；prepare 先无锁读取候选 connection ID，再按 connection→scene→canvas 获取锁并重新核对草稿，连接已变则释放重试，不能先拿 canvas 再取 connection。

executeGenerationPlan 从不可变 canvas_plan_origins 找到关联，按上述 connection→canvas→预算→plan 顺序锁定，在同一事务校验草稿及引用 fingerprint、消费计划、预占和建立 job；画布保存与执行以获得 canvas 锁的先后决定结果。execute 提交之后的画布编辑不影响固定 job，Worker 只重核授权和原固定输入的可用性，不再用当前草稿改写或否决已确认计划。materialize 使用 canvas→job，只查询已验收输出，不持连接或预算反向写。第 11 文档同步此偏序。

错误补充：CANVAS_VERSION_CONFLICT（HTTP 412）、CANVAS_REFERENCE_INVALID（422）、CANVAS_LIMIT_EXCEEDED（413）、CANVAS_DRAFT_INCOMPLETE（422）、CANVAS_INPUT_CHANGED（409）、CANVAS_RESULT_NOT_READY（409）、CANVAS_NODE_MISSING（404）。权限失败使用现有 403／不暴露存在性规则；绑定／保存等失败完整回滚。外部未知提交继续原状态，不新增第二套 canvas job 状态机。

## 8. 性能、可访问性与释放

React Flow 专职位置／视口／连接交互，业务数据由应用层与 API 管理；组件选型见 17。画布首屏取元数据与海报，视频／音频点击后才挂载播放器，最多一个有声播放实例，离开视口或切模式暂停并释放非活动 decoder。大视频不用 base64 放进节点状态；缩略列表虚拟化不等同视频解码优化。

分镜与节点定位列表提供键盘路径；选中可用方向键微调、菜单移动和添加参考，关键能力不依赖精准拖线。长中文允许正常选择和换行，端口具名称，选中不改媒体色彩。窄屏优先列表查看与评论，首版桌面制作，不以缩小画布冒充完整移动端。

性能验收固定浏览器／机器：300 节点常用场景、2,000 节点容量边界分别测首屏交互、平移帧时、保存体积、内存、播放器实例和搜索定位。建议 300 节点交互 P95 < 100 ms、平移帧时 P95 < 33 ms，作为待实测目标；不通过时先减少昂贵节点渲染与懒挂载，再调上限，不能靠移除错误／权限校验通过。

## 9. 工程任务与验收

CX01：M07＋创建／读取／CAS／历史，依赖 E01/E03；CX02：双模式 store、节点／输入事件、偏好与本机恢复，依赖 CX01/F00；CX03：镜头绑定与本场探索，依赖 E02/E04/CX02；CX04：固定计划、结果回收和未知任务恢复，依赖 G01/G02/CX03；CX05：跨成员冲突、撤权、容量与用户任务验收，依赖以上。

新增 PR-16（双模式画布与互通）、PR-17（画布保存与恢复）；AT-52–63 覆盖场次唯一画布、多镜共享、冲突／超时／恢复、权限、真实输入快照、结果取回、候选绑定、快捷键、性能、媒体与来源保留，以及完整场次任务。现有 AT-01–51 继续有效。字段／样例静态验证与实际业务验收分别记录。

首次工程切片可以先用导入素材完成 CX01–03；完整 MVP 必须完成 CX04–05，不再将画布列为后置。任意自动执行 DAG、实时共同编辑、工作流市场和跨项目画布不属于首版。

## 10. 技术收尾：提示与保留规则

[21 §4](21-technical-baseline-closure.md#4-画布协作与恢复历史)是本页保存历史的具体策略：当前和前一版保护；近期最多100份／24小时；15分钟检查点7天、日检查点30天；未固定历史按未压缩去重正文256MiB预算淘汰。固定业务依赖不随普通历史清理；生成源快照独立于完整画布历史。清理、pin、引用删除在对象锁内复查并原子提交。

首版整画布CAS基于主责和异步接手；新增editing-presence仅提示编辑者，每30秒心跳、90秒过期，不是独占锁或实时共同编辑。断网／服务故障不能显示“确定无人编辑”。旧基线已过期时不自动合并或覆盖，从仍有权的本地内容逐项重新应用。新增AT-64–75及CX06与原AT-52–63一起进入完整MVP验收。

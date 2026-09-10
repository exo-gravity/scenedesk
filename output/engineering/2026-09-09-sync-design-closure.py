"""One-time, scoped synchronization of current design documents (not frozen reviews)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def edit(path, replacements=(), line_changes=(), append=""):
    p = ROOT / path
    text = p.read_text()
    for old, new in replacements:
        if old not in text:
            raise RuntimeError(f"Expected text missing: {path}: {old[:70]}")
        text = text.replace(old, new)
    for prefix, new in line_changes:
        lines = text.splitlines()
        found = [i for i, line in enumerate(lines) if line.startswith(prefix)]
        if len(found) != 1:
            raise RuntimeError(f"Expected one line: {path}: {prefix}: {found}")
        lines[found[0]] = new
        text = "\n".join(lines) + "\n"
    p.write_text(text + append)

edit('docs/implementation/01-product-requirements.md', [
 ('MVP 按结构化分镜工作台实施，画布 UX-01 后续单独验证。', 'MVP 同时提供场次分镜／自由画布；UX-01 验证任务收益和具体默认呈现，不再决定是否提供画布。'),
], [
 ('MVP 默认采用结构化分镜工作台', 'MVP 每场次同时提供分镜模式／自由画布，每场一张画布；分镜按镜头顺序组织，画布组织多个镜头与共用参考，具体编辑聚焦镜头或节点。默认首次进入分镜，以后恢复偏好；完整交互、保存与接口见[18](18-canvas-workspace-contract.md)。工作流与用户验证见[12](12-mvp-workflows-and-pilot.md)及[20](20-external-validation-and-launch-plan.md)。'),
], '\n## 8. 新增场次画布需求\n\n| ID | 功能与行为 | 首版完成条件 |\n|---|---|---|\n| PR-16 | 场次分镜／自由画布、独立节点、引用／生成、镜头关联和结果取回 | 每场唯一，多个镜头与共用参考并存；计划和结果共用原业务；无隐式采用、剪辑或费用 |\n| PR-17 | 画布修订、CAS 保存、偏好、本机恢复与权限 | 冲突保留输入；旧响应不覆盖；恢复与撤权安全；历史媒体和作业不因删除节点丢失 |\n')

edit('docs/implementation/02-interaction-spec.md', [
 ('新增画布交互及尚待工程补充的部分见', '新增画布交互见'),
 ('当前业务原型尚未实现，持久化与 API 需补入工程包。', '持久化与 API 设计已补入[18](18-canvas-workspace-contract.md)，业务原型尚未实现这些服务端行为。'),
 ('三种主体布局仍在比较，见[效果图与决策](../design/layout-concepts-v0.3.md)', '已确定场次双模式，具体视觉见[双模式效果图](../design/scene-dual-mode-visuals-v0.4.md)'),
 ('信息减量后的默认布局待效果图比较确认。', '后续实现按18确定的分镜聚焦与自由画布布局迁移。'),
])

edit('docs/implementation/03-domain-data-model.md', append='\n## 场次双模式的数据扩展（M07）\n\nCanvasWorkspace 的 canvases、canvas_revisions、canvas_node_index、canvas_media_refs、canvas_plan_origins、canvas_result_nodes 与短剧接入的 scene_canvas_links、node_shot_bindings、scene_workspace_preferences，字段与约束统一见[18 §3](18-canvas-workspace-contract.md#3-逻辑存储与不变量)。节点身份和媒体内容固定，文档 CAS 与绑定共用 canvas revision；生成、采用、剪辑与批准不写入画布文档。新增 SourceDependency.kind=canvas_draft，执行检查相关输入 fingerprint，画布坐标不参与。M07 是设计迁移批次，尚未应用业务数据库。\n')
edit('docs/implementation/06-api-contract.md', append='\n## 场次画布协议扩展（OpenAPI 1.2.0）\n\n新增12个操作，详见[18 §7](18-canvas-workspace-contract.md#7-接口清单与事务)。saveCanvas、节点绑定、prepareCanvasGeneration、结果取回使用 canvas If-Match；个人场次偏好使用自己的 revision，GET 无记录返回0，首次 PUT 接受 If-Match:"0"，不修改画布。生成仍经既有 executeGenerationPlan 显式执行。节点正文禁止伪造 job／Take／批准；相关媒体、身份、跨场绑定、候选区间与输入指纹须由服务器校验，Schema 通过不替代此类校验。快照、归档引用例外、不可变节点及全局锁顺序以18及11共同规定。\n')
edit('docs/implementation/11-transaction-and-implementation-blueprint.md', append='\n## M07 与 TX-07 场次画布\n\nM07 接续 M01–M06，包含通用画布、不可变修订／节点索引、媒体引用、计划来源与结果节点唯一映射，以及短剧每场唯一 link、镜头绑定和个人视图偏好。表约束与写事务见[18](18-canvas-workspace-contract.md)。TX-07 包含 ensure唯一创建、全量文档CAS、候选创建与绑定原子提交、prepare输入快照、execute指纹检查与消费、materialize幂等取回。所有路径遵守本文第2节锁偏序；不通过删除外键、使用最后写覆盖或复用任务幂等缓存代替永久唯一约束。\n')
edit('docs/implementation/05-architecture-and-operations.md', [
 ('专业组件建议与具体版本见', '专业组件最终选择与具体版本见'),
 ('新增保存、业务绑定及模式互通接口需单独补齐', '新增保存、业务绑定及模式互通接口见18，仍待业务实现'),
 ('画布保存、短剧绑定、跨模式定位及冲突保护需补入数据模型和 API', '画布保存、短剧绑定、跨模式定位及冲突保护已纳入[18](18-canvas-workspace-contract.md)及OpenAPI 1.2.0，真实服务端行为待实现'),
])

edit('docs/implementation/09-decisions-and-open-items.md', [
 ('画布价值需要后续验证。', '首版每场次包含分镜／自由画布，价值与默认呈现继续通过试点验证。'),
], [
 ('| 当前主界面 |', '| 当前主界面 | 每场次分镜／自由画布两模式，共用剪辑与固定稿审阅；每场唯一画布，整文档 CAS，不做实时共同编辑 | 用户最新确认＋[18](18-canvas-workspace-contract.md) |'),
], '\n## 5. 本次剩余设计收口\n\n用户授权完成剩余内容后，专业组件通过官方证据与隔离样例确定为 React Flow、Media Chrome、dnd-kit、Query，Virtual 按需接入，详见17。新增画布数据／接口／恢复／验收见18；本轮完成清单与独立核查见[19](19-design-closure-and-implementation-entry.md)；外部事实卡、运行拓扑、试点和广告研究执行计划见[20](20-external-validation-and-launch-plan.md)。已有 G-01–08 保留真实执行门槛，不由本轮文档代填通过。\n')

edit('docs/implementation/14-scene-mvp-closure.md', [
 ('本轮讨论已并入主稿 v1.2、实施包 v1.1 和 OpenAPI 1.1.0', '最新讨论已并入主稿 v1.3、实施包 v1.2 和 OpenAPI 1.2.0'),
 ('主体布局仍待[效果图比较](../design/layout-concepts-v0.3.md)', '主体采用场次双模式，见[效果图](../design/scene-dual-mode-visuals-v0.4.md)与[18](18-canvas-workspace-contract.md)'),
], [
 ('**收口后的范围更新：**', '**当前范围：** 用户将每场次分镜／自由画布纳入第一版，工作区覆盖整个场次；新增数据、接口、保存冲突、模式互通和验收设计已补入[18](18-canvas-workspace-contract.md)及OpenAPI 1.2.0。原S0检查保留历史；最新静态／隔离验证见[19](19-design-closure-and-implementation-entry.md)，真实业务待实现。'),
])

edit('docs/implementation/16-implementation-backlog.md', [
 ('范围已定，不等待画布、广告或复杂 Agent 选型。', '范围已定，画布属于首版并增加CX01–05；广告与复杂Agent继续后置。'),
 ('正在等待视觉评审；真实业务仍随E01–E06推进，其他页面逐步迁移。播放器、拖拽等具体库仍为研究建议，不因确认通用UI而扩大范围。', '双模式及视觉基线已确定，细节继续打磨；真实业务仍随E01–E06/CX01–05推进，其他页面逐步迁移。专业库已按17完成隔离验证并确定选型。'),
 ('无限画布与任意节点流程、任意 Agent 编排／Skills 平台', '任意自动执行节点流程、实时共同编辑、任意 Agent 编排／Skills 平台'),
], append='\n## 6. 首版画布工作包（必须纳入完整MVP）\n\n| ID | 输出 | 依赖 | 验收 |\n|---|---|---|---|\n| CX01 | M07、每场唯一创建、文档CAS／修订／个人偏好、RLS | E01/E03 | AT-52、54–56 |\n| CX02 | React Flow与分镜共用store、输入／媒体事件、定位／本机恢复 | CX01/F00 | AT-53、55、60 |\n| CX03 | 参考与候选绑定、本场探索、旧引用与恢复 | E02/E04/CX02 | AT-53、58、59、62 |\n| CX04 | 画布固定计划、相关输入校验、结果取回与未知提交恢复 | G01/G02/CX03 | AT-57、58、63 |\n| CX05 | 多人冲突／撤权、2,000节点容量、完整场次任务 | CX01–04 | AT-54–56、61–63 |\n\n首次导入素材闭环可与CX01–03并行；完整MVP和试点退出必须包含CX04–05，不以旧E01–E06完成代替。工作包可直接估算，人员和日历排期按[20](20-external-validation-and-launch-plan.md)填写实际资源。\n')

edit('docs/implementation/README.md', [
 ('实施设计包 v1.1', '实施设计包 v1.2'),
 ('本期采用结构化分镜工作台，画布保留为 UX-01 后续任务验证。', '本期每场次提供分镜／自由画布两模式，画布覆盖整场并与制作事实分离；UX-01验证实际收益及具体呈现。'),
 ('[完整产品方案 v1.2]', '[完整产品方案 v1.3]'),
 ('PR-01–15', 'PR-01–17'), ('AT-01–51', 'AT-01–63'),
 ('Mantine通用UI已确认；专业组件建议、许可证据、隔离验证与接入顺序', 'Mantine及专业组件已选型；许可证据、隔离验证与分阶段接入'),
 ('专业组件候选不自动定稿。', '专业组件已按17完成本轮裁决；原型不等于生产接入。'),
], append='\n## 最新收口与开工入口\n\n优先阅读[19 收口清单](19-design-closure-and-implementation-entry.md)，再按[18 画布工程设计](18-canvas-workspace-contract.md)和[16 工作包](16-implementation-backlog.md)实施。模型／基础设施／试点／广告与商业验证见[20](20-external-validation-and-launch-plan.md)。本轮更新到主稿v1.3、实施包v1.2、OpenAPI1.2.0；画布新增12个API与AT-52–63，未宣称业务路由已运行。\n')

edit('docs/ai-drama-workbench-product-design-v1.1.md', [
 ('完整设计方案 v1.2', '完整设计方案 v1.3'), ('正文版本以此处 v1.2 为准', '正文版本以此处 v1.3 为准'), ('实施设计包 v1.1', '实施设计包 v1.2'),
 ('主体布局正在比较，故事板是', '主体已确定分镜／自由画布两模式，故事板是'),
 ('信息减量后的主体布局正在比较，见[三种效果图及导航决策](design/layout-concepts-v0.3.md)', '主体已明确分镜聚焦制作和整场自由画布，见[双模式效果图](design/scene-dual-mode-visuals-v0.4.md)'),
 ('该范围发生在原工程收口之后，画布数据、API 和验收尚需扩充，不能沿用旧收口状态宣称已完整准备。', '本轮已在[18画布工程设计](implementation/18-canvas-workspace-contract.md)补齐数据、12个API、CAS、模式互通与AT-52–63；具体实现和生产验收仍待执行。'),
 ('具体视觉规范另行讨论。', '视觉沿用当前暗色、媒体优先的集中主题基线，细节继续打磨。'),
 ('播放器等专业库继续按 [17](implementation/17-frontend-component-selection.md) 讨论确认。', 'React Flow、Media Chrome、dnd-kit、Query以及按需Virtual已按[17](implementation/17-frontend-component-selection.md)完成选型和隔离验证，主应用随业务切片接入。'),
 ('AT-01–51', 'AT-01–63'),
], append='\n## 14. 本轮剩余设计完成记录\n\n已统一画布首版范围，完成通用画布与短剧绑定、整文档CAS、输入快照／执行偏序、结果身份与恢复、12个API及新增验收；专业组件经独立研究与隔离样例完成裁决。范围与实施状态见[19](implementation/19-design-closure-and-implementation-entry.md)。实际账号、预算、部署与试点仍按[20](implementation/20-external-validation-and-launch-plan.md)执行；不将设计完成等同真实业务、客户或上线验收。\n')

edit('docs/README.md', [
 ('Mantine已确认；专业组件仍为建议；免费商用边界与隔离验证，Mantine已接入本地样板', 'Mantine及专业组件已完成选型；许可、隔离验证与分阶段接入'),
], [
 ('当前画布决策状态：', '当前画布决策：**首版每场次分镜／自由画布双模式，每场一张画布**。数据、保存、镜头关联、接口与验收见[18](implementation/18-canvas-workspace-contract.md)，最新收口见[19](implementation/19-design-closure-and-implementation-entry.md)。UX-01继续验证操作收益，旧研究不再决定是否提供画布。'),
])
edit('docs/adr/0001-production-records-independent-of-views.md', [('MVP采用结构化分镜工作台，UX-01验证后续画布的任务价值与位置。', '首版呈现已按用户最新决定升级为场次分镜／自由画布双模式，数据与视图分离原则保持；具体新增边界由[ADR-0006](0006-scene-canvas-and-versioned-drafts.md)补充。')])
edit('docs/adr/0005-frontend-free-component-stack.md', line_changes=[('本次未最终确认', '后续用户授权“完成剩下内容”，专业组件已核对并经隔离样例裁决为 React Flow、Media Chrome、dnd-kit、Query，Virtual按需使用，详见17及[研究记录](../research/2026-09-09-specialized-stack-closure.md)。此前研究状态保留在历史记录，当前不得继续视为待选；专业库尚未整体迁入主应用，不代表真实业务验收。场次自由画布已由用户纳入首版，完整专业编辑器仍后置。')])
print('Synchronized current scope and implementation links.')

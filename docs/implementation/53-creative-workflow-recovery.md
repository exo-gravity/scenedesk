# 53 首次创作流程审查与恢复修复

2026-09-12。以已合入 `main 30f5adc`、音频整合 `878d9af` 和当前首发范围 38／实施进度 22 为审查依据。修复提交基于独立前端分支 `5f9b426`；保留原入口裁剪和音频整合改动，由主线程 cherry-pick。这次没有修改服务器权限、模型适配器、画布保存或媒体执行。

## 已修复的两项问题

1. **P1：未应用建议时无法换到新镜头要求。** `ShotPromptComposer.tsx` 原“另开一次”只在 `assistanceSource` 存在时显示；`use-prompt-session.ts` 按 shotId 恢复原固定来源，后续导航不会自动替换该来源。于是先打开输入、修改镜头要求、返回准备提示时仍用旧 revision；应用又会拒绝非当前 revision，用户没有合法的推进入口。现在未应用建议也可明确另开输入：确认框固定打开时的镜头修订，保留原手工文本、准备要求、固定来源及先前计划／任务记录。未知任务、未恢复计划请求或未核对的编辑保存仍阻止开启下一次，不通过清空旧记录规避恢复。
2. **P1：项目内容重新读取被拒绝后继续显示旧缓存和编辑器。** `ContentWorkspace.tsx` 原先只在错误且没有 `data` 时阻断，TanStack Query 在 refetch 403／404 后会保留先前 data。上层 `TenantArea` 检查工作室 membership，只有项目授权撤销时仍可通过；`ProjectUpdates` 发布访问提示和 invalidate，不拦截 children。因此这不是上层已处理的假阳性。现在项目／内容／剧本 GET 确认 401／403／404 后立即隐藏原内容及编辑器，并清除标题中的项目名；拒绝状态保持到所有保护读取重新成功，后续 5xx 不会重新暴露缓存。临时读取失败不当作撤权，不清除本机编辑草稿；重新授权后明确恢复原草稿。此修复没有扩展为全站本机存储清理重构。

## 待处理：创建回执未知时的重复创建

**P2，审查时尚未修复；后续集场镜修复见 [54](54-content-creation-recovery.md)。** 在 `StructureEditor` 新建单集／场次／镜头时，服务端提交成功而 HTTP 回包丢失；随后刷新页面、恢复本标签页草稿、核对并使用最新内容版本作为基线，再次保存，可创建第二个同名对象。

证据链（审查基线 `878d9af`）：`apps/web/src/business/api.tsx:89` 的 `pending` 幂等身份仅在组件 ref 中，刷新会丢失；`content-drafts.tsx:5` 本机记录只有 value／baseVersion／savedAt，没有原提交 body／If-Match／Idempotency-Key。`ContentEditors.tsx:176` 会根据已包含首次创建结果的最新 siblings 重算追加 position，`:245` 发出新的 POST，`:346` 的核对动作允许重新设定基线。`apps/api/src/modules/content/routes.ts:82` 检查新基线后调用 insert；`commands.ts:20`、`:35`、`:63` 为对象生成新 UUID。原幂等记录按旧 key 仍有效，但新请求不再携带它。

已有 editor completion recovery 未覆盖此触发：`api.tsx:118` 的 `onCommitted` 只有 `api()` 成功返回后才执行；`ContentEditors.tsx:253` 才调用 `draft.complete()`；`content-drafts.tsx:217` 才记录 completion receipt。响应丢失时没有 receipt，所以当前实现无法区分“服务端没保存”和“保存了但没读到回执”。最小后续修复应在首次发送前耐久保存原请求身份、原 body 和基线，刷新先核对／明确恢复同一请求；不能把未知提交直接转换为新基线新创建。项目创建表单也使用同一个内存 key helper，应在该后续切片中审查。

## 验证与实际条件

`npm run check` 88/88 通过，新增两项公共 controller 行为验证：未应用建议的新输入跨刷新保留旧来源及完成任务；未知提交不能被另开输入抛弃。生产构建中的受控浏览器完整流程已通过，实际 Query 缓存／编辑器和 IndexedDB 执行：工作室资格有效时的项目 403、拒绝后 503 保持隐藏、临时故障保留与重新授权后恢复草稿、未应用建议的新镜头修订确认及刷新恢复；仅 1 次固定计划和 1 次执行，恢复没有新写入。1512／390 px 截图已逐一检查。见[独立验证证据](../../output/playwright/2026-09-12-creative-workflow/verification.md)。

真实模型服务、凭据与付费授权是外部条件；仓库的 generation worker 仍明确限定本地 test_fixture，且非 fixture 计划会标记 REAL_PROVIDER_ACCEPTANCE_REQUIRED，因此真实适配器及其验收也是后续实现工作，不能仅填入密钥就宣称 AI 上线。音频后端正在由主线程整合，按意见准备修改缺少真实反馈来源、私有部署的实际环境尚待落实，均不作为本次两处 UI 缺陷的替代验收。

## 音频与私有入口组合验证

本次恢复代码已整合到音频/部署基线 `c9233f6`；产品源文件与独立验证提交 `900d220` 完全一致。组合 `npm run check` 99/99通过，创建恢复、助手/撤权及390px原脚本均第一次通过，原断言未改。主任务复核实际diff、独立数据库测试和整合截图，保留私有入口裁剪。完整证据见[组合浏览器验证](../../output/playwright/2026-09-12-creative-recovery-integrated/verification.md)。文档契约检查通过；本次对应提交的完整远端CI和最终合并记录随后补充。

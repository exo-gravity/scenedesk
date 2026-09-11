# Take 修改建议的实际整合验证

2026-09-12，根分支 `feat/take-feedback-rework`。实际本机 API、受限 PostgreSQL 运行角色和 fixture generation worker；页面来自生产构建。没有真实模型调用、费用或外部上线验收。

使用 [setup-fixture.js](setup-fixture.js) 和 [fixture.json](fixture.json) 中明确标记的独立技术镜头，引用已有本地视频文件创建 Take，随后仅修改该镜头要求，使候选固定旧 v1、镜头当前为 v2。原试用镜头保持不变。

| 实际流程 | 结果与证据 |
|---|---|
| 建立意见、保存评论后各丢弃201，刷新，再明确重放原请求 | 各2次POST，数据库各1条；两次刷新均0自动POST；原body/key和普通输入保留。[脚本](verify-feedback.js)、[结果](feedback.json) |
| 打开r1确认后，由实际API将评论改为r2 | 确认框继续显示r1，点击后拒绝；明确读取并选择r2后才打开修改输入，仍固定旧Take要求；0计划POST。[脚本](verify-fixed-selection.js)、[结果](fixed-selection.json) |
| 准备r2意见修改计划并执行，丢弃202 | 1计划、1执行；刷新GET恢复同一已完成作业及产物；输出明确fixture并含原意见r2。[脚本](verify-generation.js)、[结果](generation.json) |
| 人工修改建议，清空保留项，丢弃保存200 | 1次PUT，刷新后GET找回r2，无重复修订；空数组合法。[脚本](verify-artifact-media.js)、[结果](artifact-media.json) |
| 明确追加建议、准备下一次视频输入 | 保留手工原文；视频计划ready，固定旧Take镜头版本及artifact r2；普通输入独立。此视频计划未执行，不把本轮算作新增视频解码验收。证据同上 |
| 数据库独立核对 | Review、Comment、Job、attempt、Artifact各1；typed来源、旧镜头版本、原评论历史、完整inputHash一致；未自动采用候选。[脚本](verify-database.ts)、[结果](database.json) |
| 用户明确标记意见已处理 | 生成和保存后评论原本仍未处理；明确操作才产生评论r3。旧artifact r2仍可读，原反馈r2快照不变，inputOutdated=true。[脚本](verify-resolution.js)、[结果](resolution.json) |

业务流程的pageErrors及非预期5xx均为空。两次升级本机API期间的旧页面连接错误发生在上述流程记录之外，未被计入成功流程。初次目视发现固定意见摘要被flex压缩，业务输入未丢；保留在 [修改前1512](before-summary-fix-1512.png) 与 [修改前390](before-summary-fix-390.png)。`02678c4`局部修正后只读重拍，未再次提交业务；摘要完整可见，1512/390页面无溢出，见[最终检查](final-paint.json)、[最终桌面](rework-1512.png)、[最终窄屏](rework-390.png)。两张最终截图已目视检查。

完成后仅归档本轮独立技术镜头，原试用镜头保持不变，页面返回原项目内容目录。见[清理脚本](cleanup-fixture.js)及[结果](cleanup.json)。本轮请求、意见和产物历史保留；没有删除或重置数据库。浏览器受控传输的更多存储故障与撤权检查单列于[独立前端证据](../2026-09-12-take-feedback/README.md)，不与实际服务证据混算。

# 画布上传验证

这些 Playwright CLI `run-code` 脚本记录本地技术夹具验收，连接生产构建、本地 API、PostgreSQL、对象存储及实际媒体 Worker。网络故障只丢弃已经成功提交的回包。没有真实模型、客户素材或生产环境验收。

在仓库根目录运行。脚本依赖当前已登录且有写权限的技术场次；包含固定本机场次的脚本需要替换为新的技术夹具。它们会添加节点／素材并测试撤销，不应针对客户项目执行。

- `verify-upload-drop.js`：实际拖入、占位、验收、固定节点与刷新。
- `verify-upload-lost-create.js`：实际创建提交后丢回包，刷新按原请求查回同一上传；返回的 `bytes` 仅为脚本生成的 96×64 技术 PNG。
- `verify-upload-resume.js`：延续该次上传，拒绝错误字节，再使用原文件恢复；撤销及刷新不重新插入。当前脚本的名称／uploadId 对应结果记录中的当次夹具。新一轮应替换为前一步返回的身份，并将返回的技术字节保存为 `upload-recovery-original.png`。随附 `upload-recovery-wrong.png` 是三字节无效文件。
- `verify-upload-multiple.js`：多个文件固定错位落点，切换分镜仍继续，撤销不重加。
- `verify-upload-manual-placement.js`：实际 complete 成功后丢回包；刷新保留已导入素材，明确放入才保存固定节点。`completeRequests` 来自本轮实际计数。
- `verify-upload-dismiss.js`：实际文件验收后移除待处理呈现，原素材仍可读取且为 ready，画布版本不变。
- `verify-upload-read-retry.js`：首次本机恢复查回收到受控 503，上传保持禁用；点击重新读取后实际核对并恢复操作。
- `verify-upload-expired-cleanup.js`：16 分钟前的自有本机未知记录先查服务器，确认缺失后移除，不新建上传、不改变画布修订。

`verification-results.json` 保存实际通过结果；16-upload-recovery 的三张截图在最终完整手动恢复测试后查看。早期一次多文件验收遇到 Worker 处理超时，另两次手动恢复遇到临时数据库连接失败，均未计作通过；保留的恢复记录在后续实际读取中仍存在。最终完整手动恢复流程无页面异常、无 GET 5xx。数据库容量和 RLS 验证另见实施记录及 integration 测试。

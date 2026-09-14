# 节点主体拖动与导航保留：浏览器验收

2026-09-14；Chrome 与 IAB 的真实页面操作，由整合任务执行并查看截图。基线为 PR #37 合入后的 `42cfb812c91a9e2a0da6cfe2ad3ed60dc3f6d2be`，修复来自 `feat/canvas-node-body-drag` 工作树的生产构建。截图覆盖修复过程，不统一代表最终提交；最后新增 session 等待竞态已另完成快速切换复验及本地检查，提交/CI 由整合任务记录。实现范围见[说明 67](../../../docs/implementation/67-canvas-node-drag-and-navigation.md)。

## 实际覆盖与恢复

使用已有本地演示项目和预制媒体，未另建项目或模型结果。下列行为结论来自实际操作及 [interaction-measurements.json](./interaction-measurements.json)，静态截图仅证明对应时刻的画面。

| 路径 | 实测结果 |
| --- | --- |
| 图片主体拖动、保存、刷新 | `(0,0) → (104.407,21.356)`；刷新仍为该位置；手动恢复 `(-1.42109e-14,0)`，为浮点误差范围内原位 |
| 林夏/周远双选移动 | 两节点同增量 `(104.407,21.356)`；一次 Undo 还原 |
| 文字/草稿/视频海报 | 主体均可拖动，分别 Undo；播放区域拖动不移动节点 |
| 专注编辑与手形 | textarea 仅选字 `2..50`、节点不动；文字模式往返保留后恢复原文；手形只移动 viewport，随后恢复 |
| 助手 | 无节点选择、无附件仍可输入；添加、核对、移除附件；未发送草稿刷新保留，后以键盘清空；没有发送生成 |
| 分镜台输入与候选 | SH-04 输入立即下一镜再返回、刷新保留；验收文字已清空。查看候选 1 不改变当前采用 2；采用确认取消，无采用提交 |
| 播放/总览/参考 | 播放后打开总览暂停；Esc 回原入口且时间保留；固定参考可查看 |
| 桌面/窄屏 | 1280×720 模式中心 `x=640`；助手矩形 `(920,64,360,656)`，贴右延伸到底部；390px 分镜台无横向溢出，画布显示窄屏内容列表 |
| 导入恢复入口 | 只查看 3 条原导入记录和按钮；未提交上传、重试或移除原记录 |
| 最终快速切换 | 390px 分镜台 SH-04/候选 2 刷新后立即点画布，自然等待核对后成功；1280px 画布刷新后立即切分镜台再切画布成功；两次均 `alerts=[]`。非空 AI 草稿「最终回归：保留这句对话。」随后快速分镜台→画布仍为原文、`alerts=[]`，最后用真实键盘清空 |

Chrome 错误日志 `[]`。拖动与测试输入已按上表恢复；没有新增候选、采用、项目、任务或模型调用。媒体本身与真实模型质量不在本轮验收范围。

## 截图索引

逐文件检查实际编码为 JPEG，已将采集时误用的 `.png` 扩展名统一更正为 `.jpg`；只改文件名，未转码或重写图像。尺寸来自文件头，不能将不同尺寸截图当作像素级前后对照。

| 文件 | 实际尺寸 | 可证明的画面 |
| --- | --- | --- |
| [before-selected-body-drag.jpg](./before-selected-body-drag.jpg) | 1280×720 | 主体拖动问题复现时的选中状态 |
| [after-image-body-drag.jpg](./after-image-body-drag.jpg) | 2048×1030 | 拖动后的节点布局；截图仍显示「保存中」，保存/刷新结论另见测量记录 |
| [canvas-video-controls.jpg](./canvas-video-controls.jpg) | 2048×1030 | 视频控制区域与节点布局 |
| [navigation-recovery-actions.jpg](./navigation-recovery-actions.jpg) | 2048×1030 | 导航受阻时的保留和重新核对入口，非最终竞态通过证明 |
| [canvas-chat-without-selection-1280.jpg](./canvas-chat-without-selection-1280.jpg) | 1280×720 | 无附件助手输入、贴右侧栏、居中模式切换 |
| [storyboard-draft-restored-1280.jpg](./storyboard-draft-restored-1280.jpg) | 1280×720 | 刷新后读取到原镜头提示 |
| [storyboard-overview-1280.jpg](./storyboard-overview-1280.jpg) | 1280×720 | 全场总览；暂停和焦点结论来自交互记录 |
| [storyboard-references-1280.jpg](./storyboard-references-1280.jpg) | 1280×720 | 固定参考面板 |
| [task-import-recovery-1280.jpg](./task-import-recovery-1280.jpg) | 1280×720 | 原导入记录与恢复入口 |
| [storyboard-390.jpg](./storyboard-390.jpg) | 390×844 | 分镜台窄屏、当前采用和镜头条 |
| [canvas-390.jpg](./canvas-390.jpg) | 390×844 | 窄屏画布内容列表 |
| [rapid-initial-navigation-390.jpg](./rapid-initial-navigation-390.jpg) | 390×844 | 最终修复后，分镜台刷新立即切画布的成功落点 |
| [rapid-navigation-final-1280.jpg](./rapid-navigation-final-1280.jpg) | 1280×720 | 最终桌面画布→分镜台→画布快速切换的成功落点 |

说明整理时另外实际查看了拖动后、无附件助手及390px分镜台三张原图；未用截图推断未记录的提交成功。

## 最终检查与证据边界

- 快速切换最后修复已实证：等待期间新挂载 session 动态加入同一屏障，共用 15 秒预算。存储/权限失败仍阻止离开，显式重新核对不重发业务动作；故障与截止时间规则由生命周期行为测试覆盖，不把它们全部算作浏览器故障注入验收。
- 最终 `npm run check` **221/221** 通过；生命周期专项 **28 项**、关联行为 **77 项**通过。217/217 为先前中间结果。未在此声明远端 CI 或合并完成。
- Space + 拖动仅代码审查；未作为浏览器实测通过项。没有付费生成、上传提交、全产品全分支验收声明。

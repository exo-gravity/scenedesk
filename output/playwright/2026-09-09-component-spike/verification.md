# 免费前端组件隔离验证记录

日期：2026-09-09。用途：为待与用户讨论的组件建议提供有限集成证据，不作为主应用迁移或业务验收。

样例在 [独立目录](../../prototypes/2026-09-09-component-spike/package.json)，独立安装107个包、自己的lockfile，不改主应用依赖。媒体是本地 FFmpeg 生成的4秒360×640测试信号，带音轨和两条VTT字幕，不是剧情样片或真实业务素材。测试音轨保持静音，没有人工听音验收。

## 已取得的证据

| 项目 | 实际结果 |
|---|---|
| 安装 | npm install --ignore-scripts，无 force/legacy-peer-deps，未修改第三方源码 |
| 类型与构建 | TypeScript5.9.3 strict、skipLibCheck=false与Vite7.3.6 build通过，见[构建日志](../../prototypes/2026-09-09-component-spike/build-evidence.txt) |
| 依赖审计 | 隔离样例npm audit返回0漏洞，见[原始JSON](../../prototypes/2026-09-09-component-spike/audit-evidence.json)；不代表主应用或全部许可审核 |
| Mantine表单 | 必填错误、中文输入、Select选项、保存结果通过 |
| 弹窗焦点 | 打开聚焦输入，Esc关闭、焦点返回触发按钮通过 |
| Splitter | 键盘尺寸15→16，折叠为0，再展开恢复16；localStorage记录[16,59,25] |
| Media Chrome | 真实4秒视频加载，播放至约0.93秒后暂停，媒体尺寸360×640，字幕track存在，控件切换disabled/showing |
| Virtual | 1000条数据在初始可见区实际挂载11条，不是渲染1000个DOM元素 |
| Query | 模拟Promise数据读取和状态展示可运行；未验证真实API/SSE/CAS行为 |
| dnd-kit | 带间隔的键盘移动改变顺序；CLI dragTo使SH03从首位移到末位，结果SH02,SH01,SH03，见[拖拽后快照](pointer-sort-snapshot.yml) |

## 暴露的问题与证据限制

首次严格编译遇到第三方声明中的 ReadonlySetLike / Float16Array 缺少lib定义，以及样例sizes类型过宽。样例补充ESNext.Collection/ESNext.Float16类型声明，使用公开SplitterPaneSize类型后通过；target仍为ES2022。补充类型声明不会自动提供运行时polyfill，主项目集成仍需验证支持的浏览器，不由这次编译推断全兼容。

样例将所有库放在单个页面：最终JS约776.6KB、gzip228KB，CSS约238.3KB、gzip35.3KB，触发Vite大chunk提示。这里不是生产加载策略；正式接入应按路由/功能拆分和实测，不因此宣称包体优势。未通过调高阈值隐藏提示。

组合脚本并非一次全通过：[首次结果](interaction-evidence.txt)留下失败；[复查原始结果](interaction-recheck.txt)中各基础功能通过，但脚本执行两次ArrowDown后仍期望只移动一个位置，导致总断言为false。不能把该文件说成整套测试通过。键盘输入的快速连续事件还受启动和动画时机影响，正式操作规范与稳定自动化需要单独验证。

[进一步组合检查](targeted-recheck.txt)等待超时。随后使用CLI dragTo取得了上述实际排序证据，未修改组件源码；尚未完成完整的布局刷新恢复、长列表滚到底部、虚拟化与拖拽组合、所有指针/键盘节奏及跨浏览器回归。有限样例不足以宣布dnd-kit全部边界已验证。

最初favicon请求404已用本地data图标处理；[后续控制台](console.txt)记录0 errors/0 warnings，保留React开发提示。没有对生产可访问性、私有媒体签名续期、混合格式、跨镜声音、完整渲染、中文播放器控件本地化或当前主原型全局CSS冲突作通过声明。

## 结论

这套组件具备共同安装、严格编译及运行核心交互的实际依据；仍有明确接入验收范围。研究建议待用户确认，当前不推进主应用迁移。

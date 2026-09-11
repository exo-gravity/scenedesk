# 画布容量浏览器证据

2026-09-11；本地独立技术项目。结论和环境边界见 [容量报告](../../../docs/implementation/42-canvas-browser-capacity.md)。原始结果不含会话、CSRF、媒体签名地址或运行凭据。

## 数据索引

- [统计汇总](data/summary.json)：300 / 2000 各自的基线与优化后 P50、P95、最大值及样本数。
- [CPU 自采样对照](data/cpu-profile-summary.json)：同一 2000 节点场景八次文字修改，比较器热点 40.60% → 0.88%。
- [折叠面板、明确恢复与窄屏](data/lazy-controls.json)：关闭时无控件、键盘展开、查询保留、刷新恢复无效分组缓冲及 390px 页面宽度。
- `data/entry-*-*.json`：各 20 次完整重载的原始时间、可见节点/边、DOM 数量及可得 JS heap。
- `data/select-*-*.json` / `edit-*-*.json` / `search-*-*.json`：原生事件到可观察 DOM 的逐次数据；编辑包含实际请求字节数、服务端读回文本与刷新结果。
- `data/frames-*-*.json` / `overview-*-*.json`：每轮所有 RAF 间隔、实际 viewport transform、长任务。局部与全览必须分别解读。
- `data/memory-*-*.json` / `media-*-*.json`：可得 CDP/JS heap 及播放器状态，不能当作整个浏览器 RSS 或长期无泄漏证明。优化后媒体截图是在加载完成后明确点击“定位当前内容”入框的画面。

## 已查看的生产构建画面

- [300 节点实际播放](300-optimized-video.png)
- [2000 节点实际播放](2000-optimized-video.png)
- [2000 节点窄屏列表](2000-optimized-narrow.png)

播放器声音模式使用隐藏画面的 video 元素；状态证据以真实播放状态和实例释放为准，不从单张截图推断播放成功。

## 复跑方法

`harness/` 保存了已使用的 Playwright CLI `run-code` 函数模板，不是独立 Node 程序。先用仓库 lockfile 安装/构建，再在独立 headed 浏览器登录受控的本地测试身份。

1. 在获授权的本地技术工作室运行 [create-fixture.js](harness/create-fixture.js)，创建一个新技术项目、两场和三个小型技术素材。保存返回的映射到忽略目录，不提交运行清单。此步骤是真实写入，仅对自己的新夹具执行。
2. 三个上传验收/预览 ready 后，向 [populate.js](harness/populate.js) 的 `__FIXTURE__` 填入该映射，`__COUNT__` 先为 300，再在前一组结束后改为 2000。保存返回的 case 映射，仅使用自己刚创建的画布。该模板的 initial text 以实际返回值为准，A/B 前逐字核对并重置同一来源文本。
3. [initialize.js](harness/initialize.js) 固定 1512 × 982 并建立测试端口的 API Origin 别名。报告里的 4318 / 4311、以及 [media.js](harness/media.js) 中的本地媒体 Origin 只适用于记录时环境；其他环境应按其实际受控配置调整，不能修改生产允许列表来跑测试。
4. 将 `__CASE__` 替换为新 case 的 JSON，使用 CLI `run-code` 依次执行 [entry](harness/entry.js)、[select](harness/select.js)、[edit](harness/edit.js)、[profile](harness/profile.js)、[frames](harness/frames.js)、[overview](harness/overview.js)、[search](harness/search.js)、[memory](harness/memory.js)、[media](harness/media.js)。同一时间仅运行一个浏览器动作脚本、一个容量 case；每次完整退出后再进行下一步。
5. 按对应状态执行 [lazy-controls.js](harness/lazy-controls.js)。刷新后点击产品已有的“恢复本机修改”，再验证无效输入缓冲；不要把等待自动恢复的脚本超时当作产品丢失输入。
6. 用完整重载切换构建；hash 导航不能更换已加载的 bundle。统计按报告中的 nearest-rank 公式重算，保留失败/长帧，勿把诊断错误或一张截图当作 P95。不得在其他 agent 的重型测试期间把结果称为独占基准。

采样器原始日志、完整 CPU profile、浏览器 console 和私有运行配置留在忽略目录，没有进入本证据包。提交的模板需要本地会话提供授权；没有嵌入访问凭据。

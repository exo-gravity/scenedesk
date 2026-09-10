# 前端媒体播放、轻量编排与渲染组件评估

调研日期：2026-09-09。适用环境：React 19、Vite 7、TypeScript 5.9；当前页面仍是本地视觉原型。本专项只做资料、包元数据和许可证核对，未安装依赖、修改应用或声称完成媒体链路验证。综合裁决与后续隔离样例结果见 [17 前端选型](../implementation/17-frontend-component-selection.md)。其中“草稿预览任务”属于研究建议；综合裁决先复用已有固定 CutRevision 的渲染契约，不因本研究直接新增可变草稿渲染 API。

## 1. 决定与适用范围

**默认选择 Media Chrome 4.19.2 的 React 组件配合原生 `video` / `audio`，用于候选、素材和已生成的场次审阅文件。轻量编排保持现有 Timeline / CutRevision 领域模型，由服务端 FFmpeg 负责统一生成可连续播放的草稿预览和固定版本成片。首期不引入完整视频编辑器 SDK。**

Vidstack 1.15.6 是有价值的替代方案。如果实测发现 Media Chrome 在我们的字幕、播放器状态控制或无障碍需求上需要明显额外开发，再切换到 Vidstack；不同时维护两套播放器。

这一决定基于本项目的主要媒体来源是上传、模型生成和平台渲染的私有素材，首期以可控的 MP4 制作副本为主，外站视频聚合、直播和 DRM 均非核心需求。Media Chrome 提供可组合的播放器控件，并直接连接原生媒体元素，适合这个范围。它有官方 React 包装组件，无须使用 Mux 托管视频服务。[Media Chrome 项目与示例](https://github.com/muxinc/media-chrome)、[官方 React 指南源文件](https://github.com/muxinc/media-chrome/blob/main/docs/src/pages/docs/en/react/get-started.mdx)

这是项目适配判断，不是对全部播放器的通用排名。选择免费组件的目标是降低全周期开发与维护成本；不把“依赖更多”“无需购买许可证”当作已经解决媒体工程问题。

## 2. 播放器比较

以下版本和 `peerDependencies` 来自本次直接读取 npm Registry；含义是发布方声明的兼容范围，不等于已在本项目验证。登记为候选版本，工程安装时应固定精确版本并验证依赖树。

| 方案 | 本次核对版本 / 许可 | 适合本项目的能力 | 代价与边界 | 结论 |
|---|---|---|---|---|
| Media Chrome | `media-chrome@4.19.2`，MIT | 原生 video/audio 外的播放、进度、音量、字幕、全屏等可组合控件；官方 React 导出；较容易统一到工作台视觉 | 媒体归一、签名 URL、错误恢复、精确业务时间映射仍需平台实现；原生字幕通常需要 VTT | **MVP 默认** |
| Vidstack | `@vidstack/react@1.15.6`，MIT，React 18 / 19 | React API、媒体状态、成熟布局、多种 provider、字幕与缩略图；单媒体入出点裁切 | 需明确采用当前文档对应的 1.x 包；provider 与状态体系比本项目首期需求更宽；不提供场次合成和正式渲染 | 备选，实测需要时切换 |
| Video.js | `video.js@8.24.0`，Apache-2.0 | 成熟播放生态、流媒体和插件扩展 | 8.x 官方 React 集成需要管理实例创建、更新、dispose；定制编辑工作区时仍要桥接 React 与播放器自身状态 | 有直播、广告播放或既有 Video.js 插件需求时再考虑 |
| ReactPlayer | `react-player@3.4.0`，MIT，React 17 / 18 / 19 | 统一多个视频站点及文件来源；可与 Media Chrome 组合 | 我们首期不需要外站 URL 自动识别；加一层 provider 抽象仍不会获得剪辑或渲染能力 | 首期不引入 |
| 原生 `video controls` | 浏览器平台能力，无额外组件包 | 单文件播放的最低实现成本，便于降级与诊断 | 跨浏览器外观不统一；工作台键盘、控件布局和状态反馈需要补充 | 保留底层与降级入口，不作为完整产品控件方案 |

来源：[Media Chrome](https://github.com/muxinc/media-chrome)、[Vidstack 能力说明](https://vidstack.io/docs/player/)、[Video.js 8 React 集成](https://legacy.videojs.org/guides/react/)、[ReactPlayer 官方仓库](https://github.com/cookpete/react-player)。包快照可复核：[Media Chrome Registry](https://registry.npmjs.org/media-chrome/4.19.2)、[Vidstack Registry](https://registry.npmjs.org/@vidstack/react/1.15.6)、[Video.js Registry](https://registry.npmjs.org/video.js/8.24.0)、[ReactPlayer Registry](https://registry.npmjs.org/react-player/3.4.0)。

### 2.1 Vidstack 的实际版本陷阱

本次 npm 查询显示：

| npm 标签 | 解析版本 | 声明的 React 范围 | 发布时间 |
|---|---|---|---|
| `latest` | 0.6.15 | React 18，另有旧版 vidstack / maverick peers | 2024-04-19 |
| `next` | 1.15.6 | React 18 / 19 | 2026-06-10 |

官方当前安装文档使用 `@vidstack/react@next`。因此直接无版本安装会取到另一代 API；不能把 1.x 文档与 0.6 包混用。若选 Vidstack，应明确固定 `1.15.6` 并对照对应源码。[官方安装说明](https://vidstack.io/docs/player/getting-started/installation/react/?bundler=none&provider=video&styling=default-layout)、[0.6.15 元数据](https://registry.npmjs.org/@vidstack/react/0.6.15)、[1.15.6 元数据](https://registry.npmjs.org/@vidstack/react/1.15.6)

**不能仅凭 `next` 标签判定 Vidstack 不成熟或停更。** 本次检查发现 Vidstack 主分支 2026-08-21 仍有播放器问题修复；Media Chrome 同期也有维护，但最近一次 push 是 README 修正。两者的维护事实不足以支持“一个明显停更”的结论。选择 Media Chrome 的主要理由是项目媒体来源和所需抽象更简单，而非标签或星数。[Vidstack 提交历史](https://github.com/vidstack/player/commits/main/)、[Media Chrome 提交历史](https://github.com/muxinc/media-chrome/commits/main/)

### 2.2 Media Chrome 集成原则

- 使用 `media-chrome/react`，播放器控件作为专业组件，与通用 UI 库共享颜色、字体、间距和焦点规范；不为统一组件品牌重新实现播放控件。
- 单一活动播放器默认发声；候选并排比较时显式指定监听哪一路，避免同时播放两路对白。
- 业务审阅标记直接使用固定媒体及其时间信息；不将播放器内部状态写成新的剪辑数据源。
- 播放身份是不可变 `mediaId` / 渲染结果身份，签名 URL 只是临时访问凭据。URL 到期可以更新地址和恢复位置，但不能因此把新版本替换进旧审阅。
- 原生视频元素与播放器控件应在同一全屏容器内，保证评论标记、字幕和必要业务叠加层行为明确；不能假设系统画中画会携带任意 React 叠加层。

后两项为本项目的工程约束，需要通过真实浏览器验证；不是组件自动提供的业务保证。

## 3. 免费编辑 SDK 值不值得直接复用

只比较与本 MVP 实际相关的几类方案；不因演示界面完整就视为可直接嵌入的免费 SDK。

| 项目 | 已核对事实 | 本项目判断 |
|---|---|---|
| Remotion | `remotion@4.0.522` 的包许可证为 `SEE LICENSE IN LICENSE.md`；当前免费许可包含个人、最多 3 名员工的盈利组织及非营利组织，超出范围要求公司许可 | React 编排和统一渲染能力有价值，但不符合我们希望底层能力不因组织规模转为付费的目标，**不选为免费底座** |
| Twick | `@twick/studio@0.15.31` 声明 React 18 / 19；拥有 timeline、live player、浏览器和服务器渲染包；采用自定义 SUL，而不是 MIT | README 的 SaaS 示例与正式 LICENSE 的限制存在需要澄清的差异，不能认定我们的商业工作台可以无条件免费长期使用；**本轮排除** |
| Diffusion Studio Core | `@diffusionstudio/core@4.0.3` 的发布包与主分支 LICENSE 均为 MPL-2.0；浏览器组合、实时播放、WebCodecs 渲染；README 仍说明无水印需购买 key，并明确不面向服务器渲染 | 不能继续引用旧版本“非商用许可”结论；但在“不改第三方源码、免费无水印正式输出、后台可靠渲染”的组合要求下，**不作为首期主引擎** |
| OpenCut | MIT；当前主仓库正在整体重写，Editor API、插件和 headless 是其新架构计划；官方建议现阶段使用 classic | 可借鉴分镜条、字幕与剪辑操作，但完整应用不等于可稳定嵌入的 SDK；**不 fork 成为平台基础** |
| Mediabunny | `mediabunny@1.56.0`，MPL-2.0；浏览器媒体读取、写入、转换和 WebCodecs 相关底层能力 | 适合后续浏览器帧读取、局部预览或导出实验，不提供我们需要的完整场次工作台；**保留专项候选** |

来源：[Remotion 许可](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)、[Remotion 当前包](https://registry.npmjs.org/remotion/4.0.522)；[Twick 功能与 README](https://github.com/ncounterspecialist/twick)、[Twick 正式许可](https://github.com/ncounterspecialist/twick/blob/main/LICENSE.md)、[Twick 当前包](https://registry.npmjs.org/@twick/studio/0.15.31)；[Diffusion 功能与价格说明](https://github.com/diffusionstudio/core/blob/main/README.md)、[Diffusion LICENSE](https://github.com/diffusionstudio/core/blob/main/LICENSE)、[Diffusion 当前包](https://registry.npmjs.org/@diffusionstudio/core/4.0.3)；[OpenCut 当前状态](https://github.com/opencut-app/opencut)、[Mediabunny](https://github.com/Vanilagy/mediabunny)、[Mediabunny 当前包](https://registry.npmjs.org/mediabunny/1.56.0)。

### 3.1 两处容易误读的许可证

**Twick：** README 解释称可将编辑器用于面向创作者的商业 SaaS；但正式 LICENSE 第 3、4 节对托管服务、SaaS、竞争产品和由软件功能产生显著收入写有商业协议要求。这是资料边界不清晰，不能凭 README 的概述覆盖正式条文。本轮直接选其他已明确可用的方案，无须让用户额外完成许可确认。[README](https://github.com/ncounterspecialist/twick)、[LICENSE](https://github.com/ncounterspecialist/twick/blob/main/LICENSE.md)

**Diffusion Studio：** 当前 4.0.3 已不是旧非商用许可证，MPL 本身允许商业使用并规定覆盖文件的源码义务。同时官方支持的无水印路径仍是购买 key。本报告不把 MPL 误说成禁止商业，也不把研究、修改水印逻辑当作“零定制、开箱即用”的方案。免费无水印输出与服务器渲染都不是本次已验证能力。[Mozilla MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)、[Diffusion 当前 README](https://github.com/diffusionstudio/core/blob/main/README.md)

## 4. 首期媒体方案：复用播放器与 FFmpeg，自己保留业务编排

### 4.1 复用边界

| 层次 | MVP 实现 | 负责什么 |
|---|---|---|
| 镜头规划与采用 | 现有分镜卡片、镜头顺序和候选模型 | 描述想制作什么；采用候选不自动改剪辑 |
| 轻量剪辑 | 现有 Timeline / CutDraft / CutRevision，加分镜条、裁切与声音／字幕控制 | 描述具体用了什么素材、源区间和出现时间 |
| 单媒体与成片播放 | Media Chrome + 原生媒体元素 | 播放控制、字幕开关、声音、全屏、素材错误反馈 |
| 草稿连续预览 | 服务端 FFmpeg 草稿预览任务 | 将同一份已保存编排合成为可连续播放的文件；可用较低画质 |
| 固定版本审阅 | 冻结 CutRevision 后渲染，播放该版本不可变成片 | 可靠评论锚点、版本追溯和正式审阅依据 |
| 导出与整集复用 | 原有 render / delivery 任务体系 | 使用冻结版本输出成片、字幕与来源映射，不依赖用户浏览器持续开着 |

此处沿用已有设计，未另建 SDK 私有时间线格式。现有模型已定义整数微秒、半开区间、帧率分子分母，以及一个主视频轨和必要独立声音／字幕轨。[领域数据模型](../implementation/03-domain-data-model.md)、[场次 MVP 收尾约定](../implementation/14-scene-mvp-closure.md)

### 4.2 草稿播放与正式审阅的区别

第一阶段优先把“保存当前编排 → 生成预览 → 连续检查 → 冻结提交审阅”做可靠。拖动或裁切时可以即时查看当前源片段、入出点截图和更新后的长度；连续检查依赖与该草稿版本相符的合成预览。页面应明确显示预览对应的修订，编排变化后提示需更新预览，不能把旧视频标成新结果。

这是一个有成本的产品取舍：**连续预览有渲染等待，但首期不用同时建设完整浏览器媒体合成引擎和服务器渲染引擎。** 必须实际测量一场戏的预览等待和返工次数；如果等待妨碍创作，则在后续加入局部接点预览、代理预渲染或浏览器实时组合，而不是把异步等待包装成即时预览。

草稿和正式渲染使用同一份编排语义、素材归一策略、剪辑区间换算、声音混合与字幕布局逻辑。分辨率和码率可以不同，时间关系不能不同。只有固定版本对应的正式渲染文件才可开启正式审阅，避免边改边看导致评论落在不同内容上。若当前已定交互要求每次裁切后立即无等待连续播放，需要明确增加实时引擎工程任务；免费播放器本身无法兑现这一要求。

### 4.3 保留跨镜声音，不能只拼接视频文件

第一版仍需支持已有约定：视频原轨保留／静音，独立音频片段、字幕以及读取视频已有混合音轨。人物说话时切到对方反应镜头，前一句对白继续，需要声音片段与视频切点独立。

对于同时保留原音和抽取同一原音的操作，应明确默认静音关系，避免双份对白。读取视频混合音轨不等于自动分离人声、音乐与环境声；现有模型已明确这一边界。[领域模型中的声音约束](../implementation/03-domain-data-model.md)、[声音与口型验收](../implementation/13-production-quality-and-handoff.md)

FFmpeg 已提供 trim / atrim、时间戳调整、concat、amix、adelay、音量与字幕等基础处理能力；平台负责把受限业务模型转换为确定的处理计划，而不是重新实现编码器。[FFmpeg filter 文档](https://ffmpeg.org/ffmpeg-filters.html)

## 5. 浏览器限制与实现要求

1. **连续换 `src` 不等于无缝剪辑。** 不同编码、帧率、首帧解码和缓冲会导致停顿或不同步；首期不靠多个播放器轮流播放来充当可批准的成片。
2. **`timeupdate` 不适合定义帧精度。** 播放中的审阅位置可利用 `requestVideoFrameCallback` 提供的媒体 PTS，但该回调本身也没有严格同步保证；业务最终时间仍以媒体时间和固定映射为准。逐帧查看需要对应帧解码或已生成的帧图，不能声称反复设置 `currentTime` 就已实现专业逐帧定位。[浏览器帧回调说明](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback)
3. **WebCodecs 是底层能力。** 它不提供完整文件的解封装、封装和剪辑工作台，也不能保证任意客户浏览器都支持所需编码组合。若将来引入 Mediabunny 等引擎，仍要做能力检测、设备性能与内存验证。[WebCodecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)
4. **声音播放受用户激活策略约束。** 明确处理 `play()` 被拒绝、缓冲和源不可播放；不能让 UI 已显示播放而媒体尚未启动。[HTMLMediaElement.play](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play)
5. **私有媒体需要服务端配合。** 对象存储必须支持正确的 MIME、Range 请求和 CORS；预览转码文件保留不可变身份。跨域取帧、字幕和 Web Audio 访问需要一起测试，不仅测试 URL 能否在新标签页打开。
6. **字幕播放和字幕成片要区分。** 后端保留统一字幕结构并输出 SRT 交付文件、VTT 播放文件；若要求准确审查字幕字体、断行、位置，应使用与导出一致的烧录审阅文件，或另行验证叠加渲染一致性。
7. **不把 ffmpeg.wasm 作为首期正式渲染方案。** 其官方 FAQ 说明相对原生 FFmpeg 的性能与内存成本，且 MIT 的 JS 包装层并不意味着编译后的 FFmpeg 核心及所有编码库都是 MIT。后台导出也不应依赖用户标签页存活。[ffmpeg.wasm FAQ](https://ffmpegwasm.netlify.app/docs/faq/)

第 1、5、6 项为本项目根据媒体来源与审阅要求制定的工程约束；本次未做浏览器实测。

## 6. 许可与版本落实

- `media-chrome@4.19.2` 是本轮播放器选定基线；Vidstack、Video.js、ReactPlayer 不同时加入依赖。安装前再次核对精确版本、React 包装依赖、LICENSE 与锁文件，保留依赖声明。
- FFmpeg 是免费开源媒体工具，不能笼统写成 MIT。官方说明其基础许可为 LGPL-2.1-or-later，启用某些可选部分后适用 GPL。服务端构建时记录实际版本、镜像摘要、`-buildconf`、编码库和许可；不把含 `--enable-nonfree` 的未知预编译包默认当作可分发成品。GPL 本身也不等于不可商用。[FFmpeg 许可说明](https://ffmpeg.org/legal.html)
- 组件软件许可与计算、存储、流量及编解码标准涉及的权利不同。这里决定的是不购买播放器／编辑 SDK 席位许可；不承诺视频处理总成本为零。
- 本次没有安装 FFmpeg 或验证服务器渲染镜像，因此不在文档里虚构已验证的 FFmpeg 构建版本。镜像与编码配置随首个真实渲染任务固定。

## 7. 工程接入验收与后续路线

### 首期接入，使用一场真实样片验证

| 验证项 | 通过含义 |
|---|---|
| React 19 严格模式与路由切换 | 控件、事件和媒体资源正常释放，不出现双重声音或遗留播放器 |
| 私有 MP4 候选与固定版本 | 播放、跳转、暂停、音量、加载失败和 URL 续期行为正确，媒体身份不漂移 |
| 桌面工作区 | 窄面板、拖动分隔条、键盘、全屏和字幕布局可用 |
| 混合输入 | 竖屏／横屏、不同帧率、无音轨和带音轨素材按既定归一规则生成代理与成片 |
| 跨镜声音 | 一句对白跨两个镜头连续播放，原轨静音关系正确，不截字或双重播放 |
| 草稿与正式成片 | 素材顺序、裁切边界、字幕起止和声音关系一致；草稿改变后旧预览可识别 |
| 固定评论 | 评论打开旧版本的正确时间，继续制作新版本不会移动旧评论 |
| 短场次周转 | 记录样片长度、素材量、设备／服务端配置、预览等待和导出时长，再决定是否增加实时引擎 |

这些是待实施验收，不能计入当前视觉原型已通过测试。

### 后续按问题增加能力

1. 当渲染等待成为高频痛点：先加缓存、低清代理、接点局部预览和任务去重；同一修订生成同一预览身份。
2. 需要更即时的交互预览时：独立验证 Mediabunny / WebCodecs 读取、音频主时钟、帧调度和渲染一致性；通过后再接入播放器业务界面。
3. 用户确实需要复杂剪辑时：重新评估成熟编辑 SDK 或扩展专业后期交接，不把 MVP 的分镜条逐步堆成未经设计的 NLE。
4. 增加广告场景时：复用媒体、声音、字幕、播放、渲染与版本模型，再按需求增加模板化构图和动态图文；不因广告可能用到动画就预先把 Remotion 变成首期付费依赖。

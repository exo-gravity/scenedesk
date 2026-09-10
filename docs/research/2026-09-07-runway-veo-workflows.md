# Runway 与 Google 视频模型：制作流程核查

调研日期：2026-09-07。面向 AI 写实短剧。仅查官方公开文档与文档内嵌 API schema；未付费生成，不评价画质排名、中文对白效果或实际可用率。

## 结论

- 不能用“Seedance 音画一体，其他模型都是先图后视频再配音”概括现状。Veo 3.1 已有公开原生音频 API；Google 当前另有 Omni Flash 多轮生成/编辑路线。Runway 则要区分 Gen-4.5 生成、Act-Two 表演驱动、Aleph 2.0 视频修改，以及其平台托管的第三方模型。[Google 视频入口](https://ai.google.dev/gemini-api/docs/video)、[Runway 模型清单](https://docs.dev.runwayml.com/guides/models/)
- 下面列出的“工作流建议”是产品设计推论。参考素材、时长和声音控制必须按具体模型版本、API 入口和生成模式适配，不能把消费端应用、研究展示和 API 参数合并成一份能力承诺。

## Runway：已核实的控制路径

| 路径 | 事实 | 对工作台的含义（推论） |
|---|---|---|
| Gen-4.5 文生／图生 | 当前帮助列出 Text to Video 和 Image to Video；图生侧提示词主要描述运动，文生侧还需描述视觉内容。支持 2–10 秒。 | 可以直接文生，也可以先定好人物与构图，再制作动作；分镜参考图不能一概视为多图角色参考。 |
| Gen-4.5 API | 本次直接读取官方 API 页内嵌 OpenAPI：图生 `promptImage` 只允许一个 `first` 帧；没有角色参考数组、末帧、视频参考或表演参考字段。 | 角色多图、场景多图应先合成所需首帧，或改选具备对应输入的模型；不能把资产库全量直接塞入。 |
| Act-Two | API 接收角色图或角色视频，加 3–30 秒的表演视频，可调表情强度及身体控制。官方双人教程采用分别驱动人物再合成的路径。 | 需要“角色外观素材”和“表演素材”两种引用角色，后期合成也是工作的一部分。 |
| Aleph 2.0 | 官方 Edit Studio 支持修改已有单镜头或多镜头视频；API 输入不超过 30 秒的视频，可提供至多 5 个带时间位置的关键帧。 | 先挑原视频、修改关键帧，再传播到视频；应保留源视频和修改范围，不必每次重新文生整段。 |

表格依据：[Gen-4.5 使用帮助](https://help.runwayml.com/hc/en-us/articles/46974685288467-Creating-with-Gen-4-5)、[图生 API](https://docs.dev.runwayml.com/api/#tag/Start-generating/paths/~1v1~1image_to_video/post)、[表演 API](https://docs.dev.runwayml.com/api/#tag/Start-generating/paths/~1v1~1character_performance/post)、[双人表演教程](https://help.runwayml.com/hc/en-us/articles/41748090660499-Creating-Multi-Character-Dialogues-with-Act-Two)、[Edit Studio](https://help.runwayml.com/hc/en-us/articles/51683104370451-Creating-with-Edit-Studio)、[视频修改 API](https://docs.dev.runwayml.com/api/#tag/Start-generating/paths/~1v1~1video_to_video/post)。

### Gen-4.5 音频：不能沿用旧印象，也不能跨过证据缺口

Runway 的 GWM-1 官方研究文章明确宣布 Gen-4.5 原生音频生成、音频编辑、多镜头视频编辑；但同一节末尾也写明这些新能力将进入 Web 产品。它证明模型能力的宣布，不能单独证明某个今天的生产 API 已开放这些控制。[官方研究声明](https://runway.com/research/introducing-runway-gwm-1)

本次已核对文生、图生当前 schema，未见音频输入、音轨编辑、声线 ID 或音频开关；输出格式说明出现“当输出有音频时另附 WAV”的条件描述。因此应记录为“原生声音已宣布，当前所选接口的对白/音频控制待验证”，不能据此断言完全无声，也不能承诺可按角色声音参考生成。[当前 API](https://docs.dev.runwayml.com/api/)、[输出格式说明](https://docs.dev.runwayml.com/guides/models/#professional-and-hdr-output-formats)

Act-Two 是主动选择表演可控性的路径，不是“所有 Runway 视频必须补音”的证明。双人教程要求各自表演输入，单次驱动单角色，输出再合成；多角色不是一个调用中直接指定两个表演驱动。[双人表演教程](https://help.runwayml.com/hc/en-us/articles/41748090660499-Creating-Multi-Character-Dialogues-with-Act-Two)

### 平台与模型不能混为一谈

Runway 的产品含 Seedance、Kling、Veo 等第三方模型及 Apps。Multi-Shot、Image to Dialogue、Animate Frames 等应用名称不表示这些都是 Gen-4.5 单一 API 的参数；官方把 Apps 定义为针对任务组合生成工具的流程。[Runway Apps](https://help.runwayml.com/hc/en-us/articles/45570040112531-Creating-with-Apps)、[Runway 产品](https://runway.com/product)

API 媒体输入需要正确 MIME、可下载 HTTPS 地址或临时上传；临时上传只有 24 小时可用。工作台必须自己保存长期资产并在提交时提供有效输入，不能把供应商临时 URI 当作角色库资源身份。[输入文档](https://docs.dev.runwayml.com/assets/inputs/)

## Veo 3.1：有声音的短片段生成与明确的续写模式

| 输入／操作 | 已核实的行为 |
|---|---|
| 文生与原生声音 | 提示词可指定对白、环境声和音效；官方给出双人对白示例，音画同步生成。 |
| 首帧／首尾帧 | `image` 是待动画化的首帧；`lastFrame` 必须配合 `image`，不能单独给尾帧。 |
| 参考图 | 支持最多 3 张参考图；这是指导内容的输入，与固定首帧不是同一语义。 |
| 时长与分辨率 | 参数表列 4/6/8 秒；使用参考图或 1080p/4K 时要求 8 秒，不能独立自由组合。 |
| 续写 | Gemini API 只续写此前 Veo 生成的素材，每次增加 7 秒，续写为 720p；不能把任意供应商视频作为等价续写输入。 |
| 声线续接 | 官方提示：最后一秒没有声音时，声音无法有效延续。原生音频不等于跨片段声音身份锁定。 |

表格依据：[Gemini API 的 Veo 指南](https://ai.google.dev/gemini-api/docs/veo)。Google Cloud 模型卡也确认音频生成、首尾帧和素材参考，并将音频列为不支持的输入模态；因此不能把可生成对白解释为可上传声音参考或绑定自定义声线。[Cloud Veo 3.1 模型卡](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate)

Cloud 的主体参考指南描述“同一个人物、角色或产品的最多三张图”；Gemini API 的展示与参数说明更宽泛。多人物同时绑定的可靠流程不可仅凭“三图”推定，首轮可先制作双人构图首帧并验证。不同入口的参考适用范围应分别记录。[Cloud 主体参考指南](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/video/generate-videos-from-references)

未核实 Veo 3.1 提供任意区域的通用视频修改 API；不能把 Flow 的产品编辑操作当作同名 Veo API。Google 的旧 Vertex Veo API URL 本次重定向到通用 REST predict 页，因此以当前模型卡、具体生成指南和 Gemini API 为依据。

## 不能遗漏 Google 当前的 Omni Flash 路线

Google 当前视频入口推荐默认尝试 Gemini Omni Flash，保留 Veo 的续写、尾帧等用途。此为供应商建议，不是本报告的质量排名。[官方入口](https://ai.google.dev/gemini-api/docs/video)

Omni Flash 的 Interactions API 提供自然语言多轮修改，可用 `previous_interaction_id` 继续迭代；这要求工作台保存供应商交互关系。参考素材与首尾帧也有明确不同的标签语义。[Omni API](https://ai.google.dev/gemini-api/docs/omni)

但同页限制明确：当前 API 不支持上传音频参考、不支持声音编辑，视频参考中的音频被忽略；上传视频的对白续写有额外限制，通过已有生成的多轮关系续写对白是另一条路径。首页“原生多模态”能力描述不能覆盖这些具体限制。页面对“多个短视频参考”与“多视频推理”的边界也存在需要实测澄清的表述。[Omni 限制](https://ai.google.dev/gemini-api/docs/omni#limitations)

## 相同双人对白场景的建议流程（推论，未生成验证）

场景：“女主把信放在桌上，问‘这封信，你看过了？’；男主避开目光，回答‘没有。’”

1. **Veo 原生音画路径：**确认人物和空间 → 直接提示或先制作双人首帧 → 在约定短片段内安排对白、停顿与反应 → 同时审画面与声音 → 必要时续写／补反打 → 剪辑。若跨片段声线无法达标，再采用独立配音和口型方案；不能预先承诺原生声音一致。
2. **Runway 精细表演路径：**录制／准备双方对白表演 → 定角色图或基础人物视频 → 分别以 Act-Two 驱动 → 合成或正反打剪辑 → 补环境声。它增加表演准备和合成工序，但明确暴露了表情、口型与动作来源。
3. **Runway 局部修片路径：**保留已满意的动作 → 挑一个或多个关键帧改服装／背景 → Aleph 2.0 传播修改 → 复审人物、口型、声音与时序。不能把“尽量保留其他内容”视作确定性无损编辑。
4. **Omni 多轮路径：**准备角色／场景参考 → 生成音画片段 → 保存交互 ID → 按自然语言逐轮修改视觉 → 复审并收敛采用版本。声音修改不能套用视觉修改能力。

建议工作台将“直接生成、首帧驱动、多参考、表演驱动、续写、视频修改”做成可选制作方法，再按具体接口展示可用素材和约束。无需让用户重建剧本、角色或项目结构来切换模型。

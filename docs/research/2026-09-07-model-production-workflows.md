# Seedance 与常见视频模型：短剧制作流程比较

调研日期：2026-09-07。场景：中小工作室的 AI 写实短剧。仅核查官方模型说明、产品帮助和 API 文档，未做生成质量、费用或多人生产实测。用户确认的 Seedance 优先策略保持不变；以下比较帮助选择制作方式，不是模型排名。

## 1. 核心判断

不能把流程概括为“Seedance 多镜头音画生成，其他模型先图后视频再配音”。可灵 3.0、万相 3.0、Veo 3.1 都有原生声音证据，前两者也有多镜头控制说明。需要比较的是具体版本、服务入口、模式和允许的输入组合。[可灵指南](https://kling.ai/quickstart/klingai-video-3-model-user-guide)、[万相指南](https://help.aliyun.com/zh/model-studio/wan3-video-generation-guide)、[Veo 指南](https://ai.google.dev/gemini-api/docs/veo)

所有路径仍围绕剧本、设定、制作、审阅、剪辑与交付。不同模型会改变中间步骤：是否先做首帧、是否建立角色元素、如何指定镜头时长、是否输入表演、声音能否参考、什么视频可编辑或续写。

## 2. 可比较的路线

下表是可采用的代表路线，不表示每个品牌只有一种用法，也不把产品端按钮视为已开通 API。

| 模型或工具路线 | 制作前准备 | 生成与控制 | 主要流程差异 |
|---|---|---|---|
| Seedance 2.0 / 2.5 的多参考音画路线 | 剧本片段、角色/场景参考、可用声音或动作参考 | 用导演说明或时间段计划生成镜头/连续片段，再参考原片编辑或续写 | 可以从组合参考进入制作，无需先为每镜制作静帧；输出仍需整体与局部复审。2.5 已核查的正式 API 证据来自海外 LAS，不外推国内账号可用性。[发布说明](https://seed.bytedance.com/en/blog/one-take-creation-flexible-referencing-introducing-seedance-2-5)、[LAS API](https://docs.byteplus.com/en/docs/byteplus_las/video_gen_enhanced) |
| 可灵 3.0 / Omni | 角色 Elements、造型/声线、首帧或其他兼容参考 | 选择自动多镜头或自定义各镜头内容和时长；Omni 可走已有视频编辑 | 角色元素与镜头计划有明确产品入口；直接输入视频与用视频建立角色 Element 是不同方式。当前产品证据充分，API 全部参数本轮未取得。[3.0 指南](https://kling.ai/quickstart/klingai-video-3-model-user-guide)、[Omni 指南](https://kling.ai/quickstart/klingai-video-3-omni-model-user-guide) |
| 万相 3.0 | 按任务选择首尾帧，或图片/视频/音频参考 | 一个模型入口按媒体类型与提示意图区分生成、编辑、延长 | 正式 API 支持多镜头与声音，但任务模式不能任意组合；要指定音频参考时，可能需要放弃首尾帧模式，改用参考模式。[API](https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference) |
| Veo 3.1，指定 Gemini/Cloud 接口 | 文字提示、首帧/首尾帧或参考图 | 生成有声短片段，按条件续写、补镜头和剪辑 | 原生音频不等于允许上传声线样本；Gemini 续写限定此前 Veo 生成素材。此行为不代表 Google 的所有视频产品。[Veo API](https://ai.google.dev/gemini-api/docs/veo)、[Cloud 模型卡](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate) |
| Runway 自有工具组合：Gen-4.5 / Act-Two / Aleph | 文本或首帧；精细表演路线另外准备人物表演视频；修片路线准备已有视频 | 按任务选择生成、表演驱动或视频修改，可分步组合 | Act-Two 双人路线分别驱动人物再合成或剪成反打；Aleph 可通过修改关键帧调整已有视频。这是可选控制方式，不是所有 Runway 视频必须后配音。[双人表演教程](https://help.runwayml.com/hc/en-us/articles/41748090660499-Creating-Multi-Character-Dialogues-with-Act-Two)、[Edit Studio](https://help.runwayml.com/hc/en-us/articles/51683104370451-Creating-with-Edit-Studio) |

Runway 自有模型与 Runway 平台托管的 Seedance、可灵等必须分开。Gen-4.5 原生声音有官方研究宣布，但该说明同时标记新能力将进入 Web 产品；本次可读 API 未证实声音参考或声音编辑控制。不能据此称其完全无声，也不能把宣布直接等同本项目可调用。[官方声明](https://runway.com/research/introducing-runway-gwm-1)、[API 模型目录](https://docs.dev.runwayml.com/guides/models/)

Google 当前另有 Omni Flash 多轮生成/编辑接口，因此 Veo 3.1 的限制不代表 Google 全家能力。该接口的音频上传与编辑也须按自己的限制判断；本次详细证据放在专项记录，不扩大本表为全市场穷举。[Google 视频入口](https://ai.google.dev/gemini-api/docs/video)、[Omni 限制](https://ai.google.dev/gemini-api/docs/omni#limitations)

## 3. 几项会真正改变制作顺序的差别

### 参考的身份与用途

首帧是视频起始画面的约束，角色参考提供身份依据，动作或表演参考提供运动/表演信息，被编辑视频则是待修改原片。相同文件类型可以承担不同用途，不能只靠“上传图片/视频”两个通用字段表达。

例如，可灵可以先把角色视频整理为 Element 并绑定声音，再用于新镜头；Seedance 的多参考方式可以在当前请求中说明参考素材用途；Act-Two 则明确需要表演视频作为驱动。这些是素材准备方式差别，不代表任一方式已通过跨集一致性实测。[可灵 Elements](https://kling.ai/quickstart/klingai-element-library-3-user-guide)、[Seedance 发布说明](https://seed.bytedance.com/en/blog/one-take-creation-flexible-referencing-introducing-seedance-2-5)、[Act-Two 教程](https://help.runwayml.com/hc/en-us/articles/41748090660499-Creating-Multi-Character-Dialogues-with-Act-Two)

### 原生声音、声音参考、表演驱动和分轨是不同能力

Veo 3.1 模型卡明确支持音频生成但不支持音频输入，说明“能说话”与“用指定声音样本说话”需要分开验收。万相 3.0 首尾帧模式不能同时传参考音频，若要音频驱动需改成参考模式。可灵 Omni 本次读到的官方指南将直接视频输入与原生声音列为暂时互斥，但用视频建立 Element 属另一入口；该限制应在接入时复核，不永久硬编码。[Veo 模型卡](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate)、[万相 API](https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference)、[Omni 指南](https://kling.ai/quickstart/klingai-video-3-omni-model-user-guide)

工作台据此应分别保存原声、音频参考、配音版本和表演来源，并明确输出是否实际包含可分离轨道。多镜头音画生成并不自动提供可编辑的独立人声、音乐与音效轨。

### 镜头计划、生成范围和返工范围

可灵自定义多镜头可逐镜头设置内容与时长；Seedance 和万相的公开说明包括以时间段表达叙事意图。这样的计划控制不等同生成结果的实际切点，也不证明一个输出文件可按镜头无损重新生成。[可灵指南](https://kling.ai/quickstart/klingai-video-3-model-user-guide)、[Seedance 发布说明](https://seed.bytedance.com/en/blog/one-take-creation-flexible-referencing-introducing-seedance-2-5)、[万相指南](https://help.aliyun.com/zh/model-studio/wan3-video-generation-guide)

制作推论：连续片段可能减少跨镜头手工拼接，但一次尝试也包含更多待验收内容；当其中一个动作失败，可以尝试局部编辑、拆出目标片段重做或补一个镜头。局部修改仍应复查人物、口型、声音与前后衔接，不能假设未指定区域完全不变。逐镜头制作便于挑选和替换，也会增加衔接及统一声音的工作，两种方式均适用于顶级模型。

### 续写与修片的输入资格

Veo 在 Gemini API 的续写限定之前 Veo 生成的视频；Seedance/万相的已核查参考模式以及可灵 Omni 产品指南包括已有视频编辑或延长路径。需要分别验证可接受的来源、时长和媒体组合，不能把一个供应商产生的文件交给另一家时默认所有续写能力仍成立。[Veo API](https://ai.google.dev/gemini-api/docs/veo)、[LAS API](https://docs.byteplus.com/en/docs/byteplus_las/video_gen_enhanced)、[万相 API](https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference)、[Omni 指南](https://kling.ai/quickstart/klingai-video-3-omni-model-user-guide)

## 4. 用同一场戏比较（制作建议，未实际生成）

场景：女主把信放在桌上，问“这封信，你看过了？”；男主移开目光，回答“没有”。

| 制作方法 | 操作顺序 | 团队主要投入 |
|---|---|---|
| 多镜头音画联合 | 准备人物/空间及兼容的声音参考 → 规划放信、质问、反应 → 生成连续片段 → 检查并编辑/补拍 → 剪辑 | 把表演、说话人、节奏及参考用途描述清楚，整体与局部检查 |
| 逐镜头控制 | 规划各镜头 → 按需确认首帧/构图 → 分别生成并选用 → 统一声音、动作和空间衔接 → 剪辑 | 前期构图和后期衔接；优势在于可以单独挑选和替换镜头 |
| 表演驱动 | 准备双方表演 → 指定角色外观 → 分别驱动 → 合成或正反打 → 声音整理 | 表演素材准备与合成；更明确地指定语气、停顿及动作来源 |

同一剧目可以混用这些方式。模型优先级不等于每个镜头必须使用同一种制作方法；是否切换由具体创作需要、质量和费用决定。

## 5. 对工作台方案的补充

1. 保持同一套剧本、角色、场次和镜头对象，按任务提供「生成」「编辑/续写」等入口；表演驱动按实际接入安排，不要求 MVP 接入本报告所有模型。
2. 能力配置必须表达输入组合、来源资格、音频输入/输出、声线绑定、分轨及编辑范围，不能只放 native_audio、supports_video 之类简单开关。
3. 切换模式或模型时说明哪些参考仍有效、哪些不兼容；不静默丢弃声音参考、角色绑定或首尾帧。提交前校验，避免先消费再发现输入不可满足。
4. 生成记录固定实际参考与供应商模式；既保留用户原来的镜头计划，也保留输出真实区间。编辑/续写形成新候选，保留原片、依赖和费用。
5. Seedance 仍为首要候选；对照实测应使用相同人物、对白与验收标准，记录达到可交付结果的总支出、人工操作时间、等待与返工范围，不比较单次调用价格就判断效率。

## 6. 专项证据

- [Seedance 优先接入核查](2026-09-07-seedance-priority.md)
- [可灵与万相流程核查](2026-09-07-kling-wan-workflows.md)
- [Runway 与 Google 流程核查](2026-09-07-runway-veo-workflows.md)

模型更新和不同服务入口会改变具体可用组合，实施时以选定版本和账号重新核验。本文解释流程差异，没有声明任何模型已经稳定满足本项目的写实短剧质量标准。

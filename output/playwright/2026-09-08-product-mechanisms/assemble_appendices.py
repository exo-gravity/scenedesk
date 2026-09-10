from pathlib import Path
import re

ROOT = Path('/Users/gandy/Documents/ChatGPT/drama_platform')
DOC = ROOT / 'docs/ai-drama-product-core-decision-questions-v0.1.md'
OUT = ROOT / 'output/playwright/2026-09-08-product-mechanisms'
IMAGES = OUT / 'images'

def shot(name, alt, caption):
    assert (IMAGES / name).is_file(), name
    return f'\n\n![{alt}]({IMAGES / name})\n\n{caption}\n\n'

b = '''

## 附录 B：分组复核、代表选择与证据规则

### B1. 这次归纳调整了什么

第一轮按产品最突出的特点提炼，容易得到“一个产品一种内核”，也容易把内容组织、自动化和长期记忆放在同一层。本轮先比较**用户怎样反复完成一项工作**，再合并具有相同循环的产品机制。以下是研究判断，不是厂商自称的分类。

| 原提炼 | 本轮处理 | 保留的差异 |
|---|---|---|
| Katalist 的故事骨架与 LTX 的叙事制作 | 合并到 G1：作品结构组织 | 结构怎样进入画布、共享设定怎样引用、如何进入时间线 |
| LibTV 的素材延展与其他产品的手工创作画布 | 合并到 G2：素材引用与持续试作 | 上下文如何选择，试作如何分支，结果如何被使用和整理 |
| TapNow 人机轮流接手、Octo 连续共创、Seko 系列 Agent | 合并到 G3：任务推进与人机接手 | 委托起点、检查点、成果位置、项目记忆与方法调用的深度 |
| FLORA Technique、Runway Workflow/App、LTX Flow | 合并到 G4：可执行工艺与封装复用 | 作者和使用者的接口、局部执行、缓存、发布与升级规则 |
| 纳米式默认生产流程 | 作为推进策略；可与 G1、G2 组合 | 阶段条件、并行、跳步、回退与局部重制，不等于开放节点编排 |
| 系列上下文与专业经验 | 作为长期积累维度，按对象继续拆分 | 项目事实、主体参考、可执行工艺、Skill 分别维护 |

**不继续合并 G2 与 G4 的原因：**相同的连线界面，可能服务“这一次继续怎么试”，也可能服务“以后反复怎么做”。前者需要保留探索自由，后者需要定义稳定接口与执行规则。TapNow 模板等功能正处在两者衔接处。也不将 G3 简化为“更自动化的画布”：谁组织下一步、怎样界定一次委托、产物怎样被人接手，都会因此变化。

这不是行业统一标准，也不穷尽所有 AI 视频产品；它是依据本次样本建立的比较框架。若目标客户的主要循环是当前四组没有充分表达的工作，应调整框架，而非硬把客户归进去。

### B2. 深挖代表为什么这样选

| 组别 | 主要代表与补充 | 选择理由及研究边界 |
|---|---|---|
| G1 | Katalist；LTX Storyboard、Elements | 新 Story Canvas 有具体操作链；LTX 补充设定与生成结果的连接。Katalist 当前页面明显包含广告定位，借鉴机制不等于认定它适合中国短剧全流程 |
| G2 | LibTV；TapNow 手工画布 | LibTV 与我们讨论的产品接近，但操作细节多为公开前端线索；用 TapNow 官方手册研究可核查的相似机制，不混同两家证据 |
| G3 | TapNow Agent；Seko、Octo | TapNow 的引用、确认、产物、会话及手工工具说明完整；另两者主要用于补充不同方向，不能编成未见过的操作手册 |
| G4 | FLORA Techniques；Runway、LTX Flows | 分别有封装复用、运行控制与依赖缓存的明确说明；补充代表解释不同设计，不拼成某一家已具备的全能产品 |

这里选择的是**机制清楚、证据可追溯、值得借鉴的代表**，不是市场份额或生成质量排名。各组不采用一款产品逐项比较所有功能，而是围绕核心循环回答：有哪些对象、怎样操作、如何处理修改、结果怎样继续、哪些规则尚不清楚。

### B3. 如何读附录的事实、截图和建议

| 标记 | 意义 | 不能由此推出什么 |
|---|---|---|
| D | 官方操作说明或明确发布记录 | 我们已实测成功；所有账户与模型均适用 |
| P | 厂商的定位、方向或效果主张 | 质量、效率、一致性效果已经得到验证 |
| F | 公开前端文案或界面线索 | 后端行为、开放范围和异常处理已经确认 |
| V | 本轮已视觉检查的官方演示或文档图片 | 本轮登录产品制作成功，或静态图证明全部动态行为 |
| I | 本文的归纳、因果分析、设计演绎或借鉴建议 | 厂商内部战略事实，或我们的实施基线已更改 |
| U | 本次未取得足够证据 | 产品一定没有该能力 |

本轮研究和截图访问日期均为 **2026-09-08**。未注册、登录、运行付费生成或开展多人生产实测。Katalist 的新旧教程需要区分版本；FLORA 文档的 Batch 说明存在冲突，处理依据见附录 F。下面的短剧情境都是研究演绎，不是伪装的客户案例。

截图放在对应机制旁；每张说明“看哪里、说明什么、不能证明什么”。原界面中的模型和价格仅是演示当时的显示，不作为当前推荐或报价。图片版权归原发布方。
'''

def extract(file, letter, title, start, end):
    body = (ROOT / 'docs/research' / file).read_text()
    body = body.split(start, 1)[1]
    body = start + body
    body = body.split(end, 1)[0].rstrip()
    index = 0
    def heading(m):
        nonlocal index
        index += 1
        return f'### {letter}{index}. {m.group(1)}'
    body = re.sub(r'^### (.+)$', r'#### \1', body, flags=re.M)
    body = re.sub(r'^## \d+\. (.+)$', heading, body, flags=re.M)
    return f'\n\n## 附录 {letter}：{title}\n\n' + body + '\n'

c = extract('2026-09-08-narrative-mechanism-deep-dive.md', 'C',
            'G1 · 以作品结构组织制作——Katalist 与 LTX',
            '## 2. Katalist', '## 8. 配图候选')
c = c.replace('### C2.', shot('katalist-script-structure.png', 'Katalist 剧本侧栏与按场景加入画布',
'''**图 C-1｜先出现可展开的作品结构。** V：Katalist 官方教程 00:24。左侧 Script Breakdown 已按场景和镜头展示内容，场景旁有 Add to Canvas；中间此时尚未展开。值得看的是“先有待制作内容，再按需要进入制作空间”的入口安排，不是空白画布面积。[官方指南](https://help.katalist.ai/en/articles/16298583-how-to-build-your-storyboard-and-videos-in-story-canvas) · [原演示 00:24](https://www.loom.com/share/91cb1424e2084a91a335de815b289d06?t=24)''') +
shot('katalist-script-canvas.png', 'Katalist 角色地点卡与带参考的画面卡',
'''**图 C-2｜内容展开后，制作依据与待制作画面一并出现。** V：同一官方教程 00:45。可见人物、地点卡，以及 Frame 1—3 中的参考标识、描述与镜头动作选项。它说明结构可以带出可操作的制作准备；自动分配参考的规则以 D 文档为依据，截图不证明后续生成质量。[官方指南](https://help.katalist.ai/en/articles/16298583-how-to-build-your-storyboard-and-videos-in-story-canvas) · [原演示 00:45](https://www.loom.com/share/91cb1424e2084a91a335de815b289d06?t=45)''') + '### C2.', 1)

d = extract('2026-09-08-creative-context-mechanism-deep-dive.md', 'D',
            'G2 · 围绕素材与引用持续试作——LibTV 与 TapNow',
            '## 1. 为什么', '## 6. 来源与视觉证据')
d = d.replace('[国内产品研究](2026-09-07-canvas-china-research-v2.md)', '[国内产品研究](research/2026-09-07-canvas-china-research-v2.md)')
d = d.replace('### D4.', shot('tapnow-reference-connection.png', 'TapNow 上游图片连线与下游提示引用',
'''**图 D-1｜把“连接了材料”进一步落实为“本次怎样使用”。** V：TapNow 官方连接教程动图截帧。左侧原图连接到右侧生成节点，输入区域同时显示参考缩略图及 `@` 引用。界面将素材来源和具体指令放在一起；是否使用、怎样使用仍需明确，不能把空间邻近当作输入。[官方连接教程](https://docs.tapnow.ai/zh/docs/canvas/understand-nodes-and-connections)''') + '### D4.', 1)

e = extract('2026-09-08-agent-mechanism-deep-dive.md', 'E',
            'G3 · Agent 任务推进与人机接手——TapNow、Seko 与 Octo',
            '## 2. TapNow', '## 8. 关键截图候选')
e = e.replace('### E2.', shot('tapnow-ask-confirmation.png', 'TapNow Ask 生成确认卡',
'''**图 E-1｜将 Agent 的意图变成用户能核对的行动。** V：TapNow 官方生成模式动图截帧。右侧确认卡集中展示提示、模型、比例、分辨率、数量和预计消耗，并提供确认或取消。值得借鉴的是检查点放在具体执行动作前；生成前确认不能代替生成后的质量采用。[官方生成模式说明](https://docs.tapnow.ai/en/docs/agent/choose-a-generation-mode)''') +
shot('tapnow-agent-outputs.png', 'TapNow 可重新打开的文字成果与对话并列',
'''**图 E-2｜文字成果获得独立于聊天滚动记录的入口。** V：TapNow 官方产物管理动图截帧。中间打开 Space Travel Story 文档，可见 Add to Canvas、Discuss；右侧仍是对话。这里是文字产物被打开的状态，未显示的列表行为以文档为证。可借鉴“成果可重新打开、编辑并再次交给 Agent”的连接。[官方产物管理说明](https://docs.tapnow.ai/en/docs/agent/manage-agent-outputs)''') + '### E2.', 1)

f = extract('2026-09-08-recipe-mechanism-deep-dive.md', 'F',
            'G4 · 可执行工艺与封装复用——FLORA、Runway 与 LTX',
            '## 2. 主代表 FLORA', '## 7. 官方截图候选')
diagram = '''

**机制示意｜方法作者和日常使用者并不需要同样复杂的入口。** 下图为 I：依据 FLORA Builder／Techniques 文档绘制的研究示意，非产品原型或界面截图。

```mermaid
flowchart LR
  A[作者试作并调整多个步骤] --> B[定义输入 输出及开放参数]
  B --> C[发布 Technique]
  C --> D[在画布作为一个节点调用]
  C --> E[通过 App Mode 提交材料]
  D --> F[本次运行与结果]
  E --> F
  F --> G[检查结果并继续制作]
```

原理在于将复杂方法转成清楚的使用接口，节点数量减少只是表现。作者仍需维护方法；使用者仍需检查本次结果。FLORA 官方 Builder 教程视频本轮遇到登录验证，未取得可核验的封装界面截图，因此用这张明确标识的示意辅助说明。[Builder](https://docs.flora.ai/nodes/technique-builder) · [Techniques](https://docs.flora.ai/nodes/techniques)
'''
f = f.replace('### F2.', diagram + '\n### F2.', 1)
f = f.replace('### F4.', shot('runway-typed-ports.png', 'Runway 节点输入输出及必填输入标记',
'''**图 F-1｜执行图需要明确输入输出的契约。** V：Runway 官方文档图片截图。左侧 Prompt／Image 输入带必填标识，右侧为 Video 输出，节点内有运行入口。借鉴重点是输入类型、方向与执行单位；这是端口示意，不能用来证明 FLORA 的封装、App 发布或任何产品的业务审批能力。[Runway 官方节点说明](https://help.runwayml.com/hc/en-us/articles/45763528999699-Introduction-to-Workflows)''') + '### F4.', 1)

g = '''

## 附录 G：把研究转成后续设计借鉴

### G1. 四组比较，真正要比较什么

下表均为 I。它归纳理想的工作机制，用于评估客户适配，不能作为上文各产品均已实现全部行为的功能表。

| 维度 | G1 作品结构 | G2 素材引用与试作 | G3 Agent 任务 | G4 可执行工艺 |
|---|---|---|---|---|
| 日常从哪里继续 | 某段故事、场景或镜头 | 某份依据、结果或候选分支 | 一项有范围的委托及其成果 | 一种方法及本次输入 |
| 下一步怎样确定 | 作品结构给出待制作位置，人作创作决定 | 人看结果后决定接下来试什么 | Agent 在给定范围内组织，人检查或接手 | 作者先定义步骤，使用者运行 |
| 主要可见关系 | 内容归属、视觉依据、顺序 | 来源、参考、派生及比较 | 任务依据、行动、产物和修订 | 类型、依赖、输入输出及运行 |
| 修改时最重要的连接 | 改到作品的哪部分，是否影响接续 | 保留哪份依据，从哪次尝试分支 | 允许改什么，人怎样接手已有成果 | 保留哪些结果，重跑哪些步骤 |
| 容易被忽略的成本 | 结构变动与既有成果映射 | 方案收纳及当前有效结果的识别 | 意图歧义、部分完成及费用处理 | 接口、方法维护及版本兼容 |
| 对应客户问题 | Q02、Q03、Q06、Q08 | Q03、Q04、Q06、Q11 | Q07、Q09、Q11 | Q05、Q09、Q10 |

### G2. 值得借鉴的是成套的行为，不是孤立控件

| 设计主题 | 可借鉴的连续行为 | 后续要在我们设计中明确的规则 | 回到哪些客户问题 |
|---|---|---|---|
| 从资料进入制作 | 结构可展开，素材可中途导入，探索结果可成为资产 | 输入缺失时怎样继续；谁确定正式依据；同一人物的造型怎样区分 | Q03、Q05、Q10 |
| 本次上下文 | 从业务对象带入资料，允许显式选择、解释作用和核对 | 项目中存在、可以引用、本轮实际输入分别怎样表示 | Q04、Q06、Q09 |
| 从结果继续 | 同处可见的候选与局部工具；保留源片并产生可检查成果 | 哪些是新候选，哪些修改现有草稿，何时成为采用版本 | Q04、Q06 |
| 人机交接 | 行动可核对，成果有独立入口，人能直接操作后再委托 | 暂停点、部分成果、恢复依据及重复执行如何处理 | Q07、Q09、Q11 |
| 与成片接续 | 素材能进入序列，从片段能回到源片；支持有结构的外部交接 | 新候选何时替换、区间如何处理，声音与字幕如何复查 | Q06、Q08 |
| 从做法到复用 | 先试作，再定义业务输入与示例，开放必要参数并发布 | 方法作者、使用者、维护者；旧任务如何固定依据，新版何时采用 | Q05、Q10 |
| 团队承接 | 共同材料、评论与位置导航服务接手 | 谁负责、什么算完成、谁能确认以及下一环节何时可开始 | Q01、Q07、Q12 |

以上可以进入后续交互与行为设计的候选清单，**不是同时纳入 MVP 的承诺**。首期用哪一种工作区、做到何种深度，仍取决于真实团队的任务覆盖和接手需求。

### G3. 本轮最需要避免照搬的六个混淆

1. **画布布局、叙事顺序、执行依赖、剪辑时间是不同关系。** 同一项目可以提供多种视图，但移动一个显示对象的影响应可解释。
2. **输入依据更新不等于既有媒体已经改变。** LTX 的颜色元素说明给出了明确反例；模型仍需要重制，成片仍需要决定是否替换。
3. **新结果出现不等于修改已经完成。** 还要经过采用、进入当前序列及关联内容复查。TapNow Playlist 的路径说明了这种衔接需求。
4. **执行锁、编辑锁和参数限制不等于质量批准。** Runway 与 FLORA 的三种控制服务不同目的，不应统一叫“已确认”。
5. **聊天记录、成果历史、画布撤销与项目版本不是同一能力。** 本轮资料分别证明了其中部分，不能组合推断完整版本系统。
6. **文件、主体、项目知识、模板、Workflow 与 Skill 分别解决不同复用问题。** Agent 可以使用其中数种；不必为了未来 Agent 化先让每个用户学会画执行图。

### G4. 接下来用目标客户验证什么

保留正文 Q01—Q12 作为决策入口，用一个真实任务比较两到三个组合。重点看四件事：客户自然从哪里继续；一次返工怎样真正结束；下一位成员能否自行接手；重复制作时究竟重复的是资料、步骤还是判断。

若主要阻力来自资料和结果难以接续，应先修复对应连接；若来自大量稳定步骤的重复操作，优先评估工艺；若来自每次重新组织任务，评估有限 Agent 委托；若来自作品进度和内容关系不清，评估作品结构主线。一个团队可以出现多种情况，应按频率、关键路径和职责确定主次。

画布是否成为主入口继续保留为验证项。本轮研究已经足够帮助我们设计具体的候选交互和接手规则，但不足以替目标客户做出偏好结论；也没有要求第一阶段先证明市场差异化。

## 附录 H：研究底稿、图源与复核记录

### H1. 四组完整研究底稿

- [G1：叙事结构、Katalist 与 LTX](research/2026-09-08-narrative-mechanism-deep-dive.md)，包含文档日期、跨版本限制与来源台账。
- [G2：创作上下文、LibTV 与 TapNow](research/2026-09-08-creative-context-mechanism-deep-dive.md)，包含前端证据边界与手工制作链。
- [G3：Agent 接手、TapNow 与 Seko](research/2026-09-08-agent-mechanism-deep-dive.md)，包含任务状态、产物与来源台账。
- [G4：工艺、FLORA／Runway／LTX](research/2026-09-08-recipe-mechanism-deep-dive.md)，包含版本、运行、文档冲突及 API 依据。

底稿中的图片候选是采集前的研究记录；**本成稿及以下图源台账代表最终采用和视觉核验结果**。事实来源已在正文就近链接，不能把重复引用同页计算成多份独立证据。

### H2. 最终采用图片

六张图片均为从官方教程、官方演示或文档图片截取，未使用营销拼贴冒充工作台操作。Katalist 两张来自同一演示的不同时间点；TapNow 三张来自各自的官方动图；Runway 一张来自官方节点示意。FLORA 封装使用本文绘制的 Mermaid 机制图辅助说明。

| 图号 | 画面 | 来源类型 | 核验重点 |
|---|---|---|---|
| C-1 | Katalist 剧本侧栏，00:24 | 官方视频演示截图 | 场景、镜头及 Add to Canvas 同处可见 |
| C-2 | Katalist 制作卡片，00:45 | 同一官方视频演示截图 | 人物地点卡与帧卡参考标识 |
| D-1 | TapNow 连线与引用 | 官方操作动图截图 | 上游依据和下游本次引用同时可见 |
| E-1 | TapNow Ask 卡 | 官方操作动图截图 | 可检查的具体生成行动 |
| E-2 | TapNow 文字成果 | 官方操作动图截图 | 打开文档、送画布和再讨论入口 |
| F-1 | Runway 类型端口 | 官方文档图片截图 | 输入输出与运行契约，非封装发布界面 |

原始页面、直接图源、采集日期和文件位置见[图片来源台账](../output/playwright/2026-09-08-product-mechanisms/screenshot-provenance.md)。每张均已打开检查可读性，截图只支持可见设计，相关动态规则依官方文档标注。
'''

text = DOC.read_text()
assert '## 附录 B：分组复核' not in text, 'Appendices already assembled'
text += b + c + d + e + f + g
# Codex renders local artifact links best with absolute file paths.
def absolute_link(m):
    label, target = m.group(1), m.group(2)
    if target.startswith(('http:', 'https:', '#', '/')):
        return m.group(0)
    dest = (DOC.parent / target).resolve()
    return f'[{label}]({dest})'
text = re.sub(r'\[([^\]\n]+)\]\(([^)\n]+)\)', absolute_link, text)
DOC.write_text(text)
print(f'Wrote {DOC}: {len(text)} characters, {len(text.splitlines())} lines')

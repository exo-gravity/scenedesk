# 创作区底部：模型、模式与规格（设计决定）

日期：2026-09-23。状态：**待确认**。真实供应商接入（PR #74–#77）之后，底部三个控件显示的内容已经不合用：模型名是原始 profile id，同一模型重复出现，清晰度是拍平的像素串。本决定只改这些控件的**内容与数据来源**，不动 [核心创作区重建](creative-workspace-rebuild-libtv-2026-09-21.md) 定下的布局、密度与交互，也不动生成、幂等、权限、恢复的任何行为。

## 1. 现状（对着 `packages/provider/src/verified/profiles.ts` 核过）

- **模型名是 profile id。** `capability.modelVersion` 直接上屏：`volcengine/doubao-seedream-5-0-pro-260628`、`minimax/MiniMax-H3`。
- **同一模型出现两行、字完全相同。** 能力记录按 (profile, mode) 一条；Seedance 的 `modes` 是 `frames_v1` 与 `reference_v1`，列表里看不出差别。视频列表因此有七行，其中六行两两重复。
- **清晰度是像素串全集。** Seedream Pro／Flash 有 3 档 × 8 比例 = 24 个格子，2 列排成 12 行。
- **比例与清晰度不联动。** 可以选出 `16:9` + `1024x1024`，点提交才被 `imageOutput()` 拒绝。

## 2. LibTV 的分法

[LibTV 输入面板](../research/assets/2026-09-21-canvas-cards/libtv-video-composer.png) 的底栏是**三个胶囊**：

```
[模型 2.0 ▾]   [模式 首尾帧 ▾]   │   [规格 16:9 · 720P · 5s ▾]
```

模式是独立的一个胶囊，不混进模型列表；[模型列表](../research/assets/2026-09-21-canvas-cards/libtv-model-picker.png) 里每行只有名字。本决定照此分。

## 3. 决定

**展示名、以及「某个尺寸属于哪个清晰度档」，一律由能力记录提供**，唯一真相仍是 `profiles.ts`。前端不维护第二张模型表，不按 id 猜名字，不按像素数编档位名。

界面上的字**以少为准**：能不写的不写。

### 3.1 能力记录新增两个可选字段

`ModelProfile` 加 `displayName`；`capabilityDefinition()` 把已有的 `outputs` 映射原样带出：

```
displayName: "Seedream 5.0 Pro"
outputs: [
  { resolution: "1424x800",  aspectRatio: "16:9", quality: "1K" },
  { resolution: "2816x1584", aspectRatio: "16:9", quality: "2K" },
  ...
]
```

`allowedResolutions` 与 `allowedAspectRatios` 原样保留，语义不变。两个字段都可选：尚未重跑 provision 的旧记录照今天的样子渲染。

全部展示名：

| profile | 展示名 |
| --- | --- |
| `minimax/MiniMax-H3` | MiniMax H3 |
| `volcengine/doubao-seedance-2-0-260128` | Seedance 2.0 |
| `volcengine/doubao-seedance-2-0-fast-260128` | Seedance 2.0 Fast |
| `volcengine/doubao-seedance-2-0-mini-260615` | Seedance 2.0 Mini |
| `volcengine/doubao-seedream-5-0-pro-260628` | Seedream 5.0 Pro |
| `volcengine/doubao-seedream-5-0-flash-260915` | Seedream 5.0 Flash |
| `volcengine/doubao-seedream-5-0-260128` | Seedream 5.0 |

厂商名与日期版本号（`豆包`、`260628`）都不上屏。厂商在 `notes` 里，对账时取得到。

### 3.2 模型列表

**按 `modelVersion` 去重**，一个模型一行。行 = 类型图标 + 展示名。不分组，不写厂商，不写「已接入」，不写耗时、费用、说明句。

```
今天（视频，七行）                              改后（四行）
volcengine/doubao-seedance-2-0-260128          Seedance 2.0
volcengine/doubao-seedance-2-0-260128          Seedance 2.0 Fast
volcengine/doubao-seedance-2-0-fast-260128     Seedance 2.0 Mini
volcengine/doubao-seedance-2-0-fast-260128     MiniMax H3
volcengine/doubao-seedance-2-0-mini-260615
volcengine/doubao-seedance-2-0-mini-260615
minimax/MiniMax-H3
```

- 选中行浅灰底。一个都没有时仍是「暂无可用模型」。
- 唯一保留的状态字是夹具能力上的**受控测试**：它不呼真实供应商、结果是假的，和真实模型混在一列里必须能分出来。真实模型行上不写任何状态。

### 3.3 模式胶囊（新增）

模型与规格之间加一个胶囊，选同一模型下的进料方式，即能力记录的 `mode`：

| `mode` | 界面名 | 含义 |
| --- | --- | --- |
| `frames_v1` | 首尾帧 | 挂一张首帧、一张尾帧，模型在两张之间补运动；最多 2 张 |
| `reference_v1` | 参考图 | 挂参考图（人物、造型、风格、场景、道具、构图），最多 9–14 张 |

- **该模型只有一种模式时，胶囊不出现**（MiniMax H3 只有首尾帧，Seedream 只有参考图）。
- 换模式和换模型走同一条路：都是换一条能力记录，`reconcileOutputForCapability()` 照旧保留／补齐输出项。
- 换模式会改变可挂参考的用途与张数，参考区按新能力记录的 `inputRules` 渲染，这部分逻辑已有，不动。
- 两个界面名是我们自己 `ProfileMode` 枚举的中文写法，不是供应商事实，因此留在前端，不进契约。

### 3.4 规格面板

**比例只摆三个：`16:9` `9:16` `1:1`。** 竖屏短剧、横屏、方图，一行放得下。这是前端的白名单，不是能力的上限——能力记录照旧声明 8 个（Seedream）或 6 个（Seedance）比例，接口照旧接受 `21:9`，只是面板不摆出来。砍进 `profiles.ts` 等于把真实能力删掉。白名单与某个模型的允许集合交集为空时，退回该模型的完整列表，不出现一个都选不了的面板。

**清晰度一个不砍，档位名照能力记录原样取**（`480p`／`768P`／`2K` 各按各家写法），不统一大小写、不改写。换成档位名之后每个模型最多三个，本来就是一行；再砍要写「藏掉 `1.5K`」这类特例，省不出空间反而多一条规矩。`480p` 尤其要留：Seedance 按 token 计费，它是便宜的草稿档。

| 模型 | 今天的格子数 | 比例 | 清晰度 |
| --- | --- | --- | --- |
| Seedream 5.0 Pro／Flash | 8 + 24 | `16:9` `9:16` `1:1` | `1K` `1.5K` `2K` |
| Seedream 5.0 | 8 + 8 | `16:9` `9:16` `1:1` | `2K` |
| Seedance 2.0 | 6 + 18 | `16:9` `9:16` `1:1` | `480p` `720p` `1080p` |
| Seedance 2.0 Fast／Mini | 6 + 12 | `16:9` `9:16` `1:1` | `480p` `720p` |
| MiniMax H3 | 1 + 1 | `16:9` | `768P` |

- **比例 × 档位唯一确定 `resolution`**，由面板填入，用户不再直接选像素尺寸。今天那个提交才报错的非法组合就此不存在。
- 比例因此是必选项；只有一个比例的模型（MiniMax H3）自动填好。
- 唯一档位（Seedream 5.0、MiniMax H3）收成一行静态文字，不摆一个只能点自己的格子。
- 比例仍是带图形的方块 tile，清晰度仍是两列格子——样式不动。
- 时长滑杆、生成音频开关、固定镜头来源照旧。仍然没有生成数量。
- 底部胶囊摘要：`16:9 · 2K · 5s · 有声`（秒改用 `s`，与 LibTV 一致）。

## 4. 改动范围

| 位置 | 改动 |
| --- | --- |
| `packages/provider/src/verified/profiles.ts` | `ModelProfile` 加 `displayName`，七个 profile 填上；`capabilityDefinition()` 输出 `outputs` |
| `docs/implementation/` 契约 | `Capability` 加两个可选字段，重跑 `build_contract.py` 与 `check_design.py` |
| `apps/web/src/business/generation-specification.ts` | 比例 × 档位 → `resolution` 的归一；摘要改档位名与 `s` |
| 新增 `apps/web/src/business/capability-presentation.ts` | 按 `modelVersion` 归并能力记录、展示名回退、模式中文名、比例白名单 |
| `apps/web/src/studio/composer/ComposerControls.tsx` | 模型行只留名字；新增模式胶囊；清晰度改档位 |
| `apps/web/src/studio/composer/Composer.tsx` | 底栏多一个胶囊；选模型与选模式分别解析到能力记录 |
| `apps/web/src/studio/composer/composer.module.css` | 模式胶囊沿用 `.pill`，无新类 |
| `tests/e2e/studio-composer.spec.ts` | 按展示名与档位选择；补「同模型两种模式」与「单模式不出胶囊」 |

demo 箱要重跑一次 `scripts/provision-verified-capabilities.ts` 新字段才会出现，这一步由用户执行。

## 5. 验收

1. 视频列表里 Seedance 2.0 Mini 只有一行；选中后模式胶囊出现，可在首尾帧与参考图之间切换，两种都能提交。
2. 选中 MiniMax H3 时模式胶囊不出现。
3. 选中 Seedream 5.0 Flash 时比例只有三个、清晰度只有三个，选 `16:9` + `2K` 提交，请求里的 `resolution` 是 `2816x1584`。
4. 只允许白名单外比例的能力记录仍能选出比例并提交（退回完整列表的分支）。
5. 去掉新字段的能力记录（模拟未重跑 provision 的箱子）仍按今天的拍平列表可用，不报错。

## 6. 主动不做并记录

用户 2026-09-23 要求「列表／命名及文案务必保持简洁」「不需要厂商分组、不要豆包、已接入等这些」。据此砍掉：

- **厂商分组标题与厂商名**。代价：单行拿出来（截图、客服记录）不带厂商，要回查 `notes`。
- **「已接入」状态字**。真实模型全部接入后它每行一遍，不区分任何东西。
- **像素尺寸不上屏**（档位格子里不写第二行 `2816×1584`）。代价：`1K` 的 16:9 是 1424×800 而非 1920×1080，按交付尺寸倒推的用户看不到确切值；需要时再加。
- **日期版本号**（`260628`）。代价：供应商换快照版本时界面上看不出来。
- **比例只留 `16:9` `9:16` `1:1`**，砍掉 `4:3` `3:4` `3:2` `2:3` `21:9`（用户 2026-09-23 确认 `21:9` 不需要）。`3:2`／`2:3` 是摄影比例，`4:3`／`3:4` 在短剧里基本不用，`21:9` 是宽银幕。代价：要宽银幕的导演走不通；加回来是白名单加一项。

另外主动不做：

- **不按已挂参考自动推断模式**。那是改提交行为，不是改设计。
- **不显示耗时与费用**。能力记录里没有耗时；费用只在已准备好的计划上有估算，[核心创作区重建](creative-workspace-rebuild-libtv-2026-09-21.md) §5 的口径不变。
- **`MiniMax H3` 不截成 `H3`**，那是模型自己的名字。
- **不引入各家 logo**，图标沿用现有的类型图标（图片／视频／音频）。

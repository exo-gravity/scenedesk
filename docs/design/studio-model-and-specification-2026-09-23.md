# 创作区底部：模型列表与规格面板（设计决定）

日期：2026-09-23。状态：**待确认**。真实供应商接入（PR #74–#77）之后，模型列表与规格面板显示的内容已经不合用：模型名是原始 profile id，清晰度是拍平的像素串。本决定只改这两个控件的**内容与数据来源**，不动 [核心创作区重建](creative-workspace-rebuild-libtv-2026-09-21.md) 定下的布局、密度与交互，也不动生成、幂等、权限、恢复的任何行为。

## 1. 现状（对着 `packages/provider/src/verified/profiles.ts` 核过）

- **模型名是 profile id。** `capability.modelVersion` 直接上屏：`volcengine/doubao-seedream-5-0-pro-260628`、`minimax/MiniMax-H3`。
- **同一模型出现两行、字完全相同。** 能力记录按 (profile, mode) 一条；Seedance 的 `modes` 是 `frames_v1` 与 `reference_v1`，列表里看不出差别。demo 箱已启用的 Seedance 2.0 Mini 就是这种。
- **清晰度是像素串全集。** Seedream Pro／Flash 有 3 档 × 8 比例 = 24 个格子，2 列排成 12 行。
- **比例与清晰度不联动。** 可以选出 `16:9` + `1024x1024`，点提交才被 `imageOutput()` 拒绝。

参照物：[LibTV 模型列表](../research/assets/2026-09-21-canvas-cards/libtv-model-picker.png)、[LibTV 规格浮层](../research/assets/2026-09-21-canvas-cards/libtv-spec-picker.png)。

## 2. 决定

**展示名、以及「某个尺寸属于哪个清晰度档」，一律由能力记录提供**，唯一真相仍是 `profiles.ts`。前端不维护第二张模型表，不按 id 猜名字，不按像素数编档位名。

界面上的字**以少为准**：能不写的不写。

### 2.1 能力记录新增两个可选字段

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

### 2.2 模型列表

平铺一列，不分组。行 = 类型图标 + 展示名 + 模式小字。

```
Seedance 2.0 Mini   首尾帧
Seedance 2.0 Mini   参考图
MiniMax H3          首尾帧
```

- 模式小字：`frames_v1` → 首尾帧，`reference_v1` → 参考图。**同一模型只有一个模式时不显示**——那时它不区分任何东西。
- 不写「已接入」，不写厂商，不写耗时、费用、说明句。
- 唯一保留的状态字是夹具能力上的**受控测试**：它不呼真实供应商、结果是假的，和真实模型混在一列里必须能分出来。真实模型行上不写任何状态。
- 选中行浅灰底。一个都没有时仍是「暂无可用模型」。

### 2.3 规格面板

**清晰度显示档位名，不再显示像素串。** 档位名照能力记录原样取（`480p`／`768P`／`2K` 各按各家写法），不统一大小写、不改写。

| 模型 | 现在的格子数 | 改后 |
| --- | --- | --- |
| Seedream 5.0 Pro／Flash | 24 | `1K` `1.5K` `2K` |
| Seedream 5.0 | 8 | `2K` |
| Seedance 2.0 | 18 | `480p` `720p` `1080p` |
| Seedance 2.0 Fast／Mini | 12 | `480p` `720p` |
| MiniMax H3 | 1 | `768P` |

- **比例 × 档位唯一确定 `resolution`**，由面板填入，用户不再直接选像素尺寸。今天那个提交才报错的非法组合就此不存在。
- 比例因此是必选项；只有一个比例的模型（MiniMax H3）自动填好。
- 唯一档位（Seedream 5.0、MiniMax H3）收成一行静态文字，不摆一个只能点自己的格子。
- 比例仍是带图形的方块 tile，清晰度仍是两列格子——样式不动。
- 时长滑杆、生成音频开关、固定镜头来源照旧。仍然没有生成数量。
- 底部胶囊摘要：`16:9 · 2K · 5 秒 · 有声`。

## 3. 改动范围

| 位置 | 改动 |
| --- | --- |
| `packages/provider/src/verified/profiles.ts` | `ModelProfile` 加 `displayName`，七个 profile 填上；`capabilityDefinition()` 输出 `outputs` |
| `docs/implementation/` 契约 | `Capability` 加两个可选字段，重跑 `build_contract.py` 与 `check_design.py` |
| `apps/web/src/business/generation-specification.ts` | 比例 × 档位 → `resolution` 的归一；切模型时按新结构保留／补齐；摘要改用档位名 |
| `apps/web/src/studio/composer/ComposerControls.tsx` | 模型行改展示名与模式小字；清晰度改档位 |
| `apps/web/src/studio/composer/composer.module.css` | 模式小字一个类 |
| `tests/e2e/studio-composer.spec.ts` | 按展示名与档位选择；补一例「同模型两个模式可区分」 |

demo 箱要重跑一次 `scripts/provision-verified-capabilities.ts` 新字段才会出现，这一步由用户执行。

## 4. 验收

1. 视频列表里 Seedance 2.0 Mini 的两行能凭模式小字区分，分别可选中并提交。
2. 只有一个模式的 MiniMax H3 行上不出现模式小字。
3. 选中 Seedream 5.0 Flash 时清晰度只有三个格子，选 `16:9` + `2K` 提交，请求里的 `resolution` 是 `2816x1584`。
4. 去掉新字段的能力记录（模拟未重跑 provision 的箱子）仍按今天的拍平列表可用，不报错。

## 5. 主动不做并记录

用户 2026-09-23 要求「列表／命名及文案务必保持简洁」「不需要厂商分组、不要豆包、已接入等这些」。据此砍掉：

- **厂商分组标题与厂商名**。代价：单行拿出来（截图、客服记录）不带厂商，要回查 `notes`。
- **「已接入」状态字**。真实模型全部接入后它每行一遍，不区分任何东西。
- **像素尺寸不上屏**（档位格子里不写第二行 `2816×1584`）。代价：`1K` 的 16:9 是 1424×800 而非 1920×1080，按交付尺寸倒推的用户看不到确切值；需要时再加。
- **日期版本号**（`260628`）。代价：供应商换快照版本时界面上看不出来。

另外主动不做：

- **不合并同一模型的两个模式**。合并要让面板按已挂参考去猜 mode，那是改提交行为。
- **不显示耗时与费用**。能力记录里没有耗时；费用只在已准备好的计划上有估算，[核心创作区重建](creative-workspace-rebuild-libtv-2026-09-21.md) §5 的口径不变。
- **`MiniMax H3` 不截成 `H3`**，那是模型自己的名字。
- **不引入各家 logo**，图标沿用现有的类型图标（图片／视频／音频）。

# 创作区底部：模型、模式与规格 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让输入面板底栏显示模型的展示名、独立的进料模式、以及「比例 × 清晰度档」两级选择，取代今天的 profile id、重复行与 24 个像素格子。

**Architecture:** 展示名与「尺寸 → 比例 + 档位」由能力记录携带（`Capability` 加两个可选字段，值来自 `packages/provider/src/verified/profiles.ts`），接口路由不改——`GET capabilities` 本来就把 `definition` 整个摊开返回，只要契约允许这两个字段即可。前端新增一个纯函数模块把能力记录按 `modelVersion` 归并、给出模式名、算出比例与档位的可选项；三个控件只读这个模块的结果。比例白名单是前端的产品选择，不进契约、不改 `profiles.ts`。

**Tech Stack:** Node 22、TypeScript（NodeNext）、React + Mantine（`Popover`／`UnstyledButton`）、`node:test` + tsx、Playwright、Python 契约生成器。无新依赖。

**Spec:** `docs/design/studio-model-and-specification-2026-09-23.md`（基线：`docs/design/creative-workspace-rebuild-libtv-2026-09-21.md`、`docs/implementation/85-studio-rebuild.md`）

## Global Constraints

- 所有命令在仓库根目录执行。单元测试 `npm test`（`node --import tsx --test tests/*.test.ts`），单文件用 `node --import tsx --test tests/<name>.test.ts`。e2e `npm run test:e2e`。
- **不要手改** `packages/contracts/src/generated.ts`、`docs/implementation/openapi.json`、`docs/implementation/api-operations.md`；它们由 `.venv/bin/python docs/implementation/build_contract.py` 生成。改完必须跑 `.venv/bin/python docs/implementation/check_design.py`，它重跑生成器并在有差异时判失败。
- 契约只**追加可选字段**：`Capability.displayName`、`Capability.outputs`。不改已有字段语义，不加必填项。
- 比例白名单恒为 `["16:9", "9:16", "1:1"]`，写死在 `apps/web/src/business/generation-specification.ts`，不做配置项。
- 界面文案：模式名只有「首尾帧」（`frames_v1`）与「参考图」（`reference_v1`）。列表行不写厂商、不写「已接入」、不写日期版本号、不写耗时与费用。夹具能力行保留「受控测试」。
- 档位名照能力记录原样显示，不统一大小写（`480p`／`768P`／`2K` 并存）。
- 时长摘要用 `5s`，不用 `5 秒`。
- 用户可见文案用中文；代码注释、提交信息用英文，写给没见过这段对话的读者，提交信息以 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` 结尾。
- 不改生成、幂等、权限、恢复、放置的任何行为。不发起真实付费生成。不推送、不合并。
- demo 箱重跑 `scripts/provision-verified-capabilities.ts` 由用户执行，本计划不含部署步骤。

## Review Focus

规格里隐含、但任务的主线测试不一定碰到的五类输入，按咬人概率排序。每条都在下面它归属的任务里配了用例。

1. **旧能力记录没有 `outputs`**（箱子尚未重跑 provision，以及全部 e2e 夹具）。清晰度必须退回今天的拍平像素列表，摘要显示原始像素串，不能崩、不能显示空面板。→ 任务 3、任务 5。
2. **比例白名单与某模型的允许集合交集为空**（视频夹具只允许 `3:5`）。必须退回该模型的完整比例列表，否则比例是必选项却一个都选不了，永远提交不了。→ 任务 3。
3. **换模型后旧的比例或档位在新模型不存在**。必须丢掉，不能留下与新模型不匹配的 `resolution`——那会一路带到 `imageOutput()` 才抛错。→ 任务 3。
4. **冻结状态下的模式胶囊**。规则 6 要求有计划或原请求时模型与规格全部冻结；模式换的是能力记录，与换模型同级，必须一起禁用。→ 任务 4。
5. **某个比例下只有一个档位**（Seedream 5.0 的 `2K`、MiniMax H3 的 `768P`）。档位区收成静态文字，但 `resolution` 仍必须被填上，否则提交被 `imageOutput()` 拒。→ 任务 3、任务 5。

---

## File Structure

| 文件 | 责任 |
|---|---|
| `docs/implementation/build_contract.py` | 新增 `CapabilityOutput` schema，`extend("Capability", …)` 追加两个可选字段 |
| `packages/provider/src/verified/profiles.ts` | `ModelProfile.displayName`；`capabilityDefinition()` 输出 `displayName` 与 `outputs` |
| `apps/web/src/business/capability-presentation.ts`（新建） | 按 `modelVersion` 归并能力记录、展示名回退、模式中文名 |
| `apps/web/src/business/generation-specification.ts` | 比例白名单、档位可选项、比例 × 档位 → `resolution`、摘要改档位名与 `s` |
| `apps/web/src/studio/composer/ComposerControls.tsx` | `ModelPicker` 只留名字；新增 `ModePicker`；`SpecificationPicker` 改两级选择 |
| `apps/web/src/studio/composer/Composer.tsx` | 底栏多一个胶囊；选模型与选模式都解析到能力记录 |
| `tests/verified-profiles.test.ts` | 断言展示名与 `outputs` 映射 |
| `tests/capability-presentation.test.ts`（新建） | 归并、回退、模式名 |
| `tests/generation-specification.test.ts` | 白名单、档位、归一、摘要 |
| `tests/support/image-generation.ts` | e2e 夹具补一个双模式、带 `outputs` 的合成模型 |
| `tests/e2e/studio-composer.spec.ts` | 底栏三胶囊的实际选择与截图 |

---

## Task 1: 能力记录携带展示名与输出映射

**Files:**
- Modify: `docs/implementation/build_contract.py:176` 附近（已有的「后续修订」区）
- Modify: `packages/provider/src/verified/profiles.ts`
- Test: `tests/verified-profiles.test.ts`
- 生成物（不手改）：`docs/implementation/openapi.json`、`docs/implementation/api-operations.md`、`packages/contracts/src/generated.ts`

**Interfaces:**
- Consumes: 无。
- Produces: `Capability.displayName?: string`、`Capability.outputs?: { resolution: string; aspectRatio: string; quality: string }[]`。`resolution` 是像素串 `"2816x1584"`，`quality` 是厂商档位名 `"2K"`。后续任务全部依赖这两个字段名。

- [ ] **Step 1: 写失败的测试**

在 `tests/verified-profiles.test.ts` 末尾追加：

```ts
test("a capability definition carries the display name and maps every size to its ratio and tier", () => {
  const flash = findProfile("volcengine/doubao-seedream-5-0-flash-260915")!;
  const definition = capabilityDefinition(flash, "reference_v1", {});
  assert.equal(definition.displayName, "Seedream 5.0 Flash");
  assert.equal(definition.outputs!.length, definition.allowedResolutions!.length);
  assert.deepEqual(
    definition.outputs!.find((o) => o.resolution === "2816x1584"),
    { resolution: "2816x1584", aspectRatio: "16:9", quality: "2K" },
  );
  const h3 = capabilityDefinition(findProfile("minimax/MiniMax-H3")!, "frames_v1", {});
  assert.equal(h3.displayName, "MiniMax H3");
  assert.deepEqual(h3.outputs, [{ resolution: "1344x768", aspectRatio: "16:9", quality: "768P" }]);
});
test("every profile has a display name that is not its id", () => {
  for (const profile of PROFILES) {
    assert.ok(profile.displayName.length > 0, profile.id);
    assert.notEqual(profile.displayName, profile.id);
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import tsx --test tests/verified-profiles.test.ts`
Expected: FAIL —— `displayName` 不存在于 `ModelProfile`，TypeScript 报错或断言为 `undefined`。

- [ ] **Step 3: 契约加两个可选字段**

在 `docs/implementation/build_contract.py` 第 176 行 `S["Capability"]["properties"]["supportedPurposes"]["items"]["enum"].append("prop")` 之后插入：

```python
schema("CapabilityOutput", {"resolution": string(), "aspectRatio": string(), "quality": string()}, ["resolution", "aspectRatio", "quality"])
extend("Capability", {"displayName": NAME, "outputs": arr(ref("CapabilityOutput"))})
```

- [ ] **Step 4: 重跑契约生成器**

```bash
.venv/bin/python docs/implementation/build_contract.py
```

Expected: `docs/implementation/openapi.json`、`docs/implementation/api-operations.md`、`packages/contracts/src/generated.ts` 出现 `CapabilityOutput` 与两个新属性。确认 `Capability.required` 没有变长。

- [ ] **Step 5: 档案加展示名并输出映射**

`packages/provider/src/verified/profiles.ts`：

`ModelProfile` 类型里，`id` 之后加一行：

```ts
  /** The vendor's own name for the model, as the panel shows it. */
  displayName: string;
```

`seedance()` 工厂签名与调用加上展示名：

```ts
const seedance = (id: string, displayName: string, providerModel: string, tiers: ("480p" | "720p" | "1080p")[], microsPerMillion: Record<string, number>, revision: string): ModelProfile => ({
  id, displayName, vendor: "volcengine", purpose: "video", providerModel, modes: ["frames_v1", "reference_v1"],
```

```ts
  seedance("volcengine/doubao-seedance-2-0-260128", "Seedance 2.0", "doubao-seedance-2-0-260128", ["480p", "720p", "1080p"], { "480p": 46000000, "720p": 46000000, "1080p": 51000000 }, "ark-cn-2026-09-22"),
  seedance("volcengine/doubao-seedance-2-0-fast-260128", "Seedance 2.0 Fast", "doubao-seedance-2-0-fast-260128", ["480p", "720p"], { "480p": 37000000, "720p": 37000000 }, "ark-cn-2026-09-22"),
  seedance("volcengine/doubao-seedance-2-0-mini-260615", "Seedance 2.0 Mini", "doubao-seedance-2-0-mini-260615", ["480p", "720p"], { "480p": 23000000, "720p": 23000000 }, "ark-cn-2026-09-22"),
```

其余四条档案各加一行 `displayName`，紧跟 `id`：

| 档案 `id` | `displayName` |
|---|---|
| `minimax/MiniMax-H3` | `"MiniMax H3"` |
| `volcengine/doubao-seedream-5-0-pro-260628` | `"Seedream 5.0 Pro"` |
| `volcengine/doubao-seedream-5-0-flash-260915` | `"Seedream 5.0 Flash"` |
| `volcengine/doubao-seedream-5-0-260128` | `"Seedream 5.0"` |

`capabilityDefinition()` 的返回对象里，`modelVersion: profile.id` 之后加两行。注意 `OutputTarget.resolution` 存的是**档位名**，键才是像素串——这是既有命名，不要改：

```ts
    modelVersion: profile.id,
    displayName: profile.displayName,
    outputs: sizes.map((size) => ({ resolution: size, aspectRatio: profile.outputs[size]!.ratio, quality: profile.outputs[size]!.resolution })),
```

- [ ] **Step 6: 跑测试确认通过**

Run: `node --import tsx --test tests/verified-profiles.test.ts`
Expected: PASS，包括既有的「每条档案都派生出契约合法的能力定义」——它跑 `validateContract("Capability", …)`，新字段必须已经在契约里，否则 `additionalProperties: false` 会判不合法。

- [ ] **Step 7: 跑契约门禁与全量单测**

```bash
.venv/bin/python docs/implementation/check_design.py
npm test
```

Expected: 两条都通过。`check_design.py` 会重跑生成器并比对，若报差异说明 Step 4 没跑或跑在改档案之前。

- [ ] **Step 8: 提交**

```bash
git add docs/implementation/build_contract.py docs/implementation/openapi.json docs/implementation/api-operations.md packages/contracts/src/generated.ts packages/provider/src/verified/profiles.ts tests/verified-profiles.test.ts
git commit -m "$(cat <<'MSG'
feat(provider): the capability record carries a display name and its output table

The record named a model by its profile id and listed output sizes as a flat
set of pixel strings, so a reader could not tell `1424x800` from `2816x1584`
without the profile table the client never sees. The definition now carries
the vendor's own name for the model and, for each size, the ratio and quality
tier the profile already records. Both fields are optional; a record written
before this change reads exactly as it did.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 2: 按模型归并能力记录

**Files:**
- Create: `apps/web/src/business/capability-presentation.ts`
- Test: `tests/capability-presentation.test.ts`

**Interfaces:**
- Consumes: 任务 1 的 `Capability.displayName`。
- Produces:
  - `type PresentedCapability = Schema<"Capability"> & { executionMode?: "test_fixture" | "verified_provider" }`
  - `type ModelEntry = { modelVersion: string; name: string; fixture: boolean; capabilities: PresentedCapability[] }`
  - `modelEntries(capabilities: readonly PresentedCapability[]): ModelEntry[]`
  - `modeLabel(capability: PresentedCapability): string | undefined`
  - `capabilityForModel(entry: ModelEntry, preferredMode: string | undefined): PresentedCapability`

- [ ] **Step 1: 写失败的测试**

Create `tests/capability-presentation.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  capabilityForModel,
  modeLabel,
  modelEntries,
  type PresentedCapability,
} from "../apps/web/src/business/capability-presentation.js";

const base = {
  id: "", revision: 1, connectionId: "c", purpose: "video" as const,
  mode: "frames_v1", enabled: true, supportedPurposes: [],
};
const seedanceFrames: PresentedCapability = {
  ...base, id: "a", modelVersion: "volcengine/doubao-seedance-2-0-mini-260615",
  displayName: "Seedance 2.0 Mini", mode: "frames_v1", executionMode: "verified_provider",
};
const seedanceReference: PresentedCapability = { ...seedanceFrames, id: "b", mode: "reference_v1" };
const h3: PresentedCapability = {
  ...base, id: "c", modelVersion: "minimax/MiniMax-H3", displayName: "MiniMax H3",
  mode: "frames_v1", executionMode: "verified_provider",
};

test("two modes of one model collapse into a single entry, in arrival order", () => {
  const entries = modelEntries([seedanceFrames, h3, seedanceReference]);
  assert.deepEqual(entries.map((e) => e.name), ["Seedance 2.0 Mini", "MiniMax H3"]);
  assert.deepEqual(entries[0]!.capabilities.map((c) => c.id), ["a", "b"]);
  assert.deepEqual(entries[1]!.capabilities.map((c) => c.id), ["c"]);
});

test("a record without a display name falls back to its model version, never to a blank row", () => {
  const legacy: PresentedCapability = { ...base, id: "d", modelVersion: "Local Video Demo", mode: "video_fixture_v1", executionMode: "test_fixture" };
  const [entry] = modelEntries([legacy]);
  assert.equal(entry!.name, "Local Video Demo");
  assert.equal(entry!.fixture, true);
});

test("a mode has a label only when it is one of ours and the model offers more than one", () => {
  assert.equal(modeLabel(seedanceFrames), "首尾帧");
  assert.equal(modeLabel(seedanceReference), "参考图");
  assert.equal(modeLabel({ ...base, id: "e", modelVersion: "x", mode: "video_fixture_v1" }), undefined);
});

test("choosing a model keeps the mode in hand when the new model has it, else takes its first", () => {
  const [seedance, minimax] = modelEntries([seedanceFrames, seedanceReference, h3]);
  assert.equal(capabilityForModel(seedance!, "reference_v1").id, "b");
  assert.equal(capabilityForModel(seedance!, undefined).id, "a");
  assert.equal(capabilityForModel(minimax!, "reference_v1").id, "c");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import tsx --test tests/capability-presentation.test.ts`
Expected: FAIL —— `Cannot find module '../apps/web/src/business/capability-presentation.js'`。

- [ ] **Step 3: 写实现**

Create `apps/web/src/business/capability-presentation.ts`:

```ts
import type { components } from "@drama/contracts";
type Schema<T extends keyof components["schemas"]> = components["schemas"][T];

export type PresentedCapability = Schema<"Capability"> & {
  executionMode?: "test_fixture" | "verified_provider";
};

/**
 * One row of the model list: a model and every capability record that belongs
 * to it. The record is per (model, input mode), so a model that accepts both
 * start/end frames and reference images arrives as two records.
 */
export type ModelEntry = {
  modelVersion: string;
  name: string;
  /** A controlled fixture never reaches a provider; the row says so. */
  fixture: boolean;
  capabilities: PresentedCapability[];
};

/**
 * The input modes are ours, not a vendor's: they name how a request is fed,
 * not what the vendor calls its API. A mode this table does not know stays
 * unlabelled rather than showing its identifier.
 */
const MODE_LABELS: Record<string, string> = {
  frames_v1: "首尾帧",
  reference_v1: "参考图",
};

export function modeLabel(capability: PresentedCapability): string | undefined {
  return MODE_LABELS[capability.mode];
}

/** One entry per model, each in the order its first record arrived. */
export function modelEntries(
  capabilities: readonly PresentedCapability[],
): ModelEntry[] {
  const entries = new Map<string, ModelEntry>();
  for (const capability of capabilities) {
    const existing = entries.get(capability.modelVersion);
    if (existing) {
      existing.capabilities.push(capability);
      continue;
    }
    entries.set(capability.modelVersion, {
      modelVersion: capability.modelVersion,
      // A record provisioned before the display name existed still needs a row.
      name: capability.displayName || capability.modelVersion,
      fixture: capability.executionMode === "test_fixture",
      capabilities: [capability],
    });
  }
  return [...entries.values()];
}

/** The record to use for a model: the mode already in hand, else its first. */
export function capabilityForModel(
  entry: ModelEntry,
  preferredMode: string | undefined,
): PresentedCapability {
  return (
    entry.capabilities.find((c) => c.mode === preferredMode) ??
    entry.capabilities[0]!
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import tsx --test tests/capability-presentation.test.ts`
Expected: PASS（4 项）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/business/capability-presentation.ts tests/capability-presentation.test.ts
git commit -m "$(cat <<'MSG'
feat(web): group capability records by the model they belong to

A capability record exists per model and input mode, so a model that accepts
both start/end frames and reference images reaches the panel as two records
carrying the same name. This groups them into one entry per model and names
the modes, so the list can hold one row per model and the mode can be chosen
beside it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 3: 比例白名单、档位可选项与两级归一

**Files:**
- Modify: `apps/web/src/business/generation-specification.ts`
- Test: `tests/generation-specification.test.ts`

**Interfaces:**
- Consumes: 任务 1 的 `Capability.outputs`。
- Produces（`SpecificationCapability` 增加 `outputs?`）：
  - `PANEL_ASPECT_RATIOS: readonly ["16:9", "9:16", "1:1"]`
  - `aspectRatioOptions(capability): string[]`
  - `qualityOptions(capability, aspectRatio): { quality: string; resolution: string }[]`
  - `resolutionFor(capability, aspectRatio, quality): string | undefined`
  - `qualityOf(capability, resolution): string | undefined`
  - `specificationSummary({ kind, output, capability?, shotSourceCount? })`

- [ ] **Step 1: 写失败的测试**

在 `tests/generation-specification.test.ts` 顶部的 import 里补上新函数，并在文件末尾追加：

```ts
const seedream = {
  allowedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "21:9"],
  allowedResolutions: ["1024x1024", "1424x800", "2816x1584", "800x1424", "1152x864", "1568x672"],
  outputs: [
    { resolution: "1024x1024", aspectRatio: "1:1", quality: "1K" },
    { resolution: "1424x800", aspectRatio: "16:9", quality: "1K" },
    { resolution: "2816x1584", aspectRatio: "16:9", quality: "2K" },
    { resolution: "800x1424", aspectRatio: "9:16", quality: "1K" },
    { resolution: "1152x864", aspectRatio: "4:3", quality: "1K" },
    { resolution: "1568x672", aspectRatio: "21:9", quality: "1K" },
  ],
};

test("the panel offers three ratios and drops the rest", () => {
  assert.deepEqual(aspectRatioOptions(seedream), ["16:9", "9:16", "1:1"]);
});

test("a model that allows none of the three keeps its own ratios rather than none", () => {
  assert.deepEqual(
    aspectRatioOptions({ allowedAspectRatios: ["3:5"], allowedResolutions: ["96x160"] }),
    ["3:5"],
  );
});

test("the tiers on offer are the ones the chosen ratio actually has", () => {
  assert.deepEqual(qualityOptions(seedream, "16:9"), [
    { quality: "1K", resolution: "1424x800" },
    { quality: "2K", resolution: "2816x1584" },
  ]);
  assert.deepEqual(qualityOptions(seedream, "9:16"), [{ quality: "1K", resolution: "800x1424" }]);
  assert.deepEqual(qualityOptions(seedream, undefined), []);
});

test("without an output table the flat resolution list stands in, unlabelled", () => {
  const legacy = { allowedAspectRatios: ["1:1"], allowedResolutions: ["32x32", "64x64"] };
  assert.deepEqual(qualityOptions(legacy, "1:1"), [
    { quality: "32x32", resolution: "32x32" },
    { quality: "64x64", resolution: "64x64" },
  ]);
  assert.equal(qualityOf(legacy, "32x32"), "32x32");
});

test("a ratio and a tier resolve to one pixel size", () => {
  assert.equal(resolutionFor(seedream, "16:9", "2K"), "2816x1584");
  assert.equal(resolutionFor(seedream, "9:16", "2K"), undefined);
  assert.equal(qualityOf(seedream, "2816x1584"), "2K");
});

test("switching models drops a size the new model cannot make, and fills a lone choice", () => {
  // 16:9 survives; 2K does not exist for it on the new model, so the size goes.
  const narrowed = {
    allowedAspectRatios: ["16:9"],
    allowedResolutions: ["1280x720"],
    outputs: [{ resolution: "1280x720", aspectRatio: "16:9", quality: "720p" }],
  };
  assert.deepEqual(
    reconcileOutputForCapability({
      kind: "video",
      output: { aspectRatio: "16:9", resolution: "2816x1584" },
      capability: narrowed,
    }),
    { aspectRatio: "16:9", resolution: "1280x720" },
  );
});

test("a summary names the tier, not the pixel size, and writes seconds as s", () => {
  assert.equal(
    specificationSummary({
      kind: "video",
      capability: seedream,
      output: { aspectRatio: "16:9", resolution: "2816x1584", durationSeconds: 5, withAudio: true },
    }),
    "16:9 · 2K · 5s · 有声",
  );
});
```

既有用例里三处 `5 秒`／`8 秒` 的期望值同步改成 `5s`／`8s`。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --import tsx --test tests/generation-specification.test.ts`
Expected: FAIL —— `aspectRatioOptions` 等未导出。

- [ ] **Step 3: 写实现**

`apps/web/src/business/generation-specification.ts`：

`SpecificationCapability` 加一行：

```ts
  outputs?: { resolution: string; aspectRatio: string; quality: string }[] | undefined;
```

在 `durationControl` 之前插入：

```ts
/**
 * The ratios the panel offers. A vendor allows more — photographic ratios and
 * cinemascope among them — and the API still accepts every one of them; this
 * is the product's choice of what to put on screen, not a limit on the model.
 */
export const PANEL_ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;

/**
 * The ratio tiles for this model. A model that allows none of the three keeps
 * its own list: a panel with no selectable ratio could never be submitted.
 */
export function aspectRatioOptions(
  capability: SpecificationCapability | undefined,
): string[] {
  const allowed = capability?.allowedAspectRatios ?? [];
  const offered = PANEL_ASPECT_RATIOS.filter((ratio) => allowed.includes(ratio));
  return offered.length ? [...offered] : [...allowed];
}

/**
 * The quality tiers available at this ratio, each with the pixel size it
 * resolves to. Without an output table the flat resolution list stands in and
 * each size labels itself, which is what a record provisioned before the table
 * existed can offer.
 */
export function qualityOptions(
  capability: SpecificationCapability | undefined,
  aspectRatio: string | undefined,
): { quality: string; resolution: string }[] {
  if (!capability || !aspectRatio) return [];
  const outputs = capability.outputs;
  if (!outputs?.length)
    return (capability.allowedResolutions ?? []).map((resolution) => ({
      quality: resolution,
      resolution,
    }));
  return outputs
    .filter((output) => output.aspectRatio === aspectRatio)
    .map(({ quality, resolution }) => ({ quality, resolution }));
}

/** The one pixel size this ratio and tier name. */
export function resolutionFor(
  capability: SpecificationCapability | undefined,
  aspectRatio: string | undefined,
  quality: string | undefined,
): string | undefined {
  return qualityOptions(capability, aspectRatio).find((o) => o.quality === quality)
    ?.resolution;
}

/** The tier a pixel size belongs to; the size itself when nothing names it. */
export function qualityOf(
  capability: SpecificationCapability | undefined,
  resolution: string | undefined,
): string | undefined {
  if (!resolution) return undefined;
  const outputs = capability?.outputs;
  if (!outputs?.length) return resolution;
  return outputs.find((o) => o.resolution === resolution)?.quality ?? resolution;
}
```

`specificationSummary` 改签名与两处文案：

```ts
export function specificationSummary({
  kind,
  output,
  capability,
  shotSourceCount = 0,
}: {
  kind: Kind;
  output: OutputOptions;
  capability?: SpecificationCapability | undefined;
  shotSourceCount?: number;
}): string | null {
  const parts: string[] = [];
  if (kind !== "audio") {
    if (output.aspectRatio) parts.push(output.aspectRatio);
    const quality = qualityOf(capability, output.resolution);
    if (quality) parts.push(quality);
  }
  if (kind !== "image" && output.durationSeconds !== undefined)
    parts.push(`${output.durationSeconds}s`);
```

（`withAudio`、`seed`、`shotSourceCount` 三段不动。）

`reconcileOutputForCapability` 里 `kind !== "audio"` 的那一段整段替换——比例先定，尺寸必须落在这个比例上：

```ts
  if (kind !== "audio") {
    const ratios = aspectRatioOptions(capability);
    if (output.aspectRatio && ratios.includes(output.aspectRatio))
      next.aspectRatio = output.aspectRatio;
    else if (ratios.length === 1) next.aspectRatio = ratios[0]!;
    const qualities = qualityOptions(capability, next.aspectRatio);
    // The size in hand survives only where it belongs to the ratio that stuck.
    const kept = qualities.find((o) => o.resolution === output.resolution);
    if (kept) next.resolution = kept.resolution;
    else if (qualities.length === 1) next.resolution = qualities[0]!.resolution;
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --import tsx --test tests/generation-specification.test.ts`
Expected: PASS。若既有的「切换模型只保留新模型接受的输出项」用例失败，核对它的期望值：新逻辑对「比例存在但该比例下无此尺寸」的情形会丢掉尺寸，这是本任务要的行为，按 Review Focus 第 3 条更新期望。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/business/generation-specification.ts tests/generation-specification.test.ts
git commit -m "$(cat <<'MSG'
feat(web): choose a ratio and a quality tier instead of a pixel size

Seedream allows eight ratios across three tiers, which reached the panel as
twenty-four pixel strings with nothing to say which belonged together, and a
ratio could be paired with a size that contradicted it until the request was
refused. The ratio and the tier now resolve to the one size they name, the
panel offers the three ratios this product shoots in, and a record without an
output table still lists the sizes it has.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 4: 模型列表只留名字，模式独立成胶囊

**Files:**
- Modify: `apps/web/src/studio/composer/ComposerControls.tsx:24-98`（`ModelPicker`）
- Modify: `apps/web/src/studio/composer/Composer.tsx:122-197`、`:436-455`
- Test: `tests/e2e/studio-composer.spec.ts`（断言在任务 6 补齐；本任务只保证既有 e2e 不破）

**Interfaces:**
- Consumes: 任务 2 的 `modelEntries`、`modeLabel`、`capabilityForModel`。
- Produces: `ModelPicker` 的 props 改为 `{ kind, entries: ModelEntry[], loading, capability, disabled, onChange: (capability) => void }`；新增 `ModePicker`，props `{ entry: ModelEntry | undefined, capability, disabled, onChange: (capability) => void }`。

- [ ] **Step 1: 改 `ModelPicker`**

`ComposerControls.tsx` 顶部 import 加：

```ts
import {
  capabilityForModel,
  modeLabel,
  type ModelEntry,
} from "../../business/capability-presentation";
```

删除 `statusLabel`，换成只认夹具的一行：

```ts
/** A controlled fixture never reaches a provider; nothing marks a real model. */
const fixtureLabel = (entry: ModelEntry) => (entry.fixture ? "受控测试" : undefined);
```

`ModelPicker` 的签名与函数体改成（其余 Popover 包装原样保留）：

```tsx
export function ModelPicker({
  kind,
  entries,
  loading,
  capability,
  disabled,
  onChange,
}: {
  kind: Kind;
  entries: readonly ModelEntry[];
  loading: boolean;
  capability: ImageCapability | undefined;
  disabled: boolean;
  onChange: (capability: ImageCapability) => void;
}) {
  const popover = useEscapablePopover();
  const Icon = icons[kind];
  const current = entries.find((entry) =>
    entry.capabilities.some((c) => c.id === capability?.id),
  );
  return (
    // …Popover.Target 原样，只把按钮里的名字换掉：
    <span>
      {current?.name ??
        (loading ? "正在读取模型" : entries.length ? "选择模型" : "暂无可用模型")}
    </span>
```

Dropdown 的列表体：

```tsx
          <div className={classes.models} role="listbox" aria-label="可用模型">
            {entries.map((entry) => (
              <UnstyledButton
                key={entry.modelVersion}
                className={classes.model}
                role="option"
                aria-selected={entry.modelVersion === current?.modelVersion}
                onClick={() => {
                  // Rule 17 applies to the record, so keep the mode in hand.
                  onChange(capabilityForModel(entry, capability?.mode) as ImageCapability);
                  popover.onChange(false);
                }}
              >
                <Icon size={18} aria-hidden />
                <span className={classes.modelName}>{entry.name}</span>
                {fixtureLabel(entry) && (
                  <span className={classes.modelStatus}>{fixtureLabel(entry)}</span>
                )}
              </UnstyledButton>
            ))}
          </div>
```

`entries.length` 取代原来的 `models.length` 判空。

- [ ] **Step 2: 新增 `ModePicker`**

紧接 `ModelPicker` 之后加入：

```tsx
/**
 * How the request is fed: start and end frames, or reference images. One
 * record exists per mode, so choosing a mode chooses a record — which is why
 * it is frozen alongside the model. A model with one mode shows no pill.
 */
export function ModePicker({
  entry,
  capability,
  disabled,
  onChange,
}: {
  entry: ModelEntry | undefined;
  capability: ImageCapability | undefined;
  disabled: boolean;
  onChange: (capability: ImageCapability) => void;
}) {
  const popover = useEscapablePopover();
  const choices = (entry?.capabilities ?? []).filter((c) => modeLabel(c));
  if (choices.length < 2) return null;
  return (
    <Popover
      opened={popover.opened}
      onChange={popover.onChange}
      position="top-start"
      shadow="md"
      trapFocus
      returnFocus
      withinPortal
    >
      <Popover.Target>
        <UnstyledButton
          className={classes.pill}
          aria-label="进料方式"
          aria-haspopup="listbox"
          disabled={disabled}
          {...popover.targetProps}
        >
          <FrameCorners size={14} aria-hidden />
          <span>{(capability && modeLabel(capability)) ?? "进料方式"}</span>
          <CaretDown size={12} aria-hidden />
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown>
        <div className={classes.models} role="listbox" aria-label="进料方式">
          {choices.map((choice) => (
            <UnstyledButton
              key={choice.id}
              className={classes.model}
              role="option"
              aria-selected={choice.id === capability?.id}
              onClick={() => {
                onChange(choice as ImageCapability);
                popover.onChange(false);
              }}
            >
              <span className={classes.modelName}>{modeLabel(choice)}</span>
            </UnstyledButton>
          ))}
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}
```

`@phosphor-icons/react` 的 import 加上 `FrameCorners`。

- [ ] **Step 3: 接到 `Composer.tsx`**

import 加：

```ts
import { modelEntries } from "../../business/capability-presentation";
import { ModelPicker, ModePicker, SpecificationPicker, SubmitButton } from "./ComposerControls";
```

`models` 的 `useMemo` 之后加一个：

```ts
  const entries = useMemo(() => modelEntries(models), [models]);
  const entry = entries.find((e) => e.capabilities.some((c) => c.id === content.capabilityId));
```

（`entry` 要放在 `content` 之后，`capability` 那一行旁边。）

`chooseModel` 改名为 `chooseCapability`，语义不变——换模型与换模式都走它：

```ts
  // Rule 17: switching the record keeps only what it accepts and fills in single choices.
  const chooseCapability = (next: ImageCapability) =>
    configure({
      connectionId: next.connectionId,
      capabilityId: next.id,
      output: reconcileOutputForCapability({ kind, output, capability: next }),
    });
```

底栏 JSX：

```tsx
        <ModelPicker
          kind={kind}
          entries={entries}
          loading={capabilities.isLoading}
          capability={capability}
          disabled={disabled || frozen}
          onChange={chooseCapability}
        />
        <ModePicker
          entry={entry}
          capability={capability}
          disabled={disabled || frozen}
          onChange={chooseCapability}
        />
```

**Review Focus 第 4 条：** `ModePicker` 的 `disabled` 必须是 `disabled || frozen`，与 `ModelPicker` 同。模式换的是能力记录，规则 6 要求有计划或原请求时它和模型一起冻。

- [ ] **Step 4: 编译并跑既有 e2e 的模型段**

```bash
npm run build
npx playwright test --config tests/e2e/playwright.config.ts studio-composer
```

Expected: 模型段的既有断言仍通过——夹具的 `modelVersion` 是 `显式文件 fixture，无真实模型`，没有 `displayName`，按任务 2 的回退显示原名，`getByRole("option", { name: /显式文件 fixture/ })` 照旧命中；它的 `mode` 是 `image_fixture_v1`，`MODE_LABELS` 不认识，`ModePicker` 返回 `null`，底栏不多控件。规格段的 `32x32` 断言会在任务 5 里改，本任务先不管。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/studio/composer/ComposerControls.tsx apps/web/src/studio/composer/Composer.tsx
git commit -m "$(cat <<'MSG'
feat(studio): one row per model, with the input mode beside it

The list held a row per capability record, so each Seedance model appeared
twice under the same text with nothing to tell the rows apart. A row is now a
model and carries only its name; the input mode — start and end frames, or
reference images — is chosen in a pill of its own, which appears only where a
model offers both and freezes with the model once a plan exists.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 5: 规格面板改两级选择

**Files:**
- Modify: `apps/web/src/studio/composer/ComposerControls.tsx`（`SpecificationPicker`）

**Interfaces:**
- Consumes: 任务 3 的 `aspectRatioOptions`、`qualityOptions`、`resolutionFor`、`specificationSummary`。
- Produces: 无新导出；`SpecificationPicker` 的 props 不变。

- [ ] **Step 1: 改 import 与摘要**

```ts
import {
  aspectRatioOptions,
  durationControl,
  qualityOptions,
  resolutionFor,
  specificationSummary,
} from "../../business/generation-specification";
```

```ts
  const summary = specificationSummary({
    kind,
    output,
    capability,
    shotSourceCount: shotSources?.length ?? 0,
  });
  const ratios = kind !== "audio" ? aspectRatioOptions(capability) : [];
  const qualities = kind !== "audio" ? qualityOptions(capability, output.aspectRatio) : [];
```

（删掉原来的 `resolutions` 那一行。）

- [ ] **Step 2: 比例段改为必选，并带上尺寸**

整段替换比例 `<section>` 的按钮 `onClick`——比例不再可以取消，换比例要重算尺寸：

```tsx
                  <UnstyledButton
                    key={ratio}
                    className={classes.tile}
                    aria-pressed={output.aspectRatio === ratio}
                    disabled={locked}
                    onClick={() => {
                      // A ratio and a tier name one size; keep the tier if the
                      // new ratio has it, and take its only size when that is
                      // all it has.
                      const quality = qualities.find(
                        (q) => q.resolution === output.resolution,
                      )?.quality;
                      const next = qualityOptions(capability, ratio);
                      const resolution =
                        resolutionFor(capability, ratio, quality) ??
                        (next.length === 1 ? next[0]!.resolution : undefined);
                      set(
                        resolution
                          ? { aspectRatio: ratio, resolution }
                          : { aspectRatio: ratio },
                        resolution ? [] : ["resolution"],
                      );
                    }}
                  >
                    <RatioGlyph ratio={ratio} />
                    {ratio}
                  </UnstyledButton>
```

- [ ] **Step 3: 清晰度段改档位**

把原来的 `resolutions.length > 0 && (…)` 整段替换：

```tsx
          {qualities.length > 0 && (
            <section>
              <h4 className={classes.specTitle}>清晰度</h4>
              {qualities.length === 1 ? (
                // One tier is not a choice; it reads as the fact it is.
                <div className={classes.duration}>{qualities[0]!.quality}</div>
              ) : (
                <div className={classes.tiles} data-columns="2">
                  {qualities.map(({ quality, resolution }) => (
                    <UnstyledButton
                      key={resolution}
                      className={classes.tile}
                      aria-pressed={output.resolution === resolution}
                      disabled={locked}
                      onClick={() => set({ resolution })}
                    >
                      {quality}
                    </UnstyledButton>
                  ))}
                </div>
              )}
            </section>
          )}
```

**Review Focus 第 5 条：** 单档位收成静态文字，但 `resolution` 仍要落进 output。它由任务 3 的 `reconcileOutputForCapability`（`qualities.length === 1` 时补齐）和 Step 2 的换比例分支负责，本段不再补。

- [ ] **Step 4: 跑 e2e 的规格段**

```bash
npm run build
npx playwright test --config tests/e2e/playwright.config.ts studio-composer
```

Expected: **`tests/e2e/studio-composer.spec.ts:58` 必定失败**——图片夹具（`tests/support/image-generation.ts`）只有 `32x32` 一个尺寸，单档位现在渲染成静态文字而不是按钮。改成：

```ts
await expect(spec.getByRole("button", { name: "1:1", exact: true })).toHaveAttribute("aria-pressed", "true");
// One size is the only tier this fixture has, so the panel states it.
await expect(spec.getByRole("button", { name: "32x32", exact: true })).toHaveCount(0);
await expect(spec).toContainText("32x32");
```

同文件 `:35` 的摘要断言 `toContainText("1:1 · 32x32")` 不用改——夹具没有 `outputs`，`qualityOf` 回退成像素串本身。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/studio/composer/ComposerControls.tsx
git commit -m "$(cat <<'MSG'
feat(studio): the specification panel asks for a ratio and a quality tier

Twenty-four pixel sizes in a two-column grid is a wall to read, and nothing in
it said which sizes were the same shot at a different quality. The panel asks
for the ratio and the tier and resolves the size from the pair, so a ratio can
no longer be paired with a size that contradicts it, and a model offering one
tier states it rather than offering a button that changes nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 6: e2e 覆盖三个胶囊

**Files:**
- Modify: `tests/support/image-generation.ts`（`studio-composer.spec.ts` 的能力记录来源）
- Modify: `tests/e2e/studio-composer.spec.ts`

**Interfaces:**
- Consumes: 任务 4、5 的界面。
- Produces: 无。

- [ ] **Step 1: 夹具补一个双模式、带 `outputs` 的模型**

`tests/support/image-generation.ts` 里，既有那条 `test_fixture` 记录插入之后，再插两条**只差 `mode`** 的记录。它们是 `verified_provider`，背后没有真实凭据，**用例只断言界面，绝不提交**。

```ts
// A synthetic model that offers two input modes and three ratios across two
// tiers: the panel's grouping, mode pill and tier list have nothing else to
// exercise them. It is never submitted.
const dualModeVersionId = randomUUID();
for (const mode of ["frames_v1", "reference_v1"])
  await f.admin.query(
    `INSERT INTO ${scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'verified_provider',true,2,100)`,
    [randomUUID(), f.tenant.id, connectionId, dualModeVersionId, {
      ...definition,
      mode,
      modelVersion: "fixture/dual-mode",
      displayName: "双模式 fixture",
      allowedAspectRatios: ["16:9", "9:16", "21:9"],
      allowedResolutions: ["864x496", "1280x720", "720x1280", "1470x630"],
      outputs: [
        { resolution: "864x496", aspectRatio: "16:9", quality: "480p" },
        { resolution: "1280x720", aspectRatio: "16:9", quality: "720p" },
        { resolution: "720x1280", aspectRatio: "9:16", quality: "720p" },
        { resolution: "1470x630", aspectRatio: "21:9", quality: "720p" },
      ],
    }],
  );
```

`kind === "image"` 之外的分支不受影响；`definition` 的 `purpose` 跟着外层 `kind`。

- [ ] **Step 2: 写失败的断言**

在 `studio-composer.spec.ts` 的 ST-03 用例里，既有的规格截图之后、`Rule 8: one click prepares and executes once` 之前插入。注意这段跑完要**把模型选回夹具**，否则后面的提交会走 `verified_provider`。

```ts
  // One row per model: two records differing only in mode collapse into one.
  await panel.getByRole("button", { name: "生成模型", exact: true }).click();
  const list = page.getByRole("listbox", { name: "可用模型", exact: true });
  await expect(list.getByRole("option", { name: /双模式 fixture/ })).toHaveCount(1);
  await list.getByRole("option", { name: /双模式 fixture/ }).click();
  // The mode is chosen beside the model, not inside its row.
  const mode = panel.getByRole("button", { name: "进料方式", exact: true });
  await expect(mode).toContainText("首尾帧");
  await mode.click();
  await page.getByRole("option", { name: "参考图", exact: true }).click();
  await expect(mode).toContainText("参考图");
  // The panel offers three ratios; 21:9 is the model's, not the panel's.
  await panel.getByRole("button", { name: "生成规格", exact: true }).click();
  await expect(spec.getByRole("button", { name: "21:9", exact: true })).toHaveCount(0);
  await spec.getByRole("button", { name: "16:9", exact: true }).click();
  await spec.getByRole("button", { name: "720p", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(panel.getByRole("button", { name: "生成规格", exact: true })).toContainText("16:9 · 720p");
  // 9:16 has one tier here, so the panel states it — and still fills the size in.
  await panel.getByRole("button", { name: "生成规格", exact: true }).click();
  await spec.getByRole("button", { name: "9:16", exact: true }).click();
  await expect(spec.getByRole("button", { name: "720p", exact: true })).toHaveCount(0);
  await expect(spec).toContainText("720p");
  await page.keyboard.press("Escape");
  await expect(panel.getByRole("button", { name: "生成规格", exact: true })).toContainText("9:16 · 720p");
  // Back to the fixture model: the rest of this case submits, and only a
  // fixture may be submitted here.
  await panel.getByRole("button", { name: "生成模型", exact: true }).click();
  await page.getByRole("option", { name: /显式文件 fixture/ }).click();
  await expect(panel.getByRole("button", { name: "进料方式", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "生成规格", exact: true })).toContainText("1:1 · 32x32");
```

最后两行同时钉住两件事：只有一种模式的模型不出模式胶囊；换模型按规则 17 归一到新模型的唯一选项。

**Review Focus 第 4 条（冻结）**在同一用例已有的冻结段（`:81` 一带）补一行。那里选的是夹具模型、不出模式胶囊，所以断言写成「胶囊不存在，且模型胶囊禁用」即可覆盖；双模式模型的冻结路径不提交、无法到达冻结态，不另造用例：

```ts
  await expect(panel.getByRole("button", { name: "生成模型", exact: true })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "进料方式", exact: true })).toHaveCount(0);
```

并在 `ModePicker` 的实现上复核一次 `disabled={disabled || frozen}`（任务 4 Step 3）——这是本条的实际保障。

- [ ] **Step 3: 跑用例，先失败后通过**

```bash
npm run build
npx playwright test --config tests/e2e/playwright.config.ts studio-composer
```

先在没插夹具记录时跑，确认 `toHaveCount(1)` 落空；补完 Step 1 后应全绿。

- [ ] **Step 4: 跑全量检查**

```bash
npm test
.venv/bin/python docs/implementation/check_design.py
npm run check
```

Expected: 全绿。`npm run check` 的 lint 会抓出任务 4 删掉 `statusLabel` 后遗留的未使用 import，一并清掉。

- [ ] **Step 5: 提交**

```bash
git add tests/support/image-generation.ts tests/e2e/studio-composer.spec.ts
git commit -m "$(cat <<'MSG'
test(studio): the three pills of the composer's bottom row

A model offering two input modes reaches the panel as two capability records,
and the ratios a model allows are not all the ones the panel offers. These pin
both: one row per model, a mode pill that appears only where there is a choice,
and a specification panel that offers three ratios and names tiers rather than
pixel sizes, stating the tier where a ratio has only one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## 收尾

全部任务完成后：

- [ ] `git log --oneline origin/main..HEAD` 应是 6 条。
- [ ] 在 `docs/implementation/85-studio-rebuild.md` 的遗留项后追加一段，记下本次改的三个控件与「主动不做」的四条（厂商、状态字、像素尺寸、日期版本号），写给没见过这段对话的读者。
- [ ] 告知用户：demo 箱需重跑 `scripts/provision-verified-capabilities.ts`，新字段才会出现在能力记录里；在那之前箱子上的面板按回退分支工作，显示 profile id 与拍平尺寸，不报错。

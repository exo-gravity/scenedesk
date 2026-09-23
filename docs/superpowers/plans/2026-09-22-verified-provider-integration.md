# 真实供应商接入（MiniMax、火山方舟）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让画布里已有的图片、视频生成流程在生产上真的调用 MiniMax-H3、Seedance 2.0 系列与 Seedream 5.0，并真的估价、归档。

**Architecture:** 一个厂商一个 `AssistanceAdapter` 实例（`packages/provider/src/verified/`），模型差异全部放在代码里的模型档案（`profiles.ts`），能力条目由档案派生写入 `generation_capabilities`。现有 SQL 状态机、队列、归档协议、取消与恢复不改语义；只放开三处"仅 fixture"门禁，并新增一个生成执行器进程与一份 `generation.json` 配置。

**Tech Stack:** Node 22、TypeScript（NodeNext）、`node:test` + tsx、pg、pg-boss（已有）、S3 兼容对象存储（已有 `MediaStore`）。没有新的第三方依赖；供应商调用用全局 `fetch`。

**Spec:** `docs/superpowers/specs/2026-09-22-verified-provider-integration-design.md`（调研见 `docs/research/2026-09-22-minimax-seedance-official-api.md`）

## Global Constraints

- 所有命令在仓库根目录执行；单元测试 `npm test`（`node --import tsx --test tests/*.test.ts`），数据库测试 `npm run test:db`，部署工程 `sh deploy/check.sh`，全量 `npm run check`。
- 迁移只增不改：新迁移文件是 `packages/database/migrations/0117_verified_provider_runtime.sql`，用 `CREATE OR REPLACE FUNCTION` 覆盖旧函数体，不改旧文件。
- 供应商创建请求**绝不重试**；任何异常交给现有 worker 变成 `unknown`。
- 生产进程不读环境变量密钥；全部来自 `SCENEDESK_CONFIG_FILE` 指向的 JSON（默认 `/run/secrets/config.json`）。
- 密钥、Base64 素材内容、供应商完整响应体不进日志和证据；证据里只有回执（`kind`、`correlation`、`providerJobId`、`code`、`output`、`usage`）。
- 回执 `correlation` 恒等于 `submission.attemptId`／`task.attemptId`。
- 输出回执形状固定为 `{ kind: "fixture_object", object: { key, versionId, bytes }, sha256, mime }`，`key` 必须是 `originals/<uuid>`（由 `MediaStore.publish` 生成）。
- 能力 `mode` 只能是 `frames_v1` 或 `reference_v1`；`modelVersion` 就是档案 ID（如 `volcengine/doubao-seedance-2-0-260128`）。
- 金额单位：`{ currency: "CNY", amountMicros: string }`，1 元 = 1,000,000 micros。
- 提交给用户看的错误文案用中文；代码注释与提交信息用英文，提交信息以 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` 结尾。
- 首版不做：租户密钥、回调、参考视频／音频、组图、费用入账、找回、多执行器。

## File Structure

| 文件 | 责任 |
|---|---|
| `packages/provider/src/verified/profiles.ts` | 档案类型、7 条档案、`capabilityDefinition`、`estimateCost`、`resolveOutput`、`findProfile` |
| `packages/provider/src/verified/http.ts` | `jsonRequest`：有界、分类、不重试 |
| `packages/provider/src/verified/inputs.ts` | `MediaResolver`／`ResolvedMedia` 类型、`referenceRoles`、`dataUri`、`referenceLegend` |
| `packages/provider/src/verified/outputs.ts` | `archiveBytes`：字节或 URL → 临时文件 → `publish` → 回执 |
| `packages/provider/src/verified/minimax/client.ts` | MiniMax v2 三个接口 |
| `packages/provider/src/verified/minimax/adapter.ts` | `createMinimaxAdapter` |
| `packages/provider/src/verified/volcengine/client.ts` | 方舟视频三个接口 + 图片同步接口 |
| `packages/provider/src/verified/volcengine/adapter.ts` | `createVolcengineAdapter` |
| `packages/provider/src/verified/config.ts` | `parseGenerationConfig`：`vendors`、`connections` 形状校验（不含数据库与存储） |
| `packages/provider/src/verified/index.ts` | `createVerifiedAdapters(config, deps)` |
| `packages/provider/src/index.ts` | 追加导出 `./verified/index.js`、`./verified/profiles.js`、`./verified/config.js` |
| `packages/database/migrations/0117_verified_provider_runtime.sql` | 放开 verified 回执；租约 180 秒；`read_generation_media_sources(uuid)` |
| `packages/database/src/roles.ts` | `generationFunctions` 追加新函数 |
| `apps/api/src/modules/generation/media-input.ts` | 门禁接受 verified 模式 |
| `apps/api/src/modules/generation/model.ts` | 验收门禁改为 `verifiedAt`；真实 `estimateCost`；`costStatus: "pending"` |
| `apps/api/src/modules/generation/worker.ts` | 查询时限 120 秒 |
| `packages/media/src/generated-output.ts` | 视频时长容差 ±1 秒 |
| `apps/worker/src/verified-runtime.ts` | `createVerifiedGenerationRuntime`：媒体解析、适配器组装、扫描循环 |
| `apps/worker/src/generation-verified.ts` | 本地入口（`APP_ENV=local`，读 JSON 配置） |
| `deploy/runtime/config.ts` | `generationConfiguration`；`PROVIDER_MODE` 接受 `verified` |
| `deploy/runtime/generation-worker.ts` | 生产入口，健康端口 4314 |
| `deploy/runtime/provision.ts` + `deploy/examples/provision.json` | `generationRole` 授权 |
| `deploy/runtime/deployment-audit.ts` + `deploy/runtime/audit.ts` | `executorConfigured` |
| `deploy/compose.yaml`、`deploy/Dockerfile`、`deploy/examples/generation.json` | 服务、镜像目标、示例配置 |
| `scripts/provision-verified-capabilities.ts` | 从档案写能力行；`--enable` |
| `scripts/verified-smoke.ts` | 人工付费冒烟 |
| `tests/verified-*.test.ts` | 单元测试（假服务器） |
| `tests/integration/verified-provider.test.ts` | 迁移 + API 计划 + worker 走假方舟服务 |
| `deploy/tests/config.test.ts` | `generationConfiguration` 用例 |
| `docs/implementation/86-verified-provider-runtime.md` | 实施记录 |

---

### Task 1: 模型档案与派生函数

**Files:**
- Create: `packages/provider/src/verified/profiles.ts`
- Modify: `packages/provider/src/index.ts`
- Test: `tests/verified-profiles.test.ts`

**Interfaces:**
- Produces:
  - `type ModelProfile`, `type ProfileMode = "frames_v1" | "reference_v1"`, `type Vendor = "minimax" | "volcengine"`
  - `const PROFILES: readonly ModelProfile[]`
  - `findProfile(id: string): ModelProfile | undefined`
  - `resolveOutput(profile, resolution: string): { resolution: string; ratio: string }`（未列出的尺寸抛 `VerifiedProfileError("OUTPUT_NOT_IN_PROFILE")`）
  - `capabilityDefinition(profile, mode, options: { verifiedAt?: string }): CapabilityDefinition`（H3 空 outputs 抛 `VerifiedProfileError("OUTPUTS_UNMEASURED")`）
  - `estimateCost(profile, resolvedInput): Schema<"CostEstimate">`
  - `class VerifiedProfileError extends Error { code: string }`

- [ ] **Step 1: 写失败测试**

```ts
// tests/verified-profiles.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateContract } from "@drama/contracts/validation";
import {
  PROFILES, findProfile, resolveOutput, capabilityDefinition, estimateCost, VerifiedProfileError,
} from "@drama/provider";

test("every profile derives a contract-valid capability definition per mode", () => {
  for (const profile of PROFILES) {
    if (Object.keys(profile.outputs).length === 0) continue; // H3 until measured
    for (const mode of profile.modes) {
      const definition = capabilityDefinition(profile, mode, {});
      const result = validateContract("Capability", {
        ...definition, id: "00000000-0000-4000-8000-000000000000",
        connectionId: "00000000-0000-4000-8000-000000000001", revision: 1, enabled: false,
      });
      assert.ok(result.valid, `${profile.id}/${mode}: ${JSON.stringify(result.errors)}`);
      assert.equal(definition.modelVersion, profile.id);
      assert.equal(definition.mode, mode);
      assert.equal(definition.executionMode, "verified_provider");
    }
  }
});
test("H3 refuses a definition until its pixel table is measured", () => {
  const h3 = findProfile("minimax/MiniMax-H3")!;
  assert.throws(() => capabilityDefinition(h3, "frames_v1", {}), (e: VerifiedProfileError) => e.code === "OUTPUTS_UNMEASURED");
});
test("frames_v1 exposes start/end frame purposes; reference_v1 exposes reference purposes", () => {
  const seedance = findProfile("volcengine/doubao-seedance-2-0-260128")!;
  assert.deepEqual(capabilityDefinition(seedance, "frames_v1", {}).supportedPurposes, ["start_frame", "end_frame"]);
  assert.deepEqual(capabilityDefinition(seedance, "reference_v1", {}).supportedPurposes,
    ["identity", "look", "style", "location", "prop", "composition"]);
  assert.deepEqual(capabilityDefinition(seedance, "frames_v1", {}).inputRules!.map((r) => r.maxCount), [1, 1]);
});
test("resolveOutput maps pixel sizes to vendor tiers and rejects unknown sizes", () => {
  const seedance = findProfile("volcengine/doubao-seedance-2-0-mini-260615")!;
  assert.deepEqual(resolveOutput(seedance, "720x1280"), { resolution: "720p", ratio: "9:16" });
  assert.throws(() => resolveOutput(seedance, "1920x1080"), (e: VerifiedProfileError) => e.code === "OUTPUT_NOT_IN_PROFILE");
});
test("estimateCost: Seedance 720p 5s no video input = 4.968 CNY base + 20% hold", () => {
  const seedance = findProfile("volcengine/doubao-seedance-2-0-260128")!;
  const estimate = estimateCost(seedance, { references: [], output: { resolution: "1280x720", durationSeconds: 5, withAudio: true } } as any);
  assert.equal(estimate.baseCost.amountMicros, "4968000");
  assert.equal(estimate.holdMargin.amountMicros, "993600");
  assert.equal(estimate.totalReservation.amountMicros, "5961600");
  assert.equal(estimate.pricingRevision, seedance.pricing.revision);
});
test("estimateCost: Seedream pro 2K single image with 3 references = 0.60 + 2×0.02", () => {
  const pro = findProfile("volcengine/doubao-seedream-5-0-pro-260628")!;
  const refs = [1, 2, 3].map(() => ({ reference: { mediaId: "x", purpose: "identity" }, sourceLevel: "shot" }));
  const estimate = estimateCost(pro, { references: refs, output: { resolution: "2048x2048" } } as any);
  assert.equal(estimate.baseCost.amountMicros, "640000");
});
test("estimateCost: MiniMax per-second with 7 reference images charges 2 extra", () => {
  const h3 = findProfile("minimax/MiniMax-H3")!;
  const refs = Array.from({ length: 7 }, () => ({ reference: { mediaId: "x", purpose: "identity" }, sourceLevel: "shot" }));
  const estimate = estimateCost(h3, { references: refs, output: { resolution: "768P", durationSeconds: 6, withAudio: true } } as any);
  assert.equal(estimate.baseCost.amountMicros, String(6 * 500000 + 2 * 200000));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --import tsx --test tests/verified-profiles.test.ts`
Expected: FAIL，`@drama/provider` 没有导出 `PROFILES`。

- [ ] **Step 3: 实现档案模块**

```ts
// packages/provider/src/verified/profiles.ts
import type { components } from "@drama/contracts";
type Schema<K extends keyof components["schemas"]> = components["schemas"][K];

export type Vendor = "minimax" | "volcengine";
export type ProfileMode = "frames_v1" | "reference_v1";
export type OutputTarget = { resolution: string; ratio: string };
export type Pricing =
  | { kind: "per_second"; revision: string; microsPerSecond: Record<string, number>; freeImages: number; extraImageMicros: number }
  | { kind: "per_token"; revision: string; microsPerMillion: Record<string, number> }
  | { kind: "per_image"; revision: string; microsPerImage: { standard: number; large?: number }; largeThresholdPixels?: number; freeInputImages?: number; extraInputImageMicros?: number };
export type ModelProfile = {
  id: string;
  vendor: Vendor;
  purpose: "video" | "image";
  providerModel: string;
  modes: readonly ProfileMode[];
  /** "<width>x<height>" → vendor tier. Empty until measured (H3). */
  outputs: Record<string, OutputTarget>;
  duration?: { min: number; max: number };
  audioOutput?: boolean;
  referenceImage: { maxCount: number; maxBytes: number; mimeTypes: readonly string[]; minSide: number; maxSide: number };
  pricing: Pricing;
  inflight: number | { personal: number; enterprise: number };
};
export type CapabilityDefinition = Omit<Schema<"Capability">, "id" | "connectionId" | "revision" | "enabled" | "createdAt" | "updatedAt">;

export class VerifiedProfileError extends Error {
  constructor(readonly code: string, message = code) { super(message); this.name = "VerifiedProfileError"; }
}

const REFERENCE_PURPOSES = ["identity", "look", "style", "location", "prop", "composition"] as const;
const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;
const FOUR_MIB = 4 * 1024 * 1024;

const seedanceOutputs = (tiers: ("480p" | "720p" | "1080p")[]): Record<string, OutputTarget> => {
  const table: Record<string, Record<string, string>> = {
    "480p": { "16:9": "864x496", "9:16": "496x864", "1:1": "640x640", "4:3": "752x560", "3:4": "560x752", "21:9": "992x432" },
    "720p": { "16:9": "1280x720", "9:16": "720x1280", "1:1": "960x960", "4:3": "1112x834", "3:4": "834x1112", "21:9": "1470x630" },
    "1080p": { "16:9": "1920x1080", "9:16": "1080x1920", "1:1": "1440x1440", "4:3": "1664x1248", "3:4": "1248x1664", "21:9": "2206x946" },
  };
  const out: Record<string, OutputTarget> = {};
  for (const tier of tiers) for (const [ratio, size] of Object.entries(table[tier]!)) out[size] = { resolution: tier, ratio };
  return out;
};
const seedreamOutputs = (table: Record<string, Record<string, string>>): Record<string, OutputTarget> => {
  const out: Record<string, OutputTarget> = {};
  for (const [tier, ratios] of Object.entries(table)) for (const [ratio, size] of Object.entries(ratios)) out[size] = { resolution: tier, ratio };
  return out;
};
const seedreamPro = seedreamOutputs({
  "1K": { "1:1": "1024x1024", "16:9": "1424x800", "9:16": "800x1424", "4:3": "1152x864", "3:4": "864x1152", "3:2": "1248x832", "2:3": "832x1248", "21:9": "1568x672" },
  "1.5K": { "1:1": "1536x1536", "16:9": "2048x1152", "9:16": "1152x2048", "4:3": "1792x1344", "3:4": "1344x1792", "3:2": "1872x1248", "2:3": "1248x1872", "21:9": "2352x1008" },
  "2K": { "1:1": "2048x2048", "16:9": "2816x1584", "9:16": "1584x2816", "4:3": "2368x1776", "3:4": "1776x2368", "3:2": "2496x1664", "2:3": "1664x2496", "21:9": "3136x1344" },
});
const seedreamLite = seedreamOutputs({
  "2K": { "1:1": "2048x2048", "16:9": "2848x1600", "9:16": "1600x2848", "4:3": "2304x1728", "3:4": "1728x2304", "3:2": "2496x1664", "2:3": "1664x2496", "21:9": "3136x1344" },
});
const volcRef = { maxCount: 9, maxBytes: FOUR_MIB, mimeTypes: IMAGE_MIMES, minSide: 300, maxSide: 6000 };
const seedance = (id: string, providerModel: string, tiers: ("480p" | "720p" | "1080p")[], microsPerMillion: Record<string, number>, revision: string): ModelProfile => ({
  id, vendor: "volcengine", purpose: "video", providerModel, modes: ["frames_v1", "reference_v1"],
  outputs: seedanceOutputs(tiers), duration: { min: 4, max: 15 }, audioOutput: true, referenceImage: volcRef,
  pricing: { kind: "per_token", revision, microsPerMillion }, inflight: { personal: 3, enterprise: 8 },
});
export const PROFILES: readonly ModelProfile[] = [
  {
    id: "minimax/MiniMax-H3", vendor: "minimax", purpose: "video", providerModel: "MiniMax-H3",
    modes: ["frames_v1", "reference_v1"], outputs: {}, duration: { min: 4, max: 15 }, audioOutput: true,
    referenceImage: { maxCount: 9, maxBytes: FOUR_MIB, mimeTypes: IMAGE_MIMES, minSide: 256, maxSide: 5760 },
    pricing: { kind: "per_second", revision: "minimax-cn-2026-09-22", microsPerSecond: { "768P": 500000, "2K": 800000 }, freeImages: 5, extraImageMicros: 200000 },
    inflight: 8,
  },
  seedance("volcengine/doubao-seedance-2-0-260128", "doubao-seedance-2-0-260128", ["480p", "720p", "1080p"], { "480p": 46000000, "720p": 46000000, "1080p": 51000000 }, "ark-cn-2026-09-22"),
  seedance("volcengine/doubao-seedance-2-0-fast-260128", "doubao-seedance-2-0-fast-260128", ["480p", "720p"], { "480p": 37000000, "720p": 37000000 }, "ark-cn-2026-09-22"),
  seedance("volcengine/doubao-seedance-2-0-mini-260615", "doubao-seedance-2-0-mini-260615", ["480p", "720p"], { "480p": 23000000, "720p": 23000000 }, "ark-cn-2026-09-22"),
  {
    id: "volcengine/doubao-seedream-5-0-pro-260628", vendor: "volcengine", purpose: "image", providerModel: "doubao-seedream-5-0-pro-260628",
    modes: ["reference_v1"], outputs: seedreamPro, referenceImage: { ...volcRef, maxCount: 10, minSide: 15 },
    pricing: { kind: "per_image", revision: "ark-cn-2026-09-22", microsPerImage: { standard: 300000, large: 600000 }, largeThresholdPixels: 2610000, freeInputImages: 1, extraInputImageMicros: 20000 },
    inflight: 8,
  },
  {
    id: "volcengine/doubao-seedream-5-0-flash-260915", vendor: "volcengine", purpose: "image", providerModel: "doubao-seedream-5-0-flash-260915",
    modes: ["reference_v1"], outputs: seedreamPro, referenceImage: { ...volcRef, maxCount: 10, minSide: 15 },
    pricing: { kind: "per_image", revision: "ark-cn-2026-09-22", microsPerImage: { standard: 120000 } }, inflight: 8,
  },
  {
    id: "volcengine/doubao-seedream-5-0-260128", vendor: "volcengine", purpose: "image", providerModel: "doubao-seedream-5-0-260128",
    modes: ["reference_v1"], outputs: seedreamLite, referenceImage: { ...volcRef, maxCount: 14, minSide: 15 },
    pricing: { kind: "per_image", revision: "ark-cn-2026-09-22", microsPerImage: { standard: 220000 } }, inflight: 8,
  },
];
export function findProfile(id: string) { return PROFILES.find((p) => p.id === id); }
export function resolveOutput(profile: ModelProfile, resolution: string): OutputTarget {
  const target = profile.outputs[resolution];
  if (!target) throw new VerifiedProfileError("OUTPUT_NOT_IN_PROFILE");
  return target;
}
export function capabilityDefinition(profile: ModelProfile, mode: ProfileMode, options: { verifiedAt?: string }): CapabilityDefinition {
  if (!profile.modes.includes(mode)) throw new VerifiedProfileError("MODE_NOT_IN_PROFILE");
  const sizes = Object.keys(profile.outputs);
  if (sizes.length === 0) throw new VerifiedProfileError("OUTPUTS_UNMEASURED");
  const ref = profile.referenceImage;
  const rule = (purposes: string[], maxCount: number): Schema<"CapabilityInputRule"> => ({
    kind: "image", purposes, minCount: 0, maxCount, maxBytes: ref.maxBytes, mimeTypes: [...ref.mimeTypes],
    minWidth: ref.minSide, maxWidth: ref.maxSide, minHeight: ref.minSide, maxHeight: ref.maxSide,
  });
  const frames = mode === "frames_v1";
  return {
    purpose: profile.purpose,
    mode,
    modelVersion: profile.id,
    supportedPurposes: frames ? ["start_frame", "end_frame"] : [...REFERENCE_PURPOSES],
    inputRules: frames ? [rule(["start_frame"], 1), rule(["end_frame"], 1)] : [rule([...REFERENCE_PURPOSES], ref.maxCount)],
    allowedResolutions: sizes,
    allowedAspectRatios: [...new Set(sizes.map((s) => profile.outputs[s]!.ratio))],
    ...(profile.duration ? { minDurationSeconds: profile.duration.min, maxDurationSeconds: profile.duration.max } : {}),
    ...(profile.purpose === "video" ? { audioOutput: profile.audioOutput === true } : {}),
    maxReferences: frames ? 2 : ref.maxCount,
    cancelSupported: profile.purpose === "video",
    recoverySupported: false,
    executionMode: "verified_provider",
    ...(options.verifiedAt ? { verifiedAt: options.verifiedAt } : {}),
    notes: `pricingRevision=${profile.pricing.revision}; provider=${profile.vendor}/${profile.providerModel}`,
  };
}
const money = (micros: bigint): Schema<"Money"> => ({ currency: "CNY", amountMicros: micros.toString() });
export function estimateCost(profile: ModelProfile, resolved: Schema<"ResolvedInput">): Schema<"CostEstimate"> {
  const output = resolved.output ?? {};
  const references = resolved.references?.length ?? 0;
  const lines: Schema<"EstimateLine">[] = [];
  let base = 0n;
  const p = profile.pricing;
  if (p.kind === "per_second") {
    const tier = profile.outputs[output.resolution ?? ""]?.resolution ?? output.resolution ?? "";
    const unit = p.microsPerSecond[tier];
    if (unit === undefined || !output.durationSeconds) throw new VerifiedProfileError("ESTIMATE_INPUT_INVALID");
    const seconds = BigInt(output.durationSeconds);
    base += seconds * BigInt(unit);
    lines.push({ metric: `output_seconds@${tier}`, quantity: seconds.toString(), unit: "second", estimatedCost: money(seconds * BigInt(unit)) });
    const extra = Math.max(references - p.freeImages, 0);
    if (extra) { base += BigInt(extra * p.extraImageMicros); lines.push({ metric: "extra_reference_images", quantity: String(extra), unit: "image", estimatedCost: money(BigInt(extra * p.extraImageMicros)) }); }
  } else if (p.kind === "per_token") {
    const target = resolveOutput(profile, output.resolution ?? "");
    const [w, h] = (output.resolution ?? "").split("x").map(Number);
    if (!w || !h || !output.durationSeconds) throw new VerifiedProfileError("ESTIMATE_INPUT_INVALID");
    const tokens = Math.floor((output.durationSeconds * w * h * 24) / 1024);
    const unit = p.microsPerMillion[target.resolution];
    if (unit === undefined) throw new VerifiedProfileError("ESTIMATE_INPUT_INVALID");
    const amount = (BigInt(tokens) * BigInt(unit)) / 1000000n;
    base += amount;
    lines.push({ metric: `video_tokens@${target.resolution}`, quantity: String(tokens), unit: "token", estimatedCost: money(amount) });
  } else {
    const [w, h] = (output.resolution ?? "").split("x").map(Number);
    if (!w || !h) throw new VerifiedProfileError("ESTIMATE_INPUT_INVALID");
    resolveOutput(profile, output.resolution!);
    const large = p.largeThresholdPixels !== undefined && p.microsPerImage.large !== undefined && w * h > p.largeThresholdPixels;
    const unit = large ? p.microsPerImage.large! : p.microsPerImage.standard;
    base += BigInt(unit);
    lines.push({ metric: large ? "image@large" : "image@standard", quantity: "1", unit: "image", estimatedCost: money(BigInt(unit)) });
    const extra = Math.max(references - (p.freeInputImages ?? Infinity), 0);
    if (extra && p.extraInputImageMicros) { base += BigInt(extra * p.extraInputImageMicros); lines.push({ metric: "extra_input_images", quantity: String(extra), unit: "image", estimatedCost: money(BigInt(extra * p.extraInputImageMicros)) }); }
  }
  const hold = base / 5n;
  return { pricingRevision: p.revision, lines, baseCost: money(base), holdMargin: money(hold), totalReservation: money(base + hold),
    basisNote: `${profile.id}；按官方刊例价估算，预留 20% 余量；实际以供应商 usage 为准。` };
}
```

在 `packages/provider/src/index.ts` 末尾追加：

```ts
export * from "./verified/profiles.js";
```

- [ ] **Step 4: 运行通过**

Run: `node --import tsx --test tests/verified-profiles.test.ts`
Expected: 7 个用例 PASS。若 `validateContract` 报 `notes`／`verifiedAt` 之外的字段不合法，按契约调整字段名，不要改契约。

- [ ] **Step 5: 提交**

```bash
git add packages/provider/src/verified/profiles.ts packages/provider/src/index.ts tests/verified-profiles.test.ts
git commit -m "feat(provider): add verified model profiles with capability and cost derivation" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 有界、不重试的 HTTP 请求

**Files:**
- Create: `packages/provider/src/verified/http.ts`
- Test: `tests/verified-http.test.ts`

**Interfaces:**
- Produces:
  - `type HttpOutcome = { kind: "ok"; status: number; body: unknown } | { kind: "rejected"; status: number; body: unknown } | { kind: "unavailable"; status?: number; reason: "timeout" | "network" | "non_json" | "too_large" | "http_5xx" | "http_429" }`
  - `jsonRequest(fetchImpl: typeof fetch, url: string, init: { method: "GET" | "POST" | "DELETE"; headers: Record<string, string>; body?: unknown; signal: AbortSignal; maxBodyBytes: number }): Promise<HttpOutcome>`
  - `errorCode(body: unknown, fallback: string): string`（取 `body.error.type`、`body.error.code`、`body.code`、`body.base_resp.status_code` 之一，转成 `[A-Za-z0-9_.-]{1,80}`）

- [ ] **Step 1: 写失败测试**

```ts
// tests/verified-http.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { jsonRequest, errorCode } from "@drama/provider";

async function serve(handler: Parameters<typeof createServer>[1]) {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}
const init = (signal = AbortSignal.timeout(2000)) => ({ method: "POST" as const, headers: { authorization: "Bearer x" }, body: { a: 1 }, signal, maxBodyBytes: 1024 });

test("2xx JSON is ok, 4xx is rejected, 429 and 5xx are unavailable", async (t) => {
  const s = await serve((req, res) => {
    const status = Number(new URL(req.url!, "http://x").searchParams.get("s"));
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ status }));
  });
  t.after(s.close);
  assert.equal((await jsonRequest(fetch, `${s.origin}/?s=200`, init())).kind, "ok");
  assert.equal((await jsonRequest(fetch, `${s.origin}/?s=422`, init())).kind, "rejected");
  const r429 = await jsonRequest(fetch, `${s.origin}/?s=429`, init());
  assert.deepEqual([r429.kind, (r429 as any).reason], ["unavailable", "http_429"]);
  const r503 = await jsonRequest(fetch, `${s.origin}/?s=503`, init());
  assert.deepEqual([r503.kind, (r503 as any).reason], ["unavailable", "http_5xx"]);
});
test("oversized, non-JSON and timed-out responses are unavailable and never throw", async (t) => {
  const s = await serve((req, res) => {
    const mode = new URL(req.url!, "http://x").searchParams.get("m");
    if (mode === "big") res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ pad: "x".repeat(5000) }));
    else if (mode === "html") res.writeHead(200, { "content-type": "text/html" }).end("<html>");
    else setTimeout(() => res.writeHead(200).end("{}"), 1500);
  });
  t.after(s.close);
  assert.equal(((await jsonRequest(fetch, `${s.origin}/?m=big`, init())) as any).reason, "too_large");
  assert.equal(((await jsonRequest(fetch, `${s.origin}/?m=html`, init())) as any).reason, "non_json");
  assert.equal(((await jsonRequest(fetch, `${s.origin}/?m=slow`, init(AbortSignal.timeout(200)))) as any).reason, "timeout");
});
test("connection refused is a network unavailable outcome", async () => {
  const r = await jsonRequest(fetch, "http://127.0.0.1:9/", init());
  assert.deepEqual([r.kind, (r as any).reason], ["unavailable", "network"]);
});
test("errorCode extracts vendor codes and sanitizes", () => {
  assert.equal(errorCode({ error: { type: "insufficient_balance_error" } }, "X"), "insufficient_balance_error");
  assert.equal(errorCode({ code: "ModelNotOpen" }, "X"), "ModelNotOpen");
  assert.equal(errorCode({ base_resp: { status_code: 1026 } }, "X"), "1026");
  assert.equal(errorCode({ error: { code: "bad code!! <script>" } }, "X"), "badcodescript");
  assert.equal(errorCode("nope", "FALLBACK"), "FALLBACK");
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --import tsx --test tests/verified-http.test.ts`
Expected: FAIL，缺少导出。

- [ ] **Step 3: 实现**

```ts
// packages/provider/src/verified/http.ts
export type HttpOutcome =
  | { kind: "ok"; status: number; body: unknown }
  | { kind: "rejected"; status: number; body: unknown }
  | { kind: "unavailable"; status?: number; reason: "timeout" | "network" | "non_json" | "too_large" | "http_5xx" | "http_429" };

/** One bounded attempt. Never retries, never throws for transport problems. */
export async function jsonRequest(
  fetchImpl: typeof fetch,
  url: string,
  init: { method: "GET" | "POST" | "DELETE"; headers: Record<string, string>; body?: unknown; signal: AbortSignal; maxBodyBytes: number },
): Promise<HttpOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: init.method,
      headers: { accept: "application/json", ...init.headers, ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: init.signal,
      redirect: "error",
    });
  } catch (error) {
    return { kind: "unavailable", reason: init.signal.aborted || (error as Error)?.name === "TimeoutError" || (error as Error)?.name === "AbortError" ? "timeout" : "network" };
  }
  const status = response.status;
  if (status === 429) { await response.body?.cancel(); return { kind: "unavailable", status, reason: "http_429" }; }
  if (status >= 500) { await response.body?.cancel(); return { kind: "unavailable", status, reason: "http_5xx" }; }
  let text: string;
  try {
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (reader)
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > init.maxBodyBytes) { await reader.cancel(); return { kind: "unavailable", status, reason: "too_large" }; }
        chunks.push(chunk.value);
      }
    text = Buffer.concat(chunks).toString("utf8");
  } catch {
    return { kind: "unavailable", status, reason: init.signal.aborted ? "timeout" : "network" };
  }
  let body: unknown;
  try { body = text === "" ? {} : JSON.parse(text); } catch { return { kind: "unavailable", status, reason: "non_json" }; }
  if (status >= 200 && status < 300) return { kind: "ok", status, body };
  return { kind: "rejected", status, body };
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export function errorCode(body: unknown, fallback: string): string {
  const candidates: unknown[] = [];
  if (object(body)) {
    if (object(body.error)) candidates.push(body.error.type, body.error.code);
    candidates.push(body.code);
    if (object(body.base_resp)) candidates.push(body.base_resp.status_code);
  }
  for (const c of candidates) {
    if (typeof c === "number" && Number.isSafeInteger(c)) return String(c);
    if (typeof c === "string") { const clean = c.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80); if (clean) return clean; }
  }
  return fallback;
}
```

在 `packages/provider/src/index.ts` 追加 `export * from "./verified/http.js";`。

- [ ] **Step 4: 运行通过**

Run: `node --import tsx --test tests/verified-http.test.ts`
Expected: 4 个用例 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/provider/src/verified/http.ts packages/provider/src/index.ts tests/verified-http.test.ts
git commit -m "feat(provider): add bounded non-retrying JSON request helper" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 输入映射与素材内联

**Files:**
- Create: `packages/provider/src/verified/inputs.ts`
- Test: `tests/verified-inputs.test.ts`

**Interfaces:**
- Produces:
  - `type ResolvedMedia = { id: string; kind: string; mime: string; bytes: number; sha256: string; width?: number; height?: number; object: { key: string; versionId: string } }`
  - `type MediaResolver = (jobId: string) => Promise<ResolvedMedia[]>`
  - `type ReferenceRole = "first_frame" | "last_frame" | "reference_image"`
  - `type MappedReference = { mediaId: string; purpose: string; role: ReferenceRole; index: number }`
  - `referenceRoles(mode: ProfileMode, references: { reference: { mediaId: string; purpose: string } }[]): MappedReference[]`（frames 模式重复的 start/end 或非法 purpose 抛 `VerifiedInputError("REFERENCE_ROLE_INVALID")`）
  - `dataUri(mime: string, bytes: Uint8Array): string`
  - `referenceLegend(mapped: MappedReference[]): string`（空数组返回 `""`）
  - `type ByteStore = { download(source: { key: string; versionId: string; bytes: number }, file: string, expectedSha256: string, signal?: AbortSignal): Promise<unknown> }`
  - `loadMediaBytes(store: ByteStore, tmpdir: string, media: ResolvedMedia, signal: AbortSignal): Promise<Buffer>`
  - `class VerifiedInputError extends Error { code: string }`

- [ ] **Step 1: 写失败测试**

```ts
// tests/verified-inputs.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { referenceRoles, dataUri, referenceLegend, loadMediaBytes, VerifiedInputError } from "@drama/provider";

const ref = (mediaId: string, purpose: string) => ({ reference: { mediaId, purpose } });
test("frames_v1 maps start/end frames and rejects duplicates and other purposes", () => {
  assert.deepEqual(referenceRoles("frames_v1", [ref("a", "end_frame"), ref("b", "start_frame")]).map((r) => [r.mediaId, r.role, r.index]),
    [["b", "first_frame", 1], ["a", "last_frame", 2]]);
  assert.throws(() => referenceRoles("frames_v1", [ref("a", "start_frame"), ref("b", "start_frame")]), (e: VerifiedInputError) => e.code === "REFERENCE_ROLE_INVALID");
  assert.throws(() => referenceRoles("frames_v1", [ref("a", "identity")]), (e: VerifiedInputError) => e.code === "REFERENCE_ROLE_INVALID");
});
test("reference_v1 keeps order, numbers from 1 and rejects frame purposes", () => {
  const mapped = referenceRoles("reference_v1", [ref("a", "identity"), ref("b", "style")]);
  assert.deepEqual(mapped.map((r) => [r.role, r.index]), [["reference_image", 1], ["reference_image", 2]]);
  assert.throws(() => referenceRoles("reference_v1", [ref("a", "start_frame")]), (e: VerifiedInputError) => e.code === "REFERENCE_ROLE_INVALID");
});
test("legend names each image by index and purpose in Chinese", () => {
  const mapped = referenceRoles("reference_v1", [ref("a", "identity"), ref("b", "location")]);
  assert.equal(referenceLegend(mapped), "参考素材：图片1为角色形象参考；图片2为场景地点参考。");
  assert.equal(referenceLegend([]), "");
});
test("dataUri encodes with lowercase mime", () => {
  assert.equal(dataUri("image/PNG", Buffer.from("hi")), "data:image/png;base64,aGk=");
});
test("loadMediaBytes downloads through the store into a private temp file and returns bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "verified-inputs-"));
  const payload = Buffer.from("fake-image");
  const sha256 = createHash("sha256").update(payload).digest("hex");
  const store = { async download(_s: unknown, file: string) { await writeFile(file, payload); } };
  const bytes = await loadMediaBytes(store, dir, { id: "m", kind: "image", mime: "image/png", bytes: payload.length, sha256, object: { key: "originals/x", versionId: "v" } }, AbortSignal.timeout(1000));
  assert.deepEqual(bytes, payload);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --import tsx --test tests/verified-inputs.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// packages/provider/src/verified/inputs.ts
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ProfileMode } from "./profiles.js";

export type ResolvedMedia = { id: string; kind: string; mime: string; bytes: number; sha256: string; width?: number; height?: number; object: { key: string; versionId: string } };
export type MediaResolver = (jobId: string) => Promise<ResolvedMedia[]>;
export type ReferenceRole = "first_frame" | "last_frame" | "reference_image";
export type MappedReference = { mediaId: string; purpose: string; role: ReferenceRole; index: number };
export type ByteStore = { download(source: { key: string; versionId: string; bytes: number }, file: string, expectedSha256: string, signal?: AbortSignal): Promise<unknown> };
export class VerifiedInputError extends Error {
  constructor(readonly code: string, message = code) { super(message); this.name = "VerifiedInputError"; }
}
const PURPOSE_LABEL: Record<string, string> = {
  identity: "角色形象参考", look: "造型参考", style: "风格参考", location: "场景地点参考", prop: "道具参考", composition: "构图参考",
};
export function referenceRoles(mode: ProfileMode, references: { reference: { mediaId: string; purpose: string } }[]): MappedReference[] {
  if (mode === "frames_v1") {
    const first = references.filter((r) => r.reference.purpose === "start_frame");
    const last = references.filter((r) => r.reference.purpose === "end_frame");
    if (first.length > 1 || last.length > 1 || first.length + last.length !== references.length) throw new VerifiedInputError("REFERENCE_ROLE_INVALID");
    const mapped: MappedReference[] = [];
    if (first[0]) mapped.push({ mediaId: first[0].reference.mediaId, purpose: "start_frame", role: "first_frame", index: 1 });
    if (last[0]) mapped.push({ mediaId: last[0].reference.mediaId, purpose: "end_frame", role: "last_frame", index: mapped.length + 1 });
    return mapped;
  }
  return references.map((r, i) => {
    if (!(r.reference.purpose in PURPOSE_LABEL)) throw new VerifiedInputError("REFERENCE_ROLE_INVALID");
    return { mediaId: r.reference.mediaId, purpose: r.reference.purpose, role: "reference_image" as const, index: i + 1 };
  });
}
export function referenceLegend(mapped: MappedReference[]): string {
  const images = mapped.filter((m) => m.role === "reference_image");
  if (!images.length) return "";
  return `参考素材：${images.map((m) => `图片${m.index}为${PURPOSE_LABEL[m.purpose] ?? m.purpose}`).join("；")}。`;
}
export function dataUri(mime: string, bytes: Uint8Array): string {
  return `data:${mime.toLowerCase()};base64,${Buffer.from(bytes).toString("base64")}`;
}
export async function loadMediaBytes(store: ByteStore, tmpdir: string, media: ResolvedMedia, signal: AbortSignal): Promise<Buffer> {
  const file = join(tmpdir, `verified-input-${randomUUID()}`);
  try {
    await store.download({ key: media.object.key, versionId: media.object.versionId, bytes: media.bytes }, file, media.sha256, signal);
    return await readFile(file);
  } finally {
    await rm(file, { force: true });
  }
}
```

在 `packages/provider/src/index.ts` 追加 `export * from "./verified/inputs.js";`。

- [ ] **Step 4: 运行通过**

Run: `node --import tsx --test tests/verified-inputs.test.ts`
Expected: 5 个用例 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/provider/src/verified/inputs.ts packages/provider/src/index.ts tests/verified-inputs.test.ts
git commit -m "feat(provider): map plan references to vendor roles and inline media bytes" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 结果归档回执

**Files:**
- Create: `packages/provider/src/verified/outputs.ts`
- Test: `tests/verified-outputs.test.ts`

**Interfaces:**
- Produces:
  - `type ArchiveStore = { publish(file: string, data: { bytes: number; sha256: string; mime: string }, kind: "originals", signal?: AbortSignal): Promise<{ key: string; versionId: string; bytes: number; sha256: string }> }`
  - `type ArchivedOutput = { kind: "fixture_object"; object: { key: string; versionId: string; bytes: number }; sha256: string; mime: string }`
  - `archiveBytes(options: { store: ArchiveStore; tmpdir: string; mime: "video/mp4" | "image/png" | "image/jpeg"; bytes: Uint8Array; signal: AbortSignal }): Promise<ArchivedOutput>`
  - `downloadBytes(fetchImpl: typeof fetch, url: string, maxBytes: number, signal: AbortSignal): Promise<Buffer>`（超限或非 2xx 抛 `VerifiedOutputError("DOWNLOAD_FAILED" | "DOWNLOAD_TOO_LARGE")`）
  - `class VerifiedOutputError extends Error { code: string }`

- [ ] **Step 1: 写失败测试**

```ts
// tests/verified-outputs.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { archiveBytes, downloadBytes, VerifiedOutputError } from "@drama/provider";

test("archiveBytes publishes a private temp file and returns the store locator", async () => {
  const dir = await mkdtemp(join(tmpdir(), "verified-outputs-"));
  const payload = Buffer.from("mp4-bytes");
  let seen: { mode: number; bytes: number; sha256: string; mime: string } | undefined;
  const store = {
    async publish(file: string, data: { bytes: number; sha256: string; mime: string }) {
      seen = { mode: (await stat(file)).mode & 0o777, ...data };
      return { key: "originals/00000000-0000-4000-8000-000000000000", versionId: "v1", bytes: data.bytes, sha256: data.sha256 };
    },
  };
  const out = await archiveBytes({ store, tmpdir: dir, mime: "video/mp4", bytes: payload, signal: AbortSignal.timeout(1000) });
  assert.equal(seen!.mode, 0o600);
  assert.equal(seen!.sha256, createHash("sha256").update(payload).digest("hex"));
  assert.deepEqual(out, { kind: "fixture_object", object: { key: "originals/00000000-0000-4000-8000-000000000000", versionId: "v1", bytes: 9 }, sha256: seen!.sha256, mime: "video/mp4" });
  assert.deepEqual(await readdir(dir), []);
});
test("downloadBytes enforces the byte cap and rejects non-2xx", async (t) => {
  const server = createServer((req, res) => {
    if (req.url === "/big") res.writeHead(200).end(Buffer.alloc(2048));
    else if (req.url === "/gone") res.writeHead(404).end();
    else res.writeHead(200).end(Buffer.from("ok"));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise<void>((r) => server.close(() => r())));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  assert.deepEqual(await downloadBytes(fetch, `${origin}/ok`, 1024, AbortSignal.timeout(1000)), Buffer.from("ok"));
  await assert.rejects(downloadBytes(fetch, `${origin}/big`, 1024, AbortSignal.timeout(1000)), (e: VerifiedOutputError) => e.code === "DOWNLOAD_TOO_LARGE");
  await assert.rejects(downloadBytes(fetch, `${origin}/gone`, 1024, AbortSignal.timeout(1000)), (e: VerifiedOutputError) => e.code === "DOWNLOAD_FAILED");
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --import tsx --test tests/verified-outputs.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// packages/provider/src/verified/outputs.ts
import { createHash, randomUUID } from "node:crypto";
import { open, rm } from "node:fs/promises";
import { join } from "node:path";

export type ArchiveStore = { publish(file: string, data: { bytes: number; sha256: string; mime: string }, kind: "originals", signal?: AbortSignal): Promise<{ key: string; versionId: string; bytes: number; sha256: string }> };
export type ArchivedOutput = { kind: "fixture_object"; object: { key: string; versionId: string; bytes: number }; sha256: string; mime: string };
export class VerifiedOutputError extends Error {
  constructor(readonly code: string, message = code) { super(message); this.name = "VerifiedOutputError"; }
}
export async function archiveBytes(options: { store: ArchiveStore; tmpdir: string; mime: "video/mp4" | "image/png" | "image/jpeg"; bytes: Uint8Array; signal: AbortSignal }): Promise<ArchivedOutput> {
  const file = join(options.tmpdir, `verified-output-${randomUUID()}`);
  const sha256 = createHash("sha256").update(options.bytes).digest("hex");
  try {
    const handle = await open(file, "wx", 0o600);
    try { await handle.writeFile(options.bytes); } finally { await handle.close(); }
    const published = await options.store.publish(file, { bytes: options.bytes.byteLength, sha256, mime: options.mime }, "originals", options.signal);
    return { kind: "fixture_object", object: { key: published.key, versionId: published.versionId, bytes: published.bytes }, sha256: published.sha256, mime: options.mime };
  } finally {
    await rm(file, { force: true });
  }
}
export async function downloadBytes(fetchImpl: typeof fetch, url: string, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  const response = await fetchImpl(url, { signal, redirect: "follow" });
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new VerifiedOutputError("DOWNLOAD_FAILED"); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.length;
    if (bytes > maxBytes) { await reader.cancel(); throw new VerifiedOutputError("DOWNLOAD_TOO_LARGE"); }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks);
}
```

在 `packages/provider/src/index.ts` 追加 `export * from "./verified/outputs.js";`。

- [ ] **Step 4: 运行通过**

Run: `node --import tsx --test tests/verified-outputs.test.ts`
Expected: 2 个用例 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/provider/src/verified/outputs.ts packages/provider/src/index.ts tests/verified-outputs.test.ts
git commit -m "feat(provider): archive vendor results into the private store before any receipt" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 提交准备与 MiniMax 适配器

**Files:**
- Create: `packages/provider/src/verified/prepare.ts`
- Create: `packages/provider/src/verified/minimax/client.ts`
- Create: `packages/provider/src/verified/minimax/adapter.ts`
- Test: `tests/verified-minimax.test.ts`

**Interfaces:**
- Consumes: Task 1 `findProfile`／`resolveOutput`／`VerifiedProfileError`；Task 2 `jsonRequest`／`errorCode`；Task 3 `referenceRoles`／`loadMediaBytes`／`dataUri`／`referenceLegend`／`MediaResolver`／`ByteStore`；Task 4 `archiveBytes`／`downloadBytes`／`ArchiveStore`。
- Produces:
  - `type VerifiedDeps = { store: ArchiveStore & ByteStore; resolveMedia: MediaResolver; fetch: typeof fetch; tmpdir: string }`
  - `type PreparedSubmission = { profile: ModelProfile; mode: ProfileMode; size: string; target: { resolution: string; ratio: string }; durationSeconds?: number; withAudio: boolean; prompt: string; images: { role: ReferenceRole; index: number; dataUri: string }[] }`
  - `prepareSubmission(submission: AssistanceSubmission, vendor: Vendor, deps: VerifiedDeps, signal: AbortSignal): Promise<PreparedSubmission>`，失败抛 `VerifiedInputError`，code 之一：`PROFILE_NOT_CONFIGURED`、`VENDOR_MISMATCH`、`PURPOSE_MISMATCH`、`MODE_NOT_CONFIGURED`、`OUTPUT_NOT_IN_PROFILE`、`MEDIA_NOT_READY`、`INPUT_TOO_LARGE`、`REFERENCE_ROLE_INVALID`
  - `rejectedFrom(error: unknown, correlation: string): AssistanceSubmissionReceipt | undefined`（`VerifiedInputError`／`VerifiedProfileError` → `{kind:"rejected", code}`，其它返回 undefined 让调用方抛出）
  - `createMinimaxAdapter(options: { connectionVersionId: string; apiKey: string; baseUrl: string; deps: VerifiedDeps }): AssistanceAdapter`
  - MiniMax 客户端：`createVideoTask(body)`, `getVideoTask(taskId)`, `cancelVideoTask(taskId)`，都返回 `HttpOutcome`

- [ ] **Step 1: 写失败测试（假 MiniMax 服务）**

```ts
// tests/verified-minimax.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createMinimaxAdapter, type VerifiedDeps } from "@drama/provider";

const read = (req: IncomingMessage) => new Promise<any>((resolve) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => resolve(s ? JSON.parse(s) : undefined)); });
async function fakeMinimax() {
  const calls: { method: string; url: string; auth?: string; body?: any }[] = [];
  let mode: "ok" | "422" | "429" | "503" | "drop" = "ok";
  let status: "queued" | "running" | "succeeded" | "failed" = "queued";
  const server = createServer(async (req, res) => {
    const body = await read(req);
    calls.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body });
    const json = (code: number, value: unknown) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(value));
    if (req.url === "/result.mp4") return res.writeHead(200).end(Buffer.from("mp4-bytes"));
    if (req.method === "POST" && req.url === "/v2/video_generation") {
      if (mode === "422") return json(422, { type: "error", error: { type: "unprocessable_entity_error", message: "sensitive" }, request_id: "r" });
      if (mode === "429") return json(429, { type: "error", error: { type: "rate_limit_error" } });
      if (mode === "503") return json(503, { type: "error", error: { type: "server_error" } });
      if (mode === "drop") return req.socket.destroy();
      return json(200, { task_id: "mm-task-1" });
    }
    if (req.method === "GET" && req.url === "/v2/query/video_generation/mm-task-1")
      return json(200, { task: { id: "mm-task-1", status, ...(status === "succeeded" ? { content: { url: `${origin}/result.mp4` }, usage: { output_seconds: 5, input_seconds: 0, input_image_count: 1, total_seconds: 5 } } : {}), ...(status === "failed" ? { error: { code: 1026, message: "sensitive" } } : {}) } });
    if (req.method === "DELETE" && req.url === "/v2/video_generation/mm-task-1")
      return status === "queued" ? json(200, { task_id: "mm-task-1", action: "cancelled", status: "cancelled" }) : json(400, { error: { type: "bad_request_error", message: "not operable" } });
    json(404, {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { origin, calls, setMode: (m: typeof mode) => (mode = m), setStatus: (s: typeof status) => (status = s), close: () => new Promise<void>((r) => server.close(() => r())) };
}
async function deps(): Promise<VerifiedDeps & { published: any[] }> {
  const dir = await mkdtemp(join(tmpdir(), "verified-minimax-"));
  const png = Buffer.from("png-bytes");
  const published: any[] = [];
  return {
    published, fetch, tmpdir: dir,
    store: {
      async download(_s: unknown, file: string) { await writeFile(file, png); },
      async publish(_f: string, data: { bytes: number; sha256: string; mime: string }) { published.push(data); return { key: "originals/00000000-0000-4000-8000-000000000000", versionId: "v1", bytes: data.bytes, sha256: data.sha256 }; },
    },
    async resolveMedia() { return [{ id: "media-1", kind: "image", mime: "image/png", bytes: png.length, sha256: createHash("sha256").update(png).digest("hex"), width: 1280, height: 720, object: { key: "originals/in", versionId: "v0" } }]; },
  };
}
const submission = (overrides: Record<string, unknown> = {}) => ({
  attemptId: "attempt-1", jobId: "job-1", connectionVersionId: "cv-minimax", requestHash: "h", executionMode: "verified_provider" as const,
  input: { purpose: "video" } as any,
  resolvedInput: {
    prompt: "一个女孩推门", references: [{ reference: { mediaId: "media-1", purpose: "start_frame" }, sourceLevel: "shot" }],
    capabilitySnapshot: { modelVersion: "minimax/MiniMax-H3", mode: "frames_v1" }, output: { resolution: "1366x768", durationSeconds: 5, withAudio: true },
    ...overrides,
  } as any,
});

test("MiniMax submit sends one v2 request with bearer auth, data URI frame and returns accepted", async (t) => {
  const mm = await fakeMinimax(); t.after(mm.close);
  const d = await deps();
  const adapter = createMinimaxAdapter({ connectionVersionId: "cv-minimax", apiKey: "k", baseUrl: mm.origin, deps: d, outputsOverride: { "1366x768": { resolution: "768P", ratio: "16:9" } } });
  const receipt = await adapter.submitOnce(submission(), AbortSignal.timeout(2000));
  assert.deepEqual(receipt, { kind: "accepted", correlation: "attempt-1", providerJobId: "mm-task-1" });
  assert.equal(mm.calls.length, 1);
  const call = mm.calls[0]!;
  assert.equal(call.auth, "Bearer k");
  assert.equal(call.body.model, "MiniMax-H3");
  assert.deepEqual([call.body.resolution, call.body.duration, call.body.ratio, call.body.aigc_watermark], ["768P", 5, "16:9", false]);
  assert.equal(call.body.content[0].type, "text");
  assert.equal(call.body.content[1].role, "first_frame");
  assert.ok(call.body.content[1].image_url.url.startsWith("data:image/png;base64,"));
});
test("MiniMax submit maps 422 to rejected with vendor code, 429 to PROVIDER_RATE_LIMITED, 503 and dropped socket to unknown", async (t) => {
  const mm = await fakeMinimax(); t.after(mm.close);
  const adapter = createMinimaxAdapter({ connectionVersionId: "cv-minimax", apiKey: "k", baseUrl: mm.origin, deps: await deps(), outputsOverride: { "1366x768": { resolution: "768P", ratio: "16:9" } } });
  mm.setMode("422");
  assert.deepEqual(await adapter.submitOnce(submission(), AbortSignal.timeout(2000)), { kind: "rejected", correlation: "attempt-1", code: "MINIMAX_unprocessable_entity_error" });
  mm.setMode("429");
  assert.deepEqual(await adapter.submitOnce(submission(), AbortSignal.timeout(2000)), { kind: "rejected", correlation: "attempt-1", code: "PROVIDER_RATE_LIMITED" });
  mm.setMode("503");
  assert.deepEqual(await adapter.submitOnce(submission(), AbortSignal.timeout(2000)), { kind: "unknown", correlation: "attempt-1" });
  mm.setMode("drop");
  assert.deepEqual(await adapter.submitOnce(submission(), AbortSignal.timeout(2000)), { kind: "unknown", correlation: "attempt-1" });
  assert.equal(mm.calls.filter((c) => c.method === "POST").length, 4);
});
test("MiniMax submit rejects locally without a request when the profile or output is not configured", async (t) => {
  const mm = await fakeMinimax(); t.after(mm.close);
  const adapter = createMinimaxAdapter({ connectionVersionId: "cv-minimax", apiKey: "k", baseUrl: mm.origin, deps: await deps() });
  const receipt = await adapter.submitOnce(submission(), AbortSignal.timeout(2000));
  assert.deepEqual(receipt, { kind: "rejected", correlation: "attempt-1", code: "OUTPUT_NOT_IN_PROFILE" });
  const wrongVendor = await adapter.submitOnce(submission({ capabilitySnapshot: { modelVersion: "volcengine/doubao-seedance-2-0-260128", mode: "frames_v1" } }), AbortSignal.timeout(2000));
  assert.equal((wrongVendor as any).code, "VENDOR_MISMATCH");
  assert.equal(mm.calls.length, 0);
});
test("MiniMax query maps statuses, downloads and archives on success, cancels only queued", async (t) => {
  const mm = await fakeMinimax(); t.after(mm.close);
  const d = await deps();
  const adapter = createMinimaxAdapter({ connectionVersionId: "cv-minimax", apiKey: "k", baseUrl: mm.origin, deps: d, outputsOverride: { "1366x768": { resolution: "768P", ratio: "16:9" } } });
  const task = { ...submission(), providerJobId: "mm-task-1" };
  assert.equal((await adapter.query!(task, AbortSignal.timeout(2000))).kind, "pending");
  mm.setStatus("running");
  assert.equal((await adapter.query!(task, AbortSignal.timeout(2000))).kind, "running");
  mm.setStatus("succeeded");
  const done = await adapter.query!(task, AbortSignal.timeout(2000));
  assert.equal(done.kind, "completed");
  assert.deepEqual((done as any).output, { videos: [{ kind: "fixture_object", object: { key: "originals/00000000-0000-4000-8000-000000000000", versionId: "v1", bytes: 9 }, sha256: createHash("sha256").update("mp4-bytes").digest("hex"), mime: "video/mp4" }] });
  assert.deepEqual((done as any).usage, { output_seconds: 5, input_seconds: 0, input_image_count: 1, total_seconds: 5 });
  assert.equal(d.published[0]!.mime, "video/mp4");
  mm.setStatus("failed");
  assert.deepEqual(await adapter.query!(task, AbortSignal.timeout(2000)), { kind: "failed", correlation: "attempt-1", providerJobId: "mm-task-1", code: "MINIMAX_1026" });
  mm.setStatus("queued");
  assert.equal((await adapter.requestCancel!(task, AbortSignal.timeout(2000))).kind, "cancelled");
  mm.setStatus("running");
  assert.equal((await adapter.requestCancel!(task, AbortSignal.timeout(2000))).kind, "cancel_unsupported");
  assert.equal(await adapter.recoverSubmission(submission(), AbortSignal.timeout(2000)), null);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --import tsx --test tests/verified-minimax.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 prepare.ts**

```ts
// packages/provider/src/verified/prepare.ts
import type { AssistanceSubmission, AssistanceSubmissionReceipt } from "../assistance.js";
import { findProfile, resolveOutput, VerifiedProfileError, type ModelProfile, type OutputTarget, type ProfileMode, type Vendor } from "./profiles.js";
import { dataUri, loadMediaBytes, referenceRoles, VerifiedInputError, type ByteStore, type MediaResolver, type ReferenceRole } from "./inputs.js";
import type { ArchiveStore } from "./outputs.js";

export type VerifiedDeps = { store: ArchiveStore & ByteStore; resolveMedia: MediaResolver; fetch: typeof fetch; tmpdir: string };
export type PreparedSubmission = {
  profile: ModelProfile; mode: ProfileMode; size: string; target: OutputTarget;
  durationSeconds?: number; withAudio: boolean; prompt: string;
  images: { role: ReferenceRole; index: number; dataUri: string }[];
};
const REQUEST_BUDGET = 60 * 1024 * 1024;
export async function prepareSubmission(submission: AssistanceSubmission, vendor: Vendor, deps: VerifiedDeps, signal: AbortSignal, outputsOverride?: Record<string, OutputTarget>): Promise<PreparedSubmission> {
  const snapshot = submission.resolvedInput.capabilitySnapshot;
  const profile = snapshot?.modelVersion ? findProfile(snapshot.modelVersion) : undefined;
  if (!profile) throw new VerifiedInputError("PROFILE_NOT_CONFIGURED");
  if (profile.vendor !== vendor) throw new VerifiedInputError("VENDOR_MISMATCH");
  if (profile.purpose !== submission.input.purpose) throw new VerifiedInputError("PURPOSE_MISMATCH");
  const mode = snapshot!.mode as ProfileMode;
  if (!profile.modes.includes(mode)) throw new VerifiedInputError("MODE_NOT_CONFIGURED");
  const output = submission.resolvedInput.output ?? {};
  const size = output.resolution ?? "";
  const target = outputsOverride?.[size] ?? resolveOutput({ ...profile, outputs: { ...profile.outputs, ...outputsOverride } }, size);
  const mapped = referenceRoles(mode, submission.resolvedInput.references);
  const media = mapped.length ? await deps.resolveMedia(submission.jobId) : [];
  const images: PreparedSubmission["images"] = [];
  let budget = 0;
  for (const item of mapped) {
    const row = media.find((m) => m.id === item.mediaId);
    if (!row || row.kind !== "image") throw new VerifiedInputError("MEDIA_NOT_READY");
    budget += Math.ceil(row.bytes * 4 / 3);
    if (budget > REQUEST_BUDGET) throw new VerifiedInputError("INPUT_TOO_LARGE");
    const bytes = await loadMediaBytes(deps.store, deps.tmpdir, row, signal);
    images.push({ role: item.role, index: item.index, dataUri: dataUri(row.mime, bytes) });
  }
  return { profile, mode, size, target, prompt: submission.resolvedInput.prompt, images,
    ...(output.durationSeconds !== undefined ? { durationSeconds: output.durationSeconds } : {}), withAudio: output.withAudio === true };
}
/** Deterministic preparation problems are rejections; anything else stays unknown. */
export function rejectedFrom(error: unknown, correlation: string): AssistanceSubmissionReceipt | undefined {
  if (error instanceof VerifiedInputError || error instanceof VerifiedProfileError) return { kind: "rejected", correlation, code: error.code };
  return undefined;
}
```

- [ ] **Step 4: 实现 MiniMax 客户端与适配器**

```ts
// packages/provider/src/verified/minimax/client.ts
import { jsonRequest, type HttpOutcome } from "../http.js";
const SMALL = 4 * 1024 * 1024;
export type MinimaxClient = ReturnType<typeof createMinimaxClient>;
export function createMinimaxClient(options: { apiKey: string; baseUrl: string; fetch: typeof fetch }) {
  const base = options.baseUrl.replace(/\/$/, "");
  const headers = { authorization: `Bearer ${options.apiKey}` };
  return {
    createVideoTask: (body: unknown, signal: AbortSignal): Promise<HttpOutcome> =>
      jsonRequest(options.fetch, `${base}/v2/video_generation`, { method: "POST", headers, body, signal, maxBodyBytes: SMALL }),
    getVideoTask: (taskId: string, signal: AbortSignal): Promise<HttpOutcome> =>
      jsonRequest(options.fetch, `${base}/v2/query/video_generation/${encodeURIComponent(taskId)}`, { method: "GET", headers, signal, maxBodyBytes: SMALL }),
    cancelVideoTask: (taskId: string, signal: AbortSignal): Promise<HttpOutcome> =>
      jsonRequest(options.fetch, `${base}/v2/video_generation/${encodeURIComponent(taskId)}`, { method: "DELETE", headers, signal, maxBodyBytes: SMALL }),
  };
}
```

```ts
// packages/provider/src/verified/minimax/adapter.ts
import type { AssistanceAdapter, AssistanceProviderTask, AssistanceQueryReceipt, AssistanceSubmissionReceipt } from "../../assistance.js";
import { errorCode } from "../http.js";
import { archiveBytes, downloadBytes } from "../outputs.js";
import { prepareSubmission, rejectedFrom, type VerifiedDeps } from "../prepare.js";
import type { OutputTarget } from "../profiles.js";
import { referenceLegend } from "../inputs.js";
import { createMinimaxClient } from "./client.js";

const VIDEO_MAX_BYTES = 128 * 1024 * 1024;
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const numbers = (v: unknown) => object(v) ? Object.fromEntries(Object.entries(v).filter(([, n]) => typeof n === "number" && Number.isFinite(n))) as Record<string, number> : undefined;

export function createMinimaxAdapter(options: { connectionVersionId: string; apiKey: string; baseUrl: string; deps: VerifiedDeps; outputsOverride?: Record<string, OutputTarget> }): AssistanceAdapter {
  const client = createMinimaxClient({ apiKey: options.apiKey, baseUrl: options.baseUrl, fetch: options.deps.fetch });
  return {
    executionMode: "verified_provider",
    connectionVersionId: options.connectionVersionId,
    async submitOnce(submission, signal): Promise<AssistanceSubmissionReceipt> {
      const correlation = submission.attemptId;
      let prepared;
      try { prepared = await prepareSubmission(submission, "minimax", options.deps, signal, options.outputsOverride); }
      catch (error) { const rejected = rejectedFrom(error, correlation); if (rejected) return rejected; throw error; }
      const legend = referenceLegend(prepared.images.map((i) => ({ mediaId: "", purpose: "", role: i.role, index: i.index })));
      const body = {
        model: prepared.profile.providerModel,
        content: [
          { type: "text", text: legend ? `${prepared.prompt}\n${legend}` : prepared.prompt },
          ...prepared.images.map((image) => ({ type: "image_url", image_url: { url: image.dataUri }, role: image.role })),
        ],
        resolution: prepared.target.resolution,
        duration: prepared.durationSeconds,
        ratio: prepared.target.ratio,
        aigc_watermark: false,
      };
      const outcome = await client.createVideoTask(body, signal);
      if (outcome.kind === "ok" && object(outcome.body) && typeof outcome.body.task_id === "string" && outcome.body.task_id)
        return { kind: "accepted", correlation, providerJobId: outcome.body.task_id };
      if (outcome.kind === "rejected") return { kind: "rejected", correlation, code: `MINIMAX_${errorCode(outcome.body, `HTTP_${outcome.status}`)}` };
      if (outcome.kind === "unavailable" && outcome.reason === "http_429") return { kind: "rejected", correlation, code: "PROVIDER_RATE_LIMITED" };
      return { kind: "unknown", correlation };
    },
    async recoverSubmission() { return null; },
    async query(task: AssistanceProviderTask, signal): Promise<AssistanceQueryReceipt> {
      const correlation = task.attemptId, providerJobId = task.providerJobId;
      const unavailable = (code: string): AssistanceQueryReceipt => ({ kind: "unavailable", correlation, providerJobId, code });
      const outcome = await client.getVideoTask(providerJobId, signal);
      if (outcome.kind !== "ok" || !object(outcome.body)) return unavailable(outcome.kind === "rejected" ? `MINIMAX_${errorCode(outcome.body, `HTTP_${outcome.status}`)}` : `MINIMAX_${outcome.reason.toUpperCase()}`);
      const view = object(outcome.body.task) ? outcome.body.task : outcome.body;
      switch (view.status) {
        case "queued": return { kind: "pending", correlation, providerJobId };
        case "running": return { kind: "running", correlation, providerJobId };
        case "cancelled": return { kind: "cancelled", correlation, providerJobId };
        case "failed": return { kind: "failed", correlation, providerJobId, code: `MINIMAX_${errorCode({ error: view.error }, "TASK_FAILED")}` };
        case "succeeded": {
          const url = object(view.content) && typeof view.content.url === "string" ? view.content.url : undefined;
          if (!url) return unavailable("MINIMAX_RESULT_URL_MISSING");
          try {
            const bytes = await downloadBytes(options.deps.fetch, url, VIDEO_MAX_BYTES, signal);
            const archived = await archiveBytes({ store: options.deps.store, tmpdir: options.deps.tmpdir, mime: "video/mp4", bytes, signal });
            const usage = numbers(view.usage);
            return { kind: "completed", correlation, providerJobId, output: { videos: [archived] }, ...(usage ? { usage } : {}) };
          } catch (error) {
            return unavailable(`ARCHIVE_${(error as { code?: string }).code ?? "FAILED"}`);
          }
        }
        default: return unavailable("MINIMAX_STATUS_UNKNOWN");
      }
    },
    async requestCancel(task, signal) {
      const correlation = task.attemptId, providerJobId = task.providerJobId;
      const outcome = await client.cancelVideoTask(providerJobId, signal);
      if (outcome.kind === "ok" && object(outcome.body) && outcome.body.action === "cancelled") return { kind: "cancelled", correlation, providerJobId };
      if (outcome.kind === "rejected" && outcome.status === 400) return { kind: "cancel_unsupported", correlation, providerJobId };
      return { kind: "cancel_unknown", correlation, providerJobId };
    },
  };
}
```

在 `packages/provider/src/index.ts` 追加：

```ts
export * from "./verified/prepare.js";
export { createMinimaxAdapter } from "./verified/minimax/adapter.js";
export { createMinimaxClient } from "./verified/minimax/client.js";
```

- [ ] **Step 5: 运行通过**

Run: `node --import tsx --test tests/verified-minimax.test.ts`
Expected: 4 个用例 PASS。注意 `outputsOverride` 只是测试与冒烟用的临时像素表入口，MV-01 实测后把真实值写进档案并可删除该参数。

- [ ] **Step 6: 提交**

```bash
git add packages/provider/src/verified/prepare.ts packages/provider/src/verified/minimax packages/provider/src/index.ts tests/verified-minimax.test.ts
git commit -m "feat(provider): MiniMax H3 video adapter over the fixed-plan boundary" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 火山方舟适配器（Seedance 视频 + Seedream 图片）

**Files:**
- Create: `packages/provider/src/verified/volcengine/client.ts`
- Create: `packages/provider/src/verified/volcengine/adapter.ts`
- Test: `tests/verified-volcengine.test.ts`

**Interfaces:**
- Consumes: Task 5 `prepareSubmission`／`rejectedFrom`／`VerifiedDeps`；Task 2、3、4 同上。
- Produces:
  - `createVolcengineAdapter(options: { connectionVersionId: string; apiKey: string; baseUrl: string; deps: VerifiedDeps }): AssistanceAdapter`
  - 客户端：`createContentTask(body)`, `getContentTask(id)`, `deleteContentTask(id)`, `generateImages(body)`（图片响应上限 64 MiB）

- [ ] **Step 1: 写失败测试（假方舟服务）**

```ts
// tests/verified-volcengine.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createVolcengineAdapter, type VerifiedDeps } from "@drama/provider";

const read = (req: IncomingMessage) => new Promise<any>((resolve) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => resolve(s ? JSON.parse(s) : undefined)); });
async function fakeArk() {
  const calls: { method: string; url: string; body?: any }[] = [];
  let status: "queued" | "running" | "succeeded" | "failed" | "expired" = "queued";
  let imageMode: "ok" | "sensitive" | "500" = "ok";
  const server = createServer(async (req, res) => {
    const body = await read(req);
    calls.push({ method: req.method!, url: req.url!, body });
    const json = (code: number, value: unknown) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(value));
    if (req.url === "/result.mp4") return res.writeHead(200).end(Buffer.from("ark-mp4"));
    if (req.method === "POST" && req.url === "/api/v3/contents/generations/tasks") return json(200, { id: "cgt-1" });
    if (req.method === "GET" && req.url === "/api/v3/contents/generations/tasks/cgt-1")
      return json(200, { id: "cgt-1", model: "doubao-seedance-2-0-mini-260615", status, ...(status === "succeeded" ? { content: { video_url: `${origin}/result.mp4` }, usage: { completion_tokens: 108000, total_tokens: 108000 }, duration: 5 } : {}), ...(status === "failed" ? { error: { code: "OutputVideoSensitiveContentDetected", message: "x" } } : {}) });
    if (req.method === "DELETE" && req.url === "/api/v3/contents/generations/tasks/cgt-1") return status === "queued" ? json(200, {}) : json(400, { code: "InvalidParameter", message: "only queued" });
    if (req.method === "POST" && req.url === "/api/v3/images/generations") {
      if (imageMode === "sensitive") return json(400, { error: { code: "InputImageSensitiveContentDetected", message: "x" } });
      if (imageMode === "500") return json(500, { error: { code: "InternalServiceError" } });
      return json(200, { model: "doubao-seedream-5-0-flash-260915", created: 1, data: [{ b64_json: Buffer.from("jpeg-bytes").toString("base64"), size: "2048x2048", output_format: "jpeg" }], usage: { generated_images: 1, output_tokens: 16384, total_tokens: 16384 } });
    }
    json(404, { code: "NotFound" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { origin, calls, setStatus: (s: typeof status) => (status = s), setImageMode: (m: typeof imageMode) => (imageMode = m), close: () => new Promise<void>((r) => server.close(() => r())) };
}
async function deps(): Promise<VerifiedDeps & { published: any[] }> {
  const dir = await mkdtemp(join(tmpdir(), "verified-ark-"));
  const png = Buffer.from("png-bytes");
  const published: any[] = [];
  return {
    published, fetch, tmpdir: dir,
    store: {
      async download(_s: unknown, file: string) { await writeFile(file, png); },
      async publish(_f: string, data: { bytes: number; sha256: string; mime: string }) { published.push(data); return { key: "originals/00000000-0000-4000-8000-000000000000", versionId: "v1", bytes: data.bytes, sha256: data.sha256 }; },
    },
    async resolveMedia() { return [{ id: "media-1", kind: "image", mime: "image/png", bytes: png.length, sha256: createHash("sha256").update(png).digest("hex"), width: 1024, height: 1024, object: { key: "originals/in", versionId: "v0" } }]; },
  };
}
const videoSubmission = () => ({
  attemptId: "attempt-1", jobId: "job-1", connectionVersionId: "cv-ark", requestHash: "h", executionMode: "verified_provider" as const,
  input: { purpose: "video" } as any,
  resolvedInput: { prompt: "她推门进来", references: [{ reference: { mediaId: "media-1", purpose: "identity" }, sourceLevel: "shot" }],
    capabilitySnapshot: { modelVersion: "volcengine/doubao-seedance-2-0-mini-260615", mode: "reference_v1" }, output: { resolution: "720x1280", durationSeconds: 5, withAudio: true } } as any,
});
const imageSubmission = () => ({
  attemptId: "attempt-2", jobId: "job-2", connectionVersionId: "cv-ark", requestHash: "h", executionMode: "verified_provider" as const,
  input: { purpose: "image" } as any,
  resolvedInput: { prompt: "海报", references: [], capabilitySnapshot: { modelVersion: "volcengine/doubao-seedream-5-0-flash-260915", mode: "reference_v1" }, output: { resolution: "2048x2048" } } as any,
});

test("Seedance submit: reference image, legend appended, mono audio on, watermark off, 6h expiry", async (t) => {
  const ark = await fakeArk(); t.after(ark.close);
  const adapter = createVolcengineAdapter({ connectionVersionId: "cv-ark", apiKey: "k", baseUrl: `${ark.origin}/api/v3`, deps: await deps() });
  assert.deepEqual(await adapter.submitOnce(videoSubmission(), AbortSignal.timeout(2000)), { kind: "accepted", correlation: "attempt-1", providerJobId: "cgt-1" });
  const body = ark.calls[0]!.body;
  assert.deepEqual([body.model, body.resolution, body.ratio, body.duration, body.generate_audio, body.watermark, body.execution_expires_after],
    ["doubao-seedance-2-0-mini-260615", "720p", "9:16", 5, true, false, 21600]);
  assert.equal(body.content[0].text, "她推门进来\n参考素材：图片1为角色形象参考。");
  assert.equal(body.content[1].role, "reference_image");
});
test("Seedance query: expired is failed, succeeded archives the download with token usage", async (t) => {
  const ark = await fakeArk(); t.after(ark.close);
  const d = await deps();
  const adapter = createVolcengineAdapter({ connectionVersionId: "cv-ark", apiKey: "k", baseUrl: `${ark.origin}/api/v3`, deps: d });
  const task = { ...videoSubmission(), providerJobId: "cgt-1" };
  ark.setStatus("expired");
  assert.deepEqual(await adapter.query!(task, AbortSignal.timeout(2000)), { kind: "failed", correlation: "attempt-1", providerJobId: "cgt-1", code: "ARK_EXPIRED" });
  ark.setStatus("failed");
  assert.equal((await adapter.query!(task, AbortSignal.timeout(2000)) as any).code, "ARK_OutputVideoSensitiveContentDetected");
  ark.setStatus("succeeded");
  const done = await adapter.query!(task, AbortSignal.timeout(2000));
  assert.equal(done.kind, "completed");
  assert.deepEqual((done as any).usage, { completion_tokens: 108000, total_tokens: 108000 });
  assert.equal(d.published[0]!.mime, "video/mp4");
  ark.setStatus("queued");
  assert.equal((await adapter.requestCancel!(task, AbortSignal.timeout(2000))).kind, "cancelled");
});
test("Seedream submit: synchronous b64 result is archived and completed; vendor 400 rejected; 500 unknown", async (t) => {
  const ark = await fakeArk(); t.after(ark.close);
  const d = await deps();
  const adapter = createVolcengineAdapter({ connectionVersionId: "cv-ark", apiKey: "k", baseUrl: `${ark.origin}/api/v3`, deps: d });
  const receipt = await adapter.submitOnce(imageSubmission(), AbortSignal.timeout(2000));
  assert.equal(receipt.kind, "completed");
  assert.deepEqual((receipt as any).output.images[0].mime, "image/jpeg");
  assert.deepEqual((receipt as any).usage, { generated_images: 1, output_tokens: 16384, total_tokens: 16384 });
  const body = ark.calls[0]!.body;
  assert.deepEqual([body.model, body.size, body.response_format, body.watermark, body.sequential_image_generation, body.prompt], ["doubao-seedream-5-0-flash-260915", "2048x2048", "b64_json", false, "disabled", "海报"]);
  ark.setImageMode("sensitive");
  assert.deepEqual(await adapter.submitOnce(imageSubmission(), AbortSignal.timeout(2000)), { kind: "rejected", correlation: "attempt-2", code: "ARK_InputImageSensitiveContentDetected" });
  ark.setImageMode("500");
  assert.deepEqual(await adapter.submitOnce(imageSubmission(), AbortSignal.timeout(2000)), { kind: "unknown", correlation: "attempt-2" });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --import tsx --test tests/verified-volcengine.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现客户端与适配器**

```ts
// packages/provider/src/verified/volcengine/client.ts
import { jsonRequest, type HttpOutcome } from "../http.js";
const SMALL = 4 * 1024 * 1024, IMAGE = 64 * 1024 * 1024;
export function createVolcengineClient(options: { apiKey: string; baseUrl: string; fetch: typeof fetch }) {
  const base = options.baseUrl.replace(/\/$/, "");
  const headers = { authorization: `Bearer ${options.apiKey}` };
  return {
    createContentTask: (body: unknown, signal: AbortSignal): Promise<HttpOutcome> =>
      jsonRequest(options.fetch, `${base}/contents/generations/tasks`, { method: "POST", headers, body, signal, maxBodyBytes: SMALL }),
    getContentTask: (id: string, signal: AbortSignal): Promise<HttpOutcome> =>
      jsonRequest(options.fetch, `${base}/contents/generations/tasks/${encodeURIComponent(id)}`, { method: "GET", headers, signal, maxBodyBytes: SMALL }),
    deleteContentTask: (id: string, signal: AbortSignal): Promise<HttpOutcome> =>
      jsonRequest(options.fetch, `${base}/contents/generations/tasks/${encodeURIComponent(id)}`, { method: "DELETE", headers, signal, maxBodyBytes: SMALL }),
    generateImages: (body: unknown, signal: AbortSignal): Promise<HttpOutcome> =>
      jsonRequest(options.fetch, `${base}/images/generations`, { method: "POST", headers, body, signal, maxBodyBytes: IMAGE }),
  };
}
```

```ts
// packages/provider/src/verified/volcengine/adapter.ts
import type { AssistanceAdapter, AssistanceProviderTask, AssistanceQueryReceipt, AssistanceSubmissionReceipt } from "../../assistance.js";
import { errorCode } from "../http.js";
import { referenceLegend } from "../inputs.js";
import { archiveBytes, downloadBytes } from "../outputs.js";
import { prepareSubmission, rejectedFrom, type PreparedSubmission, type VerifiedDeps } from "../prepare.js";
import { createVolcengineClient } from "./client.js";

const VIDEO_MAX_BYTES = 128 * 1024 * 1024;
const EXPIRES_AFTER_SECONDS = 6 * 60 * 60;
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const numbers = (v: unknown) => object(v) ? Object.fromEntries(Object.entries(v).filter(([, n]) => typeof n === "number" && Number.isFinite(n))) as Record<string, number> : undefined;
const withLegend = (prepared: PreparedSubmission) => {
  const legend = referenceLegend(prepared.images.map((i) => ({ mediaId: "", purpose: "", role: i.role, index: i.index })));
  return legend ? `${prepared.prompt}\n${legend}` : prepared.prompt;
};

export function createVolcengineAdapter(options: { connectionVersionId: string; apiKey: string; baseUrl: string; deps: VerifiedDeps }): AssistanceAdapter {
  const client = createVolcengineClient({ apiKey: options.apiKey, baseUrl: options.baseUrl, fetch: options.deps.fetch });
  const rejectedCode = (outcome: { status: number; body: unknown }) => `ARK_${errorCode(outcome.body, `HTTP_${outcome.status}`)}`;
  async function submitVideo(prepared: PreparedSubmission, correlation: string, signal: AbortSignal): Promise<AssistanceSubmissionReceipt> {
    const body = {
      model: prepared.profile.providerModel,
      content: [
        { type: "text", text: withLegend(prepared) },
        ...prepared.images.map((image) => ({ type: "image_url", image_url: { url: image.dataUri }, role: image.role })),
      ],
      resolution: prepared.target.resolution,
      ratio: prepared.target.ratio,
      duration: prepared.durationSeconds,
      generate_audio: prepared.withAudio,
      watermark: false,
      execution_expires_after: EXPIRES_AFTER_SECONDS,
    };
    const outcome = await client.createContentTask(body, signal);
    if (outcome.kind === "ok" && object(outcome.body) && typeof outcome.body.id === "string" && outcome.body.id) return { kind: "accepted", correlation, providerJobId: outcome.body.id };
    if (outcome.kind === "rejected") return { kind: "rejected", correlation, code: rejectedCode(outcome) };
    if (outcome.kind === "unavailable" && outcome.reason === "http_429") return { kind: "rejected", correlation, code: "PROVIDER_RATE_LIMITED" };
    return { kind: "unknown", correlation };
  }
  async function submitImage(prepared: PreparedSubmission, correlation: string, signal: AbortSignal): Promise<AssistanceSubmissionReceipt> {
    const body = {
      model: prepared.profile.providerModel,
      prompt: withLegend(prepared),
      ...(prepared.images.length ? { image: prepared.images.map((i) => i.dataUri) } : {}),
      size: prepared.size,
      response_format: "b64_json",
      output_format: "jpeg",
      watermark: false,
      sequential_image_generation: "disabled",
    };
    const outcome = await client.generateImages(body, signal);
    if (outcome.kind === "rejected") return { kind: "rejected", correlation, code: rejectedCode(outcome) };
    if (outcome.kind === "unavailable") return outcome.reason === "http_429" ? { kind: "rejected", correlation, code: "PROVIDER_RATE_LIMITED" } : { kind: "unknown", correlation };
    const first = object(outcome.body) && Array.isArray(outcome.body.data) ? outcome.body.data[0] : undefined;
    if (object(outcome.body) && object(outcome.body.error) && !first) return { kind: "rejected", correlation, code: rejectedCode({ status: 200, body: outcome.body }) };
    if (!object(first) || typeof first.b64_json !== "string") return { kind: "unknown", correlation };
    const mime = first.output_format === "png" ? "image/png" : "image/jpeg";
    const archived = await archiveBytes({ store: options.deps.store, tmpdir: options.deps.tmpdir, mime, bytes: Buffer.from(first.b64_json, "base64"), signal });
    const usage = numbers(object(outcome.body) ? outcome.body.usage : undefined);
    return { kind: "completed", correlation, output: { images: [archived] }, ...(usage ? { usage } : {}) };
  }
  return {
    executionMode: "verified_provider",
    connectionVersionId: options.connectionVersionId,
    async submitOnce(submission, signal) {
      const correlation = submission.attemptId;
      let prepared: PreparedSubmission;
      try { prepared = await prepareSubmission(submission, "volcengine", options.deps, signal); }
      catch (error) { const rejected = rejectedFrom(error, correlation); if (rejected) return rejected; throw error; }
      return prepared.profile.purpose === "image" ? submitImage(prepared, correlation, signal) : submitVideo(prepared, correlation, signal);
    },
    async recoverSubmission() { return null; },
    async query(task: AssistanceProviderTask, signal): Promise<AssistanceQueryReceipt> {
      const correlation = task.attemptId, providerJobId = task.providerJobId;
      const unavailable = (code: string): AssistanceQueryReceipt => ({ kind: "unavailable", correlation, providerJobId, code });
      const outcome = await client.getContentTask(providerJobId, signal);
      if (outcome.kind !== "ok" || !object(outcome.body)) return unavailable(outcome.kind === "rejected" ? rejectedCode(outcome) : `ARK_${outcome.reason.toUpperCase()}`);
      const view = outcome.body;
      switch (view.status) {
        case "queued": return { kind: "pending", correlation, providerJobId };
        case "running": return { kind: "running", correlation, providerJobId };
        case "cancelled": return { kind: "cancelled", correlation, providerJobId };
        case "expired": return { kind: "failed", correlation, providerJobId, code: "ARK_EXPIRED" };
        case "failed": return { kind: "failed", correlation, providerJobId, code: `ARK_${errorCode({ error: view.error }, "TASK_FAILED")}` };
        case "succeeded": {
          const url = object(view.content) && typeof view.content.video_url === "string" ? view.content.video_url : undefined;
          if (!url) return unavailable("ARK_RESULT_URL_MISSING");
          try {
            const bytes = await downloadBytes(options.deps.fetch, url, VIDEO_MAX_BYTES, signal);
            const archived = await archiveBytes({ store: options.deps.store, tmpdir: options.deps.tmpdir, mime: "video/mp4", bytes, signal });
            const usage = numbers(view.usage);
            return { kind: "completed", correlation, providerJobId, output: { videos: [archived] }, ...(usage ? { usage } : {}) };
          } catch (error) {
            return unavailable(`ARCHIVE_${(error as { code?: string }).code ?? "FAILED"}`);
          }
        }
        default: return unavailable("ARK_STATUS_UNKNOWN");
      }
    },
    async requestCancel(task, signal) {
      const correlation = task.attemptId, providerJobId = task.providerJobId;
      const outcome = await client.deleteContentTask(providerJobId, signal);
      if (outcome.kind === "ok") return { kind: "cancelled", correlation, providerJobId };
      if (outcome.kind === "rejected" && outcome.status === 400) return { kind: "cancel_unsupported", correlation, providerJobId };
      return { kind: "cancel_unknown", correlation, providerJobId };
    },
  };
}
```

在 `packages/provider/src/index.ts` 追加：

```ts
export { createVolcengineAdapter } from "./verified/volcengine/adapter.js";
export { createVolcengineClient } from "./verified/volcengine/client.js";
```

- [ ] **Step 4: 运行通过**

Run: `node --import tsx --test tests/verified-volcengine.test.ts tests/verified-minimax.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/provider/src/verified/volcengine packages/provider/src/index.ts tests/verified-volcengine.test.ts
git commit -m "feat(provider): Volcengine Ark adapter for Seedance video and Seedream image" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: 配置解析与适配器组装

**Files:**
- Create: `packages/provider/src/verified/config.ts`
- Create: `packages/provider/src/verified/index.ts`
- Modify: `packages/provider/src/index.ts`
- Test: `tests/verified-config.test.ts`

**Interfaces:**
- Produces:
  - `type VendorConfig = { apiKey: string; baseUrl: string; accountTier?: "personal" | "enterprise" }`
  - `type ConnectionConfig = { vendor: Vendor; connectionId: string; connectionVersionId: string; accountIdentityLabel: string }`
  - `type GenerationVendors = { vendors: Partial<Record<Vendor, VendorConfig>>; connections: ConnectionConfig[] }`
  - `parseGenerationVendors(raw: unknown): GenerationVendors`（错误抛 `Error` 且 `message` 为固定代码：`GENERATION_CONFIG_INVALID`、`GENERATION_VENDOR_UNKNOWN`、`GENERATION_BASE_URL_HTTPS_REQUIRED`、`GENERATION_CONNECTION_VENDOR_UNCONFIGURED`、`GENERATION_CONNECTION_DUPLICATE`；`baseUrl` 允许 `http://127.0.0.1` 便于测试）
  - `createVerifiedAdapters(config: GenerationVendors, deps: VerifiedDeps): AssistanceAdapter[]`

- [ ] **Step 1: 写失败测试**

```ts
// tests/verified-config.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGenerationVendors, createVerifiedAdapters } from "@drama/provider";

const good = {
  vendors: { minimax: { apiKey: "a", baseUrl: "https://api.minimax.cn" }, volcengine: { apiKey: "b", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", accountTier: "personal" } },
  connections: [
    { vendor: "minimax", connectionId: "11111111-1111-4111-8111-111111111111", connectionVersionId: "22222222-2222-4222-8222-222222222222", accountIdentityLabel: "mm" },
    { vendor: "volcengine", connectionId: "33333333-3333-4333-8333-333333333333", connectionVersionId: "44444444-4444-4444-8444-444444444444", accountIdentityLabel: "ark" },
  ],
};
test("valid config parses and yields one adapter per connection keyed by its version", () => {
  const parsed = parseGenerationVendors(good);
  const adapters = createVerifiedAdapters(parsed, { fetch, tmpdir: "/tmp", store: {} as any, resolveMedia: async () => [] });
  assert.deepEqual(adapters.map((a) => [a.connectionVersionId, a.executionMode]), [["22222222-2222-4222-8222-222222222222", "verified_provider"], ["44444444-4444-4444-8444-444444444444", "verified_provider"]]);
});
test("rejects unknown vendors, non-https base URLs, unconfigured or duplicate connections", () => {
  assert.throws(() => parseGenerationVendors({ ...good, vendors: { ...good.vendors, kling: { apiKey: "x", baseUrl: "https://x" } } }), /GENERATION_VENDOR_UNKNOWN/);
  assert.throws(() => parseGenerationVendors({ ...good, vendors: { ...good.vendors, minimax: { apiKey: "a", baseUrl: "http://api.minimax.cn" } } }), /GENERATION_BASE_URL_HTTPS_REQUIRED/);
  assert.throws(() => parseGenerationVendors({ vendors: { minimax: good.vendors.minimax }, connections: good.connections }), /GENERATION_CONNECTION_VENDOR_UNCONFIGURED/);
  assert.throws(() => parseGenerationVendors({ ...good, connections: [good.connections[0], good.connections[0]] }), /GENERATION_CONNECTION_DUPLICATE/);
  assert.throws(() => parseGenerationVendors({ ...good, extra: 1 }), /GENERATION_CONFIG_INVALID/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --import tsx --test tests/verified-config.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

```ts
// packages/provider/src/verified/config.ts
import type { Vendor } from "./profiles.js";
export type VendorConfig = { apiKey: string; baseUrl: string; accountTier?: "personal" | "enterprise" };
export type ConnectionConfig = { vendor: Vendor; connectionId: string; connectionVersionId: string; accountIdentityLabel: string };
export type GenerationVendors = { vendors: Partial<Record<Vendor, VendorConfig>>; connections: ConnectionConfig[] };
const VENDORS: Vendor[] = ["minimax", "volcengine"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 512 && !/[\r\n\0]/.test(v) ? v : undefined;
function invalid(code = "GENERATION_CONFIG_INVALID"): never { throw new Error(code); }
export function parseGenerationVendors(raw: unknown): GenerationVendors {
  if (!object(raw) || Object.keys(raw).some((k) => !["vendors", "connections"].includes(k))) invalid();
  if (!object(raw.vendors) || !Array.isArray(raw.connections)) invalid();
  const vendors: GenerationVendors["vendors"] = {};
  for (const [name, value] of Object.entries(raw.vendors)) {
    if (!VENDORS.includes(name as Vendor)) invalid("GENERATION_VENDOR_UNKNOWN");
    if (!object(value) || Object.keys(value).some((k) => !["apiKey", "baseUrl", "accountTier"].includes(k))) invalid();
    const apiKey = text(value.apiKey), baseUrl = text(value.baseUrl);
    if (!apiKey || !baseUrl) invalid();
    let url: URL;
    try { url = new URL(baseUrl); } catch { invalid("GENERATION_BASE_URL_HTTPS_REQUIRED"); }
    const loopback = url!.protocol === "http:" && url!.hostname === "127.0.0.1";
    if ((url!.protocol !== "https:" && !loopback) || url!.username || url!.password || url!.search || url!.hash) invalid("GENERATION_BASE_URL_HTTPS_REQUIRED");
    if (value.accountTier !== undefined && value.accountTier !== "personal" && value.accountTier !== "enterprise") invalid();
    vendors[name as Vendor] = { apiKey, baseUrl, ...(value.accountTier ? { accountTier: value.accountTier as "personal" | "enterprise" } : {}) };
  }
  const connections: ConnectionConfig[] = raw.connections.map((c) => {
    if (!object(c) || Object.keys(c).some((k) => !["vendor", "connectionId", "connectionVersionId", "accountIdentityLabel"].includes(k))) invalid();
    const vendor = c.vendor as Vendor;
    if (!VENDORS.includes(vendor)) invalid("GENERATION_VENDOR_UNKNOWN");
    if (!vendors[vendor]) invalid("GENERATION_CONNECTION_VENDOR_UNCONFIGURED");
    const connectionId = text(c.connectionId), connectionVersionId = text(c.connectionVersionId), accountIdentityLabel = text(c.accountIdentityLabel);
    if (!connectionId || !connectionVersionId || !accountIdentityLabel || !UUID.test(connectionId) || !UUID.test(connectionVersionId)) invalid();
    return { vendor, connectionId: connectionId.toLowerCase(), connectionVersionId: connectionVersionId.toLowerCase(), accountIdentityLabel };
  });
  if (new Set(connections.map((c) => c.connectionVersionId)).size !== connections.length) invalid("GENERATION_CONNECTION_DUPLICATE");
  return { vendors, connections };
}
```

```ts
// packages/provider/src/verified/index.ts
import type { AssistanceAdapter } from "../assistance.js";
import type { GenerationVendors } from "./config.js";
import { createMinimaxAdapter } from "./minimax/adapter.js";
import type { VerifiedDeps } from "./prepare.js";
import { createVolcengineAdapter } from "./volcengine/adapter.js";
export function createVerifiedAdapters(config: GenerationVendors, deps: VerifiedDeps): AssistanceAdapter[] {
  return config.connections.map((connection) => {
    const vendor = config.vendors[connection.vendor]!;
    const options = { connectionVersionId: connection.connectionVersionId, apiKey: vendor.apiKey, baseUrl: vendor.baseUrl, deps };
    return connection.vendor === "minimax" ? createMinimaxAdapter(options) : createVolcengineAdapter(options);
  });
}
```

在 `packages/provider/src/index.ts` 追加：

```ts
export * from "./verified/config.js";
export { createVerifiedAdapters } from "./verified/index.js";
```

- [ ] **Step 4: 运行通过并全量单测**

Run: `npm test`
Expected: 全部 PASS（含旧测试）。

- [ ] **Step 5: 提交**

```bash
git add packages/provider/src/verified/config.ts packages/provider/src/verified/index.ts packages/provider/src/index.ts tests/verified-config.test.ts
git commit -m "feat(provider): parse vendor connections and assemble verified adapters" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: 迁移、角色与执行器运行时

**Files:**
- Create: `packages/database/migrations/0117_verified_provider_runtime.sql`
- Modify: `packages/database/src/roles.ts:51-61`（`generationFunctions` 追加一项）
- Create: `apps/worker/src/verified-runtime.ts`
- Modify: `apps/api/src/modules/generation/worker.ts:272`、`:289`（30000 → 120000）
- Modify: `packages/media/src/generated-output.ts:57-66`（视频时长容差）
- Test: `tests/integration/verified-runtime.test.ts`、`tests/media/generated-output.test.ts`（若不存在则新建）

**Interfaces:**
- Produces:
  - SQL `read_generation_media_sources(wanted uuid) RETURNS jsonb`：返回该 job 计划里 `resolved_input.references[*].reference.mediaId` 对应、状态 `ready` 的 media 行数组 `[{id, kind, mime, bytes, sha256, width, height, object:{key, versionId}}]`；非 worker 角色抛 `42501`；job 不存在返回 `[]`。
  - `createVerifiedGenerationRuntime(options: { pool: Pool; schema: string; queueSchema?: string; config: GenerationVendors; store: MediaStore; tmpdir: string; fetch?: typeof fetch; onError?: (stage: string) => void }): Promise<{ scanOnce(): Promise<void>; start(intervalMs?: number): void; close(): Promise<void> }>`

- [ ] **Step 1: 写迁移**

```sql
-- packages/database/migrations/0117_verified_provider_runtime.sql
-- Verified providers hand back the same private-object receipt as fixtures; the
-- one-object, receipt-equality and media-processing checks are unchanged.
CREATE OR REPLACE FUNCTION finish_generation_output(wanted uuid,evidence_id uuid,output jsonb,failure text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE j generation_jobs;p generation_plans;e generation_submission_evidence;current_epoch bigint;image_source jsonb;file_name text;media_kind text;collection text;
BEGIN
 IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Worker access required' USING ERRCODE='42501';END IF;
 SELECT * INTO j FROM generation_jobs WHERE id=wanted FOR UPDATE;IF NOT FOUND THEN RETURN;END IF;
 SELECT * INTO p FROM generation_plans WHERE id=j.plan_id;
 IF p.input->>'purpose' NOT IN ('image','video','audio') THEN PERFORM finish_text_assistance_job(wanted,evidence_id,output,failure);RETURN;END IF;
 SELECT ev.* INTO e FROM generation_submission_evidence ev JOIN generation_attempts a ON a.id=ev.attempt_id WHERE ev.id=evidence_id AND a.job_id=j.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Evidence does not belong to attempt' USING ERRCODE='23514';END IF;
 IF (SELECT count(DISTINCT (body-'usage')) FROM generation_submission_evidence WHERE attempt_id=e.attempt_id AND body->>'kind' IN ('completed','rejected'))>1 OR j.status IN ('archiving','archive_failed','succeeded','failed','cancelled') THEN RETURN;END IF;
 IF e.body->>'kind'='unknown' THEN UPDATE generation_jobs SET status='submission_unknown',error_code='SUBMISSION_UNKNOWN',revision=revision+1,updated_at=now() WHERE id=j.id AND status<>'submission_unknown';RETURN;END IF;
 IF failure IS NOT NULL OR e.body->>'kind'='rejected' THEN UPDATE generation_jobs SET status='failed',error_code=coalesce(failure,'PROVIDER_REJECTED'),revision=revision+1,updated_at=now() WHERE id=j.id;DELETE FROM generation_work WHERE job_id=j.id;RETURN;END IF;
 media_kind:=p.input->>'purpose';collection:=CASE media_kind WHEN 'video' THEN 'videos' WHEN 'audio' THEN 'audios' ELSE 'images' END;
 IF output IS DISTINCT FROM e.body->'output' OR jsonb_array_length(output->collection)<>1 OR p.execution_mode NOT IN ('test_fixture','verified_provider') THEN RAISE EXCEPTION 'Image requires exact fixed original receipt' USING ERRCODE='23514';END IF;
 SELECT epoch INTO current_epoch FROM media_processing_state WHERE singleton AND worker_role IS NOT NULL AND scheduler_role IS NOT NULL;
 IF current_epoch IS NULL THEN RAISE EXCEPTION 'Media processing must be configured' USING ERRCODE='55000';END IF;
 image_source:=output->collection->0;
 file_name:=CASE image_source->>'mime' WHEN 'audio/wav' THEN 'generation.wav' WHEN 'video/mp4' THEN 'generation.mp4' WHEN 'image/png' THEN 'generation.png' WHEN 'image/jpeg' THEN 'generation.jpg' ELSE 'generation.webp' END;
 INSERT INTO media(id,tenant_id,project_id,scope,kind,status,display_name,safe_original_file_name,created_by,source_job_id,mime) VALUES(j.id,j.tenant_id,j.project_id,'project',media_kind,'processing',CASE WHEN p.execution_mode='verified_provider' THEN CASE media_kind WHEN 'audio' THEN '生成音频' WHEN 'video' THEN '生成视频' ELSE '生成图片' END ELSE CASE media_kind WHEN 'audio' THEN '生成音频（显式技术测试）' WHEN 'video' THEN '生成视频（显式技术测试）' ELSE '生成图片（显式技术测试）' END END,file_name,j.created_by,j.id,image_source->>'mime');
 INSERT INTO generation_media_outputs(id,tenant_id,project_id,job_id,media_id,evidence_id,source,output_options,epoch) VALUES(j.id,j.tenant_id,j.project_id,j.id,j.id,e.id,image_source,p.resolved_input->'output',current_epoch);
 UPDATE generation_jobs SET status='archiving',error_code=NULL,revision=revision+1,updated_at=now() WHERE id=j.id;
 DELETE FROM generation_work WHERE job_id=j.id;
END $$;

-- Result downloads happen inside the observation; give one executor 180 seconds.
CREATE OR REPLACE FUNCTION claim_generation_observation(wanted uuid,token uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE j generation_jobs; ctl generation_observation_control; action text; provider_id text; prior_failures integer;
BEGIN
 IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Worker access required' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM generation_jobs WHERE id=wanted FOR UPDATE;
 IF NOT FOUND OR j.status NOT IN ('submission_unknown','provider_pending','provider_running','cancel_requested','reconciliation_required') OR j.error_code IN ('CONFLICTING_SUBMISSION_EVIDENCE','CONFLICTING_PROVIDER_ID') THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM generation_attempts WHERE job_id=j.id) THEN RETURN NULL; END IF;
 INSERT INTO generation_observation_control(job_id) VALUES(j.id) ON CONFLICT(job_id) DO NOTHING;
 SELECT * INTO ctl FROM generation_observation_control WHERE job_id=j.id FOR UPDATE;
 IF ctl.next_observation_at>now() OR ctl.lease_until>now() THEN RETURN NULL; END IF;
 SELECT provider_job_id INTO provider_id FROM generation_provider_bindings WHERE job_id=j.id;
 action:=CASE WHEN provider_id IS NULL THEN 'recover' WHEN j.cancel_requested_at IS NOT NULL AND NOT ctl.cancel_attempted THEN 'cancel' ELSE 'query' END;
 prior_failures:=ctl.observation_failures;
 UPDATE generation_observation_control SET lease_token=token,lease_until=now()+interval '180 seconds',observation_failures=least(observation_failures+1,1000000),cancel_attempted=cancel_attempted OR action='cancel' WHERE job_id=j.id;
 IF action='query' AND ctl.cancel_attempted AND j.cancel_status='requested' AND NOT EXISTS(SELECT 1 FROM generation_submission_evidence e JOIN generation_attempts a ON a.id=e.attempt_id WHERE a.job_id=j.id AND e.body->>'kind' IN ('cancel_requested','cancel_unsupported','cancel_unknown','cancelled')) THEN UPDATE generation_jobs SET cancel_status='unknown',revision=revision+1,updated_at=now() WHERE id=j.id; END IF;
 RETURN read_generation_evidence(j.id)||jsonb_build_object('action',action,'leaseToken',token,'observationFailures',prior_failures);
END $$;

-- The executor never reads media directly: only the fixed plan's own references, only ready originals.
CREATE FUNCTION read_generation_media_sources(wanted uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE result jsonb;
BEGIN
 IF NOT generation_worker_login() THEN RAISE EXCEPTION 'Worker access required' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'kind',m.kind,'mime',m.mime,'bytes',m.bytes,'sha256',m.sha256,'width',m.width,'height',m.height,'object',jsonb_build_object('key',m.immutable_key,'versionId',m.storage_version_id)) ORDER BY r.ordinality),'[]'::jsonb) INTO result
 FROM generation_jobs j JOIN generation_plans p ON p.id=j.plan_id
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.resolved_input->'references','[]'::jsonb)) WITH ORDINALITY AS r(value,ordinality)
 JOIN media m ON m.tenant_id=j.tenant_id AND m.id=(r.value->'reference'->>'mediaId')::uuid AND m.status='ready' AND m.immutable_key IS NOT NULL
 WHERE j.id=wanted;
 RETURN coalesce(result,'[]'::jsonb);
END $$;
```

在 `packages/database/src/roles.ts` 的 `generationFunctions` 数组末尾追加 `"read_generation_media_sources(uuid)",`。

- [ ] **Step 2: 写迁移测试**

```ts
// tests/integration/verified-runtime.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { grantGenerationWorkerAccess, sqlIdentifier } from "@drama/database";
import { businessFixture } from "../support/business.js";

test("read_generation_media_sources is worker-only and returns [] for unknown jobs; lease is 180s", async (t) => {
  const f = await businessFixture(t);
  const role = `vgen_${randomBytes(6).toString("hex")}`, password = randomBytes(24).toString("hex");
  await f.admin.query(`CREATE ROLE ${sqlIdentifier(role)} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOINHERIT PASSWORD '${password}'`);
  const grant = await f.admin.connect();
  try { await grantGenerationWorkerAccess(grant, f.schema, role); } finally { grant.release(); }
  const url = new URL(process.env.DATABASE_URL!); url.username = role; url.password = password;
  const worker = new Pool({ connectionString: url.href, max: 1 });
  t.after(async () => { await worker.end(); const c = new Pool({ connectionString: process.env.DATABASE_URL }); try { await c.query(`DROP OWNED BY ${sqlIdentifier(role)}`); await c.query(`DROP ROLE ${sqlIdentifier(role)}`); } finally { await c.end(); } });
  const empty = await worker.query(`SELECT ${sqlIdentifier(f.schema)}.read_generation_media_sources($1) AS v`, [randomUUID()]);
  assert.deepEqual(empty.rows[0].v, []);
  await assert.rejects(f.admin.query(`SET ROLE ${sqlIdentifier(role)}; SELECT 1`).then(() => f.admin.query(`RESET ROLE`)).then(() => Promise.reject(new Error("unreachable"))), () => true);
  const source = await f.admin.query(`SELECT prosrc FROM pg_proc WHERE proname='claim_generation_observation'`);
  assert.match(source.rows[0].prosrc, /interval '180 seconds'/);
});
```

（`businessFixture` 会应用全部迁移；本用例只证明迁移可应用、新函数存在且受角色保护、租约时长已改。端到端行为在 Task 12 覆盖。）

- [ ] **Step 3: 运行迁移测试**

Run: `npm run test:db -- --test-name-pattern="read_generation_media_sources"`
Expected: PASS（本地需要 `npm run db:up`）。若 `SET ROLE` 断言写法在本地不成立，改为直接用 admin 连接调用函数并断言抛 `42501`。

- [ ] **Step 4: 放宽视频时长容差、提高查询时限**

`packages/media/src/generated-output.ts` 把视频分支最后的一帧判断改为 ±1 秒：

```ts
    const delta =
      BigInt(probe.durationUs!) - BigInt(output.durationSeconds!) * 1000000n;
    // Real providers round to whole seconds (floor(frames/24)); allow one second either way.
    if ((delta < 0n ? -delta : delta) > 1000000n)
      throw new MediaFailure(
        "VIDEO_OUTPUT_MISMATCH",
        "原视频时长与固定请求相差超过 1 秒。",
      );
```

测试 `tests/media/generated-output.test.ts`（若目录下已有同名测试则追加用例）：

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateGeneratedOutput } from "@drama/media";
const probe = (durationUs: number) => ({ kind: "video", mime: "video/mp4", hasAudio: true, durationUs, fpsNum: 24, fpsDen: 1, width: 1280, height: 720 } as any);
test("video duration within one second passes; beyond fails", () => {
  const output = { resolution: "1280x720", durationSeconds: 5, withAudio: true };
  assert.doesNotThrow(() => validateGeneratedOutput(probe(5540000), "video/mp4", output));
  assert.doesNotThrow(() => validateGeneratedOutput(probe(4100000), "video/mp4", output));
  assert.throws(() => validateGeneratedOutput(probe(6100000), "video/mp4", output), /VIDEO_OUTPUT_MISMATCH/);
});
```

Run: `node --import tsx --test tests/media/generated-output.test.ts` → PASS。

`apps/api/src/modules/generation/worker.ts`：第 272 行 `AbortSignal.timeout(30000)` 与第 289 行 `AbortSignal.timeout(30000)` 都改为 `120000`。运行 `npm run test:db -- --test-name-pattern="async"` 确认旧异步用例仍通过。

- [ ] **Step 5: 实现执行器运行时**

```ts
// apps/worker/src/verified-runtime.ts
import type { Pool, PoolClient } from "pg";
import { createScheduler } from "@drama/queue";
import { sqlIdentifier } from "@drama/database";
import type { MediaStore } from "@drama/media";
import { createVerifiedAdapters, type GenerationVendors, type ResolvedMedia } from "@drama/provider";
import { createAssistanceWorker } from "../../api/src/modules/generation/worker.js";

export async function createVerifiedGenerationRuntime(options: {
  pool: Pool; schema: string; queueSchema?: string; config: GenerationVendors; store: MediaStore; tmpdir: string;
  fetch?: typeof fetch; onError?: (stage: string) => void;
}) {
  const scope = sqlIdentifier(options.schema);
  const resolveMedia = async (jobId: string): Promise<ResolvedMedia[]> =>
    (await options.pool.query(`SELECT ${scope}.read_generation_media_sources($1) AS sources`, [jobId])).rows[0]?.sources ?? [];
  const scheduler = await createScheduler(options.pool, {
    ...(options.queueSchema ? { schema: options.queueSchema } : {}),
    onError: () => options.onError?.("archive_queue"),
  });
  const adapters = createVerifiedAdapters(options.config, { store: options.store, resolveMedia, fetch: options.fetch ?? fetch, tmpdir: options.tmpdir });
  const worker = await createAssistanceWorker({ pool: options.pool, schema: options.schema, adapters, scheduleArchive: (sql: PoolClient, envelope) => scheduler.schedule(sql, envelope) });
  let timer: NodeJS.Timeout | undefined, active: Promise<void> | undefined, closing = false;
  const scanOnce = () => worker.scan().then(() => undefined);
  function tick(intervalMs: number) {
    if (closing) return;
    active = scanOnce().catch(() => options.onError?.("scan")).finally(() => { if (!closing) timer = setTimeout(() => tick(intervalMs), intervalMs); });
  }
  return {
    scanOnce,
    start(intervalMs = 2500) { tick(intervalMs); },
    async close() { if (closing) return; closing = true; clearTimeout(timer); await active; await scheduler.close(); },
  };
}
```

Run: `npm run typecheck`
Expected: 通过。若 `worker.scan()` 返回类型不是 Promise<void>，按实际类型调整 `scanOnce`。

- [ ] **Step 6: 提交**

```bash
git add packages/database/migrations/0117_verified_provider_runtime.sql packages/database/src/roles.ts apps/worker/src/verified-runtime.ts apps/api/src/modules/generation/worker.ts packages/media/src/generated-output.ts tests/integration/verified-runtime.test.ts tests/media/generated-output.test.ts
git commit -m "feat(generation): accept verified-provider receipts, 180s observation lease and job-scoped media sources" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: API 放行 verified 能力并给出真实估价

**Files:**
- Modify: `apps/api/package.json`（dependencies 增加 `"@drama/provider": "0.0.0"`，然后 `npm install` 更新 lockfile）
- Modify: `apps/api/src/modules/generation/media-input.ts:24-30`
- Modify: `apps/api/src/modules/generation/model.ts:22`（import）、`:69`（costStatus）、`:451-461`（验收门禁与估价）
- Test: `tests/integration/verified-plan.test.ts`

**Interfaces:**
- Consumes: Task 1 `findProfile`、`estimateCost`、`capabilityDefinition`、`VerifiedProfileError`。
- Produces: 能力 `execution_mode='verified_provider'` 且 `definition.verifiedAt` 存在时，计划可 `ready`，`costEstimate` 为真实估价；`GenerationJob.costStatus` 对 verified 为 `"pending"`。

- [ ] **Step 1: 写失败测试**

```ts
// tests/integration/verified-plan.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { capabilityDefinition, findProfile } from "@drama/provider";
import { imageGenerationFixture } from "../support/image-generation.js";

test("verified capability: blocked until verifiedAt, then ready with a real Seedance estimate", async (t) => {
  const f = await imageGenerationFixture(t, undefined, { purpose: "video" });
  const profile = findProfile("volcengine/doubao-seedance-2-0-260128")!;
  const insert = (id: string, definition: unknown) =>
    f.admin.query(
      `INSERT INTO ${f.scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'verified_provider',true,3,200)`,
      [id, f.tenant.id, f.input.connectionId, randomUUID(), definition],
    );
  const unverified = randomUUID(), verified = randomUUID();
  await insert(unverified, capabilityDefinition(profile, "frames_v1", {}));
  await insert(verified, capabilityDefinition(profile, "frames_v1", { verifiedAt: new Date().toISOString() }));
  const body = { ...f.input, output: { resolution: "1280x720", aspectRatio: "16:9", durationSeconds: 5, withAudio: true } };
  const blocked = await f.ok("POST", `${f.base}/generation-plans`, { ...body, capabilityId: unverified });
  assert.equal(blocked.status, "blocked");
  assert.ok(blocked.blockingReasons.includes("REAL_PROVIDER_ACCEPTANCE_REQUIRED"));
  const ready = await f.ok("POST", `${f.base}/generation-plans`, { ...body, capabilityId: verified });
  assert.equal(ready.status, "ready");
  assert.equal(ready.costEstimate.pricingRevision, "ark-cn-2026-09-22");
  assert.equal(ready.costEstimate.totalReservation.amountMicros, "5961600");
  assert.equal(ready.resolvedInput.capabilitySnapshot.mode, "frames_v1");
  const rejected = await f.request("POST", `${f.base}/generation-plans`, { ...body, capabilityId: verified, output: { resolution: "1234x567", durationSeconds: 5 } });
  assert.equal(rejected.statusCode, 422);
  const job = await f.request("POST", `${f.base}/generation-jobs`, { planId: ready.id });
  assert.equal(job.statusCode, 202, job.body);
  assert.equal(job.json().costStatus, "pending");
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run test:db -- --test-name-pattern="verified capability"`
Expected: FAIL，503 `IMAGE_CAPABILITY_NOT_EXECUTABLE` 或 `REAL_PROVIDER_ACCEPTANCE_REQUIRED` 出现在 verified 行上。

- [ ] **Step 3: 改 media-input 门禁**

把 `apps/api/src/modules/generation/media-input.ts` 第 24 到 30 行的 `requireThat` 替换为：

```ts
  const profile =
    capability.execution_mode === "verified_provider"
      ? findProfile(String(capability.definition.modelVersion))
      : undefined;
  requireThat(
    (capability.execution_mode === "test_fixture" &&
      capability.definition.mode === `${kind}_fixture_v1`) ||
      (!!profile &&
        profile.purpose === kind &&
        ["frames_v1", "reference_v1"].includes(capability.definition.mode)),
    503,
    "IMAGE_CAPABILITY_NOT_EXECUTABLE",
    "所选能力是提示目标描述或尚未接通的真实模型，不能执行所选媒体生成。",
  );
```

文件顶部加 `import { findProfile } from "@drama/provider";`。

- [ ] **Step 4: 改 model.ts 门禁、估价与 costStatus**

顶部加 `import { estimateCost, findProfile, VerifiedProfileError } from "@drama/provider";`。

第 69 行 `costStatus: fixture ? "final" : "unavailable",` 改为：

```ts
    costStatus: fixture
      ? "final"
      : row.execution_mode === "verified_provider"
        ? "pending"
        : "unavailable",
```

第 451 到 461 行替换为：

```ts
  if (!cap.enabled) reasons.push("MODEL_DISABLED");
  // Only a fixture or a capability an operator marked verified can become ready.
  const verifiedProfile =
    cap.execution_mode === "verified_provider"
      ? findProfile(String(cap.definition.modelVersion))
      : undefined;
  if (cap.execution_mode === "verified_provider") {
    if (!cap.definition.verifiedAt || !verifiedProfile)
      reasons.push("REAL_PROVIDER_ACCEPTANCE_REQUIRED");
  } else if (cap.execution_mode !== "test_fixture")
    reasons.push("REAL_PROVIDER_ACCEPTANCE_REQUIRED");
  if (cap.definition.purpose !== input.purpose)
    reasons.push("CAPABILITY_PURPOSE_MISMATCH");
  let estimate: Schema<"CostEstimate"> = {
    pricingRevision: "explicit-test-fixture/1",
    lines: [],
    baseCost: zero,
    holdMargin: zero,
    totalReservation: zero,
    basisNote: "显式本地测试适配器；没有模型调用与费用，不代表真实模型验收。",
  };
  if (verifiedProfile)
    try {
      estimate = estimateCost(verifiedProfile, resolved);
    } catch (error) {
      if (!(error instanceof VerifiedProfileError)) throw error;
      reasons.push("COST_ESTIMATE_UNAVAILABLE");
    }
```

- [ ] **Step 5: 运行通过**

Run: `npm run test:db -- --test-name-pattern="verified capability"`，然后 `npm run test:db`
Expected: 新用例 PASS，旧用例全部 PASS（`video-generation`、`image-generation`、`async-provider-http` 都不受影响）。

- [ ] **Step 6: 提交**

```bash
git add apps/api/package.json package-lock.json apps/api/src/modules/generation/media-input.ts apps/api/src/modules/generation/model.ts tests/integration/verified-plan.test.ts
git commit -m "feat(generation): admit verified capabilities with real cost estimates" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: 端到端：真实执行器运行时走假方舟服务

**Files:**
- Create: `tests/helpers/fake-ark.ts`（把 Task 6 测试里的 `fakeArk` 搬成可复用 helper，Task 6 的测试改为引用它）
- Test: `tests/integration/verified-runtime.test.ts`（追加用例）

**Interfaces:**
- Consumes: Task 8 `createVerifiedGenerationRuntime`；Task 7 `parseGenerationVendors`；Task 9 的计划路径。
- Produces: 证明 `verified_provider` 作业能经过 `claim → submitOnce(accepted) → query(completed) → finish_generation_output → archiving`。

- [ ] **Step 1: 抽出 helper**

`tests/helpers/fake-ark.ts` 导出 `fakeArk()`，内容与 Task 6 测试中的同名函数完全一致（`origin`、`calls`、`setStatus`、`setImageMode`、`close`）。Task 6 测试改为 `import { fakeArk } from "./helpers/fake-ark.js"` 并删除本地定义。运行 `node --import tsx --test tests/verified-volcengine.test.ts` 确认仍 PASS。

- [ ] **Step 2: 写端到端用例**

在 `tests/integration/verified-runtime.test.ts` 追加：

```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capabilityDefinition, findProfile, parseGenerationVendors } from "@drama/provider";
import { imageGenerationFixture } from "../support/image-generation.js";
import { createVerifiedGenerationRuntime } from "../../apps/worker/src/verified-runtime.js";
import { fakeArk } from "../helpers/fake-ark.js";

test("verified runtime: Seedance job is accepted, polled, archived into the private store and reaches archiving", async (t) => {
  const published: unknown[] = [];
  const store = {
    verify: async () => undefined,
    async publish(_file: string, data: { bytes: number; sha256: string; mime: string }) {
      published.push(data);
      return { key: `originals/${randomUUID()}`, versionId: "v1", bytes: data.bytes, sha256: data.sha256 };
    },
    async download() { throw new Error("no references in this test"); },
    close() {},
  } as any;
  const f = await imageGenerationFixture(t, store, { purpose: "video" });
  const ark = await fakeArk(); t.after(ark.close);
  const connectionVersionId = randomUUID(), capabilityId = randomUUID();
  await f.admin.query(
    `INSERT INTO ${f.scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'verified_provider',true,3,200)`,
    [capabilityId, f.tenant.id, f.input.connectionId, connectionVersionId, capabilityDefinition(findProfile("volcengine/doubao-seedance-2-0-mini-260615")!, "frames_v1", { verifiedAt: new Date().toISOString() })],
  );
  const plan = await f.ok("POST", `${f.base}/generation-plans`, { ...f.input, capabilityId, output: { resolution: "720x1280", aspectRatio: "9:16", durationSeconds: 5, withAudio: true } });
  assert.equal(plan.status, "ready");
  const job = (await f.request("POST", `${f.base}/generation-jobs`, { planId: plan.id })).json();
  const runtime = await createVerifiedGenerationRuntime({
    pool: f.generationDb, schema: f.schema, queueSchema: f.queueSchema, store, tmpdir: await mkdtemp(join(tmpdir(), "verified-e2e-")),
    config: parseGenerationVendors({ vendors: { volcengine: { apiKey: "k", baseUrl: `${ark.origin}/api/v3` } }, connections: [{ vendor: "volcengine", connectionId: f.input.connectionId, connectionVersionId, accountIdentityLabel: "test" }] }),
  });
  t.after(runtime.close);
  await runtime.scanOnce();
  assert.equal((await f.job(job.id)).status, "provider_pending");
  assert.equal(ark.calls.filter((c) => c.method === "POST").length, 1);
  assert.deepEqual([ark.calls[0]!.body.model, ark.calls[0]!.body.resolution, ark.calls[0]!.body.ratio], ["doubao-seedance-2-0-mini-260615", "720p", "9:16"]);
  ark.setStatus("succeeded");
  await f.admin.query(`UPDATE ${f.scope}.generation_observation_control SET next_observation_at=now() WHERE job_id=$1`, [job.id]);
  await runtime.scanOnce();
  const done = await f.job(job.id);
  assert.equal(done.status, "archiving");
  assert.equal(done.providerJobId, "cgt-1");
  assert.equal(published.length, 1);
  assert.equal((published[0] as { mime: string }).mime, "video/mp4");
});
```

- [ ] **Step 3: 运行**

Run: `npm run test:db -- --test-name-pattern="verified runtime"`
Expected: PASS。若 `f.job` 在 `archiving` 前还需要一次扫描（`finish` 在下一轮），把最后一段改为再调用一次 `runtime.scanOnce()` 后断言。

- [ ] **Step 4: 提交**

```bash
git add tests/helpers/fake-ark.ts tests/verified-volcengine.test.ts tests/integration/verified-runtime.test.ts apps/worker/src/verified-runtime.ts
git commit -m "test(generation): drive a verified Seedance job end to end through a loopback Ark" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: 开通脚本与生产配置

**Files:**
- Create: `scripts/provision-verified-capabilities.ts`
- Create: `deploy/examples/generation.json`
- Modify: `deploy/examples/provision.json`（增加 `"generationRole": "scenedesk_generation"`）
- Modify: `deploy/runtime/provision.ts:25-66`
- Modify: `deploy/runtime/config.ts`（`generationConfiguration`；`PROVIDER_MODE` 接受 `verified`）
- Test: `deploy/tests/config.test.ts`（追加用例）

**Interfaces:**
- Produces:
  - `generationConfiguration(input: unknown): { databaseUrl: string; media: StoreConfiguration; vendors: GenerationVendors }`，允许的键恰为 `["databaseUrl","media","vendors","connections"]`
  - 脚本用法：`node --env-file=.env --import tsx scripts/provision-verified-capabilities.ts --config <generation.json> --tenant <uuid> [--enable <profileId>]`

- [ ] **Step 1: 写部署配置测试**

在 `deploy/tests/config.test.ts` 追加：

```ts
import { generationConfiguration } from "../runtime/config.js";
const generationExample = {
  databaseUrl: "postgresql://scenedesk_generation:secret@db.example.invalid/scenedesk?sslmode=verify-full",
  media: { region: "cn", bucket: "b", accessKeyId: "k", secretAccessKey: "s" },
  vendors: { volcengine: { apiKey: "a", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", accountTier: "personal" } },
  connections: [{ vendor: "volcengine", connectionId: "33333333-3333-4333-8333-333333333333", connectionVersionId: "44444444-4444-4444-8444-444444444444", accountIdentityLabel: "ark" }],
};
test("generation configuration accepts the documented shape and rejects unknown keys and http vendors", () => {
  const parsed = generationConfiguration(generationExample);
  assert.equal(parsed.vendors.connections.length, 1);
  assert.throws(() => generationConfiguration({ ...generationExample, extra: 1 }), /CONFIG_UNKNOWN_FIELD/);
  assert.throws(() => generationConfiguration({ ...generationExample, vendors: { volcengine: { apiKey: "a", baseUrl: "http://ark.cn-beijing.volces.com" } } }), /GENERATION_BASE_URL_HTTPS_REQUIRED/);
});
test("PROVIDER_MODE=verified is accepted and other values still fail", async () => {
  process.env.PROVIDER_MODE = "verified";
  process.env.SCENEDESK_CONFIG_FILE = "/nonexistent.json";
  await assert.rejects(configuration(), /CONFIG_FILE_UNREADABLE_OR_INVALID_JSON/);
  process.env.PROVIDER_MODE = "real";
  await assert.rejects(configuration(), /PROVIDER_MODE_INVALID/);
  delete process.env.PROVIDER_MODE; delete process.env.SCENEDESK_CONFIG_FILE;
});
```

（`configuration` 已在该测试文件里导入；若未导入则补上。）

- [ ] **Step 2: 运行确认失败**

Run: `sh deploy/check.sh`
Expected: 类型错误或断言失败。

- [ ] **Step 3: 实现 config.ts 改动**

第 139 到 140 行改为：

```ts
  if (process.env.PROVIDER_MODE && !["mock", "verified"].includes(process.env.PROVIDER_MODE))
    fail("PROVIDER_MODE_INVALID");
```

在 `workerConfiguration` 之后追加：

```ts
import { parseGenerationVendors } from "@drama/provider"; // 放到文件顶部 import 区
export function generationConfiguration(input: unknown) {
  const value = record(input);
  keys(value, ["databaseUrl", "media", "vendors", "connections"]);
  const databaseUrl = database(field(value, "databaseUrl"));
  let vendors;
  try {
    vendors = parseGenerationVendors({ vendors: value.vendors, connections: value.connections });
  } catch (error) {
    return fail((error as Error).message);
  }
  for (const vendor of Object.values(vendors.vendors)) httpsAddress(vendor!.baseUrl);
  return { databaseUrl, media: storage(value.media), vendors };
}
```

`deploy/tsconfig.json` 若没有把 `packages/provider` 纳入编译范围，按 `@drama/media` 的写法补上。

- [ ] **Step 4: 生产角色授权**

`deploy/examples/provision.json` 加一行 `"generationRole": "scenedesk_generation"`。`deploy/runtime/provision.ts`：`keys` 与 `roles` 数组各加 `"generationRole"`（放在 `schedulerRole` 之后、`authorizationOwner` 之前，并把后面 `roles[4]` 的下标改成 `roles[5]`）；在 `grantMediaWorkerAccess` 之后追加：

```ts
    await grantGenerationWorkerAccess(sql, "drama", roles[4]!);
    await grantQueueAccess(sql, "scenedesk_queue", roles[4]!, roles[3]!);
```

并在文件顶部 import 里加 `grantGenerationWorkerAccess`。

- [ ] **Step 5: 示例配置与开通脚本**

`deploy/examples/generation.json`：

```json
{
  "databaseUrl": "postgresql://scenedesk_generation:REPLACE_WITH_GENERATION_SECRET@database.example.invalid/scenedesk?sslmode=verify-full",
  "media": {
    "region": "YOUR_STORAGE_REGION",
    "bucket": "your-private-versioned-media-bucket",
    "accessKeyId": "REPLACE_WITH_WORKER_STORAGE_KEY",
    "secretAccessKey": "REPLACE_WITH_WORKER_STORAGE_SECRET"
  },
  "vendors": {
    "minimax": { "apiKey": "REPLACE_WITH_MINIMAX_API_KEY", "baseUrl": "https://api.minimax.cn" },
    "volcengine": { "apiKey": "REPLACE_WITH_ARK_API_KEY", "baseUrl": "https://ark.cn-beijing.volces.com/api/v3", "accountTier": "personal" }
  },
  "connections": [
    { "vendor": "minimax", "connectionId": "REPLACE_WITH_UUID", "connectionVersionId": "REPLACE_WITH_UUID", "accountIdentityLabel": "MiniMax account <masked>" },
    { "vendor": "volcengine", "connectionId": "REPLACE_WITH_UUID", "connectionVersionId": "REPLACE_WITH_UUID", "accountIdentityLabel": "Volcengine account <masked>" }
  ]
}
```

`scripts/provision-verified-capabilities.ts`：

```ts
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { sqlIdentifier } from "@drama/database";
import { PROFILES, capabilityDefinition, parseGenerationVendors, VerifiedProfileError } from "@drama/provider";

// Writes capability rows derived from the code profiles. Never touches secrets; the
// config file is read only for connection identities. Enabling requires an explicit flag.
const { values } = parseArgs({ options: { config: { type: "string" }, tenant: { type: "string" }, enable: { type: "string", multiple: true } } });
if (!process.env.DATABASE_URL || !values.config || !values.tenant || !/^[0-9a-f-]{36}$/.test(values.tenant))
  throw new Error("Usage: DATABASE_URL=… provision-verified-capabilities.ts --config generation.json --tenant <uuid> [--enable <profileId>]");
const raw = JSON.parse(await readFile(values.config, "utf8"));
const vendors = parseGenerationVendors({ vendors: raw.vendors, connections: raw.connections });
const scope = sqlIdentifier(process.env.DATABASE_SCHEMA ?? "drama");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const sql = await pool.connect();
const summary: Record<string, string> = {};
try {
  await sql.query("BEGIN");
  const tenant = await sql.query(`SELECT id FROM ${scope}.tenants WHERE id=$1 AND status='active'`, [values.tenant]);
  if (!tenant.rows[0]) throw new Error("An active tenant is required");
  for (const profile of PROFILES) {
    const connection = vendors.connections.find((c) => c.vendor === profile.vendor);
    if (!connection) { summary[profile.id] = "skipped: vendor has no connection"; continue; }
    const enable = values.enable?.includes(profile.id) ?? false;
    for (const mode of profile.modes) {
      const existing = await sql.query(
        `SELECT id,revision,definition FROM ${scope}.generation_capabilities WHERE tenant_id=$1 AND connection_version_id=$2 AND definition->>'modelVersion'=$3 AND definition->>'mode'=$4`,
        [values.tenant, connection.connectionVersionId, profile.id, mode],
      );
      let definition;
      try {
        definition = capabilityDefinition(profile, mode, { ...(enable ? { verifiedAt: new Date().toISOString() } : existing.rows[0]?.definition?.verifiedAt ? { verifiedAt: existing.rows[0].definition.verifiedAt } : {}) });
      } catch (error) {
        if (error instanceof VerifiedProfileError && error.code === "OUTPUTS_UNMEASURED") { summary[`${profile.id}/${mode}`] = "skipped: outputs unmeasured"; continue; }
        throw error;
      }
      const inflight = typeof profile.inflight === "number" ? profile.inflight : profile.inflight[vendors.vendors[profile.vendor]?.accountTier ?? "personal"];
      if (existing.rows[0]) {
        await sql.query(
          `UPDATE ${scope}.generation_capabilities SET definition=$2,revision=revision+1,enabled=CASE WHEN $3 THEN true ELSE enabled END,max_inflight=$4,updated_at=now() WHERE id=$1`,
          [existing.rows[0].id, definition, enable, Math.min(inflight, 8)],
        );
        summary[`${profile.id}/${mode}`] = enable ? "updated+enabled" : "updated";
      } else {
        await sql.query(
          `INSERT INTO ${scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'verified_provider',$6,$7,200)`,
          [randomUUID(), values.tenant, connection.connectionId, connection.connectionVersionId, definition, enable, Math.min(inflight, 8)],
        );
        summary[`${profile.id}/${mode}`] = enable ? "inserted+enabled" : "inserted";
      }
    }
  }
  await sql.query("COMMIT");
} catch (error) {
  await sql.query("ROLLBACK");
  throw error;
} finally {
  sql.release();
  await pool.end();
}
console.log(JSON.stringify({ tenant: values.tenant, capabilities: summary }));
```

若 `generation_capabilities` 没有 `updated_at` 列，去掉 UPDATE 里的 `updated_at=now()`。

- [ ] **Step 6: 运行**

Run: `sh deploy/check.sh && npm run typecheck`
Expected: 通过。本地对 fixture 租户跑一次脚本（不带 `--enable`）应打印 `inserted` 或 `skipped: outputs unmeasured`（H3）。

- [ ] **Step 7: 提交**

```bash
git add scripts/provision-verified-capabilities.ts deploy/examples/generation.json deploy/examples/provision.json deploy/runtime/provision.ts deploy/runtime/config.ts deploy/tests/config.test.ts deploy/tsconfig.json
git commit -m "feat(deploy): generation executor configuration, role provisioning and capability provisioning script" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: 执行器进程、镜像与部署门禁

**Files:**
- Create: `deploy/runtime/generation-worker.ts`
- Create: `apps/worker/src/generation-verified.ts`
- Modify: `deploy/Dockerfile`（新增 `generation-worker` target）
- Modify: `deploy/compose.yaml`（新增服务与 secret）
- Modify: `deploy/runtime/deployment-audit.ts:29-36`、`deploy/runtime/audit.ts`
- Modify: `apps/api/src/main.ts:13-14`、`apps/worker/src/main.ts:11-17`
- Modify: `deploy/README.md`、`package.json`（scripts 增加 `dev:generation-worker`）
- Test: `deploy/integration/generation-audit.test.ts`（追加用例）

**Interfaces:**
- Produces: `requireGenerationAudit(report, options?: { executorConfigured?: boolean })`；`node deploy/runtime/audit.ts --generation-executor` 视执行器为已配置。

- [ ] **Step 1: 审计门禁测试**

在 `deploy/integration/generation-audit.test.ts` 已有"executor_required_jobs 报错"的用例旁追加：

```ts
      assert.doesNotThrow(() => requireGenerationAudit({ ...report, executor_required_jobs: 1 }, { executorConfigured: true }));
      assert.throws(() => requireGenerationAudit({ ...report, executor_required_jobs: 1 }), /GENERATION_EXECUTOR_UNAVAILABLE/);
```

`deployment-audit.ts` 改为：

```ts
export function requireGenerationAudit(
  report: Awaited<ReturnType<typeof readGenerationAudit>>,
  options: { executorConfigured?: boolean } = {},
) {
  if (report.missing_archive_sources)
    throw new DeploymentError("GENERATION_ARCHIVE_SOURCE_MISSING");
  if (report.executor_required_jobs && !options.executorConfigured)
    throw new DeploymentError("GENERATION_EXECUTOR_UNAVAILABLE");
}
```

`audit.ts` 里 `requireGenerationAudit(report)` 改为 `requireGenerationAudit(report, { executorConfigured: process.argv.includes("--generation-executor") })`，两处输出里的 `generationExecutor: "unavailable"` 改为 `process.argv.includes("--generation-executor") ? "configured" : "unavailable"`，`newGenerationSubmissionsEnabled` 同理。

Run: `PROVIDER_MODE=mock DATABASE_URL=<本地> node --import tsx --test deploy/integration/generation-audit.test.ts` → PASS。

- [ ] **Step 2: 生产入口**

```ts
// deploy/runtime/generation-worker.ts
import { createServer } from "node:http";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { configuration, generationConfiguration, diagnostic, mediaStore, pool, fail } from "./config.js";
import { createVerifiedGenerationRuntime } from "../../apps/worker/src/verified-runtime.js";

let stage = "configuration", healthy = false, stopping = false;
const cleanup: Array<() => Promise<unknown>> = [];
async function close() {
  if (stopping) return;
  stopping = true; healthy = false;
  for (const run of cleanup.reverse()) await run().catch(() => {});
}
try {
  if (process.env.PROVIDER_MODE !== "verified") fail("PROVIDER_MODE_VERIFIED_REQUIRED");
  const config = generationConfiguration(await configuration());
  if (!process.env.TMPDIR?.startsWith("/")) fail("PRIVATE_TMPDIR_REQUIRED");
  stage = "temporary_directory";
  await access(process.env.TMPDIR!, constants.W_OK);
  const database = pool(config.databaseUrl);
  cleanup.push(() => database.end());
  const store = mediaStore(config.media);
  cleanup.push(async () => store.close());
  stage = "storage_versioning";
  await store.verify();
  stage = "generation_role";
  await database.query("SELECT drama.generation_worker_login()");
  stage = "capability_connections";
  const known = await database.query("SELECT DISTINCT connection_version_id::text AS id FROM drama.generation_capabilities WHERE execution_mode='verified_provider'");
  const ids = new Set(known.rows.map((r) => r.id));
  if (!config.vendors.connections.some((c) => ids.has(c.connectionVersionId))) fail("GENERATION_CONNECTIONS_NOT_PROVISIONED");
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify({ status: "ok", scope: "generation_executor_dependencies", vendors: Object.keys(config.vendors.vendors), paidProvidersEnabled: true }));
    await close();
  } else {
    stage = "start_runtime";
    const runtime = await createVerifiedGenerationRuntime({
      pool: database, schema: "drama", config: config.vendors, store, tmpdir: process.env.TMPDIR!,
      onError: (step) => diagnostic(undefined, `generation_${step}`),
    });
    cleanup.push(() => runtime.close());
    runtime.start(2500);
    healthy = true;
    const server = createServer((request, reply) => {
      if (request.url !== "/health/ready") { reply.writeHead(404).end(); return; }
      void Promise.all([database.query("SELECT 1"), store.verify()])
        .then(() => { reply.writeHead(healthy && !stopping ? 200 : 503, { "Content-Type": "application/json", "Cache-Control": "no-store" }); reply.end(JSON.stringify({ status: healthy && !stopping ? "ok" : "unavailable", scope: "generation_executor", paidProvidersEnabled: true })); })
        .catch(() => { reply.writeHead(503).end('{"status":"unavailable"}'); });
    });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(4314, "0.0.0.0", resolve); });
    cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    console.log(JSON.stringify({ status: "listening", service: "generation_executor", paidProvidersEnabled: true }));
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void close(); });
  }
} catch (error) {
  diagnostic(error, stage);
  await close();
  process.exitCode = 1;
}
```

`config.ts` 的 `diagnostic` 输出里 `paidProvidersEnabled: false` 改为 `paidProvidersEnabled: process.env.PROVIDER_MODE === "verified"`。

- [ ] **Step 3: 本地入口与脚本**

```ts
// apps/worker/src/generation-verified.ts
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Pool } from "pg";
import { MediaStore } from "@drama/media";
import { parseGenerationVendors } from "@drama/provider";
import { createVerifiedGenerationRuntime } from "./verified-runtime.js";

// Local entry: same JSON shape as production, but plain local Postgres and MinIO are allowed.
if (process.env.APP_ENV !== "local" || process.env.PROVIDER_MODE !== "verified" || !process.env.GENERATION_CONFIG_FILE)
  throw new Error("Set APP_ENV=local PROVIDER_MODE=verified GENERATION_CONFIG_FILE=<generation.json>");
if (process.env.DATABASE_URL || process.env.APP_SECRET) throw new Error("Generation worker must not load migration or identity credentials");
const raw = JSON.parse(await readFile(process.env.GENERATION_CONFIG_FILE, "utf8"));
const pool = new Pool({ connectionString: raw.databaseUrl, max: 3, connectionTimeoutMillis: 3000 });
const store = new MediaStore({ ...raw.media, credentials: { accessKeyId: raw.media.accessKeyId, secretAccessKey: raw.media.secretAccessKey }, local: true });
await store.verify();
const runtime = await createVerifiedGenerationRuntime({
  pool, schema: process.env.DATABASE_SCHEMA ?? "drama", queueSchema: process.env.QUEUE_SCHEMA, store, tmpdir: process.env.TMPDIR ?? tmpdir(),
  config: parseGenerationVendors({ vendors: raw.vendors, connections: raw.connections }),
  onError: (stage) => console.error(`generation ${stage} failed; durable state remains`),
});
runtime.start(2500);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void runtime.close().then(() => pool.end()); });
console.log(JSON.stringify({ generationWorker: "ready", executionMode: "verified_provider", paidProvidersEnabled: true, vendors: Object.keys(raw.vendors) }));
```

`package.json` scripts 加：`"dev:generation-worker": "node --env-file=.env.generation-verified --import tsx apps/worker/src/generation-verified.ts"`（`.env.generation-verified` 只含 `APP_ENV=local`、`PROVIDER_MODE=verified`、`GENERATION_CONFIG_FILE=…`、`DATABASE_SCHEMA`、`QUEUE_SCHEMA`；加入 `.gitignore`）。

`apps/api/src/main.ts:13-14` 与 `apps/worker/src/main.ts:11-17` 的 `PROVIDER_MODE` 判断改为允许 `mock | verified`。

- [ ] **Step 4: 镜像与 compose**

`deploy/Dockerfile` 在 `media-worker` target 后追加：

```dockerfile
FROM application AS generation-worker
CMD ["node", "--import", "tsx", "deploy/runtime/generation-worker.ts"]
```

`deploy/compose.yaml` 在 `media-worker` 后追加：

```yaml
  generation-worker:
    profiles: [generation]
    image: scenedesk-private-generation:${SCENEDESK_IMAGE_TAG:-local}
    build: { context: .., dockerfile: deploy/Dockerfile, target: generation-worker }
    init: true
    read_only: true
    restart: "no"
    stop_grace_period: 200s
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    environment:
      PROVIDER_MODE: verified
      TMPDIR: /tmp/generation
    tmpfs: ["/tmp/generation:size=512m,mode=0700,uid=1000"]
    secrets:
      - { source: generation_config, target: config.json }
    networks: [application]
    healthcheck:
      test: [CMD, node, -e, "fetch('http://127.0.0.1:4314/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 15s
      start_period: 30s
      retries: 3
```

`secrets:` 段加 `generation_config: { file: "${SCENEDESK_GENERATION_CONFIG:-/dev/null}" }`。

`deploy/README.md` 加一节"生成执行器"：配置文件示例路径、`provision.json` 的 `generationRole`、`docker compose --profile generation`、审计需加 `--generation-executor`、`stop_grace_period` 为 200 秒的原因（下载中的观察需要在租约内完成）。

- [ ] **Step 5: 检查**

Run: `sh deploy/check.sh && npm run check`
Expected: 通过。`docker build -f deploy/Dockerfile --target generation-worker -t scenedesk-private-generation:local .` 在有 Docker 的机器上通过（CI 的 deployment 工作流也加这一步）。

- [ ] **Step 6: 提交**

```bash
git add deploy/runtime/generation-worker.ts apps/worker/src/generation-verified.ts deploy/Dockerfile deploy/compose.yaml deploy/runtime/deployment-audit.ts deploy/runtime/audit.ts deploy/runtime/config.ts apps/api/src/main.ts apps/worker/src/main.ts deploy/README.md package.json .gitignore deploy/integration/generation-audit.test.ts .github/workflows/deployment.yml
git commit -m "feat(deploy): generation executor service with verified provider mode" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: 人工付费冒烟脚本

**Files:**
- Create: `scripts/verified-smoke.ts`

**Interfaces:**
- Consumes: Task 5／6 的客户端；Task 7 `parseGenerationVendors`。
- 用法：`node --import tsx scripts/verified-smoke.ts --config generation.json --vendor volcengine --kind image|video --out output/verified/<date>/`；每次运行只创建一个任务；成功后把请求摘要（不含密钥与 Base64）、任务 ID、每次查询观察、实际输出的宽高与时长（用 `probeMedia` 若可用，否则记录字节数与 sha256）、`usage` 写入 `--out` 目录的 `record.json`，文件权限 0600。

- [ ] **Step 1: 实现**

```ts
// scripts/verified-smoke.ts
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createMinimaxClient, createVolcengineClient, downloadBytes, parseGenerationVendors } from "@drama/provider";

// PAID. Creates exactly one vendor task and records the evidence MV-01/04/05/06 need.
const { values } = parseArgs({ options: { config: { type: "string" }, vendor: { type: "string" }, kind: { type: "string" }, out: { type: "string" }, prompt: { type: "string", default: "一只橘猫在窗台上晒太阳，午后柔光。" } } });
if (!values.config || !values.vendor || !values.kind || !values.out) throw new Error("Usage: --config generation.json --vendor minimax|volcengine --kind image|video --out <dir>");
const raw = JSON.parse(await readFile(values.config, "utf8"));
const vendors = parseGenerationVendors({ vendors: raw.vendors, connections: raw.connections }).vendors;
const record: Record<string, unknown> = { startedAt: new Date().toISOString(), vendor: values.vendor, kind: values.kind, observations: [] as unknown[] };
await mkdir(values.out, { recursive: true, mode: 0o700 });
const save = () => writeFile(join(values.out!, "record.json"), JSON.stringify(record, null, 2), { mode: 0o600 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const observe = (o: unknown) => { (record.observations as unknown[]).push({ at: new Date().toISOString(), ...(o as object) }); return save(); };
async function finish(bytes: Buffer, mime: string) {
  await writeFile(join(values.out!, mime === "video/mp4" ? "result.mp4" : "result.jpg"), bytes, { mode: 0o600 });
  record.result = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), mime };
  record.finishedAt = new Date().toISOString();
  await save();
  console.log(JSON.stringify({ status: "done", out: values.out, bytes: bytes.length }));
}
if (values.vendor === "volcengine") {
  const v = vendors.volcengine!, client = createVolcengineClient({ ...v, fetch });
  if (values.kind === "image") {
    const body = { model: "doubao-seedream-5-0-flash-260915", prompt: values.prompt, size: "1024x1024", response_format: "b64_json", output_format: "jpeg", watermark: false, sequential_image_generation: "disabled" };
    record.request = { ...body, digest: digest(body) };
    const r = await client.generateImages(body, AbortSignal.timeout(120000));
    await observe({ outcome: r.kind, status: (r as any).status, body: r.kind === "ok" ? { ...(r.body as any), data: "<omitted>" } : r });
    if (r.kind !== "ok") throw new Error(`image request ${r.kind}`);
    const first = (r.body as any).data[0];
    record.output = { size: first.size, output_format: first.output_format, usage: (r.body as any).usage };
    await finish(Buffer.from(first.b64_json, "base64"), "image/jpeg");
  } else {
    const body = { model: "doubao-seedance-2-0-mini-260615", content: [{ type: "text", text: values.prompt }], resolution: "720p", ratio: "16:9", duration: 5, generate_audio: true, watermark: false, execution_expires_after: 3600 };
    record.request = { ...body, digest: digest(body) };
    const created = await client.createContentTask(body, AbortSignal.timeout(120000));
    await observe({ phase: "create", outcome: created.kind, status: (created as any).status, body: (created as any).body });
    if (created.kind !== "ok") throw new Error(`create ${created.kind}`);
    const id = (created.body as any).id as string;
    for (;;) {
      await sleep(10000);
      const q = await client.getContentTask(id, AbortSignal.timeout(30000));
      await observe({ phase: "query", outcome: q.kind, status: (q as any).status, task: (q as any).body });
      if (q.kind !== "ok") continue;
      const task = q.body as any;
      if (task.status === "succeeded") { record.output = { duration: task.duration, resolution: task.resolution, ratio: task.ratio, usage: task.usage }; await finish(await downloadBytes(fetch, task.content.video_url, 128 * 1024 * 1024, AbortSignal.timeout(120000)), "video/mp4"); break; }
      if (["failed", "expired", "cancelled"].includes(task.status)) throw new Error(`task ${task.status}: ${JSON.stringify(task.error)}`);
    }
  }
} else {
  const v = vendors.minimax!, client = createMinimaxClient({ ...v, fetch });
  if (values.kind !== "video") throw new Error("MiniMax smoke supports video only");
  const body = { model: "MiniMax-H3", content: [{ type: "text", text: values.prompt }], resolution: "768P", duration: 5, ratio: "16:9", aigc_watermark: false };
  record.request = { ...body, digest: digest(body) };
  const created = await client.createVideoTask(body, AbortSignal.timeout(120000));
  await observe({ phase: "create", outcome: created.kind, status: (created as any).status, body: (created as any).body });
  if (created.kind !== "ok") throw new Error(`create ${created.kind}`);
  const id = (created.body as any).task_id as string;
  for (;;) {
    await sleep(10000);
    const q = await client.getVideoTask(id, AbortSignal.timeout(30000));
    const task = q.kind === "ok" ? ((q.body as any).task ?? q.body) : undefined;
    await observe({ phase: "query", outcome: q.kind, status: (q as any).status, task });
    if (!task) continue;
    if (task.status === "succeeded") { record.output = { duration: task.duration, resolution: task.resolution, usage: task.usage }; await finish(await downloadBytes(fetch, task.content.url, 128 * 1024 * 1024, AbortSignal.timeout(120000)), "video/mp4"); break; }
    if (["failed", "cancelled"].includes(task.status)) throw new Error(`task ${task.status}: ${JSON.stringify(task.error)}`);
  }
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: 通过。不要在 CI 或没有明确授权的情况下运行该脚本。

- [ ] **Step 3: 提交**

```bash
git add scripts/verified-smoke.ts
git commit -m "chore(scripts): manual paid smoke for verified providers" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: 文档与设计门禁

**Files:**
- Create: `docs/implementation/86-verified-provider-runtime.md`
- Modify: `docs/superpowers/specs/2026-09-22-verified-provider-integration-design.md` §5（把"roles.ts 给生成执行器角色加 media 只读列权限"改为"新增 SECURITY DEFINER 函数 `read_generation_media_sources`，执行器不直接读 media 表"）
- Modify: `docs/implementation/07-provider-adapter.md`（"当前接入执行材料"后追加一段指向 86）
- Modify: `docs/README.md`（若有实施记录索引则加一行）

- [ ] **Step 1: 写实施记录**

`docs/implementation/86-verified-provider-runtime.md` 包含：目的（一段）；模块表（与计划 File Structure 一致）；配置文件字段；开通流程（provision → provision-verified-capabilities → 冒烟 → `--enable`）；状态映射表（复制 spec §8）；不做清单（复制 spec §12）；验证记录占位：一张表列 MV-01 到 MV-10，首版每行填"待真实账号"。

- [ ] **Step 2: 跑文档门禁**

Run: `.venv/bin/python docs/implementation/check_design.py`
Expected: 通过。若门禁要求把新文档登记到清单或 `docs/implementation/openapi.json` 没有变化仍报错，按脚本输出补登记，不改契约。

- [ ] **Step 3: 提交**

```bash
git add docs/implementation/86-verified-provider-runtime.md docs/implementation/07-provider-adapter.md docs/superpowers/specs/2026-09-22-verified-provider-integration-design.md docs/README.md
git commit -m "docs(generation): record the verified provider runtime and its enablement path" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 需要你（Gandy）配合的事项

1. **账号与密钥**（Task 11 之后、冒烟之前）：MiniMax 开放平台国内站 API Key；火山方舟 API Key，并在控制台开通 Seedance 2.0 系列（需余额大于 200 元或资源包）与 Seedream 5.0。把两把 Key 写进演示机的 `generation.json`，不要发到聊天里。
2. **付费冒烟授权**：Task 13 每次运行只花几毛到几块钱，但需要你明确说"可以跑"；我会先跑 Seedream flash 一张图，再跑 Seedance mini 一个 5 秒视频，最后 H3 一个 5 秒视频（用于实测像素表）。
3. **部署**：演示机上创建 `scenedesk_generation` 数据库角色、跑 `provision --apply`、起 `--profile generation` 服务，按运行手册 83 的流程；我准备好命令后由你执行或授权我执行。

## 自查记录

- Spec 覆盖：§3 模块 → Task 1–8；§4 档案 → Task 1；§5 配置与数据 → Task 7、8、11；§6 执行流程 → Task 5、6、8；§7 费用 → Task 1、9；§8 错误映射 → Task 5、6；§9 容差 → Task 8；§10 部署 → Task 11、12；§11 测试 → 各任务 + Task 10、13；§12／§13 → Task 14。
- 与 spec 的一处偏差：执行器读参考素材不再靠 `media` 表列权限，而是新增 SECURITY DEFINER 函数（media 表启用了 RLS，直接授权读不到行）；Task 14 回写 spec。
- 类型一致性：`VerifiedDeps`、`ResolvedMedia`、`MediaResolver(jobId)`、`ArchivedOutput`、`HttpOutcome`、`GenerationVendors`、`createVerifiedGenerationRuntime` 的字段在 Task 3–12 间一致；`queueSchema` 是运行时的可选参数（Task 8 代码已含）。

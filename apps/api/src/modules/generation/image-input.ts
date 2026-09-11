import type { Transaction } from "../../kernel/database.js";
import { canonical, digest } from "../../kernel/crypto.js";
import { requireThat } from "../../kernel/errors.js";
import type { Schema } from "../content/model.js";
import { resolveSelectedInput, assertSelectedCurrent } from "./prompt-input.js";
import { safeText } from "./input-sources.js";

export async function resolveImage(
  tx: Transaction,
  input: Schema<"PlanInput">,
  capability: Record<string, any>,
) {
  requireThat(
    input.purpose === "image" &&
      !input.assistance &&
      !input.proposalTarget &&
      !input.sourceScriptRevisionId &&
      !input.scriptRange,
    422,
    "IMAGE_INPUT_UNSUPPORTED",
    "单图生成只接收明确的镜头或画布输入。",
  );
  requireThat(
    capability.execution_mode === "test_fixture" &&
      capability.definition.mode === "image_fixture_v1",
    503,
    "IMAGE_CAPABILITY_NOT_EXECUTABLE",
    "所选能力是提示目标描述或尚未接通的真实模型，不能执行图片生成。",
  );
  const drafts = (input.contextSources ?? []).filter(
    (source) => source.kind === "canvas_draft",
  );
  requireThat(
    (input.shotSources?.length ?? 0) > 0 || drafts.length === 1,
    422,
    "IMAGE_SOURCE_REQUIRED",
    "请选择固定镜头版本或一个实际画布草稿。",
  );
  requireThat(
    drafts.length <= 1,
    422,
    "IMAGE_SOURCE_AMBIGUOUS",
    "单次生成只能明确选择一个画布草稿来源。",
  );
  const result = await resolveSelectedInput(tx, input, capability),
    resolved = result.resolved;
  resolved.resolverVersion = "image-generation/1";
  resolved.capabilitySnapshot = resolved.targetCapabilitySnapshot!;
  delete resolved.targetCapabilitySnapshot;
  delete resolved.targetConnectionVersionId;
  const definition = capability.definition as Schema<"Capability">;
  const resolution =
    input.output.resolution ??
    (definition.allowedResolutions?.length === 1
      ? definition.allowedResolutions[0]
      : undefined);
  requireThat(
    resolution &&
      /^\d+x\d+$/.test(resolution) &&
      definition.allowedResolutions?.includes(resolution),
    422,
    "IMAGE_OUTPUT_UNSUPPORTED",
    "请选择当前能力明确支持的图片分辨率。",
  );
  const [width, height] = resolution.split("x").map(Number) as [number, number];
  requireThat(
    width >= 1 &&
      height >= 1 &&
      width <= 8192 &&
      height <= 8192 &&
      width * height <= 4096 * 4096 &&
      !input.output.durationSeconds &&
      !input.output.withAudio,
    422,
    "IMAGE_OUTPUT_UNSUPPORTED",
    "图片输出尺寸或参数不受支持。",
  );
  if (input.output.aspectRatio) {
    const parts = input.output.aspectRatio.split(":").map(Number);
    requireThat(
      parts.length === 2 &&
        parts.every((n) => Number.isSafeInteger(n) && n > 0) &&
        BigInt(width) * BigInt(parts[1]!) ===
          BigInt(height) * BigInt(parts[0]!) &&
        definition.allowedAspectRatios?.includes(input.output.aspectRatio),
      422,
      "IMAGE_OUTPUT_UNSUPPORTED",
      "画幅必须与明确支持的输出尺寸一致。",
    );
  }
  resolved.output = { ...input.output, resolution };
  const paragraphs = [input.prompt];
  if (input.promptPolicy === "append")
    for (const shot of resolved.shots) {
      const { references: _references, ...spec } = shot.spec;
      paragraphs.push(`镜头要求：${canonical(spec)}`);
    }
  for (const snapshot of resolved.contextSnapshots ?? []) {
    if (snapshot.source.kind === "canvas_draft") {
      const draft = JSON.parse(snapshot.text) as {
        kind: string;
        content: {
          prompt: string;
          connectionId?: string;
          capabilityId?: string;
          output: Schema<"OutputOptions">;
        };
        inputs: { content: { type: string; text?: string } }[];
      };
      requireThat(
        draft.kind === "image" &&
          draft.content.connectionId === input.connectionId &&
          draft.content.capabilityId === input.capabilityId &&
          canonical(draft.content.output) === canonical(input.output) &&
          draft.content.prompt === input.prompt,
        422,
        "CANVAS_GENERATION_MISMATCH",
        "画布草稿的模型、提示和输出必须与已保存来源一致。",
      );
      for (const part of draft.inputs)
        if (part.content.type === "text") paragraphs.push(part.content.text!);
    } else paragraphs.push(snapshot.text);
  }
  resolved.prompt = safeText(paragraphs.filter(Boolean).join("\n\n"));
  if (input.assistanceSource) {
    const source = (
      await tx.sql.query(
        "SELECT r.body FROM assistance_artifact_revisions r WHERE tenant_id=$1 AND project_id=$2 AND artifact_id=$3 AND number=$4",
        [
          tx.tenantId,
          tx.projectId,
          input.assistanceSource.artifactId,
          input.assistanceSource.revision,
        ],
      )
    ).rows[0];
    requireThat(
      source,
      404,
      "ASSISTANCE_SOURCE_UNAVAILABLE",
      "选定的建议修订不存在或无访问权限。",
    );
    // Provenance only: never overwrite explicit prompt/references with the saved advice body.
    resolved.assistanceSnapshot = source.body;
  }
  const rules = definition.inputRules ?? [],
    counts = new Map<Schema<"CapabilityInputRule">, number>();
  for (const reference of resolved.references) {
    const media = (
      await tx.sql.query(
        "SELECT kind,mime,bytes,width,height,duration_us FROM media WHERE tenant_id=$1 AND id=$2",
        [tx.tenantId, reference.reference.mediaId],
      )
    ).rows[0];
    const rule = rules.find(
      (rule) =>
        rule.kind === media?.kind &&
        rule.purposes.includes(reference.reference.purpose),
    );
    requireThat(
      rule &&
        rule.mimeTypes.includes(media.mime) &&
        Number(media.bytes) <= rule.maxBytes &&
        (rule.maxDurationUs === undefined ||
          Number(media.duration_us) <= rule.maxDurationUs) &&
        (rule.minWidth === undefined || media.width >= rule.minWidth) &&
        (rule.maxWidth === undefined || media.width <= rule.maxWidth) &&
        (rule.minHeight === undefined || media.height >= rule.minHeight) &&
        (rule.maxHeight === undefined || media.height <= rule.maxHeight),
      422,
      "IMAGE_REFERENCE_UNSUPPORTED",
      "实际参考的类型、用途或文件参数不符合目标能力要求。",
    );
    counts.set(rule, (counts.get(rule) ?? 0) + 1);
  }
  for (const rule of rules)
    requireThat(
      (counts.get(rule) ?? 0) >= rule.minCount &&
        (counts.get(rule) ?? 0) <= rule.maxCount,
      422,
      "IMAGE_REFERENCE_COUNT",
      "实际参考数量不符合能力要求。",
    );
  return result;
}
export async function assertImageCurrent(
  tx: Transaction,
  plan: Record<string, any>,
) {
  await assertSelectedCurrent(tx, plan.resolved_input);
  if (plan.input.assistanceSource)
    requireThat(
      (
        await tx.sql.query(
          "SELECT 1 FROM assistance_artifact_revisions WHERE tenant_id=$1 AND project_id=$2 AND artifact_id=$3 AND number=$4",
          [
            tx.tenantId,
            tx.projectId,
            plan.input.assistanceSource.artifactId,
            plan.input.assistanceSource.revision,
          ],
        )
      ).rowCount,
      409,
      "ASSISTANCE_SOURCE_UNAVAILABLE",
      "明确选择的建议来源已不可访问。",
    );
}

export async function recordImageOrigin(
  tx: Transaction,
  planId: string,
  resolved: Schema<"ResolvedInput">,
) {
  const context = resolved.contextSnapshots?.find(
    (s) => s.source.kind === "canvas_draft",
  );
  if (!context) return;
  const canvas = (
    await tx.sql.query(
      "SELECT canvas_id FROM canvas_node_index WHERE tenant_id=$1 AND project_id=$2 AND node_id=$3",
      [tx.tenantId, tx.projectId, context.source.objectId],
    )
  ).rows[0];
  requireThat(
    canvas,
    404,
    "CANVAS_CONTEXT_UNAVAILABLE",
    "明确选择的草稿身份不存在。",
  );
  const semantic = JSON.parse(context.text) as {
    inputs: { sourceNodeId: string }[];
  };
  const fingerprint = digest(
    canonical({
      prompt: resolved.prompt,
      output: resolved.output,
      capability: resolved.capabilitySnapshot,
      shots: resolved.shots,
      references: resolved.references,
      contexts: (resolved.contextSnapshots ?? []).map((s) => ({
        kind: s.source.kind,
        objectId: s.source.objectId,
        contentHash: s.source.contentHash,
      })),
      canvas: semantic,
    }),
  );
  await tx.sql.query(
    "INSERT INTO generation_canvas_origins(tenant_id,project_id,plan_id,canvas_id,node_id,canvas_revision,input_fingerprint,source_node_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      tx.tenantId,
      tx.projectId,
      planId,
      canvas.canvas_id,
      context.source.objectId,
      context.source.revision,
      fingerprint,
      semantic.inputs.map((input) => input.sourceNodeId),
    ],
  );
}

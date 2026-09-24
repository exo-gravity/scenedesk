import { audioShotSources, validateAudioVoices } from "./audio-sources.js";
import type { Transaction } from "../../kernel/database.js";
import { canonical, digest } from "../../kernel/crypto.js";
import { requireThat } from "../../kernel/errors.js";
import type { Schema } from "../content/model.js";
import { resolveSelectedInput, assertSelectedCurrent } from "./prompt-input.js";
import { safeText } from "./input-sources.js";
import { findProfile } from "@drama/provider";
import { supportsVisualOutput } from "@drama/domain";

export async function resolveMedia(
  tx: Transaction,
  input: Schema<"PlanInput">,
  capability: Record<string, any>,
) {
  const kind = input.purpose;
  requireThat(
    ["image", "video", "audio"].includes(kind) &&
      !input.assistance &&
      !input.proposalTarget &&
      !input.sourceScriptRevisionId &&
      !input.scriptRange,
    422,
    "IMAGE_INPUT_UNSUPPORTED",
    "媒体生成只接收明确的镜头或画布输入。",
  );
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
  const result = await resolveSelectedInput(
      tx,
      input,
      capability,
      kind === "audio" ? audioShotSources : undefined,
    ),
    resolved = result.resolved;
  resolved.resolverVersion = `${kind}-generation/1`;
  resolved.capabilitySnapshot = resolved.targetCapabilitySnapshot!;
  delete resolved.targetCapabilitySnapshot;
  delete resolved.targetConnectionVersionId;
  const definition = capability.definition as Schema<"Capability">;
  if (kind === "audio") {
    requireThat(
      input.output.resolution === undefined &&
        input.output.aspectRatio === undefined &&
        input.output.withAudio === undefined,
      422,
      "AUDIO_OUTPUT_UNSUPPORTED",
      "独立音频只接收时长和可选种子，不接收画面或视频音轨选项。",
    );
    const duration = input.output.durationSeconds;
    requireThat(
      Number.isSafeInteger(duration) &&
        duration! > 0 &&
        duration! <= 7200 &&
        definition.minDurationSeconds !== undefined &&
        definition.maxDurationSeconds !== undefined &&
        duration! >= definition.minDurationSeconds &&
        duration! <= definition.maxDurationSeconds,
      422,
      "AUDIO_DURATION_UNSUPPORTED",
      "请选择能力明确支持的整数秒音频时长。",
    );
    resolved.output = { ...input.output };
  } else {
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
      "请选择当前能力明确支持的输出分辨率。",
    );
    const [width, height] = resolution.split("x").map(Number) as [
      number,
      number,
    ];
    requireThat(
      width >= 1 &&
        height >= 1 &&
        width <= 8192 &&
        height <= 8192 &&
        width * height <= 4096 * 4096 &&
        (kind === "video" ||
          (!input.output.durationSeconds && !input.output.withAudio)),
      422,
      "IMAGE_OUTPUT_UNSUPPORTED",
      "输出尺寸或参数不受支持。",
    );
    requireThat(
      supportsVisualOutput(definition, resolution, input.output.aspectRatio),
      422,
      "IMAGE_OUTPUT_UNSUPPORTED",
      "画幅必须与明确支持的输出尺寸一致。",
    );
    if (kind === "video") {
      const duration = input.output.durationSeconds;
      requireThat(
        Number.isSafeInteger(duration) &&
          duration! > 0 &&
          duration! <= 7200 &&
          definition.minDurationSeconds !== undefined &&
          definition.maxDurationSeconds !== undefined &&
          duration! >= definition.minDurationSeconds &&
          duration! <= definition.maxDurationSeconds,
        422,
        "VIDEO_DURATION_UNSUPPORTED",
        "请选择能力明确支持的整数秒视频时长。",
      );
      requireThat(
        !input.output.withAudio || definition.audioOutput === true,
        422,
        "VIDEO_AUDIO_UNSUPPORTED",
        "所选能力不支持输出原生音频。",
      );
    }
    resolved.output = {
      ...input.output,
      resolution,
      ...(kind === "video"
        ? { withAudio: input.output.withAudio ?? false }
        : {}),
    };
  }
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
        draft.kind === kind &&
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
        "SELECT r.body FROM assistance_artifact_revisions r JOIN assistance_artifacts a ON a.id=r.artifact_id JOIN generation_jobs j ON j.id=a.generation_job_id JOIN generation_plans p ON p.id=j.plan_id WHERE r.tenant_id=$1 AND r.project_id=$2 AND r.artifact_id=$3 AND r.number=$4 AND p.input->'assistance'->>'kind' IN ('prepare_prompt','prepare_rework')",
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
  if (kind === "audio") await validateAudioVoices(tx, resolved);
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
export async function assertMediaCurrent(
  tx: Transaction,
  plan: Record<string, any>,
) {
  await assertSelectedCurrent(tx, plan.resolved_input);
  if (plan.input.assistanceSource)
    requireThat(
      (
        await tx.sql.query(
          "SELECT 1 FROM assistance_artifact_revisions r JOIN assistance_artifacts a ON a.id=r.artifact_id JOIN generation_jobs j ON j.id=a.generation_job_id JOIN generation_plans p ON p.id=j.plan_id WHERE r.tenant_id=$1 AND r.project_id=$2 AND r.artifact_id=$3 AND r.number=$4 AND p.input->'assistance'->>'kind' IN ('prepare_prompt','prepare_rework')",
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

export async function recordMediaOrigin(
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

import type { AssistanceSubmission, AssistanceSubmissionReceipt } from "../assistance.js";
import { findProfile, resolveOutput, VerifiedProfileError, type ModelProfile, type OutputTarget, type ProfileMode, type Vendor } from "./profiles.js";
import { dataUri, loadMediaBytes, referenceLegend, referenceRoles, VerifiedInputError, type ByteStore, type MediaResolver, type ReferenceRole } from "./inputs.js";
import type { ArchiveStore } from "./outputs.js";

export type VerifiedDeps = { store: ArchiveStore & ByteStore; resolveMedia: MediaResolver; fetch: typeof fetch; tmpdir: string };
export type PreparedSubmission = {
  profile: ModelProfile; mode: ProfileMode; size: string; target: OutputTarget;
  durationSeconds?: number; withAudio: boolean; prompt: string; legend: string;
  images: { role: ReferenceRole; index: number; purpose: string; dataUri: string }[];
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
    budget += Math.ceil((row.bytes * 4) / 3);
    if (budget > REQUEST_BUDGET) throw new VerifiedInputError("INPUT_TOO_LARGE");
    const bytes = await loadMediaBytes(deps.store, deps.tmpdir, row, signal);
    images.push({ role: item.role, index: item.index, purpose: item.purpose, dataUri: dataUri(row.mime, bytes) });
  }
  return {
    profile, mode, size, target, prompt: submission.resolvedInput.prompt, legend: referenceLegend(mapped), images,
    ...(output.durationSeconds !== undefined ? { durationSeconds: output.durationSeconds } : {}), withAudio: output.withAudio === true,
  };
}
/** Deterministic preparation problems are rejections; anything else stays unknown. */
export function rejectedFrom(error: unknown, correlation: string): AssistanceSubmissionReceipt | undefined {
  if (error instanceof VerifiedInputError || error instanceof VerifiedProfileError) return { kind: "rejected", correlation, code: error.code };
  return undefined;
}

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

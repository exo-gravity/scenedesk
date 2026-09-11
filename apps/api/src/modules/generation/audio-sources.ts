import type { Transaction } from "../../kernel/database.js";
import { requireThat } from "../../kernel/errors.js";
import type { Schema } from "../content/model.js";
import { resolveContext } from "./input-sources.js";

/** Expand only explicit fixed voice/character versions; an identity alone never selects its latest voice. */
export async function audioShotSources(
  tx: Transaction,
  shots: Schema<"ResolvedShotInput">[],
  contexts: Schema<"ContextSnapshot">[],
) {
  const snapshots: Schema<"ContextSnapshot">[] = [],
    references: Schema<"ResolvedReference">[] = [],
    cache = new Map<string, Record<string, any>>(),
    emitted = new Set<string>();
  const fixed = async (id: string, kind: "voice" | "character") => {
    const key = id.toLowerCase();
    let row = cache.get(key);
    if (!row) {
      row = (
        await tx.sql.query(
          "SELECT r.*,a.kind FROM asset_revisions r JOIN assets a ON a.id=r.asset_id WHERE r.tenant_id=$1 AND r.id=$2 AND asset_revision_usable($1,$3,r.id,false)",
          [tx.tenantId, key, tx.projectId],
        )
      ).rows[0];
      requireThat(
        row,
        422,
        "AUDIO_VOICE_UNAVAILABLE",
        "所选固定声音或角色版本不可用，不能换成当前版本。",
      );
      cache.set(key, row);
    }
    requireThat(
      row.kind === kind,
      422,
      "AUDIO_VOICE_SOURCE_MISMATCH",
      "固定声音来源必须是声音资产，角色默认声音必须来自明确的角色修订。",
    );
    if (!snapshots.some((s) => s.source.objectId === key))
      snapshots.push(
        await resolveContext(
          tx,
          {
            kind: "asset_revision",
            objectId: key,
            revision: Number(row.revision),
          },
          true,
        ),
      );
    return row;
  };
  type Origin = Pick<
    Schema<"ResolvedReference">,
    "sourceLevel" | "sourceObjectId" | "shotId"
  >;
  const voice = async (id: string, origin: Origin, subjectAssetId?: string) => {
    const row = await fixed(id, "voice"),
      key = `${row.id}:${origin.shotId ?? origin.sourceObjectId}:${subjectAssetId ?? ""}`;
    if (emitted.has(key)) return;
    emitted.add(key);
    for (const reference of row.definition.references as Schema<"Reference">[])
      references.push({
        ...origin,
        reference: {
          ...reference,
          assetRevisionId: row.id,
          ...(subjectAssetId ? { subjectAssetId } : {}),
        },
      });
  };
  const character = async (
    state: Schema<"CharacterState">,
    origin: Origin,
    hasExplicitLineVoice: boolean,
  ) => {
    if (state.voiceAssetRevisionId)
      await voice(state.voiceAssetRevisionId, origin, state.characterAssetId);
    else if (!hasExplicitLineVoice && state.lookAssetRevisionId) {
      const row = await fixed(state.lookAssetRevisionId, "character");
      if (row.definition.defaultVoiceAssetRevisionId)
        await voice(
          row.definition.defaultVoiceAssetRevisionId,
          origin,
          state.characterAssetId,
        );
    }
  };
  for (const shot of shots) {
    const origin: Origin = {
      sourceLevel: "shot",
      sourceObjectId: shot.shotRevisionId,
      shotId: shot.shotId,
    };
    for (const line of shot.spec.dialogue ?? [])
      if (line.voiceAssetRevisionId)
        await voice(line.voiceAssetRevisionId, origin, line.characterAssetId);
    for (const state of [shot.entryState, shot.exitState])
      for (const person of state.characters ?? [])
        await character(
          person,
          origin,
          (shot.spec.dialogue ?? []).some(
            (line) =>
              line.characterAssetId === person.characterAssetId &&
              !!line.voiceAssetRevisionId,
          ),
        );
  }
  for (const context of contexts) {
    const origin: Origin = {
      sourceLevel: context.source.kind === "scene" ? "scene" : "attempt",
      sourceObjectId: context.source.objectId,
    };
    if (context.source.kind === "asset_revision") {
      const row = (
        await tx.sql.query(
          "SELECT r.definition,a.kind FROM asset_revisions r JOIN assets a ON a.id=r.asset_id WHERE r.tenant_id=$1 AND r.id=$2",
          [tx.tenantId, context.source.objectId],
        )
      ).rows[0];
      if (row?.kind === "voice") await voice(context.source.objectId, origin);
      else if (
        row?.kind === "character" &&
        row.definition.defaultVoiceAssetRevisionId
      ) {
        await fixed(context.source.objectId, "character");
        await voice(row.definition.defaultVoiceAssetRevisionId, origin);
      }
    } else if (context.source.kind === "scene") {
      const scene = JSON.parse(context.text) as {
        state?: Schema<"ContinuityState">;
      };
      for (const person of scene.state?.characters ?? [])
        await character(person, origin, false);
    }
  }
  return { references, snapshots };
}

export async function validateAudioVoices(
  tx: Transaction,
  resolved: Schema<"ResolvedInput">,
) {
  for (const item of resolved.references)
    if (item.reference.purpose === "voice" && item.reference.assetRevisionId) {
      const source = (
        await tx.sql.query(
          "SELECT a.kind FROM asset_revisions r JOIN assets a ON a.id=r.asset_id WHERE r.tenant_id=$1 AND r.id=$2",
          [tx.tenantId, item.reference.assetRevisionId],
        )
      ).rows[0];
      requireThat(
        source?.kind === "voice",
        422,
        "AUDIO_VOICE_SOURCE_MISMATCH",
        "声音用途的固定资产引用必须来自真实声音资产版本。",
      );
    }
}

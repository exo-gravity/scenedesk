import type { components } from "@drama/contracts";
import type { Transaction } from "../../kernel/database.js";
import { bindResourceProject, record } from "../../kernel/database.js";
import { requireThat } from "../../kernel/errors.js";
import type { Input } from "../../kernel/routes.js";
export type Schema<T extends keyof components["schemas"]> =
  components["schemas"][T];

export function assetRecord<T>(row: Record<string, any>): T {
  const {
    tenant_id: _tenant,
    confirmed_by: _confirmation,
    imported_by: _importer,
    ...values
  } = row;
  for (const [key, value] of Object.entries(values)) {
    if (value === null) delete values[key];
    else if (key === "number") values[key] = Number(value);
  }
  return record<T>(values);
}
export async function findAsset(tx: Transaction, id: string) {
  const found = await tx.sql.query(
    "SELECT * FROM assets WHERE tenant_id=$1 AND id=$2",
    [tx.tenantId, id],
  );
  requireThat(found.rows[0], 404, "NOT_FOUND", "资产不存在或无访问权限。");
  return found.rows[0] as Record<string, any>;
}
export async function findRevision(
  tx: Transaction,
  assetId: string | undefined,
  id: string,
) {
  const found = await tx.sql.query(
    "SELECT * FROM asset_revisions WHERE tenant_id=$1 AND ($2::uuid IS NULL OR asset_id=$2) AND id=$3",
    [tx.tenantId, assetId ?? null, id],
  );
  requireThat(
    found.rows[0],
    404,
    "NOT_FOUND",
    "资产版本不存在或不属于当前资产。",
  );
  return found.rows[0] as Record<string, any>;
}
export function assetScope(
  root: "input" | "list" | "asset" | "revision",
  write: boolean,
) {
  return async (tx: Transaction, input: Input) => {
    const source =
      root === "revision"
        ? await findAsset(
            tx,
            (await findRevision(tx, undefined, input.params.revisionId!))
              .asset_id,
          )
        : root === "asset"
          ? await findAsset(tx, input.params.assetId!)
          : root === "input"
            ? input.body
            : input.query;
    const projectId = (source.project_id ?? source.projectId)?.toLowerCase();
    requireThat(
      !(source.scope === "shared" && projectId),
      422,
      "INVALID_ASSET_SCOPE",
      "共享资产不能指定私有项目。",
    );
    if (projectId) await bindResourceProject(tx, projectId, write);
    else tx.resourceScope = source.scope === "shared" ? "shared" : "all";
  };
}
export function assetText(
  value: string,
  label: string,
  max: number,
  empty = false,
) {
  requireThat(
    (empty || value.trim()) &&
      Array.from(value).length <= max &&
      !Array.from(value).some(
        (c) =>
          c === "\0" ||
          (c.codePointAt(0)! >= 0xd800 && c.codePointAt(0)! <= 0xdfff),
      ),
    422,
    "INVALID_ASSET_TEXT",
    `${label}包含无效内容。`,
  );
  return value.normalize("NFC");
}
export function assetTags(values: string[]) {
  requireThat(
    values.length <= 50,
    422,
    "TOO_MANY_TAGS",
    "每项资产最多 50 个标签。",
  );
  return [
    ...new Set(values.map((value) => assetText(value, "标签", 160).trim())),
  ];
}
/** Canonical UUID spelling makes unchanged references and look identities comparable. */
export function definitionInput(
  input: Schema<"AssetDefinition">,
  kind: string,
): Schema<"AssetDefinition"> {
  const references = (values: Schema<"Reference">[]) =>
    values.map((ref) => ({
      mediaId: ref.mediaId.toLowerCase(),
      purpose: ref.purpose,
      ...(ref.assetRevisionId
        ? { assetRevisionId: ref.assetRevisionId.toLowerCase() }
        : {}),
      ...(ref.subjectAssetId
        ? { subjectAssetId: ref.subjectAssetId.toLowerCase() }
        : {}),
      ...(ref.note !== undefined
        ? { note: assetText(ref.note, "参考说明", 20000, true) }
        : {}),
    }));
  const looks = (input.looks ?? []).map((look) => ({
    ...look,
    id: look.id.toLowerCase(),
    label: assetText(look.label, "造型名称", 160),
    references: references(look.references),
  }));
  requireThat(
    looks.length <= 100 &&
      new Set(looks.map((look) => look.id)).size === looks.length,
    422,
    "INVALID_CHARACTER_LOOKS",
    "造型标识不能重复，每个版本最多 100 种造型。",
  );
  requireThat(
    kind === "character" ||
      (!looks.length && !input.defaultVoiceAssetRevisionId),
    422,
    "CHARACTER_DEFINITION_REQUIRED",
    "只有角色资产可以包含造型和默认声音。",
  );
  requireThat(
    input.references.length +
      looks.reduce((count, look) => count + look.references.length, 0) <=
      200,
    422,
    "TOO_MANY_REFERENCES",
    "每个固定版本最多 200 项媒体参考。",
  );
  const result = {
    description: assetText(input.description, "固定设定说明", 20000, true),
    references: references(input.references),
    ...(input.looks ? { looks } : {}),
    ...(input.voiceDescription !== undefined
      ? {
          voiceDescription: assetText(
            input.voiceDescription,
            "声音说明",
            20000,
            true,
          ),
        }
      : {}),
    ...(input.defaultVoiceAssetRevisionId
      ? {
          defaultVoiceAssetRevisionId:
            input.defaultVoiceAssetRevisionId.toLowerCase(),
        }
      : {}),
  };
  requireThat(
    Buffer.byteLength(JSON.stringify(result)) <= 1024 * 1024,
    422,
    "ASSET_DEFINITION_TOO_LARGE",
    "固定设定内容超过 1 MiB。",
  );
  return result;
}

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

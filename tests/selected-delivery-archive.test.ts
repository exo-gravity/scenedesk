import { test } from "node:test";
import assert from "node:assert/strict";
import { access, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  prepareDeliveryArchive,
  deliveryCsv,
} from "../apps/api/src/modules/candidates/selected-delivery-archive.js";
import type { DeliverySnapshot } from "../apps/api/src/modules/candidates/selected-delivery-model.js";

function snapshot(): DeliverySnapshot {
  const entry = {
    order: 1,
    shotId: randomUUID(),
    shotLabel: "镜头,一",
    shotRevisionId: randomUUID(),
    intent: '\t=HYPERLINK("synthetic")',
    selectionId: randomUUID(),
    selectionReason: "  +2",
    takeId: randomUUID(),
    takeNote: '引号"与\n换行',
    mediaId: randomUUID(),
    fileName: "001_synthetic.mp4",
    originalFileName: "合成.mp4",
    bytes: 10,
    sha256: "a".repeat(64),
    range: { inUs: 250001, outUs: 1000001 },
  };
  return {
    manifest: {
      format: "scenedesk_selected_originals_v1",
      projectId: randomUUID(),
      projectName: "测试项目",
      sceneId: randomUUID(),
      sceneTitle: "测试场次",
      episodeTitle: "测试集",
      entries: [entry],
      unselectedCount: 0,
      archivedCount: 0,
      totalBytes: 10,
    },
    sources: [
      {
        key: `originals/${entry.mediaId}`,
        versionId: "synthetic-v1",
        bytes: 10,
        sha256: entry.sha256,
        fileName: entry.fileName,
      },
    ],
  };
}
test("handoff CSV retains exact integers and protects formula cells and embedded quotes", () => {
  const csv = deliveryCsv(snapshot().manifest);
  assert.ok(csv.includes('"250001","1000001"'));
  assert.ok(csv.includes('"\'\t=HYPERLINK(""synthetic"")"'));
  assert.ok(csv.includes('"\'  +2"'));
  assert.ok(csv.includes('"镜头,一"'));
  assert.ok(csv.includes('"引号""与\n换行"'));
});
test("archive write errors close source streams and remove the entire temporary directory", async () => {
  let sourcePath = "";
  await assert.rejects(
    prepareDeliveryArchive(
      snapshot(),
      {
        async download(_source, path) {
          sourcePath = path;
          await writeFile(path, "too short", { flag: "wx" });
        },
      },
      new AbortController().signal,
    ),
    /unexpected number of bytes/,
  );
  await assert.rejects(access(dirname(sourcePath)));
});
test("aborting a source download removes any partial data and never returns an archive", async () => {
  const controller = new AbortController();
  let sourcePath = "";
  await assert.rejects(
    prepareDeliveryArchive(
      snapshot(),
      {
        async download(_source, path, _sha, signal) {
          sourcePath = path;
          await writeFile(path, "partial", { flag: "wx" });
          controller.abort();
          signal!.throwIfAborted();
        },
      },
      controller.signal,
    ),
  );
  await assert.rejects(access(dirname(sourcePath)));
});

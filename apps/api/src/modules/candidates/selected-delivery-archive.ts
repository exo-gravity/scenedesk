import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finished, pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { ZipFile } from "yazl";
import type { MediaStore } from "@drama/media";
import type { Schema } from "../content/model.js";
import type { DeliverySnapshot } from "./selected-delivery-model.js";

function csvCell(value: unknown) {
  let text = String(value);
  // Spreadsheet programs may execute formulas even in quoted CSV cells.
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function deliveryCsv(manifest: Schema<"SelectedDeliveryManifest">) {
  const rows: unknown[][] = [
    [
      "顺序",
      "镜头",
      "镜头说明",
      "文件",
      "原文件名",
      "入点（微秒）",
      "出点（微秒）",
      "候选说明",
      "选用理由",
      "镜头ID",
      "固定镜头要求ID",
      "选用ID",
      "候选ID",
      "媒体ID",
      "SHA256",
    ],
  ];
  for (const item of manifest.entries)
    rows.push([
      item.order,
      item.shotLabel,
      item.intent,
      `originals/${item.fileName}`,
      item.originalFileName,
      item.range.inUs,
      item.range.outUs,
      item.takeNote,
      item.selectionReason,
      item.shotId,
      item.shotRevisionId,
      item.selectionId,
      item.takeId,
      item.mediaId,
      item.sha256,
    ]);
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** No HTTP response is sent until every fixed original and the archive are complete. */
export async function prepareDeliveryArchive(
  snapshot: DeliverySnapshot,
  store: Pick<MediaStore, "download">,
  signal: AbortSignal,
) {
  const directory = await mkdtemp(join(tmpdir(), "scenedesk-selected-"));
  const cleanup = () =>
    rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  try {
    for (const source of snapshot.sources) {
      signal.throwIfAborted();
      await store.download(
        source,
        join(directory, source.fileName),
        source.sha256,
        signal,
      );
    }
    signal.throwIfAborted();
    const zip = new ZipFile(),
      path = join(directory, "selected-originals.zip");
    const inputs = new Set<Readable>(),
      closed: Promise<unknown>[] = [];
    let failed = false;
    zip.on("error", (error) => {
      failed = true;
      for (const input of inputs) input.destroy(error);
      (zip.outputStream as Readable).destroy(error);
    });
    const abort = () =>
      zip.emit("error", new Error("Archive preparation cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    const output = pipeline(
      zip.outputStream,
      createWriteStream(path, { flags: "wx", mode: 0o600 }),
      { signal },
    );
    // Mark rejections handled even while addBuffer/addReadStreamLazy is running.
    void output.catch(() => {});
    try {
      zip.addBuffer(
        Buffer.from(JSON.stringify(snapshot.manifest, null, 2) + "\n"),
        "manifest.json",
      );
      zip.addBuffer(Buffer.from(deliveryCsv(snapshot.manifest)), "shots.csv");
      zip.addBuffer(
        Buffer.from(
          "SceneDesk 镜头交接\n\noriginals/ 内为完整原视频，未经裁剪、转码或渲染。\nshots.csv 的顺序、镜头说明和入出点对应本次明确选用；时间以整数微秒保存。\nmanifest.json 保存固定 Selection / Take / Media、镜头要求与文件 SHA-256。\n预览其他候选不改变选用，后续选用变化不会改写本包。\n未选用或已归档镜头不在本包中，数量见 manifest.json。\n",
        ),
        "README.txt",
      );
      for (const source of snapshot.sources)
        zip.addReadStreamLazy(
          `originals/${source.fileName}`,
          { compress: false, size: source.bytes },
          (callback) => {
            if (failed || signal.aborted)
              return callback(
                new Error("Archive preparation cancelled"),
                undefined as unknown as Readable,
              );
            const input = createReadStream(join(directory, source.fileName), {
              signal,
            });
            inputs.add(input);
            input.on("error", (error) => zip.emit("error", error));
            input.once("close", () => inputs.delete(input));
            closed.push(finished(input, { cleanup: true }).catch(() => {}));
            callback(null, input);
          },
        );
      zip.end();
      await output;
    } finally {
      signal.removeEventListener("abort", abort);
      for (const input of inputs) input.destroy();
      (zip.outputStream as Readable).destroy();
      await output.catch(() => {});
      await Promise.all(closed);
    }
    const bytes = (await stat(path)).size;
    return {
      path,
      bytes,
      cleanup,
      stream: (transferSignal: AbortSignal) =>
        createReadStream(path, { signal: transferSignal }),
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

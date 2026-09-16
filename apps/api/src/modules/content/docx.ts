import { createHash } from "node:crypto";
import path from "node:path";
import yauzl from "yauzl";
import { SaxesParser } from "saxes";
import { requireThat, Problem } from "../../kernel/errors.js";
import type { Schema } from "./model.js";

const MAX_FILE = 4 * 1024 * 1024;
const MAX_EXPANDED = 20 * 1024 * 1024;
type Xml = {
  name: string;
  attrs: Record<string, string>;
  children: (Xml | string)[];
};
const invalid = (message: string) => new Problem(422, "INVALID_DOCX", message);
function xml(data: Buffer): Xml {
  if (data.length > 8 * 1024 * 1024)
    throw invalid("Word 正文结构过大，请拆分文件。");
  const root: Xml = { name: "root", attrs: {}, children: [] },
    stack = [root];
  let count = 0;
  const parser = new SaxesParser({ xmlns: false });
  parser.on("doctype", () => {
    throw invalid("不支持带外部实体或 DTD 的 Word 文件。");
  });
  parser.on("opentag", (tag) => {
    if (++count > 100000 || stack.length > 64)
      throw invalid("Word 结构过于复杂，请简化后重试。");
    const node: Xml = {
      name: tag.name,
      attrs: tag.attributes as Record<string, string>,
      children: [],
    };
    stack.at(-1)!.children.push(node);
    stack.push(node);
  });
  parser.on("text", (text) => stack.at(-1)!.children.push(text));
  parser.on("closetag", () => {
    stack.pop();
  });
  try {
    parser
      .write(new TextDecoder("utf-8", { fatal: true }).decode(data))
      .close();
  } catch (error) {
    if (error instanceof Problem) throw error;
    throw invalid("Word XML 正文损坏或编码不受支持。");
  }
  return root;
}
function children(node: Xml, name?: string): Xml[] {
  return node.children.filter(
    (c): c is Xml => typeof c !== "string" && (!name || c.name === name),
  );
}
function descendants(node: Xml, name: string, omitDeleted = false): Xml[] {
  return children(node).flatMap((c) =>
    omitDeleted && c.name === "w:del"
      ? []
      : [...(c.name === name ? [c] : []), ...descendants(c, name, omitDeleted)],
  );
}
function textOf(node: Xml): string {
  if (["w:del", "w:instrText"].includes(node.name)) return "";
  if (node.name === "w:t")
    return node.children.filter((c) => typeof c === "string").join("");
  if (node.name === "w:tab") return "\t";
  if (["w:br", "w:cr"].includes(node.name)) return "\n";
  return children(node).map(textOf).join("");
}
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function rasterMime(bytes: Buffer): "png" | "jpeg" | undefined {
  const allowed = (width: number, height: number) =>
    width > 0 &&
    height > 0 &&
    width <= 8192 &&
    height <= 8192 &&
    width * height <= 16000000;
  if (
    bytes.length >= 33 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR"
  ) {
    if (!allowed(bytes.readUInt32BE(16), bytes.readUInt32BE(20))) return;
    let offset = 8,
      hasData = false,
      ended = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset),
        kind = bytes.toString("ascii", offset + 4, offset + 8);
      if (
        length > bytes.length - offset - 12 ||
        crc32(bytes.subarray(offset + 4, offset + 8 + length)) !==
          bytes.readUInt32BE(offset + 8 + length)
      )
        return;
      if (kind === "IHDR" && offset !== 8) return;
      if (kind === "acTL") return; // Animated frames could multiply the decoded memory bound.
      if (kind === "IDAT") hasData = true;
      offset += length + 12;
      if (kind === "IEND") {
        ended = true;
        break;
      }
    }
    return hasData && ended && offset === bytes.length ? "png" : undefined;
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes.at(-2) === 255 &&
    bytes.at(-1) === 217
  ) {
    let offset = 2,
      dimensions = false;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) return;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217) return;
      if (offset + 2 > bytes.length) return;
      if (
        marker === 1 ||
        (marker !== undefined && marker >= 208 && marker <= 215)
      )
        continue;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || length > bytes.length - offset) return;
      if (marker === 218)
        return dimensions && length >= 6 && offset + length < bytes.length - 2
          ? "jpeg"
          : undefined;
      if ([192, 193, 194].includes(marker ?? 0)) {
        if (
          dimensions ||
          length < 8 ||
          length !== 8 + 3 * bytes[offset + 7]! ||
          bytes[offset + 2] !== 8
        )
          return;
        if (
          !allowed(
            bytes.readUInt16BE(offset + 5),
            bytes.readUInt16BE(offset + 3),
          )
        )
          return;
        dimensions = true;
      }
      offset += length;
    }
  }
  return;
}
async function unzip(buffer: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip)
          return reject(invalid("文件不是有效的 .docx 压缩包。"));
        const files = new Map<string, Buffer>();
        let expanded = 0,
          count = 0,
          settled = false;
        const fail = (error: unknown) => {
          if (!settled) {
            settled = true;
            zip.close();
            reject(
              error instanceof Problem ? error : invalid("Word 压缩包已损坏。"),
            );
          }
        };
        zip.on("error", fail);
        zip.on("end", () => {
          if (!settled) {
            settled = true;
            resolve(files);
          }
        });
        zip.on("entry", (entry) => {
          if (
            ++count > 500 ||
            entry.uncompressedSize > MAX_EXPANDED ||
            entry.generalPurposeBitFlag & 1 ||
            /(^\/|\\|(^|\/)\.\.(\/|$))/.test(entry.fileName) ||
            /vbaProject\.bin$/i.test(entry.fileName)
          )
            return fail(invalid("Word 包含不支持的加密、宏、路径或过多附件。"));
          if (files.has(entry.fileName))
            return fail(invalid("Word 压缩包中有重复条目。"));
          // Read every entry through a bounded stream: declared ZIP sizes alone are not trusted.
          zip.openReadStream(entry, (error, stream) => {
            if (error || !stream) return fail(error);
            const chunks: Buffer[] = [];
            let size = 0;
            stream.on("data", (chunk: Buffer) => {
              size += chunk.length;
              expanded += chunk.length;
              if (expanded > MAX_EXPANDED) {
                stream.destroy();
                fail(
                  invalid("Word 解压内容超过 20 MB，请减少附件或拆分文件。"),
                );
              } else chunks.push(chunk);
            });
            stream.on("error", fail);
            stream.on("end", () => {
              if (settled) return;
              files.set(entry.fileName, Buffer.concat(chunks, size));
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    );
  });
}
export async function parseScriptDocument(
  file: Schema<"ScriptDocumentFile">,
): Promise<Schema<"ScriptDocumentPreview"> & { original: Buffer }> {
  requireThat(
    /\.docx$/i.test(file.fileName) && !/[\x00-\x1f\/\\]/.test(file.fileName),
    422,
    "INVALID_DOCX_NAME",
    "请选择 .docx 文件，文件名不能含路径或控制字符。",
  );
  const original = Buffer.from(file.data, "base64");
  requireThat(
    original.length > 0 &&
      original.length <= MAX_FILE &&
      original.toString("base64") === file.data,
    413,
    "DOCX_SIZE_LIMIT",
    "Word 原件须为有效编码且不超过 4 MB。",
  );
  const files = await unzip(original);
  const document = files.get("word/document.xml");
  requireThat(
    document && files.has("[Content_Types].xml"),
    422,
    "INVALID_DOCX",
    "缺少 Word 正文，请导出为标准 .docx 后重试。",
  );
  const tree = xml(document),
    body = descendants(tree, "w:body")[0];
  requireThat(body, 422, "INVALID_DOCX", "Word 文件没有可读取的正文。");
  const blocks: Schema<"ScriptDocumentBlock">[] = [],
    warnings = new Set<string>([
      "阅读版保留标题、段落和表格文字；字体、分页与精确排版请以 Word 原件为准。",
    ]);
  const relationships = files.get("word/_rels/document.xml.rels");
  const relations = relationships
    ? descendants(xml(relationships), "Relationship")
    : [];
  let imageBytes = 0;
  function paragraph(p: Xml) {
    const text = textOf(p),
      style = descendants(p, "w:pStyle")[0]?.attrs["w:val"] ?? "";
    const heading = /^(?:Heading|标题)\s*([1-6])$/i.exec(style),
      outline = descendants(p, "w:outlineLvl")[0]?.attrs["w:val"];
    const level = heading
      ? Number(heading[1])
      : outline && /^[0-5]$/.test(outline)
        ? Number(outline) + 1
        : undefined;
    blocks.push({
      kind: level ? "heading" : "paragraph",
      text,
      ...(level ? { level } : {}),
    });
    for (const image of descendants(p, "a:blip", true)) {
      const relation = relations.find(
        (r) => r.attrs.Id === image.attrs["r:embed"],
      );
      const target = relation?.attrs.Target;
      const name = target
        ? path.posix.normalize(path.posix.join("word", target))
        : "";
      const bytes =
        relation?.attrs.TargetMode !== "External" &&
        name.startsWith("word/media/")
          ? files.get(name)
          : undefined;
      // Only raster originals with a small bounded payload are embedded. SVG/OLE/remote images never execute.
      const mime =
        bytes && bytes.length <= 1024 * 1024 ? rasterMime(bytes) : undefined;
      if (bytes && mime && imageBytes + bytes.length <= 3 * 1024 * 1024) {
        imageBytes += bytes.length;
        blocks.push({
          kind: "image",
          text: "[文档图片]",
          alt: "Word 原文中的图片",
          imageData: `data:image/${mime};base64,${bytes.toString("base64")}`,
        });
      } else {
        blocks.push({ kind: "paragraph", text: "[图片未展开，请查阅原件]" });
        warnings.add(
          "部分图片为外部链接、不支持的格式或超过大小限制；请下载原件核对。支持内嵌 PNG/JPEG，每张 ≤1 MB、边长 ≤8192、≤1600 万像素，总计 ≤3 MB。损坏或动画图片不展开。",
        );
      }
    }
    if (
      descendants(p, "w:drawing", true).some(
        (drawing) => !descendants(drawing, "a:blip", true).length,
      )
    ) {
      blocks.push({
        kind: "paragraph",
        text: "[图表或绘图对象未展开，请查阅原件]",
      });
      warnings.add("部分图表、文本框或绘图对象未展开，请查阅原件核对。");
    }
  }
  function render(node: Xml) {
    if (node.name === "w:p") paragraph(node);
    else if (node.name === "w:tbl") {
      const rows = children(node, "w:tr").map((row) =>
        children(row, "w:tc").map((cell) =>
          children(cell, "w:p").map(textOf).join("\n"),
        ),
      );
      blocks.push({
        kind: "table",
        text: rows.map((row) => row.join("\t")).join("\n"),
        rows,
      });
      if (
        descendants(node, "w:tbl").length ||
        descendants(node, "a:blip").length
      )
        warnings.add(
          "表格内嵌表格或图片未展开，请查阅原件；普通表格文字已保留。",
        );
      if (
        descendants(node, "w:vMerge").length ||
        descendants(node, "w:gridSpan").length
      )
        warnings.add("合并单元格按文字顺序展示，版式请以原件为准。");
    } else if (node.name !== "w:sectPr") {
      warnings.add("文档包含未展开的复杂内容控件，请查阅原件核对。");
      children(node).forEach(render);
    }
  }
  children(body).forEach(render);
  if (descendants(tree, "w:del").length || descendants(tree, "w:ins").length)
    warnings.add("修订标记按接受修改后的正文展示，修改历史保留在原件。");
  if (descendants(tree, "w:hyperlink").length)
    warnings.add("超链接仅保留文字，不读取链接目标。");
  if (
    [...files.keys()].some((k) =>
      /word\/(header|footer|footnotes|endnotes|comments)/.test(k),
    )
  )
    warnings.add("页眉、页脚、批注和脚注不并入引用正文，请查阅原件。");
  if (descendants(tree, "w:numPr").length)
    warnings.add("自动编号和列表缩进未复原；文字已按原顺序保留。");
  if (
    descendants(tree, "w:object").length ||
    descendants(tree, "w:pict").length ||
    descendants(tree, "m:oMath").length
  )
    warnings.add("嵌入对象、旧式图形或公式未展开，请查阅原件。");
  const text = blocks.map((block) => block.text).join("\n");
  requireThat(
    text.trim() &&
      Array.from(text).length <= 500000 &&
      blocks.length <= 10000 &&
      !/\0/.test(text),
    422,
    "DOCX_CONTENT_LIMIT",
    "正文须包含可读取文字，最多 50 万字或 1 万段。",
  );
  return {
    fileName: file.fileName,
    bytes: original.length,
    sha256: createHash("sha256").update(original).digest("hex"),
    text,
    document: { format: "docx_v1", blocks, warnings: [...warnings] },
    original,
  };
}

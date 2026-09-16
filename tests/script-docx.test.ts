import test from "node:test";
import assert from "node:assert/strict";
import { parseScriptDocument } from "../apps/api/src/modules/content/docx.js";
import { docxFixture, zipFixture, sampleParagraphs } from "./support/docx.js";
const parse = (buffer = docxFixture(), fileName = "初稿.docx") =>
  parseScriptDocument({ fileName, data: buffer.toString("base64") });
test("Word reading preserves headings, dialogue, tables, Unicode and original bytes", async () => {
  const file = docxFixture(),
    result = await parse(file);
  assert.deepEqual(
    result.document.blocks.map((b) => b.kind),
    ["heading", "paragraph", "table"],
  );
  assert.equal(result.document.blocks[0]!.level, 1);
  assert.equal(
    result.text,
    "第一集 · 旧钥匙\n林夏：钥匙在哪里？😀\n场次\t咖啡馆",
  );
  assert.deepEqual(result.original, file);
});
test("Word never fetches relationships and exposes missing image and structure warnings", async () => {
  const result = await parse(
    docxFixture(
      sampleParagraphs +
        `<w:p><w:hyperlink><w:r><w:t>链接文字</w:t></w:r></w:hyperlink><w:r><w:drawing><a:blip r:link="remote"/></w:drawing></w:r></w:p>`,
      {
        "word/_rels/document.xml.rels": `<Relationships><Relationship Id="remote" TargetMode="External" Target="http://127.0.0.1/private"/></Relationships>`,
        "word/comments.xml": "unused",
      },
    ),
  );
  assert.match(result.text, /链接文字/);
  assert.match(result.text, /图片未展开/);
  assert.equal(
    result.document.blocks.some((block) => block.imageData),
    false,
  );
  assert.ok(result.document.warnings.some((w) => w.includes("超链接")));
  assert.ok(result.document.warnings.some((w) => w.includes("批注")));
});
test("Word rejects malformed ZIP, traversal, DTD, macros, excess entries and input bytes", async () => {
  for (const file of [
    Buffer.from("not zip"),
    zipFixture({ "../escape": "bad" }),
    docxFixture("", {
      "word/document.xml":
        '<!DOCTYPE doc [<!ENTITY private SYSTEM "file:///etc/passwd">]><w:document>&private;</w:document>',
    }),
    docxFixture(sampleParagraphs, { "word/vbaProject.bin": "macro" }),
    docxFixture(
      sampleParagraphs,
      Object.fromEntries(
        Array.from({ length: 501 }, (_, i) => [`custom/${i}`, ""]),
      ),
    ),
    Buffer.alloc(4 * 1024 * 1024 + 1),
  ])
    await assert.rejects(parse(file));
  await assert.rejects(parse(docxFixture(), "wrong.doc"));
});
test("Word embeds bounded raster images and warns for oversized or damaged images", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const withImage = (image: Buffer) =>
    docxFixture(
      sampleParagraphs +
        `<w:p><w:r><w:drawing><a:blip r:embed="image1"/></w:drawing></w:r></w:p>`,
      {
        "word/_rels/document.xml.rels": `<Relationships><Relationship Id="image1" Target="media/image1.png"/></Relationships>`,
        "word/media/image1.png": image,
      },
    );
  const valid = await parse(withImage(png));
  assert.equal(valid.document.blocks.at(-1)!.kind, "image");
  const oversized = Buffer.from(png);
  oversized.writeUInt32BE(100000, 16);
  oversized.writeUInt32BE(100000, 20);
  for (const image of [
    oversized,
    png.subarray(0, 30),
    Buffer.concat([png, Buffer.from("junk")]),
  ]) {
    const result = await parse(withImage(image));
    assert.equal(
      result.document.blocks.some((b) => b.kind === "image"),
      false,
    );
    assert.match(result.text, /图片未展开/);
    assert.ok(result.document.warnings.some((w) => w.includes("1600 万像素")));
  }
});

test("Word ZIP expansion is bounded across compressed entries", async () => {
  const bomb = zipFixture(
    {
      one: Buffer.alloc(11 * 1024 * 1024),
      two: Buffer.alloc(11 * 1024 * 1024),
    },
    true,
  );
  assert.ok(bomb.length < 4 * 1024 * 1024);
  await assert.rejects(parse(bomb), /20 MB/);
});

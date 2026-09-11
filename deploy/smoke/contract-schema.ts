import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createContractCompiler } from "@drama/contracts/compiler";

const received = await readFile(process.argv[2]!);
const expected = await readFile(
  new URL("../../docs/implementation/openapi.json", import.meta.url),
);
const hash = (value: Buffer) =>
  createHash("sha256").update(value).digest("hex");
assert.equal(hash(received), hash(expected));
for (const path of [process.argv[3]!, process.argv[4]!])
  assert.match(
    await readFile(path, "utf8"),
    /^content-type:\s*application\/json(?:;|\s|$)/im,
  );
const compiler = createContractCompiler(JSON.parse(received.toString("utf8")));
assert.equal(
  compiler.validateContract("CanvasDocument", {
    nodes: [],
    edges: [],
    groups: [],
  }).valid,
  true,
);
console.log(
  '{"status":"ok","publicCanvasSchemaGetAndHeadJson":true,"publicCanvasSchemaMatchesBuild":true,"canvasContractCompiles":true}',
);

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateContract } from "@drama/contracts/validation";
const samples = JSON.parse(
  readFileSync(
    new URL("../docs/implementation/sample-payloads.json", import.meta.url),
    "utf8",
  ),
).samples as { name: string; schema: string; valid: boolean; value: unknown }[];
test("OpenAPI 3.1 samples validate with the runtime 2020-12 dialect without mutation", () => {
  for (const sample of samples) {
    const before = JSON.stringify(sample.value);
    const result = validateContract(sample.schema, sample.value);
    assert.equal(
      result.valid,
      sample.valid,
      `${sample.name}: ${JSON.stringify(result.errors)}`,
    );
    assert.equal(
      JSON.stringify(sample.value),
      before,
      `${sample.name} must not be coerced or stripped`,
    );
  }
});

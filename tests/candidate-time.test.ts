import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSourceSeconds,
  sourceSeconds,
} from "../apps/web/src/business/candidate-time.js";
test("candidate source timestamps round-trip decimal seconds without floating point loss", () => {
  for (const us of [
    0,
    1,
    10,
    100000,
    1000000,
    250001,
    4000000,
    10000000,
    Number.MAX_SAFE_INTEGER,
  ])
    assert.equal(parseSourceSeconds(sourceSeconds(us)), us);
  assert.equal(parseSourceSeconds("0.100001"), 100001);
  assert.equal(
    parseSourceSeconds("9007199254.740991"),
    Number.MAX_SAFE_INTEGER,
  );
  for (const invalid of [
    "",
    "-1",
    "1e2",
    "0.0000001",
    "9007199254.740992",
    "NaN",
    "01.5",
    "1.",
    "9".repeat(10000),
  ])
    assert.equal(parseSourceSeconds(invalid), undefined, invalid);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { MockDispatchLab } from "@drama/provider";
import { inwardFrameRange, frameToSample } from "@drama/domain";
const rate = { numerator: 30000n, denominator: 1001n };
test("NTSC inward range keeps exact source frame bounds", () => {
  assert.deepEqual(inwardFrameRange(100000, 1100000, rate), {
    start: 3n,
    end: 32n,
    length: 29n,
  });
  assert.equal(frameToSample(30000n, rate), 48048000n);
});
test("invalid or shorter-than-frame intervals are rejected", () => {
  for (const [start, end] of [
    [1, 1],
    [-1, 300000],
    [0.5, 300000],
    [0, 1],
    [0, Number.MAX_SAFE_INTEGER + 1],
  ] as [number, number][])
    assert.throws(() => inwardFrameRange(start, end, rate), RangeError);
});
test("audio length is derived from global frame boundaries, not per-clip rounded sums", () => {
  const global = frameToSample(29n, rate);
  const intervals = Array.from(
    { length: 29 },
    (_, i) =>
      frameToSample(BigInt(i + 1), rate) - frameToSample(BigInt(i), rate),
  );
  assert.equal(
    intervals.reduce((a, b) => a + b, 0n),
    global,
  );
  assert.notEqual(frameToSample(1n, rate) * 29n, global);
});
for (const scenario of ["accepted", "rejected", "lost_reply"] as const)
  test(`mock ${scenario}: repeated scheduling cannot submit twice`, () => {
    const lab = new MockDispatchLab(scenario);
    lab.dispatch();
    lab.dispatch();
    lab.dispatch();
    assert.equal(lab.submitCount, 1);
    assert.equal(
      lab.status,
      {
        accepted: "provider_pending",
        rejected: "failed",
        lost_reply: "submission_unknown",
      }[scenario],
    );
  });
test("lost reply can accept late evidence without a new purchase; conflicting receipts stay unresolved", () => {
  const lab = new MockDispatchLab("lost_reply");
  lab.dispatch();
  lab.receive("receipt-1");
  lab.receive("receipt-1");
  assert.equal(lab.status, "provider_pending");
  assert.equal(lab.evidence.size, 1);
  lab.receive("receipt-2");
  lab.dispatch();
  lab.receive("receipt-1");
  assert.equal(lab.status, "reconciliation_required");
  assert.equal(lab.submitCount, 1);
});

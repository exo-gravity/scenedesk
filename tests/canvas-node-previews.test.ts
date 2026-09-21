import assert from "node:assert/strict";
import { test } from "node:test";
import {
  latestSucceededAttempts,
  runWithLimit,
} from "../apps/web/src/business/canvas-node-previews.js";

const entry = (
  nodeId: string,
  jobStatus: string | undefined,
  createdAt: string,
  overrides: Partial<{ projectId: string; purpose: string; jobId: string }> = {},
) => ({
  origin: { nodeId },
  jobId: overrides.jobId ?? `job-${nodeId}-${createdAt}`,
  jobStatus,
  plan: {
    id: `plan-${nodeId}-${createdAt}`,
    createdAt,
    input: {
      projectId: overrides.projectId ?? "p1",
      purpose: overrides.purpose ?? "video",
    },
  },
});

test("each node maps to its newest succeeded attempt in this project; other nodes and statuses are ignored", () => {
  const attempts = [
    entry("a", "succeeded", "2026-09-20T10:00:00Z"),
    entry("a", "succeeded", "2026-09-21T10:00:00Z"),
    entry("a", "running", "2026-09-21T11:00:00Z"),
    entry("b", "failed", "2026-09-21T10:00:00Z"),
    entry("c", "succeeded", "2026-09-21T10:00:00Z", { projectId: "other" }),
    entry("d", "succeeded", "2026-09-21T10:00:00Z", { purpose: "script_analysis" }),
    entry("e", undefined, "2026-09-21T10:00:00Z"),
  ];
  const latest = latestSucceededAttempts(attempts, "p1");
  assert.deepEqual([...latest.keys()], ["a"]);
  assert.deepEqual(latest.get("a"), {
    jobId: "job-a-2026-09-21T10:00:00Z",
    planId: "plan-a-2026-09-21T10:00:00Z",
    kind: "video",
  });
});

test("a running retry keeps the last succeeded attempt visible until it succeeds itself", () => {
  const attempts = [
    entry("a", "succeeded", "2026-09-21T10:00:00Z"),
    entry("a", "queued", "2026-09-21T12:00:00Z"),
  ];
  assert.equal(
    latestSucceededAttempts(attempts, "p1").get("a")?.jobId,
    "job-a-2026-09-21T10:00:00Z",
  );
});

test("tasks run at most `limit` at a time, all of them run, and one failure does not stop the rest", async () => {
  let active = 0,
    peak = 0;
  const done: number[] = [];
  const task = (index: number, fail = false) => async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    if (fail) throw new Error(`task ${index} failed`);
    done.push(index);
  };
  const results = await runWithLimit(
    [task(1), task(2, true), task(3), task(4), task(5)],
    2,
  );
  assert.equal(peak, 2);
  assert.deepEqual(done.sort(), [1, 3, 4, 5]);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
});

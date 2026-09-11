import assert from "node:assert/strict";
import test from "node:test";
import { editingPresenceLabel } from "../apps/web/src/business/editing-presence-state.js";
import type { components } from "@drama/contracts";

test("presence advice expires individual pages using server time, then becomes unknown", () => {
  const snapshot: components["schemas"]["EditingPresence"] = {
    target: { kind: "canvas", objectId: "target" },
    serverTime: "2026-09-11T00:00:00Z",
    entries: [
      {
        membershipId: "me",
        clientSessionId: "here",
        activity: "editing",
        lastSeenAt: "2026-09-11T00:00:00Z",
        expiresAt: "2026-09-11T00:01:30Z",
      },
      {
        membershipId: "peer",
        clientSessionId: "editor",
        activity: "editing",
        lastSeenAt: "2026-09-10T23:58:40Z",
        expiresAt: "2026-09-11T00:00:10Z",
      },
      {
        membershipId: "peer",
        clientSessionId: "viewer",
        activity: "viewing",
        lastSeenAt: "2026-09-10T23:58:50Z",
        expiresAt: "2026-09-11T00:00:20Z",
      },
    ],
  };
  assert.deepEqual(editingPresenceLabel(snapshot, "here", 2_000), {
    label: "另有 1 个页面正在编辑",
    refreshInMs: 8_000,
  });
  assert.deepEqual(editingPresenceLabel(snapshot, "here", 10_000), {
    label: "另有 1 个页面正在查看",
    refreshInMs: 10_000,
  });
  assert.deepEqual(editingPresenceLabel(snapshot, "here", 20_000), {
    label: "暂未收到其他页面活动",
    refreshInMs: 70_000,
  });
  assert.deepEqual(editingPresenceLabel(snapshot, "here", 90_000), {
    label: "编辑状态暂不可用",
    refreshInMs: null,
  });
});

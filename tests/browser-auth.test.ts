import { test } from "node:test";
import assert from "node:assert/strict";
import {
  invitationFromFragment,
  loginReturnPath,
} from "../apps/web/src/business/invitation.js";

test("an invitation secret never enters the OIDC login return URL", () => {
  const token = "a".repeat(43),
    hash = `#/invitation?token=${token}`;
  assert.equal(invitationFromFragment(hash), token);
  assert.equal(loginReturnPath(hash), "/#/invitation");
  assert.ok(!encodeURIComponent(loginReturnPath(hash)).includes(token));
  assert.equal(invitationFromFragment("#/app?token=" + token), null);
  assert.equal(invitationFromFragment("#/invitation?token=bad"), null);
  assert.equal(loginReturnPath("#/app/t/example"), "/#/app/t/example");
});

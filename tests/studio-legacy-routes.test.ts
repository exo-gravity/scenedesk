import assert from "node:assert/strict";
import { test } from "node:test";
import { studioRouteFor } from "../apps/web/src/studio/legacy-routes.js";

const base = "#/app/t/t1/p/p1";

test("the old project canvas opens the studio, keeping a node focus", () => {
  assert.equal(studioRouteFor(`${base}/canvas`), `${base}/studio`);
  assert.equal(
    studioRouteFor(`${base}/canvas?scope=project&node=n1`),
    `${base}/studio?node=n1`,
  );
});

test("the old scene workspace opens the scene canvas, or the shot organiser for a storyboard deep link", () => {
  assert.equal(studioRouteFor(`${base}/production`), `${base}/studio`);
  assert.equal(
    studioRouteFor(`${base}/production?scene=s1&mode=canvas`),
    `${base}/studio?scene=s1`,
  );
  assert.equal(
    studioRouteFor(`${base}/production?scene=s1&mode=storyboard&shot=sh1`),
    `${base}/studio/shots?scene=s1&shot=sh1`,
  );
  assert.equal(
    studioRouteFor(`${base}/production?scene=s1&mode=storyboard`),
    `${base}/studio/shots?scene=s1`,
  );
  assert.equal(
    studioRouteFor(`${base}/production?scene=s1&mode=canvas&node=n1`),
    `${base}/studio?scene=s1&node=n1`,
  );
});

test("the old script page opens the script view; its settings tab goes to the project page", () => {
  assert.equal(studioRouteFor(`${base}/script`), `${base}/studio/script`);
  assert.equal(
    studioRouteFor(`${base}/script?revision=r1`),
    `${base}/studio/script?revision=r1`,
  );
  assert.equal(studioRouteFor(`${base}/script?tab=settings`), base);
});

test("a fixed revision linked from the content page opens the script view; the rest of the content page stays", () => {
  assert.equal(
    studioRouteFor(`${base}/content?revision=r1`),
    `${base}/studio/script?revision=r1`,
  );
  assert.equal(studioRouteFor(`${base}/content?shot=sh1&revision=r1`), null);
  assert.equal(studioRouteFor(`${base}/content?scene=s1`), null);
  assert.equal(studioRouteFor(`${base}/content`), null);
});

test("studio, project, asset and tenant addresses are left alone", () => {
  for (const hash of [
    `${base}/studio`,
    `${base}/studio/script?revision=r1`,
    `${base}/studio/shots`,
    base,
    `${base}/assets?asset=a1`,
    "#/app/t/t1",
    "#/app/t/t1/assets",
    "#/invitation/x",
    "",
  ])
    assert.equal(studioRouteFor(hash), null, hash);
});

test("values are encoded once", () => {
  assert.equal(
    studioRouteFor(`${base}/canvas?node=a%20b`),
    `${base}/studio?node=a%20b`,
  );
});

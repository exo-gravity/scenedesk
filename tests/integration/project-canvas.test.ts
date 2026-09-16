import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { businessFixture } from "../support/business.js";
import { imageGenerationFixture } from "../support/image-generation.js";
import {
  createAssistanceFixture,
  localAssistanceFixtureOutput,
} from "@drama/provider";
import { createAssistanceWorker } from "../../apps/api/src/modules/generation/worker.js";

test("project canvas starts with no scenes, survives concurrent creation and preserves private preferences and authority", async (t) => {
  const f = await businessFixture(t);
  const route = `${f.path}/canvas`,
    prefPath = `${f.path}/workspace-preference`;
  assert.equal(
    (await f.request("GET", route)).json().code,
    "PROJECT_CANVAS_NOT_CREATED",
  );
  const initial = await f.ok("GET", prefPath);
  assert.equal(initial.revision, 0);
  assert.equal(initial.mode, "canvas");
  const requests = await Promise.all(
    Array.from({ length: 3 }, () => f.request("POST", route)),
  );
  for (const result of requests)
    assert.equal(result.statusCode, 200, result.body);
  assert.equal(new Set(requests.map((r) => r.json().canvas.id)).size, 1);
  let canvas = requests[0]!.json().canvas;
  const canvasPath = `${f.path}/canvases/${canvas.id}`;
  assert.equal((await f.ok("GET", `${f.path}/content`)).scenes.length, 0);
  assert.equal((await f.ok("GET", `${f.path}/content`)).episodes.length, 0);
  const node = {
    id: randomUUID(),
    title: "第一张画面",
    kind: "text",
    position: { x: 10, y: -20 },
    width: 280,
    content: { type: "text", text: "门口的雨。" },
  };
  canvas = await f.ok(
    "PUT",
    canvasPath,
    { schemaVersion: 1, document: { nodes: [node], edges: [], groups: [] } },
    canvas.revision,
  );
  assert.equal(
    (await f.ok("GET", route)).canvas.document.nodes[0].content.text,
    "门口的雨。",
  );
  assert.equal(
    (await f.ok("GET", `${canvasPath}/revisions/1`)).document.nodes.length,
    0,
  );
  assert.equal(
    (
      await f.request(
        "PUT",
        canvasPath,
        { schemaVersion: 1, document: canvas.document },
        1,
      )
    ).statusCode,
    412,
  );
  const { projectId: _project, revision: _revision, ...preference } = initial;
  preference.viewport = { x: 147, y: -56, zoom: 0.65 };
  preference.selectedNodeIds = [node.id];
  const saved = await f.ok("PUT", prefPath, preference, 0);
  assert.equal(saved.revision, 1);
  assert.deepEqual((await f.ok("GET", prefPath)).viewport, preference.viewport);
  assert.equal(
    (await f.request("PUT", prefPath, preference, 0)).statusCode,
    412,
  );
  assert.equal(
    (await f.request("PUT", prefPath, { ...preference, mode: "storyboard" }, 1))
      .statusCode,
    422,
  );
  const other = await f.createProject("其他项目");
  assert.equal(
    (
      await f.request(
        "GET",
        `/v1/tenants/${f.tenant.id}/projects/${other.id}/canvases/${canvas.id}`,
      )
    ).statusCode,
    404,
  );
  const outsider = await f.identity("outside-canvas");
  assert.equal(
    (await f.request("GET", route, undefined, undefined, undefined, outsider))
      .statusCode,
    404,
  );
  const collaborator = await f.identity("project-canvas-collaborator"),
    membership = randomUUID();
  await f.admin.query(
    `INSERT INTO ${f.schema}.memberships(id,tenant_id,user_id,role,status) VALUES($1,$2,$3,'member','active')`,
    [membership, f.tenant.id, collaborator.userId],
  );
  await f.admin.query(
    `INSERT INTO ${f.schema}.project_memberships(id,tenant_id,project_id,membership_id,role) VALUES($1,$2,$3,$4,'collaborator')`,
    [randomUUID(), f.tenant.id, f.project.id, membership],
  );
  const theirs = await f.request(
    "GET",
    prefPath,
    undefined,
    undefined,
    undefined,
    collaborator,
  );
  assert.equal(
    theirs.json().revision,
    0,
    "another member cannot see private viewport/selection",
  );
  assert.equal(
    (
      await f.request(
        "PUT",
        prefPath,
        { ...preference, viewport: { x: 1, y: 2, zoom: 1 } },
        0,
        undefined,
        collaborator,
      )
    ).statusCode,
    200,
  );
  assert.deepEqual((await f.ok("GET", prefPath)).viewport, preference.viewport);
  const collaboratorKey = randomUUID();
  assert.equal(
    (
      await f.request(
        "POST",
        route,
        undefined,
        undefined,
        collaboratorKey,
        collaborator,
      )
    ).statusCode,
    200,
  );
  await f.admin.query(
    `DELETE FROM ${f.schema}.project_memberships WHERE membership_id=$1`,
    [membership],
  );
  assert.equal(
    (
      await f.request(
        "POST",
        route,
        undefined,
        undefined,
        collaboratorKey,
        collaborator,
      )
    ).statusCode,
    404,
    "cached creation cannot restore revoked project authority",
  );
  const key = randomUUID();
  assert.equal(
    (await f.request("POST", route, undefined, undefined, key)).statusCode,
    200,
  );
  const project = await f.ok("GET", f.path);
  await f.ok("POST", `${f.path}/archive`, undefined, project.revision);
  assert.equal((await f.ok("GET", route)).canvas.id, canvas.id);
  assert.equal(
    (await f.request("PUT", prefPath, preference, 1)).statusCode,
    200,
    "archived project retains personal browsing preferences",
  );
  assert.equal(
    (await f.request("POST", route, undefined, undefined, key)).statusCode,
    409,
    "cached success must recheck current archived authority",
  );
});

test("project canvas generation and assistant retain fixed inputs without a scene, while legacy scene scopes remain fixed", async (t) => {
  const f = await imageGenerationFixture(t),
    project = await f.createProject("不建场次直接创作"),
    path = `${f.base}/projects/${project.id}`;
  let canvas = (await f.request("POST", `${path}/canvas`)).json().canvas;
  const node = {
    id: randomUUID(),
    kind: "image",
    title: "雨夜",
    position: { x: 0, y: 0 },
    width: 280,
    content: {
      type: "draft",
      prompt: "雨夜门口",
      output: f.input.output,
      connectionId: f.input.connectionId,
      capabilityId: f.input.capabilityId,
    },
  };
  canvas = await f.ok(
    "PUT",
    `${path}/canvases/${canvas.id}`,
    { schemaVersion: 1, document: { nodes: [node], edges: [], groups: [] } },
    canvas.revision,
  );
  const planInput = {
    nodeId: node.id,
    shotSources: [],
    referenceOverrides: [],
    promptPolicy: "append",
  };
  const entry = await f.ok(
    "POST",
    `${path}/canvases/${canvas.id}/generation-plans`,
    planInput,
    canvas.revision,
  );
  assert.equal(entry.origin.canvasId, canvas.id);
  assert.deepEqual(entry.plan.resolvedInput.shots, []);
  assert.equal(entry.plan.input.projectId, project.id);
  assert.equal(
    (
      await f.request(
        "POST",
        `${path}/canvases/${canvas.id}/generation-plans`,
        planInput,
        canvas.revision - 1,
      )
    ).statusCode,
    412,
  );
  assert.equal((await f.ok("GET", `${path}/content`)).scenes.length, 0);
  const cap = randomUUID(),
    connection = randomUUID(),
    version = randomUUID();
  await f.admin.query(
    `INSERT INTO ${f.scope}.generation_capabilities(id,tenant_id,connection_id,connection_version_id,revision,definition,execution_mode,enabled,max_inflight,max_daily_jobs) VALUES($1,$2,$3,$4,1,$5,'test_fixture',true,2,100)`,
    [
      cap,
      f.tenant.id,
      connection,
      version,
      {
        purpose: "creative_assistance",
        mode: "fixture",
        modelVersion: "Local Demo",
        supportedPurposes: [],
        maxReferences: 20,
      },
    ],
  );
  const input = {
    ...f.input,
    projectId: project.id,
    purpose: "creative_assistance",
    connectionId: connection,
    capabilityId: cap,
    prompt: "讨论雨夜场景",
    output: {},
    shotSources: [],
    contextSources: [],
    additionalReferences: [],
    referenceOverrides: [],
    canvasSources: [
      { canvasId: canvas.id, canvasRevision: canvas.revision, nodeId: node.id },
    ],
    assistance: { kind: "discuss", canvasId: canvas.id },
  };
  const plan = await f.ok("POST", `${f.base}/generation-plans`, input);
  assert.deepEqual(plan.resolvedInput.canvasScope, {
    canvasId: canvas.id,
    projectId: project.id,
  });
  assert.equal(
    plan.resolvedInput.canvasSnapshots[0].content.prompt,
    "雨夜门口",
  );
  const projection = (
    await f.admin.query(
      `SELECT scene_id FROM ${f.scope}.generation_assistance_scopes WHERE plan_id=$1`,
      [plan.id],
    )
  ).rows[0];
  assert.equal(projection.scene_id, null);
  let submissions = 0;
  const worker = await createAssistanceWorker({
    pool: f.generationDb,
    schema: f.schema,
    adapters: [
      createAssistanceFixture(version, async (submission) => {
        submissions++;
        return {
          kind: "completed",
          correlation: submission.attemptId,
          output: localAssistanceFixtureOutput(submission),
        };
      }),
    ],
  });
  const job = await f.execute(plan.id);
  await worker.process(job.id);
  assert.equal(submissions, 1);
  assert.equal(
    (await f.ok("GET", `${f.base}/generation-jobs/${job.id}`)).status,
    "succeeded",
  );
  const legacy = (
    await f.request("POST", `${f.path}/scenes/${f.scene.id}/canvas`)
  ).json().canvas;
  const legacyPlan = await f.ok("POST", `${f.base}/generation-plans`, {
    ...input,
    projectId: f.project.id,
    canvasSources: [],
    assistance: { kind: "discuss", canvasId: legacy.id },
  });
  assert.deepEqual(legacyPlan.resolvedInput.canvasScope, {
    canvasId: legacy.id,
    sceneId: f.scene.id,
  });
  for (const scope of ["project", "scene"] as const) {
    const target =
      scope === "project"
        ? canvas
        : await f.ok(
            "PUT",
            `${f.path}/canvases/${legacy.id}`,
            {
              schemaVersion: 1,
              document: {
                nodes: [{ ...node, id: randomUUID() }],
                edges: [],
                groups: [],
              },
            },
            legacy.revision,
          );
    const preparePath =
      scope === "project"
        ? `${path}/canvases/${canvas.id}/generation-plans`
        : `${f.path}/scenes/${f.scene.id}/canvas/generation-plans`;
    const body = { ...planInput, nodeId: target.document.nodes[0].id },
      key = randomUUID();
    const prepared = await f.request(
      "POST",
      preparePath,
      body,
      target.revision,
      key,
    );
    assert.equal(prepared.statusCode, 201, prepared.body);
    assert.deepEqual(
      (await f.request("POST", preparePath, body, target.revision, key)).json(),
      prepared.json(),
      "active replay retains exactly the fixed plan",
    );
    if (scope === "project")
      await f.ok("POST", `${path}/archive`, undefined, project.revision);
    else
      await f.ok(
        "PUT",
        `${f.path}/scenes/${f.scene.id}`,
        {
          episodeId: f.scene.episodeId,
          title: f.scene.title,
          summary: f.scene.summary,
          position: f.scene.position,
          state: f.scene.state,
          status: "archived",
        },
        f.scene.revision,
      );
    const replay = await f.request(
      "POST",
      preparePath,
      body,
      target.revision,
      key,
    );
    const fresh = await f.request("POST", preparePath, body, target.revision);
    assert.equal(
      replay.statusCode,
      scope === "project" ? 404 : 409,
      replay.body,
    );
    assert.equal(
      replay.json().code,
      scope === "project" ? "CANVAS_CONTEXT_UNAVAILABLE" : "PARENT_ARCHIVED",
    );
    assert.equal(
      fresh.statusCode,
      replay.statusCode,
      "cached replay rechecks the same active scope as a new preparation",
    );
    assert.equal(
      (
        await f.ok(
          "GET",
          `${scope === "project" ? path : f.path}/canvases/${target.id}`,
        )
      ).id,
      target.id,
      "archived canvas history remains readable",
    );
    if (scope === "scene") {
      const scene = (await f.ok("GET", `${f.path}/content`)).scenes.find(
        (item: { id: string }) => item.id === f.scene.id,
      );
      await f.ok(
        "PUT",
        `${f.path}/scenes/${f.scene.id}`,
        {
          episodeId: scene.episodeId,
          title: scene.title,
          summary: scene.summary,
          position: scene.position,
          state: scene.state,
          status: "active",
        },
        scene.revision,
      );
      assert.equal(
        (await f.request("POST", preparePath, body, target.revision, key))
          .statusCode,
        201,
      );
      const episode = (await f.ok("GET", `${f.path}/content`)).episodes.find(
        (item: { id: string }) => item.id === scene.episodeId,
      );
      await f.ok(
        "PUT",
        `${f.path}/episodes/${episode.id}`,
        {
          title: episode.title,
          position: episode.position,
          status: "archived",
        },
        episode.revision,
      );
      const episodeReplay = await f.request(
        "POST",
        preparePath,
        body,
        target.revision,
        key,
      );
      assert.equal(episodeReplay.statusCode, 409, episodeReplay.body);
      assert.equal(episodeReplay.json().code, "PARENT_ARCHIVED");
    }
  }
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { imageGenerationFixture } from "../support/image-generation.js";

type Fixture = Awaited<ReturnType<typeof imageGenerationFixture>>;
const sources = (...shots: { id: string; specRevisionId: string }[]) =>
  shots.map((shot) => ({
    shotId: shot.id,
    shotRevisionId: shot.specRevisionId,
  }));

async function canvasDraft(f: Fixture) {
  const response = await f.request(
    "POST",
    `${f.path}/scenes/${f.scene.id}/canvas`,
  );
  assert.equal(response.statusCode, 200, response.body);
  let canvas = response.json().canvas;
  const nodeId = randomUUID();
  canvas = await f.ok(
    "PUT",
    `${f.path}/canvases/${canvas.id}`,
    {
      schemaVersion: 1,
      document: {
        nodes: [
          {
            id: nodeId,
            kind: f.input.purpose,
            title: "明确固定镜头",
            position: { x: 0, y: 0 },
            width: 280,
            content: {
              type: "draft",
              prompt: f.input.prompt,
              output: f.input.output,
              connectionId: f.input.connectionId,
              capabilityId: f.input.capabilityId,
            },
          },
        ],
        edges: [],
        groups: [],
      },
    },
    canvas.revision,
  );
  const request = (
    shotSources: ReturnType<typeof sources>,
    promptPolicy = "append",
  ) =>
    f.request(
      "POST",
      `${f.path}/scenes/${f.scene.id}/canvas/generation-plans`,
      {
        nodeId,
        shotSources,
        referenceOverrides: [],
        promptPolicy,
      },
      canvas.revision,
    );
  return {
    canvas,
    nodeId,
    request,
    prepare: async (
      shotSources: ReturnType<typeof sources>,
      promptPolicy?: string,
    ) => {
      const response = await request(shotSources, promptPolicy);
      assert.equal(response.statusCode, 201, response.body);
      return response.json();
    },
  };
}

// Relational archive evidence only: actual byte decoding remains in media tests.
async function acceptImage(f: Fixture, id: string) {
  const step = await f.envelope(id),
    token = randomUUID();
  const claim = (
    await f.mediaDb.query(
      `SELECT ${f.scope}.claim_generated_media($1,$2,$3,$4) AS claim`,
      [id, step.stepRevision, step.epoch, token],
    )
  ).rows[0].claim;
  assert.ok(claim);
  await f.mediaDb.query(
    `SELECT ${f.scope}.finish_generated_media($1,$2,$3,NULL)`,
    [
      id,
      token,
      {
        object: {
          key: `originals/${randomUUID()}`,
          versionId: "fixed-shot-relational-fixture",
          bytes: claim.source.object.bytes,
          sha256: claim.source.sha256,
        },
        probe: {
          kind: "image",
          mime: "image/png",
          width: 32,
          height: 32,
          hasAudio: false,
        },
      },
    ],
  );
}

test("restricted runtime cannot misrepresent fixed shot snapshots", async (t) => {
  const f = await imageGenerationFixture(t);
  const shot = await f.ok(
    "PUT",
    `${f.path}/shots/${f.shot.id}`,
    {
      sceneId: f.scene.id,
      label: f.shot.label,
      position: f.shot.position,
      status: "active",
      spec: {
        intent: "固定入口和出口",
        entryState: { spatialNotes: "门关闭" },
        exitState: { spatialNotes: "门打开" },
        references: [],
      },
    },
    f.shot.revision,
  );
  const identicalSpec = await f.ok(
    "POST",
    `${f.path}/shots`,
    {
      sceneId: f.scene.id,
      label: "另一个相同规格的镜头",
      position: 1,
      status: "active",
      spec: shot.spec,
    },
    await f.next(),
  );
  const plan = await f.plan({ shotSources: sources(shot, identicalSpec) });
  const columns = (
    await f.admin.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='generation_plans' AND is_generated='NEVER' ORDER BY ordinal_position",
      [f.schema],
    )
  ).rows.map((row) => row.column_name as string);
  // The runtime's SQL boundary must reject invented provenance even if a caller
  // bypasses the public resolver. All attempts are rolled back in this fixture.
  async function insertSnapshot(resolved: unknown) {
    const sql = await f.runtime.connect();
    try {
      await sql.query("BEGIN");
      await sql.query(`SET LOCAL search_path TO ${f.scope},pg_catalog`);
      await sql.query(
        "SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id',$2,true)",
        [f.owner.userId, f.tenant.id],
      );
      const id = randomUUID();
      await sql.query(
        `INSERT INTO generation_plans(${columns.map((c) => '"' + c + '"').join(",")}) SELECT ${columns.map((c) => (c === "id" ? "$2::uuid" : c === "resolved_input" ? "$3::jsonb" : '"' + c + '"')).join(",")} FROM generation_plans WHERE id=$1`,
        [plan.id, id, resolved],
      );
      await sql.query(
        "INSERT INTO generation_plan_shots(tenant_id,project_id,plan_id,position,shot_id,shot_revision_id) SELECT tenant_id,project_id,$2,position,shot_id,shot_revision_id FROM generation_plan_shots WHERE plan_id=$1",
        [plan.id, id],
      );
      await sql.query("SET CONSTRAINTS ALL IMMEDIATE");
      assert.equal(
        (
          await sql.query(
            "SELECT count(*)::int AS n FROM generation_plans WHERE id=$1",
            [id],
          )
        ).rows[0].n,
        1,
      );
    } finally {
      await sql.query("ROLLBACK");
      sql.release();
    }
  }
  await t.test("an unchanged fixed snapshot remains legal", () =>
    insertSnapshot(plan.resolvedInput),
  );
  for (const [name, change] of [
    [
      "an additional unselected shot",
      (r: any) => r.shots.push(structuredClone(r.shots[0])),
    ],
    [
      "another shot identity",
      (r: any) => {
        r.shots[0].shotId = randomUUID();
      },
    ],
    [
      "another shot revision",
      (r: any) => {
        r.shots[0].shotRevisionId = randomUUID();
      },
    ],
    [
      "invented entry state",
      (r: any) => {
        r.shots[0].entryState = { spatialNotes: "未选入口" };
      },
    ],
    [
      "invented exit state",
      (r: any) => {
        r.shots[0].exitState = { spatialNotes: "未选出口" };
      },
    ],
    [
      "a missing shot array",
      (r: any) => {
        delete r.shots;
      },
    ],
    [
      "a null shot array",
      (r: any) => {
        r.shots = null;
      },
    ],
    [
      "an omitted selected shot",
      (r: any) => {
        r.shots = [];
      },
    ],
    [
      "a missing continuity state",
      (r: any) => {
        delete r.shots[0].entryState;
      },
    ],
    [
      "reordered shot identities with identical specs",
      (r: any) => {
        r.shots.reverse();
      },
    ],
  ] as const) {
    await t.test(`rejects ${name}`, async () => {
      const resolved = structuredClone(plan.resolvedInput);
      change(resolved);
      await assert.rejects(
        insertSnapshot(resolved),
        (error: any) => error.code === "23514",
      );
    });
  }
});

test("audio canvas shots fix explicit dialogue, continuity voices and a selected character's default voice", async (t) => {
  const f = await imageGenerationFixture(t, undefined, { purpose: "audio" });
  const draft = await canvasDraft(f);
  async function voice(name: string) {
    const asset = await f.ok("POST", `${f.base}/assets`, {
      scope: "project",
      projectId: f.project.id,
      kind: "voice",
      name,
    });
    const revision = await f.ok(
      "POST",
      `${f.base}/assets/${asset.id}/revisions`,
      {
        definition: {
          description: name,
          voiceDescription: `${name}音色`,
          references: [],
        },
      },
      asset.revision,
    );
    return { asset, revision };
  }
  const lineVoice = await voice("固定对白声音"),
    entryVoice = await voice("固定入口声音"),
    defaultVoice = await voice("固定角色默认声音");
  const speaker = await f.ok("POST", `${f.base}/assets`, {
    scope: "project",
    projectId: f.project.id,
    kind: "character",
    name: "对白角色",
  });
  const other = await f.ok("POST", `${f.base}/assets`, {
    scope: "project",
    projectId: f.project.id,
    kind: "character",
    name: "出口角色",
  });
  const lookId = randomUUID();
  const character = await f.ok(
    "POST",
    `${f.base}/assets/${other.id}/revisions`,
    {
      definition: {
        description: "固定出口角色",
        references: [],
        defaultVoiceAssetRevisionId: defaultVoice.revision.id,
        looks: [{ id: lookId, revision: 1, label: "明确造型", references: [] }],
      },
    },
    other.revision,
  );
  const spec = {
    intent: "仅沿明确声音来源试作",
    dialogue: [
      {
        id: randomUUID(),
        characterAssetId: speaker.id,
        voiceAssetRevisionId: lineVoice.revision.id,
        text: "固定原对白",
      },
    ],
    entryState: {
      characters: [
        {
          characterAssetId: speaker.id,
          voiceAssetRevisionId: entryVoice.revision.id,
        },
      ],
    },
    exitState: {
      characters: [
        {
          characterAssetId: other.id,
          lookId,
          lookAssetRevisionId: character.id,
        },
      ],
    },
    references: [],
  };
  const shot = await f.ok(
    "PUT",
    `${f.path}/shots/${f.shot.id}`,
    { sceneId: f.scene.id, label: "声音", position: 0, status: "active", spec },
    f.shot.revision,
  );
  const entry = await draft.prepare(sources(shot));
  assert.deepEqual(entry.plan.resolvedInput.shots[0].spec, spec);
  assert.deepEqual(
    entry.plan.resolvedInput.shots[0].entryState,
    spec.entryState,
  );
  assert.deepEqual(entry.plan.resolvedInput.shots[0].exitState, spec.exitState);
  const snapshots = entry.plan.resolvedInput.contextSnapshots.filter(
    (s: any) => s.source.kind === "asset_revision",
  );
  assert.deepEqual(
    snapshots.map((s: any) => s.source.objectId),
    [
      lineVoice.revision.id,
      entryVoice.revision.id,
      character.id,
      defaultVoice.revision.id,
    ],
  );
  for (const snapshot of snapshots)
    assert.equal(snapshot.source.tracking, "fixed");
  assert.match(entry.plan.resolvedInput.prompt, /固定原对白/);
  assert.match(entry.plan.resolvedInput.prompt, /固定对白声音/);
  assert.match(entry.plan.resolvedInput.prompt, /固定入口声音/);
  assert.match(entry.plan.resolvedInput.prompt, /固定角色默认声音/);
  const currentVoice = await f.ok(
    "GET",
    `${f.base}/assets/${lineVoice.asset.id}`,
  );
  await f.ok(
    "POST",
    `${f.base}/assets/${lineVoice.asset.id}/revisions`,
    {
      definition: {
        description: "后来声音不得替换",
        voiceDescription: "新音色",
        references: [],
      },
    },
    currentVoice.revision,
  );
  await f.ok(
    "PUT",
    `${f.path}/shots/${shot.id}`,
    {
      sceneId: f.scene.id,
      label: "声音新稿",
      position: 0,
      status: "active",
      spec: { intent: "后来镜头不得替换", references: [] },
    },
    shot.revision,
  );
  const job = await f.execute(entry.plan.id);
  await f.worker.process(job.id);
  assert.equal(f.calls(), 1);
  assert.equal((await f.job(job.id)).status, "archiving");
  assert.deepEqual(f.last()!.resolvedInput.shots[0]!.spec, spec);
  assert.doesNotMatch(
    f.last()!.resolvedInput.prompt,
    /后来声音不得替换|后来镜头不得替换/,
  );
  const history = await f.ok(
    "GET",
    `${f.path}/canvases/${draft.canvas.id}/generation-plans?nodeId=${draft.nodeId}`,
  );
  assert.deepEqual(history.items[0].plan.input.shotSources, sources(shot));
  assert.equal(history.items[0].jobId, job.id);
});

test("canvas generation retains explicitly ordered historical shot sources", async (t) => {
  const f = await imageGenerationFixture(t);
  const draft = await canvasDraft(f);
  const createReference = async () => {
    const job = await f.execute((await f.plan()).id);
    await f.worker.process(job.id);
    await acceptImage(f, job.id);
    return job.id;
  };
  const refA = await createReference(),
    refB = await createReference();
  const shotA = await f.ok(
    "PUT",
    `${f.path}/shots/${f.shot.id}`,
    {
      sceneId: f.scene.id,
      label: "A",
      position: 0,
      status: "active",
      spec: {
        intent: "A固定镜头",
        references: [{ mediaId: refA, purpose: "composition" }],
      },
    },
    f.shot.revision,
  );
  let episodeB = await f.ok(
    "POST",
    `${f.path}/episodes`,
    { title: "另一集", position: 1, status: "active" },
    await f.next(),
  );
  let sceneB = await f.ok(
    "POST",
    `${f.path}/scenes`,
    {
      episodeId: episodeB.id,
      title: "另一场",
      summary: "未选的场次摘要",
      position: 0,
      state: {},
      status: "active",
    },
    await f.next(),
  );
  const shotB = await f.ok(
    "POST",
    `${f.path}/shots`,
    {
      sceneId: sceneB.id,
      label: "B",
      position: 0,
      status: "active",
      spec: {
        intent: "B固定旧镜头",
        references: [{ mediaId: refB, purpose: "composition" }],
        entryState: { spatialNotes: "B固定入口" },
        exitState: { spatialNotes: "B固定出口" },
      },
    },
    await f.next(),
  );
  let currentB = await f.ok(
    "PUT",
    `${f.path}/shots/${shotB.id}`,
    {
      sceneId: sceneB.id,
      label: "B新标题",
      position: 0,
      status: "active",
      spec: { intent: "B后来新要求", references: [] },
    },
    shotB.revision,
  );
  const selected = sources(shotB, shotA);
  let entry: any;

  await t.test("an empty selection remains a free canvas input", async () => {
    const empty = await draft.prepare([]);
    assert.deepEqual(empty.plan.input.shotSources, []);
    assert.deepEqual(empty.plan.resolvedInput.shots, []);
    assert.deepEqual(empty.plan.resolvedInput.references, []);
    assert.deepEqual(
      empty.plan.resolvedInput.dependencies.filter(
        (d: any) => d.kind === "shot_revision",
      ),
      [],
    );
    assert.equal(empty.plan.resolvedInput.prompt, f.input.prompt);
  });
  await t.test(
    "same-project cross-scene sources preserve requested order, old spec, continuity and references",
    async () => {
      entry = await draft.prepare(selected);
      assert.deepEqual(entry.plan.input.shotSources, selected);
      const resolved = entry.plan.resolvedInput;
      assert.deepEqual(
        resolved.shots.map((s: any) => ({
          shotId: s.shotId,
          shotRevisionId: s.shotRevisionId,
        })),
        selected,
      );
      assert.deepEqual(
        resolved.shots.map((s: any) => s.spec),
        [shotB.spec, shotA.spec],
      );
      assert.deepEqual(resolved.shots[0].entryState, {
        spatialNotes: "B固定入口",
      });
      assert.deepEqual(resolved.shots[0].exitState, {
        spatialNotes: "B固定出口",
      });
      assert.deepEqual(resolved.shots[1].entryState, {});
      assert.deepEqual(
        resolved.dependencies
          .filter((d: any) => d.kind === "shot_revision")
          .map((d: any) => [d.objectId, d.tracking]),
        [
          [shotB.specRevisionId, "fixed"],
          [shotA.specRevisionId, "fixed"],
        ],
      );
      assert.deepEqual(
        resolved.references.map((r: any) => [
          r.reference.mediaId,
          r.shotId,
          r.sourceObjectId,
        ]),
        [
          [refB, shotB.id, shotB.specRevisionId],
          [refA, shotA.id, shotA.specRevisionId],
        ],
      );
      assert.ok(
        resolved.prompt.indexOf("B固定旧镜头") <
          resolved.prompt.indexOf("A固定镜头"),
      );
      assert.doesNotMatch(resolved.prompt, /B后来新要求|未选的场次摘要/);
      const reversed = await draft.prepare(sources(shotA, shotB));
      assert.notEqual(
        reversed.origin.inputFingerprint,
        entry.origin.inputFingerprint,
      );
      assert.deepEqual(
        reversed.plan.resolvedInput.references.map(
          (r: any) => r.reference.mediaId,
        ),
        [refA, refB],
      );
      const replaced = await draft.prepare(selected, "replace");
      assert.equal(replaced.plan.resolvedInput.prompt, f.input.prompt);
      assert.deepEqual(replaced.plan.resolvedInput.shots, resolved.shots);
      assert.deepEqual(
        (
          await f.ok(
            "GET",
            `${f.path}/shots/${shotB.id}/revisions/${shotB.specRevisionId}`,
          )
        ).spec,
        shotB.spec,
      );
    },
  );
  await t.test(
    "duplicate versions, mismatched identities and another project's real shot are rejected",
    async () => {
      const foreignProject = await f.createProject("其他项目"),
        path = `${f.base}/projects/${foreignProject.id}`;
      const next = async () => (await f.ok("GET", `${path}/content`)).revision;
      const episode = await f.ok(
        "POST",
        `${path}/episodes`,
        { title: "一", position: 0, status: "active" },
        await next(),
      );
      const scene = await f.ok(
        "POST",
        `${path}/scenes`,
        {
          episodeId: episode.id,
          title: "异项目",
          summary: "不可隐式选择",
          position: 0,
          state: {},
          status: "active",
        },
        await next(),
      );
      const foreignShot = await f.ok(
        "POST",
        `${path}/shots`,
        {
          sceneId: scene.id,
          label: "X",
          position: 0,
          status: "active",
          spec: { intent: "异项目真实镜头", references: [] },
        },
        await next(),
      );
      for (const [input, status, code] of [
        [sources(shotB, currentB), 422, "DUPLICATE_SHOT_SOURCE"],
        [
          [{ shotId: shotA.id, shotRevisionId: shotB.specRevisionId }],
          404,
          "ASSISTANCE_SHOT_UNAVAILABLE",
        ],
        [sources(foreignShot), 404, "ASSISTANCE_SHOT_UNAVAILABLE"],
      ] as const) {
        const response = await draft.request([...input]);
        assert.equal(response.statusCode, status, response.body);
        assert.equal(response.json().code, code);
      }
    },
  );
  for (const kind of ["shot", "scene", "episode"] as const) {
    await t.test(
      `archiving a selected ${kind} before prepare or execute rejects a new job`,
      async () => {
        const before = await draft.prepare(selected);
        async function status(value: string) {
          if (kind === "shot")
            currentB = await f.ok(
              "PUT",
              `${f.path}/shots/${currentB.id}`,
              {
                sceneId: sceneB.id,
                label: currentB.label,
                position: currentB.position,
                spec: currentB.spec,
                status: value,
              },
              currentB.revision,
            );
          else if (kind === "scene")
            sceneB = await f.ok(
              "PUT",
              `${f.path}/scenes/${sceneB.id}`,
              {
                episodeId: episodeB.id,
                title: sceneB.title,
                summary: sceneB.summary,
                position: sceneB.position,
                state: sceneB.state,
                status: value,
              },
              sceneB.revision,
            );
          else
            episodeB = await f.ok(
              "PUT",
              `${f.path}/episodes/${episodeB.id}`,
              {
                title: episodeB.title,
                position: episodeB.position,
                status: value,
              },
              episodeB.revision,
            );
        }
        await status("archived");
        const prepare = await draft.request(selected);
        assert.equal(
          prepare.statusCode,
          kind === "shot" ? 404 : 409,
          prepare.body,
        );
        assert.equal(
          prepare.json().code,
          kind === "shot" ? "ASSISTANCE_SHOT_UNAVAILABLE" : "PARENT_ARCHIVED",
        );
        const execute = await f.request("POST", `${f.base}/generation-jobs`, {
          planId: before.plan.id,
        });
        assert.equal(execute.statusCode, 409, execute.body);
        assert.equal(
          execute.json().code,
          kind === "shot" ? "ASSISTANCE_SHOT_UNAVAILABLE" : "PARENT_ARCHIVED",
        );
        await status("active");
        assert.equal(
          (await f.ok("GET", `${f.base}/generation-plans/${before.plan.id}`))
            .status,
          "ready",
        );
      },
    );
  }
  await t.test(
    "after execute, archived source roots and deleted draft do not rewrite fixed text or lose result history",
    async () => {
      const job = await f.execute(entry.plan.id);
      currentB = await f.ok(
        "PUT",
        `${f.path}/shots/${currentB.id}`,
        {
          sceneId: sceneB.id,
          label: currentB.label,
          position: currentB.position,
          spec: currentB.spec,
          status: "archived",
        },
        currentB.revision,
      );
      sceneB = await f.ok(
        "PUT",
        `${f.path}/scenes/${sceneB.id}`,
        {
          episodeId: episodeB.id,
          title: sceneB.title,
          summary: sceneB.summary,
          position: sceneB.position,
          state: sceneB.state,
          status: "archived",
        },
        sceneB.revision,
      );
      episodeB = await f.ok(
        "PUT",
        `${f.path}/episodes/${episodeB.id}`,
        {
          title: episodeB.title,
          position: episodeB.position,
          status: "archived",
        },
        episodeB.revision,
      );
      const removed = await f.ok(
        "PUT",
        `${f.path}/canvases/${draft.canvas.id}`,
        { schemaVersion: 1, document: { nodes: [], edges: [], groups: [] } },
        draft.canvas.revision,
      );
      const calls = f.calls();
      await f.worker.process(job.id);
      assert.equal(f.calls(), calls + 1);
      assert.deepEqual(
        f.last()!.resolvedInput.shots,
        entry.plan.resolvedInput.shots,
      );
      assert.equal((await f.job(job.id)).status, "archiving");
      await acceptImage(f, job.id);
      const completed = await f.job(job.id);
      assert.equal(completed.status, "succeeded");
      assert.deepEqual(completed.mediaIds, [job.id]);
      assert.equal(completed.inputOutdated, true);
      assert.equal((await f.execute(entry.plan.id)).id, job.id);
      const plans = await f.ok(
        "GET",
        `${f.path}/canvases/${draft.canvas.id}/generation-plans?nodeId=${draft.nodeId}`,
      );
      const historical = plans.items.find(
        (p: any) => p.plan.id === entry.plan.id,
      );
      assert.equal(historical.jobId, job.id);
      assert.deepEqual(historical.plan.input.shotSources, selected);
      assert.deepEqual(
        historical.plan.resolvedInput.shots,
        entry.plan.resolvedInput.shots,
      );
      assert.deepEqual(historical.origin, entry.origin);
      assert.equal(
        (await f.ok("GET", `${f.base}/media/${job.id}`)).sourceJobId,
        job.id,
      );
      assert.deepEqual(
        (await f.ok("GET", `${f.path}/canvases/${draft.canvas.id}`)).document
          .nodes,
        [],
      );
      const placed = await f.ok(
        "POST",
        `${f.path}/canvases/${draft.canvas.id}/results`,
        { jobId: job.id, mediaIds: [job.id], position: { x: 0, y: 0 } },
        removed.revision,
      );
      assert.equal(placed.canvas.document.nodes.length, 1);
      assert.equal(placed.placements[0].mediaId, job.id);
      assert.equal(
        (await f.tree()).shots.find((shot: any) => shot.id === shotB.id).status,
        "archived",
      );
      assert.equal(
        (
          await f.admin.query(
            `SELECT count(*)::int AS n FROM ${f.scope}.takes WHERE media_id=$1`,
            [job.id],
          )
        ).rows[0].n,
        0,
      );
    },
  );
});

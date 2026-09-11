import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { imageGenerationFixture } from "../support/image-generation.js";

test("independent audio fixes dialogue and voice versions without adopting or binding results", async (t) => {
  const f = await imageGenerationFixture(t, undefined, { purpose: "audio" });
  const prepare = async (extra: Record<string, unknown> = {}) => {
    const p = await f.plan(extra);
    assert.equal(p.status, "ready");
    return p;
  };
  const accept = async (id: string, rejectBadTiming = false) => {
    const step = await f.envelope(id),
      token = randomUUID();
    const claim = (
      await f.mediaDb.query(
        `SELECT ${f.scope}.claim_generated_media($1,$2,$3,$4) AS c`,
        [id, step.stepRevision, step.epoch, token],
      )
    ).rows[0].c;
    assert.ok(claim);
    // Restricted SQL evidence only; actual WAV decoding has a separate real file test.
    const result = {
      object: {
        key: `originals/${randomUUID()}`,
        versionId: "relational-audio-fixture",
        bytes: claim.source.object.bytes,
        sha256: claim.source.sha256,
      },
      probe: {
        kind: "audio",
        mime: "audio/wav",
        hasAudio: true,
        durationUs: 2000000,
        timing: {
          frameRateMode: "unknown",
          audioSampleRate: 48000,
          audioChannels: 1,
        },
      },
    };
    if (rejectBadTiming)
      for (const probe of [
        { ...result.probe, durationUs: 2000021 },
        { ...result.probe, width: 32 },
        { ...result.probe, timing: {} },
      ])
        await assert.rejects(
          f.mediaDb.query(
            `SELECT ${f.scope}.finish_generated_media($1,$2,$3,NULL)`,
            [id, token, { ...result, probe }],
          ),
          /Audio sample/,
        );
    return (
      await f.mediaDb.query(
        `SELECT ${f.scope}.finish_generated_media($1,$2,$3,NULL) AS e`,
        [id, token, result],
      )
    ).rows[0].e;
  };
  let sampleMediaId: string, voice: any, voiceRevision: any, fixedShot: any;
  await t.test(
    "audio accepts only supported duration and cannot reinterpret a visual capability",
    async () => {
      for (const output of [
        {},
        { durationSeconds: 3 },
        { durationSeconds: 2, resolution: "32x32" },
        { durationSeconds: 2, aspectRatio: "1:1" },
        { durationSeconds: 2, withAudio: false },
      ])
        assert.equal(
          (
            await f.request("POST", `${f.base}/generation-plans`, {
              ...f.input,
              output,
            })
          ).statusCode,
          422,
        );
      const p = await prepare();
      assert.deepEqual(p.resolvedInput.output, { durationSeconds: 2 });
      assert.equal(f.calls(), 0);
    },
  );
  await t.test(
    "verified audio has actual sample timing and one independent proxy, with no visual poster or Take",
    async () => {
      const j = await f.execute((await prepare()).id);
      await f.worker.process(j.id);
      assert.equal((await f.job(j.id)).status, "archiving");
      assert.deepEqual((await f.job(j.id)).mediaIds, []);
      const envelope = await accept(j.id, true);
      assert.equal(envelope.taskKind, "media_derivative");
      const m = await f.ok("GET", `${f.base}/media/${j.id}`);
      sampleMediaId = j.id;
      assert.equal(m.kind, "audio");
      assert.equal(m.durationUs, 2000000);
      assert.equal(m.hasAudio, true);
      assert.equal(m.width, undefined);
      assert.equal(m.fpsNum, undefined);
      assert.deepEqual(
        m.derivatives.map((d: any) => d.kind),
        ["proxy"],
      );
      assert.equal(m.sourceJobId, j.id);
      assert.equal((await f.job(j.id)).status, "succeeded");
      assert.equal(
        (
          await f.admin.query(
            `SELECT count(*)::int AS n FROM ${f.scope}.takes WHERE media_id=$1`,
            [j.id],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await t.test(
    "explicit old voice and dialogue remain fixed after newer voice and shot edits; identity alone never loads latest voice",
    async () => {
      voice = await f.ok("POST", `${f.base}/assets`, {
        scope: "project",
        projectId: f.project.id,
        kind: "voice",
        name: "固定声音",
      });
      voiceRevision = await f.ok(
        "POST",
        `${f.base}/assets/${voice.id}/revisions`,
        {
          definition: {
            description: "旧声音设定",
            voiceDescription: "克制而清晰",
            references: [{ mediaId: sampleMediaId, purpose: "voice" }],
          },
        },
        voice.revision,
      );
      const character = await f.ok("POST", `${f.base}/assets`, {
        scope: "project",
        projectId: f.project.id,
        kind: "character",
        name: "说话人",
      });
      const lookId = randomUUID();
      const characterRevision = await f.ok(
        "POST",
        `${f.base}/assets/${character.id}/revisions`,
        {
          definition: {
            description: "固定角色",
            references: [],
            defaultVoiceAssetRevisionId: voiceRevision.id,
            looks: [
              { id: lookId, revision: 1, label: "默认造型", references: [] },
            ],
          },
        },
        character.revision,
      );
      const line = {
        id: randomUUID(),
        characterAssetId: character.id,
        text: "明确选定的原句",
        voiceAssetRevisionId: voiceRevision.id,
      };
      fixedShot = await f.ok(
        "PUT",
        `${f.path}/shots/${f.shot.id}`,
        {
          sceneId: f.scene.id,
          label: "01",
          position: 0,
          status: "active",
          spec: { intent: "对白试作", dialogue: [line], references: [] },
        },
        f.shot.revision,
      );
      const input = {
        shotSources: [
          { shotId: fixedShot.id, shotRevisionId: fixedShot.specRevisionId },
        ],
        promptPolicy: "append",
      };
      const p = await prepare(input);
      assert.equal(p.resolvedInput.shots[0].spec.dialogue[0].text, line.text);
      assert.ok(
        p.resolvedInput.contextSnapshots.some(
          (s: any) =>
            s.source.objectId === voiceRevision.id &&
            s.text.includes("旧声音设定"),
        ),
      );
      assert.equal(
        p.resolvedInput.references[0].reference.assetRevisionId,
        voiceRevision.id,
      );
      assert.equal(
        p.resolvedInput.references[0].reference.subjectAssetId,
        character.id,
      );
      const currentVoice = await f.ok("GET", `${f.base}/assets/${voice.id}`);
      await f.ok(
        "POST",
        `${f.base}/assets/${voice.id}/revisions`,
        {
          definition: {
            description: "后来声音",
            voiceDescription: "更高的音色",
            references: [{ mediaId: sampleMediaId, purpose: "voice" }],
          },
        },
        currentVoice.revision,
      );
      const newer = await f.ok(
        "PUT",
        `${f.path}/shots/${f.shot.id}`,
        {
          sceneId: f.scene.id,
          label: "01",
          position: 0,
          status: "active",
          spec: {
            intent: "新对白",
            dialogue: [{ ...line, text: "后来修改的句子" }],
            references: [],
          },
        },
        fixedShot.revision,
      );
      const j = await f.execute(p.id);
      await f.worker.process(j.id);
      assert.equal(
        f.last()!.resolvedInput.shots[0]!.spec.dialogue![0]!.text,
        line.text,
      );
      assert.match(f.last()!.resolvedInput.prompt, /旧声音设定/);
      assert.doesNotMatch(f.last()!.resolvedInput.prompt, /后来声音/);
      await accept(j.id);
      const neutral = await f.ok(
        "PUT",
        `${f.path}/shots/${f.shot.id}`,
        {
          sceneId: f.scene.id,
          label: "01",
          position: 0,
          status: "active",
          spec: {
            intent: "未选定声音",
            dialogue: [
              { id: line.id, characterAssetId: character.id, text: line.text },
            ],
            references: [],
          },
        },
        newer.revision,
      );
      const plain = await prepare({
        shotSources: [
          { shotId: neutral.id, shotRevisionId: neutral.specRevisionId },
        ],
      });
      assert.deepEqual(plain.resolvedInput.references, []);
      assert.deepEqual(plain.resolvedInput.contextSnapshots, []);
      const withFixedCharacter = await f.ok(
        "PUT",
        `${f.path}/shots/${f.shot.id}`,
        {
          sceneId: f.scene.id,
          label: "01",
          position: 0,
          status: "active",
          spec: {
            intent: "明确固定角色默认声音",
            dialogue: [
              { id: line.id, characterAssetId: character.id, text: line.text },
            ],
            entryState: {
              characters: [
                {
                  characterAssetId: character.id,
                  lookId,
                  lookAssetRevisionId: characterRevision.id,
                },
              ],
            },
            references: [],
          },
        },
        neutral.revision,
      );
      const defaultPlan = await prepare({
        shotSources: [
          {
            shotId: withFixedCharacter.id,
            shotRevisionId: withFixedCharacter.specRevisionId,
          },
        ],
      });
      assert.equal(
        defaultPlan.resolvedInput.references[0].reference.assetRevisionId,
        voiceRevision.id,
      );
      assert.ok(
        defaultPlan.resolvedInput.contextSnapshots.some(
          (s: any) => s.source.objectId === characterRevision.id,
        ),
      );
    },
  );
  await t.test(
    "archiving an explicitly fixed voice before dispatch cancels without another attempt",
    async () => {
      const p = await prepare({
          shotSources: [
            { shotId: fixedShot.id, shotRevisionId: fixedShot.specRevisionId },
          ],
        }),
        j = await f.execute(p.id),
        before = f.calls();
      await f.admin.query(
        `UPDATE ${f.scope}.assets SET status='archived',revision=revision+1,updated_at=now() WHERE id=$1`,
        [voice.id],
      );
      await f.worker.process(j.id);
      const done = await f.job(j.id);
      assert.equal(done.status, "cancelled");
      assert.equal(done.errorCode, "EXECUTION_SOURCE_UNAVAILABLE");
      assert.equal(f.calls(), before);
    },
  );
  await t.test(
    "unknown audio and failed archive queue completion preserve one original submit",
    async () => {
      f.setUnknown(true);
      const j = await f.execute((await prepare()).id),
        before = f.calls();
      await f.worker.process(j.id);
      await f.worker.process(j.id);
      assert.equal((await f.job(j.id)).status, "submission_unknown");
      assert.equal(f.calls(), before + 1);
      f.setUnknown(false);
      f.setQueueFailure(true);
      await assert.rejects(
        f.worker.reconcile(j.id),
        /Injected archive queue failure/,
      );
      f.setQueueFailure(false);
      await f.worker.process(j.id);
      await accept(j.id);
      assert.equal(f.calls(), before + 1);
      f.setOutput({ videos: [] });
      const bad = await f.execute((await prepare()).id);
      await f.worker.process(bad.id);
      assert.equal((await f.job(bad.id)).errorCode, "INVALID_AUDIO_OUTPUT");
      f.setOutput({
        audios: [
          {
            kind: "fixture_object",
            object: {
              key: `originals/${randomUUID()}`,
              versionId: "relational-fixture",
              bytes: 100,
            },
            sha256: "a".repeat(64),
            mime: "audio/wav",
          },
        ],
      });
    },
  );
  await t.test(
    "ambient audio can use an actual saved draft and recover the same explicit node after deletion",
    async () => {
      const ensured = await f.request(
        "POST",
        `${f.path}/scenes/${f.scene.id}/canvas`,
      );
      assert.equal(ensured.statusCode, 200, ensured.body);
      let canvas = ensured.json().canvas;
      const nodeId = randomUUID();
      let document: any = {
        nodes: [
          {
            id: nodeId,
            kind: "audio",
            title: "环境声草稿",
            position: { x: 0, y: 0 },
            width: 320,
            content: {
              type: "draft",
              prompt: f.input.prompt,
              connectionId: f.input.connectionId,
              capabilityId: f.input.capabilityId,
              output: f.input.output,
            },
          },
        ],
        edges: [],
        groups: [],
      };
      const save = async () =>
        (canvas = await f.ok(
          "PUT",
          `${f.path}/canvases/${canvas.id}`,
          { schemaVersion: 1, document },
          canvas.revision,
        ));
      await save();
      const p = await f.ok(
        "POST",
        `${f.path}/scenes/${f.scene.id}/canvas/generation-plans`,
        {
          nodeId,
          shotSources: [],
          referenceOverrides: [],
          promptPolicy: "replace",
        },
        canvas.revision,
      );
      assert.equal(p.plan.input.purpose, "audio");
      assert.deepEqual(p.plan.resolvedInput.shots, []);
      const j = await f.execute(p.plan.id);
      await f.worker.process(j.id);
      await accept(j.id);
      document.nodes = [];
      await save();
      assert.equal(
        (
          await f.ok(
            "GET",
            `${f.path}/canvases/${canvas.id}/generation-plans?nodeId=${nodeId}`,
          )
        ).items[0].jobId,
        j.id,
      );
      const body = {
        jobId: j.id,
        mediaIds: [j.id],
        position: { x: 400, y: 0 },
      };
      const placed = await f.ok(
        "POST",
        `${f.path}/canvases/${canvas.id}/results`,
        body,
        canvas.revision,
      );
      canvas = placed.canvas;
      assert.equal(canvas.document.nodes[0].kind, "audio");
      const originalId = placed.placements[0].nodeId;
      document = canvas.document;
      document.nodes = [];
      await save();
      const restored = await f.ok(
        "POST",
        `${f.path}/canvases/${canvas.id}/results`,
        body,
        canvas.revision,
      );
      assert.equal(restored.placements[0].nodeId, originalId);
      assert.equal(
        (
          await f.admin.query(
            `SELECT count(*)::int AS n FROM ${f.scope}.takes WHERE media_id=$1`,
            [j.id],
          )
        ).rows[0].n,
        0,
      );
    },
  );
});

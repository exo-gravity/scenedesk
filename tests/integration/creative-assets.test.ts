import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { businessFixture } from "../support/business.js";
import { Database } from "../../apps/api/src/kernel/database.js";

test("creative owners pin authorized asset, look, voice and media references through real commands", async (t) => {
  const f = await businessFixture(t),
    base = `/v1/tenants/${f.tenant.id}`;
  const other = await f.createProject("隔离项目");
  // Relational fixtures only; this suite does not claim to verify media bytes.
  async function media(projectId: string | null = f.project.id) {
    const id = randomUUID(),
      upload = randomUUID(),
      scope = projectId ? "project" : "shared";
    await f.admin.query(
      `INSERT INTO ${f.schema}.upload_intents(id,tenant_id,project_id,scope,staging_key,expected_bytes,expected_sha256,safe_file_name,mime_hint,display_name,created_by,status,expires_at,staging_version_id,epoch)
      VALUES($1,$2,$3,$4,$5,64,$6,'fixture.png','image/png','参考',$7,'accepted',now()+interval '15 minutes','fixture-version',1)`,
      [
        upload,
        f.tenant.id,
        projectId,
        scope,
        `staging/${upload}`,
        "a".repeat(64),
        f.owner.userId,
      ],
    );
    await f.admin.query(
      `INSERT INTO ${f.schema}.media(id,tenant_id,project_id,scope,kind,status,display_name,safe_original_file_name,created_by,source_upload_id,immutable_key,storage_version_id,sha256,bytes,mime,width,height,has_audio)
      VALUES($1,$2,$3,$4,'image','ready','参考','fixture.png',$5,$6,$7,'fixture-version',$8,64,'image/png',32,32,false)`,
      [
        id,
        f.tenant.id,
        projectId,
        scope,
        f.owner.userId,
        upload,
        `originals/${id}`,
        "a".repeat(64),
      ],
    );
    return id;
  }
  const original = await media(),
    unrelated = await media(),
    privateOther = await media(other.id),
    sharedMedia = await media(null);
  async function asset(
    kind: string,
    projectId: string | null = f.project.id,
    definition: any = { description: "人工设定", references: [] },
  ) {
    const root = await f.ok("POST", `${base}/assets`, {
      name: `验收${kind}`,
      kind,
      scope: projectId ? "project" : "shared",
      ...(projectId ? { projectId } : {}),
    });
    const revision = await f.ok(
      "POST",
      `${base}/assets/${root.id}/revisions`,
      { definition },
      1,
    );
    return { root, revision };
  }
  const look = randomUUID(),
    secondLook = randomUUID();
  const character = await asset("character", f.project.id, {
    description: "林晚",
    references: [{ mediaId: original, purpose: "identity" }],
    looks: [
      { id: look, revision: 1, label: "日常服", references: [] },
      { id: secondLook, revision: 1, label: "晚礼服", references: [] },
    ],
  });
  const prop = await asset("prop"),
    voice = await asset("voice", null),
    otherCharacter = await asset("character", other.id),
    foreign = await asset("character");
  const voice2 = await f.ok(
    "POST",
    `${base}/assets/${voice.root.id}/revisions`,
    { definition: { description: "新的声音方向", references: [] } },
    2,
  );
  await f.ok("POST", `${f.path}/shared-imports`, {
    assetRevisionId: voice.revision.id,
  });
  const episode = await f.ok(
    "POST",
    `${f.path}/episodes`,
    { title: "第一集", position: 0, status: "active" },
    await f.next(),
  );
  const state = {
    characters: [
      {
        characterAssetId: character.root.id,
        lookId: look,
        lookAssetRevisionId: character.revision.id,
        voiceAssetRevisionId: voice.revision.id,
        propAssetIds: [prop.root.id],
        emotion: "犹豫",
      },
    ],
    props: [
      {
        propAssetId: prop.root.id,
        propAssetRevisionId: prop.revision.id,
        holderCharacterAssetId: null,
        hand: "none",
        location: "桌上",
      },
    ],
    spatialNotes: "门在左边",
  };
  const sceneInput: any = {
    episodeId: episode.id,
    title: "旧公寓",
    position: 0,
    status: "active",
    summary: "重逢",
    state,
    defaultAssetRevisionIds: [character.revision.id],
  };
  let scene: any, shot: any;
  const dialogueId = randomUUID();
  const spec: any = {
    intent: "寻找钥匙",
    references: [
      {
        mediaId: original,
        assetRevisionId: character.revision.id,
        subjectAssetId: character.root.id,
        purpose: "identity",
        note: "仅作人工参考",
      },
    ],
    entryState: state,
    exitState: {
      characters: [{ characterAssetId: character.root.id, emotion: "释然" }],
    },
    dialogue: [
      {
        id: dialogueId,
        text: "钥匙还在这里。",
        characterAssetId: character.root.id,
        voiceAssetRevisionId: voice.revision.id,
      },
    ],
  };
  const sceneSave = (input: any, version = scene.revision) =>
    f.ok("PUT", `${f.path}/scenes/${scene.id}`, input, version);
  const shotInput = (value: any) => ({
    sceneId: scene.id,
    label: "01",
    position: 0,
    status: "active",
    spec: value,
  });
  const database = new Database(f.runtime, f.schema);
  const tx = <T>(run: Parameters<Database["transaction"]>[2]) =>
    database.transaction(
      f.owner.token,
      { tenantId: f.tenant.id, projectId: f.project.id, write: true },
      run,
    ) as Promise<T>;
  const read = async (table: string, where: string, id: string) =>
    (
      await f.admin.query(
        `SELECT * FROM ${f.schema}.${table} WHERE ${where}=$1`,
        [id],
      )
    ).rows;

  await t.test(
    "scene defaults and production defaults materialize typed references with their own CAS",
    async () => {
      scene = await f.ok(
        "POST",
        `${f.path}/scenes`,
        sceneInput,
        await f.next(),
      );
      assert.equal(scene.state.props[0].holderCharacterAssetId, null);
      assert.equal(
        (await read("creative_references", "scene_id", scene.id))[0]
          .asset_revision_id,
        character.revision.id,
      );
      const links = await read("creative_asset_bindings", "scene_id", scene.id);
      assert.equal(links.length, 5);
      assert.equal(links.find((r) => r.purpose === "look").look_id, look);
      const production = await f.ok("GET", `${f.path}/production`);
      const input = {
        title: "旧钥匙",
        brief: "人工制作",
        defaultAssetRevisionIds: [character.revision.id, voice.revision.id],
      };
      const key = randomUUID();
      const results = await Promise.all([
        f.request(
          "PUT",
          `${f.path}/production`,
          input,
          production.revision,
          key,
        ),
        f.request(
          "PUT",
          `${f.path}/production`,
          input,
          production.revision,
          key,
        ),
      ]);
      assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 412]);
      assert.equal(
        (await read("creative_references", "production_id", production.id))
          .length,
        2,
      );
      const changed = await f.ok(
        "PUT",
        `${f.path}/production`,
        { ...input, defaultAssetRevisionIds: [voice.revision.id] },
        production.revision + 1,
      );
      assert.equal(
        (await read("creative_references", "production_id", changed.id)).length,
        1,
      );
    },
  );
  await t.test(
    "shot revisions and dialogue projection pin exact look and voice independently of later asset versions",
    async () => {
      const key = randomUUID(),
        version = await f.next();
      const results = await Promise.all(
        Array.from({ length: 3 }, () =>
          f.request("POST", `${f.path}/shots`, shotInput(spec), version, key),
        ),
      );
      results.forEach((r) => assert.equal(r.statusCode, 201, r.body));
      shot = results[0]!.json();
      assert.ok(
        results.every((r) => r.json().specRevisionId === shot.specRevisionId),
      );
      const line = (
        await read("dialogue_lines", "shot_revision_id", shot.specRevisionId)
      )[0];
      assert.equal(line.speaker_asset_id, character.root.id);
      assert.equal(line.voice_asset_revision_id, voice.revision.id);
      assert.equal(
        (
          await read(
            "creative_asset_bindings",
            "shot_revision_id",
            shot.specRevisionId,
          )
        ).length,
        8,
      );
      const definition = structuredClone(character.revision.definition);
      definition.looks[0].label = "灰色外套";
      definition.looks[0].revision = 2;
      const newer = await f.ok(
        "POST",
        `${base}/assets/${character.root.id}/revisions`,
        { definition },
        2,
      );
      assert.notEqual(newer.id, character.revision.id);
      const saved = (await f.tree()).shots.find((s: any) => s.id === shot.id);
      assert.equal(
        saved.spec.entryState.characters[0].lookAssetRevisionId,
        character.revision.id,
      );
      assert.equal(
        saved.spec.dialogue[0].voiceAssetRevisionId,
        voice.revision.id,
      );
      const first = shot.specRevisionId;
      shot = await f.ok(
        "PUT",
        `${f.path}/shots/${shot.id}`,
        shotInput({ ...spec, intent: "仔细观察钥匙" }),
        shot.revision,
      );
      assert.notEqual(shot.specRevisionId, first);
      assert.equal(
        (await read("shot_revisions", "id", first))[0].spec.intent,
        spec.intent,
      );
      assert.equal(
        (await read("dialogue_lines", "shot_revision_id", first))[0]
          .voice_asset_revision_id,
        voice.revision.id,
      );
    },
  );
  await t.test(
    "wrong kind, look parent, shared revision, project, duplicate identities and media membership fail atomically",
    async () => {
      const failures: any[] = [
        { ...state, characters: [{ characterAssetId: prop.root.id }] },
        {
          ...state,
          characters: [
            {
              characterAssetId: foreign.root.id,
              lookId: look,
              lookAssetRevisionId: character.revision.id,
            },
          ],
        },
        {
          ...state,
          characters: [
            {
              characterAssetId: character.root.id,
              lookId: randomUUID(),
              lookAssetRevisionId: character.revision.id,
            },
          ],
        },
        {
          ...state,
          characters: [
            {
              characterAssetId: character.root.id,
              voiceAssetRevisionId: voice2.id,
            },
          ],
        },
        {
          ...state,
          characters: [{ characterAssetId: otherCharacter.root.id }],
        },
        {
          ...state,
          characters: [
            { characterAssetId: character.root.id },
            { characterAssetId: character.root.id.toUpperCase() },
          ],
        },
        {
          ...state,
          characters: [
            {
              characterAssetId: character.root.id,
              propAssetIds: [prop.root.id, prop.root.id],
            },
          ],
        },
        {
          ...state,
          props: [{ propAssetId: prop.root.id }, { propAssetId: prop.root.id }],
        },
        {
          ...state,
          props: [
            { propAssetId: prop.root.id, holderCharacterAssetId: prop.root.id },
          ],
        },
      ];
      const version = await f.next();
      for (const bad of failures) {
        const r = await f.request(
          "PUT",
          `${f.path}/scenes/${scene.id}`,
          { ...sceneInput, state: bad },
          scene.revision,
        );
        assert.equal(r.statusCode, 422, r.body);
      }
      for (const reference of [
        { mediaId: privateOther, purpose: "identity" },
        {
          mediaId: unrelated,
          assetRevisionId: character.revision.id,
          purpose: "identity",
        },
        {
          mediaId: original,
          assetRevisionId: character.revision.id,
          subjectAssetId: foreign.root.id,
          purpose: "identity",
        },
      ]) {
        const r = await f.request(
          "PUT",
          `${f.path}/shots/${shot.id}`,
          shotInput({ ...spec, references: [reference] }),
          shot.revision,
        );
        assert.equal(r.statusCode, 422, r.body);
      }
      assert.equal(await f.next(), version);
      assert.equal(
        (await read("scenes", "id", scene.id))[0].revision,
        String(scene.revision),
      );
    },
  );
  await t.test(
    "direct runtime writes cannot forge, remove or mutate derived dependencies and dialogue history",
    async () => {
      for (const query of [
        ["DELETE FROM creative_references WHERE scene_id=$1", [scene.id]],
        [
          "DELETE FROM creative_asset_bindings WHERE shot_revision_id=$1",
          [shot.specRevisionId],
        ],
        [
          "UPDATE creative_asset_bindings SET look_id=$1 WHERE shot_revision_id=$2",
          [secondLook, shot.specRevisionId],
        ],
        [
          "INSERT INTO creative_references(tenant_id,project_id,scene_id,slot,purpose,asset_revision_id) VALUES($1,$2,$3,'invented','default',$4)",
          [f.tenant.id, f.project.id, scene.id, voice.revision.id],
        ],
        [
          "INSERT INTO dialogue_lines(tenant_id,project_id,shot_revision_id,dialogue_id,text,speaker_asset_id) VALUES($1,$2,$3,$4,'伪造台词',$5)",
          [
            f.tenant.id,
            f.project.id,
            shot.specRevisionId,
            randomUUID(),
            character.root.id,
          ],
        ],
      ] as const)
        await assert.rejects(
          tx((t) => t.sql.query(query[0], [...query[1]])),
          (e: any) => ["23514", "42501"].includes(e.code),
        );
      // Same UUID from another tenant/project cannot be smuggled through an owner.
      await assert.rejects(
        tx((t) =>
          t.sql.query(
            "INSERT INTO creative_references(tenant_id,project_id,scene_id,slot,purpose,asset_revision_id) VALUES($1,$2,$3,$4,'default',$5)",
            [
              f.tenant.id,
              other.id,
              scene.id,
              `default/${character.revision.id}`,
              character.revision.id,
            ],
          ),
        ),
        (e: any) => ["23503", "23505", "23514"].includes(e.code),
      );
    },
  );
  await t.test(
    "quality media uses explicit project relationships, retained archive reads and scoped removal",
    async () => {
      const created = await f.ok("POST", `${base}/projects`, {
        name: "带共享样片的新项目",
        leadMembershipId: f.membership.id,
        spec: { ...f.project.spec, qualityReferenceMediaIds: [sharedMedia] },
      });
      assert.equal(
        (await read("project_quality_references", "project_id", created.id))
          .length,
        1,
      );
      let p = await f.ok("GET", f.path);
      p = await f.ok(
        "PATCH",
        f.path,
        {
          name: p.name,
          spec: {
            ...p.spec,
            qualityReferenceMediaIds: [original, sharedMedia],
          },
        },
        p.revision,
      );
      assert.equal(
        (await read("project_quality_references", "project_id", p.id)).length,
        2,
      );
      await assert.rejects(
        tx((t) =>
          t.sql.query(
            "DELETE FROM project_quality_references WHERE project_id=$1",
            [p.id],
          ),
        ),
        { code: "23514" },
      );
      const bad = await f.request(
        "PATCH",
        f.path,
        {
          name: p.name,
          spec: { ...p.spec, qualityReferenceMediaIds: [privateOther] },
        },
        p.revision,
      );
      assert.equal(bad.statusCode, 422, bad.body);
      p = await f.ok(
        "PATCH",
        f.path,
        {
          name: p.name,
          spec: { ...p.spec, qualityReferenceMediaIds: [original] },
        },
        p.revision,
      );
      assert.equal(
        (await read("project_quality_references", "project_id", p.id)).length,
        1,
      );
    },
  );
  await t.test(
    "proposal adoption revalidates newly archived references and rolls back the entire selected graph",
    async () => {
      let proposal = await f.ok(
        "POST",
        `${f.path}/shot-list-imports`,
        {
          csvText: "episode,scene,shot_label,intent\n第二集,走廊,02,敲门",
          target: { mode: "new_structure" },
        },
        await f.next(),
      );
      const operations = proposal.operations.map((o: any) =>
        o.kind === "shot"
          ? {
              ...o,
              proposed: {
                ...o.proposed,
                spec: {
                  ...o.proposed.spec,
                  entryState: {
                    characters: [{ characterAssetId: foreign.root.id }],
                  },
                },
              },
            }
          : o,
      );
      proposal = await f.ok(
        "PUT",
        `${f.path}/proposals/${proposal.id}`,
        {
          operations,
          target: proposal.target,
          baseContentRevision: proposal.baseContentRevision,
        },
        proposal.revision,
      );
      const root = await f.ok("GET", `${base}/assets/${foreign.root.id}`);
      await f.ok(
        "POST",
        `${base}/assets/${root.id}/archive`,
        undefined,
        root.revision,
      );
      const before = await f.tree();
      const result = await f.request(
        "POST",
        `${f.path}/proposals/${proposal.id}/apply`,
        {
          proposalRevision: proposal.revision,
          selectedOperationIds: operations.map((o: any) => o.opId),
        },
        before.revision,
      );
      assert.equal(result.statusCode, 422, result.body);
      assert.deepEqual(await f.tree(), before);
      assert.equal(
        (await f.ok("GET", `${f.path}/proposals/${proposal.id}`)).status,
        "proposed",
      );
    },
  );
  await t.test(
    "usage navigation lists actual fixed owners, filters private projects and rechecks revoked access before replay",
    async () => {
      const otherPath = `${base}/projects/${other.id}`;
      await f.ok("POST", `${otherPath}/shared-imports`, {
        assetRevisionId: voice.revision.id,
      });
      const production = await f.ok("GET", `${otherPath}/production`);
      await f.ok(
        "PUT",
        `${otherPath}/production`,
        {
          title: production.title,
          brief: "私有使用位置",
          defaultAssetRevisionIds: [voice.revision.id],
        },
        production.revision,
      );
      const member = await f.identity("creative-collaborator"),
        outsider = await f.identity("creative-reader"),
        membership = randomUUID();
      await f.admin.query(
        `INSERT INTO ${f.schema}.memberships(id,tenant_id,user_id,role) VALUES($1,$2,$3,'member'),($4,$2,$5,'member')`,
        [membership, f.tenant.id, member.userId, randomUUID(), outsider.userId],
      );
      await f.admin.query(
        `INSERT INTO ${f.schema}.project_memberships(id,tenant_id,project_id,membership_id,role) VALUES($1,$2,$3,$4,'collaborator')`,
        [randomUUID(), f.tenant.id, f.project.id, membership],
      );
      const uses = await f.ok(
        "GET",
        `${base}/assets/${character.root.id}/usages`,
      );
      assert.ok(
        uses.items.some(
          (u: any) => u.kind === "scene" && u.objectId === scene.id,
        ),
      );
      assert.ok(
        uses.items.some(
          (u: any) =>
            u.kind === "shot_revision" &&
            u.objectId === shot.specRevisionId &&
            u.shotId === shot.id,
        ),
      );
      for (const [who, expectPrivate] of [
        [f.owner, true],
        [member, false],
        [outsider, false],
      ] as const) {
        const result = await f.request(
          "GET",
          `${base}/assets/${voice.root.id}/usages`,
          undefined,
          undefined,
          randomUUID(),
          who,
        );
        assert.equal(result.statusCode, 200, result.body);
        assert.equal(
          result.json().items.some((u: any) => u.projectId === other.id),
          expectPrivate,
        );
        if (who === outsider) assert.deepEqual(result.json().items, []);
      }
      const key = randomUUID(),
        version = await f.next();
      const first = await f.request(
        "POST",
        `${f.path}/shots`,
        shotInput(spec),
        version,
        key,
        member,
      );
      assert.equal(first.statusCode, 201, first.body);
      await f.admin.query(
        `DELETE FROM ${f.schema}.project_memberships WHERE project_id=$1 AND membership_id=$2`,
        [f.project.id, membership],
      );
      const replay = await f.request(
        "POST",
        `${f.path}/shots`,
        shotInput(spec),
        version,
        key,
        member,
      );
      assert.equal(replay.statusCode, 404, replay.body);
      const hidden = await database.transaction(
        member.token,
        { tenantId: f.tenant.id, write: false },
        async (t) => {
          const counts = [];
          for (const table of [
            "creative_references",
            "creative_asset_bindings",
            "project_quality_references",
          ])
            counts.push((await t.sql.query(`SELECT * FROM ${table}`)).rowCount);
          return counts;
        },
      );
      assert.deepEqual(hidden, [0, 0, 0]);
    },
  );
  await t.test(
    "archive preserves the same semantic slots but cannot create, move, or resurrect a reference",
    async () => {
      const root = await f.ok("GET", `${base}/assets/${character.root.id}`);
      await f.ok(
        "POST",
        `${base}/assets/${root.id}/archive`,
        undefined,
        root.revision,
      );
      await tx((t) =>
        t.sql.query(
          "UPDATE media SET status='archived',revision=revision+1 WHERE id=$1",
          [original],
        ),
      );
      scene = await sceneSave({
        ...sceneInput,
        summary: "保留原造型与声音，只改说明",
      });
      const old = shot.specRevisionId;
      shot = await f.ok(
        "PUT",
        `${f.path}/shots/${shot.id}`,
        shotInput({
          ...spec,
          intent: "只调整意图",
          references: [
            { ...spec.references[0], note: "保留归档参考，仅改说明" },
          ],
        }),
        shot.revision,
      );
      assert.ok(
        (await read("creative_references", "shot_revision_id", old)).length,
      );
      const bad = await f.request(
        "POST",
        `${f.path}/shots`,
        shotInput(spec),
        await f.next(),
      );
      assert.equal(bad.statusCode, 422, bad.body);
      const moved = await f.request(
        "PUT",
        `${f.path}/shots/${shot.id}`,
        shotInput({ ...shot.spec, entryState: {}, exitState: state }),
        shot.revision,
      );
      assert.equal(moved.statusCode, 422, moved.body);
      const sceneWithout = {
        ...sceneInput,
        state: { spatialNotes: "移除角色" },
        defaultAssetRevisionIds: [],
      };
      scene = await sceneSave(sceneWithout);
      assert.equal(
        (await read("creative_asset_bindings", "scene_id", scene.id)).length,
        0,
      );
      const restored = await f.request(
        "PUT",
        `${f.path}/scenes/${scene.id}`,
        sceneInput,
        scene.revision,
      );
      assert.equal(restored.statusCode, 422, restored.body);
      let p = await f.ok("GET", f.path);
      p = await f.ok(
        "PATCH",
        f.path,
        { name: "保留样片", spec: p.spec },
        p.revision,
      );
      assert.deepEqual(p.spec.qualityReferenceMediaIds, [original]);
    },
  );
  await t.test(
    "proposal temporary identities cannot inherit an existing shot's archived bindings or implicit dialogue history",
    async () => {
      for (const [label, proposedSpec, code] of [
        ["归档绑定", shot.spec, "INVALID_CREATIVE_REFERENCE"],
        [
          "历史台词",
          {
            intent: "新镜头",
            references: [],
            dialogue: [
              {
                id: randomUUID(),
                text: "延续台词",
                sourceDialogueId: dialogueId,
              },
            ],
          },
          "INVALID_DIALOGUE_SOURCE",
        ],
      ] as const) {
        const proposal = await f.ok(
          "POST",
          `${f.path}/shot-list-imports`,
          {
            csvText: `episode,scene,shot_label,intent\n第一集,旧公寓,预校验,${label}`,
            target: {
              mode: "append_to_scene",
              sceneId: scene.id,
              sceneRevision: scene.revision,
              episodeId: episode.id,
            },
          },
          await f.next(),
        );
        const template = proposal.operations[0];
        const result = await f.request(
          "PUT",
          `${f.path}/proposals/${proposal.id}`,
          {
            target: proposal.target,
            baseContentRevision: proposal.baseContentRevision,
            operations: [
              ...proposal.operations,
              {
                ...template,
                opId: randomUUID(),
                temporaryId: shot.id,
                proposed: { ...template.proposed, spec: proposedSpec },
              },
            ],
          },
          proposal.revision,
        );
        assert.equal(result.statusCode, 422, result.body);
        assert.equal(result.json().code, code, result.body);
        assert.deepEqual(
          await f.ok("GET", `${f.path}/proposals/${proposal.id}`),
          proposal,
        );
      }
    },
  );
});

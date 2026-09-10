import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { businessFixture } from "../support/business.js";

test("manual tasks preserve unique scene responsibility, processing history and current membership authority", async (t) => {
  const {
    admin,
    schema,
    owner,
    identity,
    request,
    ok,
    tenant,
    project,
    path,
    next,
    createProject,
  } = await businessFixture(t);
  const a = await identity("artist-a"),
    b = await identity("artist-b");
  async function join(who: typeof owner, email: string) {
    const invite = await ok("POST", `/v1/tenants/${tenant.id}/invitations`, {
      email,
      role: "member",
    });
    const token = new URLSearchParams(
      new URL(invite.invitationUrl).hash.split("?")[1],
    ).get("token");
    const accepted = await request(
      "POST",
      "/v1/invitations/accept",
      { token },
      undefined,
      randomUUID(),
      who,
    );
    assert.equal(accepted.statusCode, 201, accepted.body);
    return accepted.json();
  }
  const ma = await join(a, "artist-a@example.test"),
    mb = await join(b, "artist-b@example.test");
  await ok("POST", `${path}/members`, { membershipId: ma.id });
  const episode = await ok(
    "POST",
    `${path}/episodes`,
    { title: "第一集", position: 0, status: "active" },
    await next(),
  );
  const makeScene = (title: string, position: number) =>
    next().then((version) =>
      ok(
        "POST",
        `${path}/scenes`,
        {
          episodeId: episode.id,
          title,
          position,
          summary: "",
          state: {},
          status: "active",
        },
        version,
      ),
    );
  const scene = await makeScene("旧公寓", 0),
    otherScene = await makeScene("电梯口", 1);
  const shot = await ok(
    "POST",
    `${path}/shots`,
    {
      sceneId: scene.id,
      label: "01",
      position: 0,
      spec: { intent: "推门", references: [] },
      status: "active",
    },
    await next(),
  );
  const input = {
    title: "完成旧公寓整场",
    kind: "scene_owner",
    assigneeMembershipId: ma.id,
    sceneId: scene.id,
    stage: "planning",
    status: "open",
    note: "确保服装与纸张连续",
  };
  const bodyOf = (task: any) => {
    const {
      id,
      revision,
      createdAt,
      updatedAt,
      projectId,
      assigneeAvailable,
      ...body
    } = task;
    return body;
  };
  const get = (id: string) => ok("GET", `${path}/tasks/${id}`);
  const history = async (id: string) =>
    (await ok("GET", `${path}/tasks/${id}/revisions`)).items;
  let task: any, assist: any;
  await t.test(
    "assignments require actual project eligibility; a scene has only one owner task including after completion",
    async () => {
      const unavailable = await request("POST", `${path}/tasks`, {
        ...input,
        assigneeMembershipId: mb.id,
      });
      assert.equal(unavailable.statusCode, 422);
      assert.equal(unavailable.json().code, "ASSIGNEE_UNAVAILABLE");
      assert.equal(
        (
          await request(
            "POST",
            `${path}/tasks`,
            input,
            undefined,
            randomUUID(),
            a,
          )
        ).statusCode,
        403,
      );
      const key = randomUUID();
      const same = await Promise.all([
        request("POST", `${path}/tasks`, input, undefined, key),
        request("POST", `${path}/tasks`, input, undefined, key),
      ]);
      same.forEach((r) => assert.equal(r.statusCode, 201, r.body));
      assert.deepEqual(same[0]!.json(), same[1]!.json());
      task = same[0]!.json();
      assert.equal(task.assigneeAvailable, true);
      const duplicate = await request("POST", `${path}/tasks`, input);
      assert.equal(duplicate.statusCode, 409);
      assert.equal(duplicate.json().code, "SCENE_OWNER_EXISTS");
      assert.equal(
        (await request("POST", `${path}/tasks`, { ...input, shotId: shot.id }))
          .statusCode,
        422,
      );
      assert.equal((await history(task.id)).length, 1);
    },
  );
  await t.test(
    "collaborators can process only their own tasks and cannot rewrite scope, title, deadline or assignment",
    async () => {
      await ok("POST", `${path}/members`, { membershipId: mb.id });
      const otherPerson = await request(
        "PATCH",
        `${path}/tasks/${task.id}`,
        { ...bodyOf(task), status: "done" },
        task.revision,
        randomUUID(),
        b,
      );
      assert.equal(otherPerson.statusCode, 403);
      for (const change of [
        { title: "绕过权限改名" },
        { assigneeMembershipId: mb.id },
        { stage: "delivery" },
        { dueAt: "2026-09-12T00:00:00Z" },
      ]) {
        const rejected = await request(
          "PATCH",
          `${path}/tasks/${task.id}`,
          { ...bodyOf(task), ...change },
          task.revision,
          randomUUID(),
          a,
        );
        assert.equal(rejected.statusCode, 403, rejected.body);
      }
      const processed = await request(
        "PATCH",
        `${path}/tasks/${task.id}`,
        {
          ...bodyOf(task),
          status: "in_progress",
          note: "已核对服装；纸张仍待确认。",
        },
        task.revision,
        randomUUID(),
        a,
      );
      assert.equal(processed.statusCode, 200, processed.body);
      task = processed.json();
      const revisions = await history(task.id);
      assert.equal(revisions.length, 2);
      assert.equal(revisions[0].snapshot.note, input.note);
      assert.equal(revisions[1].changedBy, a.userId);
      assert.equal(revisions[1].snapshot.status, "in_progress");
    },
  );
  await t.test(
    "concurrent task writes preserve one result; completion and reassignment retain identity and prior processing",
    async () => {
      const competing = await Promise.all([
        request(
          "PATCH",
          `${path}/tasks/${task.id}`,
          { ...bodyOf(task), status: "done" },
          task.revision,
          randomUUID(),
          a,
        ),
        request(
          "PATCH",
          `${path}/tasks/${task.id}`,
          { ...bodyOf(task), status: "blocked" },
          task.revision,
          randomUUID(),
          a,
        ),
      ]);
      assert.deepEqual(competing.map((r) => r.statusCode).sort(), [200, 412]);
      task = competing.find((r) => r.statusCode === 200)!.json();
      task = await ok(
        "PATCH",
        `${path}/tasks/${task.id}`,
        { ...bodyOf(task), status: "done" },
        task.revision,
      );
      assert.equal(
        (await request("POST", `${path}/tasks`, input)).statusCode,
        409,
      );
      const oldId = task.id,
        oldRevision = task.revision;
      task = await ok(
        "PATCH",
        `${path}/tasks/${task.id}`,
        { ...bodyOf(task), assigneeMembershipId: mb.id, status: "open" },
        task.revision,
      );
      assert.equal(task.id, oldId);
      assert.equal(task.revision, oldRevision + 1);
      assert.equal(task.note, "已核对服装；纸张仍待确认。");
      const saved = await history(task.id);
      assert.equal(saved.at(-2).snapshot.assigneeMembershipId, ma.id);
      assert.equal(saved.at(-1).snapshot.assigneeMembershipId, mb.id);
      assert.equal(saved.at(-1).changedBy, owner.userId);
      assert.equal(
        (
          await request(
            "PATCH",
            `${path}/tasks/${task.id}`,
            { ...bodyOf(task), status: "done" },
            task.revision,
            randomUUID(),
            a,
          )
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await request(
            "PATCH",
            `${path}/tasks/${task.id}`,
            { ...bodyOf(task), sceneId: otherScene.id },
            task.revision,
          )
        ).statusCode,
        422,
      );
    },
  );
  await t.test(
    "membership removal retains the original assignee visibly but revokes work",
    async () => {
      const projectMember = (await ok("GET", `${path}/members`)).items.find(
        (m: any) => m.membershipId === mb.id,
      );
      await ok(
        "DELETE",
        `${path}/members/${mb.id}`,
        undefined,
        projectMember.revision,
      );
      const orphan = await get(task.id);
      assert.equal(orphan.assigneeMembershipId, mb.id);
      assert.equal(orphan.assigneeAvailable, false);
      assert.equal(
        (
          await request(
            "PATCH",
            `${path}/tasks/${task.id}`,
            { ...bodyOf(orphan), status: "done" },
            orphan.revision,
            randomUUID(),
            b,
          )
        ).statusCode,
        404,
      );
      task = await ok(
        "PATCH",
        `${path}/tasks/${task.id}`,
        { ...bodyOf(orphan), assigneeMembershipId: ma.id },
        orphan.revision,
      );
      assert.equal(task.assigneeAvailable, true);
      const revisions = await history(task.id);
      assert.ok(
        revisions.some((r: any) => r.snapshot.assigneeMembershipId === mb.id),
      );
      const suspended = await ok(
        "PATCH",
        `/v1/tenants/${tenant.id}/members/${ma.id}`,
        { role: "member", status: "suspended" },
        ma.revision,
      );
      const paused = await get(task.id);
      assert.equal(paused.assigneeMembershipId, ma.id);
      assert.equal(paused.assigneeAvailable, false);
      assert.equal(paused.revision, task.revision);
      assert.deepEqual(await history(task.id), revisions);
      assert.equal(
        (
          await request(
            "PATCH",
            `${path}/tasks/${task.id}`,
            { ...bodyOf(paused), status: "done" },
            paused.revision,
            randomUUID(),
            a,
          )
        ).statusCode,
        404,
      );
      await ok(
        "PATCH",
        `/v1/tenants/${tenant.id}/members/${ma.id}`,
        { role: "member", status: "active" },
        suspended.revision,
      );
      assert.equal((await get(task.id)).assigneeAvailable, true);
    },
  );
  await t.test(
    "task scope has typed database links and a shot cannot silently move a scene-bound task",
    async () => {
      const basic = {
        title: "核对纸张",
        kind: "assist",
        stage: "planning",
        status: "open",
        assigneeMembershipId: ma.id,
        sceneId: scene.id,
        shotId: shot.id,
      };
      assert.equal(
        (
          await request("POST", `${path}/tasks`, {
            ...basic,
            sceneId: otherScene.id,
          })
        ).statusCode,
        422,
      );
      assist = await ok("POST", `${path}/tasks`, basic);
      const movement = {
        sceneId: otherScene.id,
        label: shot.label,
        position: shot.position,
        spec: shot.spec,
        status: shot.status,
      };
      const blocked = await request(
        "PUT",
        `${path}/shots/${shot.id}`,
        movement,
        shot.revision,
      );
      assert.equal(blocked.statusCode, 409);
      assert.equal(blocked.json().code, "TASK_SCOPE_WOULD_CHANGE");
      const { sceneId: _scene, ...withoutScene } = bodyOf(assist);
      assist = await ok(
        "PATCH",
        `${path}/tasks/${assist.id}`,
        withoutScene,
        assist.revision,
      );
      await ok("PUT", `${path}/shots/${shot.id}`, movement, shot.revision);
      assert.equal((await get(assist.id)).sceneId, undefined);
      assert.equal(
        (await ok("GET", `${path}/tasks?sceneId=${otherScene.id}`)).items[0].id,
        assist.id,
      );
      const second = await createProject("私有其他项目"),
        other = `/v1/tenants/${tenant.id}/projects/${second.id}`;
      assert.equal(
        (await request("GET", `${other}/tasks/${task.id}`)).statusCode,
        404,
      );
      assert.equal(
        (await request("POST", `${other}/tasks`, basic)).statusCode,
        422,
      ); // member A is not assigned there.
      await assert.rejects(
        admin.query(
          `INSERT INTO "${schema}".production_tasks (id,tenant_id,project_id,title,kind,scene_id,stage,status) VALUES ($1,$2,$3,'伪造','general',$4,'planning','open')`,
          [randomUUID(), tenant.id, second.id, scene.id],
        ),
        { code: "23503" },
      );
    },
  );
  await t.test(
    "immutable history cannot be rewritten and every task update needs its matching revision",
    async () => {
      await assert.rejects(
        admin.query(
          `DELETE FROM "${schema}".production_task_revisions WHERE task_id=$1`,
          [task.id],
        ),
        { code: "23514" },
      );
      await assert.rejects(
        admin.query(
          `UPDATE "${schema}".production_tasks SET kind='general',revision=revision+1 WHERE id=$1`,
          [task.id],
        ),
        { code: "23514" },
      );
      await assert.rejects(
        admin.query(
          `UPDATE "${schema}".production_tasks SET revision=revision+1,note='without history' WHERE id=$1`,
          [task.id],
        ),
        { code: "23503" },
      );
      assert.equal((await get(task.id)).note, task.note);
      const unsupported = await request("POST", `${path}/tasks`, {
        title: "虚构审片返工",
        kind: "rework",
        stage: "review",
        status: "open",
      });
      assert.equal(unsupported.statusCode, 422);
      assert.equal(unsupported.json().code, "REVIEW_NOT_READY");
      assert.equal(
        (
          await request("POST", `${path}/tasks`, {
            title: "无效\u0000文本",
            kind: "general",
            stage: "planning",
            status: "open",
          })
        ).statusCode,
        422,
      );
    },
  );
  await t.test(
    "task and revision cursors bind scope and all filters; general work needs no artificial shot",
    async () => {
      const general = await ok("POST", `${path}/tasks`, {
        title: "整理制作计划",
        kind: "general",
        stage: "planning",
        status: "open",
        dueAt: "2026-09-11T09:00:00+08:00",
      });
      assert.equal(general.sceneId, undefined);
      assert.equal(general.shotId, undefined);
      assert.equal(general.assigneeAvailable, false);
      assert.equal(general.dueAt, "2026-09-11T01:00:00.000Z");
      const first = await ok("GET", `${path}/tasks?limit=1`);
      assert.ok(first.nextCursor);
      assert.equal(
        (
          await request(
            "GET",
            `${path}/tasks?limit=1&status=open&cursor=${encodeURIComponent(first.nextCursor)}`,
          )
        ).statusCode,
        422,
      );
      const revisions = await ok(
        "GET",
        `${path}/tasks/${task.id}/revisions?limit=1`,
      );
      assert.ok(revisions.nextCursor);
      assert.equal(
        (
          await request(
            "GET",
            `${path}/tasks/${assist.id}/revisions?limit=1&cursor=${encodeURIComponent(revisions.nextCursor)}`,
          )
        ).statusCode,
        422,
      );
      assert.equal(
        (
          await ok(
            "GET",
            `${path}/tasks?kind=scene_owner&assigneeMembershipId=${ma.id}`,
          )
        ).items.length,
        1,
      );
    },
  );
});

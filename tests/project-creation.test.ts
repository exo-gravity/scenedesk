import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ProjectCreation,
  emptyProjectFields,
  trustedProjectRejection,
  validCreatedProject,
  type ProjectCreationRecord,
  type ProjectCreationStorage,
  type ProjectRequest,
} from "../apps/web/src/business/project-creation.js";
const tenant = "11111111-1111-4111-8111-111111111111",
  lead = "22222222-2222-4222-8222-222222222222";
const project = {
  id: "33333333-3333-4333-8333-333333333333",
  tenantId: tenant,
  revision: 1,
  kind: "drama" as const,
  name: "原项目",
  leadMembershipId: lead,
  status: "active" as "active" | "archived",
  spec: { width: 1080, height: 1920, fpsNum: 24, fpsDen: 1, language: "zh-CN" },
};
function memory() {
  let record: ProjectCreationRecord | undefined,
    readFails = false,
    writeFails = false,
    clearFails = false;
  let writes = 0,
    clears = 0;
  return {
    get record() {
      return record;
    },
    get writes() {
      return writes;
    },
    get clears() {
      return clears;
    },
    failRead(value: boolean) {
      readFails = value;
    },
    failWrite(value: boolean) {
      writeFails = value;
    },
    failClear(value: boolean) {
      clearFails = value;
    },
    storage: (): ProjectCreationStorage => ({
      read: async () => {
        if (readFails) throw Error("read failed");
        return record && structuredClone(record);
      },
      write: async (value) => {
        if (writeFails) throw Error("write failed");
        record = structuredClone(value);
        writes++;
      },
      clear: async () => {
        if (clearFails) throw Error("clear failed");
        record = undefined;
        clears++;
      },
      close() {},
    }),
  };
}
const fields = { ...emptyProjectFields, name: "原项目" };
const access = async () => {};
async function open(
  db: ReturnType<typeof memory>,
  create: (request: ProjectRequest) => Promise<unknown>,
  checkAccess = access,
) {
  const c = new ProjectCreation(
    db.storage(),
    { create, checkAccess },
    tenant,
    lead,
  );
  await c.load();
  return c;
}
test("project creation commits once after lost response, reload and expired HTTP receipt, preserving its durable original identity", async () => {
  const db = memory(),
    requests: ProjectRequest[] = [];
  let commits = 0,
    lose = true;
  const bindings = new Map<string, typeof project>();
  const create = async (request: ProjectRequest) => {
    assert.deepEqual(db.record?.request, request, "durable before POST");
    requests.push(request);
    const id = request.body.creationRequestId;
    if (!bindings.has(id)) {
      commits++;
      bindings.set(id, structuredClone(project));
    }
    if (lose) {
      lose = false;
      throw Error("lost 201 after commit");
    }
    return bindings.get(id);
  };
  const first = await open(db, create);
  first.edit(fields);
  assert.equal(await first.submit(), undefined);
  first.close();
  // More than the generic HTTP receipt window has passed; immutable binding remains.
  bindings.set(requests[0]!.body.creationRequestId, {
    ...project,
    revision: 3,
    name: "后来更名",
    status: "archived",
  });
  const restored = await open(db, create);
  assert.equal(requests.length, 1);
  assert.equal(restored.getSnapshot().recovered, true);
  restored.restore();
  const result = await restored.submit();
  assert.equal(result?.name, "后来更名");
  assert.equal(result?.status, "archived");
  assert.equal(commits, 1);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(db.record, undefined);
});
test("unreadable recovery cannot overwrite an existing request; write failure never submits", async () => {
  const db = memory();
  let posts = 0;
  const create = async () => {
    posts++;
    throw Error("unknown");
  };
  const first = await open(db, create);
  first.edit(fields);
  await first.submit();
  first.close();
  const original = structuredClone(db.record);
  db.failRead(true);
  const blocked = await open(db, create);
  blocked.edit({ ...fields, name: "不能覆盖" });
  await blocked.submit();
  assert.deepEqual(db.record, original);
  assert.equal(posts, 1);
  assert.equal(blocked.getSnapshot().ready, false);
  db.failRead(false);
  await blocked.load();
  blocked.restore();
  db.failWrite(true);
  await blocked.submit();
  assert.equal(posts, 1);
  assert.deepEqual(db.record, original);
});
test("only a complete trusted first business rejection permits editing; proxy and identity conflicts remain unresolved", async () => {
  const variants = [
    { status: 422, code: "INVALID_REQUEST", trustedBusinessRejection: true },
    { status: 422, code: "INVALID_REQUEST", trustedBusinessRejection: false },
    { status: 400, code: "UNAVAILABLE", trustedBusinessRejection: false },
    {
      status: 409,
      code: "IDEMPOTENCY_CONFLICT",
      trustedBusinessRejection: true,
    },
    {
      status: 409,
      code: "PROJECT_CREATION_CONFLICT",
      trustedBusinessRejection: true,
    },
  ];
  for (const problem of variants) {
    const db = memory(),
      c = await open(db, async () => {
        throw Object.assign(Error("rejected"), problem);
      });
    c.edit(fields);
    await c.submit();
    const original = db.record?.request;
    await c.returnToEditing();
    assert.equal(
      !c.getSnapshot().record.request,
      problem.status === 422 && problem.trustedBusinessRejection,
    );
    if (!(problem.status === 422 && problem.trustedBusinessRejection))
      assert.deepEqual(db.record?.request, original);
  }
  const body = {
    code: "INVALID_REQUEST",
    message: "字段无效",
    requestId: "request-1",
  };
  assert.equal(trustedProjectRejection(422, body), true);
  for (const bad of [
    { ...body, requestId: undefined },
    { ...body, requestId: 3 },
    { ...body, message: 3 },
    { ...body, details: [] },
    { ...body, proxy: true },
    { code: body.code, message: "proxy" },
  ])
    assert.equal(trustedProjectRejection(422, bad), false);
  assert.equal(trustedProjectRejection(400, body), false);
});
test("a later complete rejection cannot release a previously unknown project request", async () => {
  const db = memory();
  let first = true;
  const c = await open(db, async () => {
    if (first) {
      first = false;
      throw Error("lost after commit");
    }
    throw Object.assign(Error("validation"), {
      status: 422,
      code: "INVALID_REQUEST",
      trustedBusinessRejection: true,
    });
  });
  c.edit(fields);
  await c.submit();
  const fixed = structuredClone(db.record?.request);
  await c.submit();
  await c.returnToEditing();
  assert.deepEqual(db.record?.request, fixed);
});
test("malformed or foreign Project success never clears the original identity", async () => {
  for (const response of [
    {},
    { ...project, tenantId: lead },
    { ...project, revision: 0 },
    { ...project, kind: "other" },
    { ...project, createdAt: "bad" },
    { ...project, spec: { ...project.spec, fpsDen: 0 } },
  ]) {
    assert.equal(validCreatedProject(response, tenant), false);
    const db = memory(),
      c = await open(db, async () => response);
    c.edit(fields);
    assert.equal(await c.submit(), undefined);
    assert.ok(db.record?.request);
    assert.equal(db.clears, 0);
  }
  assert.equal(validCreatedProject(project, tenant), true);
});
test("confirmed result persists before cleanup; storage failures recover locally without another POST", async () => {
  const db = memory();
  let posts = 0;
  const c = await open(db, async () => {
    posts++;
    db.failClear(true);
    return project;
  });
  c.edit(fields);
  assert.equal(await c.submit(), undefined);
  assert.deepEqual(db.record?.result, project);
  assert.equal(c.getSnapshot().ready, true);
  db.failClear(false);
  assert.deepEqual(await c.submit(), project);
  assert.equal(posts, 1);
  assert.equal(db.record, undefined);
});
test("confirmed cleanup recovery rechecks current authority and retains the receipt when denied", async () => {
  const db = memory();
  let permitted = true,
    checks = 0,
    posts = 0;
  const c = await open(
    db,
    async () => {
      posts++;
      db.failClear(true);
      return project;
    },
    async () => {
      checks++;
      if (!permitted) throw Error("different user or role");
    },
  );
  c.edit(fields);
  await c.submit();
  const before = checks;
  permitted = false;
  db.failClear(false);
  assert.equal(await c.submit(), undefined);
  assert.ok(checks > before);
  assert.ok(db.record?.result);
  assert.equal(posts, 1);
  assert.equal(db.clears, 0);
});
test("closing while submission is in flight never navigates or clears a successor's request", async () => {
  const db = memory();
  let release: (value: unknown) => void = () => {},
    sent: () => void = () => {};
  const started = new Promise<void>((r) => {
    sent = r;
  });
  const first = await open(db, async () => {
    sent();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  first.edit(fields);
  const waiting = first.submit();
  await started;
  first.close();
  const successor = await open(db, async () => project);
  successor.restore();
  const record = structuredClone(db.record);
  release(project);
  assert.equal(await waiting, undefined);
  assert.deepEqual(db.record, record);
  assert.equal(db.clears, 0);
  assert.deepEqual(await successor.submit(), project);
});
test("accepted text writes register before close so a serial slot can drain them before reopening", async () => {
  let value: ProjectCreationRecord | undefined,
    queue = Promise.resolve(),
    release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const storage: ProjectCreationStorage = {
    read: async () => {
      await queue;
      return value;
    },
    write: (record) => {
      const copy = structuredClone(record);
      const work = queue.then(async () => {
        await gate;
        value = copy;
      });
      queue = work;
      return work;
    },
    clear: async () => {
      await queue;
      value = undefined;
    },
    close() {},
  };
  const first = new ProjectCreation(
    storage,
    { checkAccess: access, create: async () => project },
    tenant,
    lead,
  );
  await first.load();
  first.edit({ ...fields, name: "较早输入" });
  first.edit({ ...fields, name: "关闭前最后几字" });
  first.close();
  const successor = new ProjectCreation(
    storage,
    { checkAccess: access, create: async () => project },
    tenant,
    lead,
  );
  const loading = successor.load();
  release();
  await loading;
  assert.equal(successor.getSnapshot().record.fields.name, "关闭前最后几字");
});

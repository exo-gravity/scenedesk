import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sqlIdentifier } from "@drama/database";
import { Database } from "../../apps/api/src/kernel/database.js";
import { businessFixture } from "../support/business.js";
import { feishuFixture } from "../support/feishu.js";
import { docxFixture } from "../support/docx.js";

test("Feishu official-export snapshots preserve authority, preview identity, receipts and bounded recovery", async (t) => {
  const provider = feishuFixture(),
    f = await businessFixture(t, async () => ({ feishu: provider.services }));
  provider.config.tenantId = f.tenant.id;
  provider.config.sources = [
    { projectId: f.project.id, url: provider.sourceUrl },
    { projectId: f.project.id, url: provider.wikiUrl },
  ];
  const base = `${f.path}/feishu-imports`,
    scope = sqlIdentifier(f.schema);
  async function allowPoll(id: string) {
    await f.admin.query(
      `UPDATE ${scope}.feishu_script_imports SET next_poll_at=now()-interval '1 second' WHERE id=$1`,
      [id],
    );
  }
  async function start(url = provider.sourceUrl) {
    return f.ok("POST", base, { requestId: randomUUID(), sourceUrl: url });
  }
  async function preview(url = provider.sourceUrl) {
    const task = await start(url);
    await f.ok("POST", `${base}/${task.id}/advance`, {});
    await allowPoll(task.id);
    return f.ok("POST", `${base}/${task.id}/advance`, {});
  }
  assert.equal((await f.ok("GET", `${base}/availability`)).projectBound, true);
  const blocked = await f.request("POST", base, {
    requestId: randomUUID(),
    sourceUrl: provider.sourceUrl.replace(
      "SyntheticDocument001",
      "UnboundDocument001",
    ),
  });
  assert.equal(blocked.json().code, "FEISHU_SOURCE_NOT_ALLOWED");
  assert.equal(provider.state.creates, 0);
  const p = await preview(provider.wikiUrl);
  assert.equal(p.state, "ready");
  assert.match(p.preview.text, /钥匙在哪里/);
  assert.equal((await f.tree()).revision, 1);
  assert.equal((await f.ok("GET", `${f.path}/scripts`)).items.length, 0);
  const same = await f.ok("POST", base, {
    requestId: p.id,
    sourceUrl: provider.wikiUrl,
  });
  assert.equal(same.preview.sha256, p.preview.sha256);
  assert.equal(provider.state.creates, 1);
  // CHECK must reject missing / JSON null discriminator values even under a
  // restricted runtime SQL writer; NULL cannot bypass source provenance.
  const db = new Database(f.runtime, f.schema);
  const provenance = {
    provider: "feishu",
    previewId: p.id,
    sourceUrl: provider.wikiUrl,
    sourceKind: "wiki",
    documentId: provider.documentId,
    title: p.title,
    observedRevision: p.observedRevision,
    fetchedAt: p.fetchedAt,
    permissionCheckedAt: new Date().toISOString(),
    accessMode: "team_application",
  };
  for (const field of ["provider", "accessMode"]) {
    for (const mode of ["missing", "null"]) {
      const bad: Record<string, unknown> = { ...provenance };
      if (mode === "missing") delete bad[field];
      else bad[field] = null;
      await assert.rejects(
        db.transaction(
          f.owner.token,
          { tenantId: f.tenant.id, projectId: f.project.id, write: true },
          async (tx) => {
            await tx.sql.query(
              "INSERT INTO script_revisions(id,tenant_id,project_id,number,text,source_format,document,file_name,sha256,import_request_id,imported_by,import_base_version,source) SELECT $1,tenant_id,project_id,1,text,'docx',document,file_name,sha256,$2,actor_id,1,$3 FROM feishu_script_imports WHERE id=$4",
              [randomUUID(), randomUUID(), bad, p.id],
            );
          },
        ),
        { code: "23514" },
      );
    }
  }
  await assert.rejects(
    db.transaction(
      f.owner.token,
      { tenantId: f.tenant.id, projectId: f.project.id, write: true },
      async (tx) => {
        await tx.sql.query(
          "UPDATE feishu_script_imports SET text='forged' WHERE id=$1",
          [p.id],
        );
      },
    ),
    { code: "23514" },
  );
  const commit = {
    importRequestId: randomUUID(),
    previewSha256: p.preview.sha256,
  };
  provider.state.denied = true;
  assert.equal(
    (await f.request("POST", `${base}/${p.id}/confirm`, commit, 1)).json().code,
    "FEISHU_SOURCE_UNAVAILABLE",
  );
  provider.state.denied = false;
  provider.config.sources = [];
  assert.equal(
    (await f.request("POST", `${base}/${p.id}/confirm`, commit, 1)).json().code,
    "FEISHU_SOURCE_NOT_ALLOWED",
  );
  provider.config.sources = [
    { projectId: f.project.id, url: provider.wikiUrl },
    { projectId: f.project.id, url: provider.sourceUrl },
  ];
  provider.state.bytes = docxFixture(
    "<w:p><w:r><w:t>源文档已经更新，这不是预览的正文</w:t></w:r></w:p>",
  );
  provider.state.revision = 2;
  const saved = await f.ok("POST", `${base}/${p.id}/confirm`, commit, 1);
  assert.equal(saved.text, p.preview.text);
  assert.equal(saved.source.observedRevision, 1);
  assert.equal(provider.state.downloads, 1);
  assert.equal(
    (await f.ok("GET", `${f.path}/scripts/${saved.id}/original`)).data,
    p.preview
      ? (
          await f.admin.query(
            `SELECT encode(bytes,'base64') value FROM ${scope}.feishu_script_imports WHERE id=$1`,
            [p.id],
          )
        ).rows[0].value.replaceAll("\n", "")
      : "",
  );
  provider.state.denied = true;
  provider.config.sources = [];
  assert.equal(
    (await f.ok("GET", `${f.path}/script-imports/${commit.importRequestId}`))
      .script.id,
    saved.id,
  );
  assert.equal(
    (await f.ok("POST", `${base}/${p.id}/confirm`, commit, 1)).id,
    saved.id,
  );
  assert.equal(
    (await f.ok("GET", `${f.path}/scripts/${saved.id}`)).text,
    p.preview.text,
  );
  const other = await f.createProject("unbound project");
  assert.equal(
    (
      await f.request(
        "GET",
        `/v1/tenants/${f.tenant.id}/projects/${other.id}/feishu-imports/${p.id}`,
      )
    ).statusCode,
    404,
  );
  const outsider = await f.identity("feishu-outsider");
  assert.equal(
    (
      await f.request(
        "GET",
        `${base}/${p.id}`,
        undefined,
        undefined,
        randomUUID(),
        outsider,
      )
    ).statusCode,
    404,
  );
  provider.state.denied = false;
  provider.config.sources = [
    { projectId: f.project.id, url: provider.sourceUrl },
  ];
  // Success snapshots can be collected without affecting originals/receipts.
  const newer = await preview();
  assert.equal((await f.request("GET", `${base}/${p.id}`)).statusCode, 404);
  assert.equal(
    (await f.ok("GET", `${f.path}/scripts/${saved.id}/original`)).sha256,
    p.preview.sha256,
  );
  const nextCommit = {
    importRequestId: randomUUID(),
    previewSha256: newer.preview.sha256,
  };
  await f.ok(
    "POST",
    `${f.path}/scripts`,
    { text: "并发更新的当前稿" },
    await f.next(),
  );
  assert.equal(
    (await f.request("POST", `${base}/${newer.id}/confirm`, nextCommit, 2))
      .statusCode,
    412,
  );
  assert.equal(
    (await f.ok("GET", `${base}/${newer.id}`)).preview.text,
    newer.preview.text,
  );
  assert.equal(
    (
      await f.ok(
        "GET",
        `${f.path}/script-imports/${nextCommit.importRequestId}`,
      )
    ).found,
    false,
  );
  await f.ok("DELETE", `${base}/${newer.id}`);
  provider.state.createLost = true;
  const uncertain = await start();
  const unknown = await f.ok("POST", `${base}/${uncertain.id}/advance`, {});
  assert.equal(unknown.state, "unknown");
  const creates = provider.state.creates;
  assert.equal(
    (await f.ok("POST", `${base}/${uncertain.id}/advance`, {})).state,
    "unknown",
  );
  assert.equal(provider.state.creates, creates);
  provider.state.createLost = false;
  await f.ok("DELETE", `${base}/${uncertain.id}`);
  for (let n = 0; n < 5; n++) await start();
  assert.equal(
    (
      await f.request("POST", base, {
        requestId: randomUUID(),
        sourceUrl: provider.sourceUrl,
      })
    ).json().code,
    "FEISHU_PREVIEW_LIMIT",
  );
  await f.ok("POST", `${f.path}/archive`, undefined, f.project.revision);
  assert.equal(
    (await f.request("POST", `${base}/${p.id}/confirm`, commit, 1)).json().code,
    "PROJECT_ARCHIVED",
  );
  assert.equal(
    (await f.ok("GET", `${f.path}/script-imports/${commit.importRequestId}`))
      .script.id,
    saved.id,
  );
});

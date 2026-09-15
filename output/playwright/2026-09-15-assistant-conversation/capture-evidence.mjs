/**
 * Read-only evidence for this one isolated synthetic fixture; never targets the user demo.
 * Run: node output/playwright/2026-09-15-assistant-conversation/capture-evidence.mjs
 * Requires the original fixture to remain running. Each run writes a new capture directory.
 * Content hashes describe PostgreSQL JSONB text; inputHash/documentHash are stored domain hashes.
 */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const runId = "3ae7e622-a7eb-4b15-8796-0ebcb3cfafd1";
const tenantId = "75e5e584-7392-4f69-a9e8-7298b6d4b1ed";
const projectId = "14488dd1-6720-4ec7-ac2c-a42539bd5e01";
const origin = "http://localhost:4347";
const database = "drama_creative_e2e";
const image = "postgres:16.15-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685";
const runtime = resolve(root, `.runtime/creative-experience-${runId}`);
const evidenceRoot = resolve(dirname(fileURLToPath(import.meta.url)), runId);
const maximum = 5 * 1024 * 1024;

async function jsonFile(path) {
  assert((await stat(path)).size <= maximum);
  return JSON.parse(await readFile(path, "utf8"));
}
async function jsonGet(path) {
  const response = await fetch(`${origin}${path}`, {
    signal: AbortSignal.timeout(10000),
    redirect: "error",
    credentials: "omit",
  });
  assert.equal(response.status, 200);
  const bytes = await response.arrayBuffer();
  assert(bytes.byteLength <= maximum);
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}
function counters(value) {
  const output = {};
  for (const key of ["localAssistantCalls", "localScriptCalls", "localVideoCalls", "providerCalls"]) {
    assert(Number.isSafeInteger(value[key]) && value[key] >= 0);
    output[key] = value[key];
  }
  assert.equal(output.providerCalls, 0);
  return output;
}
function validateIds(ids) {
  assert.equal(ids.runId, runId);
  assert.equal(ids.tenantId, tenantId);
  assert.equal(ids.projectId, projectId);
  assert.equal(ids.origin, origin);
  assert.equal(ids.path, `/v1/tenants/${tenantId}/projects/${projectId}`);
}
async function readDatabase(containerId, sql) {
  return new Promise((resolveResult, reject) => {
    const child = spawn("docker", [
      "exec", "-i", containerId, "psql", "-X", "-q", "-A", "-t",
      "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database,
    ], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "", failed = false;
    const timeout = setTimeout(() => { failed = true; child.kill("SIGKILL"); }, 20000);
    child.stdout.on("data", chunk => {
      output += chunk.toString("utf8");
      if (Buffer.byteLength(output) > maximum) { failed = true; child.kill("SIGKILL"); }
    });
    // Do not echo SQL, connection details, or raw database errors into evidence.
    child.stderr.on("data", () => {});
    child.stdin.on("error", () => { failed = true; });
    child.on("error", () => { clearTimeout(timeout); reject(Error("DATABASE_READ_FAILED")); });
    child.on("close", code => {
      clearTimeout(timeout);
      if (failed || code !== 0) return reject(Error("DATABASE_READ_FAILED"));
      try { resolveResult(JSON.parse(output)); }
      catch { reject(Error("DATABASE_RESPONSE_INVALID")); }
    });
    child.stdin.end(sql);
  });
}

let stage = "validate_fixture";
try {
  const startedAt = new Date().toISOString();
  assert.equal((await stat(runtime)).mode & 0o777, 0o700);
  const resourcePath = resolve(runtime, "resources.json");
  assert.equal((await stat(resourcePath)).mode & 0o777, 0o600);
  const resources = await jsonFile(resourcePath);
  validateIds(await jsonFile(resolve(evidenceRoot, "fixture.json")));
  assert.equal(resources.pgName, `scenedesk-creative-e2e-${runId}`);
  assert.equal(resources.schema, "identity_1df4bb806e45");
  assert.equal(resources.distControl, resolve(runtime, "dist.json"));
  const idsBefore = await jsonGet("/__fixture/ids");
  validateIds(idsBefore);
  const beforeCounters = counters(idsBefore);
  const inspected = JSON.parse((await exec("docker", [
    "inspect", "--format",
    '{"id":{{json .Id}},"image":{{json .Config.Image}},"runId":{{json (index .Config.Labels "io.scenedesk.e2e.run")}},"running":{{json .State.Running}}}',
    resources.pgName,
  ], { timeout: 10000, maxBuffer: 65536 })).stdout);
  assert(/^[0-9a-f]{64}$/.test(inspected.id));
  assert.equal(inspected.image, image);
  assert.equal(inspected.runId, runId);
  assert.equal(inspected.running, true);
  const schema = `"${resources.schema}"`;
  const scope = `tenant_id = '${tenantId}'::uuid AND project_id = '${projectId}'::uuid`;
  stage = "read_fixture_database";
  const summary = await readDatabase(inspected.id, `
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
WITH
p AS (SELECT * FROM ${schema}.generation_plans WHERE ${scope}),
j AS (SELECT * FROM ${schema}.generation_jobs WHERE ${scope}),
a AS (SELECT * FROM ${schema}.assistance_artifacts WHERE ${scope}),
ar AS (SELECT * FROM ${schema}.assistance_artifact_revisions WHERE ${scope}),
c AS (SELECT * FROM ${schema}.canvases WHERE ${scope}),
plans AS (SELECT id, created_at, jsonb_build_object(
  'id',id,'purpose',input->'purpose','kind',input#>'{assistance,kind}',
  'status',status,'executionMode',execution_mode,'inputHash',input_hash,
  'assistanceSource',input->'assistanceSource',
  'historySources',coalesce((SELECT jsonb_agg(turn->'source' ORDER BY ordinal)
    FROM jsonb_array_elements(coalesce(resolved_input->'assistanceHistory','[]'::jsonb)) WITH ORDINALITY AS h(turn,ordinal)),'[]'::jsonb),
  'canvasId',coalesce(input->'canvasId',resolved_input#>'{canvasScope,canvasId}'),
  'fixedCanvasSources',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'canvasId',s->'canvasId','canvasRevision',s->'canvasRevision','nodeId',s->'nodeId','purpose',s->'purpose') ORDER BY ordinal)
    FROM jsonb_array_elements(coalesce(input->'canvasSources','[]'::jsonb)) WITH ORDINALITY AS cs(s,ordinal)),'[]'::jsonb)
) AS value FROM p),
jobs AS (SELECT id,created_at,jsonb_build_object('id',id,'planId',plan_id,'status',status,'proposalId',proposal_id) AS value FROM j),
artifacts AS (SELECT a.id,a.created_at,jsonb_build_object(
  'id',a.id,'jobId',a.generation_job_id,'currentRevision',a.revision,
  'kind',p.input#>'{assistance,kind}',
  'revisions',(SELECT jsonb_agg(jsonb_build_object('revision',ar.number,
    'bodySha256',encode(sha256(convert_to(ar.body::text,'UTF8')),'hex'),
    'bodyKeys',(SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(ar.body) AS k)) ORDER BY ar.number)
    FROM ar WHERE ar.artifact_id=a.id)
) AS value FROM a JOIN j ON j.id=a.generation_job_id JOIN p ON p.id=j.plan_id),
canvas_data AS (SELECT c.id,c.created_at,jsonb_build_object(
  'id',c.id,'revision',c.revision,'documentHash',b.hash,
  'nodeCount',jsonb_array_length(coalesce(b.document->'nodes','[]'::jsonb)),
  'edgeCount',jsonb_array_length(coalesce(b.document->'edges','[]'::jsonb)),
  'groupCount',jsonb_array_length(coalesce(b.document->'groups','[]'::jsonb)),
  'nodes',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',n->'id','kind',n->'kind','contentType',n#>'{content,type}',
    'contentSha256',encode(sha256(convert_to((n->'content')::text,'UTF8')),'hex'),
    'position',n->'position') ORDER BY n->>'id')
    FROM jsonb_array_elements(coalesce(b.document->'nodes','[]'::jsonb)) AS n),'[]'::jsonb)
) AS value FROM c
LEFT JOIN ${schema}.canvas_revisions r ON r.tenant_id=c.tenant_id AND r.project_id=c.project_id AND r.canvas_id=c.id AND r.revision=c.revision
LEFT JOIN ${schema}.canvas_history_bodies b ON b.tenant_id=r.tenant_id AND b.project_id=r.project_id AND b.canvas_id=r.canvas_id AND b.hash=r.body_hash)
SELECT jsonb_build_object(
  'database',current_database(),'readOnly',current_setting('transaction_read_only'),
  'projectExists',EXISTS(SELECT 1 FROM ${schema}.projects WHERE tenant_id='${tenantId}'::uuid AND id='${projectId}'::uuid),
  'counts',jsonb_build_object('plans',(SELECT count(*) FROM p),'jobs',(SELECT count(*) FROM j),'artifacts',(SELECT count(*) FROM a),'artifactRevisions',(SELECT count(*) FROM ar),'canvases',(SELECT count(*) FROM c)),
  'plans',coalesce((SELECT jsonb_agg(value ORDER BY created_at,id) FROM plans),'[]'::jsonb),
  'jobs',coalesce((SELECT jsonb_agg(value ORDER BY created_at,id) FROM jobs),'[]'::jsonb),
  'artifacts',coalesce((SELECT jsonb_agg(value ORDER BY created_at,id) FROM artifacts),'[]'::jsonb),
  'canvases',coalesce((SELECT jsonb_agg(value ORDER BY created_at,id) FROM canvas_data),'[]'::jsonb)
);
COMMIT;
`);
  assert.equal(summary.database, database);
  assert.equal(summary.readOnly, "on");
  assert.equal(summary.projectExists, true);
  stage = "read_safe_http_evidence";
  const requestResult = await jsonGet("/__fixture/requests");
  const build = await jsonGet("/__fixture/build");
  const idsAfter = await jsonGet("/__fixture/ids");
  validateIds(idsAfter);
  const afterCounters = counters(idsAfter);
  assert(Array.isArray(requestResult.requests));
  const requests = requestResult.requests.map(({ method, path, status }) => {
    assert(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method));
    assert(typeof path === "string" && /^\/v1\/[a-zA-Z0-9_./-]+$/.test(path));
    assert(Number.isInteger(status) && status >= 100 && status <= 599);
    return { method, path, status };
  });
  assert(/^[0-9a-f]{40}$/i.test(build.sourceCommit));
  assert(/^[0-9a-f]{64}$/i.test(build.indexSha256));
  assert(Array.isArray(build.scripts) && build.scripts.every(p => /^\/assets\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(p)));
  const result = {
    scope: "isolated_synthetic_fixture_only",
    runId, tenantId, projectId, origin,
    startedAt, completedAt: new Date().toISOString(),
    verification: { containerRunLabel: true, pinnedPostgresImage: true, databaseReadOnly: true, credentialsExported: false, requestBodiesExported: false, mediaUrlsExported: false, modelCallsByCollector: 0 },
    timing: "Database summary is one repeatable-read snapshot. HTTP requests and counters are sampled separately while UI can remain active; this is not a cross-system atomic snapshot.",
    build: { phase: build.phase, sourceCommit: build.sourceCommit, indexSha256: build.indexSha256, scripts: build.scripts },
    countersBefore: beforeCounters, requestCounters: counters(requestResult), countersAfter: afterCounters,
    database: summary,
    requests,
  };
  stage = "write_new_sanitized_evidence";
  const destination = resolve(evidenceRoot, `capture-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`);
  await mkdir(destination, { mode: 0o700 });
  await writeFile(resolve(destination, "evidence.json"), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ status: "ok", evidence: resolve(destination, "evidence.json"), counts: summary.counts, counters: afterCounters }));
} catch {
  console.error(JSON.stringify({ status: "failed", code: "ISOLATED_EVIDENCE_CAPTURE_FAILED", stage }));
  process.exitCode = 1;
}

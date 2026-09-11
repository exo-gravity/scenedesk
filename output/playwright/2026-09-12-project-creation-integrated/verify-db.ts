import assert from "node:assert/strict";
import { Pool } from "pg";

// Only the explicitly identified local browser fixture is inspected/expired.
// Load the repository's private local env files; never print connection strings.
const [mode, tenantId, creationId, projectId, key] = process.argv.slice(2);
assert.ok(mode === "expire" || mode === "verify");
for (const id of [tenantId, creationId, projectId, key])
  assert.match(id ?? "", /^[a-f0-9-]{36}$/);
const url = new URL(process.env.DATABASE_URL!);
assert.equal(process.env.APP_ENV, "local");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
assert.ok(url.pathname.startsWith("/drama_"));
const pool = new Pool({ connectionString: url.href, max: 1 });
try {
  const binding = await pool.query(
    "SELECT actor_id FROM drama.project_creation_requests WHERE tenant_id=$1 AND creation_request_id=$2 AND project_id=$3",
    [tenantId, creationId, projectId],
  );
  assert.equal(binding.rowCount, 1);
  let expiredReceipts = 0;
  if (mode === "expire") {
    const result = await pool.query(
      "UPDATE drama.idempotency_records SET expires_at=now()-interval '1 hour' WHERE actor_id=$1 AND scope_key=$2 AND operation_id='createProject' AND key=$3 RETURNING key",
      [binding.rows[0].actor_id, `tenant:${tenantId}`, key],
    );
    assert.equal(result.rowCount, 1);
    expiredReceipts = result.rowCount!;
  }
  const roots = await pool.query(
    "SELECT (SELECT count(*)::int FROM drama.projects WHERE tenant_id=$1 AND id=$2) AS projects, (SELECT count(*)::int FROM drama.project_memberships WHERE tenant_id=$1 AND project_id=$2) AS members, (SELECT count(*)::int FROM drama.productions WHERE tenant_id=$1 AND project_id=$2) AS productions, (SELECT count(*)::int FROM drama.project_content_versions WHERE tenant_id=$1 AND project_id=$2) AS content_roots",
    [tenantId, projectId],
  );
  assert.deepEqual(roots.rows[0], {
    projects: 1, members: 1, productions: 1, content_roots: 1,
  });
  console.log(JSON.stringify({ mode, projectId, bindings: 1, expiredReceipts, ...roots.rows[0] }));
} finally {
  await pool.end();
}

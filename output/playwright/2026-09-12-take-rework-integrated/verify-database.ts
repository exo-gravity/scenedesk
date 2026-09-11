import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Pool } from "pg";

const fixture = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
const flow = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const url = new URL(process.env.DATABASE_URL!);
assert.equal(process.env.APP_ENV, "local");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
assert.ok(url.pathname.startsWith("/drama_"));
const pool = new Pool({ connectionString: url.href, max: 1 });
try {
  const rows = await pool.query(`
    SELECT p.input,p.resolved_input,p.input_hash,
      drama.rework_input_hash(p.input,p.resolved_input,p.capability_revision,p.connection_version_id)=p.input_hash AS hash_valid,
      s.review_id,s.comment_id,s.comment_revision,s.take_id,s.shot_id,s.shot_revision_id,
      j.id AS job_id,j.status AS job_status,a.id AS artifact_id,a.revision AS artifact_revision,
      (SELECT count(*)::int FROM drama.reviews WHERE take_id=s.take_id) AS review_count,
      (SELECT count(*)::int FROM drama.review_comments WHERE review_id=s.review_id) AS comment_count,
      (SELECT count(*)::int FROM drama.generation_attempts WHERE job_id=j.id) AS attempt_count,
      (SELECT count(*)::int FROM drama.generation_jobs WHERE plan_id=p.id) AS job_count,
      (SELECT count(*)::int FROM drama.assistance_artifacts WHERE generation_job_id=j.id) AS artifact_count
    FROM drama.generation_plans p
    JOIN drama.generation_rework_inputs s ON s.plan_id=p.id
    JOIN drama.generation_jobs j ON j.plan_id=p.id
    JOIN drama.assistance_artifacts a ON a.generation_job_id=j.id
    WHERE p.tenant_id=$1 AND p.project_id=$2 AND p.id=$3`,
    [fixture.tenantId, fixture.projectId, flow.planId]);
  assert.equal(rows.rowCount, 1);
  const row = rows.rows[0];
  assert.equal(row.take_id, fixture.takeId);
  assert.equal(row.shot_id, fixture.shotId);
  assert.equal(row.shot_revision_id, fixture.takeShotRevisionId);
  assert.notEqual(row.shot_revision_id, fixture.latestShotRevisionId);
  assert.equal(row.review_id, flow.reviewId);
  assert.equal(row.comment_id, flow.commentId);
  assert.equal(row.job_id, flow.jobId);
  assert.equal(row.artifact_id, flow.artifactId);
  assert.equal(row.job_status, "succeeded");
  assert.equal(row.hash_valid, true);
  for (const key of ["review_count", "comment_count", "attempt_count", "job_count", "artifact_count"])
    assert.equal(row[key], 1, key);
  const history = await pool.query(`SELECT body FROM drama.review_comment_revisions
    WHERE tenant_id=$1 AND project_id=$2 AND review_id=$3 AND comment_id=$4 AND number=$5`,
    [fixture.tenantId, fixture.projectId, row.review_id, row.comment_id, row.comment_revision]);
  assert.equal(history.rowCount, 1);
  assert.equal(row.resolved_input.feedbackSnapshot.body, history.rows[0].body);
  assert.equal(row.resolved_input.feedbackSnapshot.commentRevision, Number(row.comment_revision));
  const head = await pool.query("SELECT current_revision_id,current_selection_id FROM drama.shots WHERE id=$1", [fixture.shotId]);
  assert.equal(head.rows[0].current_revision_id, fixture.latestShotRevisionId);
  assert.equal(head.rows[0].current_selection_id, null);
  console.log(JSON.stringify({
    actualPostgresql: true, hashValid: true, fixedOldTakeRequirements: true,
    reviewCount: 1, commentCount: 1, jobCount: 1, attemptCount: 1,
    artifactCount: 1, artifactRevision: Number(row.artifact_revision),
    fixedCommentRevision: Number(row.comment_revision),
    currentShotUnchanged: true, automaticallyAdopted: false,
  }));
} finally {
  await pool.end();
}

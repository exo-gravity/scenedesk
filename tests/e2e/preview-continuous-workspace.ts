import { startContinuousWorkspace } from "./continuous-workspace-fixture.js";

// Manual synthetic acceptance only. It cannot attach to the user's business DB.
const fixture = await startContinuousWorkspace(
  Number(process.env.SCENEDESK_E2E_PORT ?? 4481),
  process.env.SCENEDESK_E2E_HOST ?? "::1",
);
try { await fixture.seedAdvice(); }
catch (error) { await fixture.stop(); throw error; }
let closing = false;
let current: Promise<void> | undefined;
const tick = () => {
  if (closing || current) return;
  current = (async () => {
    const rows = await fixture.admin.query(
      `SELECT j.id FROM ${fixture.scope}.generation_jobs j JOIN ${fixture.scope}.generation_plans p ON p.id=j.plan_id WHERE j.status='queued' AND p.input->>'capabilityId'=$1`,
      [fixture.videoCapabilityId],
    );
    for (const row of rows.rows) await fixture.completeVideo(row.id);
  })().catch(error => {
    console.error("Synthetic preview worker could not finish a fixture job:", error.message);
  }).finally(() => { current = undefined; });
};
const timer = setInterval(tick, 1000);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  closing = true; clearInterval(timer);
  void (async () => { await current; await fixture.stop(); })().then(() => process.exit(0));
});
console.log(`Synthetic continuous-workspace preview: ${fixture.origin}/__fixture/sign-in`);
console.log("Only video fixture jobs advance automatically. The image is a synthetic reference; video is the checked-in blue/orange sample. Archive metadata uses restricted SQL fixture acceptance, not media decode or provider acceptance.");

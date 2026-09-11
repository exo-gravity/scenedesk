import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PgBoss } from "pg-boss";
const config = JSON.parse(await readFile("/run/secrets/config.json", "utf8"));
const boss = new PgBoss({
  connectionString: config.databaseUrl,
  schema: "scenedesk_queue",
  migrate: false,
  supervise: false,
  schedule: false,
});
boss.on("error", () => {});
try {
  await boss.start();
  await boss.send("media-probe", {
    taskKind:
      process.argv[2] === "invalid" ? "future_kind" : "media_production",
    businessId: randomUUID(),
    stepRevision: 1,
    epoch: 1,
  });
  console.log('{"status":"inserted_unsupported_test_hint"}');
} finally {
  await boss.stop();
}

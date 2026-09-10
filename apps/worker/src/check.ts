import { Pool } from "pg";
if (process.env.PROVIDER_MODE && process.env.PROVIDER_MODE !== "mock")
  throw new Error("Real providers disabled in S0");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 3000,
  max: 1,
});
try {
  const result = await pool.query(
    "SELECT value FROM drama.runtime_metadata WHERE key='implementation_phase'",
  );
  if (result.rows[0]?.value !== "s0") throw new Error("Run db:migrate first");
  console.log(
    JSON.stringify({
      workerPreflight: "pass",
      processingEnabled: false,
      reason:
        "Queue foundation has a separate queue:check; media business handlers are connected in E03",
    }),
  );
} finally {
  await pool.end();
}

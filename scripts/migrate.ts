import { Pool } from "pg";
import { migrate } from "@drama/database";
if (!process.env.DATABASE_URL)
  throw new Error("Set DATABASE_URL for the local S0 database");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  connectionTimeoutMillis: 3000,
});
try {
  console.log(
    JSON.stringify(
      await migrate(
        pool,
        new URL("../packages/database/migrations/", import.meta.url),
      ),
    ),
  );
} finally {
  await pool.end();
}

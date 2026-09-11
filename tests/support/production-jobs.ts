import { randomBytes, randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { Pool, type PoolClient } from "pg";
import { grantMediaWorkerAccess, sqlIdentifier } from "@drama/database";
import { createScheduler, grantQueueAccess, installQueue } from "@drama/queue";
import {
  ProductionJobs,
  makeProductionProfile,
  requestMediaProduction,
  type ProductionProfile,
  type MediaStore,
} from "@drama/media";
import { Database } from "../../apps/api/src/kernel/database.js";
import { businessFixture } from "./business.js";

export async function productionJobsFixture(
  t: TestContext,
  media?: MediaStore,
) {
  let f: Awaited<ReturnType<typeof businessFixture>> | undefined;
  let cleanupAdmin: Pool | undefined;
  const suffix = randomBytes(5).toString("hex"),
    queueSchema = `scenedesk_queue_${suffix}`;
  const roles: string[] = [],
    pools: Pool[] = [];
  let queueInstalled = false,
    producer: Awaited<ReturnType<typeof createScheduler>> | undefined;
  // Runs before the business fixture closes its admin pool.
  t.after(async () => {
    await producer?.close();
    for (const pool of pools) await pool.end();
    if (cleanupAdmin) {
      if (queueInstalled)
        await cleanupAdmin.query(
          `DROP SCHEMA ${sqlIdentifier(queueSchema)} CASCADE`,
        );
      for (const role of roles) {
        await cleanupAdmin.query(`DROP OWNED BY ${sqlIdentifier(role)}`);
        await cleanupAdmin.query(`DROP ROLE ${sqlIdentifier(role)}`);
      }
    }
  });
  f = await businessFixture(t, async (db) => {
    cleanupAdmin = db.admin;
    for (const prefix of ["production_worker", "production_scheduler"]) {
      const role = `${prefix}_${suffix}`,
        secret = randomBytes(24).toString("hex");
      await db.admin.query(
        `CREATE ROLE ${sqlIdentifier(role)} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD '${secret}'`,
      );
      roles.push(role);
      const url = new URL(process.env.DATABASE_URL!);
      url.username = role;
      url.password = secret;
      pools.push(new Pool({ connectionString: url.href, max: 4 }));
    }
    await installQueue(db.admin, queueSchema);
    queueInstalled = true;
    const grant = await db.admin.connect();
    try {
      await grantMediaWorkerAccess(grant, db.schema, roles[0]!, roles[1]!);
      await grantQueueAccess(grant, queueSchema, db.apiRole, roles[1]!);
      await grantQueueAccess(grant, queueSchema, roles[0]!, roles[1]!);
    } finally {
      grant.release();
    }
    producer = await createScheduler(db.runtime, {
      schema: queueSchema,
      onError: () => {},
    });
    return media
      ? { media: { store: media, schedule: producer.schedule } }
      : {};
  });
  const worker = pools[0]!,
    scheduler = pools[1]!;
  const schedule = producer!.schedule;
  const db = new Database(f.runtime, f.schema),
    jobs = new ProductionJobs(worker, f.schema);
  await jobs.verify();
  const transaction = <T>(
    run: (sql: PoolClient) => Promise<T>,
    token = f!.owner.token,
  ) =>
    db.transaction(
      token,
      { tenantId: f!.tenant.id, projectId: f!.project.id, write: false },
      (tx) => run(tx.sql),
    );
  const profile = makeProductionProfile(
    "video",
    "relational-fixture-v1",
    { imageId: `sha256:${"b".repeat(64)}`, platform: "linux/amd64" },
    "24/1",
  );
  // Relational source only; real content/storage is exercised in media tests.
  const seed = async (
    projectId: string | null = f!.project.id,
    hasAudio = false,
    sha = "a".repeat(64),
  ) => {
    const id = randomUUID(),
      upload = randomUUID(),
      scope = projectId ? "project" : "shared";
    await f!.admin.query(
      `INSERT INTO ${f!.schema}.upload_intents(id,tenant_id,project_id,scope,staging_key,expected_bytes,expected_sha256,safe_file_name,mime_hint,display_name,created_by,status,expires_at,staging_version_id,epoch)
      VALUES($1,$2,$3,$4,$5,64,$6,'fixture.mp4','video/mp4','关系测试',$7,'accepted',now()+interval '15 minutes','fixture-version',1)`,
      [
        upload,
        f!.tenant.id,
        projectId,
        scope,
        `staging/${upload}`,
        sha,
        f!.owner.userId,
      ],
    );
    await f!.admin.query(
      `INSERT INTO ${f!.schema}.media(id,tenant_id,project_id,scope,kind,status,display_name,safe_original_file_name,created_by,source_upload_id,immutable_key,storage_version_id,sha256,bytes,mime,width,height,has_audio,duration_us,fps_num,fps_den)
      VALUES($1,$2,$3,$4,'video','ready','关系测试','fixture.mp4',$5,$6,$7,'fixture-version',$8,64,'video/mp4',32,32,$9,4000000,24,1)`,
      [
        id,
        f!.tenant.id,
        projectId,
        scope,
        f!.owner.userId,
        upload,
        `originals/${id}`,
        sha,
        hasAudio,
      ],
    );
    return id;
  };
  const request = (
    sourceMediaId: string,
    fixedProfile: ProductionProfile = profile,
  ) =>
    transaction((sql) =>
      requestMediaProduction(sql, {
        schema: f!.schema,
        projectId: f!.project.id,
        sourceMediaId,
        profile: fixedProfile,
        schedule,
      }),
    );
  return {
    ...f,
    requestHttp: f.request,
    worker,
    scheduler,
    jobs,
    transaction,
    request,
    profile,
    seed,
    schedule,
    queueSchema,
  };
}

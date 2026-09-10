import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { sqlIdentifier } from "@drama/database";
import { digest, token } from "../../kernel/crypto.js";
import { requireThat } from "../../kernel/errors.js";

export type VerifiedIdentity = {
  issuer: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
};
/** Only a verified OIDC result or an explicitly configured local test issuer calls this service. */
export async function issueSession(
  pool: Pool,
  identity: VerifiedIdentity,
  options: { schema?: string; secretRef?: string; ttlSeconds?: number } = {},
) {
  const sql = await pool.connect();
  const sessionToken = token(),
    id = randomUUID();
  const ttl = options.ttlSeconds ?? 28_800;
  requireThat(
    Number.isInteger(ttl) && ttl >= 60 && ttl <= 86_400,
    422,
    "INVALID_SESSION_TTL",
    "会话有效期无效。",
  );
  try {
    await sql.query("BEGIN");
    await sql.query(
      `SET LOCAL search_path TO ${sqlIdentifier(options.schema ?? "drama")}, pg_catalog`,
    );
    const user = await sql.query(
      `INSERT INTO users (id,auth_issuer,auth_subject,verified_email,email_verified,display_name)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (auth_issuer,auth_subject) DO UPDATE
      SET verified_email=EXCLUDED.verified_email,email_verified=EXCLUDED.email_verified,
        display_name=EXCLUDED.display_name,revision=users.revision+1,updated_at=now()
      WHERE users.status='active' RETURNING id`,
      [
        randomUUID(),
        identity.issuer,
        identity.subject,
        identity.email.toLowerCase(),
        identity.emailVerified,
        identity.displayName,
      ],
    );
    requireThat(user.rows[0], 403, "USER_SUSPENDED", "此账号已停用。");
    await sql.query(
      "INSERT INTO sessions (id,user_id,token_hash,csrf_secret_ref,expires_at) VALUES ($1,$2,$3,$4,now()+$5*interval '1 second')",
      [
        id,
        user.rows[0].id,
        digest(sessionToken),
        options.secretRef ?? "application:v1",
        ttl,
      ],
    );
    await sql.query("COMMIT");
    return {
      id,
      userId: user.rows[0].id as string,
      token: sessionToken,
      ttlSeconds: ttl,
    };
  } catch (error) {
    await sql.query("ROLLBACK");
    throw error;
  } finally {
    sql.release();
  }
}

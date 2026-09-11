import type { FastifyInstance } from "fastify";
import { registerAction, type ApiContext } from "../../kernel/routes.js";
import type { Transaction } from "../../kernel/database.js";
import type { Schema } from "../content/model.js";

async function readPresence(
  tx: Transaction,
  target: Schema<"EditingTarget">,
): Promise<Schema<"EditingPresence">> {
  const result = await tx.sql.query(
    "SELECT * FROM get_editing_presence($1,$2,$3)",
    [tx.projectId, target.kind, target.objectId],
  );
  const clock = await tx.sql.query("SELECT clock_timestamp() AS now");
  return {
    target,
    serverTime: clock.rows[0].now.toISOString(),
    entries: result.rows.map((row) => ({
      membershipId: row.membership_id,
      clientSessionId: row.client_session_id,
      activity: row.activity,
      lastSeenAt: row.last_seen_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
    })),
  };
}
export function editingPresenceRoutes(
  app: FastifyInstance,
  context: ApiContext,
) {
  registerAction(app, context, "getEditingPresence", async (tx, input) => ({
    body: await readPresence(tx, {
      kind: input.query.kind as Schema<"EditingTarget">["kind"],
      objectId: input.query.objectId as string,
    }),
  }));
  registerAction(
    app,
    context,
    "updateEditingPresence",
    async (tx, input) => {
      const body = input.body as Schema<"UpdateEditingPresence">;
      const target = {
        ...body.target,
        objectId: body.target.objectId.toLowerCase(),
      };
      await tx.sql.query("SELECT put_editing_presence($1,$2,$3,$4,$5,$6)", [
        tx.projectId,
        target.kind,
        target.objectId,
        body.clientSessionId,
        body.activity,
        tx.session.id,
      ]);
      return { body: await readPresence(tx, target) };
    },
    { readOnly: true, audit: false },
  );
}

import type { FastifyInstance, HTTPMethods } from "fastify";
import { operationDefinition } from "@drama/contracts/validation";
import type { Transaction } from "../../../kernel/database.js";
import { canonical, digest } from "../../../kernel/crypto.js";
import { requireThat } from "../../../kernel/errors.js";
import {
  sessionCookie,
  type ApiContext,
  type Input,
  type Result,
} from "../../../kernel/routes.js";

// External reads deliberately run between short authorization transactions.
// Never hold project/tenant locks while waiting for Feishu.
export type Scope = <T>(action: (tx: Transaction) => Promise<T>) => Promise<T>;
export function phased(
  app: FastifyInstance,
  context: ApiContext,
  name: string,
  action: (scope: Scope, input: Input) => Promise<Result>,
) {
  const operation = operationDefinition(name);
  app.route({
    method: operation.method as HTTPMethods,
    url: operation.path.replace(/\{([^}]+)\}/g, ":$1"),
    async handler(request, reply) {
      const token = sessionCookie(request),
        params = request.params as Record<string, string>;
      requireThat(
        operation.validateInput({
          path: params,
          query: request.query,
          header: request.headers,
          body: request.body,
        }),
        422,
        "INVALID_REQUEST",
        "请求字段不符合接口要求。",
      );
      for (const key of Object.keys(params))
        params[key] = params[key]!.toLowerCase();
      requireThat(
        request.headers.origin === context.origin,
        403,
        "ORIGIN_REJECTED",
        "请求来源无效。",
      );
      requireThat(
        typeof request.headers["x-csrf-token"] === "string" &&
          context.secrets.equal(
            request.headers["x-csrf-token"],
            context.secrets.csrf(token),
          ),
        403,
        "CSRF_REJECTED",
        "会话校验失败，请刷新后重试。",
      );
      const match = request.headers["if-match"],
        version =
          typeof match === "string" ? Number(match.slice(1, -1)) : undefined;
      requireThat(
        version === undefined || Number.isSafeInteger(version),
        422,
        "INVALID_VERSION",
        "版本号无效。",
      );
      const input: Input = {
        params,
        body: request.body,
        query: request.query as Record<string, unknown>,
        csrfToken: context.secrets.csrf(token),
        ...(version === undefined ? {} : { version }),
      };
      const scope: Scope = (run) =>
        context.database.transaction(
          token,
          {
            tenantId: params.tenantId!,
            projectId: params.projectId!,
            write: true,
          },
          async (tx) => {
            requireThat(
              tx.projectRole,
              403,
              "FORBIDDEN",
              "当前成员无权访问项目。",
            );
            const project = await tx.sql.query(
              "SELECT status FROM projects WHERE tenant_id=$1 AND id=$2",
              [tx.tenantId, tx.projectId],
            );
            requireThat(
              project.rows[0]?.status === "active",
              409,
              "PROJECT_ARCHIVED",
              "项目已归档，请先恢复。",
            );
            return run(tx);
          },
        );
      // Cache only request identity, never replay stale permission-dependent data.
      await scope(async (tx) => {
        const path = operation.path.replace(
          /\{([^}]+)\}/g,
          (_, key: string) => params[key]!,
        );
        const identity = [
          tx.session.userId,
          `tenant:${tx.tenantId}`,
          name,
          path,
          request.headers["idempotency-key"],
        ];
        const identityText = JSON.stringify(identity),
          hash = digest(
            canonical({
              body: request.body,
              query: request.query,
              ifMatch: match ?? null,
            }),
          );
        await tx.sql.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [identityText],
        );
        const old = await tx.sql.query(
          "SELECT request_hash FROM idempotency_records WHERE actor_id=$1 AND scope_key=$2 AND operation_id=$3 AND request_path=$4 AND key=$5 AND expires_at>now()",
          identity,
        );
        if (old.rows[0])
          requireThat(
            old.rows[0].request_hash === hash,
            409,
            "IDEMPOTENCY_CONFLICT",
            "同一请求标识已用于不同内容。",
          );
        else {
          await tx.sql.query(
            "DELETE FROM idempotency_records WHERE actor_id=$1 AND scope_key=$2 AND operation_id=$3 AND request_path=$4 AND key=$5",
            identity,
          );
          await tx.sql.query(
            "INSERT INTO idempotency_records(actor_id,scope_key,operation_id,request_path,key,request_hash,response_ciphertext,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '24 hours')",
            [
              ...identity,
              hash,
              context.secrets.seal({ phased: true }, identityText),
            ],
          );
        }
      });
      const result = await action(scope, input);
      if (operation.validateOutput && !operation.validateOutput(result.body))
        throw new Error(`Response contract violation: ${name}`);
      reply.header("Cache-Control", "no-store");
      if (result.etag !== undefined) reply.header("ETag", `"${result.etag}"`);
      return reply.code(operation.successStatus).send(result.body);
    },
  });
}

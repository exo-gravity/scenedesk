import type { FastifyInstance, FastifyRequest, HTTPMethods } from "fastify";
import { operationDefinition } from "@drama/contracts/validation";
import type { Database, Transaction } from "./database.js";
import { audit } from "./database.js";
import { canonical, digest, Secrets } from "./crypto.js";
import { Problem, requireThat } from "./errors.js";

export type Input = {
  body: any;
  params: Record<string, string>;
  query: Record<string, unknown>;
  csrfToken: string;
  version?: number;
};
export type Result = {
  body?: unknown;
  etag?: number;
  clearSession?: boolean;
  accessTenantId?: string;
  auditObjectId?: string;
};
export type Action = (tx: Transaction, input: Input) => Promise<Result>;
export type ApiContext = {
  database: Database;
  secrets: Secrets;
  origin: string;
  secureCookies: boolean;
};

function sessionCookie(request: FastifyRequest) {
  const values = (request.headers.cookie ?? "")
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p.startsWith("session="));
  requireThat(values.length === 1, 401, "UNAUTHENTICATED", "请先登录。");
  const value = values[0]!.slice("session=".length);
  requireThat(
    /^[A-Za-z0-9_-]{43}$/.test(value),
    401,
    "UNAUTHENTICATED",
    "会话无效，请重新登录。",
  );
  return value;
}
function permission(tx: Transaction, name: string) {
  let allowed = false;
  switch (name) {
    case "authenticated":
      allowed = true;
      break;
    case "authenticated_verified_email":
      allowed = tx.session.emailVerified;
      break;
    case "tenant_member":
      allowed = !!tx.tenantRole;
      break;
    case "owner":
      allowed = tx.tenantRole === "owner";
      break;
    case "owner_admin":
    case "owner_admin_with_role_restrictions":
      allowed = ["owner", "admin"].includes(tx.tenantRole ?? "");
      break;
    case "project_member":
      allowed = !!tx.projectRole;
      break;
    case "project_lead_or_admin":
      allowed = ["admin", "lead"].includes(tx.projectRole ?? "");
      break;
    case "scope_member":
      allowed =
        tx.resourceScope === "project"
          ? !!tx.projectRole
          : ["shared", "all"].includes(tx.resourceScope ?? "") &&
            !!tx.tenantRole;
      break;
    case "project_member_or_shared_admin":
      allowed =
        tx.resourceScope === "project"
          ? !!tx.projectRole
          : tx.resourceScope === "shared" &&
            ["owner", "admin"].includes(tx.tenantRole ?? "");
      break;
    case "project_lead_or_shared_admin":
      allowed =
        tx.resourceScope === "project"
          ? ["admin", "lead"].includes(tx.projectRole ?? "")
          : tx.resourceScope === "shared" &&
            ["owner", "admin"].includes(tx.tenantRole ?? "");
      break;
    default:
      throw new Error(`Permission handler missing: ${name}`);
  }
  requireThat(allowed, 403, "FORBIDDEN", "当前成员无权执行此操作。");
}
export function installProblemHandler(app: FastifyInstance) {
  app.setErrorHandler(
    (error: Error & { code?: string; statusCode?: number }, request, reply) => {
      let problem: Problem;
      if (error instanceof Problem) problem = error;
      else if (error.code === "P0412")
        problem = new Problem(
          412,
          "VERSION_CONFLICT",
          "数据已更新，请刷新后核对。",
        );
      else if (error.code === "P0002")
        problem = new Problem(404, "NOT_FOUND", "内容不存在或无访问权限。");
      else if (error.code === "P0423")
        problem = new Problem(
          422,
          "INVALID_CANDIDATE",
          "请核对镜头、固定要求、视频及区间；新候选与采用需要可用的视频和未归档的镜头。",
        );
      else if (error.code === "P0409")
        problem = new Problem(
          409,
          "TAKE_REQUIREMENTS_CHANGED",
          "这个候选对应旧镜头要求。请先核对并明确沿用到当前要求，再采用。",
        );
      else if (error.code === "P0422")
        problem = new Problem(
          422,
          "INVALID_CREATIVE_REFERENCE",
          "引用无效：请核对资产种类、固定版本与造型、媒体归属及项目引入关系。同一层级不能重复引用，已归档内容只能保留原有引用。",
        );
      else if (
        ["23503", "23505", "23514", "40001", "40P01", "55P03"].includes(
          error.code ?? "",
        )
      )
        problem = new Problem(
          409,
          "CONFLICT",
          "操作与当前数据或并发修改冲突，请刷新后核对。",
        );
      else if (error.code === "42501")
        problem = new Problem(403, "FORBIDDEN", "当前成员无权执行此操作。");
      else if (
        error.statusCode &&
        error.statusCode >= 400 &&
        error.statusCode < 500
      )
        problem = new Problem(
          error.statusCode,
          "INVALID_REQUEST",
          "请求格式无效。",
        );
      else {
        request.log.error(
          { code: error.code, errorName: error.name, requestId: request.id },
          "Request failed",
        );
        problem = new Problem(
          500,
          "INTERNAL_ERROR",
          "操作未完成，请稍后重试。",
        );
      }
      void reply
        .code(problem.status)
        .header("Cache-Control", "no-store")
        .send({
          code: problem.code,
          message: problem.message,
          requestId: request.id,
          ...(problem.details ? { details: problem.details } : {}),
        });
    },
  );
}
export function registerAction(
  app: FastifyInstance,
  context: ApiContext,
  name: string,
  action: Action,
  options: {
    authorizeScope?: (tx: Transaction, input: Input) => Promise<void>;
    readOnly?: boolean;
  } = {},
) {
  const operation = operationDefinition(name);
  app.route({
    method: operation.method as HTTPMethods,
    url: operation.path.replace(/\{([^}]+)\}/g, ":$1"),
    // The contract permits 500,000 Unicode codepoints; escaped supplementary
    // characters can take twelve bytes each in the JSON request.
    ...(["reviseScript", "importShotList", "editProposal"].includes(name)
      ? { bodyLimit: 6 * 1024 * 1024 }
      : {}),
    async handler(request, reply) {
      const token = sessionCookie(request);
      const query = { ...(request.query as Record<string, unknown>) };
      for (const param of operation.parameters.filter(
        (p) => p.in === "query" && p.schema.type === "integer",
      )) {
        const value = query[param.name];
        if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value))
          query[param.name] = Number(value);
      }
      const params = request.params as Record<string, string>;
      const validationInput = {
        path: params,
        query,
        header: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
      };
      requireThat(
        operation.validateInput(validationInput),
        422,
        "INVALID_REQUEST",
        "请求字段不符合接口要求。",
      );
      for (const parameter of operation.parameters) {
        if (parameter.in === "path" && parameter.schema.format === "uuid")
          params[parameter.name] = params[parameter.name]!.toLowerCase();
        if (
          parameter.in === "query" &&
          parameter.schema.format === "uuid" &&
          typeof query[parameter.name] === "string"
        )
          query[parameter.name] = (
            query[parameter.name] as string
          ).toLowerCase();
      }
      const write = operation.method !== "GET";
      const businessWrite = write && !options.readOnly;
      if (write)
        requireThat(
          request.headers.origin === context.origin,
          403,
          "ORIGIN_REJECTED",
          "请求来源无效。",
        );
      const ifMatch = request.headers["if-match"];
      const expected =
        typeof ifMatch === "string" ? Number(ifMatch.slice(1, -1)) : undefined;
      if (expected !== undefined)
        requireThat(
          Number.isSafeInteger(expected),
          422,
          "INVALID_VERSION",
          "版本号无效。",
        );
      const scope = {
        write: businessWrite,
        ...(params.tenantId ? { tenantId: params.tenantId } : {}),
        ...(params.projectId ? { projectId: params.projectId } : {}),
      };
      const result = await context.database.transaction(
        token,
        scope,
        async (tx) => {
          if (write)
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
          const input: Input = {
            body: request.body,
            params,
            query,
            csrfToken: context.secrets.csrf(token),
            ...(expected === undefined ? {} : { version: expected }),
          };
          await options.authorizeScope?.(tx, input);
          permission(tx, operation.permission);
          if (
            name === "inviteMember" &&
            (request.body as { role: string }).role === "admin"
          )
            requireThat(
              tx.tenantRole === "owner",
              403,
              "FORBIDDEN",
              "只有工作室所有者可以邀请管理员。",
            );
          const key = request.headers["idempotency-key"];
          const cached =
            write && operation.method === "POST" && typeof key === "string";
          const scopeKey = tx.tenantId
            ? `tenant:${tx.tenantId}`
            : `user:${tx.session.userId}`;
          const path = operation.path.replace(
            /\{([^}]+)\}/g,
            (_, key: string) => params[key]!.toLowerCase(),
          );
          const identity = [tx.session.userId, scopeKey, name, path, key];
          const encryptionContext = JSON.stringify(identity);
          const requestHash = digest(
            canonical({
              body: request.body ?? null,
              query,
              ifMatch: ifMatch ?? null,
            }),
          );
          if (cached) {
            await tx.sql.query(
              "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
              [encryptionContext],
            );
            const old = await tx.sql.query(
              "SELECT request_hash, response_ciphertext FROM idempotency_records WHERE actor_id=$1 AND scope_key=$2 AND operation_id=$3 AND request_path=$4 AND key=$5 AND expires_at > now()",
              identity,
            );
            if (old.rows[0]) {
              requireThat(
                old.rows[0].request_hash === requestHash,
                409,
                "IDEMPOTENCY_CONFLICT",
                "同一请求标识已用于不同的内容。",
              );
              const replay = context.secrets.open<Result>(
                old.rows[0].response_ciphertext,
                encryptionContext,
              );
              if (replay.accessTenantId) {
                const access = await tx.sql.query(
                  "SELECT lock_tenant($1, false) AS role",
                  [replay.accessTenantId],
                );
                requireThat(
                  access.rows[0]?.role,
                  403,
                  "FORBIDDEN",
                  "当前成员已失去该工作室的访问权限。",
                );
              }
              return replay;
            }
            await tx.sql.query(
              "DELETE FROM idempotency_records WHERE actor_id=$1 AND scope_key=$2 AND operation_id=$3 AND request_path=$4 AND key=$5",
              identity,
            );
          }
          if (businessWrite && tx.projectId && name !== "restoreProject") {
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
          }
          const answer = await action(tx, input);
          if (
            operation.validateOutput &&
            !operation.validateOutput(answer.body)
          )
            throw new Error(`Response contract violation: ${name}`);
          if (write)
            await audit(
              tx,
              name,
              answer.auditObjectId ??
                (answer.body as { id?: string } | undefined)?.id,
            );
          if (cached)
            await tx.sql.query(
              "INSERT INTO idempotency_records (actor_id,scope_key,operation_id,request_path,key,request_hash,response_ciphertext,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now()+interval '24 hours')",
              [
                ...identity,
                requestHash,
                context.secrets.seal(answer, encryptionContext),
              ],
            );
          return answer;
        },
      );
      reply.header("Cache-Control", "no-store");
      if (result.etag !== undefined) reply.header("ETag", `"${result.etag}"`);
      if (result.clearSession)
        reply.header(
          "Set-Cookie",
          `session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${context.secureCookies ? "; Secure" : ""}`,
        );
      return reply.code(operation.successStatus).send(result.body);
    },
  });
}

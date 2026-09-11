import { randomUUID } from "node:crypto";
import type { components } from "@drama/contracts";
import {
  operationDefinition,
  validateContract,
} from "@drama/contracts/validation";
import {
  PRIVATE_JSON_MAX_BYTES,
  requireOperator,
  readPrivate,
  writePrivate,
  withPrivateLock,
} from "./private-files.js";

type Session = components["schemas"]["Session"];
type Tenant = components["schemas"]["Tenant"];
type Membership = components["schemas"]["Membership"];
type Body = components["schemas"]["CreateTenant"];
export type OperatorConfig = {
  origin: string;
  expectedUserId?: string;
  name: string;
  currency: string;
};
export type Credentials = { origin: string; token: string };
export type Attempt = {
  key: string;
  body: Body;
  status: "unknown" | "rejected" | "completed";
  preparedAt: string;
  rejection?: { status: number; code: string };
  tenant?: Tenant;
};
export type BootstrapRecord = {
  version: 1;
  origin: string;
  actorId: string;
  attempts: Attempt[];
  selectedExisting?: {
    tenantId: string;
    basis: "operator_choice_not_original_receipt";
  };
};
export type Transport = (
  path: string,
  request: {
    method: "GET" | "POST";
    headers: Record<string, string>;
    body?: string;
  },
) => Promise<{
  status: number;
  headers: Record<string, string>;
  body: unknown;
}>;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields = (value: unknown, names: string[]) => {
  requireOperator(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "INVALID_OPERATOR_CONFIG",
  );
  requireOperator(
    Object.keys(value as object).every((key) => names.includes(key)),
    "INVALID_OPERATOR_CONFIG",
  );
  return value as Record<string, unknown>;
};
export function canonicalOrigin(value: unknown) {
  requireOperator(typeof value === "string", "HTTPS_ORIGIN_REQUIRED");
  const parsed = new URL(value as string);
  requireOperator(
    parsed.protocol === "https:" &&
      parsed.origin === value &&
      !parsed.username &&
      !parsed.password,
    "HTTPS_ORIGIN_REQUIRED",
  );
  return parsed.origin;
}
export function parseConfig(value: unknown): OperatorConfig {
  const data = fields(value, ["origin", "expectedUserId", "name", "currency"]);
  const origin = canonicalOrigin(data.origin);
  requireOperator(
    data.expectedUserId === undefined ||
      (typeof data.expectedUserId === "string" &&
        uuid.test(data.expectedUserId)),
    "EXPECTED_USER_ID_INVALID",
  );
  requireOperator(
    validateContract("CreateTenant", {
      name: data.name,
      currency: data.currency,
    }).valid,
    "INVALID_TENANT_INPUT",
  );
  return {
    origin,
    name: data.name as string,
    currency: data.currency as string,
    ...(data.expectedUserId
      ? { expectedUserId: (data.expectedUserId as string).toLowerCase() }
      : {}),
  };
}
export function parseCredentials(value: unknown): Credentials {
  const data = fields(value, ["origin", "token"]);
  const origin = canonicalOrigin(data.origin);
  requireOperator(
    typeof data.token === "string" && /^[A-Za-z0-9_-]{43}$/.test(data.token),
    "SESSION_TOKEN_INVALID",
  );
  return { origin, token: data.token as string };
}
function parseRecord(value: unknown): BootstrapRecord | undefined {
  if (value === undefined) return;
  const record = fields(value, [
    "version",
    "origin",
    "actorId",
    "attempts",
    "selectedExisting",
  ]);
  requireOperator(
    record.version === 1 &&
      typeof record.actorId === "string" &&
      uuid.test(record.actorId) &&
      Array.isArray(record.attempts) &&
      record.attempts.length > 0 &&
      record.attempts.length <= 20,
    "BOOTSTRAP_RECORD_INVALID",
  );
  canonicalOrigin(record.origin);
  const attempts = record.attempts as unknown[];
  attempts.forEach((raw, index) => {
    const attempt = fields(raw, [
      "key",
      "body",
      "status",
      "preparedAt",
      "rejection",
      "tenant",
    ]);
    requireOperator(
      typeof attempt.key === "string" &&
        uuid.test(attempt.key) &&
        typeof attempt.preparedAt === "string" &&
        Number.isFinite(Date.parse(attempt.preparedAt)) &&
        validateContract("CreateTenant", attempt.body).valid,
      "BOOTSTRAP_RECORD_INVALID",
    );
    requireOperator(
      ["unknown", "rejected", "completed"].includes(attempt.status as string) &&
        (index === attempts.length - 1 || attempt.status === "rejected"),
      "BOOTSTRAP_RECORD_INVALID",
    );
    if (attempt.status === "completed")
      requireOperator(
        validateContract("Tenant", attempt.tenant).valid &&
          (attempt.tenant as Tenant).ownerUserId === record.actorId,
        "BOOTSTRAP_RECORD_INVALID",
      );
    if (attempt.status === "rejected")
      requireOperator(
        knownRejection(
          (attempt.rejection as { status?: number } | undefined)?.status ?? 0,
          {
            code: (attempt.rejection as { code?: string } | undefined)?.code,
            message: "recorded",
            requestId: "recorded",
          },
        ),
        "BOOTSTRAP_RECORD_INVALID",
      );
  });
  if (record.selectedExisting) {
    const selected = fields(record.selectedExisting, ["tenantId", "basis"]);
    requireOperator(
      typeof selected.tenantId === "string" &&
        uuid.test(selected.tenantId) &&
        selected.basis === "operator_choice_not_original_receipt",
      "BOOTSTRAP_RECORD_INVALID",
    );
  }
  return record as BootstrapRecord;
}
function knownRejection(status: number, body: unknown) {
  if (!validateContract("Error", body).valid) return false;
  const error = body as { code: string; requestId?: string };
  return (
    typeof error.requestId === "string" &&
    error.requestId.length > 0 &&
    new Set([
      "422:INVALID_REQUEST",
      "403:ORIGIN_REJECTED",
      "403:CSRF_REJECTED",
      "401:UNAUTHENTICATED",
    ]).has(`${status}:${error.code}`)
  );
}
export function httpTransport(origin: string): Transport {
  canonicalOrigin(origin);
  return async (path, request) => {
    requireOperator(
      path.startsWith("/v1/") && !path.includes("#"),
      "OPERATOR_PATH_INVALID",
    );
    const response = await fetch(new URL(path, origin), {
      ...request,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const type = response.headers.get("content-type") ?? "";
    requireOperator(
      /^application\/json(?:;|$)/i.test(type),
      "API_RESPONSE_UNVERIFIED",
    );
    const reader = response.body?.getReader();
    requireOperator(reader, "API_RESPONSE_UNVERIFIED");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader!.read();
        if (done) break;
        bytes += value.byteLength;
        requireOperator(
          bytes <= PRIVATE_JSON_MAX_BYTES,
          "API_RESPONSE_TOO_LARGE",
        );
        chunks.push(value);
      }
    } catch (error) {
      await reader!.cancel().catch(() => {});
      throw error;
    } finally {
      reader!.releaseLock();
    }
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
    };
  };
}
export async function bootstrap(options: {
  config: OperatorConfig;
  credentials: Credentials;
  recordFile: string;
  apply?: boolean;
  selectExisting?: string;
  transport?: Transport;
}) {
  const { config, credentials, recordFile } = options;
  requireOperator(config.origin === credentials.origin, "ORIGIN_MISMATCH");
  requireOperator(
    !(options.apply && options.selectExisting),
    "CHOOSE_ONE_OPERATOR_ACTION",
  );
  if (options.selectExisting)
    requireOperator(uuid.test(options.selectExisting), "TENANT_ID_INVALID");
  const request = options.transport ?? httpTransport(config.origin);
  const headers = {
    cookie: `session=${credentials.token}`,
    origin: config.origin,
    accept: "application/json",
  };
  const read = async <T>(path: string, operation: string): Promise<T> => {
    const response = await request(path, { method: "GET", headers });
    requireOperator(response.status === 200, "PREFLIGHT_ACCESS_FAILED");
    requireOperator(
      operationDefinition(operation).validateOutput?.(response.body),
      "API_RESPONSE_UNVERIFIED",
    );
    return response.body as T;
  };
  const all = async <T>(path: string, operation: string) => {
    const items: T[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const page = await read<{ items: T[]; nextCursor?: string }>(
        `${path}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        operation,
      );
      items.push(...page.items);
      requireOperator(items.length <= 10000, "PREFLIGHT_LIST_LIMIT");
      cursor = page.nextCursor;
      if (cursor) {
        requireOperator(!seen.has(cursor), "PREFLIGHT_CURSOR_INVALID");
        seen.add(cursor);
      }
    } while (cursor);
    return items;
  };
  return withPrivateLock(recordFile, async () => {
    let record = parseRecord(await readPrivate(recordFile, true));
    requireOperator(
      !record || record.origin === config.origin,
      "RECORD_IDENTITY_MISMATCH",
    );
    const session = await read<Session>("/v1/session", "getSession");
    requireOperator(
      !config.expectedUserId || session.userId === config.expectedUserId,
      "ACTOR_MISMATCH",
    );
    requireOperator(
      !record ||
        (record.origin === config.origin && record.actorId === session.userId),
      "RECORD_IDENTITY_MISMATCH",
    );
    const tenants = await all<Tenant>("/v1/tenants", "listTenants");
    const own = async (id: string) => {
      const tenant = await read<Tenant>(`/v1/tenants/${id}`, "getTenant");
      const members = await all<Membership>(
        `/v1/tenants/${id}/members`,
        "listMembers",
      );
      requireOperator(
        tenant.status === "active" &&
          tenant.ownerUserId === session.userId &&
          members.some(
            (member) =>
              member.userId === session.userId &&
              member.status === "active" &&
              member.role === "owner",
          ),
        "ACTIVE_OWNER_REQUIRED",
      );
      return tenant;
    };
    const report = async (status: string, tenant?: Tenant) => {
      await writePrivate(`${recordFile}.review.json`, {
        status,
        origin: config.origin,
        currentIdentity: {
          userId: session.userId,
          email: session.email,
          displayName: session.displayName,
        },
        existingTenantCount: tenants.length,
        existingTenantsTruncated: tenants.length > 100,
        existingTenants: tenants
          .slice(0, 100)
          .map(({ id, name, status, ownerUserId }) => ({
            id,
            name,
            status,
            ownerUserId,
          })),
        requestedInput: { name: config.name, currency: config.currency },
        originalRequestStatus: record?.attempts.at(-1)?.status ?? "not_sent",
        ...(tenant
          ? {
              selectedTenant: tenant,
              continueUrl: `${config.origin}/#/app/t/${tenant.id}`,
            }
          : {}),
        originalReceiptProven: record?.attempts.at(-1)?.status === "completed",
      });
      return { status, existingTenantCount: tenants.length };
    };
    const last = record?.attempts.at(-1);
    if (options.selectExisting) {
      requireOperator(
        !!config.expectedUserId,
        "EXPECTED_USER_CONFIRMATION_REQUIRED",
      );
      const tenant = await own(options.selectExisting.toLowerCase());
      if (record) {
        record = {
          ...record,
          selectedExisting: {
            tenantId: tenant.id,
            basis: "operator_choice_not_original_receipt",
          },
        };
        await writePrivate(recordFile, record);
      }
      return report(
        last?.status === "unknown"
          ? "owner_selected_original_request_unknown"
          : "existing_owner_selected",
        tenant,
      );
    }
    if (last?.status === "unknown") {
      const selected = record?.selectedExisting
        ? await own(record.selectedExisting.tenantId)
        : undefined;
      return report("original_request_unknown_no_resend", selected);
    }
    if (last?.status === "completed")
      return report("already_completed", await own(last.tenant!.id));
    if (!options.apply)
      return report(
        tenants.length
          ? "existing_access_no_bootstrap_needed"
          : "ready_for_explicit_apply",
      );
    requireOperator(
      !!config.expectedUserId,
      "EXPECTED_USER_CONFIRMATION_REQUIRED",
    );
    requireOperator(
      tenants.length === 0,
      "EXISTING_WORKSPACE_REQUIRES_SELECTION",
    );
    requireOperator(
      (record?.attempts.length ?? 0) < 20,
      "BOOTSTRAP_ATTEMPT_LIMIT",
    );
    const attempt: Attempt = {
      key: randomUUID(),
      body: { name: config.name, currency: config.currency },
      status: "unknown",
      preparedAt: new Date().toISOString(),
    };
    record = {
      version: 1,
      origin: config.origin,
      actorId: session.userId,
      attempts: [...(record?.attempts ?? []), attempt],
    };
    // The durable unknown state is written before the sole POST. Every subsequent invocation is read-only unless a known pre-business rejection was recorded.
    await writePrivate(recordFile, record);
    let response;
    try {
      response = await request("/v1/tenants", {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
          "x-csrf-token": session.csrfToken,
          "idempotency-key": attempt.key,
        },
        body: JSON.stringify(attempt.body),
      });
    } catch {
      return report("original_request_unknown_no_resend");
    }
    if (
      response.status === 201 &&
      validateContract("Tenant", response.body).valid &&
      (response.body as Tenant).ownerUserId === session.userId
    ) {
      attempt.status = "completed";
      attempt.tenant = response.body as Tenant;
      await writePrivate(recordFile, record);
      return report("created", await own(attempt.tenant.id));
    }
    if (knownRejection(response.status, response.body)) {
      attempt.status = "rejected";
      attempt.rejection = {
        status: response.status,
        code: (response.body as { code: string }).code,
      };
      await writePrivate(recordFile, record);
      return report("business_rejected_input_retained");
    }
    return report("original_request_unknown_no_resend");
  });
}

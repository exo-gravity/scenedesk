import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type {
  AssistanceAdapter,
  AssistanceProviderTask,
  AssistanceQueryReceipt,
  AssistanceSubmission,
  AssistanceSubmissionReceipt,
} from "@drama/provider";

type FixtureState =
  | { kind: "pending" | "running" | "cancelled" }
  | { kind: "completed"; output: unknown }
  | { kind: "failed"; code: string };
type HttpEvent = {
  operation: "submit" | "query" | "recover" | "cancel";
  attemptId: string;
  providerJobId?: string;
};
type FixtureJob = {
  providerJobId: string;
  submission: AssistanceSubmission;
  state: FixtureState;
};
type QueryFault = "http_503" | "wrong_correlation" | "wrong_provider_id";

const limit = 262144;
async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > limit) throw new Error("FIXTURE_BODY_TOO_LARGE");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** SceneDesk's own loopback test protocol, not any vendor's API or identity.
 * Each received create POST deliberately makes another provider job: a hidden
 * retry must remain observable instead of being masked by fixture deduplication.
 * The application still uses its real database, worker and result validation.
 */
export async function asyncProviderHttpFixture(connectionVersionId: string) {
  const jobs: FixtureJob[] = [],
    events: HttpEvent[] = [];
  const droppedCancellations = new Set<string>();
  const queryFaults = new Map<string, QueryFault>();
  let dropCreationResponse = false;
  const find = (id: string) => {
    const job = jobs.find((item) => item.providerJobId === id);
    if (!job) throw new Error("FIXTURE_JOB_NOT_FOUND");
    return job;
  };
  const server = createServer((request, response) => {
    void (async () => {
      if (request.headers["x-scenedesk-execution-mode"] !== "test_fixture") {
        json(response, 403, { code: "TEST_FIXTURE_ONLY" });
        return;
      }
      const url = new URL(request.url!, "http://127.0.0.1");
      if (request.method === "POST" && url.pathname === "/fixture/jobs") {
        const raw = await readBody(request);
        if (
          !object(raw) ||
          raw.executionMode !== "test_fixture" ||
          raw.connectionVersionId !== connectionVersionId ||
          typeof raw.attemptId !== "string" ||
          typeof raw.requestHash !== "string" ||
          typeof raw.jobId !== "string"
        ) {
          json(response, 422, { code: "FIXTURE_SUBMISSION_INVALID" });
          return;
        }
        const submission = raw as AssistanceSubmission;
        const providerJobId = `scenedesk-http-fixture-${randomUUID()}`;
        jobs.push({ providerJobId, submission, state: { kind: "pending" } });
        events.push({
          operation: "submit",
          attemptId: submission.attemptId,
          providerJobId,
        });
        if (dropCreationResponse) {
          dropCreationResponse = false;
          // The business effect exists before the socket disappears. The client
          // cannot infer rejection from this network failure.
          response.destroy();
          return;
        }
        json(response, 202, {
          kind: "accepted",
          correlation: submission.attemptId,
          providerJobId,
        });
        return;
      }
      const recoveryPath = /^\/fixture\/submissions\/([^/]+)$/.exec(
        url.pathname,
      );
      if (request.method === "GET" && recoveryPath) {
        const attemptId = decodeURIComponent(recoveryPath[1]!);
        const matches = jobs.filter(
          (job) => job.submission.attemptId === attemptId,
        );
        const job = matches[0];
        events.push({
          operation: "recover",
          attemptId,
          ...(job ? { providerJobId: job.providerJobId } : {}),
        });
        if (
          matches.length !== 1 ||
          !job ||
          request.headers["x-scenedesk-attempt"] !== attemptId ||
          request.headers["x-scenedesk-request-hash"] !==
            job.submission.requestHash ||
          request.headers["x-scenedesk-connection"] !== connectionVersionId
        ) {
          json(response, 409, { code: "FIXTURE_RECOVERY_UNRESOLVED" });
          return;
        }
        json(response, 200, {
          ...(job.state.kind === "completed"
            ? job.state
            : { kind: "accepted" }),
          correlation: attemptId,
          providerJobId: job.providerJobId,
        });
        return;
      }
      const cancelPath = /^\/fixture\/jobs\/([^/]+)\/cancel$/.exec(
        url.pathname,
      );
      if (request.method === "POST" && cancelPath) {
        const job = find(decodeURIComponent(cancelPath[1]!));
        const attemptId = String(request.headers["x-scenedesk-attempt"]);
        events.push({
          operation: "cancel",
          attemptId,
          providerJobId: job.providerJobId,
        });
        if (
          attemptId !== job.submission.attemptId ||
          request.headers["x-scenedesk-request-hash"] !==
            job.submission.requestHash ||
          request.headers["x-scenedesk-connection"] !== connectionVersionId
        ) {
          json(response, 409, { code: "FIXTURE_IDENTITY_MISMATCH" });
          return;
        }
        if (droppedCancellations.has(job.providerJobId)) {
          response.destroy();
          return;
        }
        json(response, 202, {
          kind: "cancel_requested",
          correlation: attemptId,
          providerJobId: job.providerJobId,
        });
        return;
      }
      const taskPath = /^\/fixture\/jobs\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && taskPath) {
        const job = find(decodeURIComponent(taskPath[1]!));
        const attemptId = String(request.headers["x-scenedesk-attempt"]);
        events.push({
          operation: "query",
          attemptId,
          providerJobId: job.providerJobId,
        });
        if (
          attemptId !== job.submission.attemptId ||
          request.headers["x-scenedesk-request-hash"] !==
            job.submission.requestHash ||
          request.headers["x-scenedesk-connection"] !== connectionVersionId
        ) {
          json(response, 409, { code: "FIXTURE_IDENTITY_MISMATCH" });
          return;
        }
        const fault = queryFaults.get(job.providerJobId);
        queryFaults.delete(job.providerJobId);
        if (fault === "http_503") {
          json(response, 503, { code: "FIXTURE_TEMPORARILY_UNAVAILABLE" });
          return;
        }
        json(response, 200, {
          ...(fault
            ? {
                kind: "completed",
                output: {
                  shots: [
                    { label: "Wrong identity", intent: "不可保存的异源结果" },
                  ],
                },
              }
            : job.state),
          correlation: job.submission.attemptId,
          providerJobId: job.providerJobId,
          ...(fault === "wrong_correlation"
            ? { correlation: randomUUID() }
            : {}),
          ...(fault === "wrong_provider_id"
            ? { providerJobId: `scenedesk-http-fixture-${randomUUID()}` }
            : {}),
        });
        return;
      }
      json(response, 404, { code: "FIXTURE_NOT_FOUND" });
    })().catch(() => {
      if (!response.headersSent)
        json(response, 500, { code: "FIXTURE_REQUEST_FAILED" });
      else response.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("FIXTURE_BIND_FAILED");
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    adapter: asyncProviderHttpAdapter({
      origin,
      connectionVersionId,
      executionMode: "test_fixture",
    }),
    creations: () => structuredClone(jobs),
    requests: () => structuredClone(events),
    dropNextCreationResponse() {
      dropCreationResponse = true;
    },
    dropCancellationResponse(id: string) {
      find(id);
      droppedCancellations.add(id);
    },
    failNextQuery(id: string, fault: QueryFault) {
      find(id);
      queryFaults.set(id, fault);
    },
    setState(id: string, state: FixtureState) {
      find(id).state = structuredClone(state);
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}

/** Test-only HTTP client for the same fixture in a separate worker process. */
export function asyncProviderHttpAdapter(options: {
  origin: string;
  connectionVersionId: string;
  executionMode: "test_fixture";
}): AssistanceAdapter {
  const { origin, connectionVersionId } = options;
  const address = new URL(origin);
  if (
    options.executionMode !== "test_fixture" ||
    !/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(origin) ||
    address.origin !== origin
  )
    throw new Error("LOOPBACK_TEST_FIXTURE_REQUIRED");
  async function transport(
    submission: AssistanceSubmission,
    path: string,
    signal: AbortSignal,
    method: "GET" | "POST" = "GET",
    body?: unknown,
  ) {
    if (
      submission.executionMode !== "test_fixture" ||
      submission.connectionVersionId !== connectionVersionId
    )
      throw new Error("TEST_FIXTURE_ONLY");
    const response = await fetch(`${origin}${path}`, {
      method,
      signal,
      redirect: "error",
      headers: {
        "x-scenedesk-execution-mode": "test_fixture",
        "x-scenedesk-attempt": submission.attemptId,
        "x-scenedesk-request-hash": submission.requestHash,
        "x-scenedesk-connection": submission.connectionVersionId,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (
      !response.ok ||
      !response.headers.get("content-type")?.startsWith("application/json")
    ) {
      await response.body?.cancel();
      throw new Error("FIXTURE_HTTP_UNAVAILABLE");
    }
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > limit) {
        await reader.cancel();
        throw new Error("FIXTURE_RESPONSE_TOO_LARGE");
      }
      chunks.push(chunk.value);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!object(value) || value.correlation !== submission.attemptId)
      throw new Error("FIXTURE_CORRELATION_INVALID");
    return value;
  }
  const unavailable = (
    task: AssistanceProviderTask,
  ): AssistanceQueryReceipt => ({
    kind: "unavailable",
    correlation: task.attemptId,
    providerJobId: task.providerJobId,
    code: "FIXTURE_QUERY_UNAVAILABLE",
  });
  const adapter: AssistanceAdapter = {
    executionMode: "test_fixture",
    connectionVersionId,
    async submitOnce(submission, signal): Promise<AssistanceSubmissionReceipt> {
      try {
        const receipt = await transport(
          submission,
          "/fixture/jobs",
          signal,
          "POST",
          submission,
        );
        if (
          receipt.kind !== "accepted" ||
          typeof receipt.providerJobId !== "string" ||
          !receipt.providerJobId.startsWith("scenedesk-http-fixture-")
        )
          throw new Error("FIXTURE_ACCEPTANCE_INVALID");
        return {
          kind: "accepted",
          correlation: submission.attemptId,
          providerJobId: receipt.providerJobId,
        };
      } catch {
        return { kind: "unknown", correlation: submission.attemptId };
      }
    },
    async recoverSubmission(submission, signal) {
      try {
        const receipt = await transport(
          submission,
          `/fixture/submissions/${encodeURIComponent(submission.attemptId)}`,
          signal,
        );
        if (
          typeof receipt.providerJobId !== "string" ||
          !receipt.providerJobId.startsWith("scenedesk-http-fixture-")
        )
          return null;
        if (receipt.kind === "accepted")
          return {
            kind: "accepted",
            correlation: submission.attemptId,
            providerJobId: receipt.providerJobId,
          };
        if (receipt.kind === "completed" && "output" in receipt)
          return {
            kind: "completed",
            correlation: submission.attemptId,
            providerJobId: receipt.providerJobId,
            output: receipt.output,
          };
        return null;
      } catch {
        return null;
      }
    },
    async requestCancel(task, signal) {
      const identity = {
        correlation: task.attemptId,
        providerJobId: task.providerJobId,
      };
      try {
        const receipt = await transport(
          task,
          `/fixture/jobs/${encodeURIComponent(task.providerJobId)}/cancel`,
          signal,
          "POST",
        );
        if (receipt.providerJobId !== task.providerJobId)
          return { kind: "cancel_unknown", ...identity };
        if (
          receipt.kind === "cancel_requested" ||
          receipt.kind === "cancel_unsupported" ||
          receipt.kind === "cancelled"
        )
          return { kind: receipt.kind, ...identity };
        return { kind: "cancel_unknown", ...identity };
      } catch {
        return { kind: "cancel_unknown", ...identity };
      }
    },
    async query(task, signal) {
      try {
        const receipt = await transport(
          task,
          `/fixture/jobs/${encodeURIComponent(task.providerJobId)}`,
          signal,
        );
        if (receipt.providerJobId !== task.providerJobId)
          return unavailable(task);
        const identity = {
          correlation: task.attemptId,
          providerJobId: task.providerJobId,
        };
        if (
          receipt.kind === "pending" ||
          receipt.kind === "running" ||
          receipt.kind === "cancelled"
        )
          return { kind: receipt.kind, ...identity };
        if (receipt.kind === "completed" && "output" in receipt)
          return { kind: "completed", ...identity, output: receipt.output };
        if (receipt.kind === "failed" && typeof receipt.code === "string")
          return { kind: "failed", ...identity, code: receipt.code };
        return unavailable(task);
      } catch {
        return unavailable(task);
      }
    },
  };
  return adapter;
}

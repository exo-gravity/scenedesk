import { Problem, requireThat } from "../../../kernel/errors.js";
import { digest } from "../../../kernel/crypto.js";

const API = "https://open.feishu.cn/open-apis";
const ID = /^[A-Za-z0-9_-]{1,128}$/;
export const DOCX_LIMIT = 4 * 1024 * 1024;
export type FeishuLink = { url: string; kind: "docx" | "wiki"; token: string };
export type FeishuConfiguration = {
  tenantId: string;
  appId: string;
  appSecret: string;
  sources: { projectId: string; url: string }[];
};
export function parseFeishuLink(value: string): FeishuLink {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Problem(
      422,
      "FEISHU_LINK_INVALID",
      "请粘贴完整的飞书新版文档或知识库文档链接。",
    );
  }
  const path = /^\/(docx|wiki)\/([A-Za-z0-9]{10,100})\/?$/.exec(url.pathname);
  requireThat(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      /^[a-z0-9-]+\.feishu\.cn$/.test(url.hostname) &&
      path,
    422,
    "FEISHU_LINK_INVALID",
    "仅支持飞书中国站的 docx 或 wiki 文档链接，不支持短链或其他文件类型。",
  );
  return {
    url: `${url.origin}/${path[1]}/${path[2]}`,
    kind: path[1] as "docx" | "wiki",
    token: path[2]!,
  };
}
export function feishuConfiguration(value: unknown): FeishuConfiguration {
  const valid =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    Object.keys(valid).some(
      (key) => !["tenantId", "appId", "appSecret", "sources"].includes(key),
    ) ||
    typeof valid.tenantId !== "string" ||
    !uuid.test(valid.tenantId) ||
    typeof valid.appId !== "string" ||
    !/^cli_[A-Za-z0-9]{4,100}$/.test(valid.appId) ||
    typeof valid.appSecret !== "string" ||
    valid.appSecret.length < 8 ||
    valid.appSecret.length > 512 ||
    /[\r\n\0]/.test(valid.appSecret) ||
    !Array.isArray(valid.sources) ||
    valid.sources.length > 256
  )
    throw new Error("FEISHU_CONFIGURATION_INVALID");
  const seen = new Set<string>();
  const sources = valid.sources.map((source: unknown) => {
    const row =
      source && typeof source === "object"
        ? (source as Record<string, unknown>)
        : {};
    if (
      Object.keys(row).some((key) => !["projectId", "url"].includes(key)) ||
      typeof row.projectId !== "string" ||
      !uuid.test(row.projectId) ||
      typeof row.url !== "string"
    )
      throw new Error("FEISHU_SOURCE_BINDING_INVALID");
    let link: FeishuLink;
    try {
      link = parseFeishuLink(row.url);
    } catch {
      throw new Error("FEISHU_SOURCE_BINDING_INVALID");
    }
    const projectId = row.projectId.toLowerCase(),
      key = `${projectId}/${link.url}`;
    if (seen.has(key)) throw new Error("FEISHU_SOURCE_BINDING_DUPLICATE");
    seen.add(key);
    return { projectId, url: link.url };
  });
  return {
    tenantId: valid.tenantId.toLowerCase(),
    appId: valid.appId,
    appSecret: valid.appSecret,
    sources,
  };
}
export function requireSource(
  config: FeishuConfiguration | undefined,
  tenantId: string,
  projectId: string,
  url: string,
) {
  requireThat(
    config && config.tenantId === tenantId,
    409,
    "FEISHU_NOT_CONFIGURED",
    "此工作室尚未连接飞书。请管理员配置团队自建应用，并授权本项目可导入的文档；也可先上传 Word。",
  );
  const link = parseFeishuLink(url);
  requireThat(
    config.sources.some(
      (source) => source.projectId === projectId && source.url === link.url,
    ),
    403,
    "FEISHU_SOURCE_NOT_ALLOWED",
    "此文档尚未授权给当前项目。请管理员将该 docx 或 wiki 链接绑定到本项目后再试。",
  );
  return {
    link,
    binding: digest(
      JSON.stringify([config.tenantId, projectId, config.appId, link.url]),
    ),
  };
}
export class FeishuFailure extends Problem {
  constructor(
    code: string,
    message: string,
    readonly retryable = false,
    status = 502,
  ) {
    super(status, code, message);
  }
}
function failure(status: number, code?: number): FeishuFailure {
  if (status === 429 || [99991400, 1069923].includes(code ?? 0))
    return new FeishuFailure(
      "FEISHU_RATE_LIMITED",
      "飞书读取暂时限频，请稍后继续读取。",
      true,
      429,
    );
  if (
    [401, 403, 404, 410].includes(status) ||
    [
      1069902, 1069906, 1069914, 131005, 131006, 1770002, 1770003, 1770032,
      99991663, 99991664, 99991668, 99991672,
    ].includes(code ?? 0)
  )
    return new FeishuFailure(
      "FEISHU_SOURCE_UNAVAILABLE",
      "无法读取飞书文档，请检查应用发布、只读权限与目标文档授权；文档也可能已删除。",
      false,
      403,
    );
  return new FeishuFailure(
    "FEISHU_UPSTREAM_FAILED",
    "飞书暂未完成读取，请稍后继续；如持续失败，请管理员检查应用配置。",
    status >= 500,
  );
}
async function bounded(response: Response, limit: number) {
  const declared = response.headers.get("content-length");
  if (
    declared &&
    (/^[0-9]+$/.test(declared) ? Number(declared) > limit : true)
  ) {
    await response.body?.cancel();
    throw new FeishuFailure(
      "FEISHU_FILE_TOO_LARGE",
      "飞书导出文件超过当前 4 MB 导入上限，请精简剧本或图片后重新读取。",
      false,
      413,
    );
  }
  const reader = response.body?.getReader();
  requireThat(
    reader,
    502,
    "FEISHU_EMPTY_RESPONSE",
    "飞书未返回有效内容，请重新读取。",
  );
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new FeishuFailure(
        "FEISHU_FILE_TOO_LARGE",
        "飞书返回内容超过导入上限，请精简文档后重新读取。",
        false,
        413,
      );
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks);
}
export type FeishuDocument = {
  documentId: string;
  title: string;
  observedRevision: number;
};
export class FeishuClient {
  private access: { value: string; expires: number } | undefined;
  private authorizing: Promise<string> | undefined;
  constructor(
    private readonly config: FeishuConfiguration,
    private readonly transport: typeof fetch = fetch,
  ) {}
  private async wire(path: string, init: RequestInit) {
    try {
      return await this.transport(`${API}${path}`, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new FeishuFailure(
        "FEISHU_CONNECTION_FAILED",
        "连接飞书超时或中断，已保留本次读取状态。",
        true,
      );
    }
  }
  private async json(response: Response): Promise<Record<string, any>> {
    let body: Record<string, any>;
    try {
      body = JSON.parse((await bounded(response, 512 * 1024)).toString("utf8"));
    } catch (error) {
      if (error instanceof Problem) throw error;
      throw failure(response.ok ? 502 : response.status);
    }
    if (response.ok && (!body || typeof body.code !== "number"))
      throw failure(502);
    if (!response.ok || !body || body.code !== 0)
      throw failure(
        response.status,
        typeof body?.code === "number" ? body.code : undefined,
      );
    return body;
  }
  private token(): Promise<string> {
    if (this.access && this.access.expires > Date.now() + 60_000)
      return Promise.resolve(this.access.value);
    return (this.authorizing ??= (async () => {
      const body = await this.json(
        await this.wire("/auth/v3/tenant_access_token/internal", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            app_id: this.config.appId,
            app_secret: this.config.appSecret,
          }),
        }),
      );
      if (
        typeof body.tenant_access_token !== "string" ||
        body.tenant_access_token.length > 2048 ||
        !Number.isInteger(body.expire) ||
        body.expire < 1 ||
        body.expire > 7200
      )
        throw failure(502);
      this.access = {
        value: body.tenant_access_token,
        expires: Date.now() + body.expire * 1000,
      };
      return this.access.value;
    })().finally(() => {
      this.authorizing = undefined;
    }));
  }
  private async request(path: string, body?: unknown) {
    const token = await this.token();
    try {
      return await this.json(
        await this.wire(path, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
    } catch (error) {
      if (
        error instanceof FeishuFailure &&
        error.code === "FEISHU_SOURCE_UNAVAILABLE"
      )
        this.access = undefined;
      throw error;
    }
  }
  async inspect(link: FeishuLink): Promise<FeishuDocument> {
    let documentId = link.token;
    if (link.kind === "wiki") {
      const body = await this.request(
        `/wiki/v2/spaces/get_node?token=${encodeURIComponent(link.token)}`,
      );
      const node = body.data?.node;
      if (node?.obj_type !== "docx")
        throw new FeishuFailure(
          "FEISHU_TYPE_UNSUPPORTED",
          "该知识库节点不是新版飞书文档，暂不支持表格、附件或目录。",
          false,
          422,
        );
      if (typeof node.obj_token !== "string" || !ID.test(node.obj_token))
        throw failure(502);
      documentId = node.obj_token;
    }
    const body = await this.request(
      `/docx/v1/documents/${encodeURIComponent(documentId)}`,
    );
    const doc = body.data?.document;
    if (
      doc?.document_id !== documentId ||
      typeof doc.title !== "string" ||
      doc.title.length > 4096 ||
      !Number.isSafeInteger(doc.revision_id) ||
      doc.revision_id < 1
    )
      throw failure(502);
    return {
      documentId,
      title: Array.from(doc.title).slice(0, 1024).join(""),
      observedRevision: doc.revision_id,
    };
  }
  async create(documentId: string): Promise<string> {
    const body = await this.request("/drive/v1/export_tasks", {
      file_extension: "docx",
      token: documentId,
      type: "docx",
    });
    const ticket = body.data?.ticket;
    if (typeof ticket !== "string" || !ID.test(ticket)) throw failure(502);
    return ticket;
  }
  async poll(
    documentId: string,
    ticket: string,
  ): Promise<{ ready: false } | { ready: true; fileToken: string }> {
    if (!ID.test(ticket)) throw failure(502);
    const body = await this.request(
      `/drive/v1/export_tasks/${encodeURIComponent(ticket)}?token=${encodeURIComponent(documentId)}`,
    );
    const result = body.data?.result;
    if ([1, 2].includes(result?.job_status)) return { ready: false };
    if ([109, 110, 111, 123].includes(result?.job_status))
      throw new FeishuFailure(
        "FEISHU_EXPORT_DENIED",
        "飞书未能完整导出：文档或部分内容无权读取，或已删除。请检查源文档授权。",
        false,
        403,
      );
    if ([107, 6000].includes(result?.job_status))
      throw new FeishuFailure(
        "FEISHU_FILE_TOO_LARGE",
        "飞书文档或图片过多，无法导出。请精简后重新读取。",
        false,
        413,
      );
    if (
      result?.job_status !== 0 ||
      result.type !== "docx" ||
      result.file_extension !== "docx" ||
      typeof result.file_token !== "string" ||
      !ID.test(result.file_token)
    )
      throw new FeishuFailure(
        "FEISHU_EXPORT_FAILED",
        "飞书导出失败或超时，请保留链接后重新读取。",
      );
    if (
      !Number.isSafeInteger(result.file_size) ||
      result.file_size < 1 ||
      result.file_size > DOCX_LIMIT
    )
      throw new FeishuFailure(
        "FEISHU_FILE_TOO_LARGE",
        "导出的 Word 超过当前 4 MB 上限，请精简文档后重新读取。",
        false,
        413,
      );
    return { ready: true, fileToken: result.file_token };
  }
  async download(fileToken: string): Promise<Buffer> {
    if (!ID.test(fileToken)) throw failure(502);
    const response = await this.wire(
      `/drive/v1/export_tasks/file/${encodeURIComponent(fileToken)}/download`,
      { headers: { authorization: `Bearer ${await this.token()}` } },
    );
    if (
      !response.ok ||
      response.headers.get("content-type")?.includes("json")
    ) {
      await this.json(response);
      throw failure(502);
    }
    return bounded(response, DOCX_LIMIT);
  }
}
export type FeishuServices = {
  config: FeishuConfiguration;
  client: FeishuClient;
};
export const createFeishuServices = (
  config: FeishuConfiguration,
): FeishuServices => ({ config, client: new FeishuClient(config) });

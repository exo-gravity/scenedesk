import { randomUUID } from "node:crypto";
import {
  FeishuClient,
  type FeishuConfiguration,
} from "../../apps/api/src/modules/content/feishu/client.js";
import { illustratedDocxFixture } from "./docx.js";

/** Explicit synthetic external Feishu transport; production business routes remain real. */
export function feishuFixture() {
  const documentId = "SyntheticDocument001",
    wikiId = "SyntheticWikiNode001";
  const sourceUrl = `https://synthetic-team.feishu.cn/docx/${documentId}`;
  const wikiUrl = `https://synthetic-team.feishu.cn/wiki/${wikiId}`;
  const config: FeishuConfiguration = {
    tenantId: randomUUID(),
    appId: "cli_syntheticfixture",
    appSecret: "synthetic-noncredential",
    sources: [],
  };
  const state = {
    bytes: illustratedDocxFixture(),
    revision: 1,
    title: "合成飞书剧本",
    denied: false,
    wikiType: "docx",
    wikiDocument: documentId,
    createLost: false,
    pending: 0,
    creates: 0,
    inspections: 0,
    downloads: 0,
    rateLimited: false,
    calls: [] as string[],
  };
  const tickets = new Map<string, Buffer>();
  const json = (data: unknown) => Response.json({ code: 0, data });
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (
      url.origin !== "https://open.feishu.cn" ||
      !url.pathname.startsWith("/open-apis/")
    )
      throw new Error("Fixture forbids non-Feishu origin");
    if (init?.redirect !== "error") throw new Error("Redirect safety missing");
    const path = url.pathname.slice("/open-apis".length);
    state.calls.push(path);
    if (path === "/auth/v3/tenant_access_token/internal")
      return Response.json({
        code: 0,
        tenant_access_token: "synthetic-token",
        expire: 7200,
      });
    if (
      new Headers(init?.headers).get("authorization") !==
      "Bearer synthetic-token"
    )
      return new Response("", { status: 403 });
    if (state.rateLimited)
      return Response.json({ code: 99991400 }, { status: 429 });
    if (state.denied) return Response.json({ code: 99991672 }, { status: 403 });
    if (path === "/wiki/v2/spaces/get_node")
      return json({
        node: { obj_type: state.wikiType, obj_token: state.wikiDocument },
      });
    if (path.startsWith("/docx/v1/documents/")) {
      state.inspections++;
      return json({
        document: {
          document_id: path.split("/").at(-1),
          title: state.title,
          revision_id: state.revision,
        },
      });
    }
    if (path === "/drive/v1/export_tasks") {
      state.creates++;
      const ticket = `ticket_${state.creates}`;
      tickets.set(ticket, Buffer.from(state.bytes));
      if (state.createLost) throw new Error("Synthetic lost external response");
      return json({ ticket });
    }
    if (path.endsWith("/download")) {
      state.downloads++;
      const bytes = tickets.get(path.split("/").at(-2)!)!;
      return new Response(Uint8Array.from(bytes), {
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(bytes.length),
        },
      });
    }
    if (path.startsWith("/drive/v1/export_tasks/")) {
      if (state.pending > 0) {
        state.pending--;
        return json({ result: { job_status: 2 } });
      }
      const ticket = path.split("/").at(-1)!,
        bytes = tickets.get(ticket);
      if (!bytes) return Response.json({ code: 1069902 }, { status: 404 });
      return json({
        result: {
          job_status: 0,
          type: "docx",
          file_extension: "docx",
          file_token: ticket,
          file_size: bytes.length,
        },
      });
    }
    throw new Error("Unexpected synthetic external endpoint");
  };
  return {
    config,
    state,
    sourceUrl,
    wikiUrl,
    documentId,
    transport,
    services: { config, client: new FeishuClient(config, transport) },
  };
}

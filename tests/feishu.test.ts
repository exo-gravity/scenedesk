import test from "node:test";
import assert from "node:assert/strict";
import {
  parseFeishuLink,
  feishuConfiguration,
  requireSource,
  FeishuClient,
  DOCX_LIMIT,
} from "../apps/api/src/modules/content/feishu/client.js";
import { feishuFixture } from "./support/feishu.js";

test("Feishu links/configuration bind an exact canonical source to one project and tenant", () => {
  const f = feishuFixture(),
    projectId = crypto.randomUUID();
  assert.equal(
    parseFeishuLink(`${f.sourceUrl}?from=share#part`).url,
    f.sourceUrl,
  );
  for (const link of [
    "http://team.feishu.cn/docx/abcdefghijkl",
    "https://team.feishu.cn.attacker.test/docx/abcdefghijkl",
    "https://user@team.feishu.cn/docx/abcdefghijkl",
    "https://127.0.0.1/docx/abcdefghijkl",
    "https://team.feishu.cn/sheets/abcdefghijkl",
    "https://team.feishu.cn/docx/a%2fb",
    "file:///etc/passwd",
  ])
    assert.throws(() => parseFeishuLink(link), { code: "FEISHU_LINK_INVALID" });
  f.config.sources = [{ projectId, url: f.sourceUrl }];
  assert.equal(feishuConfiguration(f.config).sources[0]?.url, f.sourceUrl);
  assert.throws(
    () => feishuConfiguration({ ...f.config, endpoint: "http://localhost" }),
    /CONFIGURATION_INVALID/,
  );
  assert.throws(
    () =>
      feishuConfiguration({
        ...f.config,
        sources: [...f.config.sources, ...f.config.sources],
      }),
    /DUPLICATE/,
  );
  assert.throws(
    () =>
      requireSource(
        f.config,
        f.config.tenantId,
        crypto.randomUUID(),
        f.sourceUrl,
      ),
    { code: "FEISHU_SOURCE_NOT_ALLOWED" },
  );
  assert.throws(
    () => requireSource(f.config, crypto.randomUUID(), projectId, f.sourceUrl),
    { code: "FEISHU_NOT_CONFIGURED" },
  );
  const before = requireSource(
    f.config,
    f.config.tenantId,
    projectId,
    f.sourceUrl,
  );
  f.config.appSecret = "rotated-synthetic";
  assert.equal(
    requireSource(f.config, f.config.tenantId, projectId, f.sourceUrl).binding,
    before.binding,
  );
});
test("official Feishu adapter resolves wiki, exports and downloads through fixed endpoints", async () => {
  const f = feishuFixture(),
    client = f.services.client;
  const doc = await client.inspect(parseFeishuLink(f.wikiUrl));
  assert.equal(doc.documentId, f.documentId);
  const ticket = await client.create(doc.documentId),
    result = await client.poll(doc.documentId, ticket);
  assert.equal(result.ready, true);
  if (!result.ready) throw new Error("not ready");
  assert.deepEqual(await client.download(result.fileToken), f.state.bytes);
  assert.equal(
    f.state.calls.filter((p) => p.includes("tenant_access_token")).length,
    1,
  );
  f.state.wikiType = "sheet";
  await assert.rejects(client.inspect(parseFeishuLink(f.wikiUrl)), {
    code: "FEISHU_TYPE_UNSUPPORTED",
  });
  f.state.denied = true;
  await assert.rejects(client.inspect(parseFeishuLink(f.sourceUrl)), {
    code: "FEISHU_SOURCE_UNAVAILABLE",
  });
  f.state.denied = false;
  f.state.rateLimited = true;
  await assert.rejects(client.inspect(parseFeishuLink(f.sourceUrl)), {
    code: "FEISHU_RATE_LIMITED",
    retryable: true,
  });
});
test("Feishu download is bounded even without trusted length; errors never expose upstream secrets", async () => {
  const f = feishuFixture();
  for (const declared of [true, false]) {
    const transport: typeof fetch = async (input, init) =>
      String(input).includes("/download")
        ? new Response(new Uint8Array(DOCX_LIMIT + 1), {
            headers: declared
              ? { "content-length": String(DOCX_LIMIT + 1) }
              : {},
          })
        : f.transport(input, init);
    await assert.rejects(
      new FeishuClient(f.config, transport).download("synthetic_file"),
      { code: "FEISHU_FILE_TOO_LARGE" },
    );
  }
  const client = new FeishuClient(f.config, async () =>
    Response.json(
      { code: 999, message: "PRIVATE UPSTREAM CONTENT" },
      { status: 500 },
    ),
  );
  await assert.rejects(
    client.inspect(parseFeishuLink(f.sourceUrl)),
    (error) => error instanceof Error && !error.message.includes("PRIVATE"),
  );
});

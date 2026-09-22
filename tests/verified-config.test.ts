import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGenerationVendors, createVerifiedAdapters } from "@drama/provider";

const good = {
  vendors: { minimax: { apiKey: "a", baseUrl: "https://api.minimax.cn" }, volcengine: { apiKey: "b", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", accountTier: "personal" } },
  connections: [
    { vendor: "minimax", connectionId: "11111111-1111-4111-8111-111111111111", connectionVersionId: "22222222-2222-4222-8222-222222222222", accountIdentityLabel: "mm" },
    { vendor: "volcengine", connectionId: "33333333-3333-4333-8333-333333333333", connectionVersionId: "44444444-4444-4444-8444-444444444444", accountIdentityLabel: "ark" },
  ],
};
test("valid config parses and yields one adapter per connection keyed by its version", () => {
  const parsed = parseGenerationVendors(good);
  const adapters = createVerifiedAdapters(parsed, { fetch, tmpdir: "/tmp", store: {} as any, resolveMedia: async () => [] });
  assert.deepEqual(adapters.map((a) => [a.connectionVersionId, a.executionMode]), [["22222222-2222-4222-8222-222222222222", "verified_provider"], ["44444444-4444-4444-8444-444444444444", "verified_provider"]]);
});
test("rejects unknown vendors, non-https base URLs, unconfigured or duplicate connections", () => {
  assert.throws(() => parseGenerationVendors({ ...good, vendors: { ...good.vendors, kling: { apiKey: "x", baseUrl: "https://x" } } }), /GENERATION_VENDOR_UNKNOWN/);
  assert.throws(() => parseGenerationVendors({ ...good, vendors: { ...good.vendors, minimax: { apiKey: "a", baseUrl: "http://api.minimax.cn" } } }), /GENERATION_BASE_URL_HTTPS_REQUIRED/);
  assert.throws(() => parseGenerationVendors({ vendors: { minimax: good.vendors.minimax }, connections: good.connections }), /GENERATION_CONNECTION_VENDOR_UNCONFIGURED/);
  assert.throws(() => parseGenerationVendors({ ...good, connections: [good.connections[0], good.connections[0]] }), /GENERATION_CONNECTION_DUPLICATE/);
  assert.throws(() => parseGenerationVendors({ ...good, extra: 1 }), /GENERATION_CONFIG_INVALID/);
});

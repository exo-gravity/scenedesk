import type { Vendor } from "./profiles.js";

export type VendorConfig = { apiKey: string; baseUrl: string; accountTier?: "personal" | "enterprise" };
export type ConnectionConfig = { vendor: Vendor; connectionId: string; connectionVersionId: string; accountIdentityLabel: string };
export type GenerationVendors = { vendors: Partial<Record<Vendor, VendorConfig>>; connections: ConnectionConfig[] };

const VENDORS: Vendor[] = ["minimax", "volcengine"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 512 && !/[\r\n\0]/.test(v) ? v : undefined;

function invalid(code = "GENERATION_CONFIG_INVALID"): never {
  throw new Error(code);
}

export function parseGenerationVendors(raw: unknown): GenerationVendors {
  if (!object(raw) || Object.keys(raw).some((k) => !["vendors", "connections"].includes(k))) invalid();
  if (!object(raw.vendors) || !Array.isArray(raw.connections)) invalid();

  const vendors: GenerationVendors["vendors"] = {};
  for (const [name, value] of Object.entries(raw.vendors)) {
    if (!VENDORS.includes(name as Vendor)) invalid("GENERATION_VENDOR_UNKNOWN");
    if (!object(value) || Object.keys(value).some((k) => !["apiKey", "baseUrl", "accountTier"].includes(k))) invalid();
    const apiKey = text(value.apiKey),
      baseUrl = text(value.baseUrl);
    if (!apiKey || !baseUrl) invalid();
    let url: URL | undefined;
    try {
      url = new URL(baseUrl);
    } catch {
      invalid("GENERATION_BASE_URL_HTTPS_REQUIRED");
    }
    if (!url) invalid("GENERATION_BASE_URL_HTTPS_REQUIRED");
    const loopback = url.protocol === "http:" && url.hostname === "127.0.0.1";
    if ((url.protocol !== "https:" && !loopback) || url.username || url.password || url.search || url.hash) invalid("GENERATION_BASE_URL_HTTPS_REQUIRED");
    if (value.accountTier !== undefined && value.accountTier !== "personal" && value.accountTier !== "enterprise") invalid();
    vendors[name as Vendor] = { apiKey, baseUrl, ...(value.accountTier ? { accountTier: value.accountTier as "personal" | "enterprise" } : {}) };
  }

  const connections: ConnectionConfig[] = raw.connections.map((c) => {
    if (!object(c) || Object.keys(c).some((k) => !["vendor", "connectionId", "connectionVersionId", "accountIdentityLabel"].includes(k))) invalid();
    const vendor = c.vendor as Vendor;
    if (!VENDORS.includes(vendor)) invalid("GENERATION_VENDOR_UNKNOWN");
    if (!vendors[vendor]) invalid("GENERATION_CONNECTION_VENDOR_UNCONFIGURED");
    const connectionId = text(c.connectionId),
      connectionVersionId = text(c.connectionVersionId),
      accountIdentityLabel = text(c.accountIdentityLabel);
    if (!connectionId || !connectionVersionId || !accountIdentityLabel || !UUID.test(connectionId) || !UUID.test(connectionVersionId)) invalid();
    return { vendor, connectionId: connectionId.toLowerCase(), connectionVersionId: connectionVersionId.toLowerCase(), accountIdentityLabel };
  });

  if (new Set(connections.map((c) => c.connectionVersionId)).size !== connections.length) invalid("GENERATION_CONNECTION_DUPLICATE");
  return { vendors, connections };
}

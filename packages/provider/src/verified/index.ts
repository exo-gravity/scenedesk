import type { AssistanceAdapter } from "../assistance.js";
import type { GenerationVendors } from "./config.js";
import { createMinimaxAdapter } from "./minimax/adapter.js";
import type { VerifiedDeps } from "./prepare.js";
import { createVolcengineAdapter } from "./volcengine/adapter.js";

export function createVerifiedAdapters(config: GenerationVendors, deps: VerifiedDeps): AssistanceAdapter[] {
  return config.connections.map((connection) => {
    const vendor = config.vendors[connection.vendor]!;
    const options = { connectionVersionId: connection.connectionVersionId, apiKey: vendor.apiKey, baseUrl: vendor.baseUrl, deps };
    return connection.vendor === "minimax" ? createMinimaxAdapter(options) : createVolcengineAdapter(options);
  });
}

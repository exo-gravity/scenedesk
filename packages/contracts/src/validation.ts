import { readFileSync } from "node:fs";
import type { ValidateFunction } from "ajv/dist/2020.js";
import { createContractCompiler } from "./compiler.js";

// The same 2020-12 dialect as OpenAPI 3.1; never strip fields or coerce input.
const spec = JSON.parse(
  readFileSync(
    new URL("../../../docs/implementation/openapi.json", import.meta.url),
    "utf8",
  ),
);
const { ajv, validateContract } = createContractCompiler(spec);
export { validateContract };

type Schema = Record<string, unknown>;
type Parameter = {
  name: string;
  in: "path" | "query" | "header";
  required?: boolean;
  schema: Schema;
};
export type OperationDefinition = {
  name: string;
  method: string;
  path: string;
  permission: string;
  parameters: Parameter[];
  successStatus: number;
  validateInput: ValidateFunction;
  validateOutput?: ValidateFunction;
};
const operationDefinitions = new Map<string, OperationDefinition>();
function reference(schema: Schema): Schema {
  return JSON.parse(
    JSON.stringify(schema).replaceAll(
      '"#/components/',
      '"urn:drama:contract#/components/',
    ),
  );
}
export function operationDefinition(name: string): OperationDefinition {
  const existing = operationDefinitions.get(name);
  if (existing) return existing;
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, raw] of Object.entries(
      methods as Record<string, any>,
    )) {
      if (raw.operationId !== name) continue;
      const parameters = raw.parameters.map((p: any) =>
        p.$ref ? spec.components.parameters[p.$ref.split("/").at(-1)] : p,
      ) as Parameter[];
      const groups: Record<string, Schema> = {};
      for (const location of ["path", "query", "header"]) {
        const selected = parameters.filter((p) => p.in === location);
        const propertyName = (p: Parameter) =>
          location === "header" ? p.name.toLowerCase() : p.name;
        groups[location] = {
          type: "object",
          properties: Object.fromEntries(
            selected.map((p) => [propertyName(p), p.schema]),
          ),
          required: selected.filter((p) => p.required).map(propertyName),
          additionalProperties: location === "header",
        };
      }
      const body = raw.requestBody?.content?.["application/json"]?.schema;
      if (body) groups.body = body;
      const response = Object.entries(raw.responses).find(([status]) =>
        status.startsWith("2"),
      ) as [string, any] | undefined;
      if (!response)
        throw new Error(`Operation ${name} does not return JSON or no-content`);
      const output = response[1].content?.["application/json"]?.schema;
      const result: OperationDefinition = {
        name,
        method: method.toUpperCase(),
        path,
        permission: raw["x-permission"],
        parameters,
        successStatus: Number(response[0]),
        validateInput: ajv.compile(
          reference({
            type: "object",
            properties: groups,
            required: ["path", "query", "header", ...(body ? ["body"] : [])],
            additionalProperties: false,
          }),
        ),
        ...(output ? { validateOutput: ajv.compile(reference(output)) } : {}),
      };
      operationDefinitions.set(name, result);
      return result;
    }
  }
  throw new Error(`Unknown operation ${name}`);
}

import { readFileSync } from "node:fs";
import {
  Ajv2020,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import formats from "ajv-formats";

// The same 2020-12 dialect as OpenAPI 3.1; never strip fields or coerce input.
const spec = JSON.parse(
  readFileSync(
    new URL("../../../docs/implementation/openapi.json", import.meta.url),
    "utf8",
  ),
);
const ajv = new Ajv2020({
  strict: false,
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});
formats.default(ajv);
ajv.addSchema({ $id: "urn:drama:contract", ...spec });
const validators = new Map<string, ValidateFunction>();
export function validateContract(
  name: string,
  value: unknown,
): { valid: boolean; errors: ErrorObject[] } {
  if (!Object.hasOwn(spec.components.schemas, name))
    throw new Error("Unknown contract schema");
  let validator = validators.get(name);
  if (!validator) {
    validator = ajv.compile({
      $ref: `urn:drama:contract#/components/schemas/${name}`,
    });
    validators.set(name, validator);
  }
  return {
    valid: validator(value),
    errors: structuredClone(validator.errors ?? []),
  };
}

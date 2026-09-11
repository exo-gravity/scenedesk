import { bootstrap, parseConfig, parseCredentials } from "./bootstrap.js";
import {
  OperatorError,
  canonicalPrivatePath,
  readPrivate,
  requireOperator,
} from "./private-files.js";

try {
  const args = process.argv.slice(2);
  const values = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < args.length; index++) {
    const key = args[index]!;
    if (key === "--apply") {
      requireOperator(!apply, "INVALID_ARGUMENTS");
      apply = true;
      continue;
    }
    requireOperator(
      ["--config", "--credentials", "--record", "--select-existing"].includes(
        key,
      ) && !values.has(key),
      "INVALID_ARGUMENTS",
    );
    const value = args[++index];
    requireOperator(!!value && !value.startsWith("--"), "INVALID_ARGUMENTS");
    values.set(key, value!);
  }
  requireOperator(
    values.get("--config") &&
      values.get("--credentials") &&
      values.get("--record"),
    "INVALID_ARGUMENTS",
  );
  const configFile = await canonicalPrivatePath(values.get("--config")!),
    credentialsFile = await canonicalPrivatePath(values.get("--credentials")!),
    recordFile = await canonicalPrivatePath(values.get("--record")!);
  requireOperator(
    configFile &&
      credentialsFile &&
      recordFile &&
      new Set(
        await Promise.all(
          [
            configFile,
            credentialsFile,
            recordFile,
            `${recordFile}.review.json`,
            `${recordFile}.lock`,
          ].map(canonicalPrivatePath),
        ),
      ).size === 5,
    "PRIVATE_PATHS_MUST_DIFFER",
  );
  const result = await bootstrap({
    config: parseConfig(await readPrivate(configFile!)),
    credentials: parseCredentials(await readPrivate(credentialsFile!)),
    recordFile: recordFile!,
    apply,
    ...(values.get("--select-existing")
      ? { selectExisting: values.get("--select-existing")! }
      : {}),
  });
  console.log(JSON.stringify(result));
  if (
    [
      "original_request_unknown_no_resend",
      "business_rejected_input_retained",
    ].includes(result.status)
  )
    process.exitCode = 1;
} catch (error) {
  console.error(
    JSON.stringify({
      status: "blocked",
      code:
        error instanceof OperatorError ? error.code : "OPERATOR_CHECK_FAILED",
    }),
  );
  process.exitCode = 1;
}

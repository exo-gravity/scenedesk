import { RecoveryError } from "./types.js";
import { recovery } from "./recovery.js";
import { OperatorError } from "../operator/private-files.js";

try {
  const [operation, configFlag, config, bundleFlag, bundle, ...extra] =
    process.argv.slice(2);
  if (
    !["backup", "restore", "verify"].includes(operation ?? "") ||
    configFlag !== "--config" ||
    !config ||
    bundleFlag !== "--bundle" ||
    !bundle ||
    extra.length
  )
    throw new RecoveryError("RECOVERY_USAGE");
  console.log(
    JSON.stringify(
      await recovery(
        operation as "backup" | "restore" | "verify",
        config,
        bundle,
      ),
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      status: "failed",
      code:
        error instanceof RecoveryError || error instanceof OperatorError
          ? error.code
          : "RECOVERY_OPERATION_FAILED",
      generationExecution: "disabled",
    }),
  );
  process.exitCode = 1;
}

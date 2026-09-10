import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const directory = await mkdtemp(join(tmpdir(), "drama-contract-"));
try {
  const output = join(directory, "generated.ts");
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/openapi-typescript/bin/cli.js",
      "docs/implementation/openapi.json",
      "-o",
      output,
    ],
    { stdio: "pipe" },
  );
  if (result.status !== 0)
    throw new Error(result.stderr?.toString() || "Contract generation failed");
  const [actual, expected] = await Promise.all([
    readFile("packages/contracts/src/generated.ts", "utf8"),
    readFile(output, "utf8"),
  ]);
  if (actual !== expected)
    throw new Error(
      "Generated types are stale. Run npm run contracts:generate",
    );
  console.log("Generated TypeScript matches the design contract.");
} finally {
  await rm(directory, { recursive: true, force: true });
}

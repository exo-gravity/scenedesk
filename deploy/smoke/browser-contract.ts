import { spawn } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";

const directory = process.argv[2]!;
const browser = process.argv[3]!;
const marker = '<pre id="result">SCENEDESK_BROWSER_CONTRACT_PASSED</pre>';
const output = openSync(`${directory}/browser-contract-dom.html`, "wx", 0o600);
const errors = openSync(`${directory}/browser-contract.log`, "wx", 0o600);
// Browser-only flags for an ephemeral CI profile and test CA. Decoder isolation is unchanged.
const child = spawn(
  browser,
  [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--ignore-certificate-errors",
    `--user-data-dir=${directory}/chrome-profile`,
    "--virtual-time-budget=15000",
    "--dump-dom",
    "https://localhost:4338/__smoke/contract.html",
  ],
  { stdio: ["ignore", "pipe", errors] },
);
let observed = "";
let verified = false;
let failure: string | undefined;
let killTimer: ReturnType<typeof setTimeout> | undefined;
const stop = () => {
  child.kill("SIGTERM");
  killTimer ??= setTimeout(() => child.kill("SIGKILL"), 5000);
};
const deadline = setTimeout(() => {
  failure = "BROWSER_CONTRACT_TIMEOUT";
  stop();
}, 60000);
child.stdout!.on("data", (chunk: Buffer) => {
  writeSync(output, chunk);
  observed = (observed + chunk.toString("utf8")).slice(-65536);
  if (!verified && observed.includes(marker)) {
    verified = true;
    clearTimeout(deadline);
    // The DOM proves the assertion; shut down our own browser instead of waiting for background services.
    stop();
  }
});
child.on("error", () => {
  failure = "BROWSER_CONTRACT_START_FAILED";
});
child.on("close", () => {
  clearTimeout(deadline);
  if (killTimer) clearTimeout(killTimer);
  closeSync(output);
  closeSync(errors);
  if (failure || !verified) {
    console.error(
      JSON.stringify({
        status: "failed",
        code: failure ?? "BROWSER_CONTRACT_ASSERTION_FAILED",
      }),
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    JSON.stringify({
      status: "ok",
      originalBrowserContractCompiler: true,
      browserClosedAfterVerifiedDom: true,
      identity: "unauthenticated_discovery_only",
      paidProvidersEnabled: false,
    }),
  );
});

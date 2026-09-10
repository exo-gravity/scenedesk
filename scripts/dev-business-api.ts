// Wait for the local identity emulator to become ready before discovery. This
// retry applies only to an unauthenticated local health read, never to commands.
if (
  process.env.APP_ENV !== "local" ||
  process.env.OIDC_ISSUER !== "http://127.0.0.1:4320" ||
  process.env.OIDC_ALLOW_LOCAL !== "true"
)
  throw new Error("dev:business-api requires setup:business configuration");
let ready = false;
for (let attempt = 0; attempt < 40; attempt++) {
  try {
    const result = await fetch(
      `${process.env.OIDC_ISSUER}/.well-known/openid-configuration`,
      { signal: AbortSignal.timeout(500) },
    );
    if (result.ok) {
      ready = true;
      break;
    }
  } catch {
    /* The local process may still be starting. */
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!ready) throw new Error("Local identity emulator did not start");
await import("../apps/api/src/main.js");

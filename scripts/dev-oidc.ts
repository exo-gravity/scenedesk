import { oidcFixture } from "../tests/support/oidc.js";

if (process.env.APP_ENV !== "local" || process.env.OIDC_ALLOW_LOCAL !== "true")
  throw new Error(
    "The development identity emulator requires explicit local configuration",
  );
// Configurable so a parallel checkout can serve its own emulator.
const provider = await oidcFixture({
  port: Number(process.env.OIDC_PORT ?? 4320),
});
console.log(
  `Local identity emulator: ${provider.issuer}; fixture@example.test is a test identity, not a verified person`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void provider.close();
  });

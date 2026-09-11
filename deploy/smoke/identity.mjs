// Discovery-only test double: cannot authenticate anyone or issue a token.
import https from "node:https";
import { readFileSync } from "node:fs";
const issuer = "https://identity:9443";
https
  .createServer(
    {
      key: readFileSync("/certs/tls.key"),
      cert: readFileSync("/certs/tls.crt"),
    },
    (request, reply) => {
      reply.setHeader("Content-Type", "application/json");
      if (request.url === "/.well-known/openid-configuration")
        return reply.end(
          JSON.stringify({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: `${issuer}/jwks`,
            response_types_supported: ["code"],
            subject_types_supported: ["public"],
            id_token_signing_alg_values_supported: ["RS256"],
          }),
        );
      reply.writeHead(503);
      reply.end('{"code":"DISCOVERY_ONLY_SMOKE_DOUBLE_NO_LOGIN"}');
    },
  )
  .listen(9443, "0.0.0.0");

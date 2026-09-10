import { createServer } from "node:http";
import { generateKeyPairSync, randomUUID, sign, createHash } from "node:crypto";
import type { AddressInfo } from "node:net";

/** A real HTTP/JWKS/RS256 boundary for integration tests; never used by the app. */
export async function oidcFixture(options: { port?: number } = {}) {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const wrongKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const codes = new Map<string, URLSearchParams>();
  const state = {
    claims: {} as Record<string, unknown>,
    badSignature: false,
    exchanges: 0,
  };
  let issuer: string;
  const json = (value: unknown) => JSON.stringify(value);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, issuer);
    response.setHeader("Content-Type", "application/json");
    if (url.pathname === "/.well-known/openid-configuration")
      return response.end(
        json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: ["client_secret_post"],
          code_challenge_methods_supported: ["S256"],
        }),
      );
    if (url.pathname === "/jwks")
      return response.end(
        json({
          keys: [
            {
              ...keys.publicKey.export({ format: "jwk" }),
              kid: "fixture",
              use: "sig",
              alg: "RS256",
            },
          ],
        }),
      );
    if (url.pathname === "/authorize") {
      const code = randomUUID();
      codes.set(code, url.searchParams);
      const callback = new URL(url.searchParams.get("redirect_uri")!);
      callback.searchParams.set("code", code);
      callback.searchParams.set("state", url.searchParams.get("state")!);
      response.writeHead(302, { Location: callback.href });
      return response.end();
    }
    if (url.pathname === "/token" && request.method === "POST") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const params = new URLSearchParams(body),
        saved = codes.get(params.get("code")!);
      codes.delete(params.get("code")!);
      const challenge = createHash("sha256")
        .update(params.get("code_verifier") ?? "")
        .digest("base64url");
      if (
        !saved ||
        params.get("client_id") !== "fixture-client" ||
        params.get("client_secret") !== "fixture-secret" ||
        params.get("redirect_uri") !== saved.get("redirect_uri") ||
        challenge !== saved.get("code_challenge")
      ) {
        response.statusCode = 400;
        return response.end(json({ error: "invalid_grant" }));
      }
      state.exchanges++;
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        iss: issuer,
        sub: "fixture-user",
        aud: "fixture-client",
        iat: now,
        exp: now + 300,
        nonce: saved.get("nonce"),
        email: "fixture@example.test",
        email_verified: true,
        name: "本地测试成员",
        ...state.claims,
      };
      const header = Buffer.from(
        json({ alg: "RS256", kid: "fixture" }),
      ).toString("base64url");
      const payload = Buffer.from(json(claims)).toString("base64url");
      const signed = `${header}.${payload}`;
      const signature = sign(
        "RSA-SHA256",
        Buffer.from(signed),
        state.badSignature ? wrongKeys.privateKey : keys.privateKey,
      ).toString("base64url");
      return response.end(
        json({
          token_type: "Bearer",
          access_token: randomUUID(),
          expires_in: 300,
          id_token: `${signed}.${signature}`,
        }),
      );
    }
    response.statusCode = 404;
    response.end("{}");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    issuer,
    state,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}

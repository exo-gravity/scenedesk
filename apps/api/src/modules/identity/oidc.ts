import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import * as oidc from "openid-client";
import { sqlIdentifier } from "@drama/database";
import { digest, token, type Secrets } from "../../kernel/crypto.js";
import { requireThat, Problem } from "../../kernel/errors.js";
import { issueSession, type VerifiedIdentity } from "./sessions.js";

export type OidcOptions = {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  /** HTTP is accepted only on loopback, only when explicitly enabled locally. */
  localIssuer?: boolean;
};
type LoginContext = {
  pool: Pool;
  schema: string;
  origin: string;
  secrets: Secrets;
  secureCookies: boolean;
};

export function safeReturnPath(value: unknown, origin: string): string {
  requireThat(
    value === undefined || typeof value === "string",
    422,
    "INVALID_RETURN_PATH",
    "返回路径无效。",
  );
  const path = value === undefined ? "/" : (value as string);
  requireThat(
    path.length <= 2048 &&
      /^\/(?!\/)/.test(path) &&
      !/[\\\u0000-\u0020\u007f]/.test(path),
    422,
    "INVALID_RETURN_PATH",
    "返回路径必须是本站页面。",
  );
  const url = new URL(path, origin);
  requireThat(
    url.origin === origin,
    422,
    "INVALID_RETURN_PATH",
    "返回路径必须是本站页面。",
  );
  return `${url.pathname}${url.search}${url.hash}`;
}

export async function discoverIssuer(options: OidcOptions) {
  const issuer = new URL(options.issuer);
  const local =
    options.localIssuer &&
    issuer.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(issuer.hostname);
  if (issuer.protocol !== "https:" && !local)
    throw new Error(
      "OIDC issuer requires HTTPS; local issuers must use loopback",
    );
  if (issuer.username || issuer.password || issuer.hash || issuer.search)
    throw new Error("Invalid OIDC issuer URL");
  const config = await oidc.discovery(
    issuer,
    options.clientId,
    options.clientSecret,
    undefined,
    {
      timeout: 10,
      execute: [
        oidc.enableNonRepudiationChecks,
        ...(local ? [oidc.allowInsecureRequests] : []),
      ],
    },
  );
  // Even local discovery cannot redirect token/JWKS requests to an HTTP LAN host.
  for (const key of [
    "authorization_endpoint",
    "token_endpoint",
    "jwks_uri",
  ] as const) {
    const address = config.serverMetadata()[key];
    if (typeof address !== "string")
      throw new Error(`OIDC metadata missing ${key}`);
    const endpoint = new URL(address);
    if (
      endpoint.protocol !== "https:" &&
      !(local && endpoint.origin === issuer.origin)
    )
      throw new Error("Unsafe OIDC endpoint");
  }
  return config;
}

export function oidcRoutes(
  app: FastifyInstance,
  context: LoginContext,
  config: oidc.Configuration,
) {
  const table = `${sqlIdentifier(context.schema)}.oidc_handshakes`;
  const secure = context.secureCookies ? "; Secure" : "";
  const browserCookie = (value: string, maxAge: number) =>
    `login_browser=${value}; Path=/v1/auth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  app.get("/v1/auth/login", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    requireThat(
      Object.keys(query).every((key) => key === "returnTo"),
      422,
      "INVALID_REQUEST",
      "登录参数无效。",
    );
    const returnPath = safeReturnPath(query.returnTo, context.origin);
    const state = token(),
      browser = token(),
      nonce = oidc.randomNonce(),
      verifier = oidc.randomPKCECodeVerifier();
    const encrypted = context.secrets.seal(
      { verifier, nonce },
      `oidc:${digest(state)}`,
    );
    await context.pool.query(
      `INSERT INTO ${table}(state_hash,browser_hash,nonce_hash,pkce_secret_ref,return_path,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')`,
      [digest(state), digest(browser), digest(nonce), encrypted, returnPath],
    );
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: `${context.origin}/v1/auth/callback`,
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
    });
    return reply
      .header("Cache-Control", "no-store")
      .header("Referrer-Policy", "no-referrer")
      .header("Set-Cookie", browserCookie(browser, 600))
      .redirect(url.href);
  });
  app.get("/v1/auth/callback", async (request, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("Referrer-Policy", "no-referrer");
    const query = request.query as Record<string, unknown>;
    requireThat(
      typeof query.state === "string" &&
        /^[A-Za-z0-9_-]{43}$/.test(query.state) &&
        typeof query.code === "string" &&
        query.code.length > 0 &&
        query.code.length <= 4096,
      401,
      "LOGIN_REJECTED",
      "登录已失效，请重新登录。",
    );
    const cookies = (request.headers.cookie ?? "")
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.startsWith("login_browser="));
    requireThat(
      cookies.length === 1,
      401,
      "LOGIN_REJECTED",
      "登录浏览器校验失败。",
    );
    const browser = cookies[0]!.slice("login_browser=".length);
    // Atomically consume before the network request. A failed exchange requires
    // a fresh login; a callback can never issue two sessions concurrently.
    const consumed = await context.pool.query(
      `UPDATE ${table} SET consumed_at=now() WHERE state_hash=$1 AND browser_hash=$2 AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING *`,
      [digest(query.state), digest(browser)],
    );
    requireThat(
      consumed.rows[0],
      401,
      "LOGIN_REJECTED",
      "登录已失效，请重新登录。",
    );
    const handshake = consumed.rows[0];
    const { verifier, nonce } = context.secrets.open<{
      verifier: string;
      nonce: string;
    }>(handshake.pkce_secret_ref, `oidc:${digest(query.state)}`);
    requireThat(
      digest(nonce) === handshake.nonce_hash,
      401,
      "LOGIN_REJECTED",
      "登录校验失败。",
    );
    let identity: VerifiedIdentity;
    try {
      const tokens = await oidc.authorizationCodeGrant(
        config,
        new URL(request.url, context.origin),
        {
          expectedState: query.state,
          expectedNonce: nonce,
          pkceCodeVerifier: verifier,
          idTokenExpected: true,
        },
      );
      const claims = tokens.claims()!;
      requireThat(
        typeof claims.email === "string" &&
          claims.email.length <= 320 &&
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email),
        401,
        "LOGIN_REJECTED",
        "身份提供方未返回有效邮箱。",
      );
      identity = {
        issuer: claims.iss,
        subject: claims.sub,
        email: claims.email,
        emailVerified: claims.email_verified === true,
        displayName:
          typeof claims.name === "string"
            ? claims.name.slice(0, 160)
            : claims.email,
      };
    } catch {
      throw new Problem(401, "LOGIN_REJECTED", "身份校验未通过，请重新登录。");
    }
    const session = await issueSession(context.pool, identity, {
      schema: context.schema,
    });
    return reply
      .header("Set-Cookie", [
        browserCookie("", 0),
        `session=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${session.ttlSeconds}${secure}`,
      ])
      .redirect(safeReturnPath(handshake.return_path, context.origin));
  });
}

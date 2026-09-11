import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { mediaStoragePolicy } from "@drama/media";
const directory = resolve(process.argv[2] ?? "");
if (!directory.includes("/.runtime/deploy-smoke-"))
  throw new Error("Use a fresh .runtime/deploy-smoke-* directory");
mkdirSync(directory, { mode: 0o700 });
for (const sub of ["certs", "setup", "media", "browser"])
  mkdirSync(`${directory}/${sub}`, { mode: 0o755 });
// This disposable directory is shared with UID 1000 on Linux as well as Docker Desktop.
// The private parent remains 0700; production directory permissions are not changed.
chmodSync(`${directory}/media`, 0o1777);
const write = (name: string, value: string) =>
  writeFileSync(`${directory}/${name}`, value, { mode: 0o444, flag: "wx" });
const json = (name: string, value: unknown) =>
  write(name, JSON.stringify(value));
const random = () => randomBytes(32).toString("hex");
execFileSync(
  resolve("node_modules/.bin/esbuild"),
  [
    "apps/web/src/business/contract-validation.ts",
    "--bundle",
    "--format=iife",
    "--global-name=SmokeContract",
    "--platform=browser",
    `--outfile=${directory}/browser/compiler.js`,
  ],
  { stdio: "ignore" },
);
write(
  "browser/contract.html",
  `<!doctype html><meta charset="utf-8"><title>SceneDesk contract smoke</title><pre id="result">pending</pre><script src="./compiler.js"></script><script>
SmokeContract.browserContractCompiler().then(compiler => {
  if (!compiler.validateContract("CanvasDocument", {nodes: [], edges: [], groups: []}).valid) throw new Error("invalid canvas");
  document.getElementById("result").textContent = "SCENEDESK_BROWSER_CONTRACT_PASSED";
}).catch(() => { document.getElementById("result").textContent = "SCENEDESK_BROWSER_CONTRACT_FAILED"; });
</script>`,
);
const passwords = Object.fromEntries(
  ["postgres", "api", "auth", "media", "scheduler"].map((role) => [
    role,
    random(),
  ]),
);
const connection = (role: string) =>
  `postgresql://${role}:${passwords[role]}@database:5432/scenedesk?sslmode=verify-full`;
const minio = { user: random().slice(0, 24), password: random() };
const apiKey = {
  accessKeyId: random().slice(0, 24),
  secretAccessKey: random(),
};
const workerKey = {
  accessKeyId: random().slice(0, 24),
  secretAccessKey: random(),
};
const store = {
  endpoint: "https://storage:9443",
  region: "us-east-1",
  bucket: "smoke-private-media",
};
json("api.json", {
  origin: "https://localhost:4338",
  databaseUrl: connection("api"),
  authDatabaseUrl: connection("auth"),
  appSecret: randomBytes(32).toString("base64url"),
  oidc: { issuer: "https://identity:9443", clientId: "discovery-only-smoke" },
  media: { ...store, ...apiKey },
});
json("worker.json", {
  databaseUrl: connection("media"),
  schedulerDatabaseUrl: connection("scheduler"),
  exclusiveImportQueue: true,
  dedicatedDecoderHost: true,
  media: { ...store, ...workerKey },
});
json("provision.json", {
  databaseUrl: connection("postgres"),
  apiRole: "api",
  authRole: "auth",
  mediaRole: "media",
  schedulerRole: "scheduler",
  authorizationOwner: "authorization_owner",
});
write(
  "roles.sql",
  ["api", "auth", "media", "scheduler"]
    .map(
      (role) =>
        `CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD '${passwords[role]}';`,
    )
    .join("\n") +
    "\nCREATE ROLE authorization_owner NOLOGIN NOINHERIT NOSUPERUSER BYPASSRLS NOCREATEROLE NOCREATEDB;\n",
);
write("postgres-password", passwords.postgres!);
write("minio-user", minio.user);
write("minio-password", minio.password);
json("setup/api-policy.json", mediaStoragePolicy(store.bucket, "api"));
json("setup/worker-policy.json", mediaStoragePolicy(store.bucket, "worker"));
write(
  "setup/storage.sh",
  `set -eu\nmc alias set local http://minio:9000 ${minio.user} ${minio.password} >/dev/null\nmc mb local/${store.bucket} >/dev/null\nmc version enable local/${store.bucket} >/dev/null\nmc admin user add local ${apiKey.accessKeyId} ${apiKey.secretAccessKey} >/dev/null\nmc admin user add local ${workerKey.accessKeyId} ${workerKey.secretAccessKey} >/dev/null\nmc admin policy create local api /setup/api-policy.json >/dev/null\nmc admin policy create local worker /setup/worker-policy.json >/dev/null\nmc admin policy attach local api --user ${apiKey.accessKeyId} >/dev/null\nmc admin policy attach local worker --user ${workerKey.accessKeyId} >/dev/null\n`,
);
write(
  "storage.conf",
  `events {}\nhttp { access_log off; server { listen 9443 ssl; ssl_certificate /certs/tls.crt; ssl_certificate_key /certs/tls.key; client_max_body_size 0; location / { proxy_pass http://minio:9000; proxy_set_header Host $http_host; proxy_http_version 1.1; proxy_request_buffering off; } } }\n`,
);
const openssl = (args: string[]) =>
  execFileSync("openssl", args, { cwd: `${directory}/certs`, stdio: "ignore" });
openssl([
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-keyout",
  "ca.key",
  "-out",
  "ca.crt",
  "-days",
  "2",
  "-subj",
  "/CN=SceneDesk ephemeral smoke CA",
]);
openssl([
  "req",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-keyout",
  "tls.key",
  "-out",
  "tls.csr",
  "-subj",
  "/CN=localhost",
]);
write(
  "certs/extensions.cnf",
  "subjectAltName=DNS:localhost,DNS:database,DNS:storage,DNS:identity,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n",
);
openssl([
  "x509",
  "-req",
  "-in",
  "tls.csr",
  "-CA",
  "ca.crt",
  "-CAkey",
  "ca.key",
  "-CAcreateserial",
  "-out",
  "tls.crt",
  "-days",
  "2",
  "-extfile",
  "extensions.cnf",
]);
chmodSync(`${directory}/certs/tls.key`, 0o444);
write(
  "compose.env",
  `SCENEDESK_SMOKE_DIRECTORY=${directory}\nSCENEDESK_PROVISION_CONFIG=${directory}/provision.json\nSCENEDESK_API_CONFIG=${directory}/api.json\nSCENEDESK_WORKER_CONFIG=${directory}/worker.json\nSCENEDESK_TLS_CERTIFICATE=${directory}/certs/tls.crt\nSCENEDESK_TLS_PRIVATE_KEY=${directory}/certs/tls.key\nSCENEDESK_MEDIA_DIRECTORY=${directory}/media\nSCENEDESK_DECODER_SOCKET=/run/decoder/docker.sock\nSCENEDESK_HTTPS_PORT=4338\n`,
);
console.log(
  JSON.stringify({
    status: "prepared",
    identity: "discovery_only_no_login",
    scope: "ephemeral_local_container_smoke",
  }),
);

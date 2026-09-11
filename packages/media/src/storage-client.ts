import { S3Client } from "@aws-sdk/client-s3";

export type StoreConfiguration = {
  endpoint?: string;
  region: string;
  bucket: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  local?: boolean;
};

export function privateStorageClient(
  config: StoreConfiguration,
  maxAttempts = 2,
) {
  if (config.endpoint) {
    const url = new URL(config.endpoint);
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      (url.protocol !== "https:" &&
        !(config.local && loopback && url.protocol === "http:"))
    )
      throw new Error(
        "Object storage requires an HTTPS origin, or explicit loopback development",
      );
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket))
    throw new Error("Invalid private bucket name");
  return new S3Client({
    region: config.region,
    credentials: config.credentials,
    ...(config.endpoint
      ? { endpoint: config.endpoint, forcePathStyle: true }
      : {}),
    maxAttempts,
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 60_000 },
  });
}

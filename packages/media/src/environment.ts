import { MediaStore } from "./storage.js";
import { ProductionStore } from "./production-storage.js";

/** Runtime identities receive their own file; no fallback to root or shared cloud credentials. */
export function mediaStoreFromEnvironment(env: NodeJS.ProcessEnv) {
  if (
    !env.MEDIA_BUCKET &&
    !env.MEDIA_ACCESS_KEY_ID &&
    !env.MEDIA_SECRET_ACCESS_KEY &&
    !env.MEDIA_ENDPOINT
  )
    return undefined;
  if (
    !env.MEDIA_BUCKET ||
    !env.MEDIA_REGION ||
    !env.MEDIA_ACCESS_KEY_ID ||
    !env.MEDIA_SECRET_ACCESS_KEY
  )
    throw new Error(
      "Media storage requires an explicit bucket, region and runtime credentials",
    );
  return new MediaStore({
    ...(env.MEDIA_ENDPOINT ? { endpoint: env.MEDIA_ENDPOINT } : {}),
    region: env.MEDIA_REGION,
    bucket: env.MEDIA_BUCKET,
    credentials: {
      accessKeyId: env.MEDIA_ACCESS_KEY_ID,
      secretAccessKey: env.MEDIA_SECRET_ACCESS_KEY,
      ...(env.MEDIA_SESSION_TOKEN
        ? { sessionToken: env.MEDIA_SESSION_TOKEN }
        : {}),
    },
    local: env.APP_ENV === "local",
  });
}

export function productionStoreFromEnvironment(env: NodeJS.ProcessEnv) {
  if (!env.PRODUCTION_BUCKET) return undefined;
  if (
    !env.MEDIA_BUCKET ||
    env.PRODUCTION_BUCKET === env.MEDIA_BUCKET ||
    !env.MEDIA_REGION ||
    !env.MEDIA_ACCESS_KEY_ID ||
    !env.MEDIA_SECRET_ACCESS_KEY
  )
    throw new Error(
      "Production storage requires a separate bucket and explicit worker credentials",
    );
  return new ProductionStore({
    ...(env.MEDIA_ENDPOINT ? { endpoint: env.MEDIA_ENDPOINT } : {}),
    region: env.MEDIA_REGION,
    bucket: env.PRODUCTION_BUCKET,
    credentials: {
      accessKeyId: env.MEDIA_ACCESS_KEY_ID,
      secretAccessKey: env.MEDIA_SECRET_ACCESS_KEY,
      ...(env.MEDIA_SESSION_TOKEN
        ? { sessionToken: env.MEDIA_SESSION_TOKEN }
        : {}),
    },
    local: env.APP_ENV === "local",
  });
}

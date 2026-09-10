// Archived software is used only as a frozen, loopback local compatibility server.
// Production storage selection and deployment are separate acceptance work.
export const MINIO_TEST_IMAGE =
  "minio/minio@sha256:d249d1fb6966de4d8ad26c04754b545205ff15a62e4fd19ebd0f26fa5baacbc0";
export const MC_IMAGE =
  "minio/mc@sha256:fb8f773eac8ef9d6da0486d5dec2f42f219358bcb8de579d1623d518c9ebd4cc";

/** One bounded local readiness attempt; callers own their retry policy.
 * AbortSignal.timeout alone is unreferenced. Keep this deadline alive until
 * the request settles, including transport gaps with no referenced socket.
 */
export async function localStorageReady(
  endpoint: string,
  timeoutMs = 1000,
): Promise<boolean> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout;
  const deadline = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(false);
    }, timeoutMs);
  });
  const request = (async () => {
    try {
      const response = await fetch(`${endpoint}/minio/health/ready`, {
        signal: controller.signal,
      });
      await response.body?.cancel();
      return response.ok;
    } catch {
      return false;
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer!);
  }
}

/** A health response may precede MinIO's S3 initialization. Retry only that explicit startup state. */
export async function waitForStorageApi(
  check: () => Promise<unknown>,
  milliseconds = 20_000,
) {
  const deadline = performance.now() + milliseconds;
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      const problem = error as {
        message?: string;
        $metadata?: { httpStatusCode?: number };
      };
      if (
        problem?.$metadata?.httpStatusCode !== 503 ||
        problem.message !== "Server not initialized yet, please try again."
      )
        throw error;
      const remaining = deadline - performance.now();
      if (remaining <= 0)
        throw new Error(
          "Local storage S3 initialization did not become ready before its deadline",
          { cause: error },
        );
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(250, remaining)),
      );
    }
  }
}

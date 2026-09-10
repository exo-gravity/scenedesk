import test from "node:test";
import { storageFixture } from "../support/storage.js";
// Temporary diagnostic: repeat the original cold-start path on the Linux runner.
for (let i = 0; i < 20; i++) {
  test(
    `storage cold-start diagnostic ${i + 1}`,
    { timeout: 60_000 },
    async (t) => {
      await storageFixture(t);
    },
  );
}

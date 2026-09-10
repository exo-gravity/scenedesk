import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG_IMAGE } from "@drama/media";
import { MINIO_TEST_IMAGE, MC_IMAGE } from "../tests/support/storage.js";

const exec = promisify(execFile);
for (const image of [FFMPEG_IMAGE, MINIO_TEST_IMAGE, MC_IMAGE]) {
  try {
    // An existing exact digest is sufficient; registry availability is not a runtime dependency.
    await exec("docker", ["image", "inspect", image, "--format", "{{.Id}}"], {
      timeout: 15_000,
    });
    console.log(`Verified cached test image: ${image}`);
    continue;
  } catch {}
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn("docker", ["pull", image], { stdio: "inherit" });
        child.once("error", reject);
        child.once("exit", (code) =>
          code === 0
            ? resolve()
            : reject(new Error(`Test image pull failed: ${image}`)),
        );
      });
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      console.log(`Retrying fixed test image download (${attempt + 1}/3).`);
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
}

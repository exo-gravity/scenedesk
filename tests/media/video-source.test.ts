import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileIntegrity, makeDerivative, probeMedia } from "@drama/media";
import { writeVideoFixture } from "../../scripts/video-fixture-file.js";
import { validateGeneratedVisual } from "../../packages/media/src/generated-output.js";

test(
  "technical video source and previews decode independently of object storage",
  { timeout: 480_000 },
  async (t) => {
    const directory = await mkdtemp(
      join(tmpdir(), "scenedesk-video-source-test-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    for (const withAudio of [false, true])
      await t.test(withAudio ? "AAC mixed track" : "silent video", async () => {
        const source = join(directory, withAudio ? "audio.mp4" : "silent.mp4");
        await writeVideoFixture(source, withAudio);
        const original = await fileIntegrity(source);
        const probe = await probeMedia(source, "video/mp4", t.signal);
        validateGeneratedVisual(probe, "video/mp4", {
          resolution: "256x144",
          durationSeconds: 2,
          withAudio,
        });
        assert.equal(probe.fpsNum, 24);
        assert.equal(probe.fpsDen, 1);
        assert.equal(probe.hasAudio, withAudio);
        const poster = await makeDerivative(
          source,
          probe,
          "poster",
          `${source}.jpg`,
          t.signal,
        );
        assert.equal(poster.kind, "image");
        assert.equal(poster.mime, "image/jpeg");
        assert.equal(poster.width, 256);
        assert.equal(poster.height, 144);
        assert.equal(poster.hasAudio, false);
        const proxy = await makeDerivative(
          source,
          probe,
          "proxy",
          `${source}.proxy.mp4`,
          t.signal,
        );
        assert.equal(proxy.kind, "video");
        assert.equal(proxy.mime, "video/mp4");
        assert.equal(proxy.hasAudio, withAudio);
        assert.equal(proxy.width, 256);
        assert.equal(proxy.height, 144);
        assert.deepEqual(await fileIntegrity(source), original);
        t.diagnostic(
          `MP4 audio=${withAudio}, sourceDurationUs=${probe.durationUs}, fps=${probe.fpsNum}/${probe.fpsDen}, sourceBytes=${original.bytes}, proxyDurationUs=${proxy.durationUs}, posterBytes=${poster.bytes}; source preserved`,
        );
      });
  },
);

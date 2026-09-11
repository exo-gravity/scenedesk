import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileIntegrity, probeMedia, makeDerivative } from "@drama/media";
import { writeAudioFixture } from "../../scripts/audio-fixture-file.js";
import { validateGeneratedOutput } from "../../packages/media/src/generated-output.js";

test(
  "technical PCM source preserves exact sample timing while AAC proxy remains independent",
  { timeout: 240000 },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "scenedesk-audio-source-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const file = join(dir, "tone.wav");
    await writeAudioFixture(file);
    const original = await fileIntegrity(file),
      probe = await probeMedia(file, "audio/wav", t.signal);
    validateGeneratedOutput(probe, "audio/wav", { durationSeconds: 2 });
    assert.equal(probe.kind, "audio");
    assert.equal(probe.durationUs, 2000000);
    assert.equal(probe.timing?.audioSampleRate, 48000);
    assert.equal(probe.timing?.audioChannels, 1);
    assert.equal(probe.width, undefined);
    assert.equal(probe.hasAudio, true);
    const proxy = await makeDerivative(
      file,
      probe,
      "proxy",
      join(dir, "proxy.mp4"),
      t.signal,
    );
    assert.equal(proxy.kind, "audio");
    assert.equal(proxy.mime, "audio/mp4");
    assert.equal(proxy.hasAudio, true);
    assert.equal(proxy.width, undefined);
    assert.equal(proxy.timing?.audioSampleRate, 48000);
    assert.deepEqual(await fileIntegrity(file), original);
    t.diagnostic(
      `PCM durationUs=${probe.durationUs}, sampleRate=${probe.timing?.audioSampleRate}, channels=${probe.timing?.audioChannels}, bytes=${original.bytes}; AAC proxyDurationUs=${proxy.durationUs}, source preserved`,
    );
  },
);

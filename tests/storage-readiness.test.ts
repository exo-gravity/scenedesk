import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// A separate process is essential: the test runner's other sockets/timers would
// otherwise hide the exact no-referenced-I/O condition observed in Linux CI.
function isolated(body: string) {
  const { NODE_TEST_CONTEXT: _context, ...childEnvironment } = process.env;
  const source = `
    import assert from 'node:assert/strict';
    import test from 'node:test';
    import { localStorageReady } from ${JSON.stringify(new URL("../scripts/local-storage.ts", import.meta.url).href)};
    test('isolated storage readiness', async () => { ${body} });
  `;
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", source],
    {
      encoding: "utf8",
      timeout: 5000,
      env: childEnvironment,
    },
  );
}

test("storage readiness reaches its deadline when transport has no referenced handles", () => {
  const child = isolated(`
    let pendingSignal;
    globalThis.fetch = async (_url, {signal}) => {
      pendingSignal = signal;
      return new Promise(() => {}); // no I/O handle, and no transport completion
    };
    assert.equal(await localStorageReady('http://127.0.0.1:1', 40), false);
    assert.equal(pendingSignal.aborted, true);
  `);
  assert.equal(child.status, 0, child.stdout + child.stderr);
});

test("storage readiness reports status and releases a successful attempt's deadline", () => {
  const child = isolated(`
    globalThis.fetch = async () => new Response('', {status:200});
    assert.equal(await localStorageReady('http://127.0.0.1:1', 30000), true);
    globalThis.fetch = async () => new Response('', {status:503});
    assert.equal(await localStorageReady('http://127.0.0.1:1', 30000), false);
    globalThis.fetch = async () => { throw new Error('connection unavailable'); };
    assert.equal(await localStorageReady('http://127.0.0.1:1', 30000), false);
  `);
  assert.equal(child.status, 0, child.stdout + child.stderr);
});

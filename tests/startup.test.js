import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import test from 'node:test';

test('an occupied backend port fails startup without reporting readiness', async (t) => {
  const occupied = createServer();
  await new Promise((resolve) => occupied.listen(0, '0.0.0.0', resolve));
  t.after(() => occupied.close());
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      TRACERISK_DB_PATH: ':memory:',
      PORT: String(occupied.address().port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const code = await new Promise((resolve, reject) => {
    child.once('close', resolve);
    child.once('error', reject);
  });
  assert.equal(code, 1);
  assert.match(output, /Could not start server.*EADDRINUSE/);
  assert.doesNotMatch(output, /server listening/);
});

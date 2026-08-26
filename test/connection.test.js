import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KlfConnection } from '../src/klf/connection.js';

// Regression test for a real race: onScanRequest, onPoll (per device) and the
// keep-alive timer can all call ensureConnected() around the same time. The
// KLF200 gateway only accepts a single session, so if two concurrent callers
// each opened their own connection attempt, the gateway would refuse one of
// them (observed as ECONNREFUSED against real hardware). Concurrent callers
// must share the same underlying attempt instead of each starting their own.
test('ensureConnected() only starts one underlying connection attempt for concurrent callers', async () => {
  const conn = new KlfConnection({
    ip: '203.0.113.1', // TEST-NET-3, never routable: the attempt fails fast, that's fine
    password: 'irrelevant',
    certificatePath: '/nonexistent/cert.pem', // fails fast at readFileSync
  });

  let connectAttempts = 0;
  const realConnect = conn._connect.bind(conn);
  conn._connect = async () => {
    connectAttempts += 1;
    return realConnect();
  };

  const [first, second] = await Promise.allSettled([
    conn.ensureConnected(),
    conn.ensureConnected(),
  ]);

  assert.equal(connectAttempts, 1, 'only one underlying connection attempt should have started');
  assert.equal(first.status, 'rejected');
  assert.equal(second.status, 'rejected');
  assert.equal(conn.connecting, null, 'the lock is released once the attempt settles');
});

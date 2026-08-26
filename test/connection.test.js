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

// Regression test: klf-200-api has no queue of its own around sendFrameAsync,
// and the KLF200's Busy error notification carries no session id, so two
// commands in flight at once (e.g. a Gladys scene moving several shutters)
// can both get rejected by a single Busy notification meant for only one of
// them. runExclusive() must serialize commands so this can never happen.
test('runExclusive() serializes commands so no two are ever in flight at once', async () => {
  const conn = new KlfConnection({
    ip: '203.0.113.1',
    password: 'irrelevant',
    certificatePath: '/nonexistent/cert.pem',
  });
  conn.ensureConnected = async () => {};

  const events = [];
  let inFlight = 0;

  function makeCommand(name, delayMs) {
    return async () => {
      inFlight += 1;
      assert.equal(inFlight, 1, `${name} started while another command was still in flight`);
      events.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      events.push(`${name}:end`);
      inFlight -= 1;
    };
  }

  // "first" is slower than "second": a naive Promise.all would let "second"
  // finish first. runExclusive() must still run them strictly in call order.
  const first = conn.runExclusive(makeCommand('first', 20));
  const second = conn.runExclusive(makeCommand('second', 5));
  await Promise.all([first, second]);

  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
});

test('runExclusive() does not block later commands after an earlier one rejects', async () => {
  const conn = new KlfConnection({
    ip: '203.0.113.1',
    password: 'irrelevant',
    certificatePath: '/nonexistent/cert.pem',
  });
  conn.ensureConnected = async () => {};

  const failing = conn.runExclusive(async () => {
    throw new Error('boom');
  });
  const succeeding = conn.runExclusive(async () => 'ok');

  await assert.rejects(failing, /boom/);
  assert.equal(await succeeding, 'ok');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import {
  percentToNativeRatio,
  percentToState,
  positionFeatureExternalId,
  productExternalIds,
  productToDiscoveredDevice,
  productToPercent,
  SHUTTER_STATE,
  stateFeatureExternalId,
} from '../src/klf/mapProduct.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const gladys = createFakeGladys();

// Gladys only accepts poll_frequency in MILLISECONDS from this fixed set
// (server-side DEVICE_POLL_FREQUENCIES, not exposed by the client SDK) —
// any other value is rejected with "invalid poll frequency". Mirrored here
// so a regression (e.g. sending seconds again) fails loudly in tests instead
// of only failing silently against a live Gladys instance.
const VALID_POLL_FREQUENCIES_MS = [60000, 30000, 15000, 10000, 2000, 1000];

function fakeProduct(overrides = {}) {
  return {
    NodeID: 3,
    Name: 'Volet salon',
    TargetPosition: 0.5,
    CurrentPosition: 0.5,
    ...overrides,
  };
}

test('productToDiscoveredDevice builds a shutter with position and state features', () => {
  const device = productToDiscoveredDevice(gladys, fakeProduct());
  assert.equal(device.name, 'Volet salon');
  assert.equal(device.external_id, productExternalIds(gladys, fakeProduct()).device);
  assert.equal(
    device.should_poll,
    true,
    'should_poll must be true or Gladys never schedules onPoll for it',
  );
  assert.ok(
    VALID_POLL_FREQUENCIES_MS.includes(device.poll_frequency),
    `poll_frequency must be one of ${VALID_POLL_FREQUENCIES_MS.join(', ')} (ms), got ${device.poll_frequency}`,
  );
  assert.equal(device.features.length, 2);

  const position = device.features.find((f) => f.type === DEVICE_FEATURE_TYPES.SHUTTER.POSITION);
  assert.equal(position.category, DEVICE_FEATURE_CATEGORIES.SHUTTER);
  assert.equal(position.min, 0);
  assert.equal(position.max, 100);
  assert.equal(position.read_only, false);
  assert.equal(position.external_id, positionFeatureExternalId(gladys, fakeProduct()));

  const state = device.features.find((f) => f.type === DEVICE_FEATURE_TYPES.SHUTTER.STATE);
  assert.equal(state.category, DEVICE_FEATURE_CATEGORIES.SHUTTER);
  assert.equal(state.min, SHUTTER_STATE.CLOSED);
  assert.equal(state.max, SHUTTER_STATE.OPEN);
  assert.equal(state.read_only, false);
  assert.equal(state.external_id, stateFeatureExternalId(gladys, fakeProduct()));
});

test('two different NodeIDs never collide on external_id', () => {
  const a = productToDiscoveredDevice(gladys, fakeProduct({ NodeID: 1 }));
  const b = productToDiscoveredDevice(gladys, fakeProduct({ NodeID: 2 }));
  assert.notEqual(a.external_id, b.external_id);
});

// klf-200-api reports the native io-homecontrol ratio (0 = open, 1 = closed);
// productToPercent must flip it to the Gladys/Google Home convention
// (0 = closed, 100 = open — see mapProduct.js for why).

test('productToPercent prefers TargetPosition when it is a valid number', () => {
  const percent = productToPercent(fakeProduct({ TargetPosition: 0.75, CurrentPosition: 0.2 }));
  assert.equal(percent, 25); // native 75% closed -> Gladys 25% open
});

test('productToPercent falls back to CurrentPosition when TargetPosition is not a number', () => {
  const percent = productToPercent(fakeProduct({ TargetPosition: NaN, CurrentPosition: 0.3 }));
  assert.equal(percent, 70); // native 30% closed -> Gladys 70% open
});

test('productToPercent defaults to fully open when neither position is a valid number', () => {
  const percent = productToPercent(
    fakeProduct({ TargetPosition: undefined, CurrentPosition: undefined }),
  );
  assert.equal(percent, 100); // native default 0 (open) -> Gladys 100% open
});

test('percentToState maps 0%/100%/partial to CLOSED/OPEN/STOPPED', () => {
  assert.equal(percentToState(0), SHUTTER_STATE.CLOSED);
  assert.equal(percentToState(100), SHUTTER_STATE.OPEN);
  assert.equal(percentToState(42), SHUTTER_STATE.STOPPED);
});

test('percentToNativeRatio converts the Gladys percent back to the native ratio', () => {
  assert.equal(percentToNativeRatio(100), 0); // fully open -> native 0
  assert.equal(percentToNativeRatio(0), 1); // fully closed -> native 1
  assert.equal(percentToNativeRatio(25), 0.75);
});

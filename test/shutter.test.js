import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findProductByDeviceExternalId, handleSetValue } from '../src/devices/shutter.js';
import { productExternalIds, SHUTTER_STATE } from '../src/klf/mapProduct.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const gladys = createFakeGladys();

function fakeProduct(overrides = {}) {
  const positionCalls = [];
  let stopCalls = 0;
  return {
    NodeID: 3,
    Name: 'Volet salon',
    TargetPosition: 0.5,
    CurrentPosition: 0.5,
    positionCalls,
    get stopCalls() {
      return stopCalls;
    },
    async setTargetPositionAsync(ratio) {
      positionCalls.push(ratio);
    },
    async stopAsync() {
      stopCalls += 1;
    },
    async refreshAsync() {},
    ...overrides,
  };
}

function fakeRegistry(products) {
  return {
    async list() {
      return products;
    },
    async refresh() {
      return products;
    },
    async runExclusive(fn) {
      return fn();
    },
  };
}

function idsFor(product) {
  const ids = productExternalIds(gladys, product);
  return {
    device: { external_id: ids.device },
    positionFeature: { external_id: ids.feature('position') },
    stateFeature: { external_id: ids.feature('state') },
  };
}

test('findProductByDeviceExternalId matches on the NodeID-derived external_id', () => {
  const product = fakeProduct();
  const externalId = productExternalIds(gladys, product).device;
  const found = findProductByDeviceExternalId(gladys, [product], externalId);
  assert.equal(found, product);
});

test('findProductByDeviceExternalId returns undefined for an unknown device', () => {
  const found = findProductByDeviceExternalId(gladys, [fakeProduct()], 'shutter:does-not-exist');
  assert.equal(found, undefined);
});

test('handleSetValue on the position feature clamps to 0-100 and converts to a native ratio', async () => {
  // Gladys convention: 0 = closed, 100 = open. Native ratio: 0 = open, 1 = closed.
  const product = fakeProduct();
  const registry = fakeRegistry([product]);
  const { device, positionFeature } = idsFor(product);

  await handleSetValue(gladys, registry, { device, feature: positionFeature, value: 150 });
  assert.equal(product.positionCalls.at(-1), 0); // clamped to 100% (open) -> native 0

  await handleSetValue(gladys, registry, { device, feature: positionFeature, value: -20 });
  assert.equal(product.positionCalls.at(-1), 1); // clamped to 0% (closed) -> native 1
});

test('handleSetValue on the state feature maps OPEN/CLOSED to 0%/100%', async () => {
  const product = fakeProduct();
  const registry = fakeRegistry([product]);
  const { device, stateFeature } = idsFor(product);

  await handleSetValue(gladys, registry, {
    device,
    feature: stateFeature,
    value: SHUTTER_STATE.OPEN,
  });
  assert.equal(product.positionCalls.at(-1), 0);

  await handleSetValue(gladys, registry, {
    device,
    feature: stateFeature,
    value: SHUTTER_STATE.CLOSED,
  });
  assert.equal(product.positionCalls.at(-1), 1);
});

test('handleSetValue on the state feature calls stopAsync for STOPPED', async () => {
  const product = fakeProduct();
  const registry = fakeRegistry([product]);
  const { device, stateFeature } = idsFor(product);

  await handleSetValue(gladys, registry, {
    device,
    feature: stateFeature,
    value: SHUTTER_STATE.STOPPED,
  });
  assert.equal(product.stopCalls, 1);
  assert.equal(product.positionCalls.length, 0);
});

test('handleSetValue throws on an unknown device', async () => {
  const registry = fakeRegistry([fakeProduct()]);
  await assert.rejects(
    () =>
      handleSetValue(gladys, registry, {
        device: { external_id: 'shutter:does-not-exist' },
        feature: { external_id: 'shutter:does-not-exist:position' },
        value: 50,
      }),
    /Unknown shutter/,
  );
});

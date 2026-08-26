// -----------------------------------------------------------------------------
// Shutter device orchestration: turns the live ProductRegistry into Gladys
// discovery payloads, and routes onSetValue/onPoll back to the right product.
//
// Each shutter exposes TWO controllable features, both accepted by Gladys:
//   - "position": a 0-100% slider.
//   - "state": an open/stop/close button (1/0/-1).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import {
  percentToState,
  positionFeatureExternalId,
  productExternalIds,
  productToDiscoveredDevice,
  productToPercent,
  SHUTTER_STATE,
  stateFeatureExternalId,
} from '../klf/mapProduct.js';

const logger = createLogger({ name: 'shutter' });

// Delay before refreshing the position after a move command, scaled by the
// distance to travel (min 3s, max 20s) — same heuristic as the standalone
// MQTT bridge, since the gateway doesn't push a "move finished" event.
const MIN_MOVE_DELAY_MS = 3000;
const MAX_MOVE_DELAY_MS = 20000;

export async function buildDiscoveredShutters(gladys, productRegistry) {
  const products = await productRegistry.list();
  return products.map((product) => productToDiscoveredDevice(gladys, product));
}

export function findProductByDeviceExternalId(gladys, products, externalId) {
  return products.find((product) => productExternalIds(gladys, product).device === externalId);
}

async function resolveProduct(gladys, productRegistry, externalId) {
  const products = await productRegistry.list();
  let product = findProductByDeviceExternalId(gladys, products, externalId);
  if (!product) {
    // Stale cache (gateway restarted, product re-paired): reload once.
    await productRegistry.refresh();
    product = findProductByDeviceExternalId(gladys, await productRegistry.list(), externalId);
  }
  return product;
}

export async function handleSetValue(gladys, productRegistry, { device, feature, value }) {
  const product = await resolveProduct(gladys, productRegistry, device.external_id);
  if (!product) {
    throw new Error(`Unknown shutter: ${device.external_id}`);
  }

  if (feature.external_id === stateFeatureExternalId(gladys, product)) {
    await handleSetState(gladys, product, value);
    return;
  }

  await handleSetPosition(gladys, product, value);
}

async function handleSetPosition(gladys, product, value) {
  const targetPercent = Math.max(0, Math.min(100, value));
  const currentPercent = productToPercent(product);
  logger.info(`Moving '${product.Name}' from ${currentPercent}% to ${targetPercent}%`);

  await product.setTargetPositionAsync(targetPercent / 100);
  scheduleRefresh(gladys, product, currentPercent, targetPercent);
}

async function handleSetState(gladys, product, value) {
  const currentPercent = productToPercent(product);

  if (value === SHUTTER_STATE.STOPPED) {
    logger.info(`Stopping '${product.Name}' at its current position`);
    await product.stopAsync();
    scheduleRefresh(gladys, product, currentPercent, currentPercent);
    return;
  }

  const targetPercent = value === SHUTTER_STATE.OPEN ? 0 : 100;
  logger.info(`Setting '${product.Name}' to ${value === SHUTTER_STATE.OPEN ? 'OPEN' : 'CLOSED'} (${targetPercent}%)`);
  await product.setTargetPositionAsync(targetPercent / 100);
  scheduleRefresh(gladys, product, currentPercent, targetPercent);
}

function scheduleRefresh(gladys, product, currentPercent, targetPercent) {
  const distance = Math.abs(currentPercent - targetPercent);
  const delay = Math.max(MIN_MOVE_DELAY_MS, (distance / 100) * MAX_MOVE_DELAY_MS);
  setTimeout(() => {
    refreshAndPublish(gladys, product).catch((error) =>
      logger.error(`Failed to refresh '${product.Name}' after a move`, error),
    );
  }, delay);
}

export async function handlePoll(gladys, productRegistry, device) {
  const product = await resolveProduct(gladys, productRegistry, device.external_id);
  if (!product) {
    logger.warn(`Poll ignored: unknown shutter ${device.external_id}`);
    return;
  }
  await refreshAndPublish(gladys, product);
}

async function refreshAndPublish(gladys, product) {
  await product.refreshAsync();
  const percent = productToPercent(product);
  logger.info(`'${product.Name}' is now at ${percent}%`);
  await gladys.publishStates([
    { device_feature_external_id: positionFeatureExternalId(gladys, product), state: percent },
    { device_feature_external_id: stateFeatureExternalId(gladys, product), state: percentToState(percent) },
  ]);
}

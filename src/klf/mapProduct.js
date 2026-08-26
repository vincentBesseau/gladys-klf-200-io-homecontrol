// -----------------------------------------------------------------------------
// Pure mapping: klf-200-api `Product` <-> Gladys discovered-device payload.
// No I/O here on purpose, so this stays unit-testable without a live gateway.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

const DEVICE_TYPE = 'shutter';
const FEATURE_POSITION = 'position';
const FEATURE_STATE = 'state';

// Gladys only accepts poll_frequency in MILLISECONDS from a fixed set
// (60000/30000/15000/10000/2000/1000 — server-side DEVICE_POLL_FREQUENCIES,
// not exposed by the client SDK; any other value is rejected with "invalid
// poll frequency"). The KLF200 is a fragile, single-session gateway, so we
// always use the coarsest option rather than exposing a free-form config
// field that could produce an invalid value.
const POLL_FREQUENCY_MS = 60 * 1000;

// Gladys's shutter "state" convention (open/stop/close button): not exported
// by the SDK's constants, confirmed against a live Gladys instance —
// OPEN=1, STOPPED/PARTIAL=0, CLOSED=-1. Matches the convention already used
// by the standalone MQTT bridge (mqtt-klf.js).
export const SHUTTER_STATE = { OPEN: 1, STOPPED: 0, CLOSED: -1 };

/**
 * Stable ids for one physical shutter, keyed by its KLF200 NodeID (the system
 * table index assigned when the product was paired to the gateway — stable
 * across restarts as long as the product isn't removed/re-paired).
 */
export function productExternalIds(gladys, product) {
  return gladys.externalIds(DEVICE_TYPE, String(product.NodeID));
}

export function positionFeatureExternalId(gladys, product) {
  return productExternalIds(gladys, product).feature(FEATURE_POSITION);
}

export function stateFeatureExternalId(gladys, product) {
  return productExternalIds(gladys, product).feature(FEATURE_STATE);
}

export function productToDiscoveredDevice(gladys, product) {
  const ids = productExternalIds(gladys, product);
  return {
    name: product.Name,
    external_id: ids.device,
    // Gladys only schedules onPoll for a device when should_poll is
    // explicitly true — a poll_frequency alone is not enough (defaults to
    // false at the DB level, silently never polled otherwise).
    should_poll: true,
    poll_frequency: POLL_FREQUENCY_MS,
    features: [
      {
        name: 'Position',
        external_id: ids.feature(FEATURE_POSITION),
        category: DEVICE_FEATURE_CATEGORIES.SHUTTER,
        type: DEVICE_FEATURE_TYPES.SHUTTER.POSITION,
        unit: DEVICE_FEATURE_UNITS.PERCENT,
        min: 0,
        max: 100,
        read_only: false,
        has_feedback: true,
        keep_history: true,
      },
      {
        name: 'State',
        external_id: ids.feature(FEATURE_STATE),
        category: DEVICE_FEATURE_CATEGORIES.SHUTTER,
        type: DEVICE_FEATURE_TYPES.SHUTTER.STATE,
        min: SHUTTER_STATE.CLOSED,
        max: SHUTTER_STATE.OPEN,
        read_only: false,
        has_feedback: true,
        keep_history: true,
      },
    ],
  };
}

// klf-200-api's own TargetPosition/CurrentPosition (0-1) follow the raw
// io-homecontrol convention: 0 = fully open, 1 = fully closed — confirmed
// against real hardware. Gladys' own ecosystem (and, concretely, Google
// Home's OpenClose trait: "openPercent, where 0 is closed and 100 is fully
// open") expects the OPPOSITE: 0% = closed, 100% = open. Gladys' own UI
// doesn't care either way (it just showed a number), so this only surfaced
// once a device was exposed through Google Home, where every command came
// back inverted. `productToPercent` converts native -> Gladys convention;
// `percentToNativeRatio` converts back for the hardware call. Never call
// `setTargetPositionAsync` with a Gladys-convention percent directly.

/**
 * Current position as a 0-100 percent integer, 0 = closed, 100 = open
 * (Gladys/Google Home convention). TargetPosition is preferred over
 * CurrentPosition right after a move command (mirrors the heuristic already
 * used by the standalone MQTT bridge): the gateway reports the target
 * immediately, while CurrentPosition lags until the shutter finishes moving
 * and reports back.
 */
export function productToPercent(product) {
  const raw =
    typeof product.TargetPosition === 'number' && !Number.isNaN(product.TargetPosition)
      ? product.TargetPosition
      : typeof product.CurrentPosition === 'number' && !Number.isNaN(product.CurrentPosition)
        ? product.CurrentPosition
        : 0;
  return 100 - Math.round(raw * 100);
}

/**
 * Converts a Gladys-convention percent (0 = closed, 100 = open) to the
 * native io-homecontrol ratio (0 = open, 1 = closed) expected by
 * `setTargetPositionAsync`.
 */
export function percentToNativeRatio(percent) {
  return (100 - percent) / 100;
}

export function percentToState(percent) {
  if (percent === 100) {
    return SHUTTER_STATE.OPEN;
  }
  if (percent === 0) {
    return SHUTTER_STATE.CLOSED;
  }
  return SHUTTER_STATE.STOPPED;
}

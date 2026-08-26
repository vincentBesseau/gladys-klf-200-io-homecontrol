// -----------------------------------------------------------------------------
// Entry point of the Gladys external integration for Velux/KLF200 shutters.
//
// Role of this file: wire the SDK to the KLF200 connection + product registry.
// All hardware logic lives in src/klf/ (connection, product cache, mapping)
// and src/devices/shutter.js (discovery/command/poll orchestration).
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { KlfConnection } from './src/klf/connection.js';
import { ProductRegistry } from './src/klf/products.js';
import { buildDiscoveredShutters, handlePoll, handleSetValue } from './src/devices/shutter.js';

const CERT_PATH = new URL('./cert/velux-cert.pem', import.meta.url);
const RETRY_DELAY_MS = 30 * 1000;

const gladys = new GladysIntegration();

let config = normalizeConfig();
let klfConnection = createKlfConnection(config);
let productRegistry = new ProductRegistry(klfConnection);
let retryTimer = null;

function createKlfConnection(cfg) {
  return new KlfConnection({
    ip: cfg.klf200_ip,
    password: cfg.klf200_password,
    certificatePath: CERT_PATH,
    fingerprint: cfg.klf200_fingerprint || undefined,
  });
}

async function rebuildAndPublishDevices() {
  await gladys.publishDiscoveredDevices(await buildDiscoveredShutters(gladys, productRegistry));
}

// Only tears down and recreates the KLF200 connection when the gateway
// settings actually changed. The Gladys WebSocket reconnects for life with
// backoff (per the SDK), which would otherwise recreate a KLF200 session on
// every reconnect and orphan the previous socket — the gateway only accepts
// a small number of concurrent API sessions.
async function applyConfig(newConfig) {
  const previous = config;
  config = newConfig;

  const connectionChanged =
    previous.klf200_ip !== newConfig.klf200_ip ||
    previous.klf200_password !== newConfig.klf200_password ||
    previous.klf200_fingerprint !== newConfig.klf200_fingerprint;

  if (connectionChanged) {
    await klfConnection.disconnect().catch(() => {});
    klfConnection = createKlfConnection(newConfig);
    productRegistry = new ProductRegistry(klfConnection);
  }
}

// --- Discovery: Gladys asks for the list of shutters --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> discovering Velux shutters on the KLF200');
  await productRegistry.refresh();
  await rebuildAndPublishDevices();
});

// --- Command: the user moves a shutter from Gladys -----------------------------
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  await handleSetValue(gladys, productRegistry, { device, feature, value });
});

// --- Polling: Gladys asks to refresh a shutter's position ----------------------
gladys.onPoll(async (device) => {
  await handlePoll(gladys, productRegistry, device);
});

// --- Configuration updated by the user ------------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  await applyConfig(normalizeConfig(newConfig));
  await rebuildAndPublishDevices();
});

// --- Connection lifecycle --------------------------------------------------------
async function initializeAfterConnect() {
  clearRetry();
  try {
    await applyConfig(normalizeConfig(await gladys.getConfig()));
    await rebuildAndPublishDevices();
    await gladys.setConnectionStatus(true);
  } catch (error) {
    logger.error('Post-connection initialization failed', error);
    await gladys
      .setConnectionStatus(false, {
        en: 'Could not reach the KLF200 gateway, check the IP/password in the configuration.',
        fr: "Impossible de joindre la passerelle KLF200, vérifiez l'IP/le mot de passe dans la configuration.",
      })
      .catch(() => {});
    // The gateway only accepts one session and is often slow to release a
    // stale one — unlike a transient network hiccup, nothing else will
    // naturally retry this, so self-heal on a timer (mirrors the standalone
    // MQTT bridge's 30s reconnect loop).
    scheduleRetry();
  }
}

function scheduleRetry() {
  clearRetry();
  retryTimer = setTimeout(() => {
    retryTimer = null;
    initializeAfterConnect();
  }, RETRY_DELAY_MS);
}

function clearRetry() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

gladys.on('connected', initializeAfterConnect);

gladys.on('disconnected', () => {
  clearRetry();
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown(async () => {
  clearRetry();
  await klfConnection.disconnect();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Velux KLF200 integration...');
gladys.connect().catch((error) => {
  logger.error('Initial connection failed', error);
  process.exit(1);
});

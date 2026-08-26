// -----------------------------------------------------------------------------
// KLF200 connection lifecycle: login, TLS certificate, reconnection.
// Ported from the standalone MQTT bridge's connectKLF()/keepAlive() logic
// (see the sibling mqtt-klf.js project) but exposed as a small class so the
// SDK's event-driven handlers (onScanRequest/onSetValue/onPoll) can lazily
// ensure a live connection instead of relying on a background-only loop.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { Connection } from 'klf-200-api';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'klf-connection' });

export class KlfConnection {
  constructor({ ip, password, certificatePath, fingerprint }) {
    this.ip = ip;
    this.password = password;
    this.certificatePath = certificatePath;
    this.fingerprint = fingerprint || undefined;
    this.klf = null;
    this.crashCount = 0;
    this.connecting = null;
  }

  isConnected() {
    return Boolean(this.klf && this.klf.socket && this.klf.socket.writable);
  }

  /**
   * Returns the live `Connection` instance, (re)logging in if needed.
   *
   * The gateway only accepts a single session at a time, and this method is
   * called from several independent triggers (onScanRequest, onPoll — once
   * per device) that can overlap. Without a lock, two concurrent callers
   * would both see isConnected() === false and each open their own
   * competing connection, causing the gateway to refuse one of them. All
   * concurrent callers share the same in-flight attempt instead.
   */
  async ensureConnected() {
    if (this.isConnected()) {
      return this.klf;
    }
    if (!this.connecting) {
      this.connecting = this._connect().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  async _connect() {
    try {
      const certificate = readFileSync(this.certificatePath);
      this.klf = new Connection(this.ip, certificate, this.fingerprint);
      await this.klf.loginAsync(this.password);
      this.crashCount = 0;
      logger.info(`Connected to the KLF200 gateway at ${this.ip}`);
      return this.klf;
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  handleError(error) {
    logger.error('KLF200 connection error', error);
    try {
      this.klf?.socket?.destroy();
    } catch (closeError) {
      logger.error('Error while closing the KLF200 socket', closeError);
    }
    this.klf = null;
    this.crashCount += 1;
    return this.crashCount;
  }

  async disconnect() {
    if (!this.klf) {
      return;
    }
    try {
      await this.klf.logoutAsync();
      logger.info('KLF200 session closed');
    } catch (error) {
      logger.error('Error while logging out of the KLF200', error);
    } finally {
      this.klf = null;
    }
  }
}

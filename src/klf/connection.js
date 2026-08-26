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

// klf-200-api's own initSocketAsync() (called by loginAsync before the
// password exchange) has NO timeout of its own: a TCP connect that never
// gets a response (as opposed to a fast ECONNREFUSED) hangs the returned
// promise forever, which would silently block our retry loop. This bounds
// the whole login attempt so ensureConnected() always eventually settles.
const CONNECT_TIMEOUT_MS = 45 * 1000;

export class KlfConnection {
  constructor({ ip, password, certificatePath, fingerprint }) {
    this.ip = ip;
    this.password = password;
    this.certificatePath = certificatePath;
    this.fingerprint = fingerprint || undefined;
    this.klf = null;
    this.crashCount = 0;
    this.connecting = null;
    this.queue = Promise.resolve();
  }

  isConnected() {
    // klf-200-api does NOT expose a public `.socket` property (checked
    // against the installed version's source) — that check was always
    // `undefined`, so this always returned false and every call below
    // re-logged in, orphaning the previous session without logging out.
    // `KLF200SocketProtocol` is the real public getter: set once the login
    // handshake succeeds, cleared back to undefined on logout.
    return Boolean(this.klf && this.klf.KLF200SocketProtocol);
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

  /**
   * Runs `fn()` once every previously queued operation has settled (success
   * or failure), guaranteeing the KLF200 never sees two requests in flight
   * at once on the shared session.
   *
   * klf-200-api has no queue or lock of its own around sendFrameAsync, and
   * the gateway's Busy error notification carries no session id — so under
   * concurrent commands (e.g. a Gladys scene moving several shutters at
   * once), a single Busy notification rejects EVERY currently pending
   * command, not just the one that overran the gateway. The standalone
   * mqtt-klf.js bridge already worked around this with its own
   * commandQueue/enqueueCommand; this is the same pattern.
   */
  runExclusive(fn) {
    const run = async () => {
      await this.ensureConnected();
      return fn();
    };
    const result = this.queue.then(run, run);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async _connect() {
    try {
      const certificate = readFileSync(this.certificatePath);
      this.klf = new Connection(this.ip, certificate, this.fingerprint);
      await withTimeout(
        this.klf.loginAsync(this.password),
        CONNECT_TIMEOUT_MS,
        `Timed out connecting to the KLF200 gateway at ${this.ip} after ${CONNECT_TIMEOUT_MS / 1000}s`,
      );
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
    const staleConnection = this.klf;
    this.klf = null;
    this.crashCount += 1;
    // Best-effort: ask the gateway to close whatever session (possibly only
    // half-open) this attempt left behind, so it frees the slot sooner
    // instead of waiting out its own idle timeout. Never blocks the caller
    // (the retry loop must proceed immediately) and never throws.
    staleConnection?.logoutAsync(5).catch((closeError) => {
      logger.error('Error while closing the stale KLF200 session', closeError);
    });
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

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

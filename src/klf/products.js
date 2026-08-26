// -----------------------------------------------------------------------------
// Cached view of the KLF200's known products (shutters), refreshed on demand.
// The gateway only ever reports products already paired through the Velux app
// or the gateway's own pairing UI — this never triggers new hardware pairing.
// -----------------------------------------------------------------------------

import { Products } from 'klf-200-api';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'klf-products' });

export class ProductRegistry {
  constructor(klfConnection) {
    this.klfConnection = klfConnection;
    this.products = null;
  }

  async refresh() {
    this.products = await this.klfConnection.runExclusive(() =>
      Products.createProductsAsync(this.klfConnection.klf),
    );
    logger.info(`Loaded ${this.products.Products.length} product(s) from the KLF200`);
    return this.products.Products;
  }

  async list() {
    if (!this.products) {
      await this.refresh();
    }
    return this.products.Products;
  }

  /**
   * Passthrough so callers that already hold a ProductRegistry (shutter.js)
   * don't need a separate reference to the KlfConnection to serialize the
   * commands they send through a cached Product.
   */
  runExclusive(fn) {
    return this.klfConnection.runExclusive(fn);
  }

  /**
   * Looks up a product by NodeID, reloading once if not found — the cache can
   * go stale across a KLF200 reboot or a re-pairing.
   */
  async findByNodeId(nodeId) {
    const products = await this.list();
    const found = products.find((product) => product.NodeID === nodeId);
    if (found) {
      return found;
    }
    await this.refresh();
    return this.products.Products.find((product) => product.NodeID === nodeId);
  }
}

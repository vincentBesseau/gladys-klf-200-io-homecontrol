// Defaults: MUST stay consistent with the `default` values declared in the
// `config_schema` of gladys-assistant-integration.json.
export const DEFAULT_CONFIG = {
  klf200_ip: '',
  klf200_password: '',
  klf200_fingerprint: '',
};

/**
 * Merge the user config with the defaults, coercing types (config may arrive
 * as strings from a form).
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    klf200_ip: String(raw.klf200_ip ?? DEFAULT_CONFIG.klf200_ip),
    klf200_password: String(raw.klf200_password ?? DEFAULT_CONFIG.klf200_password),
    klf200_fingerprint: String(raw.klf200_fingerprint ?? DEFAULT_CONFIG.klf200_fingerprint),
  };
}

import type { Secret } from '../secrets/secret.js';

/** Both halves of an exchange API key are treated as secrets. */
export type ApiCredentials = {
  apiKey: Secret;
  apiSecret: Secret;
};

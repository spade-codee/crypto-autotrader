import { keyringFromEnv, type Keyring } from '../../src/vault/keyring.js';

export { useTestDatabase } from './database.js';

/**
 * A deterministic keyring for tests. `versions` maps a key version to the byte
 * every position of that 32-byte key is filled with.
 */
export function testKeyring(versions: Record<number, number> = { 1: 1 }, active = 1): Keyring {
  const env: Record<string, string> = { VAULT_ACTIVE_KEY_VERSION: String(active) };
  for (const [version, fill] of Object.entries(versions)) {
    env[`VAULT_MASTER_KEY_V${version}`] = Buffer.alloc(32, fill).toString('base64');
  }
  return keyringFromEnv(env);
}

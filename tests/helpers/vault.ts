import { afterAll, beforeAll, beforeEach } from 'vitest';
import { openDatabase, type Database } from '../../src/db/client.js';
import { exchangeCredentials } from '../../src/db/schema.js';
import { keyringFromEnv, type Keyring } from '../../src/vault/keyring.js';

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

/**
 * One in-memory database for a whole test file, emptied before every test.
 *
 * Starting PGlite takes several seconds. A fresh database per test made a single
 * seven-test file take 30 seconds — slow enough to discourage running the suite.
 * Emptying the tables keeps each test independent at a fraction of the cost.
 * Call at the top level of a test file, then use `database()` inside tests.
 */
export function useTestDatabase(): () => Database {
  let opened: { db: Database; close: () => Promise<void> } | undefined;

  beforeAll(async () => {
    opened = await openDatabase();
  });
  beforeEach(async () => {
    await opened!.db.delete(exchangeCredentials);
  });
  afterAll(async () => {
    await opened?.close();
  });

  return () => {
    if (opened === undefined) {
      throw new Error('useTestDatabase() must be called at the top level of a test file');
    }
    return opened.db;
  };
}

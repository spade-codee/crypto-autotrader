import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/client.js';
import { exchangeCredentials } from '../../src/db/schema.js';

const row = {
  userId: 'alice',
  exchange: 'bybit',
  environment: 'testnet',
  apiKeyHint: 'ABCD',
  keyVersion: 1,
  iv: 'aXY=',
  authTag: 'dGFn',
  ciphertext: 'Y3Q=',
};

describe('openDatabase', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('opens an in-memory database with migrations applied', async () => {
    const opened = await openDatabase();
    close = opened.close;
    await opened.db.insert(exchangeCredentials).values(row);
    const rows = await opened.db.select().from(exchangeCredentials);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.createdAt).toBeInstanceOf(Date);
    expect(rows[0]!.validatedAt).toBeNull();
  });

  it('enforces one credential per user, exchange, and environment', async () => {
    const opened = await openDatabase();
    close = opened.close;
    await opened.db.insert(exchangeCredentials).values(row);
    await expect(opened.db.insert(exchangeCredentials).values(row)).rejects.toThrow();
    await opened.db.insert(exchangeCredentials).values({ ...row, environment: 'mainnet' });
    expect(await opened.db.select().from(exchangeCredentials)).toHaveLength(2);
  });
});

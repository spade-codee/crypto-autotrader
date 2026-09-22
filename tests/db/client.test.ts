import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, openMemoryDatabase } from '../../src/db/client.js';
import { exchangeCredentials } from '../../src/db/schema.js';
import { acquireLock, LockBusyError, lockNameFor } from '../../src/ops/lock.js';

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

describe('openMemoryDatabase', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('opens an in-memory database with migrations applied', async () => {
    const opened = await openMemoryDatabase();
    close = opened.close;
    await opened.db.insert(exchangeCredentials).values(row);
    const rows = await opened.db.select().from(exchangeCredentials);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.createdAt).toBeInstanceOf(Date);
    expect(rows[0]!.validatedAt).toBeNull();
  });

  it('enforces one credential per user, exchange, and environment', async () => {
    const opened = await openMemoryDatabase();
    close = opened.close;
    await opened.db.insert(exchangeCredentials).values(row);
    await expect(opened.db.insert(exchangeCredentials).values(row)).rejects.toThrow();
    await opened.db.insert(exchangeCredentials).values({ ...row, environment: 'mainnet' });
    expect(await opened.db.select().from(exchangeCredentials)).toHaveLength(2);
  });
});

describe('openDatabase, on disk', () => {
  let dir: string;
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Whether some holder has the lock for `dataDir` right now. */
  async function lockHeld(dataDir: string): Promise<boolean> {
    try {
      const release = await acquireLock(lockNameFor(dataDir), { waitMs: 0 });
      await release();
      return false;
    } catch (error) {
      if (error instanceof LockBusyError) {
        return true;
      }
      throw error;
    }
  }

  it('holds the lock while the database is open, and keeps its data between opens', async () => {
    dir = mkdtempSync(join(tmpdir(), 'db-'));
    const first = await openDatabase(dir);
    expect(await lockHeld(dir)).toBe(true);
    await first.db.insert(exchangeCredentials).values(row);
    await first.close();
    expect(await lockHeld(dir)).toBe(false);

    const second = await openDatabase(dir);
    expect(await second.db.select().from(exchangeCredentials)).toHaveLength(1);
    await second.close();
  }, 60_000);

  it('refuses a second open of the same directory while the first is open', async () => {
    dir = mkdtempSync(join(tmpdir(), 'db-'));
    const first = await openDatabase(dir);
    try {
      await expect(openDatabase(dir, { lockWaitMs: 50 })).rejects.toThrow(LockBusyError);
    } finally {
      await first.close();
    }
  }, 60_000);

  it('gives up the lock only after the database has closed', async () => {
    dir = mkdtempSync(join(tmpdir(), 'db-'));
    const opened = await openDatabase(dir);
    const close = PGlite.prototype.close;
    let heldWhileClosing: boolean | undefined;
    vi.spyOn(PGlite.prototype, 'close').mockImplementation(async function (this: PGlite) {
      heldWhileClosing = await lockHeld(dir);
      return close.call(this);
    });
    await opened.close();
    expect(heldWhileClosing).toBe(true);
    expect(await lockHeld(dir)).toBe(false);
  }, 60_000);
});

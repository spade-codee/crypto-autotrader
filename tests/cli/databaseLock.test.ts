import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openContext } from '../../src/cli/context.js';
import { openEngine } from '../../src/cli/engineContext.js';
import { LockBusyError } from '../../src/ops/lock.js';

/**
 * The key commands (key:add, key:check, balance) open the database through
 * openContext, and the engine's commands through openEngine. Both default to
 * data/db, so both must hold the same lock, named for the same directory.
 */
describe('every command that opens the database holds the same lock', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'db-lock-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const engineEnv = (dbDir: string) => ({ TRADING_MODE: 'paper', DB_DIR: dbDir });
  // A throwaway vault key for the key commands' context: 32 bytes, base64.
  const keyEnv = (dbDir: string) => ({
    DB_DIR: dbDir,
    VAULT_ACTIVE_KEY_VERSION: '1',
    VAULT_MASTER_KEY_V1: Buffer.alloc(32, 7).toString('base64'),
  });

  it('a key command cannot open the database while the engine has it', async () => {
    const engine = await openEngine({ env: engineEnv(dir) });
    try {
      await expect(openContext({ env: keyEnv(dir), lockWaitMs: 100 })).rejects.toThrow(LockBusyError);
    } finally {
      await engine.close();
    }
    const context = await openContext({ env: keyEnv(dir), lockWaitMs: 100 });
    await context.close();
  }, 60_000);

  it('the engine cannot open the database while a key command has it', async () => {
    const context = await openContext({ env: keyEnv(dir) });
    try {
      await expect(openEngine({ env: engineEnv(dir), lockWaitMs: 100 })).rejects.toThrow(LockBusyError);
    } finally {
      await context.close();
    }
    const engine = await openEngine({ env: engineEnv(dir), lockWaitMs: 100 });
    await engine.close();
  }, 60_000);

  it('holds the same lock however DB_DIR is written', async () => {
    const engine = await openEngine({ env: engineEnv(dir) });
    try {
      for (const spelling of [`${dir}/`, join(dir, '..', dir.split(/[\\/]/).at(-1)!), relative(process.cwd(), dir)]) {
        await expect(openContext({ env: keyEnv(spelling), lockWaitMs: 50 }), spelling).rejects.toThrow(LockBusyError);
      }
    } finally {
      await engine.close();
    }
  }, 60_000);
});

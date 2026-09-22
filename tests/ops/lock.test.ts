import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireLock, LockBusyError, processIsAlive } from '../../src/ops/lock.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lock-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('acquireLock', () => {
  it('takes a free lock, holding its PID, and releases it', async () => {
    const file = join(dir, 'db.lock');
    const release = await acquireLock(file, { pid: 111 });
    expect(readFileSync(file, 'utf8')).toBe('111');
    release();
    expect(existsSync(file)).toBe(false);
  });

  it('waits for a live holder, then gives up', async () => {
    const file = join(dir, 'db.lock');
    await acquireLock(file, { pid: 111 });
    await expect(
      acquireLock(file, { pid: 222, waitMs: 30, pollMs: 5, isAlive: () => true }),
    ).rejects.toThrow(LockBusyError);
  });

  it('takes over a lock whose holder has died', async () => {
    const file = join(dir, 'db.lock');
    await acquireLock(file, { pid: 111 });
    const release = await acquireLock(file, { pid: 222, isAlive: (pid) => pid !== 111 });
    expect(readFileSync(file, 'utf8')).toBe('222');
    release();
  });

  it('never removes a lock that someone else now holds', async () => {
    const file = join(dir, 'db.lock');
    const release = await acquireLock(file, { pid: 111 });
    writeFileSync(file, '222');
    release();
    expect(readFileSync(file, 'utf8')).toBe('222');
  });

  it('creates the directory it needs', async () => {
    const release = await acquireLock(join(dir, 'a', 'b', 'db.lock'), { pid: 111 });
    release();
  });
});

describe('processIsAlive', () => {
  it('reports this process as alive', () => {
    expect(processIsAlive(process.pid)).toBe(true);
  });
});

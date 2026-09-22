import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireLock, lockAddress, LockBusyError, lockNameFor } from '../../src/ops/lock.js';

/** A lock name no other test, or earlier run, uses. */
const uniqueName = () => `crypto-autotrader-test-${process.pid}-${Math.random().toString(36).slice(2)}`;

describe('acquireLock', () => {
  it('takes a free lock, and frees it on release', async () => {
    const name = uniqueName();
    const release = await acquireLock(name);
    await release();
    const again = await acquireLock(name, { waitMs: 0 });
    await again();
  });

  it('refuses a second holder, even in the same process, and gives up after waiting', async () => {
    const name = uniqueName();
    const release = await acquireLock(name);
    await expect(acquireLock(name, { waitMs: 50, pollMs: 10 })).rejects.toThrow(LockBusyError);
    await release();
  });

  it('waits for the holder to finish', async () => {
    const name = uniqueName();
    const release = await acquireLock(name);
    setTimeout(() => void release(), 100);
    const second = await acquireLock(name, { waitMs: 5_000, pollMs: 20 });
    await second();
  });

  it('can be released more than once', async () => {
    const release = await acquireLock(uniqueName());
    await release();
    await expect(release()).resolves.toBeUndefined();
  });
});

describe('lockNameFor', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lock-name-'));
    mkdirSync(join(dir, 'db'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is the same however the directory is written', () => {
    const db = join(dir, 'db');
    const name = lockNameFor(db);
    expect(lockNameFor(`${db}/`)).toBe(name);
    expect(lockNameFor(join(db, '..', 'db'))).toBe(name);
    expect(lockNameFor(relative(process.cwd(), db))).toBe(name);
  });

  it('follows a symbolic link or junction to the directory itself', () => {
    const link = join(dir, 'link');
    symlinkSync(join(dir, 'db'), link, 'junction');
    expect(lockNameFor(link)).toBe(lockNameFor(join(dir, 'db')));
  });

  it.runIf(process.platform === 'win32')('ignores letter case on Windows, whose paths do', () => {
    const db = join(dir, 'db');
    expect(lockNameFor(db.toUpperCase())).toBe(lockNameFor(db));
  });

  it('differs between directories', () => {
    mkdirSync(join(dir, 'other'));
    expect(lockNameFor(join(dir, 'other'))).not.toBe(lockNameFor(join(dir, 'db')));
  });
});

describe('lockAddress', () => {
  it('is a named pipe on Windows and an abstract socket on Linux', () => {
    expect(lockAddress('n', 'win32')).toBe('\\\\.\\pipe\\n');
    expect(lockAddress('n', 'linux')).toBe('\0n');
  });

  it('refuses a platform where the operating system would not free a dead holder', () => {
    expect(() => lockAddress('n', 'darwin')).toThrow('Linux and Windows');
  });
});

describe('the lock across processes', () => {
  const TSX = createRequire(import.meta.url).resolve('tsx/cli');
  const CONTENDER = fileURLToPath(new URL('./lockContender.ts', import.meta.url));

  type Contender = { child: ChildProcess; output: () => string; exited: Promise<number | null> };

  function contend(name: string, marker: string, hold: string): Contender {
    const child = spawn(process.execPath, [TSX, CONTENDER, name, marker, hold], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout!.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr!.on('data', (chunk: Buffer) => (output += chunk.toString()));
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
    return { child, output: () => output, exited };
  }

  async function saw(contender: Contender, text: string): Promise<void> {
    const giveUpAt = Date.now() + 30_000;
    while (!contender.output().includes(text)) {
      if (Date.now() > giveUpAt) {
        throw new Error(`never saw ${text}; the process printed: ${contender.output()}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  let dir: string;
  const running: Contender[] = [];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lock-race-'));
  });
  afterEach(() => {
    for (const contender of running.splice(0)) {
      contender.child.kill('SIGKILL');
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('is free the moment its holder is killed, with nothing left to clean up', async () => {
    const name = uniqueName();
    const holder = contend(name, join(dir, 'marker'), 'forever');
    running.push(holder);
    await saw(holder, 'HOLDING');
    await expect(acquireLock(name, { waitMs: 0 })).rejects.toThrow(LockBusyError);

    holder.child.kill('SIGKILL');
    await holder.exited;
    const release = await acquireLock(name, { waitMs: 0 });
    await release();
  }, 60_000);

  it('never lets two processes hold it when several race for a killed holder', async () => {
    const name = uniqueName();
    const marker = join(dir, 'held-by');
    const holder = contend(name, marker, 'forever');
    running.push(holder);
    await saw(holder, 'HOLDING');

    // Four processes queue behind the holder, then race for the lock the moment
    // it is killed without any chance to clean up: the stale-lock takeover the
    // file-based lock got wrong.
    const contenders = Array.from({ length: 4 }, () => contend(name, marker, '150'));
    running.push(...contenders);
    await Promise.all(contenders.map((contender) => saw(contender, 'WAITING')));
    holder.child.kill('SIGKILL');

    const codes = await Promise.all(contenders.map((contender) => contender.exited));
    const outputs = contenders.map((contender) => contender.output());
    expect(codes, outputs.join('\n---\n')).toEqual([0, 0, 0, 0]);
    for (const output of outputs) {
      expect(output).toContain('HELD');
      expect(output).toContain('RELEASED');
      expect(output).not.toContain('OVERLAP');
    }
  }, 90_000);
});

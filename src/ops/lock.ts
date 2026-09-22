import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class LockBusyError extends Error {
  override name = 'LockBusyError';
}

export type LockOptions = {
  /** How long to wait for a live holder before giving up. */
  waitMs?: number;
  pollMs?: number;
  pid?: number;
  isAlive?: (pid: number) => boolean;
  sleep?: (ms: number) => Promise<void>;
};

/** True if a process with this PID exists. EPERM means it exists but belongs to someone else. */
export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readHolder(file: string): number | null {
  try {
    const pid = Number(readFileSync(file, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Creates the lock file with our PID already inside it: written to a temporary
 * file first, then hard-linked into place, which fails if the lock exists. So
 * the lock file is never seen empty.
 */
function tryCreate(file: string, pid: number): boolean {
  const temp = `${file}.${pid}.tmp`;
  writeFileSync(temp, String(pid), 'utf8');
  try {
    linkSync(temp, file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw error;
  } finally {
    rmSync(temp, { force: true });
  }
}

/**
 * Takes an exclusive lock. PGlite must never be opened by two processes at once,
 * so every command that opens the database holds this lock. A lock whose
 * process has died — for example one stopped by systemd's timeout — is removed.
 * Returns a function that releases the lock.
 */
export async function acquireLock(file: string, options: LockOptions = {}): Promise<() => void> {
  const pid = options.pid ?? process.pid;
  const waitMs = options.waitMs ?? 60_000;
  const pollMs = options.pollMs ?? 500;
  const isAlive = options.isAlive ?? processIsAlive;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  mkdirSync(dirname(file), { recursive: true });
  const giveUpAt = Date.now() + waitMs;
  for (;;) {
    if (tryCreate(file, pid)) {
      return () => {
        if (readHolder(file) === pid) {
          rmSync(file, { force: true });
        }
      };
    }
    const holder = readHolder(file);
    if (holder === null || !isAlive(holder)) {
      rmSync(file, { force: true });
      continue;
    }
    if (Date.now() >= giveUpAt) {
      throw new LockBusyError(
        `another command (process ${holder}) is using the database; try again when it has finished`,
      );
    }
    await sleep(pollMs);
  }
}

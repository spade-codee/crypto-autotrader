import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import net from 'node:net';

export class LockBusyError extends Error {
  override name = 'LockBusyError';
}

export type LockOptions = {
  /** How long to wait for the holder to finish before giving up. */
  waitMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

/** Gives the lock up. Calling it again does nothing. */
export type ReleaseLock = () => Promise<void>;

/**
 * The lock's name for one database directory: the same however the directory
 * is written — relative or absolute, with or without a trailing separator,
 * through a symbolic link or a junction, and, on Windows, whose paths ignore
 * case, in any letter case. The directory must exist.
 */
export function lockNameFor(directory: string): string {
  const canonical = realpathSync.native(directory);
  const identity = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  return `crypto-autotrader-db-${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`;
}

/** Where a lock lives: a named pipe on Windows, an abstract socket on Linux. */
export function lockAddress(name: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    return `\\\\.\\pipe\\${name}`;
  }
  if (platform === 'linux') {
    return `\0${name}`;
  }
  throw new Error(`the database lock works on Linux and Windows, and this is ${platform}`);
}

/** Claims `address`, or answers null when another holder has it. */
function claim(address: string): Promise<net.Server | null> {
  return new Promise((resolve, reject) => {
    // Anyone who connects is turned away: the name is the lock, not a service.
    const server = net.createServer((socket) => socket.destroy());
    const refused = (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        resolve(null);
      } else {
        reject(error);
      }
    };
    server.once('error', refused);
    server.listen({ path: address }, () => {
      server.off('error', refused);
      // A later error cannot unbind the name, and must not crash the holder.
      server.on('error', () => {});
      // The lock never keeps the process alive: holding it ends when the process does.
      server.unref();
      resolve(server);
    });
  });
}

/**
 * Takes the database lock. PGlite must never be opened by two processes at
 * once, so every command that opens a database on disk holds this lock while
 * the database is open (src/db/client.ts).
 *
 * The lock is a name the operating system owns — a named pipe on Windows, an
 * abstract socket on Linux — derived from the database directory. Only one
 * process can hold a name, and the operating system frees it the moment its
 * holder exits, however it exits: a finished command, a crash, or systemd
 * killing a hung tick. So no lock is ever left behind, there is no stale lock
 * to detect, and no takeover that two processes could race: a file-based lock
 * must remove a dead holder's file by path, and a second process can remove a
 * fresh lock in the gap between reading the file and removing it.
 */
export async function acquireLock(name: string, options: LockOptions = {}): Promise<ReleaseLock> {
  const address = lockAddress(name);
  const waitMs = options.waitMs ?? 60_000;
  const pollMs = options.pollMs ?? 250;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const giveUpAt = Date.now() + waitMs;
  for (;;) {
    const server = await claim(address);
    if (server !== null) {
      let released: Promise<void> | undefined;
      return () => (released ??= new Promise<void>((resolve) => server.close(() => resolve())));
    }
    if (Date.now() >= giveUpAt) {
      throw new LockBusyError('another command is using the database; try again when it has finished');
    }
    await sleep(pollMs);
  }
}

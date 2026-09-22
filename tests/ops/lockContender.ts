// A separate process that contends for a database lock, for tests/ops/lock.test.ts.
// Usage: tsx lockContender.ts <lock name> <marker file> <milliseconds to hold | forever>
//
// It prints WAITING if the lock is busy when it first asks. A finite holder then
// proves it is alone: it creates the marker file exclusively, which fails if
// another holder's marker is still there, and prints OVERLAP if so.
import { closeSync, openSync, rmSync } from 'node:fs';
import { acquireLock, LockBusyError, type ReleaseLock } from '../../src/ops/lock.js';

const [name, marker, hold] = process.argv.slice(2) as [string, string, string];

let release: ReleaseLock;
try {
  release = await acquireLock(name, { waitMs: 0 });
} catch (error) {
  if (!(error instanceof LockBusyError)) {
    throw error;
  }
  console.log('WAITING');
  release = await acquireLock(name, { waitMs: 30_000, pollMs: 10 });
}

if (hold === 'forever') {
  console.log('HOLDING');
  // Keeps the process, and so the lock, alive until the test kills it.
  setInterval(() => {}, 60_000);
} else {
  try {
    closeSync(openSync(marker, 'wx'));
  } catch {
    console.log('OVERLAP');
  }
  console.log('HELD');
  await new Promise((resolve) => setTimeout(resolve, Number(hold)));
  rmSync(marker, { force: true });
  await release();
  console.log('RELEASED');
}

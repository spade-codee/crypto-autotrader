import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * One file that halts all trading. It is a file rather than a database row so
 * it works even when the database, or the rest of the application, does not:
 * `touch data/KILL_SWITCH` is enough. The engine checks it at the start of
 * every tick and again immediately before placing an order.
 */
export class KillSwitch {
  constructor(readonly file: string) {}

  isOn(): boolean {
    return existsSync(this.file);
  }

  turnOn(reason: string, at: Date): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, `${at.toISOString()} ${reason}\n`, 'utf8');
  }

  turnOff(): void {
    rmSync(this.file, { force: true });
  }
}

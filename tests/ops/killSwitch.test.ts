import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KillSwitch } from '../../src/ops/killSwitch.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kill-switch-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('KillSwitch', () => {
  it('is off until turned on, and off again once turned off', () => {
    const kill = new KillSwitch(join(dir, 'nested', 'KILL_SWITCH'));
    expect(kill.isOn()).toBe(false);
    kill.turnOn('checking a bug', new Date('2026-09-22T09:00:00Z'));
    expect(kill.isOn()).toBe(true);
    expect(readFileSync(kill.file, 'utf8')).toContain('checking a bug');
    kill.turnOff();
    expect(kill.isOn()).toBe(false);
  });

  it('can be switched on by hand with nothing but an empty file', () => {
    const file = join(dir, 'KILL_SWITCH');
    writeFileSync(file, '');
    expect(new KillSwitch(file).isOn()).toBe(true);
  });

  it('can be turned off when already off', () => {
    expect(() => new KillSwitch(join(dir, 'KILL_SWITCH')).turnOff()).not.toThrow();
  });
});

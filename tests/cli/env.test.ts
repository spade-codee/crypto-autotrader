import { describe, expect, it } from 'vitest';
import { readConfig } from '../../src/cli/env.js';

describe('readConfig', () => {
  it('defaults to testnet, the founder, and the local database directory', () => {
    expect(readConfig({})).toEqual({
      environment: 'testnet',
      userId: 'founder',
      dbDir: 'data/db',
      serverIps: [],
    });
  });

  it('reads a comma-separated list of server IP addresses', () => {
    expect(readConfig({ SERVER_IPS: ' 203.0.113.10, 203.0.113.11 ,' }).serverIps).toEqual([
      '203.0.113.10',
      '203.0.113.11',
    ]);
  });

  it('rejects an unknown environment', () => {
    expect(() => readConfig({ BYBIT_ENV: 'live' })).toThrow('BYBIT_ENV must be');
  });
});

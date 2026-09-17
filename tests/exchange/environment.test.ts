import { describe, expect, it } from 'vitest';
import { parseEnvironment } from '../../src/exchange/environment.js';

describe('parseEnvironment', () => {
  it('defaults to testnet when unset or empty', () => {
    expect(parseEnvironment(undefined)).toBe('testnet');
    expect(parseEnvironment('')).toBe('testnet');
  });

  it('accepts testnet and mainnet', () => {
    expect(parseEnvironment('testnet')).toBe('testnet');
    expect(parseEnvironment('mainnet')).toBe('mainnet');
  });

  it('rejects anything else rather than guessing', () => {
    expect(() => parseEnvironment('production')).toThrow(
      'BYBIT_ENV must be "testnet" or "mainnet", not "production"',
    );
  });
});

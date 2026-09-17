import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { mean } from '../src/math.js';

const d = (n: string | number) => new Decimal(n);

describe('mean', () => {
  it('averages a list of decimals', () => {
    expect(mean([d(1), d(2), d(3)]).toString()).toBe('2');
  });

  it('is exact where floats are not', () => {
    // (0.1 + 0.2) / 2 must be exactly 0.15, which float arithmetic misses.
    expect(mean([d('0.1'), d('0.2')]).toString()).toBe('0.15');
  });

  it('handles a single value', () => {
    expect(mean([d('42.5')]).toString()).toBe('42.5');
  });

  it('throws on an empty list rather than returning NaN', () => {
    expect(() => mean([])).toThrow('mean requires at least one value');
  });
});

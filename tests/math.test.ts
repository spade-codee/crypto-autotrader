import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { mean, roundDown } from '../src/math.js';

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

describe('roundDown', () => {
  it('rounds down to a whole number of steps', () => {
    expect(roundDown(d('0.0001234567'), d('0.000001')).toFixed()).toBe('0.000123');
    expect(roundDown(d('999.123456789'), d('0.0000001')).toFixed()).toBe('999.1234567');
  });

  it('leaves an exact multiple unchanged', () => {
    expect(roundDown(d('5.000001'), d('0.000001')).toFixed()).toBe('5.000001');
  });

  it('never rounds up, even past twenty significant digits', () => {
    // A plain division to Decimal's default 20 digits would round this up to ...4568.
    expect(roundDown(d('12345678.12345679999999999'), d('0.0000001')).toFixed()).toBe(
      '12345678.1234567',
    );
  });

  it('rejects a step of zero or less, and a negative amount', () => {
    expect(() => roundDown(d('1'), d('0'))).toThrow('positive step');
    expect(() => roundDown(d('-1'), d('0.1'))).toThrow('zero or more');
  });
});

import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { checkCandles, formatIntegrity, usable } from '../../src/data/integrity.js';
import type { Candle } from '../../src/types.js';

const Q = 900_000;
const bar = (time: number, open = 100, high = 101, low = 99, close = 100.5, volume = 1): Candle => ({
  time,
  open: new Decimal(open),
  high: new Decimal(high),
  low: new Decimal(low),
  close: new Decimal(close),
  volume: new Decimal(volume),
});

describe('checkCandles', () => {
  it('passes a clean series', () => {
    const report = checkCandles([bar(0), bar(Q), bar(2 * Q)], Q);
    expect(report).toMatchObject({
      count: 3,
      first: 0,
      last: 2 * Q,
      gaps: [],
      duplicates: [],
      outOfOrder: [],
      misaligned: [],
      invalid: [],
    });
    expect(usable(report)).toBe(true);
  });

  it('reports a gap with the number of candles missing, and still counts the file usable', () => {
    const report = checkCandles([bar(0), bar(3 * Q)], Q);
    expect(report.gaps).toEqual([{ after: 0, missing: 2 }]);
    expect(usable(report)).toBe(true);
  });

  it('refuses duplicates, candles out of order, and candles off their boundary', () => {
    const report = checkCandles([bar(Q), bar(Q), bar(0), bar(2 * Q + 1)], Q);
    expect(report.duplicates).toEqual([Q]);
    expect(report.outOfOrder).toEqual([0]);
    expect(report.misaligned).toEqual([2 * Q + 1]);
    expect(usable(report)).toBe(false);
  });

  it('refuses prices that cannot belong to one candle', () => {
    const report = checkCandles(
      [
        bar(0, 100, 99, 98, 100),
        bar(Q, 100, 101, 100.2, 100.5),
        bar(2 * Q, 100, 101, 0, 100.5),
        bar(3 * Q, 100, 101, 99, 100.5, -1),
        bar(4 * Q, 100, 98, 99, 98.5),
      ],
      Q,
    );
    expect(report.invalid.map((problem) => problem.reason)).toEqual([
      'high below the open or close',
      'low above the open or close',
      'a price at or below zero',
      'negative volume',
      'high below low',
    ]);
    expect(usable(report)).toBe(false);
  });
});

describe('formatIntegrity', () => {
  it('summarises the counts and lists the gaps', () => {
    const text = formatIntegrity(checkCandles([bar(0), bar(3 * Q)], Q));
    expect(text).toContain('2 candles, 1970-01-01T00:00:00Z to 1970-01-01T00:45:00Z');
    expect(text).toContain('gaps: 1 (2 candles missing)');
    expect(text).toContain('missing 2 after 1970-01-01T00:00:00Z');
  });
});

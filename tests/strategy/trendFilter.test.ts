import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { trendFilter, buyAndHold } from '../../src/strategy/trendFilter.js';
import type { Candle } from '../../src/types.js';

const DAY = 86_400_000;

/** Builds candles from a list of closes. OHLC are all equal; only close matters here. */
function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((c, i) => ({
    time: i * DAY,
    open: new Decimal(c),
    high: new Decimal(c),
    low: new Decimal(c),
    close: new Decimal(c),
    volume: new Decimal(1),
  }));
}

describe('trendFilter', () => {
  it('is FLAT before there is enough history for the average', () => {
    const strategy = trendFilter({ maPeriod: 5 });
    expect(strategy(candlesFromCloses([10, 11, 12, 13]))).toBe('FLAT');
  });

  it('is LONG when the latest close is above the moving average', () => {
    const strategy = trendFilter({ maPeriod: 3 });
    // Last 3 closes: 10, 20, 60 -> mean 30. Latest close 60 > 30.
    expect(strategy(candlesFromCloses([10, 20, 60]))).toBe('LONG');
  });

  it('is FLAT when the latest close is below the moving average', () => {
    const strategy = trendFilter({ maPeriod: 3 });
    // Last 3 closes: 60, 20, 10 -> mean 30. Latest close 10 < 30.
    expect(strategy(candlesFromCloses([60, 20, 10]))).toBe('FLAT');
  });

  it('is FLAT when the close exactly equals the average', () => {
    const strategy = trendFilter({ maPeriod: 3 });
    // Closes 20, 20, 20 -> mean 20, latest 20. Not strictly greater, so FLAT.
    expect(strategy(candlesFromCloses([20, 20, 20]))).toBe('FLAT');
  });

  it('uses only the most recent maPeriod candles, ignoring older history', () => {
    const strategy = trendFilter({ maPeriod: 3 });
    // Ancient huge values must not drag the average up.
    expect(strategy(candlesFromCloses([1000, 1000, 10, 20, 60]))).toBe('LONG');
  });

  it('is exactly at the boundary: one tick above the average is LONG', () => {
    const strategy = trendFilter({ maPeriod: 2 });
    // Closes 10, 10.02 -> mean 10.01. Latest 10.02 > 10.01.
    expect(strategy(candlesFromCloses([10, 10.02]))).toBe('LONG');
  });

  it('rejects a non-positive period rather than silently misbehaving', () => {
    expect(() => trendFilter({ maPeriod: 0 })).toThrow('maPeriod must be a positive integer');
    expect(() => trendFilter({ maPeriod: -5 })).toThrow('maPeriod must be a positive integer');
    expect(() => trendFilter({ maPeriod: 2.5 })).toThrow('maPeriod must be a positive integer');
  });
});

describe('buyAndHold', () => {
  it('is always LONG, including with no history at all', () => {
    expect(buyAndHold([])).toBe('LONG');
    expect(buyAndHold(candlesFromCloses([1, 2, 3]))).toBe('LONG');
  });
});

import { describe, expect, it } from 'vitest';
import { DEVELOPMENT, LOCKED, periodCandles } from '../../src/backtest/liquidityPeriods.js';
import { bar } from '../helpers/candles.js';

const Q = 900_000;
/** 15-minute candles from `from` to `to`, exclusive. */
const span = (from: number, to: number) =>
  Array.from({ length: (to - from) / Q }, (_, i) => bar(from + i * Q, 100, 101, 99, 100));

describe('periodCandles', () => {
  it('never shows development a candle from the locked period', () => {
    const all = span(DEVELOPMENT.to - 8 * Q, DEVELOPMENT.to + 8 * Q);
    const { candles, evaluateFrom, evaluateTo } = periodCandles(all, 'development', false);
    expect(candles.every((candle) => candle.time < DEVELOPMENT.to)).toBe(true);
    expect([evaluateFrom, evaluateTo]).toEqual([DEVELOPMENT.from, DEVELOPMENT.to]);
  });

  it('keeps the locked period closed without its flag', () => {
    expect(() => periodCandles(span(LOCKED.to - 8 * Q, LOCKED.to), 'locked', false)).toThrow('--unlock-locked-period');
  });

  it('opens the locked period with its flag, keeping the earlier candles as warm-up', () => {
    const all = span(LOCKED.from - 8 * Q, LOCKED.to);
    const { candles, evaluateFrom } = periodCandles(all, 'locked', true);
    expect(candles[0]!.time).toBe(LOCKED.from - 8 * Q);
    expect(evaluateFrom).toBe(LOCKED.from);
  });

  it('says what to fetch when the candles end early', () => {
    expect(() => periodCandles(span(DEVELOPMENT.to - 8 * Q, DEVELOPMENT.to - 4 * Q), 'development', false)).toThrow(
      '--until 2025-01-01',
    );
  });
});

import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { runBacktest } from '../../src/backtest/engine.js';
import { buyAndHold, trendFilter } from '../../src/strategy/trendFilter.js';
import type { Candle, StrategyFn } from '../../src/types.js';

const DAY = 86_400_000;
const d = (n: string | number) => new Decimal(n);
const FREE = { feeRate: d(0), slippageRate: d(0) };

/** Candles where open and close can differ, so execution timing is observable. */
function candles(bars: Array<{ open: number; close: number }>): Candle[] {
  return bars.map((b, i) => ({
    time: i * DAY,
    open: d(b.open),
    high: d(Math.max(b.open, b.close)),
    low: d(Math.min(b.open, b.close)),
    close: d(b.close),
    volume: d(1),
  }));
}

describe('runBacktest', () => {
  it('never executes on the same candle that produced the signal', () => {
    // Always-long strategy. The decision is made at candle 0's close, so the
    // buy must fill at candle 1's OPEN (200), never at candle 0's close (100).
    const bars = candles([
      { open: 50, close: 100 },
      { open: 200, close: 200 },
    ]);
    const result = runBacktest(bars, buyAndHold, FREE, d(1000), 'test');

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.side).toBe('BUY');
    expect(result.trades[0]!.price.toString()).toBe('200');
    expect(result.trades[0]!.time).toBe(DAY);
  });

  it('holds cash and never trades when the strategy stays FLAT', () => {
    const alwaysFlat: StrategyFn = () => 'FLAT';
    const bars = candles([
      { open: 100, close: 100 },
      { open: 200, close: 300 },
      { open: 300, close: 400 },
    ]);
    const result = runBacktest(bars, alwaysFlat, FREE, d(1000), 'test');

    expect(result.trades).toHaveLength(0);
    expect(result.metrics.finalEquity.toString()).toBe('1000');
    expect(result.metrics.exposure.toString()).toBe('0');
  });

  it('marks holdings to market at each candle close', () => {
    const bars = candles([
      { open: 100, close: 100 },
      { open: 100, close: 150 },
      { open: 150, close: 200 },
    ]);
    const result = runBacktest(bars, buyAndHold, FREE, d(1000), 'test');

    // Candle 0: still in cash (decision only just made).
    expect(result.equityCurve[0]!.equity.toString()).toBe('1000');
    // Candle 1: bought 10 units at open 100, close 150 -> 1500.
    expect(result.equityCurve[1]!.equity.toString()).toBe('1500');
    // Candle 2: still 10 units, close 200 -> 2000.
    expect(result.equityCurve[2]!.equity.toString()).toBe('2000');
  });

  it('charges fees and slippage on both sides of a round trip', () => {
    const costs = { feeRate: d('0.001'), slippageRate: d('0.0005') };
    // LONG for one day, then FLAT.
    let calls = 0;
    const inThenOut: StrategyFn = () => (++calls === 1 ? 'LONG' : 'FLAT');
    const bars = candles([
      { open: 100, close: 100 },
      { open: 100, close: 100 },
      { open: 100, close: 100 },
    ]);
    const result = runBacktest(bars, inThenOut, costs, d(1000), 'test');

    expect(result.trades).toHaveLength(2);
    // Buy: fee 1000 * 0.001 = 1, spendable 999, fill price 100.05.
    expect(result.trades[0]!.fee.toString()).toBe('1');
    expect(result.trades[0]!.price.toString()).toBe('100.05');
    // Sell: fill price 99.95.
    expect(result.trades[1]!.side).toBe('SELL');
    expect(result.trades[1]!.price.toString()).toBe('99.95');
    // A flat round trip must LOSE money once costs are applied.
    expect(result.metrics.finalEquity.lt(1000)).toBe(true);
    expect(result.metrics.totalFees.gt(0)).toBe(true);
  });

  it('marks an open position to market at the final close rather than liquidating it', () => {
    const bars = candles([
      { open: 100, close: 100 },
      { open: 100, close: 100 },
    ]);
    const result = runBacktest(bars, buyAndHold, FREE, d(1000), 'test');
    // Position remains open; final equity is its mark-to-market value, not cash.
    expect(result.trades).toHaveLength(1);
    expect(result.metrics.finalEquity.toString()).toBe('1000');
  });

  it('produces one equity point per candle', () => {
    const bars = candles([
      { open: 100, close: 100 },
      { open: 100, close: 100 },
      { open: 100, close: 100 },
      { open: 100, close: 100 },
    ]);
    const result = runBacktest(bars, buyAndHold, FREE, d(1000), 'test');
    expect(result.equityCurve).toHaveLength(4);
  });

  it('gives the strategy history only up to the current candle', () => {
    const seen: number[] = [];
    const spy: StrategyFn = (history) => {
      seen.push(history.length);
      return 'FLAT';
    };
    const bars = candles([
      { open: 1, close: 1 },
      { open: 2, close: 2 },
      { open: 3, close: 3 },
    ]);
    runBacktest(bars, spy, FREE, d(1000), 'test');
    expect(seen).toEqual([1, 2, 3]);
  });

  it('rejects an empty candle series', () => {
    expect(() => runBacktest([], buyAndHold, FREE, d(1000), 'test')).toThrow(
      'backtest requires at least one candle',
    );
  });

  describe('with a warm-up period (evaluateFrom)', () => {
    // Without warm-up, a 200-day average sits in cash for the first 200 days of
    // any test window while buy-and-hold is invested from day one — penalising
    // longer periods for a reason that has nothing to do with the strategy.
    const bars = candles([
      { open: 10, close: 10 },
      { open: 20, close: 20 },
      { open: 30, close: 30 },
      { open: 40, close: 40 },
    ]);

    it('records no trades or equity before evaluateFrom', () => {
      const result = runBacktest(bars, buyAndHold, FREE, d(1000), 'test', {
        evaluateFrom: 2 * DAY,
      });
      expect(result.equityCurve.map((p) => p.time)).toEqual([2 * DAY, 3 * DAY]);
      expect(result.trades.every((t) => t.time >= 2 * DAY)).toBe(true);
    });

    it('still lets the strategy see the warm-up history', () => {
      const seen: number[] = [];
      const spy: StrategyFn = (history) => {
        seen.push(history.length);
        return 'FLAT';
      };
      runBacktest(bars, spy, FREE, d(1000), 'test', { evaluateFrom: 2 * DAY });
      expect(seen).toEqual([1, 2, 3, 4]);
    });

    it('executes a decision from the last warm-up candle at the first evaluated open', () => {
      // A strategy already LONG by the end of warm-up enters on the first
      // evaluated day, rather than waiting to rediscover the trend.
      const result = runBacktest(bars, buyAndHold, FREE, d(1000), 'test', {
        evaluateFrom: 2 * DAY,
      });
      expect(result.trades[0]!.time).toBe(2 * DAY);
      expect(result.trades[0]!.price.toString()).toBe('30');
      // 1000 / 30 units, marked at the day-2 close of 30.
      expect(result.equityCurve[0]!.equity.toFixed(6)).toBe('1000.000000');
    });

    it('rejects an evaluateFrom later than every candle', () => {
      expect(() =>
        runBacktest(bars, buyAndHold, FREE, d(1000), 'test', { evaluateFrom: 99 * DAY }),
      ).toThrow('no candles at or after evaluateFrom');
    });
  });

  it('works end to end with the real trend filter', () => {
    // Rising then falling, so the filter enters and exits at least once.
    const closes = [10, 11, 12, 13, 14, 15, 14, 13, 12, 11, 10, 9];
    const bars = candles(closes.map((c) => ({ open: c, close: c })));
    const result = runBacktest(bars, trendFilter({ maPeriod: 3 }), FREE, d(1000), 'trend');

    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.equityCurve).toHaveLength(closes.length);
    expect(result.label).toBe('trend');
  });
});

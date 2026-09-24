import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_COSTS } from '../../src/backtest/costs.js';
import {
  monthBlockInterval,
  monthOf,
  monthsBetween,
  percentile,
  placebo,
  placeboR,
  seededRandom,
} from '../../src/backtest/evidence.js';
import { QUARTER_HOUR_MS } from '../../src/strategy/bars.js';
import { VERSION_0 } from '../../src/strategy/liquiditySweep.js';
import { candle } from '../helpers/liquidity.js';

const d = (...values: number[]) => values.map((value) => new Decimal(value));

describe('seededRandom', () => {
  it('repeats exactly for a seed, differs between seeds, and stays in [0, 1)', () => {
    const a = seededRandom(20260924);
    const b = seededRandom(20260924);
    const c = seededRandom(20260925);
    const first = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(first);
    expect(Array.from({ length: 5 }, () => c())).not.toEqual(first);
    expect(first.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe('percentile', () => {
  it('takes the nearest rank', () => {
    const sorted = d(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
    expect([0.05, 0.5, 0.95].map((p) => percentile(sorted, p).toString())).toEqual(['1', '5', '10']);
  });
});

describe('months', () => {
  it('names UTC calendar months, and lists every month a period touches', () => {
    expect(monthOf(Date.parse('2024-02-29T23:45:00Z'))).toBe('2024-02');
    expect(monthsBetween(Date.parse('2023-11-15T00:00:00Z'), Date.parse('2024-02-01T00:00:00Z'))).toEqual([
      '2023-11',
      '2023-12',
      '2024-01',
    ]);
  });
});

describe('monthBlockInterval', () => {
  it('collapses to the value when every trade is the same', () => {
    const trades = ['2024-01', '2024-02', '2024-02'].map((month) => ({ month, r: new Decimal('0.5') }));
    const interval = monthBlockInterval(trades, ['2024-01', '2024-02', '2024-03'], 500, 0.9, 1);
    expect([interval!.low, interval!.high].map(String)).toEqual(['0.5', '0.5']);
  });

  it('brackets the mean, repeats for a seed, and moves whole months together', () => {
    const trades = [
      { month: '2024-01', r: new Decimal(2) },
      { month: '2024-01', r: new Decimal(2) },
      { month: '2024-02', r: new Decimal(-1) },
      { month: '2024-03', r: new Decimal(-1) },
    ];
    const months = ['2024-01', '2024-02', '2024-03'];
    const once = monthBlockInterval(trades, months, 2000, 0.9, 7)!;
    const again = monthBlockInterval(trades, months, 2000, 0.9, 7)!;
    expect([once.low, once.high].map(String)).toEqual([again.low, again.high].map(String));
    // Drawing three whole months, January (two trades of 2R) comes up k times: the mean is
    // (5k − 3) ÷ (k + 3), so −1, 0.5, 1.4 or 2, with chances 8, 12, 6 and 1 in 27. The 5th
    // percentile is −1 and the 95th is 1.4. Drawing single trades would give other values.
    expect([once.low, once.high].map(String)).toEqual(['-1', '1.4']);
  });

  it('refuses a trade outside the period', () => {
    expect(() => monthBlockInterval([{ month: '2025-01', r: new Decimal(1) }], ['2024-12'], 10, 0.9, 1)).toThrow(
      'outside the period',
    );
  });
});

describe('placebo', () => {
  // Prices rise one point a candle from 100: every entry reaches a 2R target with a 1% stop within a few candles.
  const rising = Array.from({ length: 200 }, (_, i) =>
    candle(Date.parse('2024-01-10T00:00:00Z') + i * QUARTER_HOUR_MS, 100 + i, 101.5 + i, 99.9 + i, 101 + i),
  );

  it('measures one placebo trade in its own planned risk', () => {
    const r = placeboR(rising, 10, new Decimal('0.01'), VERSION_0, DEFAULT_COSTS);
    expect(r.gt(1.5) && r.lt(2.5)).toBe(true);
  });

  it('matches each real trade by month and ranks the real mean among the placebo sets', () => {
    const entries = Array.from({ length: 150 }, (_, i) => i + 1);
    const trades = [
      { entryTime: rising[5]!.time, plannedRisk: new Decimal('1.05'), confirmationClose: new Decimal(105), r: new Decimal(10) },
    ];
    const result = placebo(rising, entries, trades, VERSION_0, DEFAULT_COSTS, 50, 20260925)!;
    expect(result.means).toHaveLength(50);
    expect(result.rankOfReal).toBe(1);
    expect(result.median.lte(result.p95)).toBe(true);
  });

  it('draws only from the real trade\'s own month', () => {
    // January 31st rises a point a candle; February 1st falls a point a candle. A real trade in
    // January must only be compared with January entries, which all reach their target, so every
    // placebo set has the same mean. Drawing from February too would mix in losses.
    const january = Array.from({ length: 96 }, (_, i) =>
      candle(Date.parse('2024-01-31T00:00:00Z') + i * QUARTER_HOUR_MS, 100 + i, 101.5 + i, 99.9 + i, 101 + i),
    );
    const february = Array.from({ length: 96 }, (_, j) =>
      candle(Date.parse('2024-02-01T00:00:00Z') + j * QUARTER_HOUR_MS, 196 - j, 196.1 - j, 194.5 - j, 195 - j),
    );
    const candles = [...january, ...february];
    const entries = [...Array.from({ length: 41 }, (_, i) => i), ...Array.from({ length: 41 }, (_, j) => 96 + j)];
    const trades = [
      { entryTime: january[10]!.time, plannedRisk: new Decimal('1.1'), confirmationClose: new Decimal(110), r: new Decimal(0) },
    ];
    const result = placebo(candles, entries, trades, VERSION_0, DEFAULT_COSTS, 50, 20260925)!;
    expect(result.means[0]!.toFixed(10)).toBe(result.means[49]!.toFixed(10));
    expect(result.means[0]!.gt(1)).toBe(true);
  });

  it('refuses a real trade in a month with no eligible entry', () => {
    const trades = [
      { entryTime: Date.parse('2023-05-01T00:00:00Z'), plannedRisk: new Decimal(1), confirmationClose: new Decimal(100), r: new Decimal(1) },
    ];
    expect(() => placebo(rising, [1, 2, 3], trades, VERSION_0, DEFAULT_COSTS, 5, 1)).toThrow('no placebo entry');
  });
});

import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { majorityVote } from '../../src/strategy/ensemble.js';
import { trendFilter } from '../../src/strategy/trendFilter.js';
import type { Candle, StrategyFn } from '../../src/types.js';

const DAY = 86_400_000;
const LONG: StrategyFn = () => 'LONG';
const FLAT: StrategyFn = () => 'FLAT';

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

describe('majorityVote', () => {
  it('is LONG when a majority of strategies say LONG', () => {
    expect(majorityVote([LONG, LONG, FLAT])([])).toBe('LONG');
  });

  it('is FLAT when only a minority say LONG', () => {
    expect(majorityVote([LONG, FLAT, FLAT])([])).toBe('FLAT');
  });

  it('resolves a tie to FLAT, biased toward cash like the trend filter itself', () => {
    expect(majorityVote([LONG, FLAT])([])).toBe('FLAT');
  });

  it('gives every strategy the same history', () => {
    const seen: number[] = [];
    const spy: StrategyFn = (history) => {
      seen.push(history.length);
      return 'FLAT';
    };
    majorityVote([spy, spy, spy])(candlesFromCloses([1, 2, 3]));
    expect(seen).toEqual([3, 3, 3]);
  });

  it('lets two agreeing trend filters outvote a dissenting one', () => {
    // Closes 40, 10, 20, 22: the 2- and 3-day averages (21, 17.3) sit below 22,
    // so they say LONG; the 4-day average (23) sits above it, so it says FLAT.
    const candles = candlesFromCloses([40, 10, 20, 22]);
    const periods = [2, 3, 4].map((maPeriod) => trendFilter({ maPeriod }));
    expect(periods.map((strategy) => strategy(candles))).toEqual(['LONG', 'LONG', 'FLAT']);
    expect(majorityVote(periods)(candles)).toBe('LONG');
  });

  it('rejects an empty list of strategies', () => {
    expect(() => majorityVote([])).toThrow('majorityVote needs at least one strategy');
  });
});

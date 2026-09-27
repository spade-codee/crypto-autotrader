import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  returnCorrelation,
  roundTrips,
  sameDays,
  stretch,
  tradeStats,
  worstFall,
  yearsOf,
} from '../../src/backtest/breakoutEvidence.js';
import { DEFAULT_COSTS } from '../../src/backtest/costs.js';
import { runBacktest } from '../../src/backtest/engine.js';
import { trendFilter } from '../../src/strategy/trendFilter.js';
import type { EquityPoint, TargetState, Trade } from '../../src/types.js';
import { DAY, dailyCandles } from '../helpers/candles.js';

const d = (n: string | number) => new Decimal(n);
const trade = (side: 'BUY' | 'SELL', price: number, quantity: number, fee: number): Trade => ({
  time: 0,
  side,
  price: d(price),
  quantity: d(quantity),
  fee: d(fee),
});
const curve = (equities: number[], states: TargetState[] = []): EquityPoint[] =>
  equities.map((equity, i) => ({ time: i * DAY, equity: d(equity), state: states[i] ?? 'LONG' }));

describe('roundTrips and tradeStats', () => {
  it('pairs each buy with the next sell and judges it net of fees, as the win rate does', () => {
    const trades = [
      trade('BUY', 100, 10, 0),
      trade('SELL', 110, 10, 10), // +9% after its fee
      trade('BUY', 100, 10, 0),
      trade('SELL', 100, 10, 1), // -0.1%: its fee is its loss
      trade('BUY', 100, 10, 0),
      trade('SELL', 90, 10, 0), // -10%
      trade('BUY', 100, 10, 0),
      trade('SELL', 120, 10, 0), // +20%
      trade('BUY', 100, 10, 0), // still open: not a round trip
    ];
    expect(roundTrips(trades).map((t) => t.netReturn.toString())).toEqual(['0.09', '-0.001', '-0.1', '0.2']);
    const stats = tradeStats(trades, d(2));
    expect(stats.roundTrips).toBe(4);
    expect(stats.perYear.toString()).toBe('2');
    expect(stats.longestLosingRun).toBe(2);
    expect(stats.averageLoss!.toString()).toBe('-0.0505');
  });

  it('has no average loss when no round trip lost', () => {
    expect(tradeStats([trade('BUY', 100, 10, 0), trade('SELL', 110, 10, 0)], d(1)).averageLoss).toBeNull();
  });
});

describe('worstFall', () => {
  it('finds the deepest fall from a running peak, with the dates of the peak and the trough', () => {
    const fall = worstFall(curve([100, 120, 90, 110, 80, 130]));
    expect(fall.depth.toFixed(4)).toBe('0.3333');
    expect([fall.peak, fall.trough]).toEqual([1 * DAY, 4 * DAY]);
  });

  it('agrees with the maximum drawdown the backtest reports', () => {
    const candles = dailyCandles('2024-01-01', [100, 104, 99, 108, 97, 95, 103, 111, 90, 96, 120, 101]);
    const result = runBacktest(candles, trendFilter({ maPeriod: 2 }), DEFAULT_COSTS, d(1000), 'MA-2');
    expect(result.metrics.maxDrawdown.gt(0)).toBe(true);
    expect(worstFall(result.equityCurve).depth.toString()).toBe(result.metrics.maxDrawdown.toString());
  });
});

describe('sameDays and returnCorrelation', () => {
  it('counts the days on which both runs held the same position', () => {
    const a = curve([100, 101, 102, 103], ['LONG', 'LONG', 'FLAT', 'FLAT']);
    const b = curve([100, 101, 102, 103], ['LONG', 'FLAT', 'FLAT', 'LONG']);
    expect(sameDays(a, b).toString()).toBe('0.5');
  });

  it('correlates daily returns: 1 moving together, -1 moving opposite, none when one never moves', () => {
    const up = curve([100, 110, 104.5, 125.4]); // +10%, -5%, +20%
    const opposite = curve([100, 90, 94.5, 75.6]); // -10%, +5%, -20%
    const still = curve([100, 100, 100, 100]);
    expect(returnCorrelation(up, up)!.toDecimalPlaces(10).toString()).toBe('1');
    expect(returnCorrelation(up, opposite)!.toDecimalPlaces(10).toString()).toBe('-1');
    expect(returnCorrelation(up, still)).toBeNull();
  });

  it('refuses two runs over different dates', () => {
    const later = curve([100, 101]).map((p) => ({ ...p, time: p.time + DAY }));
    expect(() => sameDays(curve([100, 101]), later)).toThrow('identical dates');
    expect(() => returnCorrelation(curve([100, 101]), later)).toThrow('identical dates');
  });
});

describe('stretch', () => {
  it("measures from the first day's close to the last day's, with the worst fall between them", () => {
    const part = stretch(curve([100, 120, 90, 110, 80, 130]), 1 * DAY, 4 * DAY);
    expect(part.return.toFixed(4)).toBe('-0.3333');
    expect(part.worstFall.toFixed(4)).toBe('0.3333');
  });

  it('refuses a stretch whose first or last day is not marked', () => {
    expect(() => stretch(curve([100, 120]), 0, 5 * DAY)).toThrow('marked days');
  });
});

describe('yearsOf', () => {
  it('spans the first mark to the last in 365-day years, as CAGR does', () => {
    expect(yearsOf(curve(Array.from({ length: 366 }, () => 100))).toString()).toBe('1');
  });
});

import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { computeMetrics } from '../../src/backtest/metrics.js';
import type { EquityPoint, Trade } from '../../src/types.js';

const DAY = 86_400_000;
const d = (n: string | number) => new Decimal(n);

function curve(values: number[], states: Array<'LONG' | 'FLAT'> = []): EquityPoint[] {
  return values.map((v, i) => ({
    time: i * DAY,
    equity: d(v),
    state: states[i] ?? 'FLAT',
  }));
}

describe('computeMetrics', () => {
  it('computes total return', () => {
    const m = computeMetrics(curve([1000, 1100, 1200]), [], d(1000));
    expect(m.totalReturn.toFixed(4)).toBe('0.2000');
    expect(m.finalEquity.toString()).toBe('1200');
  });

  it('computes max drawdown from the running peak', () => {
    // Peak 2000, trough 1000 -> 50% drawdown. Later recovery does not reduce it.
    const m = computeMetrics(curve([1000, 2000, 1000, 1800]), [], d(1000));
    expect(m.maxDrawdown.toFixed(4)).toBe('0.5000');
  });

  it('reports zero drawdown for a monotonically rising curve', () => {
    const m = computeMetrics(curve([1000, 1100, 1200, 1300]), [], d(1000));
    expect(m.maxDrawdown.toFixed(4)).toBe('0.0000');
  });

  it('computes exposure as the fraction of days holding the asset', () => {
    const m = computeMetrics(
      curve([1, 1, 1, 1], ['LONG', 'LONG', 'FLAT', 'FLAT']),
      [],
      d(1),
    );
    expect(m.exposure.toFixed(2)).toBe('0.50');
  });

  it('computes CAGR over the elapsed period', () => {
    // 1000 -> 2000 over 365 days is a 100% annual rate.
    const points: EquityPoint[] = [
      { time: 0, equity: d(1000), state: 'LONG' },
      { time: 365 * DAY, equity: d(2000), state: 'LONG' },
    ];
    const m = computeMetrics(points, [], d(1000));
    expect(m.cagr.toFixed(2)).toBe('1.00');
  });

  it('counts round trips and computes win rate', () => {
    const trades: Trade[] = [
      { time: 0, side: 'BUY', price: d(100), quantity: d(1), fee: d(0) },
      { time: DAY, side: 'SELL', price: d(120), quantity: d(1), fee: d(0) },
      { time: 2 * DAY, side: 'BUY', price: d(120), quantity: d(1), fee: d(0) },
      { time: 3 * DAY, side: 'SELL', price: d(110), quantity: d(1), fee: d(0) },
    ];
    const m = computeMetrics(curve([1000, 1200, 1200, 1100]), trades, d(1000));
    expect(m.tradeCount).toBe(4);
    expect(m.winRate.toFixed(2)).toBe('0.50');
  });

  it('counts a round trip as a loss when fees exceed the price gain', () => {
    // Price rises 100 -> 100.10 (+0.1%), but 0.1% fees on each side cost ~0.2%.
    // Judged on price alone this looks like a win; net of fees it lost money.
    const trades: Trade[] = [
      { time: 0, side: 'BUY', price: d(100), quantity: d(1), fee: d('0.1') },
      { time: DAY, side: 'SELL', price: d('100.10'), quantity: d(1), fee: d('0.1001') },
    ];
    const m = computeMetrics(curve([1000, 999.9]), trades, d(1000));
    expect(m.winRate.toFixed(2)).toBe('0.00');
  });

  it('sums fees across all trades', () => {
    const trades: Trade[] = [
      { time: 0, side: 'BUY', price: d(100), quantity: d(1), fee: d('1.5') },
      { time: DAY, side: 'SELL', price: d(120), quantity: d(1), fee: d('2.5') },
    ];
    const m = computeMetrics(curve([1000, 1100]), trades, d(1000));
    expect(m.totalFees.toString()).toBe('4');
  });

  it('reports zero Sharpe for a perfectly flat curve rather than dividing by zero', () => {
    const m = computeMetrics(curve([1000, 1000, 1000, 1000]), [], d(1000));
    expect(m.sharpe.toString()).toBe('0');
  });

  it('reports a positive Sharpe for a steadily rising curve', () => {
    const m = computeMetrics(curve([1000, 1010, 1020, 1031, 1041]), [], d(1000));
    expect(m.sharpe.gt(0)).toBe(true);
  });

  it('rejects an empty curve', () => {
    expect(() => computeMetrics([], [], d(1000))).toThrow(
      'metrics require at least one equity point',
    );
  });
});

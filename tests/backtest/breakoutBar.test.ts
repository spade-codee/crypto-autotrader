import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { addsSomething, keepsPromise, mismatches, verdictOf } from '../../src/backtest/breakoutBar.js';
import type { ReferenceRow } from '../../src/backtest/breakoutPreregistration.js';
import type { Metrics } from '../../src/types.js';

function metrics(values: { cagr?: string; maxDrawdown?: string; sharpe?: string; tradeCount?: number } = {}): Metrics {
  return {
    initialCapital: new Decimal(1000),
    finalEquity: new Decimal(1000),
    totalReturn: new Decimal(0),
    cagr: new Decimal(values.cagr ?? '0.3'),
    maxDrawdown: new Decimal(values.maxDrawdown ?? '0.3'),
    sharpe: new Decimal(values.sharpe ?? '1'),
    tradeCount: values.tradeCount ?? 10,
    exposure: new Decimal('0.5'),
    winRate: new Decimal('0.3'),
    totalFees: new Decimal(0),
  };
}

describe('keepsPromise', () => {
  // Two-thirds of 0.6 is 0.4; 1.1 less 0.1 is 1.0.
  const holding = metrics({ maxDrawdown: '0.6', sharpe: '1.1' });

  it("passes at exactly two-thirds of holding's worst fall and holding's Sharpe less 0.1", () => {
    const check = keepsPromise(metrics({ maxDrawdown: '0.4', sharpe: '1.0' }), holding);
    expect(check.passes).toBe(true);
    expect(check.fallLimit.toString()).toBe('0.4');
    expect(check.sharpeFloor.toString()).toBe('1');
  });

  it('fails a worst fall just above the limit, or a Sharpe just below the floor', () => {
    expect(keepsPromise(metrics({ maxDrawdown: '0.4001', sharpe: '1.5' }), holding).passes).toBe(false);
    expect(keepsPromise(metrics({ maxDrawdown: '0.1', sharpe: '0.9999' }), holding).passes).toBe(false);
  });
});

describe('addsSomething', () => {
  const averages = [
    metrics({ maxDrawdown: '0.373', cagr: '0.352' }),
    metrics({ maxDrawdown: '0.274', cagr: '0.42' }),
    metrics({ maxDrawdown: '0.269', cagr: '0.379' }),
  ];

  it("passes on a worst fall below every average's, or on a CAGR above every one's", () => {
    expect(addsSomething(metrics({ maxDrawdown: '0.2689', cagr: '0.1' }), averages).passes).toBe(true);
    expect(addsSomething(metrics({ maxDrawdown: '0.5', cagr: '0.4201' }), averages).passes).toBe(true);
  });

  it('fails when it only equals the best of them', () => {
    const check = addsSomething(metrics({ maxDrawdown: '0.269', cagr: '0.42' }), averages);
    expect(check.passes).toBe(false);
    expect(check.lowestFall.toString()).toBe('0.269');
    expect(check.highestCagr.toString()).toBe('0.42');
  });

  it('needs moving averages to compare with', () => {
    expect(() => addsSomething(metrics(), [])).toThrow('moving averages');
  });
});

describe('verdictOf', () => {
  it("follows section 6's verdict table", () => {
    expect(verdictOf(true, true, true)).toBe('PASS');
    expect(verdictOf(true, true, false)).toBe('COVERED');
    expect(verdictOf(false, true, true)).toBe('FAIL');
    expect(verdictOf(true, false, true)).toBe('FAIL');
  });
});

describe('mismatches', () => {
  const row: ReferenceRow = {
    period: 2,
    data: 'long',
    label: 'MA-125',
    cagr: '42.0%',
    maxDrawdown: '27.4%',
    sharpe: '1.15',
    trades: 37,
  };

  it('finds nothing when a run rounds to the row, as Phase 0 printed it', () => {
    expect(mismatches(row, metrics({ cagr: '0.42049', maxDrawdown: '0.27351', sharpe: '1.1549', tradeCount: 37 }))).toEqual([]);
  });

  it('names every figure that differs', () => {
    expect(mismatches(row, metrics({ cagr: '0.4206', maxDrawdown: '0.274', sharpe: '1.15', tradeCount: 36 }))).toEqual([
      'CAGR 42.1%, not 42.0%',
      '36 trades, not 37',
    ]);
  });
});

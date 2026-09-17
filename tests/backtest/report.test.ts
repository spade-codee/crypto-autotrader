import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { formatComparison } from '../../src/backtest/report.js';
import type { BacktestResult } from '../../src/types.js';

const d = (n: string | number) => new Decimal(n);

function result(label: string, cagr: string, dd: string): BacktestResult {
  return {
    label,
    trades: [],
    equityCurve: [],
    metrics: {
      initialCapital: d(1000),
      finalEquity: d(2000),
      totalReturn: d(1),
      cagr: d(cagr),
      maxDrawdown: d(dd),
      sharpe: d('1.25'),
      tradeCount: 12,
      exposure: d('0.65'),
      winRate: d('0.5'),
      totalFees: d('42.5'),
    },
  };
}

describe('formatComparison', () => {
  it('renders one row per result with the label first', () => {
    const table = formatComparison([result('MA-200', '0.45', '0.30'), result('Buy & Hold', '0.60', '0.77')]);
    const lines = table.trim().split('\n');

    expect(lines[0]).toContain('Strategy');
    expect(lines[0]).toContain('CAGR');
    expect(lines[0]).toContain('MaxDD');
    expect(table).toContain('MA-200');
    expect(table).toContain('Buy & Hold');
  });

  it('formats rates as percentages with one decimal place', () => {
    const table = formatComparison([result('MA-200', '0.4512', '0.3049')]);
    expect(table).toContain('45.1%');
    expect(table).toContain('30.5%');
  });

  it('handles an empty result list without throwing', () => {
    expect(() => formatComparison([])).not.toThrow();
  });
});

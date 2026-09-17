import type Decimal from 'decimal.js';
import type { BacktestResult } from '../types.js';

const pct = (value: Decimal): string => `${value.times(100).toFixed(1)}%`;

const COLUMNS = [
  { header: 'Strategy', width: 14 },
  { header: 'CAGR', width: 9 },
  { header: 'MaxDD', width: 9 },
  { header: 'Sharpe', width: 8 },
  { header: 'Trades', width: 8 },
  { header: 'Exposure', width: 10 },
  { header: 'WinRate', width: 9 },
  { header: 'Fees', width: 10 },
] as const;

/** Renders results as a fixed-width table for the terminal. */
export function formatComparison(results: BacktestResult[]): string {
  const header = COLUMNS.map((c) => c.header.padEnd(c.width)).join('');
  const rule = '-'.repeat(COLUMNS.reduce((sum, c) => sum + c.width, 0));

  const rows = results.map((r) => {
    const m = r.metrics;
    return [
      r.label.padEnd(COLUMNS[0].width),
      pct(m.cagr).padEnd(COLUMNS[1].width),
      pct(m.maxDrawdown).padEnd(COLUMNS[2].width),
      m.sharpe.toFixed(2).padEnd(COLUMNS[3].width),
      String(m.tradeCount).padEnd(COLUMNS[4].width),
      pct(m.exposure).padEnd(COLUMNS[5].width),
      pct(m.winRate).padEnd(COLUMNS[6].width),
      m.totalFees.toFixed(0).padEnd(COLUMNS[7].width),
    ].join('');
  });

  return [header, rule, ...rows].join('\n') + '\n';
}

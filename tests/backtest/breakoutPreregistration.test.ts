import { describe, expect, it } from 'vitest';
import {
  FINGERPRINTS,
  MA_RANGE,
  NEIGHBOURS,
  PERIOD_1_FROM,
  PHASE_0_ROWS,
  SPLIT,
  STRESS_COSTS,
  STRETCHES,
} from '../../src/backtest/breakoutPreregistration.js';

const iso = (time: number) => new Date(time).toISOString().slice(0, 10);

describe('the pre-registration, held to docs/research/channel-breakout-candidate.md', () => {
  it('fixes the periods, the stress costs and the moving averages of test 3', () => {
    expect(iso(PERIOD_1_FROM)).toBe('2019-09-10');
    expect(iso(SPLIT)).toBe('2023-01-01');
    expect(STRESS_COSTS.feeRate.toString()).toBe('0.001');
    expect(STRESS_COSTS.slippageRate.toString()).toBe('0.0015');
    expect(MA_RANGE).toEqual([100, 125, 150]);
  });

  it('has exactly the eight neighbours, without version 0', () => {
    expect(NEIGHBOURS.map((n) => `${n.entryDays}/${n.exitDays}`)).toEqual([
      '40/15',
      '40/20',
      '40/25',
      '55/15',
      '55/25',
      '70/15',
      '70/20',
      '70/25',
    ]);
  });

  it('fixes the two stretches before any result', () => {
    expect(STRETCHES.map((s) => [s.name, s.period, iso(s.from), iso(s.to)])).toEqual([
      ['the 2021 crash', 1, '2021-04-13', '2021-07-20'],
      ['the 2024 chop', 2, '2024-03-13', '2024-10-10'],
    ]);
  });

  it('holds the ten rows the reproduction check must match, and the files by fingerprint', () => {
    expect(PHASE_0_ROWS.map((r) => [r.period, r.data, r.label, r.cagr, r.maxDrawdown, r.sharpe, r.trades])).toEqual([
      [1, 'long', 'MA-125', '59.1%', '34.4%', '1.24', 18],
      [1, 'long', 'Buy & Hold', '15.3%', '76.7%', '0.58', 1],
      [2, 'long', 'MA-100', '35.2%', '37.3%', '1.02', 55],
      [2, 'long', 'MA-125', '42.0%', '27.4%', '1.15', 37],
      [2, 'long', 'MA-150', '37.9%', '26.9%', '1.06', 39],
      [2, 'long', 'Buy & Hold', '50.9%', '53.1%', '1.11', 1],
      [2, 'spot', 'MA-100', '35.7%', '36.7%', '1.04', 55],
      [2, 'spot', 'MA-125', '43.0%', '27.0%', '1.17', 37],
      [2, 'spot', 'MA-150', '39.0%', '26.4%', '1.09', 37],
      [2, 'spot', 'Buy & Hold', '50.9%', '53.0%', '1.11', 1],
    ]);
    expect(FINGERPRINTS).toEqual({
      long: '36034d6ad51acc74147db1df410ee4d69603e82e61eb478aae20fe8932337ed9',
      spot: 'da9b17c1e67c9d15539e478e0a63bd4154759e072b89f70cbab3cd3743b80e3f',
    });
  });
});

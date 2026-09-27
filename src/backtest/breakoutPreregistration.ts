import Decimal from 'decimal.js';
import { BREAKOUT_V0, type ChannelBreakoutConfig } from '../strategy/channelBreakout.js';
import type { CostModel } from '../types.js';

/*
 * Every value docs/research/channel-breakout-candidate.md (product-prototype,
 * PR #51) fixed before any breakout result. Changing one changes the
 * pre-registration, which nothing may do after the run.
 */

const day = (date: string): number => Date.parse(`${date}T00:00:00Z`);

/** Phase 0's split. Period 1 sees only long-history candles before it, and period 2 starts on it. */
export const SPLIT = day('2023-01-01');

/** Where period 1's evaluation starts: Phase 0's in-sample start. */
export const PERIOD_1_FROM = day('2019-09-10');

/** The stress test: the standard 0.1% fee, with three times the slippage. */
export const STRESS_COSTS: CostModel = {
  feeRate: new Decimal('0.001'),
  slippageRate: new Decimal('0.0015'),
};

/** The eight neighbours: entry 40, 55 or 70 days with exit 15, 20 or 25, without version 0 itself. */
export const NEIGHBOURS: ChannelBreakoutConfig[] = [40, 55, 70]
  .flatMap((entryDays) => [15, 20, 25].map((exitDays) => ({ entryDays, exitDays })))
  .filter((c) => c.entryDays !== BREAKOUT_V0.entryDays || c.exitDays !== BREAKOUT_V0.exitDays);

/** MA-125's own range, 100 to 150 days (decisions #19): the moving averages test 3 compares with. */
export const MA_RANGE = [100, 125, 150];

export type StretchWindow = { name: string; period: 1 | 2; from: number; to: number };

/** The two stretches whose return and worst fall are reported, fixed before any result. */
export const STRETCHES: StretchWindow[] = [
  { name: 'the 2021 crash', period: 1, from: day('2021-04-13'), to: day('2021-07-20') },
  { name: 'the 2024 chop', period: 2, from: day('2024-03-13'), to: day('2024-10-10') },
];

/** The Phase 0 files, by the SHA-256 of their bytes. */
export const FINGERPRINTS = {
  long: '36034d6ad51acc74147db1df410ee4d69603e82e61eb478aae20fe8932337ed9',
  spot: 'da9b17c1e67c9d15539e478e0a63bd4154759e072b89f70cbab3cd3743b80e3f',
} as const;

/** A row the reproduction check must match, written as Phase 0's table prints it. */
export type ReferenceRow = {
  period: 1 | 2;
  data: 'long' | 'spot';
  label: string;
  cagr: string;
  maxDrawdown: string;
  sharpe: string;
  trades: number;
};

/** Section 3's table. The spot rows for MA-100 and MA-150 come from the 2026-09-26 rerun. */
export const PHASE_0_ROWS: ReferenceRow[] = [
  { period: 1, data: 'long', label: 'MA-125', cagr: '59.1%', maxDrawdown: '34.4%', sharpe: '1.24', trades: 18 },
  { period: 1, data: 'long', label: 'Buy & Hold', cagr: '15.3%', maxDrawdown: '76.7%', sharpe: '0.58', trades: 1 },
  { period: 2, data: 'long', label: 'MA-100', cagr: '35.2%', maxDrawdown: '37.3%', sharpe: '1.02', trades: 55 },
  { period: 2, data: 'long', label: 'MA-125', cagr: '42.0%', maxDrawdown: '27.4%', sharpe: '1.15', trades: 37 },
  { period: 2, data: 'long', label: 'MA-150', cagr: '37.9%', maxDrawdown: '26.9%', sharpe: '1.06', trades: 39 },
  { period: 2, data: 'long', label: 'Buy & Hold', cagr: '50.9%', maxDrawdown: '53.1%', sharpe: '1.11', trades: 1 },
  { period: 2, data: 'spot', label: 'MA-100', cagr: '35.7%', maxDrawdown: '36.7%', sharpe: '1.04', trades: 55 },
  { period: 2, data: 'spot', label: 'MA-125', cagr: '43.0%', maxDrawdown: '27.0%', sharpe: '1.17', trades: 37 },
  { period: 2, data: 'spot', label: 'MA-150', cagr: '39.0%', maxDrawdown: '26.4%', sharpe: '1.09', trades: 37 },
  { period: 2, data: 'spot', label: 'Buy & Hold', cagr: '50.9%', maxDrawdown: '53.0%', sharpe: '1.11', trades: 1 },
];

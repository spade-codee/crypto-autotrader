import Decimal from 'decimal.js';
import type { Metrics } from '../types.js';
import type { ReferenceRow } from './breakoutPreregistration.js';
import { pct } from './report.js';

/** Test 1: the Sharpe may be at most this much below holding's. */
export const SHARPE_MARGIN = new Decimal('0.1');

/** Test 2: how many of the eight neighbours must keep the promise. */
export const NEIGHBOURS_NEEDED = 5;

export type PromiseCheck = {
  passes: boolean;
  fall: Decimal;
  fallLimit: Decimal;
  sharpe: Decimal;
  sharpeFloor: Decimal;
};

/**
 * Test 1's two conditions for one run, against holding over the same dates
 * and costs: a worst fall at most two-thirds of holding's, and a Sharpe at
 * least holding's less 0.1.
 */
export function keepsPromise(run: Metrics, holding: Metrics): PromiseCheck {
  const fallLimit = holding.maxDrawdown.times(2).div(3);
  const sharpeFloor = holding.sharpe.minus(SHARPE_MARGIN);
  return {
    passes: run.maxDrawdown.lte(fallLimit) && run.sharpe.gte(sharpeFloor),
    fall: run.maxDrawdown,
    fallLimit,
    sharpe: run.sharpe,
    sharpeFloor,
  };
}

export type AddsCheck = {
  passes: boolean;
  fall: Decimal;
  lowestFall: Decimal;
  cagr: Decimal;
  highestCagr: Decimal;
};

/** Test 3 on one dataset: a worst fall below every moving average's, or a CAGR above every one's. */
export function addsSomething(breakout: Metrics, movingAverages: Metrics[]): AddsCheck {
  if (movingAverages.length === 0) {
    throw new Error('test 3 needs the moving averages to compare with');
  }
  const lowestFall = Decimal.min(...movingAverages.map((m) => m.maxDrawdown));
  const highestCagr = Decimal.max(...movingAverages.map((m) => m.cagr));
  return {
    passes: breakout.maxDrawdown.lt(lowestFall) || breakout.cagr.gt(highestCagr),
    fall: breakout.maxDrawdown,
    lowestFall,
    cagr: breakout.cagr,
    highestCagr,
  };
}

export type Verdict = 'PASS' | 'FAIL' | 'COVERED';

/** Section 6's verdict table. */
export function verdictOf(keepsThePromise: boolean, robust: boolean, addsSomethingNew: boolean): Verdict {
  if (!keepsThePromise || !robust) {
    return 'FAIL';
  }
  return addsSomethingNew ? 'PASS' : 'COVERED';
}

/** Where a run differs from a Phase 0 row, rounded as Phase 0's table prints it. Empty when it reproduces. */
export function mismatches(row: ReferenceRow, metrics: Metrics): string[] {
  const found: string[] = [];
  const cagr = pct(metrics.cagr);
  const maxDrawdown = pct(metrics.maxDrawdown);
  const sharpe = metrics.sharpe.toFixed(2);
  if (cagr !== row.cagr) {
    found.push(`CAGR ${cagr}, not ${row.cagr}`);
  }
  if (maxDrawdown !== row.maxDrawdown) {
    found.push(`worst fall ${maxDrawdown}, not ${row.maxDrawdown}`);
  }
  if (sharpe !== row.sharpe) {
    found.push(`Sharpe ${sharpe}, not ${row.sharpe}`);
  }
  if (metrics.tradeCount !== row.trades) {
    found.push(`${metrics.tradeCount} trades, not ${row.trades}`);
  }
  return found;
}

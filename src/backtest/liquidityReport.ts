import Decimal from 'decimal.js';
import { mean } from '../math.js';
import { aggregate, DAY_MS } from '../strategy/bars.js';
import { VERSION_0, type LiquiditySweepConfig } from '../strategy/liquiditySweep.js';
import { buyAndHold, CHOSEN_MA_PERIOD, trendFilter } from '../strategy/trendFilter.js';
import type { Candle, CostModel } from '../types.js';
import {
  BTCUSDT_RULES,
  RESEARCH_RISK,
  runBracketBacktest,
  type BracketRun,
  type BracketTrade,
  type EquityMark,
  type ExitReason,
  type SkipReason,
} from './bracket.js';
import { DEFAULT_COSTS } from './costs.js';
import { runBacktest } from './engine.js';
import {
  BOOTSTRAP_RESAMPLES,
  BOOTSTRAP_SEED,
  monthBlockInterval,
  monthOf,
  monthsBetween,
  PLACEBO_SEED,
  PLACEBO_SETS,
  placebo,
  type Interval,
  type PlaceboResult,
} from './evidence.js';
import type { PeriodName } from './liquidityPeriods.js';

const YEAR_MS = 365.25 * DAY_MS;

/** R11's stress: the standard fee with 0.15% slippage a fill. */
export const STRESSED_COSTS: CostModel = { feeRate: DEFAULT_COSTS.feeRate, slippageRate: new Decimal('0.0015') };
/** The research account's starting USDT. Results in R do not depend on it. */
export const CAPITAL = new Decimal(10_000);

/** Spec 6.4: the eight neighbours, each changing one rule of version 0. Shown, never used to choose. */
export const NEIGHBOURS: Array<{ name: string; config: LiquiditySweepConfig }> = [
  { name: 'swing size 3', config: { ...VERSION_0, swingSize: 3 } },
  { name: 'wait 4 candles', config: { ...VERSION_0, waitCandles: 4 } },
  { name: 'wait 16 candles', config: { ...VERSION_0, waitCandles: 16 } },
  { name: 'target 1.5R', config: { ...VERSION_0, targetMultiple: new Decimal('1.5') } },
  { name: 'target 3R', config: { ...VERSION_0, targetMultiple: new Decimal(3) } },
  { name: 'time limit 16', config: { ...VERSION_0, timeLimitCandles: 16 } },
  { name: 'time limit 96', config: { ...VERSION_0, timeLimitCandles: 96 } },
  { name: 'stop 0.25 ATR below', config: { ...VERSION_0, stopAtrMultiple: new Decimal('0.25') } },
];

export type TradeSummary = {
  trades: number;
  perYear: Decimal;
  winRate: Decimal | null;
  averageWin: Decimal | null;
  averageLoss: Decimal | null;
  meanR: Decimal | null;
  meanGrossR: Decimal | null;
  totalR: Decimal;
};

export function summarizeTrades(trades: BracketTrade[], years: Decimal): TradeSummary {
  const wins = trades.filter((t) => t.r.gt(0));
  const losses = trades.filter((t) => !t.r.gt(0));
  const average = (list: BracketTrade[], pick: (t: BracketTrade) => Decimal) =>
    list.length === 0 ? null : mean(list.map(pick));
  return {
    trades: trades.length,
    perYear: new Decimal(trades.length).div(years),
    winRate: trades.length === 0 ? null : new Decimal(wins.length).div(trades.length),
    averageWin: average(wins, (t) => t.r),
    averageLoss: average(losses, (t) => t.r),
    meanR: average(trades, (t) => t.r),
    meanGrossR: average(trades, (t) => t.grossR),
    totalR: trades.reduce((total, t) => total.plus(t.r), new Decimal(0)),
  };
}

export type AccountSummary = {
  returnFraction: Decimal;
  maxDrawdown: Decimal;
  timeInMarket: Decimal;
  averageCapitalInUse: Decimal | null;
  longestLosingStreak: number;
};

export function summarizeAccount(marks: EquityMark[], trades: BracketTrade[], capital: Decimal): AccountSummary {
  let peak = capital;
  let maxDrawdown = new Decimal(0);
  for (const mark of marks) {
    if (mark.equity.gt(peak)) {
      peak = mark.equity;
    }
    const drawdown = peak.minus(mark.equity).div(peak);
    if (drawdown.gt(maxDrawdown)) {
      maxDrawdown = drawdown;
    }
  }
  let streak = 0;
  let longest = 0;
  for (const t of trades) {
    streak = t.r.lt(0) ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }
  const last = marks[marks.length - 1]?.equity ?? capital;
  const inUse = trades
    .filter((t) => t.equityAtEntry !== undefined)
    .map((t) => t.quantity.times(t.entryPrice).div(t.equityAtEntry));
  return {
    returnFraction: last.div(capital).minus(1),
    maxDrawdown,
    timeInMarket:
      marks.length === 0 ? new Decimal(0) : new Decimal(marks.filter((m) => m.holding).length).div(marks.length),
    averageCapitalInUse: inUse.length === 0 ? null : mean(inUse),
    longestLosingStreak: longest,
  };
}

/** Pearson correlation, or null when either series is too short or constant. */
export function correlation(xs: Decimal[], ys: Decimal[]): Decimal | null {
  if (xs.length !== ys.length || xs.length < 2) {
    return null;
  }
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = new Decimal(0);
  let sxx = new Decimal(0);
  let syy = new Decimal(0);
  xs.forEach((x, i) => {
    const dx = x.minus(mx);
    const dy = ys[i]!.minus(my);
    sxy = sxy.plus(dx.times(dy));
    sxx = sxx.plus(dx.times(dx));
    syy = syy.plus(dy.times(dy));
  });
  if (sxx.isZero() || syy.isZero()) {
    return null;
  }
  return sxy.div(sxx.sqrt().times(syy.sqrt())).toDecimalPlaces(12);
}

export type Context = { buyAndHold: Decimal; ma125: Decimal; correlationWithMa125: Decimal | null };

export type Evidence = {
  period: PeriodName;
  from: number;
  to: number;
  run: BracketRun;
  summary: TradeSummary;
  interval: Interval | null;
  stressed: TradeSummary;
  breakEvenRoundTrip: Decimal | null;
  placebo: PlaceboResult | null;
  exits: Partial<Record<ExitReason, number>>;
  skips: Partial<Record<SkipReason, number>>;
  ambiguous: number;
  byYear: Array<{ year: number; summary: TradeSummary }>;
  account: AccountSummary;
  neighbours: Array<{ name: string; summary: TradeSummary }>;
  context: Context;
};

function count<K extends string>(keys: K[]): Partial<Record<K, number>> {
  const counts: Partial<Record<K, number>> = {};
  for (const key of keys) {
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** One run of a version over a period, with the standard research account. */
export function runVersion(candles: Candle[], config: LiquiditySweepConfig, costs: CostModel, from: number): BracketRun {
  return runBracketBacktest(candles, {
    config,
    costs,
    capital: CAPITAL,
    riskFraction: RESEARCH_RISK,
    rules: BTCUSDT_RULES,
    evaluateFrom: from,
  });
}

/**
 * The round-trip cost, as a share of price, at which version 0's mean net R
 * reaches zero: both the fee and the slippage are scaled together and the
 * scale is found by bisection. Zero when it loses before any cost; null when
 * it still makes money at twenty times the standard costs.
 */
export function breakEvenRoundTrip(candles: Candle[], from: number): Decimal | null {
  const meanAt = (scale: Decimal) => {
    const costs = { feeRate: DEFAULT_COSTS.feeRate.times(scale), slippageRate: DEFAULT_COSTS.slippageRate.times(scale) };
    return summarizeTrades(runVersion(candles, VERSION_0, costs, from).trades, new Decimal(1)).meanR;
  };
  const zero = meanAt(new Decimal(0));
  if (zero === null || zero.lte(0)) {
    return new Decimal(0);
  }
  let low = new Decimal(0);
  let high = new Decimal(20);
  const atHigh = meanAt(high);
  if (atHigh !== null && atHigh.gt(0)) {
    return null;
  }
  for (let step = 0; step < 12; step++) {
    const middle = low.plus(high).div(2);
    const value = meanAt(middle);
    if (value !== null && value.gt(0)) {
      low = middle;
    } else {
      high = middle;
    }
  }
  const standardRoundTrip = DEFAULT_COSTS.feeRate.plus(DEFAULT_COSTS.slippageRate).times(2);
  return low.plus(high).div(2).times(standardRoundTrip);
}

/** Buy-and-hold and MA-125 over the same dates and costs, and how the sweep account's daily returns move with MA-125's. */
export function context(candles: Candle[], run: BracketRun, from: number): Context {
  const days = aggregate(candles, DAY_MS);
  const hold = runBacktest(days, buyAndHold, DEFAULT_COSTS, CAPITAL, 'buy and hold', { evaluateFrom: from });
  const ma = runBacktest(days, trendFilter({ maPeriod: CHOSEN_MA_PERIOD }), DEFAULT_COSTS, CAPITAL, 'MA-125', {
    evaluateFrom: from,
  });
  const sweepByDay = new Map<number, Decimal>();
  for (const mark of run.equity) {
    sweepByDay.set(mark.time - (mark.time % DAY_MS), mark.equity);
  }
  const paired = ma.equityCurve.filter((point) => sweepByDay.has(point.time));
  const sweepReturns: Decimal[] = [];
  const maReturns: Decimal[] = [];
  for (let i = 1; i < paired.length; i++) {
    const before = paired[i - 1]!;
    const after = paired[i]!;
    sweepReturns.push(sweepByDay.get(after.time)!.div(sweepByDay.get(before.time)!).minus(1));
    maReturns.push(after.equity.div(before.equity).minus(1));
  }
  return {
    buyAndHold: hold.metrics.totalReturn,
    ma125: ma.metrics.totalReturn,
    correlationWithMa125: correlation(sweepReturns, maReturns),
  };
}

/** Everything section 6.4 reports, for one period. The candles must already be cut by periodCandles. */
export function gatherEvidence(candles: Candle[], period: PeriodName, from: number, to: number): Evidence {
  const years = new Decimal(to - from).div(YEAR_MS);
  const run = runVersion(candles, VERSION_0, DEFAULT_COSTS, from);
  const summary = summarizeTrades(run.trades, years);
  const yearsSeen = [...new Set(run.trades.map((t) => new Date(t.entryTime).getUTCFullYear()))].sort((a, b) => a - b);
  return {
    period,
    from,
    to,
    run,
    summary,
    interval: monthBlockInterval(
      run.trades.map((t) => ({ month: monthOf(t.entryTime), r: t.r })),
      monthsBetween(from, to),
      BOOTSTRAP_RESAMPLES,
      0.9,
      BOOTSTRAP_SEED,
    ),
    stressed: summarizeTrades(runVersion(candles, VERSION_0, STRESSED_COSTS, from).trades, years),
    breakEvenRoundTrip: breakEvenRoundTrip(candles, from),
    placebo: placebo(candles, run.placeboEntries, run.trades, VERSION_0, DEFAULT_COSTS, PLACEBO_SETS, PLACEBO_SEED),
    exits: count(run.trades.map((t) => t.exit.reason)),
    skips: count(run.skips.map((s) => s.reason)),
    ambiguous: run.trades.filter((t) => t.exit.ambiguous).length,
    byYear: yearsSeen.map((year) => ({
      year,
      summary: summarizeTrades(
        run.trades.filter((t) => new Date(t.entryTime).getUTCFullYear() === year),
        new Decimal(1),
      ),
    })),
    account: summarizeAccount(run.equity, run.trades, CAPITAL),
    neighbours: NEIGHBOURS.map(({ name, config }) => ({
      name,
      summary: summarizeTrades(runVersion(candles, config, DEFAULT_COSTS, from).trades, years),
    })),
    context: context(candles, run, from),
  };
}

export type Verdict = 'PASS' | 'FAIL' | 'UNTESTABLE';
export type Check = { name: string; passed: boolean };

const positive = (value: Decimal | null | undefined) => value !== null && value !== undefined && value.gt(0);

/** Spec 6.5, development: all five must hold. Fewer than 30 trades is untestable, not a failure. */
export function developmentVerdict(evidence: Evidence): { verdict: Verdict; checks: Check[] } {
  const { summary, placebo: p } = evidence;
  const checks: Check[] = [
    { name: 'at least 30 trades', passed: summary.trades >= 30 },
    {
      name: 'mean R above zero, and the bottom of its 90% interval',
      passed: positive(summary.meanR) && positive(evidence.interval?.low),
    },
    { name: 'mean R above zero at 0.15% slippage', passed: positive(evidence.stressed.meanR) },
    {
      name: "mean R above the placebo's 95th percentile",
      passed: p !== null && summary.meanR !== null && summary.meanR.gt(p.p95),
    },
    {
      name: 'at least 5 of the 8 neighbours with a positive mean R',
      passed: evidence.neighbours.filter((n) => positive(n.summary.meanR)).length >= 5,
    },
  ];
  const verdict: Verdict = !checks[0]!.passed ? 'UNTESTABLE' : checks.every((c) => c.passed) ? 'PASS' : 'FAIL';
  return { verdict, checks };
}

/** Spec 6.5, the locked period: all three must hold. */
export function lockedVerdict(evidence: Evidence, developmentPerYear: Decimal): { verdict: Verdict; checks: Check[] } {
  const { summary, placebo: p } = evidence;
  const checks: Check[] = [
    { name: 'mean R above zero', passed: positive(summary.meanR) },
    {
      name: "mean R at or above the placebo's median",
      passed: p !== null && summary.meanR !== null && summary.meanR.gte(p.median),
    },
    {
      name: 'a trade rate within half to double the development rate',
      passed: summary.perYear.gte(developmentPerYear.div(2)) && summary.perYear.lte(developmentPerYear.times(2)),
    },
  ];
  return { verdict: checks.every((c) => c.passed) ? 'PASS' : 'FAIL', checks };
}

const r = (value: Decimal | null) => (value === null ? 'none' : `${value.toFixed(3)}R`);
const pct = (value: Decimal | null) => (value === null ? 'none' : `${value.times(100).toFixed(2)}%`);
const day = (time: number) => new Date(time).toISOString().slice(0, 10);
const counts = (tally: Partial<Record<string, number>>) =>
  Object.entries(tally)
    .map(([key, value]) => `${key} ${value}`)
    .join(', ') || 'none';

/** The report as text, for the terminal and the results document. */
export function formatEvidence(e: Evidence, verdict: { verdict: Verdict; checks: Check[] }): string {
  const s = e.summary;
  const interval = e.interval === null ? 'none' : `${r(e.interval.low)} to ${r(e.interval.high)}`;
  const placeboLine =
    e.placebo === null
      ? 'none'
      : `median ${r(e.placebo.median)}, 95th percentile ${r(e.placebo.p95)}, ` +
        `real mean above ${pct(new Decimal(e.placebo.rankOfReal))} of sets`;
  const lines = [
    `Liquidity sweep v0, ${e.period} period, ${day(e.from)} to ${day(e.to)} (exclusive)`,
    `Seeds: bootstrap ${BOOTSTRAP_SEED}, placebo ${PLACEBO_SEED}`,
    '',
    `Trades: ${s.trades} (${s.perYear.toFixed(1)} a year), win rate ${pct(s.winRate)}`,
    `Average win ${r(s.averageWin)}, average loss ${r(s.averageLoss)}`,
    `Mean net R ${r(s.meanR)}, 90% interval ${interval}`,
    `Mean gross R ${r(s.meanGrossR)}, total net R ${r(s.totalR)}`,
    `At 0.15% slippage: mean net R ${r(e.stressed.meanR)}`,
    `Break-even round-trip cost: ${e.breakEvenRoundTrip === null ? 'above 6%' : pct(e.breakEvenRoundTrip)}`,
    `Placebo: ${placeboLine}`,
    `Exits: ${counts(e.exits)}`,
    `Skipped entries: ${counts(e.skips)}`,
    `Candles reaching both stop and target: ${e.ambiguous}`,
    '',
    'By year:',
    ...e.byYear.map(
      ({ year, summary }) => `  ${year}: ${summary.trades} trades, mean ${r(summary.meanR)}, total ${r(summary.totalR)}`,
    ),
    '',
    `Account at 0.25% risk: return ${pct(e.account.returnFraction)}, deepest fall ${pct(e.account.maxDrawdown)}, ` +
      `time in the market ${pct(e.account.timeInMarket)}, capital in use ${pct(e.account.averageCapitalInUse)}, ` +
      `longest losing run ${e.account.longestLosingStreak}`,
    `Context only: buy and hold ${pct(e.context.buyAndHold)}, MA-125 ${pct(e.context.ma125)}, ` +
      `correlation with MA-125 ${e.context.correlationWithMa125?.toFixed(2) ?? 'none'}`,
    '',
    'Neighbours, never used to choose:',
    ...e.neighbours.map((n) => `  ${n.name}: ${n.summary.trades} trades, mean ${r(n.summary.meanR)}`),
    '',
    `Verdict: ${verdict.verdict}`,
    ...verdict.checks.map((c) => `  [${c.passed ? 'x' : ' '}] ${c.name}`),
  ];
  return lines.join('\n');
}

/** The attempt log's line for this run. */
export function attemptLine(e: Evidence, verdict: Verdict, commit: string, runAt: Date): string {
  return (
    `${runAt.toISOString().slice(0, 16)}Z ${commit} liquidity-sweep v0 ${e.period}: ` +
    `${e.summary.trades} trades, mean ${r(e.summary.meanR)}, ${verdict}`
  );
}

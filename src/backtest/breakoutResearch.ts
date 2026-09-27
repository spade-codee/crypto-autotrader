import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { BREAKOUT_V0, channelBreakout, type ChannelBreakoutConfig } from '../strategy/channelBreakout.js';
import { buyAndHold, trendFilter } from '../strategy/trendFilter.js';
import type { BacktestResult, Candle, CostModel, StrategyFn } from '../types.js';
import {
  addsSomething,
  keepsPromise,
  mismatches,
  NEIGHBOURS_NEEDED,
  verdictOf,
  type AddsCheck,
  type PromiseCheck,
  type Verdict,
} from './breakoutBar.js';
import { returnCorrelation, sameDays, stretch, tradeStats, worstFall, yearsOf } from './breakoutEvidence.js';
import {
  MA_RANGE,
  NEIGHBOURS,
  PERIOD_1_FROM,
  PHASE_0_ROWS,
  SPLIT,
  STRESS_COSTS,
  STRETCHES,
  type ReferenceRow,
} from './breakoutPreregistration.js';
import { DEFAULT_COSTS } from './costs.js';
import { runBacktest } from './engine.js';
import { formatComparison, pct } from './report.js';

const CAPITAL = new Decimal(1000);

/** The label the engine's comparison table and Phase 0 give holding. */
export const HOLDING = 'Buy & Hold';

const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
const pct2 = (value: Decimal) => `${value.times(100).toFixed(2)}%`;
const box = (passes: boolean) => (passes ? '[x]' : '[ ]');

/** A breakout's label, short enough for the table's first column. */
export const breakoutLabel = (config: ChannelBreakoutConfig) => `Channel ${config.entryDays}/${config.exitDays}`;

/** Stops unless `bytes` are the file the pre-registration fixed by this SHA-256. */
export function requireFingerprint(file: string, bytes: Uint8Array, fingerprint: string): void {
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== fingerprint) {
    throw new Error(`${file} is not the Phase 0 file: its SHA-256 is ${actual}`);
  }
}

/** One evaluation window: the candles it may see, and the first day it evaluates. */
export type Window = { name: string; candles: Candle[]; from: number };
export type WindowName = 'one' | 'two' | 'spot';
export type Windows = Record<WindowName, Window>;

/** Phase 0's windows: period 1 on the long history before the split; period 2 on the long history and on spot. */
export function windowsOf(long: Candle[], spot: Candle[]): Windows {
  return {
    one: { name: 'Period 1, long history', candles: long.filter((c) => c.time < SPLIT), from: PERIOD_1_FROM },
    two: { name: 'Period 2, long history', candles: long, from: SPLIT },
    spot: { name: 'Period 2, spot', candles: spot, from: SPLIT },
  };
}

function run(window: Window, strategy: StrategyFn, label: string, costs: CostModel = DEFAULT_COSTS): BacktestResult {
  return runBacktest(window.candles, strategy, costs, CAPITAL, label, { evaluateFrom: window.from });
}

function byLabel(results: BacktestResult[], label: string): BacktestResult {
  const found = results.find((result) => result.label === label);
  if (found === undefined) {
    throw new Error(`no ${label} run`);
  }
  return found;
}

/** MA-100, MA-125, MA-150 and holding in each window, at standard costs: what the breakout is judged against. */
export type Baselines = Record<WindowName, BacktestResult[]>;

export function baselinesOf(windows: Windows): Baselines {
  const of = (window: Window) => [
    ...MA_RANGE.map((period) => run(window, trendFilter({ maPeriod: period }), `MA-${period}`)),
    run(window, buyAndHold, HOLDING),
  ];
  return { one: of(windows.one), two: of(windows.two), spot: of(windows.spot) };
}

const windowOfRow = (row: ReferenceRow): WindowName => (row.period === 1 ? 'one' : row.data === 'long' ? 'two' : 'spot');

/** Every way the baselines differ from Phase 0's rows. Empty when every row reproduces. */
export function reproductionProblems(baselines: Baselines, rows: ReferenceRow[] = PHASE_0_ROWS): string[] {
  return rows.flatMap((row) => {
    const name = `period ${row.period} ${row.data} ${row.label}`;
    const result = baselines[windowOfRow(row)].find((r) => r.label === row.label);
    if (result === undefined) {
      return [`${name}: not run`];
    }
    return mismatches(row, result.metrics).map((problem) => `${name}: ${problem}`);
  });
}

export type Evaluation = {
  breakout: Record<WindowName, BacktestResult>;
  stressed: Record<'one' | 'two', { breakout: BacktestResult; holding: BacktestResult }>;
  neighbours: Array<{ config: ChannelBreakoutConfig; one: BacktestResult; two: BacktestResult; passes: boolean }>;
  test1: Array<{ name: string; check: PromiseCheck }>;
  test2: { passing: number; passes: boolean };
  test3: { long: AddsCheck; spot: AddsCheck };
  verdict: Verdict;
};

/** Runs version 0, its stress test and its neighbours, and applies section 6's three tests. Prints nothing. */
export function evaluate(windows: Windows, baselines: Baselines): Evaluation {
  const v0 = channelBreakout(BREAKOUT_V0);
  const name = breakoutLabel(BREAKOUT_V0);
  const breakout = {
    one: run(windows.one, v0, name),
    two: run(windows.two, v0, name),
    spot: run(windows.spot, v0, name),
  };
  const stressedIn = (window: Window) => ({
    breakout: run(window, v0, name, STRESS_COSTS),
    holding: run(window, buyAndHold, HOLDING, STRESS_COSTS),
  });
  const stressed = { one: stressedIn(windows.one), two: stressedIn(windows.two) };
  const holdingOne = byLabel(baselines.one, HOLDING).metrics;
  const holdingTwo = byLabel(baselines.two, HOLDING).metrics;

  const test1 = [
    { name: 'period 1, standard costs', check: keepsPromise(breakout.one.metrics, holdingOne) },
    { name: 'period 1, stress costs', check: keepsPromise(stressed.one.breakout.metrics, stressed.one.holding.metrics) },
    { name: 'period 2, standard costs', check: keepsPromise(breakout.two.metrics, holdingTwo) },
    { name: 'period 2, stress costs', check: keepsPromise(stressed.two.breakout.metrics, stressed.two.holding.metrics) },
  ];

  const neighbours = NEIGHBOURS.map((config) => {
    const strategy = channelBreakout(config);
    const one = run(windows.one, strategy, breakoutLabel(config));
    const two = run(windows.two, strategy, breakoutLabel(config));
    const passes = keepsPromise(one.metrics, holdingOne).passes && keepsPromise(two.metrics, holdingTwo).passes;
    return { config, one, two, passes };
  });
  const passing = neighbours.filter((n) => n.passes).length;

  const averages = (results: BacktestResult[]) => results.filter((r) => r.label.startsWith('MA-')).map((r) => r.metrics);
  const test3 = {
    long: addsSomething(breakout.two.metrics, averages(baselines.two)),
    spot: addsSomething(breakout.spot.metrics, averages(baselines.spot)),
  };

  const keeps = test1.every((t) => t.check.passes);
  const robust = passing >= NEIGHBOURS_NEEDED;
  const adds = test3.long.passes && test3.spot.passes;
  return {
    breakout,
    stressed,
    neighbours,
    test1,
    test2: { passing, passes: robust },
    test3,
    verdict: verdictOf(keeps, robust, adds),
  };
}

/** Section 5's figures for one run, and, unless it is MA-125, how it compares with MA-125. */
function evidenceLines(result: BacktestResult, ma125: BacktestResult): string[] {
  const stats = tradeStats(result.trades, yearsOf(result.equityCurve));
  const fall = worstFall(result.equityCurve);
  const lines = [
    `${result.label}: ${stats.roundTrips} round trips, ${stats.perYear.toFixed(1)} a year; ` +
      `longest losing run ${stats.longestLosingRun}; ` +
      `average losing round trip ${stats.averageLoss === null ? 'none' : pct(stats.averageLoss)}`,
    `  worst fall ${pct(fall.depth)}, from a peak on ${iso(fall.peak)} to a trough on ${iso(fall.trough)}`,
  ];
  if (result !== ma125) {
    const correlation = returnCorrelation(result.equityCurve, ma125.equityCurve);
    lines.push(
      `  same position as MA-125 on ${pct(sameDays(result.equityCurve, ma125.equityCurve))} of days; ` +
        `daily-return correlation ${correlation === null ? 'none' : correlation.toFixed(2)}`,
    );
  }
  return lines;
}

/** The whole report: every table, section 5's evidence, the stretches, the neighbours, the three tests and the verdict. */
export function formatEvaluation(windows: Windows, baselines: Baselines, evaluation: Evaluation): string {
  const out: string[] = [];

  for (const key of ['one', 'two', 'spot'] as const) {
    const results = [evaluation.breakout[key], ...baselines[key]];
    const curve = evaluation.breakout[key].equityCurve;
    out.push(`=== ${windows[key].name}: evaluated ${iso(windows[key].from)} to ${iso(curve[curve.length - 1]!.time)} ===`);
    out.push('', formatComparison(results));
    const ma125 = byLabel(baselines[key], 'MA-125');
    for (const result of [evaluation.breakout[key], ma125, byLabel(baselines[key], HOLDING)]) {
      out.push(...evidenceLines(result, ma125));
    }
    out.push('');
  }

  out.push('=== Stretches, fixed in advance ===');
  for (const part of STRETCHES) {
    const key = part.period === 1 ? 'one' : 'two';
    out.push(`${part.name}, ${iso(part.from)} to ${iso(part.to)}:`);
    for (const result of [evaluation.breakout[key], byLabel(baselines[key], 'MA-125'), byLabel(baselines[key], HOLDING)]) {
      const measured = stretch(result.equityCurve, part.from, part.to);
      out.push(`  ${result.label}: return ${pct(measured.return)}, worst fall ${pct(measured.worstFall)}`);
    }
  }
  out.push('');

  out.push('=== Stress costs: 0.1% fee, 0.15% slippage ===');
  out.push('', 'Period 1, long history', formatComparison([evaluation.stressed.one.breakout, evaluation.stressed.one.holding]));
  out.push('Period 2, long history', formatComparison([evaluation.stressed.two.breakout, evaluation.stressed.two.holding]));

  out.push('=== Neighbours, never used to choose ===');
  out.push('', 'Period 1, long history', formatComparison(evaluation.neighbours.map((n) => n.one)));
  out.push('Period 2, long history', formatComparison(evaluation.neighbours.map((n) => n.two)));
  for (const neighbour of evaluation.neighbours) {
    out.push(`${box(neighbour.passes)} ${breakoutLabel(neighbour.config)} keeps the promise in both periods`);
  }
  out.push('');

  out.push('=== The three tests ===');
  out.push('Test 1: it keeps the promise');
  for (const { name, check } of evaluation.test1) {
    out.push(
      `  ${box(check.passes)} ${name}: worst fall ${pct2(check.fall)}, at most ${pct2(check.fallLimit)}; ` +
        `Sharpe ${check.sharpe.toFixed(3)}, at least ${check.sharpeFloor.toFixed(3)}`,
    );
  }
  out.push(
    `Test 2: ${box(evaluation.test2.passes)} ${evaluation.test2.passing} of ${evaluation.neighbours.length} ` +
      `neighbours keep the promise; ${NEIGHBOURS_NEEDED} needed`,
  );
  out.push('Test 3: it adds something, in period 2');
  for (const [data, check] of [
    ['long history', evaluation.test3.long],
    ['spot', evaluation.test3.spot],
  ] as const) {
    out.push(
      `  ${box(check.passes)} ${data}: worst fall ${pct2(check.fall)} against the averages' lowest ` +
        `${pct2(check.lowestFall)}; CAGR ${pct2(check.cagr)} against their highest ${pct2(check.highestCagr)}`,
    );
  }
  out.push('', `Verdict: ${evaluation.verdict}`);
  return out.join('\n');
}

/** One line for the attempt log: when, at which commit, each test, and the verdict. */
export function attemptLine(evaluation: Evaluation, commit: string, now: Date): string {
  const tests = [
    evaluation.test1.every((t) => t.check.passes),
    evaluation.test2.passes,
    evaluation.test3.long.passes && evaluation.test3.spot.passes,
  ].map((passes, i) => `test ${i + 1} ${passes ? 'pass' : 'fail'}`);
  return `${now.toISOString().slice(0, 16)}Z ${commit} channel-breakout v0: ${tests.join(', ')}: ${evaluation.verdict}`;
}

import { beforeAll, describe, expect, it } from 'vitest';
import { keepsPromise, verdictOf } from '../../src/backtest/breakoutBar.js';
import { PERIOD_1_FROM, PHASE_0_ROWS, SPLIT } from '../../src/backtest/breakoutPreregistration.js';
import {
  attemptLine,
  baselinesOf,
  evaluate,
  formatEvaluation,
  HOLDING,
  reproductionProblems,
  requireFingerprint,
  windowsOf,
  type Baselines,
  type Evaluation,
  type Windows,
} from '../../src/backtest/breakoutResearch.js';
import { pct } from '../../src/backtest/report.js';
import { dailyCandles } from '../helpers/candles.js';

// 2018-11-14 to 2024-12-31: a slow wave, a fast wave and a drift, never the real data.
const closes = Array.from(
  { length: 2240 },
  (_, i) => Math.round((20_000 + 8_000 * Math.sin(i / 90) + 2_000 * Math.sin(i / 13) + 12 * i) * 100) / 100,
);
const long = dailyCandles('2018-11-14', closes);
// Spot starts 2021-07-05, as the real file does, and wobbles apart from the long history, so the
// two give different results and a row compared with the wrong one shows.
const spot = dailyCandles(
  '2018-11-14',
  closes.map((close, i) => Math.round((close + 300 * Math.sin(i / 7)) * 100) / 100),
).filter((c) => c.time >= Date.parse('2021-07-05T00:00:00Z'));

let windows: Windows;
let baselines: Baselines;
let evaluation: Evaluation;

beforeAll(() => {
  windows = windowsOf(long, spot);
  baselines = baselinesOf(windows);
  evaluation = evaluate(windows, baselines);
}, 120_000);

describe('windowsOf', () => {
  it("follows Phase 0's windows", () => {
    expect(windows.one.candles.every((c) => c.time < SPLIT)).toBe(true);
    expect(windows.one.from).toBe(PERIOD_1_FROM);
    expect(windows.two.candles).toBe(long);
    expect(windows.two.from).toBe(SPLIT);
    expect(windows.spot.candles).toBe(spot);
    expect(windows.spot.from).toBe(SPLIT);
  });
});

describe('reproductionProblems', () => {
  it("names the rows that do not reproduce Phase 0's, and none when every row does", () => {
    expect(reproductionProblems(baselines)).toContainEqual(expect.stringMatching(/^period 1 long MA-125: /));
    const own = PHASE_0_ROWS.map((row) => {
      const key = row.period === 1 ? 'one' : row.data === 'long' ? 'two' : 'spot';
      const run = baselines[key].find((r) => r.label === row.label)!;
      return {
        ...row,
        cagr: pct(run.metrics.cagr),
        maxDrawdown: pct(run.metrics.maxDrawdown),
        sharpe: run.metrics.sharpe.toFixed(2),
        trades: run.metrics.tradeCount,
      };
    });
    expect(reproductionProblems(baselines, own)).toEqual([]);
  });
});

describe('evaluate', () => {
  it('judges version 0 at standard and stress costs in both periods, against holding at the same costs', () => {
    expect(evaluation.test1.map((t) => t.name)).toEqual([
      'period 1, standard costs',
      'period 1, stress costs',
      'period 2, standard costs',
      'period 2, stress costs',
    ]);
    const holdingOne = baselines.one.find((r) => r.label === HOLDING)!.metrics;
    expect(evaluation.test1[0]!.check).toEqual(keepsPromise(evaluation.breakout.one.metrics, holdingOne));
    expect(evaluation.test1[1]!.check).toEqual(
      keepsPromise(evaluation.stressed.one.breakout.metrics, evaluation.stressed.one.holding.metrics),
    );
    expect(evaluation.stressed.one.breakout.metrics.tradeCount).toBeGreaterThan(0);
    expect(evaluation.stressed.one.breakout.metrics.finalEquity.lt(evaluation.breakout.one.metrics.finalEquity)).toBe(true);
  });

  it('counts the neighbours that keep the promise in both periods, and applies the verdict table', () => {
    expect(evaluation.neighbours).toHaveLength(8);
    const holdingOne = baselines.one.find((r) => r.label === HOLDING)!.metrics;
    const holdingTwo = baselines.two.find((r) => r.label === HOLDING)!.metrics;
    expect(evaluation.neighbours.map((n) => n.passes)).toEqual(
      evaluation.neighbours.map(
        (n) => keepsPromise(n.one.metrics, holdingOne).passes && keepsPromise(n.two.metrics, holdingTwo).passes,
      ),
    );
    expect(evaluation.test2.passing).toBe(evaluation.neighbours.filter((n) => n.passes).length);
    const keeps = evaluation.test1.every((t) => t.check.passes);
    const adds = evaluation.test3.long.passes && evaluation.test3.spot.passes;
    expect(evaluation.verdict).toBe(verdictOf(keeps, evaluation.test2.passing >= 5, adds));
  });
});

describe('formatEvaluation and attemptLine', () => {
  it('print every section, the tests and the verdict', () => {
    const text = formatEvaluation(windows, baselines, evaluation);
    for (const part of [
      '=== Period 1, long history: evaluated 2019-09-10 to 2022-12-31 ===',
      '=== Period 2, long history: evaluated 2023-01-01 to 2024-12-31 ===',
      '=== Period 2, spot: evaluated 2023-01-01 to 2024-12-31 ===',
      'the 2021 crash, 2021-04-13 to 2021-07-20:',
      'the 2024 chop, 2024-03-13 to 2024-10-10:',
      '=== Stress costs: 0.1% fee, 0.15% slippage ===',
      '=== Neighbours, never used to choose ===',
      'Test 1: it keeps the promise',
      'Test 2:',
      'Test 3: it adds something, in period 2',
      `Verdict: ${evaluation.verdict}`,
    ]) {
      expect(text).toContain(part);
    }
    expect(attemptLine(evaluation, 'abc1234', new Date('2026-09-26T10:00:00Z'))).toMatch(
      /^2026-09-26T10:00Z abc1234 channel-breakout v0: test 1 (pass|fail), test 2 (pass|fail), test 3 (pass|fail): (PASS|FAIL|COVERED)$/,
    );
  });
});

describe('requireFingerprint', () => {
  it('accepts bytes with the pre-registered SHA-256 and refuses any others', () => {
    const abc = new TextEncoder().encode('abc');
    const sha256OfAbc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(() => requireFingerprint('data/x.csv', abc, sha256OfAbc)).not.toThrow();
    expect(() => requireFingerprint('data/x.csv', abc, '0'.repeat(64))).toThrow('data/x.csv is not the Phase 0 file');
  });
});

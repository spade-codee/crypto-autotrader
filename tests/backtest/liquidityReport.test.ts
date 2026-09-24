import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { BracketTrade } from '../../src/backtest/bracket.js';
import {
  attemptLine,
  correlation,
  developmentVerdict,
  formatEvidence,
  gatherEvidence,
  lockedVerdict,
  summarizeAccount,
  summarizeTrades,
  type Evidence,
} from '../../src/backtest/liquidityReport.js';
import { candle, day4, enteringScenario, START } from '../helpers/liquidity.js';

const trade = (r: number, gross = r): BracketTrade =>
  ({ r: new Decimal(r), grossR: new Decimal(gross), entryTime: Date.parse('2024-01-10T00:00:00Z') }) as BracketTrade;
const YEAR = new Decimal(1);

describe('summarizeTrades', () => {
  it('counts, rates and averages trades in net and gross R', () => {
    const summary = summarizeTrades([trade(2, 2.3), trade(-1, -0.9), trade(-1, -0.9), trade(1.5, 1.8)], YEAR);
    expect(summary.trades).toBe(4);
    expect(summary.winRate!.toString()).toBe('0.5');
    expect(summary.averageWin!.toString()).toBe('1.75');
    expect(summary.averageLoss!.toString()).toBe('-1');
    expect(summary.meanR!.toString()).toBe('0.375');
    expect(summary.meanGrossR!.toString()).toBe('0.575');
    expect(summary.totalR.toString()).toBe('1.5');
    expect(summary.perYear.toString()).toBe('4');
  });

  it('leaves the averages empty when there are no trades', () => {
    expect(summarizeTrades([], YEAR)).toMatchObject({ trades: 0, meanR: null, winRate: null });
  });
});

describe('summarizeAccount', () => {
  it('finds the return, the deepest fall, time in the market, and the longest losing run', () => {
    const marks = [100, 110, 99, 104].map((equity, i) => ({ time: i, equity: new Decimal(equity), holding: i === 1 }));
    const account = summarizeAccount(marks, [trade(1), trade(-1), trade(-2), trade(1)], new Decimal(100));
    expect(account.returnFraction.toString()).toBe('0.04');
    expect(account.maxDrawdown.toString()).toBe('0.1');
    expect(account.timeInMarket.toString()).toBe('0.25');
    expect(account.longestLosingStreak).toBe(2);
  });
});

describe('correlation', () => {
  it('is 1 for returns that move together and -1 for opposite ones', () => {
    const xs = [1, 2, 3, 4].map((x) => new Decimal(x));
    expect(correlation(xs, xs)!.toString()).toBe('1');
    expect(correlation(xs, xs.map((x) => x.neg()))!.toString()).toBe('-1');
    expect(correlation(xs.slice(0, 1), xs.slice(0, 1))).toBeNull();
  });
});

/** Evidence that passes every development check unless told otherwise. */
function evidence(overrides: Partial<Evidence> = {}): Evidence {
  const summary = summarizeTrades(Array.from({ length: 40 }, () => trade(0.6)), new Decimal(3));
  return {
    summary,
    interval: { low: new Decimal('0.1'), high: new Decimal('1.1') },
    stressed: { ...summary, meanR: new Decimal('0.3') },
    placebo: { means: [], median: new Decimal(0), p95: new Decimal('0.4'), real: new Decimal('0.6'), rankOfReal: 1 },
    neighbours: Array.from({ length: 8 }, (_, i) => ({
      name: `n${i}`,
      summary: { ...summary, meanR: new Decimal(i < 5 ? 1 : -1) },
    })),
    ...overrides,
  } as Evidence;
}

describe('developmentVerdict', () => {
  it('passes only when all five checks hold', () => {
    expect(developmentVerdict(evidence()).verdict).toBe('PASS');
    expect(developmentVerdict(evidence({ interval: { low: new Decimal('-0.1'), high: new Decimal(1) } })).verdict).toBe('FAIL');
  });

  it('calls fewer than 30 trades untestable, not a failure', () => {
    const few = summarizeTrades(Array.from({ length: 29 }, () => trade(1)), new Decimal(3));
    expect(developmentVerdict(evidence({ summary: few })).verdict).toBe('UNTESTABLE');
  });

  it('fails when four or fewer neighbours are positive', () => {
    const base = evidence();
    const neighbours = base.neighbours.map((n, i) => ({ ...n, summary: { ...n.summary, meanR: new Decimal(i < 4 ? 1 : -1) } }));
    expect(developmentVerdict(evidence({ neighbours })).verdict).toBe('FAIL');
  });

  it('fails when the real mean does not beat the placebo, or turns negative under stress', () => {
    const placebo = { means: [], median: new Decimal(0), p95: new Decimal('0.7'), real: new Decimal('0.6'), rankOfReal: 0.9 };
    expect(developmentVerdict(evidence({ placebo })).verdict).toBe('FAIL');
    const base = evidence();
    expect(developmentVerdict(evidence({ stressed: { ...base.summary, meanR: new Decimal('-0.01') } })).verdict).toBe('FAIL');
  });
});

describe('lockedVerdict', () => {
  it('needs a positive mean, the placebo median, and a comparable trade rate', () => {
    expect(lockedVerdict(evidence(), new Decimal('13.3')).verdict).toBe('PASS');
    expect(lockedVerdict(evidence(), new Decimal(40)).verdict).toBe('FAIL');
  });
});

describe('gatherEvidence and formatEvidence', () => {
  it('produce every figure of section 6.4 on the hand-built scenario', () => {
    const entry = candle(day4(6), 114_500, 115_000, 113_000, 113_500);
    const stopped = candle(day4(7), 113_500, 113_600, 103_000, 104_500);
    const candles = [...enteringScenario(), entry, stopped];
    const evidence = gatherEvidence(candles, 'development', START, START + 5 * 86_400_000);
    expect(evidence.summary.trades).toBe(1);
    expect(evidence.exits).toEqual({ STOP: 1 });
    expect(evidence.ambiguous).toBe(0);
    expect(evidence.placebo!.means).toHaveLength(1000);
    expect(evidence.neighbours).toHaveLength(8);
    const verdict = developmentVerdict(evidence);
    expect(verdict.verdict).toBe('UNTESTABLE');
    const text = formatEvidence(evidence, verdict);
    for (const line of [
      'Seeds: bootstrap 20260924, placebo 20260925',
      'Trades: 1',
      'Mean net R -1.031R',
      'Exits: STOP 1',
      'Candles reaching both stop and target: 0',
      'Neighbours, never used to choose:',
      'Verdict: UNTESTABLE',
      '[ ] at least 30 trades',
    ]) {
      expect(text).toContain(line);
    }
    expect(attemptLine(evidence, verdict.verdict, 'abc1234', new Date('2026-09-24T10:00:00Z'))).toBe(
      '2026-09-24T10:00Z abc1234 liquidity-sweep v0 development: 1 trades, mean -1.031R, UNTESTABLE',
    );
  });
});

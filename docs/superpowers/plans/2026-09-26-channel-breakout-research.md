# Channel-Breakout Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the research harness for the daily BTC channel breakout, version 0, and run it
once, exactly as pre-registered. Research only: nothing here trades.

**Architecture:**
- The strategy is a pure `StrategyFn` in `src/strategy/`, like the trend filter. The position
  follows the most recent entry or exit signal, found by looking back from the latest close, so
  the existing engine runs it unchanged.
- Three small modules in `src/backtest/`:
  - one holds every value the pre-registration fixed;
  - one holds the bar: the three tests, the verdict, the reproduction comparison;
  - one holds the descriptive evidence: round trips, worst falls, agreement with MA-125,
    stretches.
- A research module runs the baselines, the reproduction check and version 0 with its stress test
  and neighbours, then formats everything. A command checks that the files are Phase 0's, stops if
  Phase 0's rows do not reproduce, and otherwise prints the report and an attempt line.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), `decimal.js` for every price and
quantity, Vitest, `tsx` for the command. No new dependency.

---

## The specification

The spec is `docs/research/channel-breakout-candidate.md` on branch `product-prototype`, merged
in PR #51 at `f2d3ccc`. Section numbers below refer to it. Where this plan and the spec differ,
the spec wins; record the difference in the execution notes at the end.

## How this plan ships

- **The phase branch is `research-channel-breakout`,** from `phase-2-paper-engine` at `b2dd016`.
  Each task is one pull request, on its own branch `breakout/<task>` from the phase branch. Each is
  merged back with a merge commit, and the task branch is deleted.
- **Detailed commit messages and pull request descriptions:** what changed, why, and how it was
  tested. **No `Co-Authored-By` trailer and no tool attribution** (CLAUDE.md, *Working through pull
  requests*).
- **Before every merge:** `npm run typecheck` is clean and `npm test` passes in full.
- **Nothing in this plan touches** the engine (`src/engine/`), the ledger, the database, order
  code, `deploy/`, or `prototypes/customer/`.
- **No project formatter exists.** Match the surrounding style by hand: single quotes, semicolons,
  two-space indent, and braces on every `if`. Never `npx` a tool the project does not install.
- **The run happens once, in Task 4.** Nothing before it runs version 0 on the real files.
  `--check-only` stops after the reproduction check, so the data path can be checked first without
  producing a breakout figure.

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/strategy/channelBreakout.ts` | Section 2: the signals, the position, version 0 | 1 |
| `tests/strategy/purity.test.ts` | `src/strategy/` stays pure | 1 |
| `src/backtest/report.ts` (modify) | Export the table's percentage format | 2 |
| `src/backtest/breakoutPreregistration.ts` | Every value sections 3, 5 and 6 fixed | 2 |
| `src/backtest/breakoutBar.ts` | Section 6: tests 1 and 3, the verdict, the reproduction comparison | 2 |
| `src/backtest/breakoutEvidence.ts` | Section 5: round trips, worst falls, agreement, stretches | 2 |
| `src/backtest/breakoutResearch.ts` | The fingerprint check, the windows, the baselines, the runs, the report, the attempt line | 3 |
| `src/cli/breakout-research.ts` | The command: fingerprints, reproduction, the run | 3 |
| `docs/research/channel-breakout-results.md` | The result, as it comes | 4 |

---

### Task 0: This plan

**Files:**
- Create: `docs/superpowers/plans/2026-09-26-channel-breakout-research.md`
- Modify: `CLAUDE.md` (the state table)

- [ ] **Step 1:** Add two rows to CLAUDE.md's state table, after *Engine self-check*:

```markdown
| Liquidity-sweep research | **Closed: untestable, and not pursued.** On branch `research-liquidity-sweep`; `docs/decisions.md` #27 on `product-prototype` |
| Channel-breakout research | **In progress** on branch `research-channel-breakout`, from `phase-2-paper-engine`. Pre-registered in `docs/research/channel-breakout-candidate.md` on `product-prototype` (PR #51). Plan: `docs/superpowers/plans/2026-09-26-channel-breakout-research.md`. Nothing has been run |
```

- [ ] **Step 2:** `npm run typecheck` and `npm test`; both pass (docs only).
- [ ] **Step 3:** Ship: branch `breakout/plan`, title *docs: plan the channel-breakout research
  harness*.

---

### Task 1: The strategy

**Files:**
- Create: `src/strategy/channelBreakout.ts`
- Create: `tests/strategy/channelBreakout.test.ts`
- Create: `tests/strategy/purity.test.ts`
- Modify: `CLAUDE.md` (the layout)

- [ ] **Step 1: Write the failing tests.** Create `tests/strategy/channelBreakout.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { runBacktest } from '../../src/backtest/engine.js';
import {
  BREAKOUT_V0,
  channelBreakout,
  type ChannelBreakoutConfig,
} from '../../src/strategy/channelBreakout.js';
import type { TargetState } from '../../src/types.js';
import { dailyCandles } from '../helpers/candles.js';

/** Short windows, so a scenario fits on a line: enter above the 3 closes before, exit below the 2 before. */
const SMALL: ChannelBreakoutConfig = { entryDays: 3, exitDays: 2 };

function positionAfter(closes: number[], config: ChannelBreakoutConfig = SMALL): TargetState {
  return channelBreakout(config)(dailyCandles('2024-01-01', closes));
}

describe('channelBreakout', () => {
  it('holds USDT before any signal, including when there is too little history for one', () => {
    expect(positionAfter([])).toBe('FLAT');
    expect(positionAfter([1, 2, 3])).toBe('FLAT');
  });

  it('enters on a close above every close of the entry window before it', () => {
    expect(positionAfter([5, 4, 3, 6])).toBe('LONG');
  });

  it('never counts the signal day in its own window', () => {
    // Were the day part of its own window, no close could ever be above it.
    expect(positionAfter([1, 2, 3, 4])).toBe('LONG');
  });

  it('does not enter on a close equal to the channel high', () => {
    expect(positionAfter([5, 4, 3, 5])).toBe('FLAT');
  });

  it('keeps the position on a day with no signal', () => {
    expect(positionAfter([5, 4, 3, 6, 5.5])).toBe('LONG');
  });

  it('exits on a close below every close of the exit window before it', () => {
    expect(positionAfter([5, 4, 3, 6, 5, 4])).toBe('FLAT');
  });

  it('does not exit on a close equal to the channel low', () => {
    expect(positionAfter([5, 4, 3, 6, 5, 5])).toBe('LONG');
  });

  it('stays in USDT after an exit until the next entry', () => {
    const afterExit = [5, 4, 3, 6, 5, 4, 4.5, 4.8];
    expect(positionAfter(afterExit)).toBe('FLAT');
    expect(positionAfter([...afterExit, 5.1])).toBe('LONG');
  });

  it('needs a full exit window of earlier closes before it can exit', () => {
    const config = { entryDays: 2, exitDays: 4 };
    // Entered at 3. At 0.5 only three earlier closes exist, so there is no exit yet.
    expect(positionAfter([1, 2, 3, 0.5], config)).toBe('LONG');
    // At 0.4 all four exist, and it is below every one.
    expect(positionAfter([1, 2, 3, 0.5, 0.4], config)).toBe('FLAT');
  });

  it('follows the most recent signal however far back it lies', () => {
    // Entered at 4. Equal closes are never beyond either channel.
    const flatAfterwards = Array.from({ length: 50 }, () => 4);
    expect(positionAfter([1, 2, 3, 4, ...flatAfterwards])).toBe('LONG');
  });

  it('rejects windows that are not positive integers', () => {
    expect(() => channelBreakout({ entryDays: 0, exitDays: 20 })).toThrow('entryDays must be a positive integer');
    expect(() => channelBreakout({ entryDays: -55, exitDays: 20 })).toThrow('entryDays must be a positive integer');
    expect(() => channelBreakout({ entryDays: 55, exitDays: 2.5 })).toThrow('exitDays must be a positive integer');
  });

  it('agrees, close by close, with a position carried forward through a long series', () => {
    // An independent reference in plain numbers: walk forward, change on each
    // signal, and compare with the strategy's look-back at every close.
    const closes = Array.from(
      { length: 600 },
      (_, i) => Math.round((50_000 + 3_000 * Math.sin(i / 17) + 1_500 * Math.sin(i / 5.3) + 7 * i) * 100) / 100,
    );
    const config = { entryDays: 10, exitDays: 4 };
    const strategy = channelBreakout(config);
    const candles = dailyCandles('2020-01-01', closes);
    let position: TargetState = 'FLAT';
    let changes = 0;
    for (let i = 0; i < closes.length; i++) {
      const enter = i >= 10 && closes[i]! > Math.max(...closes.slice(i - 10, i));
      const exit = i >= 4 && closes[i]! < Math.min(...closes.slice(i - 4, i));
      const next: TargetState = enter ? 'LONG' : exit ? 'FLAT' : position;
      changes += next === position ? 0 : 1;
      position = next;
      expect(strategy(candles.slice(0, i + 1)), `close ${i}`).toBe(position);
    }
    expect(changes).toBeGreaterThan(20);
  });

  it('runs in the existing engine: a warm-up entry is bought at the first evaluated open, and an exit sells at the next open', () => {
    const candles = dailyCandles('2024-01-01', [5, 4, 3, 6, 6, 6, 5, 4, 4]);
    const free = { feeRate: new Decimal(0), slippageRate: new Decimal(0) };
    const result = runBacktest(candles, channelBreakout(SMALL), free, new Decimal(1000), 'channel', {
      evaluateFrom: candles[5]!.time,
    });
    expect(result.trades.map((t) => [t.side, t.time])).toEqual([
      ['BUY', candles[5]!.time],
      ['SELL', candles[7]!.time],
    ]);
  });

  it('holds version 0 to the pre-registered 55 and 20', () => {
    expect(BREAKOUT_V0).toEqual({ entryDays: 55, exitDays: 20 });
  });
});
```

- [ ] **Step 2: Create the purity test,** identical to the one on `research-liquidity-sweep` so a
  later merge of both branches is clean. Create `tests/strategy/purity.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIR = fileURLToPath(new URL('../../src/strategy', import.meta.url));
const ALLOWED = new Set(['../math.js', '../types.js', 'decimal.js']);

describe('src/strategy', () => {
  it('imports only math, types, decimal.js and its own files, and never reads a clock or randomness', () => {
    for (const file of readdirSync(DIR).filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(join(DIR, file), 'utf8');
      for (const [, target] of source.matchAll(/from '([^']+)'/g)) {
        const sibling = /^\.\/[A-Za-z]+\.js$/.test(target!);
        expect(ALLOWED.has(target!) || sibling, `${file} imports ${target}`).toBe(true);
      }
      expect(source, `${file} reads a clock, randomness or the process`).not.toMatch(
        /Date\.now|new Date\(|Math\.random|process\./,
      );
    }
  });
});
```

- [ ] **Step 3: Run the tests to see them fail.**
  Run: `npm test -- tests/strategy`
  Expected: `channelBreakout.test.ts` fails, because `src/strategy/channelBreakout.ts` does not
  exist. `purity.test.ts`, `trendFilter.test.ts` and `ensemble.test.ts` pass.

- [ ] **Step 4: Write the strategy.** Create `src/strategy/channelBreakout.ts`:

```ts
import type { Candle, StrategyFn, TargetState } from '../types.js';

/** How many closes before the signal day each channel spans. */
export type ChannelBreakoutConfig = {
  /** Enter on a close above every close of this many days before it. */
  entryDays: number;
  /** Exit on a close below every close of this many days before it. */
  exitDays: number;
};

/**
 * Version 0, fixed in docs/research/channel-breakout-candidate.md (on
 * product-prototype) before any breakout result: the window lengths of the
 * published Turtle rules' slower system, and nothing else of that system.
 */
export const BREAKOUT_V0: ChannelBreakoutConfig = { entryDays: 55, exitDays: 20 };

export type BreakoutSignal = 'ENTER' | 'EXIT';

/**
 * Whether the close at `index` is strictly beyond every close of the `days`
 * before it: above them all when `direction` is 1, below them all when it is
 * -1. The signal day is never part of its own window, and a close equal to
 * one of them is not beyond it. With fewer than `days` earlier closes, it is
 * never beyond.
 */
function beyondChannel(candles: Candle[], index: number, days: number, direction: 1 | -1): boolean {
  if (index < days) {
    return false;
  }
  const close = candles[index]!.close;
  for (let k = index - 1; k >= index - days; k--) {
    const earlier = candles[k]!.close;
    if (direction === 1 ? !close.gt(earlier) : !close.lt(earlier)) {
      return false;
    }
  }
  return true;
}

/** The signal at the close of `candles[index]`, or null when that day has none. */
export function signalAt(
  candles: Candle[],
  index: number,
  config: ChannelBreakoutConfig,
): BreakoutSignal | null {
  if (beyondChannel(candles, index, config.entryDays, 1)) {
    return 'ENTER';
  }
  if (beyondChannel(candles, index, config.exitDays, -1)) {
    return 'EXIT';
  }
  return null;
}

/**
 * A daily channel breakout, long or flat. Research only: nothing trades it.
 *
 * Hold BTC after an entry signal and USDT after an exit signal. A day with no
 * signal keeps the position, and before any signal it is USDT. The two
 * signals never fall on the same day: a close above the entry channel is
 * above the previous close, which is at or above the exit channel's low.
 *
 * Pure, like the trend filter. The position is whatever the most recent
 * signal says, so it is found by looking back from the latest close, and it
 * depends on the history alone.
 */
export function channelBreakout(config: ChannelBreakoutConfig): StrategyFn {
  for (const name of ['entryDays', 'exitDays'] as const) {
    if (!Number.isInteger(config[name]) || config[name] <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
  }

  return (candles: Candle[]): TargetState => {
    for (let index = candles.length - 1; index >= 0; index--) {
      const signal = signalAt(candles, index, config);
      if (signal !== null) {
        return signal === 'ENTER' ? 'LONG' : 'FLAT';
      }
    }
    return 'FLAT';
  };
}
```

- [ ] **Step 5: Run the tests to see them pass.**
  Run: `npm test -- tests/strategy`
  Expected: all pass, including 14 in `channelBreakout.test.ts`.

- [ ] **Step 6: Mutation checks.** Break each rule on purpose, run `npm test -- tests/strategy`,
  confirm the named test fails, and restore the code. Record each in the execution notes.

| Break | The test that must fail |
|---|---|
| The loop in `beyondChannel` starts at `k = index` | never counts the signal day in its own window |
| `close.gt` becomes `close.gte` | does not enter on a close equal to the channel high |
| `close.lt` becomes `close.lte` | does not exit on a close equal to the channel low |
| The look-back loop returns `'FLAT'` when the latest close has no signal | keeps the position on a day with no signal |
| The look-back loop runs forward from index 0 and returns the first signal | agrees, close by close, with a position carried forward |

- [ ] **Step 7: The layout in CLAUDE.md.** After the `strategy/trendFilter.ts` line, add:

```text
  strategy/channelBreakout.ts the channel-breakout research candidate; nothing trades it
```

- [ ] **Step 8:** `npm run typecheck` and `npm test`: both clean.
- [ ] **Step 9:** Ship: branch `breakout/strategy`, title *research: the channel-breakout strategy,
  version 0*.

---

### Task 2: The bar and the evidence

**Files:**
- Modify: `src/backtest/report.ts:4`
- Create: `src/backtest/breakoutPreregistration.ts`
- Create: `src/backtest/breakoutBar.ts`
- Create: `src/backtest/breakoutEvidence.ts`
- Create: `tests/backtest/breakoutPreregistration.test.ts`
- Create: `tests/backtest/breakoutBar.test.ts`
- Create: `tests/backtest/breakoutEvidence.test.ts`

- [ ] **Step 1: Write the failing tests.** Create `tests/backtest/breakoutPreregistration.test.ts`:

```ts
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
```

- [ ] **Step 2:** Create `tests/backtest/breakoutBar.test.ts`:

```ts
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
```

- [ ] **Step 3:** Create `tests/backtest/breakoutEvidence.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  returnCorrelation,
  roundTrips,
  sameDays,
  stretch,
  tradeStats,
  worstFall,
  yearsOf,
} from '../../src/backtest/breakoutEvidence.js';
import { DEFAULT_COSTS } from '../../src/backtest/costs.js';
import { runBacktest } from '../../src/backtest/engine.js';
import { trendFilter } from '../../src/strategy/trendFilter.js';
import type { EquityPoint, TargetState, Trade } from '../../src/types.js';
import { DAY, dailyCandles } from '../helpers/candles.js';

const d = (n: string | number) => new Decimal(n);
const trade = (side: 'BUY' | 'SELL', price: number, quantity: number, fee: number): Trade => ({
  time: 0,
  side,
  price: d(price),
  quantity: d(quantity),
  fee: d(fee),
});
const curve = (equities: number[], states: TargetState[] = []): EquityPoint[] =>
  equities.map((equity, i) => ({ time: i * DAY, equity: d(equity), state: states[i] ?? 'LONG' }));

describe('roundTrips and tradeStats', () => {
  it('pairs each buy with the next sell and judges it net of fees, as the win rate does', () => {
    const trades = [
      trade('BUY', 100, 10, 0),
      trade('SELL', 110, 10, 10), // +9% after its fee
      trade('BUY', 100, 10, 0),
      trade('SELL', 100, 10, 1), // -0.1%: its fee is its loss
      trade('BUY', 100, 10, 0),
      trade('SELL', 90, 10, 0), // -10%
      trade('BUY', 100, 10, 0),
      trade('SELL', 120, 10, 0), // +20%
      trade('BUY', 100, 10, 0), // still open: not a round trip
    ];
    expect(roundTrips(trades).map((t) => t.netReturn.toString())).toEqual(['0.09', '-0.001', '-0.1', '0.2']);
    const stats = tradeStats(trades, d(2));
    expect(stats.roundTrips).toBe(4);
    expect(stats.perYear.toString()).toBe('2');
    expect(stats.longestLosingRun).toBe(2);
    expect(stats.averageLoss!.toString()).toBe('-0.0505');
  });

  it('has no average loss when no round trip lost', () => {
    expect(tradeStats([trade('BUY', 100, 10, 0), trade('SELL', 110, 10, 0)], d(1)).averageLoss).toBeNull();
  });
});

describe('worstFall', () => {
  it('finds the deepest fall from a running peak, with the dates of the peak and the trough', () => {
    const fall = worstFall(curve([100, 120, 90, 110, 80, 130]));
    expect(fall.depth.toFixed(4)).toBe('0.3333');
    expect([fall.peak, fall.trough]).toEqual([1 * DAY, 4 * DAY]);
  });

  it('agrees with the maximum drawdown the backtest reports', () => {
    const candles = dailyCandles('2024-01-01', [100, 104, 99, 108, 97, 95, 103, 111, 90, 96, 120, 101]);
    const result = runBacktest(candles, trendFilter({ maPeriod: 2 }), DEFAULT_COSTS, d(1000), 'MA-2');
    expect(result.metrics.maxDrawdown.gt(0)).toBe(true);
    expect(worstFall(result.equityCurve).depth.toString()).toBe(result.metrics.maxDrawdown.toString());
  });
});

describe('sameDays and returnCorrelation', () => {
  it('counts the days on which both runs held the same position', () => {
    const a = curve([100, 101, 102, 103], ['LONG', 'LONG', 'FLAT', 'FLAT']);
    const b = curve([100, 101, 102, 103], ['LONG', 'FLAT', 'FLAT', 'LONG']);
    expect(sameDays(a, b).toString()).toBe('0.5');
  });

  it('correlates daily returns: 1 moving together, -1 moving opposite, none when one never moves', () => {
    const up = curve([100, 110, 104.5, 125.4]); // +10%, -5%, +20%
    const opposite = curve([100, 90, 94.5, 75.6]); // -10%, +5%, -20%
    const still = curve([100, 100, 100, 100]);
    expect(returnCorrelation(up, up)!.toDecimalPlaces(10).toString()).toBe('1');
    expect(returnCorrelation(up, opposite)!.toDecimalPlaces(10).toString()).toBe('-1');
    expect(returnCorrelation(up, still)).toBeNull();
  });

  it('refuses two runs over different dates', () => {
    const later = curve([100, 101]).map((p) => ({ ...p, time: p.time + DAY }));
    expect(() => sameDays(curve([100, 101]), later)).toThrow('identical dates');
    expect(() => returnCorrelation(curve([100, 101]), later)).toThrow('identical dates');
  });
});

describe('stretch', () => {
  it("measures from the first day's close to the last day's, with the worst fall between them", () => {
    const part = stretch(curve([100, 120, 90, 110, 80, 130]), 1 * DAY, 4 * DAY);
    expect(part.return.toFixed(4)).toBe('-0.3333');
    expect(part.worstFall.toFixed(4)).toBe('0.3333');
  });

  it('refuses a stretch whose first or last day is not marked', () => {
    expect(() => stretch(curve([100, 120]), 0, 5 * DAY)).toThrow('marked days');
  });
});

describe('yearsOf', () => {
  it('spans the first mark to the last in 365-day years, as CAGR does', () => {
    expect(yearsOf(curve(Array.from({ length: 366 }, () => 100))).toString()).toBe('1');
  });
});
```

- [ ] **Step 4: Run the tests to see them fail.**
  Run: `npm test -- tests/backtest/breakout`
  Expected: all three files fail, because their modules do not exist.

- [ ] **Step 5: Export the percentage format.** In `src/backtest/report.ts`, replace line 4:

```ts
const pct = (value: Decimal): string => `${value.times(100).toFixed(1)}%`;
```

with:

```ts
/** A fraction as a percentage with one decimal, as the comparison table prints it. */
export const pct = (value: Decimal): string => `${value.times(100).toFixed(1)}%`;
```

- [ ] **Step 6:** Create `src/backtest/breakoutPreregistration.ts`:

```ts
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
```

- [ ] **Step 7:** Create `src/backtest/breakoutBar.ts`:

```ts
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
```

- [ ] **Step 8:** Create `src/backtest/breakoutEvidence.ts`:

```ts
import Decimal from 'decimal.js';
import type { EquityPoint, Trade } from '../types.js';

/** The year CAGR uses: 365 days. */
const YEAR_MS = 365 * 86_400_000;

export type RoundTrip = { entry: Trade; exit: Trade; netReturn: Decimal };

/** Completed buy-then-sell pairs, each judged net of both fees, as the win rate judges them. */
export function roundTrips(trades: Trade[]): RoundTrip[] {
  const trips: RoundTrip[] = [];
  let entry: Trade | null = null;
  for (const trade of trades) {
    if (trade.side === 'BUY') {
      entry = trade;
    } else if (entry !== null) {
      const cost = entry.price.times(entry.quantity).plus(entry.fee);
      const proceeds = trade.price.times(trade.quantity).minus(trade.fee);
      trips.push({ entry, exit: trade, netReturn: proceeds.minus(cost).div(cost) });
      entry = null;
    }
  }
  return trips;
}

export type TradeStats = {
  roundTrips: number;
  perYear: Decimal;
  longestLosingRun: number;
  averageLoss: Decimal | null;
};

/** Round trips a year, the longest run of losing ones, and the average losing one. A trip that made nothing lost. */
export function tradeStats(trades: Trade[], years: Decimal): TradeStats {
  const trips = roundTrips(trades);
  const losses: Decimal[] = [];
  let run = 0;
  let longest = 0;
  for (const trip of trips) {
    if (trip.netReturn.lte(0)) {
      losses.push(trip.netReturn);
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }
  return {
    roundTrips: trips.length,
    perYear: new Decimal(trips.length).div(years),
    longestLosingRun: longest,
    averageLoss:
      losses.length === 0 ? null : losses.reduce((sum, loss) => sum.plus(loss), new Decimal(0)).div(losses.length),
  };
}

/** A run's length from its first mark to its last, in the years CAGR uses. */
export function yearsOf(curve: EquityPoint[]): Decimal {
  return new Decimal(curve[curve.length - 1]!.time - curve[0]!.time).div(YEAR_MS);
}

export type Fall = { depth: Decimal; peak: number; trough: number };

/** The deepest fall from a running peak, as the maximum drawdown measures it, with when the peak and trough were marked. */
export function worstFall(curve: EquityPoint[]): Fall {
  if (curve.length === 0) {
    throw new Error('a worst fall needs at least one marked day');
  }
  let peak = curve[0]!;
  let worst: Fall = { depth: new Decimal(0), peak: peak.time, trough: peak.time };
  for (const point of curve) {
    if (point.equity.gt(peak.equity)) {
      peak = point;
    }
    if (peak.equity.gt(0)) {
      const depth = peak.equity.minus(point.equity).div(peak.equity);
      if (depth.gt(worst.depth)) {
        worst = { depth, peak: peak.time, trough: point.time };
      }
    }
  }
  return worst;
}

function requireSameDates(a: EquityPoint[], b: EquityPoint[]): void {
  if (a.length !== b.length || a.some((point, i) => point.time !== b[i]!.time)) {
    throw new Error('the two runs must cover identical dates');
  }
}

/** The share of days on which two runs held the same position. */
export function sameDays(a: EquityPoint[], b: EquityPoint[]): Decimal {
  requireSameDates(a, b);
  const same = a.filter((point, i) => point.state === b[i]!.state).length;
  return new Decimal(same).div(a.length);
}

const dailyReturns = (curve: EquityPoint[]): Decimal[] =>
  curve.slice(1).map((point, i) => point.equity.div(curve[i]!.equity).minus(1));

/** The correlation of two runs' daily returns, or null when there are too few or either never moves. */
export function returnCorrelation(a: EquityPoint[], b: EquityPoint[]): Decimal | null {
  requireSameDates(a, b);
  const x = dailyReturns(a);
  const y = dailyReturns(b);
  if (x.length < 2) {
    return null;
  }
  const mean = (values: Decimal[]) => values.reduce((sum, v) => sum.plus(v), new Decimal(0)).div(values.length);
  const meanX = mean(x);
  const meanY = mean(y);
  let sxy = new Decimal(0);
  let sxx = new Decimal(0);
  let syy = new Decimal(0);
  for (let i = 0; i < x.length; i++) {
    const dx = x[i]!.minus(meanX);
    const dy = y[i]!.minus(meanY);
    sxy = sxy.plus(dx.times(dy));
    sxx = sxx.plus(dx.times(dx));
    syy = syy.plus(dy.times(dy));
  }
  if (sxx.isZero() || syy.isZero()) {
    return null;
  }
  return sxy.div(sxx.times(syy).sqrt());
}

export type Stretch = { return: Decimal; worstFall: Decimal };

/** A run's return from the close of `from` to the close of `to`, and its worst fall between them. */
export function stretch(curve: EquityPoint[], from: number, to: number): Stretch {
  const inside = curve.filter((point) => point.time >= from && point.time <= to);
  if (inside.length === 0 || inside[0]!.time !== from || inside[inside.length - 1]!.time !== to) {
    throw new Error('a stretch must start and end on marked days');
  }
  return {
    return: inside[inside.length - 1]!.equity.div(inside[0]!.equity).minus(1),
    worstFall: worstFall(inside).depth,
  };
}
```

- [ ] **Step 9: Run the tests to see them pass.**
  Run: `npm test -- tests/backtest`
  Expected: all pass, including `report.test.ts` unchanged.

- [ ] **Step 10: Mutation checks,** recorded in the execution notes:

| Break | The test that must fail |
|---|---|
| `keepsPromise` uses `lt` for the fall | passes at exactly two-thirds |
| `addsSomething` uses `lte` for the fall | fails when it only equals the best of them |
| `verdictOf` returns `'COVERED'` when `robust` is false | follows section 6's verdict table |
| `roundTrips` leaves out the sell's fee | pairs each buy with the next sell |
| `worstFall` never moves its peak | finds the deepest fall from a running peak |

- [ ] **Step 11:** `npm run typecheck` and `npm test`: both clean.
- [ ] **Step 12:** Ship: branch `breakout/bar-and-evidence`, title *research: the channel
  breakout's bar and evidence*.

---

### Task 3: The research and the command

**Files:**
- Create: `src/backtest/breakoutResearch.ts`
- Create: `tests/backtest/breakoutResearch.test.ts`
- Create: `src/cli/breakout-research.ts`
- Modify: `package.json` (scripts)
- Modify: `CLAUDE.md` (commands and layout)

- [ ] **Step 1: Write the failing test.** It runs the whole pipeline on a synthetic series, never
  on the real files. Create `tests/backtest/breakoutResearch.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to see it fail.**
  Run: `npm test -- tests/backtest/breakoutResearch.test.ts`
  Expected: FAIL, because `src/backtest/breakoutResearch.ts` does not exist.

- [ ] **Step 3:** Create `src/backtest/breakoutResearch.ts`:

```ts
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
```

- [ ] **Step 4: Run it to see it pass.**
  Run: `npm test -- tests/backtest/breakoutResearch.test.ts`
  Expected: PASS, 6 tests. The `beforeAll` takes a few seconds: it makes 35 runs.

- [ ] **Step 5:** Create `src/cli/breakout-research.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { FINGERPRINTS } from '../backtest/breakoutPreregistration.js';
import {
  attemptLine,
  baselinesOf,
  evaluate,
  formatEvaluation,
  reproductionProblems,
  requireFingerprint,
  windowsOf,
} from '../backtest/breakoutResearch.js';
import { parseCandleCsv } from '../data/csv.js';
import { LONG_HISTORY, SPOT } from '../data/datasets.js';
import type { Candle } from '../types.js';

/**
 * The channel-breakout research, as pre-registered in
 * docs/research/channel-breakout-candidate.md on product-prototype.
 *
 * It refuses any file that is not Phase 0's, stops if Phase 0's rows do not
 * reproduce, and only then runs version 0: once, printing every figure, the
 * three tests, the verdict and an attempt line. With --check-only it stops
 * after the reproduction check, before any breakout run.
 */

async function load(file: string, fingerprint: string): Promise<Candle[]> {
  const bytes = await readFile(file);
  requireFingerprint(file, bytes, fingerprint);
  return parseCandleCsv(bytes.toString('utf8'));
}

function commit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

async function main(): Promise<void> {
  const windows = windowsOf(await load(LONG_HISTORY.file, FINGERPRINTS.long), await load(SPOT.file, FINGERPRINTS.spot));
  console.log('Files: both are the Phase 0 files, by SHA-256.');

  const baselines = baselinesOf(windows);
  const problems = reproductionProblems(baselines);
  if (problems.length > 0) {
    throw new Error(`the reproduction check failed, so no breakout was run:\n${problems.join('\n')}`);
  }
  console.log("Reproduction check: all ten of Phase 0's rows reproduce.");
  if (process.argv.includes('--check-only')) {
    console.log('--check-only: stopping before any breakout run.');
    return;
  }

  const evaluation = evaluate(windows, baselines);
  console.log(`\n${formatEvaluation(windows, baselines, evaluation)}`);
  console.log(`\nAttempt: ${attemptLine(evaluation, commit(), new Date())}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
```

- [ ] **Step 6:** In `package.json`, after the `"out-of-asset"` script, add:

```json
    "breakout:research": "tsx src/cli/breakout-research.ts",
```

- [ ] **Step 7: Do not run the command on the real files in this task.** The refusal of a wrong
  file is covered by the `requireFingerprint` test, and the whole pipeline by the synthetic series.

- [ ] **Step 8: CLAUDE.md.** In the commands table, after `npm run out-of-asset`, add:

```markdown
| `npm run breakout:research` | The channel-breakout research, run once, on the Phase 0 files only. `-- --check-only` stops after the reproduction check, before any breakout run |
```

  In the layout, extend the `backtest/` entry to end: `also the channel-breakout bar, evidence and
  research`.

- [ ] **Step 9: Mutation checks,** recorded in the execution notes:

| Break | The test that must fail |
|---|---|
| `windowOfRow` sends period 2 spot rows to `'two'` | names the rows that do not reproduce, and none when every row does |
| `evaluate` checks the period 1 stress case with the standard-cost breakout run | judges version 0 at standard and stress costs |
| `requireFingerprint` hashes with SHA-1 | accepts bytes with the pre-registered SHA-256 and refuses any others |

  A break of holding's stress run cannot be caught this way, and needs no check: holding buys
  once, so its worst fall and Sharpe are the same at any slippage.

- [ ] **Step 10:** `npm run typecheck` and `npm test`: both clean.
- [ ] **Step 11:** Ship: branch `breakout/research-command`, title *research: the channel-breakout
  research and its command*.

---

### Task 4: The run

**Files:**
- Create: `docs/research/channel-breakout-results.md`
- Modify: `CLAUDE.md` (the state table)
- Modify: `docs/superpowers/plans/2026-09-26-channel-breakout-research.md` (execution notes)

- [ ] **Step 1: The files.** Put Phase 0's `BTCUSD-inverse-1d.csv` and `BTCUSDT-spot-1d.csv` in
  `data/`, copied from the machine that ran Phase 0. `npm run fetch` will not do: it fetches up to
  today, so the fingerprints would differ and the command would refuse.
- [ ] **Step 2: Check before running.** Run `npm run breakout:research -- --check-only`.
  Expected:

```text
Files: both are the Phase 0 files, by SHA-256.
Reproduction check: all ten of Phase 0's rows reproduce.
--check-only: stopping before any breakout run.
```

  Anything else stops the task: record it, and fix the cause in its own pull request first.
- [ ] **Step 3: The one run.** Run `npm run breakout:research` once, and save its whole output.
- [ ] **Step 4: Write `docs/research/channel-breakout-results.md`,** in the voice of
  `docs/research/phase-0-findings.md`, with these sections:
  - the verdict, first, in one paragraph;
  - what was run: the commit, the files, the check;
  - the three tests, each with its figures and its threshold;
  - the tables, as printed;
  - the evidence of section 5: round trips, losing runs, worst falls with dates, the share of days
    with MA-125's position, the correlation, the two stretches;
  - what the result means, and what it cannot show (the spec's section 7);
  - the attempt log.

  **No number is rounded to flatter, and no rule changes.** A failure is recorded with its
  numbers.
- [ ] **Step 5:** In CLAUDE.md's state table, replace the *Channel-breakout research* row with its
  verdict, the results document, and the next step.
- [ ] **Step 6:** Append this plan's execution notes: the pull requests, the tests added, the
  mutation checks, the run, and any difference from this plan.
- [ ] **Step 7:** Ship: branch `breakout/run`, title *research: the channel breakout, run once*.

---

### Task 5: The result in the product documents

On `product-prototype`, branch `breakout/result`, title *docs: record the channel breakout's
result*.

- [ ] **Step 1: The catalogue,** `docs/product/strategy-catalogue.md`. Replace the *Channel
  breakout v0* row's state and next gate by the verdict:

| Verdict | State | Next gate |
|---|---|---|
| PASS | **Tested.** Its trade-off against MA-125 in one sentence, with a pointer to the results | The founder's decision on engine support for practice (candidate, section 9) |
| FAIL | **Not pursued.** The test that failed, with its figures | None. No other windows are tried |
| COVERED | **Not pursued as a separate strategy:** it kept the promise, and MA-125's range already covers it | None. Recorded as support for MA-125 |

- [ ] **Step 2: The candidate's status,** `docs/research/channel-breakout-candidate.md`: one bullet
  after *Status*, with the verdict, the date and a pointer to the results.
- [ ] **Step 3: The handoff,** `docs/collaboration/claude-strategy-handoff.md`: a new section for
  Codex with the verdict, the figures that decided it, and the card. For PASS, "Tested on past
  prices · not available", with no performance figures. For FAIL or COVERED, Codex's choice
  between removing the card and "Tested and not pursued".
- [ ] **Step 4: Decisions,** `docs/decisions.md`. For FAIL or COVERED, a numbered entry records
  the candidate as not pursued, as #27 did for the liquidity idea. For PASS, nothing is decided
  yet: the founder's decision on practice comes first. Update the research index row either way.
- [ ] **Step 5:** Tell the founder the verdict in plain words: what it shows, what it cannot, and
  the next decision, which is theirs.

---

## Self-review

- **Spec coverage:**

  | Spec | Task |
  |---|---|
  | 2, the rules and their details | 1 |
  | 3, data, periods, costs | 2 (values), 3 (windows, fingerprints) |
  | 3, the reproduction check | 2 (`mismatches`), 3 (`reproductionProblems`, `--check-only`) |
  | 5, what the run reports | 2 (evidence), 3 (`formatEvaluation`) |
  | 6, tests 1–3 and the verdicts | 2 (`keepsPromise`, `addsSomething`, `verdictOf`), 3 (`evaluate`) |
  | 6, one version, one run | 3 (`--check-only`), 4 |
  | 9 and 10, after the run | 5 |
  | 11, the work | Tasks 0–5 |

- **Placeholders:** none. Tasks 4 and 5 depend on the result, and their text is written as it
  comes, within the structure given.
- **Type consistency:**
  - `ChannelBreakoutConfig`, `BREAKOUT_V0`, `channelBreakout` and `signalAt` come from Task 1.
  - `SPLIT`, `PERIOD_1_FROM`, `STRESS_COSTS`, `NEIGHBOURS`, `MA_RANGE`, `STRETCHES`,
    `FINGERPRINTS`, `ReferenceRow` and `PHASE_0_ROWS` come from Task 2's pre-registration module.
  - `keepsPromise`, `addsSomething`, `verdictOf`, `mismatches`, `NEIGHBOURS_NEEDED`,
    `PromiseCheck`, `AddsCheck` and `Verdict` come from Task 2's bar.
  - `roundTrips`, `tradeStats`, `yearsOf`, `worstFall`, `sameDays`, `returnCorrelation` and
    `stretch` come from Task 2's evidence.
  - `pct` is exported from `report.ts` in Task 2.
  - `requireFingerprint`, `windowsOf`, `baselinesOf`, `reproductionProblems`, `evaluate`,
    `formatEvaluation`, `attemptLine`, `HOLDING` and `breakoutLabel` come from Task 3.
  - All are used later with the same names.

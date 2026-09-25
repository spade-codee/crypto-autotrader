# Liquidity-Sweep Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the research harness for the liquidity-sweep candidate, version 0, and run it once
on the development period, exactly as pre-registered. Research only: nothing here trades.

**Architecture:**
- The strategy is a deterministic step function in `src/strategy/`, fed one completed 15-minute
  candle at a time. It has no clock, no randomness and no input or output, so the same code could
  later run in the engine.
- A backtester in `src/backtest/` turns its entries into bracket trades: stop, target, time limit,
  0.25% risk sizing, and results in R.
- An evidence layer adds a month-block bootstrap and a month-matched placebo, both with fixed seeds.
- A report applies the bar fixed before any data.
- Commands fetch and check the candles, then run the research, and a lock enforced in code keeps
  the locked period unseen.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), `decimal.js` for every price and quantity,
Vitest, `tsx` for the commands. No new dependency.

---

## The specification

The spec is `docs/research/liquidity-sweep-candidate.md` on branch `product-prototype`, at commit
`a079748`. That is the draft of `ab8b2c1` plus the clarifications of 2026-09-24 (its section 3a),
all made before any data. Rule numbers (R1–R13) and section numbers below refer to it. Where this
plan and the spec differ, the spec wins; record the difference in the execution notes at the end.

## How this plan ships

- **The phase branch is `research-liquidity-sweep`,** from `phase-2-paper-engine` at `b2dd016`.
  Each task is one pull request, on its own branch `liquidity/<task>` from the phase branch. Each is
  merged back with a merge commit, and the task branch is deleted.
- **Detailed commit messages and pull request descriptions:** what changed, why, and how it was
  tested. **No `Co-Authored-By` trailer and no tool attribution** (CLAUDE.md, *Working through pull
  requests*).
- **Before every merge:** `npm run typecheck` is clean and `npm test` passes in full.
- **Nothing in this plan touches** the engine (`src/engine/`), the ledger, the database, order
  code, `deploy/`, or `prototypes/customer/`.
- **No project formatter exists.** Match the surrounding style by hand: single quotes, semicolons,
  two-space indent, and braces on every `if`. Never `npx` a tool the project does not install.

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/data/bybit.ts` (modify) | Candles of any fetched interval, with an optional end | 1 |
| `src/data/integrity.ts` | Gaps, duplicates, order, alignment, impossible prices | 1 |
| `src/data/datasets.ts` (modify) | The 15-minute dataset | 1 |
| `src/cli/liquidity-fetch.ts` | Fetch 15-minute candles up to an end date, check, save | 1 |
| `src/strategy/bars.ts` | UTC blocks: 4-hour and daily candles from 15-minute ones | 2 |
| `src/strategy/swings.ts` | Swing highs and lows, with the moment each becomes known | 2 |
| `src/strategy/structure.ts` | R3: is the 4-hour structure up | 2 |
| `src/strategy/liquiditySweep.ts` | R4–R8, R12, R13: the step function, version 0 and its neighbours | 3 |
| `src/backtest/bracket.ts` | R9–R11: exits, sizing, net and gross R, the account | 4 |
| `src/backtest/evidence.ts` | Seeded draws, the month-block bootstrap, the month-matched placebo | 5 |
| `src/backtest/liquidityPeriods.ts` | The periods and the lock | 6 |
| `src/backtest/liquidityReport.ts` | Every number in section 6.4, the bar in 6.5, the text report | 6 |
| `src/data/compare.ts` | Built candles against Bybit's own; volume by year | 7 |
| `src/cli/liquidity-check.ts` | The data check | 7 |
| `src/cli/liquidity-research.ts` | The research command: count-only, run, attempt line | 7 |
| `tests/helpers/liquidity.ts` | A scenario that makes version 0 arm and enter | 3 |
| `docs/research/liquidity-sweep-results.md` | The development result, as it comes | 8 |

---

### Task 1: 15-minute candles

**Files:**
- Modify: `src/data/bybit.ts`, `src/data/datasets.ts`, `package.json`, `tests/data/bybit.test.ts`
- Create: `src/data/integrity.ts`, `src/cli/liquidity-fetch.ts`, `tests/data/integrity.test.ts`

- [ ] **Step 1: Write the failing tests.** In `tests/data/bybit.test.ts`, move `row`, `page` and
  `serve` out of `describe('fetchDailyCandles')` to module scope, unchanged, and add `fetchCandles`
  to the import. Then append:

```ts
describe('closedCandles with an interval', () => {
  it('drops a 15-minute candle that has not finished', () => {
    const q = 900_000;
    const result = closedCandles([candleAt(0), candleAt(q), candleAt(2 * q)], 2 * q + 60_000, q);
    expect(result.map((c) => c.time)).toEqual([0, q]);
  });
});

describe('fetchCandles', () => {
  const q = 900_000;

  it('asks for the interval and continues one interval after the last candle', async () => {
    const { impl, urls } = serve([page(0, q), page(2 * q), page()]);
    const candles = await fetchCandles('BTCUSDT', '15', new Date(0), {
      hosts: ['https://x.test'],
      fetchImpl: impl,
      now: 3 * q,
    });
    expect(candles.map((c) => c.time)).toEqual([0, q, 2 * q]);
    expect(urls[0]).toContain('interval=15');
    expect(urls[1]).toContain(`start=${2 * q}`);
  });

  it('keeps nothing at or after the end, and stops asking past it', async () => {
    const { impl, urls } = serve([page(0, q, 2 * q, 3 * q), page(4 * q)]);
    const candles = await fetchCandles('BTCUSDT', '15', new Date(0), {
      hosts: ['https://x.test'],
      fetchImpl: impl,
      now: 100 * q,
      end: 2 * q,
    });
    expect(candles.map((c) => c.time)).toEqual([0, q]);
    expect(urls).toHaveLength(1);
  });
});
```

Create `tests/data/integrity.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { checkCandles, formatIntegrity, usable } from '../../src/data/integrity.js';
import type { Candle } from '../../src/types.js';

const Q = 900_000;
const bar = (time: number, open = 100, high = 101, low = 99, close = 100.5, volume = 1): Candle => ({
  time,
  open: new Decimal(open),
  high: new Decimal(high),
  low: new Decimal(low),
  close: new Decimal(close),
  volume: new Decimal(volume),
});

describe('checkCandles', () => {
  it('passes a clean series', () => {
    const report = checkCandles([bar(0), bar(Q), bar(2 * Q)], Q);
    expect(report).toMatchObject({
      count: 3,
      first: 0,
      last: 2 * Q,
      gaps: [],
      duplicates: [],
      outOfOrder: [],
      misaligned: [],
      invalid: [],
    });
    expect(usable(report)).toBe(true);
  });

  it('reports a gap with the number of candles missing, and still counts the file usable', () => {
    const report = checkCandles([bar(0), bar(3 * Q)], Q);
    expect(report.gaps).toEqual([{ after: 0, missing: 2 }]);
    expect(usable(report)).toBe(true);
  });

  it('refuses duplicates, candles out of order, and candles off their boundary', () => {
    const report = checkCandles([bar(Q), bar(Q), bar(0), bar(2 * Q + 1)], Q);
    expect(report.duplicates).toEqual([Q]);
    expect(report.outOfOrder).toEqual([0]);
    expect(report.misaligned).toEqual([2 * Q + 1]);
    expect(usable(report)).toBe(false);
  });

  it('refuses prices that cannot belong to one candle', () => {
    const report = checkCandles(
      [
        bar(0, 100, 99, 98, 100),
        bar(Q, 100, 101, 100.2, 100.5),
        bar(2 * Q, 100, 101, 0, 100.5),
        bar(3 * Q, 100, 101, 99, 100.5, -1),
        bar(4 * Q, 100, 98, 99, 98.5),
      ],
      Q,
    );
    expect(report.invalid.map((problem) => problem.reason)).toEqual([
      'high below the open or close',
      'low above the open or close',
      'a price at or below zero',
      'negative volume',
      'high below low',
    ]);
    expect(usable(report)).toBe(false);
  });
});

describe('formatIntegrity', () => {
  it('summarises the counts and lists the gaps', () => {
    const text = formatIntegrity(checkCandles([bar(0), bar(3 * Q)], Q));
    expect(text).toContain('2 candles, 1970-01-01T00:00:00Z to 1970-01-01T00:45:00Z');
    expect(text).toContain('gaps: 1 (2 candles missing)');
    expect(text).toContain('missing 2 after 1970-01-01T00:00:00Z');
  });
});
```

- [ ] **Step 2: Run them to see them fail.**
  Run: `npx vitest run tests/data/bybit.test.ts tests/data/integrity.test.ts`
  Expected: FAIL. `fetchCandles` is not exported, and `src/data/integrity.ts` does not exist.

- [ ] **Step 3: Generalize the fetcher.** In `src/data/bybit.ts`, below `DAY_MS`, add:

```ts
/** The Bybit kline intervals this project fetches, and each one's length in milliseconds. */
export const INTERVAL_MS = { '15': 900_000, '240': 14_400_000, D: DAY_MS } as const;
export type Interval = keyof typeof INTERVAL_MS;
```

Give `closedCandles` an interval, with the daily default. Its documentation keeps its paragraph
and says "candles whose interval has fully ended" in place of "daily candles whose day has fully
ended":

```ts
export function closedCandles(candles: Candle[], now: number, intervalMs: number = DAY_MS): Candle[] {
  return candles.filter((c) => c.time + intervalMs <= now);
}
```

Add `end` to `FetchCandlesOptions`:

```ts
  /**
   * Epoch ms. Candles opening at or after this are neither kept nor asked for, so a
   * research period that must stay unseen never reaches the disk. Defaults to now.
   */
  end?: number;
```

Replace `fetchDailyCandles` with `fetchCandles` plus a daily wrapper. The pagination comment
stays, and now says the oldest-first behaviour was verified for daily candles on 2026-09-17 and
for 15-minute candles on 2026-09-23:

```ts
export async function fetchCandles(
  symbol: string,
  interval: Interval,
  start: Date,
  options: FetchCandlesOptions = {},
): Promise<Candle[]> {
  const category = options.category ?? 'spot';
  const hosts = options.hosts ?? BYBIT_HOSTS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now();
  const end = Math.min(options.end ?? now, now);
  const step = INTERVAL_MS[interval];

  const all: Candle[] = [];
  let cursor = start.getTime();

  for (;;) {
    const path = `${KLINE_PATH}?category=${category}&symbol=${symbol}&interval=${interval}&start=${cursor}&limit=${MAX_LIMIT}`;
    const page = parseKlineResponse(await getJson(hosts, path, fetchImpl));
    if (page.length === 0) {
      break;
    }

    const fresh = page.filter((c) => c.time > (all[all.length - 1]?.time ?? -1));
    if (fresh.length === 0) {
      break;
    }
    all.push(...fresh);

    cursor = all[all.length - 1]!.time + step;
    if (cursor > end) {
      break;
    }
  }

  return closedCandles(all, now, step).filter((c) => c.time < end);
}

/** Fetches CLOSED daily candles from `start` up to now. See fetchCandles. */
export async function fetchDailyCandles(
  symbol: string,
  start: Date,
  options: FetchCandlesOptions = {},
): Promise<Candle[]> {
  return fetchCandles(symbol, 'D', start, options);
}
```

With no `end`, `end` is `now`. `cursor > end` is then the old `cursor > now`, and the new filter
only removes candles `closedCandles` already dropped, so daily fetching is unchanged.

- [ ] **Step 4: Write `src/data/integrity.ts`.**

```ts
import type { Candle } from '../types.js';

/** A run of missing candles: `missing` of them after the candle opening at `after`. */
export type Gap = { after: number; missing: number };

export type IntegrityReport = {
  intervalMs: number;
  count: number;
  first: number | null;
  last: number | null;
  gaps: Gap[];
  duplicates: number[];
  outOfOrder: number[];
  misaligned: number[];
  invalid: Array<{ time: number; reason: string }>;
};

/**
 * Checks candles of one interval for what would make a result about wicks
 * untrustworthy: a missing candle, one repeated or out of order, one that does
 * not start on its interval's boundary, and prices that cannot all belong to one
 * candle. Gaps are reported, not fatal: the strategy starts again after one
 * (R13). Anything else means the file is wrong.
 */
export function checkCandles(candles: Candle[], intervalMs: number): IntegrityReport {
  const report: IntegrityReport = {
    intervalMs,
    count: candles.length,
    first: candles[0]?.time ?? null,
    last: candles[candles.length - 1]?.time ?? null,
    gaps: [],
    duplicates: [],
    outOfOrder: [],
    misaligned: [],
    invalid: [],
  };
  let previous: Candle | undefined;
  for (const candle of candles) {
    if (candle.time % intervalMs !== 0) {
      report.misaligned.push(candle.time);
    }
    const reason = impossiblePrices(candle);
    if (reason !== null) {
      report.invalid.push({ time: candle.time, reason });
    }
    if (previous !== undefined) {
      const step = candle.time - previous.time;
      if (step === 0) {
        report.duplicates.push(candle.time);
      } else if (step < 0) {
        report.outOfOrder.push(candle.time);
      } else if (step > intervalMs) {
        report.gaps.push({ after: previous.time, missing: Math.round(step / intervalMs) - 1 });
      }
    }
    previous = candle;
  }
  return report;
}

/** True when nothing but gaps was found. Gaps are survivable; the rest are not. */
export function usable(report: IntegrityReport): boolean {
  return (
    report.duplicates.length === 0 &&
    report.outOfOrder.length === 0 &&
    report.misaligned.length === 0 &&
    report.invalid.length === 0
  );
}

function impossiblePrices(candle: Candle): string | null {
  if (candle.low.lte(0)) {
    return 'a price at or below zero';
  }
  if (candle.volume.isNeg()) {
    return 'negative volume';
  }
  if (candle.high.lt(candle.low)) {
    return 'high below low';
  }
  if (candle.high.lt(candle.open) || candle.high.lt(candle.close)) {
    return 'high below the open or close';
  }
  if (candle.low.gt(candle.open) || candle.low.gt(candle.close)) {
    return 'low above the open or close';
  }
  return null;
}

const iso = (time: number) => new Date(time).toISOString().replace('.000Z', 'Z');

/** A short summary for the research commands. */
export function formatIntegrity(report: IntegrityReport): string {
  const missing = report.gaps.reduce((total, gap) => total + gap.missing, 0);
  const span = report.first === null ? '' : `, ${iso(report.first)} to ${iso(report.last!)}`;
  const lines = [
    `${report.count} candles${span}`,
    `gaps: ${report.gaps.length} (${missing} candles missing)`,
    `duplicates: ${report.duplicates.length}, out of order: ${report.outOfOrder.length}, ` +
      `misaligned: ${report.misaligned.length}, impossible prices: ${report.invalid.length}`,
  ];
  for (const gap of report.gaps.slice(0, 10)) {
    lines.push(`  missing ${gap.missing} after ${iso(gap.after)}`);
  }
  if (report.gaps.length > 10) {
    lines.push(`  and ${report.gaps.length - 10} more gaps`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 5: Add the dataset and the fetch command.** Append to `src/data/datasets.ts`, which
  keeps it out of `DATASETS`, so `npm run fetch` does not fetch it:

```ts
/**
 * Bybit spot BTCUSDT in 15-minute candles, for the liquidity-sweep research
 * (docs/research/liquidity-sweep-candidate.md on product-prototype). History
 * begins 2021-07-05 12:00 UTC; the early months were thin (section 6.2).
 */
export const LIQUIDITY_15M: Dataset = {
  symbol: 'BTCUSDT',
  category: 'spot',
  file: 'data/BTCUSDT-spot-15m.csv',
  purpose: 'liquidity-sweep research, 15-minute candles',
};
```

Create `src/cli/liquidity-fetch.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { BYBIT_HOSTS, fetchCandles, INTERVAL_MS } from '../data/bybit.js';
import { toCandleCsv } from '../data/csv.js';
import { LIQUIDITY_15M } from '../data/datasets.js';
import { checkCandles, formatIntegrity } from '../data/integrity.js';

// Before Bybit spot's first 15-minute candle; the API answers from its first.
const START = new Date('2021-07-01T00:00:00Z');
// The locked period stays off the disk until its own pull request fetches with --until 2026-09-01.
const DEFAULT_UNTIL = '2025-01-01';
// Set BYBIT_API_BASE to force a single host; otherwise hosts are tried in order.
const HOSTS = process.env.BYBIT_API_BASE ? [process.env.BYBIT_API_BASE] : BYBIT_HOSTS;

function until(argv: string[]): number {
  const index = argv.indexOf('--until');
  const value = index === -1 ? DEFAULT_UNTIL : argv[index + 1];
  if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('--until needs a date: YYYY-MM-DD');
  }
  return Date.parse(`${value}T00:00:00Z`);
}

async function main(): Promise<void> {
  const end = until(process.argv.slice(2));
  await mkdir('data', { recursive: true });
  const day = new Date(end).toISOString().slice(0, 10);
  console.log(`Fetching ${LIQUIDITY_15M.symbol} ${LIQUIDITY_15M.category} 15-minute candles before ${day}...`);
  const candles = await fetchCandles(LIQUIDITY_15M.symbol, '15', START, {
    category: LIQUIDITY_15M.category,
    hosts: HOSTS,
    end,
  });
  if (candles.length === 0) {
    throw new Error('no candles returned');
  }
  await writeFile(LIQUIDITY_15M.file, toCandleCsv(candles), 'utf8');
  console.log(`  wrote ${candles.length} candles to ${LIQUIDITY_15M.file}`);
  console.log(formatIntegrity(checkCandles(candles, INTERVAL_MS['15'])));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
```

In `package.json` scripts, after `"out-of-asset"`: `"liquidity:fetch": "tsx src/cli/liquidity-fetch.ts",`

- [ ] **Step 6: Run the tests.**
  Run: `npx vitest run tests/data/`
  Expected: PASS, including every existing `fetchDailyCandles` test, unchanged.

- [ ] **Step 7: Type-check and run the full suite.** Run `npm run typecheck`, then `npm test`.
  Expected: clean, and all tests passing.

- [ ] **Step 8: Ship.** Branch `liquidity/candles-15m`. Title: *research: fetch and check 15-minute
  candles for the liquidity sweep*. Say in the description that daily fetching is unchanged, and
  that the default end keeps the locked period off the disk.

---

### Task 2: Candles, swings and structure

**Files:**
- Create: `src/strategy/bars.ts`, `src/strategy/swings.ts`, `src/strategy/structure.ts`
- Create: `tests/strategy/bars.test.ts`, `tests/strategy/swings.test.ts`,
  `tests/strategy/structure.test.ts`, `tests/strategy/purity.test.ts`
- Modify: `tests/helpers/candles.ts`, `CLAUDE.md` (the purity rule)

- [ ] **Step 1: A candle helper.** Append to `tests/helpers/candles.ts`:

```ts
/** A candle at `time` with these prices and a volume of 1. */
export function bar(
  time: number,
  open: number | string,
  high: number | string,
  low: number | string,
  close: number | string,
): Candle {
  return {
    time,
    open: new Decimal(open),
    high: new Decimal(high),
    low: new Decimal(low),
    close: new Decimal(close),
    volume: new Decimal(1),
  };
}
```

- [ ] **Step 2: Write the failing tests.** `tests/strategy/bars.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { aggregate, combine, DAY_MS, FOUR_HOURS_MS, QUARTER_HOUR_MS } from '../../src/strategy/bars.js';
import { bar } from '../helpers/candles.js';

const Q = QUARTER_HOUR_MS;
/** `count` 15-minute candles from `start`, each a step higher than the last. */
const rising = (start: number, count: number) =>
  Array.from({ length: count }, (_, i) => bar(start + i * Q, 100 + i, 102 + i, 99 + i, 101 + i));

describe('combine', () => {
  it('takes the first open, the highest high, the lowest low, the last close, and the total volume', () => {
    const candle = combine([bar(0, 10, 12, 9, 11), bar(Q, 11, 15, 10, 14), bar(2 * Q, 14, 14, 8, 9)]);
    expect([candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume].map(String)).toEqual([
      '0',
      '10',
      '15',
      '8',
      '9',
      '3',
    ]);
  });
});

describe('aggregate', () => {
  it('builds a 4-hour candle from its sixteen 15-minute candles', () => {
    const [four] = aggregate(rising(0, 16), FOUR_HOURS_MS);
    expect(four!.time).toBe(0);
    expect([four!.open, four!.high, four!.low, four!.close].map(String)).toEqual(['100', '117', '99', '116']);
  });

  it('drops a block with a missing candle', () => {
    expect(aggregate(rising(0, 16).filter((_, i) => i !== 7), FOUR_HOURS_MS)).toEqual([]);
  });

  it('drops a partial block at either end and keeps the whole ones', () => {
    const blocks = aggregate(rising(FOUR_HOURS_MS - 3 * Q, 3 + 16 + 5), FOUR_HOURS_MS);
    expect(blocks.map((block) => block.time)).toEqual([FOUR_HOURS_MS]);
  });

  it('builds UTC days from 96 candles', () => {
    const days = aggregate(rising(0, 192), DAY_MS);
    expect(days.map((day) => day.time)).toEqual([0, DAY_MS]);
    expect(days[1]!.low.toString()).toBe('195');
  });
});
```

`tests/strategy/swings.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { QUARTER_HOUR_MS } from '../../src/strategy/bars.js';
import { findSwings, swingsAt } from '../../src/strategy/swings.js';
import { bar } from '../helpers/candles.js';

const Q = QUARTER_HOUR_MS;
/** Candles with the given highs and lows; each opens at its low and closes at its high. */
const hl = (pairs: Array<[number, number]>) => pairs.map(([high, low], i) => bar(i * Q, low, high, low, high));

describe('swingsAt', () => {
  it('finds a high strictly above the two candles on each side, known when the last one closes', () => {
    const [swing, ...rest] = swingsAt(hl([[10, 5], [11, 5], [15, 5], [12, 5], [11, 5]]), Q);
    expect(rest).toEqual([]);
    expect(swing).toMatchObject({ kind: 'HIGH', time: 2 * Q, knownAt: 5 * Q });
    expect(swing!.price.toString()).toBe('15');
  });

  it('finds no swing when a neighbour ties', () => {
    expect(swingsAt(hl([[10, 5], [15, 3], [15, 3], [12, 4], [11, 5]]), Q)).toEqual([]);
  });

  it('finds a high and a low at an outside candle', () => {
    const swings = swingsAt(hl([[10, 5], [11, 6], [20, 1], [12, 6], [11, 5]]), Q);
    expect(swings.map((s) => [s.kind, s.price.toString()])).toEqual([
      ['HIGH', '20'],
      ['LOW', '1'],
    ]);
  });
});

describe('findSwings', () => {
  it('reports each swing once, in the order the swings become known', () => {
    const candles = hl([[10, 5], [11, 6], [15, 7], [12, 4], [11, 5], [13, 6], [16, 8], [14, 7], [13, 6]]);
    expect(findSwings(candles, 2, Q).map((s) => [s.kind, s.time / Q, s.knownAt / Q])).toEqual([
      ['HIGH', 2, 5],
      ['LOW', 3, 6],
      ['HIGH', 6, 9],
    ]);
  });

  it('never changes an answer when later candles arrive', () => {
    // A seeded random walk, so the test cannot pass by accident.
    let seed = 7;
    const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let price = 100;
    const candles = Array.from({ length: 300 }, (_, i) => {
      const open = price;
      price += (next() - 0.5) * 4;
      return bar(i * Q, open, Math.max(open, price) + next(), Math.min(open, price) - next(), price);
    });
    const all = findSwings(candles, 2, Q);
    for (let end = 5; end <= candles.length; end += 17) {
      const knownBy = candles[end - 1]!.time + Q;
      expect(findSwings(candles.slice(0, end), 2, Q)).toEqual(all.filter((s) => s.knownAt <= knownBy));
    }
  });
});
```

`tests/strategy/structure.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { structureIsUp } from '../../src/strategy/structure.js';

const d = (...values: number[]) => values.map((value) => new Decimal(value));
const close = (value: number) => new Decimal(value);

describe('structureIsUp', () => {
  it('is up when the last two highs rise, the last two lows rise, and the close holds above the last low', () => {
    expect(structureIsUp(d(100, 110), d(90, 95), close(100))).toBe(true);
  });

  it('uses only the last two of each', () => {
    expect(structureIsUp(d(200, 100, 110), d(300, 90, 95), close(100))).toBe(true);
  });

  it('is not up when the highs do not rise, or the lows fall', () => {
    expect(structureIsUp(d(110, 110), d(90, 95), close(100))).toBe(false);
    expect(structureIsUp(d(100, 110), d(95, 90), close(100))).toBe(false);
  });

  it('is not up once a close is at or below the last swing low, before a lower low is confirmed', () => {
    expect(structureIsUp(d(100, 110), d(90, 95), close(95))).toBe(false);
  });

  it('is not up with too few swings, or before any 4-hour close', () => {
    expect(structureIsUp(d(110), d(90, 95), close(100))).toBe(false);
    expect(structureIsUp(d(100, 110), d(95), close(100))).toBe(false);
    expect(structureIsUp(d(100, 110), d(90, 95), null)).toBe(false);
  });
});
```

`tests/strategy/purity.test.ts`:

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
      expect(source, `${file} reads a clock, randomness or the process`).not.toMatch(/Date\.now|new Date\(|Math\.random|process\./);
    }
  });
});
```

- [ ] **Step 3: Run them to see them fail.**
  Run: `npx vitest run tests/strategy/`
  Expected: FAIL. The three modules do not exist yet. The purity test already passes on the
  existing files.

- [ ] **Step 4: Write `src/strategy/bars.ts`.**

```ts
import type { Candle } from '../types.js';

export const QUARTER_HOUR_MS = 900_000;
export const FOUR_HOURS_MS = 14_400_000;
export const DAY_MS = 86_400_000;

/** The start of the UTC block a moment falls in: 4-hour blocks start at 00:00, 04:00 and so on; days at 00:00. */
export function blockStart(time: number, blockMs: number): number {
  return time - (time % blockMs);
}

/** One candle from consecutive ones: the first open, the highest high, the lowest low, the last close, and their total volume. */
export function combine(candles: Candle[]): Candle {
  const first = candles[0];
  if (first === undefined) {
    throw new Error('combine needs at least one candle');
  }
  let { high, low, volume } = first;
  for (const candle of candles.slice(1)) {
    if (candle.high.gt(high)) {
      high = candle.high;
    }
    if (candle.low.lt(low)) {
      low = candle.low;
    }
    volume = volume.plus(candle.volume);
  }
  return { time: first.time, open: first.open, high, low, close: candles[candles.length - 1]!.close, volume };
}

/**
 * Builds 4-hour or daily candles from 15-minute ones (R1), on UTC boundaries. A
 * block is kept only when every one of its 15-minute candles is present, so a
 * missing candle can never make a longer candle with a false high or low.
 */
export function aggregate(candles: Candle[], blockMs: number): Candle[] {
  const perBlock = blockMs / QUARTER_HOUR_MS;
  const blocks: Candle[] = [];
  let current: Candle[] = [];
  const flush = () => {
    const first = current[0];
    if (first !== undefined && current.length === perBlock && first.time === blockStart(first.time, blockMs)) {
      blocks.push(combine(current));
    }
    current = [];
  };
  for (const candle of candles) {
    const first = current[0];
    if (first !== undefined && blockStart(first.time, blockMs) !== blockStart(candle.time, blockMs)) {
      flush();
    }
    current.push(candle);
  }
  flush();
  return blocks;
}
```

- [ ] **Step 5: Write `src/strategy/swings.ts`.**

```ts
import type Decimal from 'decimal.js';
import type { Candle } from '../types.js';

export type Swing = {
  kind: 'HIGH' | 'LOW';
  /** Open time of the swing candle. */
  time: number;
  price: Decimal;
  /** Close time of the candle that confirmed it: the first moment the rules may use it (R2). */
  knownAt: number;
};

/**
 * The swings confirmed at the middle of a window of 2k+1 consecutive candles
 * (R2). A candle is a swing high when its high is strictly above the highs of
 * the k candles before it and the k after it; a tie with any of them makes no
 * swing. Swing lows mirror this. A swing is known only when the window's last
 * candle closes; counting it earlier is hindsight.
 */
export function swingsAt(window: Candle[], intervalMs: number): Swing[] {
  if (window.length < 3 || window.length % 2 === 0) {
    throw new Error('a swing window needs an odd number of candles, at least 3');
  }
  const middle = (window.length - 1) / 2;
  const candidate = window[middle]!;
  const others = window.filter((_, i) => i !== middle);
  const knownAt = window[window.length - 1]!.time + intervalMs;
  const swings: Swing[] = [];
  if (others.every((candle) => candidate.high.gt(candle.high))) {
    swings.push({ kind: 'HIGH', time: candidate.time, price: candidate.high, knownAt });
  }
  if (others.every((candle) => candidate.low.lt(candle.low))) {
    swings.push({ kind: 'LOW', time: candidate.time, price: candidate.low, knownAt });
  }
  return swings;
}

/** Every swing in a series, in the order they become known. For tests and reports; the strategy finds them one window at a time. */
export function findSwings(candles: Candle[], size: number, intervalMs: number): Swing[] {
  const width = 2 * size + 1;
  const swings: Swing[] = [];
  for (let end = width; end <= candles.length; end++) {
    swings.push(...swingsAt(candles.slice(end - width, end), intervalMs));
  }
  return swings;
}
```

- [ ] **Step 6: Write `src/strategy/structure.ts`.**

```ts
import type Decimal from 'decimal.js';

/**
 * R3: the 4-hour structure is up when the last two swing highs rise, the last
 * two swing lows rise, and the latest 4-hour close is above the latest swing
 * low. Anything else is not up, including too few swings yet. The last
 * condition ends an uptrend at the first close below its last higher low,
 * instead of about eight hours later when the lower low is confirmed.
 */
export function structureIsUp(highs: Decimal[], lows: Decimal[], lastClose: Decimal | null): boolean {
  if (highs.length < 2 || lows.length < 2 || lastClose === null) {
    return false;
  }
  const [high1, high2] = highs.slice(-2) as [Decimal, Decimal];
  const [low1, low2] = lows.slice(-2) as [Decimal, Decimal];
  return high2.gt(high1) && low2.gt(low1) && lastClose.gt(low2);
}
```

- [ ] **Step 7: Update the purity rule.** In `CLAUDE.md`, under *Rules that are not negotiable*,
  replace "`src/strategy/` must import nothing except `../math.js` and `../types.js`." with:
  "`src/strategy/` must import nothing except `../math.js`, `../types.js`, `decimal.js` and its own
  files, and never read a clock or randomness; `tests/strategy/purity.test.ts` enforces it."

- [ ] **Step 8: Run the tests, type-check, and run the full suite.**
  Run: `npx vitest run tests/strategy/`, then `npm run typecheck`, then `npm test`.
  Expected: all pass.

- [ ] **Step 9: Ship.** Branch `liquidity/swings-structure`. Title: *research: build 4-hour and
  daily candles, swings and structure for the liquidity sweep*.

---

### Task 3: The strategy, version 0

**Files:**
- Create: `src/strategy/liquiditySweep.ts`, `tests/helpers/liquidity.ts`,
  `tests/strategy/liquiditySweep.test.ts`

- [ ] **Step 1: The scenario helper.** Create `tests/helpers/liquidity.ts`:

```ts
import Decimal from 'decimal.js';
import { DAY_MS, FOUR_HOURS_MS, QUARTER_HOUR_MS } from '../../src/strategy/bars.js';
import type { Candle } from '../../src/types.js';

/** 00:00 UTC on the first day of every scenario. */
export const START = Date.parse('2024-03-01T00:00:00Z');
/** Day 4, the day the scenarios test. */
export const DAY4 = START + 3 * DAY_MS;
/** The nth 15-minute candle of day 4. */
export const day4 = (n: number) => DAY4 + n * QUARTER_HOUR_MS;
/** Prices are scaled like BTC's, so one price step is small beside them. */
const SCALE = 1000;

export function candle(time: number, open: number, high: number, low: number, close: number): Candle {
  return {
    time,
    open: new Decimal(open),
    high: new Decimal(high),
    low: new Decimal(low),
    close: new Decimal(close),
    volume: new Decimal(1),
  };
}

/** Sixteen 15-minute candles making one 4-hour candle with exactly these prices: open, up to the high, down to the low, then to the close. */
export function fourHours(start: number, open: number, high: number, low: number, close: number): Candle[] {
  const anchors: Array<[number, number]> = [
    [0, open],
    [4, high],
    [10, low],
    [16, close],
  ];
  const at = (point: number): number => {
    for (let k = 1; k < anchors.length; k++) {
      const [x0, y0] = anchors[k - 1]!;
      const [x1, y1] = anchors[k]!;
      if (point <= x1) {
        return y0 + ((y1 - y0) * (point - x0)) / (x1 - x0);
      }
    }
    return close;
  };
  return Array.from({ length: 16 }, (_, j) => {
    const from = at(j);
    const to = at(j + 1);
    return candle(start + j * QUARTER_HOUR_MS, from, Math.max(from, to), Math.min(from, to), to);
  });
}

/**
 * Three complete UTC days in a clear 4-hour zigzag, eighteen 4-hour candles.
 * Rising: swing highs 107k, 109k, 111k and 113k, and swing lows 101k, 103k and
 * 105k, so the structure is up; day 3's low, 105k, is the level on day 4; the
 * last close is 111k. Falling mirrors it: the structure is not up, the level is
 * 187k, and the last close is 189k.
 */
export function zigzagDays(direction: 'up' | 'down', start = START): Candle[] {
  const sign = direction === 'up' ? 1 : -1;
  const mids = [direction === 'up' ? 100 : 200];
  const steps = [3, 3, -2, -2].map((step) => step * sign);
  for (let i = 1; i < 18; i++) {
    mids.push(mids[i - 1]! + steps[(i - 1) % 4]!);
  }
  const peaks = new Set(direction === 'up' ? [2, 6, 10, 14] : [4, 8, 12, 16]);
  const troughs = new Set(direction === 'up' ? [4, 8, 12, 16] : [2, 6, 10, 14]);
  return mids.flatMap((close, i) => {
    const open = i === 0 ? close : mids[i - 1]!;
    const high = Math.max(open, close) + (peaks.has(i) ? 1 : 0.25);
    const low = Math.min(open, close) - (troughs.has(i) ? 1 : 0.25);
    return fourHours(start + i * FOUR_HOURS_MS, open * SCALE, high * SCALE, low * SCALE, close * SCALE);
  });
}

/** Day 4 before the sweep: a 15-minute swing high of 114k at 00:15, known from 01:00. */
export function beforeSweep(): Candle[] {
  return [
    candle(day4(0), 111_000, 111_500, 110_500, 111_200),
    candle(day4(1), 111_200, 114_000, 111_000, 113_000),
    candle(day4(2), 113_000, 113_500, 112_000, 112_500),
    candle(day4(3), 112_500, 112_800, 111_500, 112_000),
  ];
}

/** 01:00 on day 4: the day's first touch below 105k, closing back above it. */
export const sweepCandle = () => candle(day4(4), 112_000, 112_200, 104_000, 110_000);

/** 01:15: a close above the 114k reference. */
export const confirmationCandle = () => candle(day4(5), 110_000, 115_000, 109_000, 114_500);

/** The rising days, then day 4 through the confirmation: version 0 enters at the 01:30 open. */
export function enteringScenario(): Candle[] {
  return [...zigzagDays('up'), ...beforeSweep(), sweepCandle(), confirmationCandle()];
}
```

- [ ] **Step 2: Write the failing tests.** `tests/strategy/liquiditySweep.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { DAY_MS, QUARTER_HOUR_MS } from '../../src/strategy/bars.js';
import { createLiquiditySweep, VERSION_0, type SweepEvent } from '../../src/strategy/liquiditySweep.js';
import type { Candle } from '../../src/types.js';
import {
  beforeSweep,
  candle,
  confirmationCandle,
  day4,
  DAY4,
  enteringScenario,
  START,
  sweepCandle,
  zigzagDays,
} from '../helpers/liquidity.js';

/** Feeds candles in order, flat except at the given open times, and returns every event. */
function run(candles: Candle[], config = VERSION_0, notFlatAt = new Set<number>()): SweepEvent[] {
  const strategy = createLiquiditySweep(config);
  return candles.flatMap((c) => strategy.onCandle({ candle: c, flatAtOpen: !notFlatAt.has(c.time) }));
}

/** Each event as [kind, reason?] for compact expectations. */
const kinds = (events: SweepEvent[]) => events.map((e) => ('reason' in e ? [e.kind, e.reason] : [e.kind]));
const quiet = (n: number) => candle(day4(n), 110_000, 111_000, 109_000, 110_000);

describe('the liquidity sweep, version 0', () => {
  it('arms on the day\'s first touch that closes back above the level, and enters on a close above the reference', () => {
    const events = run(enteringScenario());
    expect(kinds(events)).toEqual([['ARMED'], ['ENTER']]);
    const [armed, enter] = events as [Extract<SweepEvent, { kind: 'ARMED' }>, Extract<SweepEvent, { kind: 'ENTER' }>];
    expect(armed.time).toBe(day4(4));
    expect([armed.level, armed.sweepLow, armed.reference, armed.stopTrigger].map(String)).toEqual([
      '105000',
      '104000',
      '114000',
      '103999.9',
    ]);
    expect(enter.time).toBe(day4(5));
    expect([enter.confirmationClose, enter.stopTrigger, enter.plannedRisk].map(String)).toEqual([
      '114500',
      '103999.9',
      '10500.1',
    ]);
  });

  it('ends the day when its first touch closes at or below the level, even if a later candle reclaims it', () => {
    const broke = candle(day4(4), 112_000, 112_200, 104_000, 104_800);
    const reclaim = candle(day4(5), 104_800, 108_000, 103_000, 107_000);
    expect(kinds(run([...zigzagDays('up'), ...beforeSweep(), broke, reclaim]))).toEqual([['LEVEL_BROKE']]);
  });

  it('spends the day\'s touch when the account is in a trade', () => {
    const later = candle(day4(6), 110_000, 111_000, 103_500, 110_500);
    const events = run([...zigzagDays('up'), ...beforeSweep(), sweepCandle(), quiet(5), later], VERSION_0, new Set([day4(4)]));
    expect(kinds(events)).toEqual([['NOT_ARMED', 'NOT_FLAT']]);
  });

  it('will not arm without an up structure, and spends the touch anyway', () => {
    // Falling days break their own levels on days 2 and 3; only day 4 is under test here.
    const sweep = candle(day4(0), 189_000, 189_500, 186_000, 188_000);
    const again = candle(day4(1), 188_000, 188_500, 185_000, 188_200);
    const onDay4 = run([...zigzagDays('down'), sweep, again]).filter((e) => e.time >= DAY4);
    expect(kinds(onDay4)).toEqual([['NOT_ARMED', 'STRUCTURE_NOT_UP']]);
  });

  it('will not arm without a known swing high above the sweep close', () => {
    const above = candle(day4(4), 112_000, 115_000, 104_000, 114_500);
    expect(kinds(run([...zigzagDays('up'), ...beforeSweep(), above]))).toEqual([['NOT_ARMED', 'NO_REFERENCE']]);
  });

  it('never takes as its reference a swing that the sweep candle itself confirms', () => {
    // 00:30 is the highest candle so far, and the sweep at 01:00 would be its second candle after: the swing is confirmed only at the sweep's close.
    const early = [
      candle(day4(0), 111_000, 111_500, 110_500, 111_200),
      candle(day4(1), 111_200, 111_600, 111_000, 111_400),
      candle(day4(2), 111_400, 114_000, 111_200, 112_500),
      candle(day4(3), 112_500, 112_800, 111_500, 112_000),
    ];
    const sweep = candle(day4(4), 112_000, 112_200, 104_000, 113_000);
    expect(kinds(run([...zigzagDays('up'), ...early, sweep]))).toEqual([['NOT_ARMED', 'NO_REFERENCE']]);
  });

  it('discards the setup when the sweep low breaks, even on a candle that also confirms', () => {
    const both = candle(day4(5), 110_000, 115_000, 103_500, 114_500);
    expect(kinds(run([...zigzagDays('up'), ...beforeSweep(), sweepCandle(), both]))).toEqual([
      ['ARMED'],
      ['DISCARDED', 'SWEEP_LOW_BROKEN'],
    ]);
  });

  it('expires after eight closes without confirmation', () => {
    const waiting = [5, 6, 7, 8, 9, 10, 11, 12].map(quiet);
    const events = run([...zigzagDays('up'), ...beforeSweep(), sweepCandle(), ...waiting]);
    expect(kinds(events)).toEqual([['ARMED'], ['DISCARDED', 'EXPIRED']]);
    expect(events[1]!.time).toBe(day4(12));
  });

  it('still confirms on the eighth close', () => {
    const waiting = [5, 6, 7, 8, 9, 10, 11].map(quiet);
    const eighth = candle(day4(12), 110_000, 115_000, 109_000, 114_500);
    const events = run([...zigzagDays('up'), ...beforeSweep(), sweepCandle(), ...waiting, eighth]);
    expect(kinds(events)).toEqual([['ARMED'], ['ENTER']]);
  });

  it('skips an entry whose stop is under 0.6% away', () => {
    const descent = [
      candle(day4(0), 111_000, 111_100, 108_900, 109_000),
      candle(day4(1), 109_000, 109_100, 106_900, 107_000),
      candle(day4(2), 107_000, 107_100, 105_200, 105_300),
      candle(day4(3), 105_300, 105_350, 105_150, 105_250),
      candle(day4(4), 105_250, 105_320, 105_200, 105_280),
      candle(day4(5), 105_280, 105_400, 105_250, 105_300),
      candle(day4(6), 105_300, 105_350, 105_150, 105_250),
      candle(day4(7), 105_250, 105_300, 105_100, 105_200),
    ];
    const sweep = candle(day4(8), 105_200, 105_300, 104_990, 105_100);
    const confirm = candle(day4(9), 105_100, 105_500, 105_050, 105_450);
    expect(kinds(run([...zigzagDays('up'), ...descent, sweep, confirm]))).toEqual([
      ['ARMED'],
      ['DISCARDED', 'STOP_TOO_CLOSE'],
    ]);
  });

  it('keeps a waiting setup across midnight, and spends the new day\'s first touch without arming', () => {
    // Arm at 23:30 on day 4: the level is day 3's low. Day 5's level is day 4's low, the sweep's 104k.
    const lateDay4: Candle[] = [];
    for (let n = 0; n < 90; n++) {
      lateDay4.push(candle(day4(n), 111_000, 111_300, 110_700, 111_000));
    }
    lateDay4.push(candle(day4(90), 111_000, 114_000, 110_800, 113_000));
    lateDay4.push(candle(day4(91), 113_000, 113_200, 110_900, 111_200));
    lateDay4.push(candle(day4(92), 111_200, 111_400, 110_800, 111_000));
    lateDay4.push(candle(day4(93), 111_000, 111_300, 110_700, 111_000));
    lateDay4.push(candle(day4(94), 111_000, 111_100, 104_000, 110_000));
    lateDay4.push(candle(day4(95), 110_000, 111_000, 109_000, 110_500));
    const day5 = [
      candle(day4(96), 110_500, 111_000, 103_900, 110_000),
      candle(day4(97), 110_000, 114_600, 109_000, 114_500),
    ];
    const events = run([...zigzagDays('up'), ...lateDay4, ...day5]);
    expect(kinds(events)).toEqual([['ARMED'], ['DISCARDED', 'SWEEP_LOW_BROKEN'], ['NOT_ARMED', 'SETUP_WAITING']]);
  });

  it('starts again after a missing candle, so a day with a gap sets no level', () => {
    const days = zigzagDays('up');
    const gapped = days.filter((c) => c.time !== START + 2 * DAY_MS + 40 * QUARTER_HOUR_MS);
    expect(kinds(run([...gapped, ...beforeSweep(), sweepCandle(), confirmationCandle()]))).toEqual([['RESTARTED']]);
  });

  it('refuses candles out of order', () => {
    const strategy = createLiquiditySweep(VERSION_0);
    const [first, second] = zigzagDays('up');
    strategy.onCandle({ candle: second!, flatAtOpen: true });
    expect(() => strategy.onCandle({ candle: first!, flatAtOpen: true })).toThrow('out of order');
  });

  it('places the stop by ATR in the ATR neighbour', () => {
    const candles = enteringScenario();
    const events = run(candles, { ...VERSION_0, stopAtrMultiple: new Decimal('0.25') });
    const armed = events[0] as Extract<SweepEvent, { kind: 'ARMED' }>;
    // Wilder's 14-candle ATR over every candle before the sweep, computed independently here.
    const before = candles.filter((c) => c.time < day4(4));
    let atr = new Decimal(0);
    const ranges: Decimal[] = [];
    for (let i = 0; i < before.length; i++) {
      const c = before[i]!;
      const previous = before[i - 1];
      const range =
        previous === undefined
          ? c.high.minus(c.low)
          : Decimal.max(c.high.minus(c.low), c.high.minus(previous.close).abs(), c.low.minus(previous.close).abs());
      if (ranges.length < 14) {
        ranges.push(range);
        if (ranges.length === 14) {
          atr = ranges.reduce((total, r) => total.plus(r), new Decimal(0)).div(14);
        }
      } else {
        atr = atr.times(13).plus(range).div(14);
      }
    }
    expect(armed.stopTrigger.toString()).toBe(new Decimal(104_000).minus(new Decimal('0.25').times(atr)).toString());
  });

  it('reports its structure and level', () => {
    const strategy = createLiquiditySweep(VERSION_0);
    for (const c of zigzagDays('up')) {
      strategy.onCandle({ candle: c, flatAtOpen: true });
    }
    expect(strategy.status().structureUp).toBe(true);
    strategy.onCandle({ candle: beforeSweep()[0]!, flatAtOpen: true });
    expect(strategy.status().level?.toString()).toBe('105000');
  });
});
```

The midnight test arms at 23:30 on day 4 (candle 94). 23:45 is its first waiting close. Day 5's
first candle, 00:00, trades below the sweep low: that discards the setup, and it is also day 5's
first touch below its level. Day 5's level is day 4's low, 104k, and that candle's low is 103.9k.
A setup was waiting at that candle's open, so the touch is spent: `SETUP_WAITING`. The 00:15
candle would have confirmed, but by then no setup exists and the day's touch is spent, so it adds
no event.

- [ ] **Step 3: Run them to see them fail.**
  Run: `npx vitest run tests/strategy/liquiditySweep.test.ts`
  Expected: FAIL. `src/strategy/liquiditySweep.ts` does not exist.

- [ ] **Step 4: Write `src/strategy/liquiditySweep.ts`.**

```ts
import Decimal from 'decimal.js';
import type { Candle } from '../types.js';
import { combine, DAY_MS, FOUR_HOURS_MS, QUARTER_HOUR_MS } from './bars.js';
import { structureIsUp } from './structure.js';
import { swingsAt, type Swing } from './swings.js';

/**
 * The liquidity-sweep research candidate, version 0: rules R1 to R13 of
 * docs/research/liquidity-sweep-candidate.md (branch product-prototype, commit
 * a079748). Research only; nothing trades it.
 *
 * Fed completed 15-minute candles one at a time, oldest first, it says what it
 * saw: a level broken, a setup armed or discarded, an entry to make at the next
 * open. It keeps its own history, rebuilt by replaying candles, so the same
 * candles always give the same events. Exits (R9) and size (R10) are the
 * executor's; their settings live here with the rest of the version.
 */

export type LiquiditySweepConfig = {
  /** R2: candles on each side of a swing, on both timeframes. */
  swingSize: number;
  /** R7: closes a setup waits for confirmation. */
  waitCandles: number;
  /** R8: skip an entry whose planned risk is below this share of the confirmation close. */
  minRiskFraction: Decimal;
  /** R9: how far below the sweep low the stop triggers: one exchange price step. */
  priceStep: Decimal;
  /** A neighbour only: place the stop this many 14-candle ATRs below the sweep low instead. */
  stopAtrMultiple: Decimal | null;
  /** R9: the target, in multiples of the entry fill's distance to its stop. */
  targetMultiple: Decimal;
  /** R9: completed candles, counting the entry candle, before the time exit. */
  timeLimitCandles: number;
};

/** Version 0, fixed before any data was examined. */
export const VERSION_0: LiquiditySweepConfig = {
  swingSize: 2,
  waitCandles: 8,
  minRiskFraction: new Decimal('0.006'),
  priceStep: new Decimal('0.1'),
  stopAtrMultiple: null,
  targetMultiple: new Decimal(2),
  timeLimitCandles: 32,
};

export type NotArmed = 'NOT_FLAT' | 'SETUP_WAITING' | 'STRUCTURE_NOT_UP' | 'NO_REFERENCE' | 'NO_ATR';
export type Discarded = 'SWEEP_LOW_BROKEN' | 'STRUCTURE_TURNED' | 'EXPIRED' | 'STOP_TOO_CLOSE';

export type SweepEvent =
  | { kind: 'RESTARTED'; time: number }
  | { kind: 'LEVEL_BROKE'; time: number; level: Decimal }
  | { kind: 'NOT_ARMED'; time: number; reason: NotArmed }
  | { kind: 'ARMED'; time: number; level: Decimal; sweepLow: Decimal; reference: Decimal; stopTrigger: Decimal }
  | { kind: 'DISCARDED'; time: number; reason: Discarded }
  | { kind: 'ENTER'; time: number; confirmationClose: Decimal; stopTrigger: Decimal; plannedRisk: Decimal };

export type EnterEvent = Extract<SweepEvent, { kind: 'ENTER' }>;

export type CandleInput = {
  candle: Candle;
  /** The account held no trade once this candle's opening actions were done (R13). */
  flatAtOpen: boolean;
};

export type SweepStatus = { structureUp: boolean; level: Decimal | null };

export type LiquiditySweep = {
  onCandle(input: CandleInput): SweepEvent[];
  /** Where things stand after the last candle: where a placebo may enter at the next open. */
  status(): SweepStatus;
};

const ATR_PERIOD = 14;
const CANDLES_PER_DAY = DAY_MS / QUARTER_HOUR_MS;
const CANDLES_PER_FOUR_HOURS = FOUR_HOURS_MS / QUARTER_HOUR_MS;

type Setup = { level: Decimal; sweepLow: Decimal; reference: Decimal; stopTrigger: Decimal; closes: number };

type History = {
  last: Candle | null;
  recent15: Candle[];
  /** Known 15-minute swing highs, each lower than the one before: no other can be the most recent one above a price. */
  highs15: Swing[];
  block4: Candle[];
  recent4: Candle[];
  highs4: Decimal[];
  lows4: Decimal[];
  close4: Decimal | null;
  dayLow: Decimal | null;
  dayCount: number;
  level: Decimal | null;
  touched: boolean;
  setup: Setup | null;
  ranges: Decimal[];
  atr: Decimal | null;
};

const fresh = (): History => ({
  last: null,
  recent15: [],
  highs15: [],
  block4: [],
  recent4: [],
  highs4: [],
  lows4: [],
  close4: null,
  dayLow: null,
  dayCount: 0,
  level: null,
  touched: false,
  setup: null,
  ranges: [],
  atr: null,
});

export function createLiquiditySweep(config: LiquiditySweepConfig): LiquiditySweep {
  const width = 2 * config.swingSize + 1;
  let h = fresh();
  const structureUp = () => structureIsUp(h.highs4, h.lows4, h.close4);

  return {
    status: () => ({ structureUp: structureUp(), level: h.level }),

    onCandle({ candle, flatAtOpen }: CandleInput): SweepEvent[] {
      const events: SweepEvent[] = [];
      if (candle.time % QUARTER_HOUR_MS !== 0) {
        throw new Error(`not on a 15-minute boundary: ${candle.time}`);
      }
      if (h.last !== null && candle.time <= h.last.time) {
        throw new Error(`candles out of order at ${candle.time}`);
      }
      if (h.last !== null && candle.time !== h.last.time + QUARTER_HOUR_MS) {
        // R13: after a missing candle every level and swing is in doubt, so start again.
        h = fresh();
        events.push({ kind: 'RESTARTED', time: candle.time });
      }
      const previousClose = h.last?.close ?? null;

      // R4: at 00:00 UTC, yesterday's low becomes the level if yesterday was complete.
      if (candle.time % DAY_MS === 0) {
        h.level = h.dayCount === CANDLES_PER_DAY ? h.dayLow : null;
        h.dayLow = null;
        h.dayCount = 0;
        h.touched = false;
      }
      h.dayLow = h.dayLow === null || candle.low.lt(h.dayLow) ? candle.low : h.dayLow;
      h.dayCount += 1;

      // R1–R3: a 4-hour candle completing at this close, and any swing it confirms.
      h.block4.push(candle);
      if ((candle.time + QUARTER_HOUR_MS) % FOUR_HOURS_MS === 0) {
        if (h.block4.length === CANDLES_PER_FOUR_HOURS) {
          const four = combine(h.block4);
          h.close4 = four.close;
          h.recent4 = [...h.recent4, four].slice(-width);
          if (h.recent4.length === width) {
            for (const swing of swingsAt(h.recent4, FOUR_HOURS_MS)) {
              if (swing.kind === 'HIGH') {
                h.highs4 = [...h.highs4, swing.price].slice(-2);
              } else {
                h.lows4 = [...h.lows4, swing.price].slice(-2);
              }
            }
          }
        }
        h.block4 = [];
      }
      const up = structureUp();

      // R7: a setup waiting for confirmation. Discards come before the confirmation.
      const waiting = h.setup;
      if (waiting !== null) {
        waiting.closes += 1;
        h.setup = null;
        if (candle.low.lt(waiting.sweepLow)) {
          events.push({ kind: 'DISCARDED', time: candle.time, reason: 'SWEEP_LOW_BROKEN' });
        } else if (!up) {
          events.push({ kind: 'DISCARDED', time: candle.time, reason: 'STRUCTURE_TURNED' });
        } else if (candle.close.gt(waiting.reference)) {
          const plannedRisk = candle.close.minus(waiting.stopTrigger);
          if (plannedRisk.lt(candle.close.times(config.minRiskFraction))) {
            events.push({ kind: 'DISCARDED', time: candle.time, reason: 'STOP_TOO_CLOSE' });
          } else {
            events.push({
              kind: 'ENTER',
              time: candle.time,
              confirmationClose: candle.close,
              stopTrigger: waiting.stopTrigger,
              plannedRisk,
            });
          }
        } else if (waiting.closes >= config.waitCandles) {
          events.push({ kind: 'DISCARDED', time: candle.time, reason: 'EXPIRED' });
        } else {
          h.setup = waiting;
        }
      }

      // R5, R6: the day's first touch of the level, spent whether or not it arms.
      if (h.level !== null && !h.touched && candle.low.lt(h.level)) {
        h.touched = true;
        if (candle.close.lte(h.level)) {
          events.push({ kind: 'LEVEL_BROKE', time: candle.time, level: h.level });
        } else {
          const reference = [...h.highs15].reverse().find((swing) => swing.price.gt(candle.close));
          const reason: NotArmed | null = !flatAtOpen
            ? 'NOT_FLAT'
            : waiting !== null
              ? 'SETUP_WAITING'
              : !up
                ? 'STRUCTURE_NOT_UP'
                : reference === undefined
                  ? 'NO_REFERENCE'
                  : config.stopAtrMultiple !== null && h.atr === null
                    ? 'NO_ATR'
                    : null;
          if (reason !== null) {
            events.push({ kind: 'NOT_ARMED', time: candle.time, reason });
          } else {
            const buffer = config.stopAtrMultiple === null ? config.priceStep : config.stopAtrMultiple.times(h.atr!);
            const setup: Setup = {
              level: h.level,
              sweepLow: candle.low,
              reference: reference!.price,
              stopTrigger: candle.low.minus(buffer),
              closes: 0,
            };
            h.setup = setup;
            events.push({
              kind: 'ARMED',
              time: candle.time,
              level: setup.level,
              sweepLow: setup.sweepLow,
              reference: setup.reference,
              stopTrigger: setup.stopTrigger,
            });
          }
        }
      }

      // Last, so that a swing this close confirms was not known when this candle opened (R6).
      h.recent15 = [...h.recent15, candle].slice(-width);
      if (h.recent15.length === width) {
        for (const swing of swingsAt(h.recent15, QUARTER_HOUR_MS)) {
          if (swing.kind === 'HIGH') {
            h.highs15 = [...h.highs15.filter((older) => older.price.gt(swing.price)), swing];
          }
        }
      }
      updateAtr(h, candle, previousClose);
      h.last = candle;
      return events;
    },
  };
}

/** Wilder's 14-candle average true range, for the ATR neighbour. */
function updateAtr(h: History, candle: Candle, previousClose: Decimal | null): void {
  const range = candle.high.minus(candle.low);
  const trueRange =
    previousClose === null
      ? range
      : Decimal.max(range, candle.high.minus(previousClose).abs(), candle.low.minus(previousClose).abs());
  if (h.atr === null) {
    h.ranges.push(trueRange);
    if (h.ranges.length === ATR_PERIOD) {
      h.atr = h.ranges.reduce((total, r) => total.plus(r), new Decimal(0)).div(ATR_PERIOD);
    }
  } else {
    h.atr = h.atr.times(ATR_PERIOD - 1).plus(trueRange).div(ATR_PERIOD);
  }
}
```

- [ ] **Step 5: Run the tests.**
  Run: `npx vitest run tests/strategy/`
  Expected: PASS. If a scenario test fails, check the scenario's arithmetic against the rules
  before changing the code; the rules come from the spec, and the scenarios were built by hand.

- [ ] **Step 6: Type-check and run the full suite,** then **ship.** Branch `liquidity/strategy`.
  Title: *research: the liquidity-sweep step function, version 0*. The description lists each
  rule's test, including every boundary in the spec's section 3a.

---

### Task 4: The backtester

**Files:**
- Create: `src/backtest/bracket.ts`, `tests/backtest/bracket.test.ts`

- [ ] **Step 1: Write the failing tests.** `tests/backtest/bracket.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { BTCUSDT_RULES, netR, RESEARCH_RISK, runBracketBacktest, simulateExit } from '../../src/backtest/bracket.js';
import { DEFAULT_COSTS } from '../../src/backtest/costs.js';
import { QUARTER_HOUR_MS } from '../../src/strategy/bars.js';
import { VERSION_0 } from '../../src/strategy/liquiditySweep.js';
import { candle, day4, DAY4, enteringScenario, START } from '../helpers/liquidity.js';

const c = (i: number, open: number, high: number, low: number, close: number) => candle(i * QUARTER_HOUR_MS, open, high, low, close);
const STOP = new Decimal(99);
const TARGET = new Decimal(104);

describe('simulateExit', () => {
  it('sells at the stop less slippage when a candle reaches it', () => {
    const exit = simulateExit([c(0, 100, 101, 99.5, 100.5), c(1, 100.5, 101, 98, 99)], 0, STOP, TARGET, 32, DEFAULT_COSTS);
    expect(exit).toMatchObject({ index: 1, reason: 'STOP', ambiguous: false });
    expect([exit.rawPrice, exit.price].map(String)).toEqual(['99', '98.9505']);
  });

  it('sells at the target less slippage', () => {
    const exit = simulateExit([c(0, 100, 101, 99.5, 100.5), c(1, 100.5, 104.5, 100, 104)], 0, STOP, TARGET, 32, DEFAULT_COSTS);
    expect(exit).toMatchObject({ index: 1, reason: 'TARGET' });
    expect(exit.price.toString()).toBe('103.948');
  });

  it('assumes the stop came first when one candle reaches both', () => {
    expect(simulateExit([c(0, 100, 105, 98, 101)], 0, STOP, TARGET, 32, DEFAULT_COSTS)).toMatchObject({
      index: 0,
      reason: 'STOP',
      ambiguous: true,
    });
  });

  it('sells at the open when a candle opens below the stop', () => {
    const exit = simulateExit([c(0, 100, 101, 99.5, 100.5), c(1, 97, 98, 96, 97.5)], 0, STOP, TARGET, 32, DEFAULT_COSTS);
    expect(exit.price.toString()).toBe('96.9515');
  });

  it('sells at the open after the time limit', () => {
    const flat = Array.from({ length: 5 }, (_, i) => c(i, 100, 100.5, 99.5, 100));
    const exit = simulateExit(flat, 0, STOP, TARGET, 3, DEFAULT_COSTS);
    expect(exit).toMatchObject({ index: 3, reason: 'TIME' });
    expect(exit.price.toString()).toBe('99.95');
  });

  it('after a missing candle, takes the worse of the next open and the stop', () => {
    const exit = simulateExit([c(0, 100, 101, 99.5, 100.5), c(3, 100, 100.5, 98.5, 99)], 0, STOP, TARGET, 32, DEFAULT_COSTS);
    expect(exit).toMatchObject({ index: 1, reason: 'GAP' });
    expect(exit.price.toString()).toBe('98.9505');
  });

  it('closes at the last close when the candles end first', () => {
    const exit = simulateExit([c(0, 100, 101, 99.5, 100.5), c(1, 100.5, 101, 100, 100.8)], 0, STOP, TARGET, 32, DEFAULT_COSTS);
    expect(exit).toMatchObject({ index: 1, reason: 'END' });
  });
});

describe('netR', () => {
  it('is the profit per BTC after both fees, over the planned risk', () => {
    expect(netR(new Decimal(100), new Decimal(102), new Decimal('0.001'), new Decimal(1)).toString()).toBe('1.798');
  });
});

describe('runBracketBacktest', () => {
  const entry = candle(day4(6), 114_500, 115_000, 113_000, 113_500);
  const stopped = candle(day4(7), 113_500, 113_600, 103_000, 104_500);
  const options = (capital: number, evaluateFrom = START) => ({
    config: VERSION_0,
    costs: DEFAULT_COSTS,
    capital: new Decimal(capital),
    riskFraction: RESEARCH_RISK,
    rules: BTCUSDT_RULES,
    evaluateFrom,
  });

  it('enters at the next open, sizes to 0.25% risk, and measures the stop-out in planned risk', () => {
    const run = runBracketBacktest([...enteringScenario(), entry, stopped], options(10_000));
    expect(run.trades).toHaveLength(1);
    const [trade] = run.trades;
    expect(trade).toMatchObject({ entryTime: day4(6), exitTime: day4(7) });
    expect(trade!.exit.reason).toBe('STOP');
    expect(trade!.entryPrice.toString()).toBe('114557.25');
    expect(trade!.quantity.toString()).toBe('0.002308');
    expect(trade!.r.toFixed(4)).toBe('-1.0312');
    expect(trade!.grossR.toString()).toBe('-1');
    expect(trade!.pnl.toFixed(2)).toBe('-24.99');
  });

  it('starts no trade before the evaluation begins', () => {
    const run = runBacktest([...enteringScenario(), entry, stopped], DAY4 + 2 * 86_400_000);
    expect(run.trades).toEqual([]);
    expect(run.events).toEqual([]);
  });

  it('voids the entry when the candle after the confirmation is missing', () => {
    const run = runBracketBacktest([...enteringScenario(), stopped], options(10_000));
    expect(run.trades).toEqual([]);
    expect(run.skips).toEqual([{ time: day4(5), reason: 'MISSED_ENTRY' }]);
  });

  it('skips a buy under the exchange minimum', () => {
    const run = runBracketBacktest([...enteringScenario(), entry, stopped], options(100));
    expect(run.skips).toEqual([{ time: day4(5), reason: 'TOO_SMALL' }]);
  });

  it('skips an entry that opens at or below its stop', () => {
    const collapse = candle(day4(6), 103_000, 103_500, 102_000, 103_000);
    const run = runBracketBacktest([...enteringScenario(), collapse], options(10_000));
    expect(run.skips).toEqual([{ time: day4(5), reason: 'OPEN_AT_OR_BELOW_STOP' }]);
  });

  it('records placebo entries only after a close with the structure up and a level', () => {
    const candles = [...enteringScenario(), entry, stopped];
    const run = runBracketBacktest(candles, options(10_000));
    expect(run.placeboEntries.length).toBeGreaterThan(0);
    for (const index of run.placeboEntries) {
      expect(candles[index]!.time).toBeGreaterThan(START + 86_400_000);
    }
    expect(run.placeboEntries).toContain(candles.findIndex((x) => x.time === day4(6)));
  });

  it('marks equity at every evaluated close, holding while the trade is open', () => {
    const candles = [...enteringScenario(), entry, stopped];
    const run = runBracketBacktest(candles, options(10_000));
    expect(run.equity).toHaveLength(candles.length);
    expect(run.equity.find((mark) => mark.time === day4(6))!.holding).toBe(true);
    expect(run.equity.find((mark) => mark.time === day4(7))!.holding).toBe(false);
    expect(run.equity[run.equity.length - 1]!.equity.toFixed(2)).toBe('9975.01');
  });

  function runBacktest(candles: Parameters<typeof runBracketBacktest>[0], evaluateFrom: number) {
    return runBracketBacktest(candles, options(10_000, evaluateFrom));
  }
});
```

The expected figures, worked through:
- The entry fills at 114,500 × 1.0005 = **114,557.25**.
- Risk per BTC is (114,557.25 − 103,947.90005) + (114,557.25 + 103,947.90005) × 0.001 =
  10,827.85510005. Here 103,947.90005 is the stop trigger, 103,999.9, less slippage.
- The USDT to spend is 10,000 × 0.0025 ÷ 10,827.8551 × 114,557.25 ≈ 264.4966, which buys
  **0.002308** BTC at the fill.
- The stop sells at 103,947.90005. Net per BTC is −10,827.85510005, and over the planned risk of
  10,500.1 that is **−1.0312R**. Gross is exactly **−1R**.
- The P&L is 239.91175 − 0.23991 − 264.39813 − 0.26440 = **−24.99** USDT, so equity ends at
  **9,975.01**.

- [ ] **Step 2: Run them to see them fail.**
  Run: `npx vitest run tests/backtest/bracket.test.ts`
  Expected: FAIL. `src/backtest/bracket.ts` does not exist.

- [ ] **Step 3: Write `src/backtest/bracket.ts`.**

```ts
import Decimal from 'decimal.js';
import { roundDown } from '../math.js';
import { QUARTER_HOUR_MS } from '../strategy/bars.js';
import {
  createLiquiditySweep,
  type EnterEvent,
  type LiquiditySweepConfig,
  type SweepEvent,
} from '../strategy/liquiditySweep.js';
import type { Candle, CostModel } from '../types.js';

const ONE = new Decimal(1);

export type ExitReason = 'STOP' | 'TARGET' | 'TIME' | 'GAP' | 'END';

export type Exit = {
  /** The candle the exit happened on. */
  index: number;
  /** The price before slippage: the trigger, the target, an open or the last close. */
  rawPrice: Decimal;
  /** The fill, after slippage. */
  price: Decimal;
  reason: ExitReason;
  /** The candle also reached the target; the stop was taken to come first (R9). */
  ambiguous: boolean;
};

/**
 * R9: how a trade entered at candles[entryIndex]'s open ends. Every exit is a
 * market sell once triggered, so each pays slippage (R11). Checked on every
 * candle from the entry candle itself: a missing candle takes the worse of the
 * next open and the stop; the time limit sells at the open after the last
 * candle allowed; the stop sells at its trigger, or at the open if the candle
 * opened below it; the target sells at the target; a candle reaching both is a
 * stop, since a candle cannot say which came first; and candles that end first
 * sell at the last close.
 */
export function simulateExit(
  candles: Candle[],
  entryIndex: number,
  stopTrigger: Decimal,
  target: Decimal,
  timeLimitCandles: number,
  costs: CostModel,
): Exit {
  const exit = (index: number, rawPrice: Decimal, reason: ExitReason, ambiguous = false): Exit => ({
    index,
    rawPrice,
    price: rawPrice.times(ONE.minus(costs.slippageRate)),
    reason,
    ambiguous,
  });
  for (let i = entryIndex; i < candles.length; i++) {
    const candle = candles[i]!;
    if (i > entryIndex && candle.time !== candles[i - 1]!.time + QUARTER_HOUR_MS) {
      return exit(i, candle.low.lte(stopTrigger) ? Decimal.min(candle.open, stopTrigger) : candle.open, 'GAP');
    }
    if (i - entryIndex === timeLimitCandles) {
      return exit(i, candle.open, 'TIME');
    }
    const reached = candle.high.gte(target);
    if (candle.low.lte(stopTrigger)) {
      return exit(i, Decimal.min(candle.open, stopTrigger), 'STOP', reached);
    }
    if (reached) {
      return exit(i, target, 'TARGET');
    }
  }
  const last = candles.length - 1;
  return exit(last, candles[last]!.close, 'END');
}

/** Net R (spec section 3): profit per BTC after both fees, over the planned risk. Slippage is already in the prices. */
export function netR(entryPrice: Decimal, exitPrice: Decimal, feeRate: Decimal, plannedRisk: Decimal): Decimal {
  return exitPrice.minus(entryPrice).minus(entryPrice.plus(exitPrice).times(feeRate)).div(plannedRisk);
}

export type BracketTrade = {
  confirmationTime: number;
  confirmationClose: Decimal;
  entryIndex: number;
  entryTime: number;
  /** The entry candle's open, before slippage. */
  entryOpen: Decimal;
  /** The fill, after slippage. */
  entryPrice: Decimal;
  stopTrigger: Decimal;
  target: Decimal;
  plannedRisk: Decimal;
  quantity: Decimal;
  /** The account's value when the trade opened: it was flat, so this is its USDT. */
  equityAtEntry: Decimal;
  exit: Exit;
  exitTime: number;
  /** Net R: after fees and slippage. */
  r: Decimal;
  /** Gross R: the same trade before any cost. */
  grossR: Decimal;
  /** Net profit or loss in USDT. */
  pnl: Decimal;
};

export type SkipReason = 'MISSED_ENTRY' | 'TOO_SMALL' | 'OPEN_AT_OR_BELOW_STOP';
export type Skip = { time: number; reason: SkipReason };

export type ExchangeRules = { lotStep: Decimal; minOrderAmt: Decimal };

/** BTCUSDT on Bybit spot, from its instrument rules on 2026-09-23. */
export const BTCUSDT_RULES: ExchangeRules = { lotStep: new Decimal('0.000001'), minOrderAmt: new Decimal(5) };

/** R10: the research risk per trade, 0.25% of the account. Not a product decision. */
export const RESEARCH_RISK = new Decimal('0.0025');

export type BracketOptions = {
  config: LiquiditySweepConfig;
  costs: CostModel;
  capital: Decimal;
  riskFraction: Decimal;
  rules: ExchangeRules;
  /** Epoch ms. Earlier candles only warm the strategy up; no trade starts before this. */
  evaluateFrom: number;
};

export type EquityMark = { time: number; equity: Decimal; holding: boolean };

export type BracketRun = {
  trades: BracketTrade[];
  skips: Skip[];
  events: SweepEvent[];
  /** Candles at whose open a placebo may enter: each directly follows a close with the structure up and a level. */
  placeboEntries: number[];
  equity: EquityMark[];
};

/**
 * Runs a version over candles with a simulated account of `capital` USDT. At
 * each candle: a time or gap exit at the open, then an entry confirmed at the
 * last close, then a stop, target or end during the candle, then the strategy
 * sees the candle. Equity is marked at every evaluated close.
 */
export function runBracketBacktest(candles: Candle[], options: BracketOptions): BracketRun {
  const { costs } = options;
  const strategy = createLiquiditySweep(options.config);
  const run: BracketRun = { trades: [], skips: [], events: [], placeboEntries: [], equity: [] };
  let cash = options.capital;
  let open: BracketTrade | null = null;
  let pending: EnterEvent | null = null;

  const settle = (trade: BracketTrade) => {
    const proceeds = trade.quantity.times(trade.exit.price);
    cash = cash.plus(proceeds).minus(proceeds.times(costs.feeRate));
    run.trades.push(trade);
  };

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!;

    if (open !== null && open.exit.index === i && (open.exit.reason === 'TIME' || open.exit.reason === 'GAP')) {
      settle(open);
      open = null;
    }
    if (pending !== null) {
      const enter = pending;
      pending = null;
      if (candle.time !== enter.time + QUARTER_HOUR_MS) {
        run.skips.push({ time: enter.time, reason: 'MISSED_ENTRY' });
      } else {
        const entered = enterTrade(candles, i, enter, cash, options);
        if ('reason' in entered) {
          run.skips.push({ time: enter.time, reason: entered.reason });
        } else {
          cash = cash.minus(entered.spent);
          open = entered.trade;
        }
      }
    }
    const flatAtOpen = open === null;
    if (open !== null && open.exit.index === i) {
      settle(open);
      open = null;
    }

    const events = strategy.onCandle({ candle, flatAtOpen });
    if (candle.time < options.evaluateFrom) {
      continue;
    }
    run.events.push(...events);
    for (const event of events) {
      if (event.kind === 'ENTER') {
        pending = event;
      }
    }
    const status = strategy.status();
    const next = candles[i + 1];
    if (status.structureUp && status.level !== null && next !== undefined && next.time === candle.time + QUARTER_HOUR_MS) {
      run.placeboEntries.push(i + 1);
    }
    const holding: BracketTrade | null = open;
    run.equity.push({
      time: candle.time,
      equity: holding === null ? cash : cash.plus(holding.quantity.times(candle.close)),
      holding: holding !== null,
    });
  }
  return run;
}

type Entered = { trade: BracketTrade; spent: Decimal };

/** R8, R10: the entry at candles[index]'s open, sized only from what was known at the confirmation close. */
function enterTrade(
  candles: Candle[],
  index: number,
  enter: EnterEvent,
  cash: Decimal,
  options: BracketOptions,
): Entered | { reason: SkipReason } {
  const { config, costs, rules } = options;
  const candle = candles[index]!;
  if (candle.open.lte(enter.stopTrigger)) {
    return { reason: 'OPEN_AT_OR_BELOW_STOP' };
  }
  const buyAt = enter.confirmationClose.times(ONE.plus(costs.slippageRate));
  const sellAt = enter.stopTrigger.times(ONE.minus(costs.slippageRate));
  const riskPerBtc = buyAt.minus(sellAt).plus(buyAt.plus(sellAt).times(costs.feeRate));
  const quoteAmount = Decimal.min(
    cash.times(options.riskFraction).div(riskPerBtc).times(buyAt),
    cash.div(ONE.plus(costs.feeRate)),
  );
  const entryPrice = candle.open.times(ONE.plus(costs.slippageRate));
  const quantity = roundDown(quoteAmount.div(entryPrice), rules.lotStep);
  const cost = quantity.times(entryPrice);
  if (quantity.isZero() || cost.lt(rules.minOrderAmt)) {
    return { reason: 'TOO_SMALL' };
  }
  const target = entryPrice.plus(config.targetMultiple.times(entryPrice.minus(enter.stopTrigger)));
  const exit = simulateExit(candles, index, enter.stopTrigger, target, config.timeLimitCandles, costs);
  const entryFee = cost.times(costs.feeRate);
  const proceeds = quantity.times(exit.price);
  return {
    spent: cost.plus(entryFee),
    trade: {
      confirmationTime: enter.time,
      confirmationClose: enter.confirmationClose,
      entryIndex: index,
      entryTime: candle.time,
      entryOpen: candle.open,
      entryPrice,
      stopTrigger: enter.stopTrigger,
      target,
      plannedRisk: enter.plannedRisk,
      quantity,
      equityAtEntry: cash,
      exit,
      exitTime: candles[exit.index]!.time,
      r: netR(entryPrice, exit.price, costs.feeRate, enter.plannedRisk),
      grossR: exit.rawPrice.minus(candle.open).div(enter.plannedRisk),
      pnl: proceeds.minus(proceeds.times(costs.feeRate)).minus(cost).minus(entryFee),
    },
  };
}
```

- [ ] **Step 4: Run the tests.** Run: `npx vitest run tests/backtest/`. Expected: PASS.
- [ ] **Step 5: Type-check and run the full suite,** then **ship.** Branch `liquidity/backtester`.
  Title: *research: bracket backtester for the liquidity sweep*. The description walks through
  the worked figures above.

---

### Task 5: Evidence — seeded draws, the bootstrap and the placebo

**Files:**
- Create: `src/backtest/evidence.ts`, `tests/backtest/evidence.test.ts`

- [ ] **Step 1: Write the failing tests.** `tests/backtest/evidence.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_COSTS } from '../../src/backtest/costs.js';
import {
  monthBlockInterval,
  monthOf,
  monthsBetween,
  percentile,
  placebo,
  placeboR,
  seededRandom,
} from '../../src/backtest/evidence.js';
import { QUARTER_HOUR_MS } from '../../src/strategy/bars.js';
import { VERSION_0 } from '../../src/strategy/liquiditySweep.js';
import { candle } from '../helpers/liquidity.js';

const d = (...values: number[]) => values.map((value) => new Decimal(value));

describe('seededRandom', () => {
  it('repeats exactly for a seed, differs between seeds, and stays in [0, 1)', () => {
    const a = seededRandom(20260924);
    const b = seededRandom(20260924);
    const c = seededRandom(20260925);
    const first = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(first);
    expect(Array.from({ length: 5 }, () => c())).not.toEqual(first);
    expect(first.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe('percentile', () => {
  it('takes the nearest rank', () => {
    const sorted = d(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
    expect([0.05, 0.5, 0.95].map((p) => percentile(sorted, p).toString())).toEqual(['1', '5', '10']);
  });
});

describe('months', () => {
  it('names UTC calendar months, and lists every month a period touches', () => {
    expect(monthOf(Date.parse('2024-02-29T23:45:00Z'))).toBe('2024-02');
    expect(monthsBetween(Date.parse('2023-11-15T00:00:00Z'), Date.parse('2024-02-01T00:00:00Z'))).toEqual([
      '2023-11',
      '2023-12',
      '2024-01',
    ]);
  });
});

describe('monthBlockInterval', () => {
  it('collapses to the value when every trade is the same', () => {
    const trades = ['2024-01', '2024-02', '2024-02'].map((month) => ({ month, r: new Decimal('0.5') }));
    const interval = monthBlockInterval(trades, ['2024-01', '2024-02', '2024-03'], 500, 0.9, 1);
    expect([interval!.low, interval!.high].map(String)).toEqual(['0.5', '0.5']);
  });

  it('brackets the mean, repeats for a seed, and moves whole months together', () => {
    const trades = [
      { month: '2024-01', r: new Decimal(2) },
      { month: '2024-01', r: new Decimal(2) },
      { month: '2024-02', r: new Decimal(-1) },
      { month: '2024-03', r: new Decimal(-1) },
    ];
    const months = ['2024-01', '2024-02', '2024-03'];
    const once = monthBlockInterval(trades, months, 2000, 0.9, 7)!;
    const again = monthBlockInterval(trades, months, 2000, 0.9, 7)!;
    expect([once.low, once.high].map(String)).toEqual([again.low, again.high].map(String));
    // Drawing three whole months, January (two trades of 2R) comes up k times: the mean is
    // (5k − 3) ÷ (k + 3), so −1, 0.5, 1.4 or 2, with chances 8, 12, 6 and 1 in 27. The 5th
    // percentile is −1 and the 95th is 1.4. Drawing single trades would give other values.
    expect([once.low, once.high].map(String)).toEqual(['-1', '1.4']);
  });

  it('refuses a trade outside the period', () => {
    expect(() => monthBlockInterval([{ month: '2025-01', r: new Decimal(1) }], ['2024-12'], 10, 0.9, 1)).toThrow('outside the period');
  });
});

describe('placebo', () => {
  // Prices rise one point a candle from 100: every entry reaches a 2R target with a 1% stop within a few candles.
  const rising = Array.from({ length: 200 }, (_, i) =>
    candle(Date.parse('2024-01-10T00:00:00Z') + i * QUARTER_HOUR_MS, 100 + i, 101.5 + i, 99.9 + i, 101 + i),
  );

  it('measures one placebo trade in its own planned risk', () => {
    const r = placeboR(rising, 10, new Decimal('0.01'), VERSION_0, DEFAULT_COSTS);
    expect(r.gt(1.5) && r.lt(2.5)).toBe(true);
  });

  it('matches each real trade by month and ranks the real mean among the placebo sets', () => {
    const entries = Array.from({ length: 150 }, (_, i) => i + 1);
    const trades = [{ entryTime: rising[5]!.time, plannedRisk: new Decimal(1.05), confirmationClose: new Decimal(105), r: new Decimal(10) }];
    const result = placebo(rising, entries, trades, VERSION_0, DEFAULT_COSTS, 50, 20260925)!;
    expect(result.means).toHaveLength(50);
    expect(result.rankOfReal).toBe(1);
    expect(result.median.lte(result.p95)).toBe(true);
  });

  it('refuses a real trade in a month with no eligible entry', () => {
    const trades = [{ entryTime: Date.parse('2023-05-01T00:00:00Z'), plannedRisk: new Decimal(1), confirmationClose: new Decimal(100), r: new Decimal(1) }];
    expect(() => placebo(rising, [1, 2, 3], trades, VERSION_0, DEFAULT_COSTS, 5, 1)).toThrow('no placebo entry');
  });
});
```

- [ ] **Step 2: Run them to see them fail.**
  Run: `npx vitest run tests/backtest/evidence.test.ts`. Expected: FAIL, since the module is
  missing.

- [ ] **Step 3: Write `src/backtest/evidence.ts`.**

```ts
import Decimal from 'decimal.js';
import { mean } from '../math.js';
import type { LiquiditySweepConfig } from '../strategy/liquiditySweep.js';
import type { Candle, CostModel } from '../types.js';
import { netR, simulateExit } from './bracket.js';

const ONE = new Decimal(1);

/** Spec 6.4: fixed before any data, and printed in every report. */
export const BOOTSTRAP_SEED = 20260924;
export const PLACEBO_SEED = 20260925;
export const BOOTSTRAP_RESAMPLES = 10_000;
export const PLACEBO_SETS = 1_000;

/**
 * A seeded pseudo-random generator, mulberry32: the same seed always gives the
 * same draws, so every result can be reproduced exactly.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The nearest-rank percentile of sorted values. */
export function percentile(sorted: Decimal[], fraction: number): Decimal {
  if (sorted.length === 0) {
    throw new Error('percentile needs at least one value');
  }
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[rank]!;
}

/** The UTC calendar month of a moment, as YYYY-MM. */
export function monthOf(time: number): string {
  return new Date(time).toISOString().slice(0, 7);
}

/** Every UTC calendar month that a period from `from` up to, not including, `to` touches. */
export function monthsBetween(from: number, to: number): string[] {
  const first = new Date(from);
  let year = first.getUTCFullYear();
  let month = first.getUTCMonth();
  const months: string[] = [];
  while (Date.UTC(year, month, 1) < to) {
    months.push(monthOf(Date.UTC(year, month, 1)));
    month += 1;
    if (month === 12) {
      month = 0;
      year += 1;
    }
  }
  return months;
}

export type Interval = { low: Decimal; high: Decimal };

/**
 * Spec 6.4: an interval for mean R from bootstrap resamples of whole calendar
 * months. Each resample draws as many months as the period has, with
 * replacement, and takes the mean R of every trade in them; a resample with no
 * trade is drawn again. Months that bunch trades together are therefore not
 * treated as independent draws.
 */
export function monthBlockInterval(
  trades: Array<{ month: string; r: Decimal }>,
  months: string[],
  resamples: number,
  level: number,
  seed: number,
): Interval | null {
  if (trades.length === 0 || months.length === 0) {
    return null;
  }
  const byMonth = new Map<string, Decimal[]>(months.map((month) => [month, []]));
  for (const trade of trades) {
    const list = byMonth.get(trade.month);
    if (list === undefined) {
      throw new Error(`a trade in ${trade.month} is outside the period`);
    }
    list.push(trade.r);
  }
  const blocks = months.map((month) => byMonth.get(month)!);
  const random = seededRandom(seed);
  const means: Decimal[] = [];
  while (means.length < resamples) {
    let total = new Decimal(0);
    let count = 0;
    for (let k = 0; k < blocks.length; k++) {
      const block = blocks[Math.floor(random() * blocks.length)]!;
      for (const r of block) {
        total = total.plus(r);
      }
      count += block.length;
    }
    if (count > 0) {
      means.push(total.div(count));
    }
  }
  means.sort((a, b) => a.comparedTo(b));
  const tail = (1 - level) / 2;
  return { low: percentile(means, tail), high: percentile(means, 1 - tail) };
}

/**
 * One placebo trade: entered at candles[index]'s open with its stop `share` of
 * that open below it, the version's target and time limit, and the same costs
 * and exits as a real trade. Measured in its own planned risk: the open's
 * distance to its stop.
 */
export function placeboR(
  candles: Candle[],
  index: number,
  share: Decimal,
  config: LiquiditySweepConfig,
  costs: CostModel,
): Decimal {
  const open = candles[index]!.open;
  const plannedRisk = open.times(share);
  const stopTrigger = open.minus(plannedRisk);
  const entryPrice = open.times(ONE.plus(costs.slippageRate));
  const target = entryPrice.plus(config.targetMultiple.times(entryPrice.minus(stopTrigger)));
  const exit = simulateExit(candles, index, stopTrigger, target, config.timeLimitCandles, costs);
  return netR(entryPrice, exit.price, costs.feeRate, plannedRisk);
}

export type PlaceboResult = {
  /** Mean R of each placebo set, sorted. */
  means: Decimal[];
  median: Decimal;
  p95: Decimal;
  real: Decimal;
  /** The share of placebo means below the real mean. */
  rankOfReal: number;
};

export type PlaceboSource = { entryTime: number; plannedRisk: Decimal; confirmationClose: Decimal; r: Decimal };

/**
 * Spec 6.4: for each real trade, a random eligible entry in the same calendar
 * month, with the real trade's stop distance as a share of price. `entries`
 * holds the candles at whose open a real entry could have been decided. One set
 * per draw of as many trades as the real run; `sets` of them.
 */
export function placebo(
  candles: Candle[],
  entries: number[],
  trades: PlaceboSource[],
  config: LiquiditySweepConfig,
  costs: CostModel,
  sets: number,
  seed: number,
): PlaceboResult | null {
  if (trades.length === 0) {
    return null;
  }
  const pools = new Map<string, number[]>();
  for (const index of entries) {
    const month = monthOf(candles[index]!.time);
    pools.set(month, [...(pools.get(month) ?? []), index]);
  }
  const draws = trades.map((trade) => {
    const pool = pools.get(monthOf(trade.entryTime));
    if (pool === undefined || pool.length === 0) {
      throw new Error(`no placebo entry in ${monthOf(trade.entryTime)}, where a real trade entered`);
    }
    return { pool, share: trade.plannedRisk.div(trade.confirmationClose) };
  });
  const random = seededRandom(seed);
  const means: Decimal[] = [];
  for (let s = 0; s < sets; s++) {
    let total = new Decimal(0);
    for (const draw of draws) {
      const index = draw.pool[Math.floor(random() * draw.pool.length)]!;
      total = total.plus(placeboR(candles, index, draw.share, config, costs));
    }
    means.push(total.div(draws.length));
  }
  means.sort((a, b) => a.comparedTo(b));
  const real = mean(trades.map((trade) => trade.r));
  return {
    means,
    median: percentile(means, 0.5),
    p95: percentile(means, 0.95),
    real,
    rankOfReal: means.filter((m) => m.lt(real)).length / means.length,
  };
}
```

- [ ] **Step 4: Run the tests, type-check, run the full suite,** then **ship.** Branch
  `liquidity/evidence`. Title: *research: seeded bootstrap and placebo for the liquidity sweep*.

---

### Task 6: The report and the lock

**Files:**
- Create: `src/backtest/liquidityPeriods.ts`, `src/backtest/liquidityReport.ts`
- Create: `tests/backtest/liquidityPeriods.test.ts`, `tests/backtest/liquidityReport.test.ts`

- [ ] **Step 1: Write the failing tests.** `tests/backtest/liquidityPeriods.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEVELOPMENT, LOCKED, periodCandles } from '../../src/backtest/liquidityPeriods.js';
import { bar } from '../helpers/candles.js';

const Q = 900_000;
/** 15-minute candles from `from` to `to`, exclusive. */
const span = (from: number, to: number) =>
  Array.from({ length: (to - from) / Q }, (_, i) => bar(from + i * Q, 100, 101, 99, 100));

describe('periodCandles', () => {
  it('never shows development a candle from the locked period', () => {
    const all = span(DEVELOPMENT.to - 8 * Q, DEVELOPMENT.to + 8 * Q);
    const { candles, evaluateFrom, evaluateTo } = periodCandles(all, 'development', false);
    expect(candles.every((candle) => candle.time < DEVELOPMENT.to)).toBe(true);
    expect([evaluateFrom, evaluateTo]).toEqual([DEVELOPMENT.from, DEVELOPMENT.to]);
  });

  it('keeps the locked period closed without its flag', () => {
    expect(() => periodCandles(span(LOCKED.to - 8 * Q, LOCKED.to), 'locked', false)).toThrow('--unlock-locked-period');
  });

  it('opens the locked period with its flag, keeping the earlier candles as warm-up', () => {
    const all = span(LOCKED.from - 8 * Q, LOCKED.to);
    const { candles, evaluateFrom } = periodCandles(all, 'locked', true);
    expect(candles[0]!.time).toBe(LOCKED.from - 8 * Q);
    expect(evaluateFrom).toBe(LOCKED.from);
  });

  it('says what to fetch when the candles end early', () => {
    expect(() => periodCandles(span(DEVELOPMENT.to - 8 * Q, DEVELOPMENT.to - 4 * Q), 'development', false)).toThrow(
      '--until 2025-01-01',
    );
  });
});
```

`tests/backtest/liquidityReport.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { BracketTrade } from '../../src/backtest/bracket.js';
import {
  correlation,
  developmentVerdict,
  lockedVerdict,
  summarizeAccount,
  summarizeTrades,
  type Evidence,
} from '../../src/backtest/liquidityReport.js';

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
    neighbours: Array.from({ length: 8 }, (_, i) => ({ name: `n${i}`, summary: { ...summary, meanR: new Decimal(i < 5 ? 1 : -1) } })),
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
});

describe('lockedVerdict', () => {
  it('needs a positive mean, the placebo median, and a comparable trade rate', () => {
    expect(lockedVerdict(evidence(), new Decimal('13.3')).verdict).toBe('PASS');
    expect(lockedVerdict(evidence(), new Decimal(40)).verdict).toBe('FAIL');
  });
});
```

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL, since both modules are missing.

- [ ] **Step 3: Write `src/backtest/liquidityPeriods.ts`.**

```ts
import type { Candle } from '../types.js';

const QUARTER_HOUR_MS = 900_000;

/** The periods fixed in the spec, section 6.2. */
export const DEVELOPMENT = { from: Date.parse('2022-01-01T00:00:00Z'), to: Date.parse('2025-01-01T00:00:00Z') };
export const LOCKED = { from: Date.parse('2025-01-01T00:00:00Z'), to: Date.parse('2026-09-01T00:00:00Z') };

export type PeriodName = 'development' | 'locked';
export type PeriodCandles = { candles: Candle[]; evaluateFrom: number; evaluateTo: number };

/**
 * The candles a run may see. Development never sees a candle from the locked
 * period, whatever the file holds. The locked period opens only when asked
 * explicitly, in its own pull request, and keeps every earlier candle as warm-up.
 */
export function periodCandles(all: Candle[], period: PeriodName, unlockLocked: boolean): PeriodCandles {
  if (period === 'locked' && !unlockLocked) {
    throw new Error('the locked period stays closed until its own pull request runs it with --unlock-locked-period');
  }
  const range = period === 'development' ? DEVELOPMENT : LOCKED;
  const candles = all.filter((candle) => candle.time < range.to);
  const last = candles[candles.length - 1];
  if (last === undefined || last.time + QUARTER_HOUR_MS < range.to) {
    const day = new Date(range.to).toISOString().slice(0, 10);
    throw new Error(`the candles end before ${day}: run npm run liquidity:fetch -- --until ${day}`);
  }
  return { candles, evaluateFrom: range.from, evaluateTo: range.to };
}
```

- [ ] **Step 4: Write `src/backtest/liquidityReport.ts`.**

```ts
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
    timeInMarket: marks.length === 0 ? new Decimal(0) : new Decimal(marks.filter((m) => m.holding).length).div(marks.length),
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

const count = <K extends string>(keys: K[]): Partial<Record<K, number>> => {
  const counts: Partial<Record<K, number>> = {};
  for (const key of keys) {
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};

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
    { name: 'mean R above zero, and the bottom of its 90% interval', passed: positive(summary.meanR) && positive(evidence.interval?.low) },
    { name: 'mean R above zero at 0.15% slippage', passed: positive(evidence.stressed.meanR) },
    { name: "mean R above the placebo's 95th percentile", passed: p !== null && summary.meanR !== null && summary.meanR.gt(p.p95) },
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
    { name: "mean R at or above the placebo's median", passed: p !== null && summary.meanR !== null && summary.meanR.gte(p.median) },
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

/** The report as text, for the terminal and the results document. */
export function formatEvidence(e: Evidence, verdict: { verdict: Verdict; checks: Check[] }): string {
  const s = e.summary;
  const lines = [
    `Liquidity sweep v0, ${e.period} period, ${day(e.from)} to ${day(e.to)} (exclusive)`,
    `Seeds: bootstrap ${BOOTSTRAP_SEED}, placebo ${PLACEBO_SEED}`,
    '',
    `Trades: ${s.trades} (${s.perYear.toFixed(1)} a year), win rate ${pct(s.winRate)}`,
    `Average win ${r(s.averageWin)}, average loss ${r(s.averageLoss)}`,
    `Mean net R ${r(s.meanR)}, 90% interval ${e.interval === null ? 'none' : `${r(e.interval.low)} to ${r(e.interval.high)}`}`,
    `Mean gross R ${r(s.meanGrossR)}, total net R ${r(s.totalR)}`,
    `At 0.15% slippage: mean net R ${r(e.stressed.meanR)}`,
    `Break-even round-trip cost: ${e.breakEvenRoundTrip === null ? 'above 6%' : pct(e.breakEvenRoundTrip)}`,
    `Placebo: ${e.placebo === null ? 'none' : `median ${r(e.placebo.median)}, 95th percentile ${r(e.placebo.p95)}, real mean above ${pct(new Decimal(e.placebo.rankOfReal))} of sets`}`,
    `Exits: ${Object.entries(e.exits).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
    `Skipped entries: ${Object.entries(e.skips).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
    `Candles reaching both stop and target: ${e.ambiguous}`,
    '',
    'By year:',
    ...e.byYear.map(({ year, summary }) => `  ${year}: ${summary.trades} trades, mean ${r(summary.meanR)}, total ${r(summary.totalR)}`),
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
  return `${runAt.toISOString().slice(0, 16)}Z ${commit} liquidity-sweep v0 ${e.period}: ${e.summary.trades} trades, mean ${r(e.summary.meanR)}, ${verdict}`;
}
```

- [ ] **Step 5: Run the tests, type-check, run the full suite,** then **ship.** Branch
  `liquidity/report-and-lock`. Title: *research: the liquidity-sweep report, bar and lock*.

---

### Task 7: The commands

**Files:**
- Create: `src/data/compare.ts`, `tests/data/compare.test.ts`, `src/cli/liquidity-check.ts`,
  `src/cli/liquidity-research.ts`
- Modify: `package.json`, `CLAUDE.md` (the commands table and the repository layout)

- [ ] **Step 1: Write the failing test.** `tests/data/compare.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { compareCandles, medianVolumeByYear } from '../../src/data/compare.js';
import { bar } from '../helpers/candles.js';

describe('compareCandles', () => {
  it('counts identical candles, the largest difference, and candles missing on either side', () => {
    const built = [bar(0, 100, 110, 90, 105), bar(1, 105, 111, 100, 100.1), bar(2, 106, 107, 105, 106)];
    const official = [bar(0, 100, 110, 90, 105), bar(1, 105, 111, 100, 100), bar(3, 1, 1, 1, 1)];
    const result = compareCandles(built, official);
    expect(result).toMatchObject({ compared: 2, identical: 1, missingOfficial: 1, missingBuilt: 1, worstTime: 1 });
    expect(result.largestDifference.toString()).toBe('0.001');
  });
});

describe('medianVolumeByYear', () => {
  it('takes each UTC year\'s median 15-minute volume', () => {
    const at = (time: number, volume: number) => ({ ...bar(time, 1, 1, 1, 1), volume: new Decimal(volume) });
    const t2021 = Date.parse('2021-08-01T00:00:00Z');
    const candles = [at(t2021, 1), at(t2021 + 900_000, 3), at(Date.parse('2022-03-01T00:00:00Z'), 50)];
    expect(medianVolumeByYear(candles).map(({ year, median }) => [year, median.toString()])).toEqual([
      [2021, '1'],
      [2022, '50'],
    ]);
  });
});
```

For 2021 the two volumes are 1 and 3. The lower median of an even count, by nearest rank at 0.5,
is 1.

- [ ] **Step 2: Write `src/data/compare.ts`.**

```ts
import Decimal from 'decimal.js';
import type { Candle } from '../types.js';

export type Comparison = {
  compared: number;
  identical: number;
  /** Built candles Bybit does not have. */
  missingOfficial: number;
  /** Bybit's candles that could not be built, usually for a missing 15-minute candle. */
  missingBuilt: number;
  /** The largest difference in any price, as a share of Bybit's. */
  largestDifference: Decimal;
  worstTime: number | null;
};

/** How closely candles built from 15-minute ones match the exchange's own, price by price (spec 6.3, item 7). */
export function compareCandles(built: Candle[], official: Candle[]): Comparison {
  const officialByTime = new Map(official.map((candle) => [candle.time, candle]));
  const builtTimes = new Set(built.map((candle) => candle.time));
  const result: Comparison = {
    compared: 0,
    identical: 0,
    missingOfficial: 0,
    missingBuilt: official.filter((candle) => !builtTimes.has(candle.time)).length,
    largestDifference: new Decimal(0),
    worstTime: null,
  };
  for (const candle of built) {
    const other = officialByTime.get(candle.time);
    if (other === undefined) {
      result.missingOfficial += 1;
      continue;
    }
    result.compared += 1;
    let same = true;
    for (const field of ['open', 'high', 'low', 'close'] as const) {
      const difference = candle[field].minus(other[field]).abs().div(other[field]);
      if (!difference.isZero()) {
        same = false;
      }
      if (difference.gt(result.largestDifference)) {
        result.largestDifference = difference;
        result.worstTime = candle.time;
      }
    }
    if (same) {
      result.identical += 1;
    }
  }
  return result;
}

/** Each UTC year's median 15-minute volume, to show how thin the early market was (spec 6.2). */
export function medianVolumeByYear(candles: Candle[]): Array<{ year: number; median: Decimal }> {
  const byYear = new Map<number, Decimal[]>();
  for (const candle of candles) {
    const year = new Date(candle.time).getUTCFullYear();
    byYear.set(year, [...(byYear.get(year) ?? []), candle.volume]);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, volumes]) => {
      const sorted = [...volumes].sort((a, b) => a.comparedTo(b));
      return { year, median: sorted[Math.ceil(sorted.length / 2) - 1]! };
    });
}
```

- [ ] **Step 3: Write `src/cli/liquidity-check.ts`.**

```ts
import { readFile } from 'node:fs/promises';
import { BYBIT_HOSTS, fetchCandles, INTERVAL_MS, type Interval } from '../data/bybit.js';
import { compareCandles, medianVolumeByYear } from '../data/compare.js';
import { parseCandleCsv } from '../data/csv.js';
import { LIQUIDITY_15M } from '../data/datasets.js';
import { checkCandles, formatIntegrity } from '../data/integrity.js';
import { aggregate, DAY_MS, FOUR_HOURS_MS } from '../strategy/bars.js';

const HOSTS = process.env.BYBIT_API_BASE ? [process.env.BYBIT_API_BASE] : BYBIT_HOSTS;
const iso = (time: number | null) => (time === null ? 'none' : new Date(time).toISOString().slice(0, 16) + 'Z');

async function main(): Promise<void> {
  const candles = parseCandleCsv(await readFile(LIQUIDITY_15M.file, 'utf8'));
  console.log(formatIntegrity(checkCandles(candles, INTERVAL_MS['15'])));
  const first = candles[0]!.time;
  const end = candles[candles.length - 1]!.time + INTERVAL_MS['15'];
  const checks: Array<[Interval, number, string]> = [
    ['240', FOUR_HOURS_MS, '4-hour'],
    ['D', DAY_MS, 'daily'],
  ];
  for (const [interval, blockMs, label] of checks) {
    const official = await fetchCandles(LIQUIDITY_15M.symbol, interval, new Date(first), {
      category: LIQUIDITY_15M.category,
      hosts: HOSTS,
      end,
    });
    const c = compareCandles(aggregate(candles, blockMs), official);
    console.log(
      `${label}: ${c.compared} compared, ${c.identical} identical, largest difference ` +
        `${c.largestDifference.times(100).toFixed(4)}% at ${iso(c.worstTime)}, ` +
        `${c.missingOfficial} missing on Bybit, ${c.missingBuilt} not built`,
    );
  }
  for (const { year, median } of medianVolumeByYear(candles)) {
    console.log(`${year}: median 15-minute volume ${median.toFixed(3)} BTC`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
```

- [ ] **Step 4: Write `src/cli/liquidity-research.ts`.**

```ts
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import Decimal from 'decimal.js';
import { DEFAULT_COSTS } from '../backtest/costs.js';
import { DEVELOPMENT, periodCandles, type PeriodName } from '../backtest/liquidityPeriods.js';
import {
  attemptLine,
  developmentVerdict,
  formatEvidence,
  gatherEvidence,
  lockedVerdict,
  runVersion,
  summarizeTrades,
} from '../backtest/liquidityReport.js';
import { INTERVAL_MS } from '../data/bybit.js';
import { parseCandleCsv } from '../data/csv.js';
import { LIQUIDITY_15M } from '../data/datasets.js';
import { checkCandles, formatIntegrity, usable } from '../data/integrity.js';
import { VERSION_0 } from '../strategy/liquiditySweep.js';

const YEAR_MS = 365.25 * 86_400_000;

function period(argv: string[]): PeriodName {
  const value = argv[argv.indexOf('--period') + 1];
  if (!argv.includes('--period') || (value !== 'development' && value !== 'locked')) {
    throw new Error('--period must be development or locked');
  }
  return value;
}

function commit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const name = period(argv);
  const all = parseCandleCsv(await readFile(LIQUIDITY_15M.file, 'utf8'));
  const integrity = checkCandles(all, INTERVAL_MS['15']);
  console.log(formatIntegrity(integrity));
  if (!usable(integrity)) {
    throw new Error('the candle file has duplicates, misordered or misaligned candles, or impossible prices: fetch it again');
  }
  const { candles, evaluateFrom, evaluateTo } = periodCandles(all, name, argv.includes('--unlock-locked-period'));

  if (argv.includes('--count-only')) {
    // Spec 6.3, item 8: count trades before looking at any result.
    const trades = runVersion(candles, VERSION_0, DEFAULT_COSTS, evaluateFrom).trades.length;
    console.log(`\n${name}: ${trades} trades. Nothing else is shown until the full run.`);
    return;
  }

  const evidence = gatherEvidence(candles, name, evaluateFrom, evaluateTo);
  let verdict: ReturnType<typeof developmentVerdict>;
  if (name === 'development') {
    verdict = developmentVerdict(evidence);
  } else {
    const developmentCandles = candles.filter((candle) => candle.time < DEVELOPMENT.to);
    const developmentTrades = runVersion(developmentCandles, VERSION_0, DEFAULT_COSTS, DEVELOPMENT.from).trades;
    const developmentYears = new Decimal(DEVELOPMENT.to - DEVELOPMENT.from).div(YEAR_MS);
    verdict = lockedVerdict(evidence, summarizeTrades(developmentTrades, developmentYears).perYear);
  }
  console.log(`\n${formatEvidence(evidence, verdict)}`);
  console.log(`\nAttempt: ${attemptLine(evidence, verdict.verdict, commit(), new Date())}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
```

- [ ] **Step 5: Scripts and documentation.**
  - In `package.json`, add `"liquidity:check": "tsx src/cli/liquidity-check.ts"` and
    `"liquidity:research": "tsx src/cli/liquidity-research.ts"` after `liquidity:fetch`.
  - In `CLAUDE.md`'s commands table, add three rows:
    - `npm run liquidity:fetch`: "Bybit spot BTCUSDT 15-minute candles into `data/`, before 2025-01-01
      unless `-- --until YYYY-MM-DD`. The liquidity-sweep research's data"
    - `npm run liquidity:check`: "Checks those candles, and compares the 4-hour and daily candles
      built from them with Bybit's own"
    - `npm run liquidity:research`: "`-- --period development`, with `--count-only` first. The
      locked period also needs `--unlock-locked-period`, in its own pull request"
  - In the repository layout, under `src/backtest/`, note "also the liquidity-sweep backtester,
    evidence and report". Under `src/strategy/`, note "also the liquidity-sweep research
    candidate, which nothing trades".

- [ ] **Step 6: Run the new test, type-check, run the full suite,** then **ship.** Branch
  `liquidity/commands`. Title: *research: commands to check the data and run the liquidity sweep*.
  The commands are not run in this task.

---

### Task 8: The development run

**Files:**
- Create: `docs/research/liquidity-sweep-results.md`
- Modify: `CLAUDE.md` (the state table)

- [ ] **Step 1: Fetch.** Run `npm run liquidity:fetch`. Expected: the file ends at 2024-12-31
  23:45 UTC. Record the integrity summary exactly as printed.
- [ ] **Step 2: Check.** Run `npm run liquidity:check` and record its output. A candle file that
  is not usable stops the run: fetch again, and record the problem if it repeats.
- [ ] **Step 3: Count before looking.** Run
  `npm run liquidity:research -- --period development --count-only` and record the trade count.
  **Under 30 trades: stop.** Record the verdict UNTESTABLE, and do not run step 4. Loosening the
  rules to get more trades is not allowed (spec 6.5).
- [ ] **Step 4: The one run.** Run `npm run liquidity:research -- --period development` and record
  the whole report and the attempt line, as printed.
- [ ] **Step 5: Write `docs/research/liquidity-sweep-results.md`** with these sections: the
  commit run, the data check, the count, the report, the verdict with each check, the attempt log,
  and what the result means. The last section is written plainly, in the voice of
  `docs/research/phase-0-findings.md`: what the result shows, what it cannot show, and what
  happens next under spec 6.5. **No number is rounded to flatter, and no rule changes.** A failure
  is recorded as not pursued, with its numbers.
- [ ] **Step 6: Update `CLAUDE.md`'s state table** with one row for the liquidity-sweep research:
  where it lives, its verdict, and the next step. Then ship: branch `liquidity/development-run`,
  title *research: the liquidity sweep on the development period*.
- [ ] **Step 7: Tell the founder and Codex** the verdict in plain words, and point product-prototype's
  draft to the results, through a small docs pull request there.

### Task 9: The locked run — only if development passed

- [ ] **Step 1:** Run `npm run liquidity:fetch -- --until 2026-09-01`, then
  `npm run liquidity:check`.
- [ ] **Step 2:** Run
  `npm run liquidity:research -- --period locked --unlock-locked-period`, once.
- [ ] **Step 3:** Append the report, the verdict and the attempt line to the results document.
  Ship it in its own pull request, whose description names the commit of the rules it ran.
- [ ] **Step 4:** If it passes, the next step is an engine spec for practice (spec 6.6), not a
  trade. If it fails, the candidate is not pursued.

---

## Self-review

- **Spec coverage:**

  | Spec | Task |
  |---|---|
  | R1 | 1–2 |
  | R2–R3 | 2 |
  | R4–R8, R12, R13 | 3 |
  | R9–R11 | 4 |
  | 6.2 periods and lock | 1 (default end), 6 |
  | 6.3 items | Tasks 1–9 |
  | 6.4 report | 5–6 |
  | 6.5 bar | 6, 8–9 |

  **Section 3a:** the first touch spent (Task 3: NOT_FLAT, STRUCTURE_NOT_UP, SETUP_WAITING); the
  midnight rollover (Task 3); the sweep's own swing (Task 3); the next open against a missing
  candle (Task 4: MISSED_ENTRY); an open at or below the stop (Task 4); sizing information and the
  cash cap (Task 4); net and gross R (Task 4); the month bootstrap and placebo (Task 5).
- **Placeholders:** none. Tasks 8 and 9 are runs; their text depends on results, and it is recorded
  as it comes.
- **Type consistency:**
  - `EnterEvent`, `LiquiditySweepConfig`, `VERSION_0` and `SweepEvent` come from Task 3.
  - `BracketTrade`, `BracketRun`, `Exit`, `netR`, `simulateExit`, `RESEARCH_RISK` and
    `BTCUSDT_RULES` come from Task 4.
  - `placebo`, `monthBlockInterval`, `monthOf`, `monthsBetween`, the seeds and the counts come
    from Task 5.
  - `periodCandles`, `DEVELOPMENT` and `LOCKED` come from Task 6.
  - All are used later with the same names.

## Execution notes

Built on 2026-09-24, inline, one pull request per task: #36 to #42, then #43. The full suite
passes, **646 tests** (565 before), and the type check is clean. Every task's code is as written
above, apart from the additions below.

**Tests added beyond the plan, each to close a gap the plan's tests left:**

- **Task 4:** a gap-up entry. In the scenario the entry opens at the confirmation close, so no
  planned test could tell sizing from the close apart from sizing from the open. The new test
  expects 0.002298 BTC and −1.0476 gross R.
- **Task 5:** a direct month-matching test, in which January rises and February falls. The
  planned test caught a placebo that ignores the month only indirectly.
- **Task 6:** an end-to-end run of `gatherEvidence`, `formatEvidence` and `attemptLine` on the
  hand-built scenario, with 1,000 placebo sets and eight neighbours.

**Mutation checks.** Every subtle rule was checked by breaking it on purpose; each break was caught
by exactly the intended test, and the code was restored:

| Task | Breaks caught |
|---|---|
| 3 | the waiting-setup check removed; the touch not spent while in a trade; confirmation before invalidation; swings added before the touch |
| 4 | the target checked before the stop; late entries allowed; sizing from the open |
| 5 | single-trade resampling; a placebo that ignores the month |

**Task 8, the development run** (results: `docs/research/liquidity-sweep-results.md`):

- **The fetch needed a second attempt.** One Bybit response stalled after the server had answered,
  which the fetcher does not retry.
- **The data has one gap:** 400 candles after 2022-02-01 02:30 UTC. It is Bybit's own, confirmed
  directly.
- **The built 4-hour and daily candles match Bybit's exactly.**
- **The count was 3 trades: UNTESTABLE.** The full evaluation was not run.
- **An added step, not in the plan.** Before recording the verdict, PR #43 added
  `npm run liquidity:funnel`, to rule out a bug, the one reason the spec allows a revision. It
  prints rule outcomes only. It recomputes every first touch, sweep, structure verdict, reference
  and waiting outcome independently, and agrees on 465 of 465 and 57 of 57.

**Task 9 was not reached.** The locked period stays unfetched.

**Follow-ups found:** a per-page retry for long research fetches. Bybit can return candles from
before `start` inside a gap: the fetcher coped, but its comment is wrong, and a page with nothing
new would end a fetch silently. Both need fixing before any locked-period fetch.

**Version 1, after the plan** (2026-09-25). The founder chose one pre-registered version 1. It was
built outside this plan, to its own pre-registration, `docs/research/liquidity-sweep-v1.md`:

- **#46:** the pre-registration, committed before any version 1 code or count.
- **#47:** the three levers, each defaulting to version 0's behaviour, and the four-step ladder.
  Every existing test passed unchanged. Four mutation checks were each caught: step A using the
  prior swing high, `LOWS` still needing rising highs, a recovery counting as a sweep, and a break
  ending the day under `FIRST_WICK`.
- **#48:** any version through the report, the research command and the funnel. A ladder step can
  only be counted. The full suite passes, **656 tests**.
- **The ladder counted 16, 16, 26 and 29 trades.** No step reached 30, so version 1 was untestable
  and the idea stops. The funnel's recomputation for step D agrees on 594 of 594 and 147 of 147.
  No `VERSION_1` was frozen, and no full evaluation ran.

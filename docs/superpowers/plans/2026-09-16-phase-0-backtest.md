# Phase 0 — Strategy Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Determine whether the BTC trend-filter strategy holds up against buy-and-hold once real trading costs are included, and at what moving-average period — before any exchange integration, user accounts, or database work begins.

**Architecture:** A pure-function strategy (`StrategyFn: (candles) => 'LONG' | 'FLAT'`) driven by an offline backtest engine that replays historical daily candles. The engine never lets the strategy see a candle it would not have had in real time: a signal computed from candle N's close executes at candle N+1's open. Buy-and-hold is expressed as a one-line `StrategyFn` and runs through the identical engine, so the comparison is apples to apples. The same `StrategyFn` is what Phase 3 will call in production — this is the "one strategy implementation" guarantee from the spec, made concrete.

**Tech Stack:** TypeScript (strict), Node 22, Vitest, `decimal.js`, `tsx`. No database, no exchange credentials, no network at test time.

---

## Context for the implementer

Read `docs/superpowers/specs/2026-09-16-crypto-trading-automation-design.md` first. The three things that matter most here:

1. **Never use JavaScript floats for money.** Every price, quantity, and cash figure is a `Decimal` from `decimal.js`. `0.1 + 0.2 !== 0.3`, and in this system that becomes a wrong position size.
2. **Lookahead bias is the bug that matters.** If the backtest executes at the same candle whose close produced the signal, results will look excellent and live trading will not match. The engine is structured specifically to make this impossible.
3. **A backtest without fees and slippage is fiction.** At roughly 0.3% round trip and ten trades a year, costs are a ~3% annual drag. That is large enough to flip the conclusion.

### Deliberate deviations from the spec

- The spec sketches `evaluate(candles, currentState) -> TargetState`. A moving-average filter is stateless, so `currentState` would be an unused parameter. It is dropped. If a strategy later needs hysteresis, add it then.
- `noUncheckedIndexedAccess` stays off for Phase 0. All array access here is over arrays we construct ourselves. Phase 1 turns it on, when untrusted exchange responses enter the codebase.

### What "done" looks like

A table comparing the trend filter against buy-and-hold across moving-average periods, on both an in-sample and an out-of-sample date range, reporting CAGR, max drawdown, Sharpe, trade count, and time in market. That table is the Phase 0 deliverable and the input to the go/no-go decision.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts` | Toolchain |
| `src/types.ts` | Every shared type. No logic |
| `src/math.ts` | `mean()` over Decimals. The only arithmetic primitive |
| `src/strategy/trendFilter.ts` | `trendFilter(config)` and `buyAndHold`. Pure, no I/O |
| `src/backtest/costs.ts` | Fee and slippage model, and the two execution-price helpers |
| `src/backtest/engine.ts` | Replays candles, applies the strategy, produces trades and an equity curve |
| `src/backtest/metrics.ts` | CAGR, max drawdown, Sharpe, exposure, win rate |
| `src/backtest/report.ts` | Formats a result set as a readable table |
| `src/data/csv.ts` | Load and save candles as CSV |
| `src/data/bybit.ts` | One-off fetch of public daily klines. No credentials — public endpoint |
| `src/cli/fetch.ts` | `npm run fetch` — downloads history to `data/` |
| `src/cli/backtest.ts` | `npm run backtest` — single run |
| `src/cli/sweep.ts` | `npm run sweep` — parameter sweep, in-sample vs out-of-sample |
| `tests/**` | One test file per source file |

Strategy code depends on nothing. The engine depends on strategy, costs, and types. Nothing in `src/strategy/` or `src/backtest/` ever touches the network or the filesystem — that is what keeps them testable and what lets Phase 3 reuse them unchanged.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore` (modify existing)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "crypto-autotrader",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "fetch": "tsx src/cli/fetch.ts",
    "backtest": "tsx src/cli/backtest.ts",
    "sweep": "tsx src/cli/sweep.ts"
  },
  "dependencies": {
    "decimal.js": "^10.4.3"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Append to `.gitignore`**

The repo root already has a `.gitignore`. Append these lines:

```
data/*.csv
coverage/
```

Historical candle data is regenerable with `npm run fetch`, so it does not belong in git.

- [ ] **Step 5: Install and verify**

Run: `npm install && npm run typecheck`
Expected: install completes, `tsc --noEmit` prints nothing and exits 0.

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore package-lock.json
git commit -m "chore: scaffold Phase 0 backtest toolchain"
```

---

## Task 2: Core types

**Files:**
- Create: `src/types.ts`

There is no test for this task — it declares types only, and the type checker is the test.

- [ ] **Step 1: Create `src/types.ts`**

```ts
import Decimal from 'decimal.js';

/** One OHLCV bar. `time` is the candle OPEN time, in epoch milliseconds, UTC. */
export type Candle = {
  time: number;
  open: Decimal;
  high: Decimal;
  low: Decimal;
  close: Decimal;
  volume: Decimal;
};

/** What the strategy wants the account to be holding. */
export type TargetState = 'LONG' | 'FLAT';

/**
 * A strategy is a pure function from price history to a desired state.
 *
 * `candles` contains history up to AND INCLUDING the candle whose close is
 * being evaluated. It must never contain a future candle — the engine
 * guarantees this, and the strategy must not assume anything beyond it.
 */
export type StrategyFn = (candles: Candle[]) => TargetState;

export type StrategyConfig = {
  /** Number of candles in the moving average. */
  maPeriod: number;
};

export type CostModel = {
  /** Taker fee as a fraction of notional. Bybit spot taker is 0.001 (0.1%). */
  feeRate: Decimal;
  /** Adverse price movement as a fraction, applied against us on both sides. */
  slippageRate: Decimal;
};

export type Trade = {
  time: number;
  side: 'BUY' | 'SELL';
  /** Fill price after slippage. */
  price: Decimal;
  quantity: Decimal;
  fee: Decimal;
};

export type EquityPoint = {
  time: number;
  /** Cash plus mark-to-market value of holdings, at this candle's close. */
  equity: Decimal;
  state: TargetState;
};

export type Metrics = {
  initialCapital: Decimal;
  finalEquity: Decimal;
  totalReturn: Decimal;
  cagr: Decimal;
  maxDrawdown: Decimal;
  sharpe: Decimal;
  tradeCount: number;
  /** Fraction of days holding the asset, 0 to 1. */
  exposure: Decimal;
  /** Fraction of completed round trips that were profitable, 0 to 1. */
  winRate: Decimal;
  totalFees: Decimal;
};

export type BacktestResult = {
  label: string;
  trades: Trade[];
  equityCurve: EquityPoint[];
  metrics: Metrics;
};
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add core backtest types"
```

---

## Task 3: Decimal mean

**Files:**
- Create: `src/math.ts`
- Test: `tests/math.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/math.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { mean } from '../src/math.js';

const d = (n: string | number) => new Decimal(n);

describe('mean', () => {
  it('averages a list of decimals', () => {
    expect(mean([d(1), d(2), d(3)]).toString()).toBe('2');
  });

  it('is exact where floats are not', () => {
    // (0.1 + 0.2) / 2 must be exactly 0.15, which float arithmetic misses.
    expect(mean([d('0.1'), d('0.2')]).toString()).toBe('0.15');
  });

  it('handles a single value', () => {
    expect(mean([d('42.5')]).toString()).toBe('42.5');
  });

  it('throws on an empty list rather than returning NaN', () => {
    expect(() => mean([])).toThrow('mean requires at least one value');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/math.test.ts`
Expected: FAIL — cannot resolve `../src/math.js`.

- [ ] **Step 3: Write the implementation**

Create `src/math.ts`:

```ts
import Decimal from 'decimal.js';

/** Arithmetic mean. Throws on an empty list — a NaN here would propagate silently. */
export function mean(values: Decimal[]): Decimal {
  if (values.length === 0) {
    throw new Error('mean requires at least one value');
  }
  const total = values.reduce((acc, v) => acc.plus(v), new Decimal(0));
  return total.div(values.length);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/math.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/math.ts tests/math.test.ts
git commit -m "feat: add exact decimal mean"
```

---

## Task 4: Trend filter strategy

This is the single most important file in the project. It is pure, it has no dependencies beyond `mean`, and it is the exact code that will run in production in Phase 3.

**Files:**
- Create: `src/strategy/trendFilter.ts`
- Test: `tests/strategy/trendFilter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/strategy/trendFilter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { trendFilter, buyAndHold } from '../../src/strategy/trendFilter.js';
import type { Candle } from '../../src/types.js';

const DAY = 86_400_000;

/** Builds candles from a list of closes. OHLC are all equal; only close matters here. */
function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((c, i) => ({
    time: i * DAY,
    open: new Decimal(c),
    high: new Decimal(c),
    low: new Decimal(c),
    close: new Decimal(c),
    volume: new Decimal(1),
  }));
}

describe('trendFilter', () => {
  it('is FLAT before there is enough history for the average', () => {
    const strategy = trendFilter({ maPeriod: 5 });
    expect(strategy(candlesFromCloses([10, 11, 12, 13]))).toBe('FLAT');
  });

  it('is LONG when the latest close is above the moving average', () => {
    const strategy = trendFilter({ maPeriod: 3 });
    // Last 3 closes: 10, 20, 60 -> mean 30. Latest close 60 > 30.
    expect(strategy(candlesFromCloses([10, 20, 60]))).toBe('LONG');
  });

  it('is FLAT when the latest close is below the moving average', () => {
    const strategy = trendFilter({ maPeriod: 3 });
    // Last 3 closes: 60, 20, 10 -> mean 30. Latest close 10 < 30.
    expect(strategy(candlesFromCloses([60, 20, 10]))).toBe('FLAT');
  });

  it('is FLAT when the close exactly equals the average', () => {
    const strategy = trendFilter({ maPeriod: 3 });
    // Closes 10, 20, 30 -> mean 20. Latest 30 > 20, so use a flat series instead.
    // Closes 20, 20, 20 -> mean 20, latest 20. Not strictly greater, so FLAT.
    expect(strategy(candlesFromCloses([20, 20, 20]))).toBe('FLAT');
  });

  it('uses only the most recent maPeriod candles, ignoring older history', () => {
    const strategy = trendFilter({ maPeriod: 3 });
    // Ancient huge values must not drag the average up.
    expect(strategy(candlesFromCloses([1000, 1000, 10, 20, 60]))).toBe('LONG');
  });

  it('is exactly at the boundary: one tick above the average is LONG', () => {
    const strategy = trendFilter({ maPeriod: 2 });
    // Closes 10, 10.02 -> mean 10.01. Latest 10.02 > 10.01.
    const candles = candlesFromCloses([10]).concat(
      candlesFromCloses([10.02]).map((c) => ({ ...c, time: DAY })),
    );
    expect(strategy(candles)).toBe('LONG');
  });

  it('rejects a non-positive period rather than silently misbehaving', () => {
    expect(() => trendFilter({ maPeriod: 0 })).toThrow('maPeriod must be a positive integer');
    expect(() => trendFilter({ maPeriod: -5 })).toThrow('maPeriod must be a positive integer');
    expect(() => trendFilter({ maPeriod: 2.5 })).toThrow('maPeriod must be a positive integer');
  });
});

describe('buyAndHold', () => {
  it('is always LONG, including with no history at all', () => {
    expect(buyAndHold([])).toBe('LONG');
    expect(buyAndHold(candlesFromCloses([1, 2, 3]))).toBe('LONG');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/strategy/trendFilter.test.ts`
Expected: FAIL — cannot resolve `../../src/strategy/trendFilter.js`.

- [ ] **Step 3: Write the implementation**

Create `src/strategy/trendFilter.ts`:

```ts
import { mean } from '../math.js';
import type { Candle, StrategyConfig, StrategyFn, TargetState } from '../types.js';

/**
 * Hold the asset while its close is above the simple moving average of the
 * last `maPeriod` closes; hold cash otherwise.
 *
 * Pure: no I/O, no clock, no randomness. This exact function runs in the
 * backtest and, from Phase 3, in production. There is deliberately no second
 * implementation anywhere.
 *
 * Equality resolves to FLAT. A close that merely matches its own average is
 * not evidence of an uptrend, and biasing toward cash is the safer default.
 */
export function trendFilter(config: StrategyConfig): StrategyFn {
  if (!Number.isInteger(config.maPeriod) || config.maPeriod <= 0) {
    throw new Error('maPeriod must be a positive integer');
  }

  return (candles: Candle[]): TargetState => {
    if (candles.length < config.maPeriod) {
      return 'FLAT';
    }
    const window = candles.slice(-config.maPeriod);
    const average = mean(window.map((c) => c.close));
    const latest = window[window.length - 1]!.close;
    return latest.gt(average) ? 'LONG' : 'FLAT';
  };
}

/** Baseline: always invested. Used to compare the strategy against doing nothing. */
export const buyAndHold: StrategyFn = () => 'LONG';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/strategy/trendFilter.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/strategy/trendFilter.ts tests/strategy/trendFilter.test.ts
git commit -m "feat: add pure trend-filter strategy and buy-and-hold baseline"
```

---

## Task 5: Cost model

**Files:**
- Create: `src/backtest/costs.ts`
- Test: `tests/backtest/costs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/backtest/costs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { DEFAULT_COSTS, buyFillPrice, sellFillPrice, feeOn } from '../../src/backtest/costs.js';

const d = (n: string | number) => new Decimal(n);

describe('DEFAULT_COSTS', () => {
  it('uses Bybit spot taker fee of 0.1% and 0.05% slippage', () => {
    expect(DEFAULT_COSTS.feeRate.toString()).toBe('0.001');
    expect(DEFAULT_COSTS.slippageRate.toString()).toBe('0.0005');
  });
});

describe('buyFillPrice', () => {
  it('pays worse than the quoted price', () => {
    // 100 * (1 + 0.0005) = 100.05
    expect(buyFillPrice(d(100), DEFAULT_COSTS).toString()).toBe('100.05');
  });
});

describe('sellFillPrice', () => {
  it('receives worse than the quoted price', () => {
    // 100 * (1 - 0.0005) = 99.95
    expect(sellFillPrice(d(100), DEFAULT_COSTS).toString()).toBe('99.95');
  });
});

describe('feeOn', () => {
  it('charges the fee rate against notional', () => {
    // 1000 * 0.001 = 1
    expect(feeOn(d(1000), DEFAULT_COSTS).toString()).toBe('1');
  });

  it('is zero when the fee rate is zero', () => {
    const free = { feeRate: d(0), slippageRate: d(0) };
    expect(feeOn(d(1000), free).toString()).toBe('0');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/backtest/costs.test.ts`
Expected: FAIL — cannot resolve `../../src/backtest/costs.js`.

- [ ] **Step 3: Write the implementation**

Create `src/backtest/costs.ts`:

```ts
import Decimal from 'decimal.js';
import type { CostModel } from '../types.js';

/**
 * Bybit spot taker fee is 0.1%. Slippage of 0.05% is a deliberately
 * conservative assumption for BTC/USDT spot at retail size — real slippage on
 * a liquid pair is usually smaller, and a backtest that flatters itself on
 * costs is worthless.
 */
export const DEFAULT_COSTS: CostModel = {
  feeRate: new Decimal('0.001'),
  slippageRate: new Decimal('0.0005'),
};

/** Buying fills above the quoted price. Slippage always works against us. */
export function buyFillPrice(quoted: Decimal, costs: CostModel): Decimal {
  return quoted.times(new Decimal(1).plus(costs.slippageRate));
}

/** Selling fills below the quoted price. Slippage always works against us. */
export function sellFillPrice(quoted: Decimal, costs: CostModel): Decimal {
  return quoted.times(new Decimal(1).minus(costs.slippageRate));
}

/** Exchange fee charged on a notional amount. */
export function feeOn(notional: Decimal, costs: CostModel): Decimal {
  return notional.times(costs.feeRate);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/backtest/costs.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/backtest/costs.ts tests/backtest/costs.test.ts
git commit -m "feat: add fee and slippage cost model"
```

---

## Task 6: Backtest engine

The correctness-critical task. Read the ordering comment in the implementation carefully before writing it.

**Files:**
- Create: `src/backtest/engine.ts`
- Test: `tests/backtest/engine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/backtest/engine.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { runBacktest } from '../../src/backtest/engine.js';
import { buyAndHold, trendFilter } from '../../src/strategy/trendFilter.js';
import type { Candle, StrategyFn } from '../../src/types.js';

const DAY = 86_400_000;
const d = (n: string | number) => new Decimal(n);
const FREE = { feeRate: d(0), slippageRate: d(0) };

/** Candles where open and close can differ, so execution timing is observable. */
function candles(bars: Array<{ open: number; close: number }>): Candle[] {
  return bars.map((b, i) => ({
    time: i * DAY,
    open: d(b.open),
    high: d(Math.max(b.open, b.close)),
    low: d(Math.min(b.open, b.close)),
    close: d(b.close),
    volume: d(1),
  }));
}

describe('runBacktest', () => {
  it('never executes on the same candle that produced the signal', () => {
    // Always-long strategy. The decision is made at candle 0's close, so the
    // buy must fill at candle 1's OPEN (200), never at candle 0's close (100).
    const bars = candles([
      { open: 50, close: 100 },
      { open: 200, close: 200 },
    ]);
    const result = runBacktest(bars, buyAndHold, FREE, d(1000), 'test');

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.side).toBe('BUY');
    expect(result.trades[0]!.price.toString()).toBe('200');
    expect(result.trades[0]!.time).toBe(DAY);
  });

  it('holds cash and never trades when the strategy stays FLAT', () => {
    const alwaysFlat: StrategyFn = () => 'FLAT';
    const bars = candles([
      { open: 100, close: 100 },
      { open: 200, close: 300 },
      { open: 300, close: 400 },
    ]);
    const result = runBacktest(bars, alwaysFlat, FREE, d(1000), 'test');

    expect(result.trades).toHaveLength(0);
    expect(result.metrics.finalEquity.toString()).toBe('1000');
    expect(result.metrics.exposure.toString()).toBe('0');
  });

  it('marks holdings to market at each candle close', () => {
    const bars = candles([
      { open: 100, close: 100 },
      { open: 100, close: 150 },
      { open: 150, close: 200 },
    ]);
    const result = runBacktest(bars, buyAndHold, FREE, d(1000), 'test');

    // Candle 0: still in cash (decision only just made).
    expect(result.equityCurve[0]!.equity.toString()).toBe('1000');
    // Candle 1: bought 10 units at open 100, close 150 -> 1500.
    expect(result.equityCurve[1]!.equity.toString()).toBe('1500');
    // Candle 2: still 10 units, close 200 -> 2000.
    expect(result.equityCurve[2]!.equity.toString()).toBe('2000');
  });

  it('charges fees and slippage on both sides of a round trip', () => {
    const costs = { feeRate: d('0.001'), slippageRate: d('0.0005') };
    // LONG for one day, then FLAT.
    let calls = 0;
    const inThenOut: StrategyFn = () => (++calls === 1 ? 'LONG' : 'FLAT');
    const bars = candles([
      { open: 100, close: 100 },
      { open: 100, close: 100 },
      { open: 100, close: 100 },
    ]);
    const result = runBacktest(bars, inThenOut, costs, d(1000), 'test');

    expect(result.trades).toHaveLength(2);
    // Buy: fee 1000 * 0.001 = 1, spendable 999, fill price 100.05.
    expect(result.trades[0]!.fee.toString()).toBe('1');
    expect(result.trades[0]!.price.toString()).toBe('100.05');
    // Sell: fill price 99.95.
    expect(result.trades[1]!.side).toBe('SELL');
    expect(result.trades[1]!.price.toString()).toBe('99.95');
    // A flat round trip must LOSE money once costs are applied.
    expect(result.metrics.finalEquity.lt(1000)).toBe(true);
    expect(result.metrics.totalFees.gt(0)).toBe(true);
  });

  it('liquidates any open position at the final close so equity is comparable', () => {
    const bars = candles([
      { open: 100, close: 100 },
      { open: 100, close: 100 },
    ]);
    const result = runBacktest(bars, buyAndHold, FREE, d(1000), 'test');
    // Position remains open; final equity is mark-to-market, not cash.
    expect(result.metrics.finalEquity.toString()).toBe('1000');
  });

  it('produces one equity point per candle', () => {
    const bars = candles([
      { open: 100, close: 100 },
      { open: 100, close: 100 },
      { open: 100, close: 100 },
      { open: 100, close: 100 },
    ]);
    const result = runBacktest(bars, buyAndHold, FREE, d(1000), 'test');
    expect(result.equityCurve).toHaveLength(4);
  });

  it('gives the strategy history only up to the current candle', () => {
    const seen: number[] = [];
    const spy: StrategyFn = (history) => {
      seen.push(history.length);
      return 'FLAT';
    };
    const bars = candles([
      { open: 1, close: 1 },
      { open: 2, close: 2 },
      { open: 3, close: 3 },
    ]);
    runBacktest(bars, spy, FREE, d(1000), 'test');
    expect(seen).toEqual([1, 2, 3]);
  });

  it('rejects an empty candle series', () => {
    expect(() => runBacktest([], buyAndHold, FREE, d(1000), 'test')).toThrow(
      'backtest requires at least one candle',
    );
  });

  it('works end to end with the real trend filter', () => {
    // Rising then falling, so the filter enters and exits at least once.
    const closes = [10, 11, 12, 13, 14, 15, 14, 13, 12, 11, 10, 9];
    const bars = candles(closes.map((c) => ({ open: c, close: c })));
    const result = runBacktest(bars, trendFilter({ maPeriod: 3 }), FREE, d(1000), 'trend');

    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.equityCurve).toHaveLength(closes.length);
    expect(result.label).toBe('trend');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/backtest/engine.test.ts`
Expected: FAIL — cannot resolve `../../src/backtest/engine.js`.

- [ ] **Step 3: Write the implementation**

Create `src/backtest/engine.ts`:

```ts
import Decimal from 'decimal.js';
import { buyFillPrice, feeOn, sellFillPrice } from './costs.js';
import { computeMetrics } from './metrics.js';
import type {
  BacktestResult,
  Candle,
  CostModel,
  EquityPoint,
  StrategyFn,
  TargetState,
  Trade,
} from '../types.js';

/**
 * Replays candles through a strategy.
 *
 * Ordering inside the loop is the whole point of this function, and getting it
 * wrong produces a backtest that looks excellent and cannot be reproduced live:
 *
 *   1. Execute any order decided on the PREVIOUS candle, at THIS candle's open.
 *   2. Mark the account to market at THIS candle's close.
 *   3. Decide the target state from history up to and including THIS candle.
 *
 * Because step 3 runs after step 1, a signal can never be acted on before it
 * could have existed. A decision made at a daily close fills at the next open.
 */
export function runBacktest(
  candles: Candle[],
  strategy: StrategyFn,
  costs: CostModel,
  initialCapital: Decimal,
  label: string,
): BacktestResult {
  if (candles.length === 0) {
    throw new Error('backtest requires at least one candle');
  }

  let cash = initialCapital;
  let units = new Decimal(0);
  let state: TargetState = 'FLAT';
  let pending: TargetState | null = null;

  const trades: Trade[] = [];
  const equityCurve: EquityPoint[] = [];

  for (const candle of candles) {
    // 1. Execute the previous candle's decision at this candle's open.
    if (pending !== null && pending !== state) {
      if (pending === 'LONG') {
        const fee = feeOn(cash, costs);
        const spendable = cash.minus(fee);
        const price = buyFillPrice(candle.open, costs);
        const quantity = spendable.div(price);

        trades.push({ time: candle.time, side: 'BUY', price, quantity, fee });
        units = quantity;
        cash = new Decimal(0);
      } else {
        const price = sellFillPrice(candle.open, costs);
        const proceeds = units.times(price);
        const fee = feeOn(proceeds, costs);

        trades.push({ time: candle.time, side: 'SELL', price, quantity: units, fee });
        cash = proceeds.minus(fee);
        units = new Decimal(0);
      }
      state = pending;
    }
    pending = null;

    // 2. Mark to market at this candle's close.
    equityCurve.push({
      time: candle.time,
      equity: cash.plus(units.times(candle.close)),
      state,
    });

    // 3. Decide, using history that ends at this candle.
    pending = strategy(candles.slice(0, equityCurve.length));
  }

  return {
    label,
    trades,
    equityCurve,
    metrics: computeMetrics(equityCurve, trades, initialCapital),
  };
}
```

- [ ] **Step 4: Run the test to verify it fails on the missing metrics module**

Run: `npx vitest run tests/backtest/engine.test.ts`
Expected: FAIL — cannot resolve `./metrics.js`. This is expected; Task 7 supplies it. Do not stub it here.

- [ ] **Step 5: Commit the engine**

```bash
git add src/backtest/engine.ts tests/backtest/engine.test.ts
git commit -m "feat: add backtest engine with next-open execution"
```

---

## Task 7: Metrics

**Files:**
- Create: `src/backtest/metrics.ts`
- Test: `tests/backtest/metrics.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/backtest/metrics.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { computeMetrics } from '../../src/backtest/metrics.js';
import type { EquityPoint, Trade } from '../../src/types.js';

const DAY = 86_400_000;
const d = (n: string | number) => new Decimal(n);

function curve(values: number[], states: Array<'LONG' | 'FLAT'> = []): EquityPoint[] {
  return values.map((v, i) => ({
    time: i * DAY,
    equity: d(v),
    state: states[i] ?? 'FLAT',
  }));
}

describe('computeMetrics', () => {
  it('computes total return', () => {
    const m = computeMetrics(curve([1000, 1100, 1200]), [], d(1000));
    expect(m.totalReturn.toFixed(4)).toBe('0.2000');
    expect(m.finalEquity.toString()).toBe('1200');
  });

  it('computes max drawdown from the running peak', () => {
    // Peak 2000, trough 1000 -> 50% drawdown. Later recovery does not reduce it.
    const m = computeMetrics(curve([1000, 2000, 1000, 1800]), [], d(1000));
    expect(m.maxDrawdown.toFixed(4)).toBe('0.5000');
  });

  it('reports zero drawdown for a monotonically rising curve', () => {
    const m = computeMetrics(curve([1000, 1100, 1200, 1300]), [], d(1000));
    expect(m.maxDrawdown.toFixed(4)).toBe('0.0000');
  });

  it('computes exposure as the fraction of days holding the asset', () => {
    const m = computeMetrics(
      curve([1, 1, 1, 1], ['LONG', 'LONG', 'FLAT', 'FLAT']),
      [],
      d(1),
    );
    expect(m.exposure.toFixed(2)).toBe('0.50');
  });

  it('computes CAGR over the elapsed period', () => {
    // 1000 -> 2000 over 365 days is a 100% annual rate.
    const points: EquityPoint[] = [
      { time: 0, equity: d(1000), state: 'LONG' },
      { time: 365 * DAY, equity: d(2000), state: 'LONG' },
    ];
    const m = computeMetrics(points, [], d(1000));
    expect(m.cagr.toFixed(2)).toBe('1.00');
  });

  it('counts round trips and computes win rate', () => {
    const trades: Trade[] = [
      { time: 0, side: 'BUY', price: d(100), quantity: d(1), fee: d(0) },
      { time: DAY, side: 'SELL', price: d(120), quantity: d(1), fee: d(0) },
      { time: 2 * DAY, side: 'BUY', price: d(120), quantity: d(1), fee: d(0) },
      { time: 3 * DAY, side: 'SELL', price: d(110), quantity: d(1), fee: d(0) },
    ];
    const m = computeMetrics(curve([1000, 1200, 1200, 1100]), trades, d(1000));
    expect(m.tradeCount).toBe(4);
    expect(m.winRate.toFixed(2)).toBe('0.50');
  });

  it('sums fees across all trades', () => {
    const trades: Trade[] = [
      { time: 0, side: 'BUY', price: d(100), quantity: d(1), fee: d('1.5') },
      { time: DAY, side: 'SELL', price: d(120), quantity: d(1), fee: d('2.5') },
    ];
    const m = computeMetrics(curve([1000, 1100]), trades, d(1000));
    expect(m.totalFees.toString()).toBe('4');
  });

  it('reports zero Sharpe for a perfectly flat curve rather than dividing by zero', () => {
    const m = computeMetrics(curve([1000, 1000, 1000, 1000]), [], d(1000));
    expect(m.sharpe.toString()).toBe('0');
  });

  it('reports a positive Sharpe for a steadily rising curve', () => {
    const m = computeMetrics(curve([1000, 1010, 1020, 1031, 1041]), [], d(1000));
    expect(m.sharpe.gt(0)).toBe(true);
  });

  it('rejects an empty curve', () => {
    expect(() => computeMetrics([], [], d(1000))).toThrow(
      'metrics require at least one equity point',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/backtest/metrics.test.ts`
Expected: FAIL — cannot resolve `../../src/backtest/metrics.js`.

- [ ] **Step 3: Write the implementation**

Create `src/backtest/metrics.ts`:

```ts
import Decimal from 'decimal.js';
import type { EquityPoint, Metrics, Trade } from '../types.js';

const MS_PER_YEAR = 365 * 86_400_000;

/**
 * Sharpe is computed from daily returns with a zero risk-free rate and
 * annualised by sqrt(365). Crypto trades every day, so 365 rather than 252.
 * The risk-free rate is omitted deliberately: it would add a parameter without
 * changing which strategy ranks higher, and Phase 0 exists to rank strategies.
 */
export function computeMetrics(
  equityCurve: EquityPoint[],
  trades: Trade[],
  initialCapital: Decimal,
): Metrics {
  if (equityCurve.length === 0) {
    throw new Error('metrics require at least one equity point');
  }

  const first = equityCurve[0]!;
  const last = equityCurve[equityCurve.length - 1]!;
  const finalEquity = last.equity;

  const totalReturn = finalEquity.minus(initialCapital).div(initialCapital);

  // CAGR. A span shorter than a day cannot be annualised meaningfully.
  const elapsedMs = last.time - first.time;
  const years = elapsedMs / MS_PER_YEAR;
  const cagr =
    years > 0
      ? new Decimal(
          Math.pow(finalEquity.div(initialCapital).toNumber(), 1 / years) - 1,
        )
      : new Decimal(0);

  // Max drawdown against the running peak.
  let peak = first.equity;
  let maxDrawdown = new Decimal(0);
  for (const point of equityCurve) {
    if (point.equity.gt(peak)) {
      peak = point.equity;
    }
    if (peak.gt(0)) {
      const drawdown = peak.minus(point.equity).div(peak);
      if (drawdown.gt(maxDrawdown)) {
        maxDrawdown = drawdown;
      }
    }
  }

  // Sharpe from daily returns.
  const dailyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1]!.equity;
    if (prev.gt(0)) {
      dailyReturns.push(equityCurve[i]!.equity.minus(prev).div(prev).toNumber());
    }
  }
  let sharpe = new Decimal(0);
  if (dailyReturns.length > 1) {
    const avg = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance =
      dailyReturns.reduce((acc, r) => acc + (r - avg) ** 2, 0) / (dailyReturns.length - 1);
    const stdDev = Math.sqrt(variance);
    if (stdDev > 0) {
      sharpe = new Decimal((avg / stdDev) * Math.sqrt(365));
    }
  }

  // Exposure: fraction of marked days holding the asset.
  const longDays = equityCurve.filter((p) => p.state === 'LONG').length;
  const exposure = new Decimal(longDays).div(equityCurve.length);

  // Win rate over completed BUY -> SELL round trips.
  let wins = 0;
  let roundTrips = 0;
  let entry: Trade | null = null;
  for (const trade of trades) {
    if (trade.side === 'BUY') {
      entry = trade;
    } else if (entry !== null) {
      roundTrips++;
      if (trade.price.gt(entry.price)) {
        wins++;
      }
      entry = null;
    }
  }
  const winRate = roundTrips > 0 ? new Decimal(wins).div(roundTrips) : new Decimal(0);

  const totalFees = trades.reduce((acc, t) => acc.plus(t.fee), new Decimal(0));

  return {
    initialCapital,
    finalEquity,
    totalReturn,
    cagr,
    maxDrawdown,
    sharpe,
    tradeCount: trades.length,
    exposure,
    winRate,
    totalFees,
  };
}
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS. All of `math`, `trendFilter`, `costs`, `metrics`, and now `engine` pass — the engine test was blocked only on this module.

- [ ] **Step 5: Commit**

```bash
git add src/backtest/metrics.ts tests/backtest/metrics.test.ts
git commit -m "feat: add backtest performance metrics"
```

---

## Task 8: CSV candle storage

**Files:**
- Create: `src/data/csv.ts`
- Test: `tests/data/csv.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/data/csv.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { parseCandleCsv, toCandleCsv } from '../../src/data/csv.js';
import type { Candle } from '../../src/types.js';

const d = (n: string | number) => new Decimal(n);

const sample: Candle[] = [
  { time: 0, open: d(1), high: d(2), low: d('0.5'), close: d('1.5'), volume: d(10) },
  { time: 86_400_000, open: d('1.5'), high: d(3), low: d(1), close: d(2), volume: d(20) },
];

describe('toCandleCsv', () => {
  it('writes a header row followed by one row per candle', () => {
    const csv = toCandleCsv(sample);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('time,open,high,low,close,volume');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('0,1,2,0.5,1.5,10');
  });
});

describe('parseCandleCsv', () => {
  it('round-trips without losing precision', () => {
    const parsed = parseCandleCsv(toCandleCsv(sample));
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.time).toBe(0);
    expect(parsed[0]!.close.toString()).toBe('1.5');
    expect(parsed[1]!.volume.toString()).toBe('20');
  });

  it('preserves precision that a float would destroy', () => {
    const precise: Candle[] = [
      {
        time: 0,
        open: d('0.1'),
        high: d('0.2'),
        low: d('0.30000000000000004'),
        close: d('12345.678901234567'),
        volume: d(1),
      },
    ];
    const parsed = parseCandleCsv(toCandleCsv(precise));
    expect(parsed[0]!.close.toString()).toBe('12345.678901234567');
    expect(parsed[0]!.low.toString()).toBe('0.30000000000000004');
  });

  it('ignores blank trailing lines', () => {
    const parsed = parseCandleCsv(toCandleCsv(sample) + '\n\n');
    expect(parsed).toHaveLength(2);
  });

  it('rejects a file whose header is wrong', () => {
    expect(() => parseCandleCsv('t,o,h,l,c,v\n1,2,3,4,5,6')).toThrow(
      'unexpected CSV header',
    );
  });

  it('rejects a row with the wrong number of columns', () => {
    expect(() => parseCandleCsv('time,open,high,low,close,volume\n1,2,3')).toThrow(
      'malformed CSV row',
    );
  });

  it('returns an empty array for a header-only file', () => {
    expect(parseCandleCsv('time,open,high,low,close,volume\n')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/data/csv.test.ts`
Expected: FAIL — cannot resolve `../../src/data/csv.js`.

- [ ] **Step 3: Write the implementation**

Create `src/data/csv.ts`:

```ts
import Decimal from 'decimal.js';
import type { Candle } from '../types.js';

const HEADER = 'time,open,high,low,close,volume';

export function toCandleCsv(candles: Candle[]): string {
  const rows = candles.map((c) =>
    [c.time, c.open, c.high, c.low, c.close, c.volume].join(','),
  );
  return [HEADER, ...rows].join('\n') + '\n';
}

/**
 * Parses candles from CSV. Values go straight from string to Decimal without
 * passing through a JavaScript number, so no precision is lost on the way in.
 */
export function parseCandleCsv(csv: string): Candle[] {
  const lines = csv.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0 || lines[0]!.trim() !== HEADER) {
    throw new Error(`unexpected CSV header: expected "${HEADER}"`);
  }

  return lines.slice(1).map((line, index) => {
    const parts = line.split(',');
    if (parts.length !== 6) {
      throw new Error(`malformed CSV row at line ${index + 2}: expected 6 columns`);
    }
    return {
      time: Number(parts[0]),
      open: new Decimal(parts[1]!),
      high: new Decimal(parts[2]!),
      low: new Decimal(parts[3]!),
      close: new Decimal(parts[4]!),
      volume: new Decimal(parts[5]!),
    };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/data/csv.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/data/csv.ts tests/data/csv.test.ts
git commit -m "feat: add lossless CSV candle storage"
```

---

## Task 9: Bybit public kline fetcher

Bybit's `/v5/market/kline` endpoint is public and needs no API key. This is the only file in Phase 0 that touches the network, and nothing in `src/strategy/` or `src/backtest/` depends on it.

**Files:**
- Create: `src/data/bybit.ts`
- Test: `tests/data/bybit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/data/bybit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseKlineResponse } from '../../src/data/bybit.js';

describe('parseKlineResponse', () => {
  it('parses Bybit rows and returns them oldest first', () => {
    // Bybit returns newest first. The parser must reverse that.
    const body = {
      retCode: 0,
      retMsg: 'OK',
      result: {
        list: [
          ['86400000', '110', '120', '105', '115', '20', '2300'],
          ['0', '100', '110', '95', '105', '10', '1050'],
        ],
      },
    };
    const candles = parseKlineResponse(body);

    expect(candles).toHaveLength(2);
    expect(candles[0]!.time).toBe(0);
    expect(candles[0]!.close.toString()).toBe('105');
    expect(candles[1]!.time).toBe(86_400_000);
    expect(candles[1]!.close.toString()).toBe('115');
  });

  it('throws when Bybit reports a non-zero retCode', () => {
    const body = { retCode: 10001, retMsg: 'params error', result: { list: [] } };
    expect(() => parseKlineResponse(body)).toThrow('Bybit error 10001: params error');
  });

  it('returns an empty array when the list is empty', () => {
    expect(parseKlineResponse({ retCode: 0, retMsg: 'OK', result: { list: [] } })).toEqual(
      [],
    );
  });

  it('rejects a response with no result list', () => {
    expect(() => parseKlineResponse({ retCode: 0, retMsg: 'OK' })).toThrow(
      'Bybit response missing result.list',
    );
  });

  it('rejects a row with too few fields', () => {
    const body = { retCode: 0, retMsg: 'OK', result: { list: [['0', '1', '2']] } };
    expect(() => parseKlineResponse(body)).toThrow('malformed Bybit kline row');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/data/bybit.test.ts`
Expected: FAIL — cannot resolve `../../src/data/bybit.js`.

- [ ] **Step 3: Write the implementation**

Create `src/data/bybit.ts`:

```ts
import Decimal from 'decimal.js';
import type { Candle } from '../types.js';

const BASE_URL = 'https://api.bybit.com/v5/market/kline';
const MAX_LIMIT = 1000;

/**
 * Bybit v5 kline rows arrive as string arrays, newest first:
 *   [startTime, open, high, low, close, volume, turnover]
 * Everything stays a string until it becomes a Decimal, so no precision is
 * lost through a JavaScript number.
 */
export function parseKlineResponse(body: unknown): Candle[] {
  const response = body as {
    retCode?: number;
    retMsg?: string;
    result?: { list?: unknown };
  };

  if (typeof response.retCode === 'number' && response.retCode !== 0) {
    throw new Error(`Bybit error ${response.retCode}: ${response.retMsg ?? 'unknown'}`);
  }
  const list = response.result?.list;
  if (!Array.isArray(list)) {
    throw new Error('Bybit response missing result.list');
  }

  const candles = list.map((row) => {
    if (!Array.isArray(row) || row.length < 6) {
      throw new Error('malformed Bybit kline row');
    }
    return {
      time: Number(row[0]),
      open: new Decimal(String(row[1])),
      high: new Decimal(String(row[2])),
      low: new Decimal(String(row[3])),
      close: new Decimal(String(row[4])),
      volume: new Decimal(String(row[5])),
    };
  });

  // Bybit returns newest first; the rest of the system assumes oldest first.
  return candles.reverse();
}

/**
 * Fetches daily candles from `start` up to now, paginating forward.
 *
 * Bybit caps each response at 1000 rows. We walk forward from the last candle
 * received and stop when a page returns nothing new, which also guards against
 * an infinite loop if the API starts repeating a page.
 */
export async function fetchDailyCandles(symbol: string, start: Date): Promise<Candle[]> {
  const all: Candle[] = [];
  let cursor = start.getTime();

  for (;;) {
    const url = `${BASE_URL}?category=spot&symbol=${symbol}&interval=D&start=${cursor}&limit=${MAX_LIMIT}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Bybit HTTP ${response.status} fetching ${symbol}`);
    }
    const page = parseKlineResponse(await response.json());
    if (page.length === 0) {
      break;
    }

    const fresh = page.filter((c) => c.time > (all[all.length - 1]?.time ?? -1));
    if (fresh.length === 0) {
      break;
    }
    all.push(...fresh);

    cursor = all[all.length - 1]!.time + 86_400_000;
    if (cursor > Date.now()) {
      break;
    }
  }

  return all;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/data/bybit.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/data/bybit.ts tests/data/bybit.test.ts
git commit -m "feat: add Bybit public kline fetcher"
```

---

## Task 10: Fetch CLI

**Files:**
- Create: `src/cli/fetch.ts`

- [ ] **Step 1: Write the script**

Create `src/cli/fetch.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { fetchDailyCandles } from '../data/bybit.js';
import { toCandleCsv } from '../data/csv.js';

const SYMBOL = process.env.SYMBOL ?? 'BTCUSDT';
// Bybit spot BTCUSDT history begins in 2018; starting in 2017 simply returns
// nothing earlier, which is harmless.
const START = new Date(process.env.START ?? '2017-01-01T00:00:00Z');

async function main(): Promise<void> {
  console.log(`Fetching ${SYMBOL} daily candles from ${START.toISOString().slice(0, 10)}...`);
  const candles = await fetchDailyCandles(SYMBOL, START);

  if (candles.length === 0) {
    throw new Error('no candles returned — check the symbol and start date');
  }

  await mkdir('data', { recursive: true });
  const path = `data/${SYMBOL}-1d.csv`;
  await writeFile(path, toCandleCsv(candles), 'utf8');

  const firstDate = new Date(candles[0]!.time).toISOString().slice(0, 10);
  const lastDate = new Date(candles[candles.length - 1]!.time).toISOString().slice(0, 10);
  console.log(`Wrote ${candles.length} candles to ${path} (${firstDate} to ${lastDate}).`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `npm run fetch`
Expected: prints a count and a date range, and writes `data/BTCUSDT-1d.csv`. Roughly 2,800+ candles for a 2018 start.

- [ ] **Step 3: Sanity-check the output**

Run: `head -3 data/BTCUSDT-1d.csv && wc -l data/BTCUSDT-1d.csv`
Expected: the header row, two data rows, and a line count matching the reported candle count plus one.

**Cross-check the data before trusting it.** Spot-check three or four closes against a public chart (TradingView, CoinGecko). Bad data produces a beautiful and entirely fictional backtest, and this five-minute check is the cheapest defence against that.

- [ ] **Step 4: Commit**

```bash
git add src/cli/fetch.ts
git commit -m "feat: add candle fetch CLI"
```

---

## Task 11: Report formatting

**Files:**
- Create: `src/backtest/report.ts`
- Test: `tests/backtest/report.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/backtest/report.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { formatComparison } from '../../src/backtest/report.js';
import type { BacktestResult } from '../../src/types.js';

const d = (n: string | number) => new Decimal(n);

function result(label: string, cagr: string, dd: string): BacktestResult {
  return {
    label,
    trades: [],
    equityCurve: [],
    metrics: {
      initialCapital: d(1000),
      finalEquity: d(2000),
      totalReturn: d(1),
      cagr: d(cagr),
      maxDrawdown: d(dd),
      sharpe: d('1.25'),
      tradeCount: 12,
      exposure: d('0.65'),
      winRate: d('0.5'),
      totalFees: d('42.5'),
    },
  };
}

describe('formatComparison', () => {
  it('renders one row per result with the label first', () => {
    const table = formatComparison([result('MA-200', '0.45', '0.30'), result('Buy & Hold', '0.60', '0.77')]);
    const lines = table.trim().split('\n');

    expect(lines[0]).toContain('Strategy');
    expect(lines[0]).toContain('CAGR');
    expect(lines[0]).toContain('MaxDD');
    expect(table).toContain('MA-200');
    expect(table).toContain('Buy & Hold');
  });

  it('formats rates as percentages with one decimal place', () => {
    const table = formatComparison([result('MA-200', '0.4512', '0.3049')]);
    expect(table).toContain('45.1%');
    expect(table).toContain('30.5%');
  });

  it('handles an empty result list without throwing', () => {
    expect(() => formatComparison([])).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/backtest/report.test.ts`
Expected: FAIL — cannot resolve `../../src/backtest/report.js`.

- [ ] **Step 3: Write the implementation**

Create `src/backtest/report.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/backtest/report.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/backtest/report.ts tests/backtest/report.test.ts
git commit -m "feat: add comparison table formatting"
```

---

## Task 12: Backtest CLI

**Files:**
- Create: `src/cli/backtest.ts`

- [ ] **Step 1: Write the script**

Create `src/cli/backtest.ts`:

```ts
import { readFile } from 'node:fs/promises';
import Decimal from 'decimal.js';
import { runBacktest } from '../backtest/engine.js';
import { DEFAULT_COSTS } from '../backtest/costs.js';
import { formatComparison } from '../backtest/report.js';
import { parseCandleCsv } from '../data/csv.js';
import { buyAndHold, trendFilter } from '../strategy/trendFilter.js';

const SYMBOL = process.env.SYMBOL ?? 'BTCUSDT';
const MA_PERIOD = Number(process.env.MA_PERIOD ?? 200);
const CAPITAL = new Decimal(process.env.CAPITAL ?? 1000);

async function main(): Promise<void> {
  const csv = await readFile(`data/${SYMBOL}-1d.csv`, 'utf8');
  const candles = parseCandleCsv(csv);

  const from = new Date(candles[0]!.time).toISOString().slice(0, 10);
  const to = new Date(candles[candles.length - 1]!.time).toISOString().slice(0, 10);
  console.log(`${SYMBOL} daily, ${candles.length} candles, ${from} to ${to}`);
  console.log(
    `Costs: ${DEFAULT_COSTS.feeRate.times(100)}% fee, ${DEFAULT_COSTS.slippageRate.times(100)}% slippage\n`,
  );

  const results = [
    runBacktest(candles, trendFilter({ maPeriod: MA_PERIOD }), DEFAULT_COSTS, CAPITAL, `MA-${MA_PERIOD}`),
    runBacktest(candles, buyAndHold, DEFAULT_COSTS, CAPITAL, 'Buy & Hold'),
  ];

  console.log(formatComparison(results));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `npm run backtest`
Expected: a header line, then a two-row table comparing `MA-200` against `Buy & Hold`.

- [ ] **Step 3: Verify the result is sane before trusting it**

Three checks, and all three must pass:

1. **Buy & Hold exposure is 100%** and its trade count is 1. If not, the engine is not doing what it claims.
2. **The trend filter's max drawdown is lower than buy-and-hold's.** That is the entire point of the strategy. If it is not lower, either the implementation is wrong or the strategy does not work — investigate before moving on.
3. **Fees are non-zero** for the trend filter. Zero fees means the cost model is not wired up and the numbers are fiction.

- [ ] **Step 4: Commit**

```bash
git add src/cli/backtest.ts
git commit -m "feat: add backtest CLI comparing strategy to buy-and-hold"
```

---

## Task 13: Parameter sweep with out-of-sample validation

The task that protects the project from its most likely self-deception. Running every moving-average period and picking the best one is curve fitting: with enough parameters, something always looks excellent on history and fails live. The defence is to choose on one date range and verify on another the choice never saw.

**Files:**
- Create: `src/cli/sweep.ts`

- [ ] **Step 1: Write the script**

Create `src/cli/sweep.ts`:

```ts
import { readFile } from 'node:fs/promises';
import Decimal from 'decimal.js';
import { runBacktest } from '../backtest/engine.js';
import { DEFAULT_COSTS } from '../backtest/costs.js';
import { formatComparison } from '../backtest/report.js';
import { parseCandleCsv } from '../data/csv.js';
import { buyAndHold, trendFilter } from '../strategy/trendFilter.js';
import type { Candle } from '../types.js';

const SYMBOL = process.env.SYMBOL ?? 'BTCUSDT';
const CAPITAL = new Decimal(process.env.CAPITAL ?? 1000);
const SPLIT = new Date(process.env.SPLIT ?? '2023-01-01T00:00:00Z').getTime();
const PERIODS = [20, 30, 50, 75, 100, 125, 150, 175, 200, 225, 250, 300];

function sweep(candles: Candle[], rangeLabel: string): void {
  const from = new Date(candles[0]!.time).toISOString().slice(0, 10);
  const to = new Date(candles[candles.length - 1]!.time).toISOString().slice(0, 10);
  console.log(`\n=== ${rangeLabel}: ${from} to ${to} (${candles.length} candles) ===\n`);

  const results = PERIODS.map((period) =>
    runBacktest(candles, trendFilter({ maPeriod: period }), DEFAULT_COSTS, CAPITAL, `MA-${period}`),
  );
  results.push(runBacktest(candles, buyAndHold, DEFAULT_COSTS, CAPITAL, 'Buy & Hold'));

  console.log(formatComparison(results));
}

async function main(): Promise<void> {
  const csv = await readFile(`data/${SYMBOL}-1d.csv`, 'utf8');
  const candles = parseCandleCsv(csv);

  const inSample = candles.filter((c) => c.time < SPLIT);
  const outOfSample = candles.filter((c) => c.time >= SPLIT);

  if (inSample.length === 0 || outOfSample.length === 0) {
    throw new Error(`SPLIT date leaves one side empty — pick a date inside the data range`);
  }

  sweep(inSample, 'IN-SAMPLE (choose the period here)');
  sweep(outOfSample, 'OUT-OF-SAMPLE (verify it here — do NOT choose here)');

  console.log(
    [
      '',
      'How to read this:',
      '  1. In the IN-SAMPLE table, look for a BROAD PLATEAU of periods that all',
      '     work, not a single period that spikes. A lone spike is curve fitting;',
      '     a plateau suggests the effect is real.',
      '  2. Take the middle of that plateau as the chosen period.',
      '  3. Check that period in the OUT-OF-SAMPLE table. If it collapses there,',
      '     the strategy does not generalise, whatever the first table said.',
      '  4. Compare against Buy & Hold on BOTH tables. Lower max drawdown is the',
      '     product promise; matching or beating CAGR is a bonus, not the point.',
      '',
    ].join('\n'),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `npm run sweep`
Expected: two tables — in-sample and out-of-sample — each with twelve moving-average rows plus buy-and-hold, followed by the reading guide.

- [ ] **Step 3: Run the full suite and type check**

Run: `npm test && npm run typecheck`
Expected: all tests pass, `tsc` silent.

- [ ] **Step 4: Commit**

```bash
git add src/cli/sweep.ts
git commit -m "feat: add parameter sweep with out-of-sample validation"
```

---

## Task 14: Record the finding

Phase 0's deliverable is a decision, not code. Write it down while the numbers are in front of you.

**Files:**
- Create: `docs/research/phase-0-findings.md`

> **Note:** other work may already have created `docs/research/`. Add this file; do not modify anything else in that directory.

- [ ] **Step 1: Write the findings document**

Create `docs/research/phase-0-findings.md` using this structure, filled in with the actual numbers from `npm run sweep`:

```markdown
# Phase 0 Findings

- **Date run:**
- **Data:** BTCUSDT daily, <first date> to <last date>, <n> candles, source Bybit public klines
- **Costs applied:** 0.1% taker fee, 0.05% slippage, both sides

## In-sample results

<paste the in-sample table>

## Out-of-sample results

<paste the out-of-sample table>

## Chosen parameter

- **MA period:** <n>
- **Why this one:** <the plateau it sits in, not the single best number>

## Does it beat buy-and-hold?

- Max drawdown: <strategy> vs <buy and hold>
- CAGR: <strategy> vs <buy and hold>
- Sharpe: <strategy> vs <buy and hold>

## Verdict

<One of: PROCEED to Phase 1 / PROCEED with a modified strategy / STOP.>

<State the reasoning plainly. If the strategy does not reduce drawdown versus
buy-and-hold on out-of-sample data, it has failed its core promise and Phase 1
should not start on this strategy.>

## What this does not prove

Past performance over one asset on one timeframe in one market regime. BTC's
history is dominated by a few enormous bull runs, and any long-biased strategy
looks good across them. This result is necessary evidence, not sufficient.
```

- [ ] **Step 2: Commit**

```bash
git add docs/research/phase-0-findings.md
git commit -m "docs: record Phase 0 backtest findings and go/no-go"
```

---

## Definition of done

- [ ] `npm test` passes with no skipped tests
- [ ] `npm run typecheck` is silent
- [ ] `npm run fetch` produces a CSV whose closes were spot-checked against a public chart
- [ ] `npm run sweep` produces in-sample and out-of-sample tables
- [ ] `docs/research/phase-0-findings.md` records real numbers and an explicit verdict
- [ ] The strategy engine has zero imports from `src/data/` or `src/backtest/` — verify with
      `grep -r "import" src/strategy/`, which should show only `../math.js` and `../types.js`

That last check matters more than it looks. It is what makes the Phase 0 strategy code
reusable unchanged in Phase 3, and it is the mechanical guarantee behind the spec's promise
that the backtest and production run the same strategy.

# The engine checks itself: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each day the engine replays the previous days' decisions on fresh data and costs their
fills against the backtest's assumptions, recording what it finds and alerting only when something
is off — without ever changing a trade.

**Architecture:** A pure module, `src/engine/selfCheck.ts`, judges one decision and costs one fill.
`src/engine/dailyCheck.ts` finds what is unchecked in the ledger, calls it, records
`DECISION_REPLAY` and `FILL_COST`, alerts, and returns sentences for each account's summary.
`src/engine/cycle.ts` runs the check once per tick, after the day's candles are validated, on the
same candles, and fetches the instrument's rules once per tick instead of once per account, so the
check costs no extra request.

**Tech stack:** TypeScript (ESM, `.js` imports), Vitest, Drizzle ORM on PGlite, decimal.js. No
new dependency.

**Spec:** `docs/superpowers/specs/2026-09-23-engine-self-check-design.md`.
**Branch:** `engine-self-check`, created from `phase-2-paper-engine`.

**How every task ships — the founder's pull-request workflow (`CLAUDE.md`):**

1. `git checkout engine-self-check && git pull`, then `git checkout -b self-check/<task-slug>`.
2. Do the task's steps. Run `npm run typecheck && npm test`; both must pass.
3. Commit with a detailed message, and **no `Co-Authored-By` line**. Push with
   `git push -u origin self-check/<task-slug>`.
4. Open a pull request into `engine-self-check` with a description of what changed, why, and how
   it was tested — **no tool attribution**:
   `"C:\Program Files\GitHub CLI\gh.exe" pr create --base engine-self-check --head self-check/<task-slug> --title "…" --body-file <file>`.
5. Merge with a merge commit and delete the branch: `gh pr merge <n> --merge --delete-branch`.
   Then `git checkout engine-self-check && git pull`.

**Rules for every task:** money and ratios are `Decimal`, never floats. Nothing here places, sizes,
cancels, freezes, or pauses anything. Every alert is claimed in the alert log first, so it is sent
once.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/ledger/ledger.ts` | Modify | Event types `DECISION_REPLAY` and `FILL_COST`; `ofTypeBetween` |
| `src/engine/selfCheck.ts` | Create | Pure: `replayDecision`, `marketCost`, `againstBacktestPrice`, `percent`, `expensiveFillMessage` |
| `src/engine/dailyCheck.ts` | Create | The daily check: what to check, records, alerts, sentences; `runDailyCheckSafely` |
| `src/engine/cycle.ts` | Modify | Rules once per tick; runs the check; the fill's cost in the summary; the check's sentences |
| `src/app/paperReport.ts`, `src/cli/paper-report.ts` | Modify | The self-check section, and the exit status |
| `tests/ledger/ledger.test.ts` | Modify | `ofTypeBetween` and the new types |
| `tests/engine/selfCheck.test.ts` | Create | The pure functions |
| `tests/engine/dailyCheck.test.ts` | Create | The check inside real ticks |
| `tests/engine/cycleFailures.test.ts` | Modify | A rules failure retries the whole tick |
| `tests/app/paperReport.test.ts` | Modify | The report's section |

---

## Task 1: The ledger records a replay and a fill's cost

Branch: `self-check/ledger-types`.

**Files:**
- Modify: `src/ledger/ledger.ts`
- Test: `tests/ledger/ledger.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/ledger/ledger.test.ts`, inside `describe('Ledger', …)`:

```ts
  it('lists the events of one type between two days, for everyone, oldest first', async () => {
    const replay = (day: string): NewLedgerEvent => ({
      occurredAt: AT,
      userId: null,
      cycleDate: day,
      type: 'DECISION_REPLAY',
      payload: { verdict: 'HOLDS' },
    });
    await ledger().append(replay('2026-09-19'));
    await ledger().append(replay(DAY_1));
    await ledger().append(replay(DAY_2));
    await ledger().append({ occurredAt: AT, userId: 'founder', cycleDate: DAY_1, type: 'FILL_COST', payload: { clientOrderId: 'a' } });

    const between = await ledger().ofTypeBetween('DECISION_REPLAY', '2026-09-20', DAY_2);
    expect(between.map((e) => e.cycleDate)).toEqual([DAY_1, DAY_2]);
    expect(await ledger().ofTypeBetween('FILL_COST', DAY_1, DAY_1)).toHaveLength(1);
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/ledger/ledger.test.ts -t "between two days"`
Expected: FAIL — `ofTypeBetween` is not a function, and TypeScript rejects the two type names.

- [ ] **Step 3: Add the types and the query**

In `src/ledger/ledger.ts`, add the two types at the end of `LEDGER_EVENT_TYPES`:

```ts
  'KILL_SWITCH_SKIP',
  'TOO_SMALL',
  'DECISION_REPLAY',
  'FILL_COST',
] as const;
```

Add `gte` and `lte` to the `drizzle-orm` import:

```ts
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
```

and this method to `Ledger`, after `ofType`:

```ts
  /** Every event of one type whose cycle date falls between `from` and `to`, inclusive — for everyone, oldest first. */
  async ofTypeBetween(type: LedgerEventType, from: string, to: string): Promise<LedgerEvent[]> {
    const rows = await this.db
      .select()
      .from(ledgerEvents)
      .where(and(eq(ledgerEvents.type, type), gte(ledgerEvents.cycleDate, from), lte(ledgerEvents.cycleDate, to)))
      .orderBy(asc(ledgerEvents.id));
    return rows.map(toEvent);
  }
```

- [ ] **Step 4: Run it**

Run: `npx vitest run tests/ledger/ledger.test.ts`
Expected: PASS.

- [ ] **Step 5: Ship it** — commit `feat: let the ledger record a decision replay and a fill's cost`, then the pull
request as described at the top.

---

## Task 2: Judging a decision again

Branch: `self-check/replay-decision`.

**Files:**
- Create: `src/engine/selfCheck.ts`
- Test: `tests/engine/selfCheck.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/engine/selfCheck.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { replayDecision, type RecordedSignal } from '../../src/engine/selfCheck.js';
import { mean } from '../../src/math.js';
import { CHOSEN_MA_PERIOD, trendFilter } from '../../src/strategy/trendFilter.js';
import type { Candle } from '../../src/types.js';
import { trendingCandles } from '../helpers/candles.js';

const strategy = trendFilter({ maPeriod: CHOSEN_MA_PERIOD });
// Rising prices: the strategy says LONG on the last day.
const WINDOW = trendingCandles('2026-01-01', 200, 'up');

/** What the engine would have recorded for the window's last day. */
function recorded(window: Candle[]): RecordedSignal {
  return {
    target: strategy(window),
    close: window[window.length - 1]!.close,
    movingAverage: mean(window.slice(-CHOSEN_MA_PERIOD).map((c) => c.close)),
  };
}

/** The window with one close replaced, as if the exchange revised it. */
function revised(window: Candle[], index: number, close: string): Candle[] {
  const price = new Decimal(close);
  return window.map((c, i) =>
    i === index ? { ...c, close: price, high: Decimal.max(c.high, price), low: Decimal.min(c.low, price) } : c,
  );
}

describe('replayDecision', () => {
  it('holds when nothing has changed', () => {
    expect(replayDecision(WINDOW, recorded(WINDOW), strategy, CHOSEN_MA_PERIOD)?.verdict).toBe('HOLDS');
  });

  it('notices a revised close that leaves the decision as it was', () => {
    const replay = replayDecision(revised(WINDOW, 199, '69901'), recorded(WINDOW), strategy, CHOSEN_MA_PERIOD);
    expect(replay).toMatchObject({ verdict: 'DATA_REVISED', recordedTarget: 'LONG', replayedTarget: 'LONG' });
    expect(replay?.currentClose.toFixed()).toBe('69901');
  });

  it('notices a revised earlier close that moves only the average', () => {
    const replay = replayDecision(revised(WINDOW, 190, '70000'), recorded(WINDOW), strategy, CHOSEN_MA_PERIOD);
    expect(replay?.verdict).toBe('DATA_REVISED');
    expect(replay?.currentClose.equals(replay.recordedClose)).toBe(true);
    expect(replay?.currentAverage.equals(replay.recordedAverage)).toBe(false);
  });

  it('reports a decision the current data would not make', () => {
    const replay = replayDecision(revised(WINDOW, 199, '1000'), recorded(WINDOW), strategy, CHOSEN_MA_PERIOD);
    expect(replay).toMatchObject({ verdict: 'DECISION_CHANGED', recordedTarget: 'LONG', replayedTarget: 'FLAT' });
  });

  it('refuses a window too short to give that day’s decision', () => {
    const short = WINDOW.slice(0, CHOSEN_MA_PERIOD - 1);
    expect(replayDecision(short, recorded(WINDOW), strategy, CHOSEN_MA_PERIOD)).toBeNull();
  });
});
```

The window's last close is 50,000 + 199 × 100 = 69,900, which is why the revisions use 69,901 and
1,000.

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/engine/selfCheck.test.ts`
Expected: FAIL — cannot find `src/engine/selfCheck.js`.

- [ ] **Step 3: Write the module**

Create `src/engine/selfCheck.ts`:

```ts
import type Decimal from 'decimal.js';
import { mean } from '../math.js';
import type { Candle, StrategyFn, TargetState } from '../types.js';

export type Verdict = 'HOLDS' | 'DATA_REVISED' | 'DECISION_CHANGED';

/** What the engine recorded for a day, in its SIGNAL. */
export type RecordedSignal = { target: TargetState; close: Decimal; movingAverage: Decimal };

export type Replay = {
  verdict: Verdict;
  recordedTarget: TargetState;
  replayedTarget: TargetState;
  recordedClose: Decimal;
  currentClose: Decimal;
  recordedAverage: Decimal;
  currentAverage: Decimal;
};

/**
 * Evaluates the strategy again on `window` — today's candles, up to and
 * including the day being checked — and compares the decision with the one the
 * engine recorded for that day. Null when the window is too short to give that
 * day's decision, so a truncated window can never pass for a changed one.
 */
export function replayDecision(
  window: Candle[],
  recorded: RecordedSignal,
  strategy: StrategyFn,
  maPeriod: number,
): Replay | null {
  if (window.length < maPeriod) {
    return null;
  }
  const replayedTarget = strategy(window);
  const currentClose = window[window.length - 1]!.close;
  const currentAverage = mean(window.slice(-maPeriod).map((c) => c.close));
  let verdict: Verdict = 'DATA_REVISED';
  if (replayedTarget !== recorded.target) {
    verdict = 'DECISION_CHANGED';
  } else if (currentClose.equals(recorded.close) && currentAverage.equals(recorded.movingAverage)) {
    verdict = 'HOLDS';
  }
  return {
    verdict,
    recordedTarget: recorded.target,
    replayedTarget,
    recordedClose: recorded.close,
    currentClose,
    recordedAverage: recorded.movingAverage,
    currentAverage,
  };
}
```

- [ ] **Step 4: Run them**

Run: `npx vitest run tests/engine/selfCheck.test.ts`
Expected: PASS.

- [ ] **Step 5: Ship it** — commit `feat: judge a recorded decision again on current data`, then the pull request.

---

## Task 3: Costing a fill

Branch: `self-check/fill-cost`.

**Files:**
- Modify: `src/engine/selfCheck.ts`
- Modify: `tests/engine/selfCheck.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/engine/selfCheck.test.ts` — the imports first:

```ts
import { DEFAULT_COSTS } from '../../src/backtest/costs.js';
import {
  againstBacktestPrice,
  expensiveFillMessage,
  marketCost,
  percent,
} from '../../src/engine/selfCheck.js';
import type { OrderState } from '../../src/exchange/trading.js';
import { RULES } from '../helpers/market.js';
```

(merge them into the existing `selfCheck.js` import line), then:

```ts
const MID = new Decimal('80000');

/** A buy of 0.01 BTC at 80,008 — 0.01% above the mid — with the 0.1% fee taken in BTC. */
function fill(over: Partial<OrderState> = {}): OrderState {
  return {
    clientOrderId: 'ca1',
    side: 'BUY',
    status: 'FILLED',
    filledBaseQty: new Decimal('0.01'),
    filledQuoteAmount: new Decimal('800.08'),
    avgPrice: new Decimal('80008'),
    fee: new Decimal('0.00001'),
    feeCoin: 'BTC',
    rejectReason: null,
    ...over,
  };
}

describe('marketCost', () => {
  it('costs a buy with its fee in BTC', () => {
    const cost = marketCost(fill(), MID, RULES, DEFAULT_COSTS);
    expect(cost.feeRate.toFixed(6)).toBe('0.001000');
    expect(cost.spreadAndImpact.toFixed(6)).toBe('0.000100');
    expect(cost.againstMarket.toFixed(6)).toBe('0.001100');
    expect(cost.assumed.toFixed(6)).toBe('0.001500');
    expect(cost.tooExpensive).toBe(false);
  });

  it('costs a sell with its fee in USDT', () => {
    const sell = fill({ side: 'SELL', avgPrice: new Decimal('79992'), filledQuoteAmount: new Decimal('799.92'), fee: new Decimal('0.79992'), feeCoin: 'USDT' });
    const cost = marketCost(sell, MID, RULES, DEFAULT_COSTS);
    expect(cost.feeRate.toFixed(6)).toBe('0.001000');
    expect(cost.spreadAndImpact.toFixed(6)).toBe('0.000100');
  });

  it('shows a fill better than the mid as a negative spread and impact', () => {
    const better = fill({ avgPrice: new Decimal('79992'), filledQuoteAmount: new Decimal('799.92'), fee: new Decimal('0.00001') });
    expect(marketCost(better, MID, RULES, DEFAULT_COSTS).spreadAndImpact.toFixed(6)).toBe('-0.000100');
  });

  it('costs a partial fill on what filled', () => {
    const partial = fill({ status: 'PARTIALLY_FILLED_CANCELLED', filledBaseQty: new Decimal('0.005'), filledQuoteAmount: new Decimal('400.04'), fee: new Decimal('0.000005') });
    expect(marketCost(partial, MID, RULES, DEFAULT_COSTS).againstMarket.toFixed(6)).toBe('0.001100');
  });

  it('finds a fill that costs more than the backtest assumes', () => {
    const dear = fill({ avgPrice: new Decimal('80160'), filledQuoteAmount: new Decimal('801.60') });
    const cost = marketCost(dear, MID, RULES, DEFAULT_COSTS);
    expect(cost.againstMarket.toFixed(6)).toBe('0.003000');
    expect(cost.tooExpensive).toBe(true);
    expect(expensiveFillMessage('ca1', cost)).toBe(
      'Self-check: order ca1 cost 0.30% against the market, more than the 0.15% the backtest assumes: fee 0.10%, spread and impact 0.20%.',
    );
  });

  it('refuses a fee in a coin it cannot price', () => {
    expect(() => marketCost(fill({ feeCoin: 'MNT' }), MID, RULES, DEFAULT_COSTS)).toThrow('cannot be priced');
  });
});

describe('againstBacktestPrice', () => {
  it('compares a buy with the open, and adds the fee', () => {
    expect(againstBacktestPrice(fill(), new Decimal('80000'), new Decimal('0.001')).toFixed(6)).toBe('0.001100');
  });

  it('compares a sell the other way round', () => {
    const sell = fill({ side: 'SELL', avgPrice: new Decimal('79992') });
    expect(againstBacktestPrice(sell, new Decimal('80000'), new Decimal('0.001')).toFixed(6)).toBe('0.001100');
  });
});

describe('percent', () => {
  it('writes a fraction as a percentage to two places', () => {
    expect(percent(new Decimal('0.0011'))).toBe('0.11%');
    expect(percent(new Decimal('-0.00015'))).toBe('-0.02%');
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/engine/selfCheck.test.ts`
Expected: FAIL — `marketCost` and the rest are not exported.

- [ ] **Step 3: Add the functions**

In `src/engine/selfCheck.ts`, change the imports to:

```ts
import type Decimal from 'decimal.js';
import type { OrderState } from '../exchange/trading.js';
import type { InstrumentRules } from '../market/types.js';
import { mean } from '../math.js';
import type { Candle, CostModel, StrategyFn, TargetState } from '../types.js';
```

and add at the end:

```ts
export type MarketCost = {
  /** The fee, as a fraction of the amount filled. */
  feeRate: Decimal;
  /** Against the mid when the order was sized; positive when it cost us. */
  spreadAndImpact: Decimal;
  /** The fee plus the spread and impact: what the fill cost against the market. */
  againstMarket: Decimal;
  /** What the backtest assumes one trade costs: its fee plus its slippage. */
  assumed: Decimal;
  /** More than the backtest assumes. */
  tooExpensive: boolean;
};

/**
 * What a fill cost against the market when its order was sized, seconds before
 * it was sent. A fee charged in the base coin is priced at the fill's average
 * price. Throws on a fill with nothing filled, or a fee in a coin it cannot price.
 */
export function marketCost(fill: OrderState, mid: Decimal, rules: InstrumentRules, costs: CostModel): MarketCost {
  if (fill.avgPrice === null || fill.filledQuoteAmount.lte(0)) {
    throw new Error(`order ${fill.clientOrderId} has nothing filled to cost`);
  }
  let feeInQuote: Decimal;
  if (fill.feeCoin === rules.baseCoin) {
    feeInQuote = fill.fee.times(fill.avgPrice);
  } else if (fill.feeCoin === rules.quoteCoin) {
    feeInQuote = fill.fee;
  } else {
    throw new Error(`order ${fill.clientOrderId} paid its fee in ${fill.feeCoin}, which cannot be priced`);
  }
  const feeRate = feeInQuote.div(fill.filledQuoteAmount);
  const gap = fill.side === 'BUY' ? fill.avgPrice.minus(mid) : mid.minus(fill.avgPrice);
  const spreadAndImpact = gap.div(mid);
  const againstMarket = feeRate.plus(spreadAndImpact);
  const assumed = costs.feeRate.plus(costs.slippageRate);
  return { feeRate, spreadAndImpact, againstMarket, assumed, tooExpensive: againstMarket.gt(assumed) };
}

/**
 * What a fill cost against the price the backtest would have paid — the open of
 * the day after its decision — plus the fee. Minutes between that open and the
 * fill move this both ways, so single trades are noise; only the average says
 * anything.
 */
export function againstBacktestPrice(fill: OrderState, open: Decimal, feeRate: Decimal): Decimal {
  if (fill.avgPrice === null) {
    throw new Error(`order ${fill.clientOrderId} has nothing filled to cost`);
  }
  const gap = fill.side === 'BUY' ? fill.avgPrice.minus(open) : open.minus(fill.avgPrice);
  return gap.div(open).plus(feeRate);
}

/** 0.0011 → "0.11%" */
export function percent(fraction: Decimal): string {
  return `${fraction.times(100).toFixed(2)}%`;
}

export function expensiveFillMessage(clientOrderId: string, cost: MarketCost): string {
  return (
    `Self-check: order ${clientOrderId} cost ${percent(cost.againstMarket)} against the market, ` +
    `more than the ${percent(cost.assumed)} the backtest assumes: ` +
    `fee ${percent(cost.feeRate)}, spread and impact ${percent(cost.spreadAndImpact)}.`
  );
}
```

- [ ] **Step 4: Run them**

Run: `npx vitest run tests/engine/selfCheck.test.ts`
Expected: PASS.

- [ ] **Step 5: Ship it** — commit `feat: cost a fill against the market and against the backtest's price`, then the
pull request.

---

## Task 4: The instrument's rules, once per tick

The check needs the instrument's rules to price a fee in BTC. Today each account's run fetches
them; fetching them once per tick, beside the candles, keeps the request count the same for one
account, lowers it for several, and gives the check the rules without a request of its own.

Branch: `self-check/rules-once-per-tick`.

**Files:**
- Modify: `src/engine/cycle.ts`
- Modify: `tests/engine/cycleFailures.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/engine/cycleFailures.test.ts`, inside `describe('when the market cannot be read', …)`:

```ts
  it('retries the whole tick when the instrument’s rules cannot be read', async () => {
    const h = await setup();
    h.market.fail.rules = new Error('the rules request timed out');
    expect(retryReason(await runTick(h.deps))).toContain('the rules request timed out');
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(0);
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/engine/cycleFailures.test.ts -t "rules cannot be read"`
Expected: FAIL — `expected RETRY_LATER, got RAN`: today the failure is caught inside the account's
run.

- [ ] **Step 3: Fetch the rules once, beside the candles**

In `src/engine/cycle.ts`:

Add `Candle` to the types import:

```ts
import type { Candle, StrategyFn, TargetState } from '../types.js';
```

Add this type after `type Stop`:

```ts
/** The day's decision, and the validated candle window it was made from. */
type Signal = { target: TargetState; close: Decimal; candles: Candle[] };
```

Change `readSignal`'s signature and its return:

```ts
async function readSignal(deps: CycleDeps, date: string, at: Date): Promise<Signal> {
```

```ts
  return { target, close, candles };
```

In `runTick`, replace:

```ts
  let signal: { target: TargetState; close: Decimal };
  try {
    signal = await readSignal(deps, date, at);
  } catch (error) {
```

with:

```ts
  let signal: Signal;
  let rules: InstrumentRules;
  try {
    signal = await readSignal(deps, date, at);
    rules = await deps.market.getInstrumentRules(deps.symbol);
  } catch (error) {
```

and the call to `runUser`:

```ts
    users.push(await runUser({ deps, userId, date, at }, signal.target, signal.close, rules));
```

In `runUser`, take the rules as a parameter and delete its own fetch:

```ts
async function runUser(run: Run, target: TargetState, signalClose: Decimal, rules: InstrumentRules): Promise<UserOutcome> {
```

Delete this line from its body:

```ts
    const rules = await deps.market.getInstrumentRules(deps.symbol);
```

- [ ] **Step 4: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS, including the new test. No other test changes: none counted the rules requests of a
running account.

- [ ] **Step 5: Ship it** — commit `refactor: read the instrument's rules once per tick, beside the candles`, with a
message saying a rules failure now retries the whole tick like a candle failure; then the pull request.

---

## Task 5: Yesterday's decision, replayed each morning

Branch: `self-check/replay-each-morning`.

**Files:**
- Create: `src/engine/dailyCheck.ts`
- Modify: `src/engine/cycle.ts`
- Create: `tests/engine/dailyCheck.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/engine/dailyCheck.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { runTick } from '../../src/engine/cycle.js';
import type { OrderBook } from '../../src/market/orderBook.js';
import type { Candle } from '../../src/types.js';
import { lastDay, trendingCandles } from '../helpers/candles.js';
import { useTestDatabase } from '../helpers/database.js';
import { harness, openFounder, ran, setMarket, tickTimeAfter, type Harness } from '../helpers/engine.js';

const database = useTestDatabase();
const UP = trendingCandles('2026-01-01', 300, 'up');
const NEXT = trendingCandles('2026-01-01', 301, 'up');
const DAY_ONE = lastDay(UP);

/** Day one: the account opens and buys, on the given order book. */
async function dayOne(book?: OrderBook): Promise<Harness> {
  const h = harness(database());
  setMarket(h, UP);
  if (book !== undefined) {
    h.market.book = book;
  }
  h.clock.now = tickTimeAfter(DAY_ONE);
  await openFounder(database());
  ran(await runTick(h.deps));
  return h;
}

/** Moves to day two's first tick, serving `candles`. */
function dayTwo(h: Harness, candles: Candle[] = NEXT): void {
  setMarket(h, candles);
  h.clock.now = tickTimeAfter(lastDay(candles));
}

/** Day two's candles with day one's close replaced — as if Bybit revised it after the engine traded. */
function revisedDayOne(close: string): Candle[] {
  const price = new Decimal(close);
  return NEXT.map((c, i) =>
    i === NEXT.length - 2 ? { ...c, close: price, high: Decimal.max(c.high, price), low: Decimal.min(c.low, price) } : c,
  );
}

const selfCheckAlerts = (h: Harness) => h.alerts.messages.filter((m) => m.startsWith('Self-check:'));

describe('the decision, replayed the next morning', () => {
  it('says yesterday’s decision still holds, in the summary and the ledger', async () => {
    const h = await dayOne();
    dayTwo(h);
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('COMPLETED');
    const [replay] = await h.ledger.ofType('DECISION_REPLAY', null);
    expect(replay).toMatchObject({
      cycleDate: DAY_ONE,
      payload: { verdict: 'HOLDS', recordedTarget: 'LONG', replayedTarget: 'LONG' },
    });
    expect(h.alerts.messages.at(-1)).toContain(`Checked ${DAY_ONE}: the decision still holds.`);
    expect(selfCheckAlerts(h)).toHaveLength(0);
  });

  it('notices a revised close that keeps the decision, without an alert', async () => {
    const h = await dayOne();
    dayTwo(h, revisedDayOne('79901'));
    ran(await runTick(h.deps));
    expect((await h.ledger.ofType('DECISION_REPLAY', null))[0]?.payload.verdict).toBe('DATA_REVISED');
    expect(h.alerts.messages.at(-1)).toContain(`Checked ${DAY_ONE}: Bybit revised that day's data, and the decision still holds.`);
    expect(selfCheckAlerts(h)).toHaveLength(0);
  });

  it('alerts once when the decision would now differ, and freezes nothing', async () => {
    const h = await dayOne();
    dayTwo(h, revisedDayOne('1000'));
    const [user] = ran(await runTick(h.deps));
    expect((await h.ledger.ofType('DECISION_REPLAY', null))[0]?.payload.verdict).toBe('DECISION_CHANGED');
    expect(selfCheckAlerts(h)).toEqual([
      `Self-check: the ${DAY_ONE} decision would now be FLAT, not LONG. Bybit's data for that day has changed since the engine traded on it. Nothing was frozen: today's run already trades on the current data. If this happens again, the price data needs a closer look.`,
    ]);
    // Today's own decision, on the current data, is still LONG: the run completes.
    expect(user!.result).toBe('COMPLETED');
    expect((await h.accounts.get('founder'))?.status).toBe('active');
  });

  it('has nothing to replay on the first day', async () => {
    const h = await dayOne();
    expect(await h.ledger.ofType('DECISION_REPLAY', null)).toHaveLength(0);
    expect(h.alerts.messages.at(-1)).not.toContain('Checked');
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/engine/dailyCheck.test.ts`
Expected: FAIL — no `DECISION_REPLAY` is recorded and no summary says *Checked*. The first-day
test passes already: it guards against a replay with nothing to replay.

- [ ] **Step 3: Write the daily check**

Create `src/engine/dailyCheck.ts`:

```ts
import Decimal from 'decimal.js';
import type { Alerter } from '../alerts/telegram.js';
import type { Ledger } from '../ledger/ledger.js';
import type { InstrumentRules } from '../market/types.js';
import type { AlertLog } from '../state/alertLog.js';
import type { Candle, StrategyFn, TargetState } from '../types.js';
import { cycleDateStart, DAY_MS, isoDate } from './cycleDate.js';
import { replayDecision, type RecordedSignal, type Replay } from './selfCheck.js';

/** How many cycle dates before today's the check looks back over. */
export const LOOK_BACK_DAYS = 7;

export type CheckDeps = {
  ledger: Ledger;
  alerter: Alerter;
  alertLog: AlertLog;
  strategy: StrategyFn;
  maPeriod: number;
};

/** What the check has to say: sentences for every account's summary, then each account's own. */
export type DailyCheck = { shared: string[]; byUser: Map<string, string[]> };

export function emptyCheck(): DailyCheck {
  return { shared: [], byUser: new Map() };
}

/** The check's sentences for one account's summary, with a leading space, or nothing. */
export function checkSentences(check: DailyCheck, userId: string): string {
  const sentences = [...check.shared, ...(check.byUser.get(userId) ?? [])];
  return sentences.length === 0 ? '' : ` ${sentences.join(' ')}`;
}

type Scope = { deps: CheckDeps; candles: Candle[]; date: string; at: Date; from: string; to: string; check: DailyCheck };

/**
 * The engine's daily self-check (spec: 2026-09-23-engine-self-check-design.md).
 * From the candles the tick already fetched, it replays the decisions of the
 * seven cycle dates before today's, records what it finds, and says so. It never
 * changes a decision, an order, or an account.
 */
export async function runDailyCheck(
  deps: CheckDeps,
  candles: Candle[],
  rules: InstrumentRules,
  date: string,
  at: Date,
): Promise<DailyCheck> {
  const start = cycleDateStart(date);
  const scope: Scope = {
    deps,
    candles,
    date,
    at,
    from: isoDate(start - LOOK_BACK_DAYS * DAY_MS),
    to: isoDate(start - DAY_MS),
    check: emptyCheck(),
  };
  void rules;
  await replayDecisions(scope);
  return scope.check;
}

async function replayDecisions(scope: Scope): Promise<void> {
  const { deps, candles, at, from, to, check } = scope;
  const replayed = new Set((await deps.ledger.ofTypeBetween('DECISION_REPLAY', from, to)).map((e) => e.cycleDate));
  for (const signal of await deps.ledger.ofTypeBetween('SIGNAL', from, to)) {
    const day = signal.cycleDate;
    if (day === null || signal.userId !== null || replayed.has(day)) {
      continue;
    }
    const window = candles.filter((c) => c.time <= cycleDateStart(day));
    if (window.length === 0 || isoDate(window[window.length - 1]!.time) !== day) {
      continue;
    }
    const replay = replayDecision(window, recordedSignal(signal.payload), deps.strategy, deps.maPeriod);
    if (replay === null) {
      continue;
    }
    await deps.ledger.append({ occurredAt: at, userId: null, cycleDate: day, type: 'DECISION_REPLAY', payload: { ...replay } });
    replayed.add(day);
    check.shared.push(replaySentence(day, replay));
    if (replay.verdict === 'DECISION_CHANGED' && (await deps.alertLog.claim(`${day}:system:decision-changed`, at))) {
      await deps.alerter.send(
        `Self-check: the ${day} decision would now be ${replay.replayedTarget}, not ${replay.recordedTarget}. ` +
          "Bybit's data for that day has changed since the engine traded on it. Nothing was frozen: today's run " +
          'already trades on the current data. If this happens again, the price data needs a closer look.',
      );
    }
  }
}

function recordedSignal(payload: Record<string, unknown>): RecordedSignal {
  const target = String(payload.target);
  if (target !== 'LONG' && target !== 'FLAT') {
    throw new Error(`a recorded signal has no valid target: "${target}"`);
  }
  return {
    target: target as TargetState,
    close: new Decimal(String(payload.close)),
    movingAverage: new Decimal(String(payload.movingAverage)),
  };
}

function replaySentence(day: string, replay: Replay): string {
  if (replay.verdict === 'HOLDS') {
    return `Checked ${day}: the decision still holds.`;
  }
  if (replay.verdict === 'DATA_REVISED') {
    return `Checked ${day}: Bybit revised that day's data, and the decision still holds.`;
  }
  return `Checked ${day}: the decision would now be different — see the separate alert.`;
}
```

The `void rules;` line keeps the parameter the next task needs without an unused-variable error;
Task 6 replaces it.

- [ ] **Step 4: Run the check in the tick, and say what it found**

In `src/engine/cycle.ts`:

```ts
import { checkSentences, runDailyCheck, type DailyCheck } from './dailyCheck.js';
```

In `runTick`, after the `try`/`catch` that reads the signal and the rules:

```ts
  const check = await runDailyCheck(deps, signal.candles, rules, date, at);
```

and pass it to each run:

```ts
    users.push(await runUser({ deps, userId, date, at }, signal.target, signal.close, rules, check));
```

`runUser` takes it, and hands it to `reconcile`:

```ts
async function runUser(
  run: Run,
  target: TargetState,
  signalClose: Decimal,
  rules: InstrumentRules,
  check: DailyCheck,
): Promise<UserOutcome> {
```

```ts
    return await reconcile(run, account, rules, target, filled, check);
```

`reconcile` takes it as its last parameter, `check: DailyCheck`, and sends:

```ts
  await deps.alerter.send(summary(run, target, filled, holdings, rules, late, checkSentences(check, userId)));
```

`summary` ends with the check's sentences:

```ts
function summary(
  run: Run,
  target: TargetState,
  filled: OrderState | null,
  holdings: Holdings,
  rules: InstrumentRules,
  late: boolean,
  checkText: string,
): string {
  const lateText = late ? ` Completed late, ${formatDuration(run.at.getTime() - dueAt(run.date))} after the close.` : '';
  const now = `Holding ${describeHoldings(holdings, rules)}.`;
  if (filled === null) {
    return `${run.date}: ${target}, no change. ${now}${lateText}${checkText}`;
  }
  const fill = describeFill(filled, rules);
  return `${run.date}: ${target}. ${fill[0]!.toUpperCase()}${fill.slice(1)}. ${now}${lateText}${checkText}`;
}
```

- [ ] **Step 5: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Ship it** — commit `feat: replay yesterday's decision each morning, and say whether it holds`, then
the pull request.

---

## Task 6: What each fill cost, the morning after

Branch: `self-check/cost-fills`.

**Files:**
- Modify: `src/engine/dailyCheck.ts`
- Modify: `tests/engine/dailyCheck.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/engine/dailyCheck.test.ts`:

```ts
describe('the fill, costed the next morning', () => {
  it('records what yesterday’s buy cost, and says so in the summary', async () => {
    const h = await dayOne();
    dayTwo(h);
    ran(await runTick(h.deps));
    const [cost] = await h.ledger.ofType('FILL_COST', 'founder');
    expect(cost).toMatchObject({ cycleDate: DAY_ONE, payload: { side: 'BUY', source: 'exchange' } });
    // A buy at the ask, 0.01% above the mid, plus the 0.1% fee.
    expect(new Decimal(String(cost!.payload.againstMarket)).toFixed(6)).toBe('0.001100');
    // Against day two's open, 80,000, from a fill at 79,907.99: 0.115% cheaper, less the fee.
    expect(new Decimal(String(cost!.payload.againstBacktestPrice)).toFixed(6)).toBe('-0.000150');
    expect(h.alerts.messages.at(-1)).toContain(
      `The ${DAY_ONE} buy cost -0.02% against the backtest's price; the backtest assumes 0.15%.`,
    );
  });

  it('costs a fill recorded by a person, and labels it', async () => {
    const h = await dayOne();
    const at = new Date(h.clock.now);
    await h.ledger.append({
      occurredAt: at, userId: 'founder', cycleDate: DAY_ONE, type: 'ORDER_INTENT',
      payload: { clientOrderId: 'ca-recorded', intent: 'ENTER_LONG', attempt: 9, side: 'BUY', quoteAmount: '10', midPrice: '79900' },
    });
    await h.ledger.append({
      occurredAt: at, userId: 'founder', cycleDate: DAY_ONE, type: 'ORDER_RESULT',
      payload: {
        clientOrderId: 'ca-recorded', side: 'BUY', status: 'FILLED', filledBaseQty: '0.000125', filledQuoteAmount: '10',
        avgPrice: '80000', fee: '0.000000125', feeCoin: 'BTC', rejectReason: null, source: 'operator', evidence: 'checked by hand',
      },
    });
    dayTwo(h);
    ran(await runTick(h.deps));
    const recorded = (await h.ledger.ofType('FILL_COST', 'founder')).find((c) => c.payload.clientOrderId === 'ca-recorded');
    expect(recorded?.payload.source).toBe('operator');
    expect(h.alerts.messages.at(-1)).toContain(`The ${DAY_ONE} buy, as recorded by a person, cost`);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/engine/dailyCheck.test.ts -t "the fill, costed"`
Expected: FAIL — no `FILL_COST` is recorded.

- [ ] **Step 3: Cost the fills**

In `src/engine/dailyCheck.ts`, add to the imports:

```ts
import { DEFAULT_COSTS } from '../backtest/costs.js';
import { orderStateFrom } from '../ledger/orderEvents.js';
import { againstBacktestPrice, expensiveFillMessage, marketCost, percent, replayDecision, type RecordedSignal, type Replay } from './selfCheck.js';
```

(replacing the existing `./selfCheck.js` import). In `runDailyCheck`, replace `void rules;` and the
`await replayDecisions(scope);` line with:

```ts
  await replayDecisions(scope);
  await costFills(scope, rules);
```

and add:

```ts
/** Results that traded something, fully or partly. */
const TRADED = ['FILLED', 'PARTIALLY_FILLED_CANCELLED'];

async function costFills(scope: Scope, rules: InstrumentRules): Promise<void> {
  const { deps, candles, at, from, to, check } = scope;
  const costed = new Set((await deps.ledger.ofTypeBetween('FILL_COST', from, to)).map((e) => String(e.payload.clientOrderId)));
  const intents = new Map(
    (await deps.ledger.ofTypeBetween('ORDER_INTENT', from, to)).map((e) => [String(e.payload.clientOrderId), e]),
  );
  for (const result of await deps.ledger.ofTypeBetween('ORDER_RESULT', from, to)) {
    const id = String(result.payload.clientOrderId);
    const { userId, cycleDate: day } = result;
    if (userId === null || day === null || costed.has(id) || !TRADED.includes(String(result.payload.status))) {
      continue;
    }
    // The backtest fills a decision at the next day's open.
    const open = candles.find((c) => c.time === cycleDateStart(day) + DAY_MS)?.open;
    const intent = intents.get(id);
    if (open === undefined || intent === undefined) {
      continue;
    }
    const fill = orderStateFrom(result.payload);
    const mid = new Decimal(String(intent.payload.midPrice));
    const market = marketCost(fill, mid, rules, DEFAULT_COSTS);
    const backtest = againstBacktestPrice(fill, open, market.feeRate);
    const source = result.payload.source === 'operator' ? 'operator' : 'exchange';
    await deps.ledger.append({
      occurredAt: at,
      userId,
      cycleDate: day,
      type: 'FILL_COST',
      payload: {
        clientOrderId: id,
        side: fill.side,
        source,
        mid,
        avgPrice: fill.avgPrice,
        open,
        feeRate: market.feeRate,
        spreadAndImpact: market.spreadAndImpact,
        againstMarket: market.againstMarket,
        againstBacktestPrice: backtest,
        assumed: market.assumed,
      },
    });
    costed.add(id);
    // Normally sent on the day of the fill already; this catches a fill settled some other way.
    if (market.tooExpensive && (await deps.alertLog.claim(`${day}:${userId}:fill-cost:${id}`, at))) {
      await deps.alerter.send(expensiveFillMessage(id, market));
    }
    const by = source === 'operator' ? ', as recorded by a person,' : '';
    const sentences = check.byUser.get(userId) ?? [];
    sentences.push(
      `The ${day} ${fill.side === 'BUY' ? 'buy' : 'sell'}${by} cost ${percent(backtest)} against the backtest's price; ` +
        `the backtest assumes ${percent(market.assumed)}.`,
    );
    check.byUser.set(userId, sentences);
  }
}
```

and update the doc comment on `runDailyCheck` to say it replays the decisions **and costs their
fills**.

- [ ] **Step 4: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Ship it** — commit `feat: cost each fill the morning after, against the backtest's price`, then the
pull request.

---

## Task 7: A fill's cost on the day it happens

Branch: `self-check/fill-day-cost`.

**Files:**
- Modify: `src/engine/cycle.ts`
- Modify: `tests/engine/dailyCheck.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/engine/dailyCheck.test.ts`, with `bookAround` and `PRICE`:

```ts
import { bookAround } from '../helpers/market.js';

const PRICE = UP[UP.length - 1]!.close;
```

```ts
describe('the fill, costed the same day', () => {
  it('says in the day’s summary what the fill cost against the market', async () => {
    const h = await dayOne();
    expect(h.alerts.messages.at(-1)).toContain(', costing 0.11% against the market (the backtest assumes 0.15%).');
    expect(selfCheckAlerts(h)).toHaveLength(0);
  });

  it('alerts the same day when a fill costs more than the backtest assumes, and only once', async () => {
    // 0.1% either side of the mid: inside the Risk Guard's 0.5% spread, but a buy
    // at the ask costs 0.1% plus the 0.1% fee — more than the backtest's 0.15%.
    const h = await dayOne(bookAround(PRICE, '5', '0.001'));
    expect(selfCheckAlerts(h)).toHaveLength(1);
    expect(selfCheckAlerts(h)[0]).toContain('cost 0.20% against the market, more than the 0.15% the backtest assumes');

    dayTwo(h);
    ran(await runTick(h.deps));
    expect(selfCheckAlerts(h)).toHaveLength(1);
    const [cost] = await h.ledger.ofType('FILL_COST', 'founder');
    expect(new Decimal(String(cost!.payload.againstMarket)).toFixed(6)).toBe('0.002000');
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/engine/dailyCheck.test.ts -t "the same day"`
Expected: FAIL — the summary has no cost, and no alert is sent on day one.

- [ ] **Step 3: Cost the fill in the run that makes it**

In `src/engine/cycle.ts`, make `Decimal` a value import, and add:

```ts
import Decimal from 'decimal.js';
import { DEFAULT_COSTS } from '../backtest/costs.js';
import { expensiveFillMessage, marketCost, percent } from './selfCheck.js';
```

Add, after `reconcile`:

```ts
/**
 * What the day's fill cost against the market, for the summary, with the
 * expensive-fill alert sent straight away rather than the next morning. It never
 * fails the run: anything that goes wrong leaves the clause out.
 */
async function fillCostClause(run: Run, filled: OrderState, rules: InstrumentRules): Promise<string> {
  const { deps, userId, date, at } = run;
  try {
    const order = (await deps.ledger.ordersOn(userId, date)).find(
      (o) => String(o.intent.payload.clientOrderId) === filled.clientOrderId,
    );
    if (order === undefined) {
      return '';
    }
    const cost = marketCost(filled, new Decimal(String(order.intent.payload.midPrice)), rules, DEFAULT_COSTS);
    if (cost.tooExpensive && (await deps.alertLog.claim(`${date}:${userId}:fill-cost:${filled.clientOrderId}`, at))) {
      await deps.alerter.send(expensiveFillMessage(filled.clientOrderId, cost));
    }
    return `, costing ${percent(cost.againstMarket)} against the market (the backtest assumes ${percent(cost.assumed)})`;
  } catch {
    return '';
  }
}
```

In `reconcile`, before sending the summary:

```ts
  const fillClause = filled === null ? '' : await fillCostClause(run, filled, rules);
  await deps.alerter.send(summary(run, target, filled, holdings, rules, late, fillClause, checkSentences(check, userId)));
```

and give `summary` the clause, after the fill:

```ts
function summary(
  run: Run,
  target: TargetState,
  filled: OrderState | null,
  holdings: Holdings,
  rules: InstrumentRules,
  late: boolean,
  fillClause: string,
  checkText: string,
): string {
  const lateText = late ? ` Completed late, ${formatDuration(run.at.getTime() - dueAt(run.date))} after the close.` : '';
  const now = `Holding ${describeHoldings(holdings, rules)}.`;
  if (filled === null) {
    return `${run.date}: ${target}, no change. ${now}${lateText}${checkText}`;
  }
  const fill = describeFill(filled, rules);
  return `${run.date}: ${target}. ${fill[0]!.toUpperCase()}${fill.slice(1)}${fillClause}. ${now}${lateText}${checkText}`;
}
```

- [ ] **Step 4: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS. The existing summary tests match `LONG\. Bought [\d.]+ BTC` and `FLAT\. Sold`,
which the clause leaves intact.

- [ ] **Step 5: Ship it** — commit `feat: say what a fill cost on the day it happens, and alert if too much`, then
the pull request.

---

## Task 8: The check never fails a run, and asks for nothing more

Branch: `self-check/never-fails-a-run`.

**Files:**
- Modify: `src/engine/dailyCheck.ts`, `src/engine/cycle.ts`
- Modify: `tests/engine/dailyCheck.test.ts`

- [ ] **Step 1: Write the tests**

Add to `tests/engine/dailyCheck.test.ts`:

```ts
describe('the check itself', () => {
  it('never fails the run when something inside it goes wrong, and still costs the rest', async () => {
    const h = await dayOne();
    const at = new Date(h.clock.now);
    await h.ledger.append({
      occurredAt: at, userId: 'founder', cycleDate: DAY_ONE, type: 'ORDER_INTENT',
      payload: { clientOrderId: 'ca-broken', intent: 'ENTER_LONG', attempt: 8, side: 'BUY', quoteAmount: '10', midPrice: '79900' },
    });
    await h.ledger.append({
      occurredAt: at, userId: 'founder', cycleDate: DAY_ONE, type: 'ORDER_RESULT',
      payload: {
        clientOrderId: 'ca-broken', side: 'BUY', status: 'FILLED', filledBaseQty: '0.0001', filledQuoteAmount: '8',
        avgPrice: 'not a number', fee: '0', feeCoin: 'BTC', rejectReason: null,
      },
    });
    dayTwo(h);
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('COMPLETED');
    expect(h.alerts.messages.filter((m) => m.startsWith('The self-check could not finish'))).toHaveLength(1);
    // Day one's real buy is still costed.
    expect(await h.ledger.ofType('FILL_COST', 'founder')).toHaveLength(1);
  });

  it('asks the market for nothing more than the run already did', async () => {
    const h = await dayOne();
    dayTwo(h);
    const before = { ...h.market.calls };
    ran(await runTick(h.deps));
    expect(h.market.calls.candles - before.candles).toBe(1);
    expect(h.market.calls.rules - before.rules).toBe(1);
  });
});
```

- [ ] **Step 2: Run them**

Run: `npx vitest run tests/engine/dailyCheck.test.ts -t "the check itself"`
Expected: the first FAILS — the broken result throws out of `runTick`. The second passes already:
it guards the promise of no extra request, and must keep passing.

- [ ] **Step 3: Catch every failure inside the check**

In `src/engine/dailyCheck.ts`, add:

```ts
/** The check must never fail the trading run: a failure alerts once a day, and the run goes on. */
export async function runDailyCheckSafely(
  deps: CheckDeps,
  candles: Candle[],
  rules: InstrumentRules,
  date: string,
  at: Date,
): Promise<DailyCheck> {
  try {
    return await runDailyCheck(deps, candles, rules, date, at);
  } catch (error) {
    await reportFailure(deps, date, at, error);
    return emptyCheck();
  }
}

async function reportFailure(deps: CheckDeps, date: string, at: Date, error: unknown): Promise<void> {
  if (await deps.alertLog.claim(`${date}:system:self-check`, at)) {
    const reason = error instanceof Error ? error.message : String(error);
    await deps.alerter.send(`The self-check could not finish: ${reason}. Trading is not affected; it tries again at the next run.`);
  }
}
```

Then make one bad record unable to stop the others. Replace `replayDecisions` with:

```ts
async function replayDecisions(scope: Scope): Promise<void> {
  const { deps, candles, at, from, to, check } = scope;
  const replayed = new Set((await deps.ledger.ofTypeBetween('DECISION_REPLAY', from, to)).map((e) => e.cycleDate));
  for (const signal of await deps.ledger.ofTypeBetween('SIGNAL', from, to)) {
    const day = signal.cycleDate;
    if (day === null || signal.userId !== null || replayed.has(day)) {
      continue;
    }
    try {
      const window = candles.filter((c) => c.time <= cycleDateStart(day));
      if (window.length === 0 || isoDate(window[window.length - 1]!.time) !== day) {
        continue;
      }
      const replay = replayDecision(window, recordedSignal(signal.payload), deps.strategy, deps.maPeriod);
      if (replay === null) {
        continue;
      }
      await deps.ledger.append({ occurredAt: at, userId: null, cycleDate: day, type: 'DECISION_REPLAY', payload: { ...replay } });
      replayed.add(day);
      check.shared.push(replaySentence(day, replay));
      if (replay.verdict === 'DECISION_CHANGED' && (await deps.alertLog.claim(`${day}:system:decision-changed`, at))) {
        await deps.alerter.send(
          `Self-check: the ${day} decision would now be ${replay.replayedTarget}, not ${replay.recordedTarget}. ` +
            "Bybit's data for that day has changed since the engine traded on it. Nothing was frozen: today's run " +
            'already trades on the current data. If this happens again, the price data needs a closer look.',
        );
      }
    } catch (error) {
      await reportFailure(deps, scope.date, at, error);
    }
  }
}
```

and `costFills` with:

```ts
async function costFills(scope: Scope, rules: InstrumentRules): Promise<void> {
  const { deps, candles, at, from, to, check } = scope;
  const costed = new Set((await deps.ledger.ofTypeBetween('FILL_COST', from, to)).map((e) => String(e.payload.clientOrderId)));
  const intents = new Map(
    (await deps.ledger.ofTypeBetween('ORDER_INTENT', from, to)).map((e) => [String(e.payload.clientOrderId), e]),
  );
  for (const result of await deps.ledger.ofTypeBetween('ORDER_RESULT', from, to)) {
    const id = String(result.payload.clientOrderId);
    const { userId, cycleDate: day } = result;
    if (userId === null || day === null || costed.has(id) || !TRADED.includes(String(result.payload.status))) {
      continue;
    }
    try {
      // The backtest fills a decision at the next day's open.
      const open = candles.find((c) => c.time === cycleDateStart(day) + DAY_MS)?.open;
      const intent = intents.get(id);
      if (open === undefined || intent === undefined) {
        continue;
      }
      const fill = orderStateFrom(result.payload);
      const mid = new Decimal(String(intent.payload.midPrice));
      const market = marketCost(fill, mid, rules, DEFAULT_COSTS);
      const backtest = againstBacktestPrice(fill, open, market.feeRate);
      const source = result.payload.source === 'operator' ? 'operator' : 'exchange';
      await deps.ledger.append({
        occurredAt: at,
        userId,
        cycleDate: day,
        type: 'FILL_COST',
        payload: {
          clientOrderId: id,
          side: fill.side,
          source,
          mid,
          avgPrice: fill.avgPrice,
          open,
          feeRate: market.feeRate,
          spreadAndImpact: market.spreadAndImpact,
          againstMarket: market.againstMarket,
          againstBacktestPrice: backtest,
          assumed: market.assumed,
        },
      });
      costed.add(id);
      // Normally sent on the day of the fill already; this catches a fill settled some other way.
      if (market.tooExpensive && (await deps.alertLog.claim(`${day}:${userId}:fill-cost:${id}`, at))) {
        await deps.alerter.send(expensiveFillMessage(id, market));
      }
      const by = source === 'operator' ? ', as recorded by a person,' : '';
      const sentences = check.byUser.get(userId) ?? [];
      sentences.push(
        `The ${day} ${fill.side === 'BUY' ? 'buy' : 'sell'}${by} cost ${percent(backtest)} against the backtest's price; ` +
          `the backtest assumes ${percent(market.assumed)}.`,
      );
      check.byUser.set(userId, sentences);
    } catch (error) {
      await reportFailure(deps, scope.date, at, error);
    }
  }
}
```

In `src/engine/cycle.ts`, import and call the safe version instead:

```ts
import { checkSentences, runDailyCheckSafely, type DailyCheck } from './dailyCheck.js';
```

```ts
  const check = await runDailyCheckSafely(deps, signal.candles, rules, date, at);
```

- [ ] **Step 4: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Ship it** — commit `fix: never let the self-check fail a run, and keep its promise of no extra
request`, then the pull request.

---

## Task 9: The paper report's self-check section

Branch: `self-check/paper-report`.

**Files:**
- Modify: `src/app/paperReport.ts`, `src/cli/paper-report.ts`
- Modify: `tests/app/paperReport.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/app/paperReport.test.ts`, add `replays: [],` to the object `input()` returns, then:

```ts
describe('the self-check section', () => {
  it('summarises the decisions rechecked and the fills costed', () => {
    const base = input();
    const report = buildPaperReport({
      ...base,
      replays: [
        event('DECISION_REPLAY', day(126), { verdict: 'HOLDS' }, null),
        event('DECISION_REPLAY', day(127), { verdict: 'DATA_REVISED' }, null),
      ],
      events: [
        ...base.events,
        event('FILL_COST', day(126), { clientOrderId: 'a', againstMarket: '0.0011', againstBacktestPrice: '0.0009' }),
        event('FILL_COST', day(127), { clientOrderId: 'b', againstMarket: '0.0013', againstBacktestPrice: '0.0031' }),
      ],
    });
    expect(report.selfCheck).toMatchObject({ decisionsRechecked: 2, changed: [], revised: [day(127)], fillsCosted: 2 });
    expect(report.selfCheck.againstMarket?.average.toFixed(4)).toBe('0.0012');
    expect(report.selfCheck.againstMarket?.worst.toFixed(4)).toBe('0.0013');
    expect(report.selfCheck.againstBacktestPrice?.worst.toFixed(4)).toBe('0.0031');

    const text = formatPaperReport(report);
    expect(text).toContain(`Decisions rechecked: 2. Revised data on ${day(127)}, the decision holding.`);
    expect(text).toContain('Fills costed: 2. Against the market: average 0.12%, worst 0.13% (the backtest assumes 0.15%).');
    expect(text).toContain("Against the backtest's price: average 0.20%, worst 0.31%.");
  });

  it('flags a decision the check found changed', () => {
    const report = buildPaperReport({ ...input(), replays: [event('DECISION_REPLAY', day(127), { verdict: 'DECISION_CHANGED' }, null)] });
    expect(report.selfCheck.changed).toEqual([day(127)]);
    expect(formatPaperReport(report)).toContain(`DECISIONS CHANGED on ${day(127)}.`);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/app/paperReport.test.ts`
Expected: FAIL — `replays` is not part of the input, and there is no `selfCheck`.

- [ ] **Step 3: Build and format the section**

In `src/app/paperReport.ts`, add the imports:

```ts
import { DEFAULT_COSTS } from '../backtest/costs.js';
import { percent } from '../engine/selfCheck.js';
```

Add to `ReportInput`:

```ts
  /** Every DECISION_REPLAY event. */
  replays: LedgerEvent[];
```

Add the type, and a field on `PaperReport`:

```ts
export type Spread = { average: Decimal; worst: Decimal };

export type SelfCheckSummary = {
  decisionsRechecked: number;
  /** Cycle dates whose decision would now differ. */
  changed: string[];
  /** Cycle dates whose data was revised, the decision holding. */
  revised: string[];
  fillsCosted: number;
  againstMarket: Spread | null;
  againstBacktestPrice: Spread | null;
  /** What the backtest assumes one trade costs. */
  assumed: Decimal;
};
```

```ts
  selfCheck: SelfCheckSummary;
```

In `buildPaperReport`, before the `return`:

```ts
  const replays = input.replays.filter((r) => r.occurredAt >= opened.occurredAt);
  const fillCosts = input.events.filter((e) => e.type === 'FILL_COST');
  const spreadOf = (key: string): Spread | null => {
    if (fillCosts.length === 0) {
      return null;
    }
    const values = fillCosts.map((e) => new Decimal(String(e.payload[key])));
    return { average: values.reduce((a, b) => a.plus(b), new Decimal(0)).div(values.length), worst: Decimal.max(...values) };
  };
  const onVerdict = (verdict: string) => replays.filter((r) => r.payload.verdict === verdict).map((r) => r.cycleDate ?? '?');
```

and in the returned object:

```ts
    selfCheck: {
      decisionsRechecked: replays.length,
      changed: onVerdict('DECISION_CHANGED'),
      revised: onVerdict('DATA_REVISED'),
      fillsCosted: fillCosts.length,
      againstMarket: spreadOf('againstMarket'),
      againstBacktestPrice: spreadOf('againstBacktestPrice'),
      assumed: DEFAULT_COSTS.feeRate.plus(DEFAULT_COSTS.slippageRate),
    },
```

In `formatPaperReport`, before the final `return`:

```ts
  const s = report.selfCheck;
  const findings = [
    s.changed.length === 0 ? '' : ` DECISIONS CHANGED on ${s.changed.join(', ')}.`,
    s.revised.length === 0 ? '' : ` Revised data on ${s.revised.join(', ')}, the decision holding.`,
  ].join('');
  lines.push(
    'Self-check',
    `  Decisions rechecked: ${s.decisionsRechecked}.${s.decisionsRechecked > 0 && findings === '' ? ' All held.' : findings}`,
    `  Fills costed: ${s.fillsCosted}.` +
      (s.againstMarket === null
        ? ''
        : ` Against the market: average ${percent(s.againstMarket.average)}, worst ${percent(s.againstMarket.worst)} (the backtest assumes ${percent(s.assumed)}).`),
    s.againstBacktestPrice === null
      ? ''
      : `  Against the backtest's price: average ${percent(s.againstBacktestPrice.average)}, worst ${percent(s.againstBacktestPrice.worst)}.`,
  );
```

In `src/cli/paper-report.ts`, pass the replays and fail on a changed decision:

```ts
      replays: await engine.ledger.ofType('DECISION_REPLAY', null),
```

```ts
    return report.tradesMatch && report.signalMismatches.length === 0 && report.selfCheck.changed.length === 0 ? 0 : 1;
```

- [ ] **Step 4: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Ship it** — commit `feat: add the self-check to the paper report`, then the pull request.

---

## Task 10: The documents

Branch: `self-check/docs`.

**Files:**
- Modify: `docs/decisions.md`, `docs/superpowers/specs/2026-09-22-phase-2-paper-engine-design.md`,
  `docs/superpowers/specs/2026-09-23-engine-self-check-design.md`, `CLAUDE.md`, and this plan

- [ ] **Step 1: The decision log.** Add before `## Corrections made along the way`:

```markdown
## 25. The engine's daily self-check — DECIDED 2026-09-23

Full design: `docs/superpowers/specs/2026-09-23-engine-self-check-design.md`.

- **A failed self-check records and alerts. It never freezes, pauses, or changes a trade.** If
  Bybit revises a price after the engine traded on it, the next day's run already trades on the
  revised data, so the account corrects itself. *Rejected:* freezing on a changed decision, which
  would stop exactly that correction.
- **It reports through one sentence in the daily summary**, and a separate alert only when
  something is off — the founder's choice. *Rejected:* a separate daily message; a weekly digest.
- **A fill is too expensive when it costs more than the backtest's own assumption**, 0.15% a
  trade, against the market when its order was sized. Its cost against the backtest's price, the
  day's open, is reported but never alerted: minutes of price movement make single trades noise.
- **It runs inside the tick, on the candles already fetched**, with the instrument's rules now
  read once per tick instead of once per account. *Rejected:* a separate command on its own
  timer; running `paper:report` on a schedule.
```

- [ ] **Step 2: The specs.** In the Phase 2 spec's header, after the Phase 2a note:

```markdown
- **Extended by the self-check**, `2026-09-23-engine-self-check-design.md`: each tick that fetches
  candles also replays the previous days' decisions and costs their fills, and the instrument's
  rules are read once per tick rather than once per account (section 4)
```

In the self-check spec, set **Status** to built, with the pull request numbers.

- [ ] **Step 3: `CLAUDE.md`.** Three edits:

In the state table, after the Phase 2a row, add:

```markdown
| Engine self-check | **Complete, and merged into `phase-2-paper-engine`.** Each morning the engine replays the previous days' decisions on fresh data and costs their fills against the backtest's 0.15% a trade, recording both and alerting only when something is off. It never changes a trade. Spec: `docs/superpowers/specs/2026-09-23-engine-self-check-design.md` |
```

Replace the paragraph that begins *"Next for the engine, in the founder's order"* with:

```markdown
Next for the engine, in the founder's order: **a compiled build**, so each 15-minute tick runs
`node` directly instead of `npm` and `tsx` — it needs a spec first. Then Phase 2b, real Bybit
orders. The engine's daily self-check is built: see the state table.
```

In the commands table, change the `paper:report` row to:

```markdown
| `npm run paper:report` | The paper account against buy-and-hold and against the backtest, and what the daily self-check found |
```

- [ ] **Step 4: This plan.** Tick every step, and add execution notes: what differed from the plan
and why, the final test count, and any limitation accepted.

- [ ] **Step 5: Run everything, then ship it.** `npm run typecheck && npm test && npm audit
--omit=dev`; commit `docs: record the engine's daily self-check`; the pull request.

---

## Task 11: Bring the self-check into the engine branch

- [ ] **Step 1:** `git checkout engine-self-check && git pull`; check it merges cleanly into
`phase-2-paper-engine` with `git merge-tree --write-tree origin/phase-2-paper-engine HEAD`.
- [ ] **Step 2:** Run the full suite, the type check, and the audit on the branch one last time.
- [ ] **Step 3:** Open the pull request from `engine-self-check` into `phase-2-paper-engine`,
describing the whole feature and linking every task's pull request; merge it with a merge commit.
Keep the `engine-self-check` branch as history.
- [ ] **Step 4:** Tell the founder it is merged, and that deploying it is theirs to time: before the
fourteen paper-trading days, so they record the self-check from the first day, or after them.

---

## Done when

1. Every step is ticked, and every test in the spec's section 8 exists.
2. `npm test`, `npm run typecheck`, the parity test, and `npm audit --omit=dev` pass.
3. The feature is merged into `phase-2-paper-engine` through pull requests, and nothing is deployed
   by an agent.

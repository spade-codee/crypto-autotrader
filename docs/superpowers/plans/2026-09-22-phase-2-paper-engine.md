# Phase 2 — Paper-Trading Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the complete daily trading cycle unattended on the VPS against a paper account that fills on live Bybit prices — every failure either recovered, or frozen and alerted — so 2–4 weeks of paper trading can start without a Bybit key.

**Architecture:** `npm run cycle` is a one-shot command that a systemd timer fires every 15 minutes; it does each day's work once. It validates the candle window, computes the unchanged MA-125 signal, settles every outstanding order from any day, sizes one order from available funds, passes it through the Risk Guard, writes the intent, places it on a `TradingAccount` — a paper account now, Bybit in Phase 2b — and reconciles on total balances. Pure units hold the logic; an append-only ledger in PGlite holds the history; small mutable tables hold account state and per-day runs. Every request and every tick has a deadline.

**Tech Stack:** TypeScript; Node 22+ (Node 24 on the VPS); Vitest 4; `decimal.js`; `drizzle-orm` 0.45 on `@electric-sql/pglite` 0.5; `drizzle-kit` 0.31; systemd; the Telegram Bot API; Healthchecks.io.

**Spec:** `docs/superpowers/specs/2026-09-22-phase-2-paper-engine-design.md` — read all of it first, including the revision note at the top. Section numbers below refer to it.

---

## Rules for whoever executes this plan

- **Branch:** all work happens on `phase-2-paper-engine`. `git pull` before starting, and commit and push after every task — the founder works on two machines.
- **Never ask for, see, or type a secret:** the Telegram bot token, the Healthchecks.io URL, or any API key. The founder puts them in `.env.local` on the VPS, in Task 21. Every test uses fakes.
- **Tests never touch the network.** Market data, Telegram, and Healthchecks.io are faked everywhere.
- **Money and quantities are never JavaScript floats:** `Decimal` in code, `NUMERIC` in the database, strings in JSON.
- **The strategy is not touched.** The engine calls `trendFilter({ maPeriod: CHOSEN_MA_PERIOD })`, exactly as the backtest does.
- **Only one process may open the database.** PGlite is not multi-process, so every command that opens it takes the lock from Task 13.
- **On this Windows machine, create multi-line files with the editor, never a shell heredoc** — heredocs containing apostrophes break here.

---

## File structure

| File | Responsibility |
|---|---|
| `src/net/http.ts` | Modify: every request gets a deadline; adds `raceSignal` |
| `src/math.ts` | Modify: adds `roundDown` |
| `src/types.ts` | Modify: adds `AccountStatus` |
| `src/engine/cycleDate.ts` | Which daily candle a moment belongs to; when a run is due, and late |
| `src/market/orderBook.ts` | `OrderBook`, `BookLevel`, `midPrice` |
| `src/market/types.ts` | `InstrumentRules`, `Ticker`, and the `MarketData` interface |
| `src/engine/candleWindow.ts` | Is a candle window long enough, current, ordered, consecutive, and valid? |
| `src/market/bybitPublic.ts` | Bybit's public endpoints: candles, order book, ticker, instrument rules |
| `src/exchange/trading.ts` | `TradingAccount`, `MarketOrderRequest`, `OrderState`, `OrderLookup` |
| `src/engine/orderId.ts` | Deterministic client order IDs, one per attempt |
| `src/paper/fill.ts` | Fill a market order against an order book |
| `src/engine/holdings.ts` | Available and total holdings; borrowed and locked coins |
| `src/engine/reconcile.ts` | `atTarget`, judged on totals |
| `src/engine/sizing.ts` | The one order needed, if any |
| `src/engine/riskGuard.ts` | Approve an order, or veto it listing every failed rule |
| `src/db/schema.ts` | Modify: six new tables |
| `drizzle/0001_paper_engine.sql` | Generated: the new tables |
| `drizzle/0002_ledger_append_only.sql` | Hand-written: the trigger that makes the ledger append-only |
| `src/ledger/ledger.ts` | Append and read ledger events; outstanding intents; a day's orders |
| `src/state/accountState.ts` | Active, paused, frozen — each change written to the ledger |
| `src/state/cycleRuns.ts` | Per-day run records |
| `src/state/alertLog.ts` | Keys for alerts already sent |
| `src/paper/paperAccount.ts` | The paper `TradingAccount` |
| `src/ops/killSwitch.ts`, `src/ops/lock.ts` | The file-based kill switch; the database lock |
| `src/alerts/telegram.ts`, `src/alerts/heartbeat.ts` | Alerts; the Healthchecks.io heartbeat |
| `src/engine/cycle.ts` | One tick |
| `src/app/paperReport.ts` | The paper account against buy-and-hold and against the backtest |
| `src/cli/env.ts` | Modify: engine settings |
| `src/cli/engineContext.ts` | Settings, lock, database, and the real dependencies for engine commands |
| `src/cli/cycle.ts`, `paper-init.ts`, `status.ts`, `pause.ts`, `resume.ts`, `unfreeze.ts`, `kill-switch.ts`, `alerts-test.ts`, `paper-report.ts` | The commands |
| `deploy/systemd/crypto-autotrader-cycle.service`, `crypto-autotrader-cycle.timer` | The service and its timer |
| `docs/deploy-vps.md` | The VPS runbook |
| `tests/helpers/candles.ts`, `market.ts`, `fakeMarket.ts`, `database.ts`, `engine.ts` | Test helpers |
| `tests/fixtures/bybitPublic.ts`, `tests/fixtures/btcusdt-spot-1d-2023-2024.csv` | Fixtures |

Dependencies point one way: `cli → (engine, app) → (market, exchange, paper, ledger, state, alerts, ops) → (net, db, math)`. Nothing is added to `src/strategy/`.

---

## Task 1: Request deadlines

Node's `fetch` waits up to five minutes for a stalled server. The engine holds a lock while it runs, so a hang would silently lose the day (spec section 10, *Deadlines*).

**Files:**
- Modify: `src/net/http.ts`
- Test: `tests/net/http.test.ts`

- [ ] **Step 1: Start from the right branch**

```bash
git checkout phase-2-paper-engine
git pull --ff-only
npm install
npm test
```

Expected: every existing test passes.

- [ ] **Step 2: Write the failing tests**

In `tests/net/http.test.ts`, replace the import line with:

```ts
import { DEFAULT_TIMEOUT_MS, getJson, raceSignal } from '../../src/net/http.js';
```

and append:

```ts
describe('getJson deadlines', () => {
  const never = () => new Promise<never>(() => {});

  it('gives up on a host that never answers and tries the next', async () => {
    const calls: string[] = [];
    const impl = async (url: string) => {
      calls.push(url);
      if (url.startsWith('https://slow.test')) {
        return never();
      }
      return { ok: true, status: 200, json: async () => ({ ok: 1 }) };
    };
    const started = Date.now();
    const body = await getJson(['https://slow.test', 'https://fast.test'], '/x', impl, { timeoutMs: 50 });
    expect(body).toEqual({ ok: 1 });
    expect(calls).toEqual(['https://slow.test/x', 'https://fast.test/x']);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('fails within the deadline when every host stalls', async () => {
    const started = Date.now();
    await expect(
      getJson(['https://a.test', 'https://b.test'], '/x', never, { timeoutMs: 50 }),
    ).rejects.toThrow('could not reach any host');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('fails within the deadline when the body never arrives', async () => {
    const impl = async () => ({ ok: true, status: 200, json: never });
    await expect(getJson(['https://a.test'], '/x', impl, { timeoutMs: 50 })).rejects.toThrow(
      'timed out',
    );
  });

  it('hands fetch an abort signal, so a real request is cancelled rather than abandoned', async () => {
    let signal: AbortSignal | undefined;
    const impl = async (_url: string, options?: { signal?: AbortSignal }) => {
      signal = options?.signal;
      return { ok: true, status: 200, json: async () => ({}) };
    };
    await getJson(['https://a.test'], '/x', impl);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('defaults to ten seconds', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(10_000);
  });
});

describe('raceSignal', () => {
  it('returns the result when the work finishes first', async () => {
    await expect(raceSignal(Promise.resolve(7), new AbortController().signal, 'x')).resolves.toBe(7);
  });

  it('rejects when the signal fires first', async () => {
    await expect(raceSignal(new Promise(() => {}), AbortSignal.timeout(20), 'the thing')).rejects.toThrow(
      'the thing timed out',
    );
  });

  it('rejects at once if the signal has already fired', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(raceSignal(new Promise(() => {}), controller.signal, 'x')).rejects.toThrow('x timed out');
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/net/http.test.ts`
Expected: FAIL — `DEFAULT_TIMEOUT_MS` and `raceSignal` are not exported.

- [ ] **Step 4: Replace `src/net/http.ts`**

```ts
/** Headers, plus the signal that enforces a request's deadline. */
export type RequestOptions = { headers?: Record<string, string>; signal?: AbortSignal };

type FetchResponse = { ok: boolean; status: number; json(): Promise<unknown> };
export type FetchLike = (url: string, options?: RequestOptions) => Promise<FetchResponse>;

export type GetOptions = {
  headers?: Record<string, string>;
  /** How long one host may take to answer, response body included. */
  timeoutMs?: number;
};

/**
 * Node's fetch waits up to five minutes for a stalled server. The trading
 * engine holds a lock while it runs, so a hang would silently lose the day.
 * Every request gives up after this long instead.
 */
export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Settles with `work`, or rejects once `signal` aborts — whichever comes first.
 * Racing, rather than trusting the callee to honour the signal, bounds the wait
 * even when an implementation ignores it.
 */
export async function raceSignal<T>(work: Promise<T>, signal: AbortSignal, what: string): Promise<T> {
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error(`${what} timed out`));
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * GETs `path` from the first host that can be reached.
 *
 * Moves to the next host when a request cannot get an answer at all — a DNS
 * failure, a refused connection, or no response before the deadline. An HTTP
 * error means the server answered, so the problem is the request rather than
 * reachability; retrying on another host would hide it. A body that stalls
 * after the server answered is an error for the same reason.
 *
 * The same headers go to every host. Bybit signatures cover the path and query
 * but not the host, so a signed request stays valid across hosts.
 */
export async function getJson(
  hosts: string[],
  path: string,
  fetchImpl: FetchLike = fetch,
  options: GetOptions = {},
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  for (const host of hosts) {
    const url = `${host}${path}`;
    const signal = AbortSignal.timeout(timeoutMs);
    let response: FetchResponse;
    try {
      response = await raceSignal(
        fetchImpl(url, { headers: options.headers, signal }),
        signal,
        `the request to ${url}`,
      );
    } catch {
      continue;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}`);
    }
    return raceSignal(response.json(), signal, `reading the response from ${url}`);
  }
  throw new Error(`could not reach any host: ${hosts.join(', ')}`);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/net/http.test.ts`
Expected: PASS — the five existing tests and the eight new ones.

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. The Bybit client and the candle fetcher call `getJson` unchanged; they now get the deadline for free.

- [ ] **Step 7: Commit**

```bash
git add src/net/http.ts tests/net/http.test.ts
git commit -m "feat: give every HTTP request a deadline"
git push
```

---

## Task 2: Rounding and cycle dates

**Files:**
- Modify: `src/math.ts`
- Create: `src/engine/cycleDate.ts`
- Test: `tests/math.test.ts`, `tests/engine/cycleDate.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/math.test.ts`, change the import to `import { mean, roundDown } from '../src/math.js';` and append:

```ts
describe('roundDown', () => {
  it('rounds down to a whole number of steps', () => {
    expect(roundDown(d('0.0001234567'), d('0.000001')).toFixed()).toBe('0.000123');
    expect(roundDown(d('999.123456789'), d('0.0000001')).toFixed()).toBe('999.1234567');
  });

  it('leaves an exact multiple unchanged', () => {
    expect(roundDown(d('5.000001'), d('0.000001')).toFixed()).toBe('5.000001');
  });

  it('never rounds up, even past twenty significant digits', () => {
    // A plain division to Decimal's default 20 digits would round this up to ...4568.
    expect(roundDown(d('12345678.12345679999999999'), d('0.0000001')).toFixed()).toBe(
      '12345678.1234567',
    );
  });

  it('rejects a step of zero or less, and a negative amount', () => {
    expect(() => roundDown(d('1'), d('0'))).toThrow('positive step');
    expect(() => roundDown(d('-1'), d('0.1'))).toThrow('zero or more');
  });
});
```

Create `tests/engine/cycleDate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cycleDate, cycleDateStart, dueAt, isLate, isoDate } from '../../src/engine/cycleDate.js';

const at = (iso: string) => Date.parse(iso);

describe('cycleDate', () => {
  it('is the day whose candle closed most recently', () => {
    expect(cycleDate(at('2026-09-22T00:02:00Z'))).toBe('2026-09-21');
    expect(cycleDate(at('2026-09-22T23:59:59.999Z'))).toBe('2026-09-21');
  });

  it('moves on at the instant of the close', () => {
    expect(cycleDate(at('2026-09-21T23:59:59.999Z'))).toBe('2026-09-20');
    expect(cycleDate(at('2026-09-22T00:00:00Z'))).toBe('2026-09-21');
  });
});

describe('cycleDateStart and dueAt', () => {
  it('turn a cycle date into its midnight and its close', () => {
    expect(cycleDateStart('2026-09-21')).toBe(at('2026-09-21T00:00:00Z'));
    expect(dueAt('2026-09-21')).toBe(at('2026-09-22T00:00:00Z'));
  });

  it('reject anything but a real YYYY-MM-DD date', () => {
    expect(() => cycleDateStart('2026-9-21')).toThrow('not a valid cycle date');
    expect(() => cycleDateStart('2026-02-30')).toThrow('not a valid cycle date');
    expect(() => cycleDateStart('yesterday')).toThrow('not a valid cycle date');
  });
});

describe('isLate', () => {
  it('allows thirty minutes after the close', () => {
    expect(isLate('2026-09-21', at('2026-09-22T00:30:00Z'))).toBe(false);
    expect(isLate('2026-09-21', at('2026-09-22T00:30:00.001Z'))).toBe(true);
  });
});

describe('isoDate', () => {
  it('formats a time as its UTC date', () => {
    expect(isoDate(at('2026-09-21T23:59:59Z'))).toBe('2026-09-21');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/math.test.ts tests/engine/cycleDate.test.ts`
Expected: FAIL — `roundDown` and `src/engine/cycleDate.ts` do not exist.

- [ ] **Step 3: Add `roundDown` to `src/math.ts`**

Append:

```ts
/**
 * Rounds `value` down to a whole number of `step`s — the only safe direction for
 * an order amount, which must never exceed what the account holds. Uses
 * Decimal#toNearest, which divides exactly rather than to 20 significant digits.
 */
export function roundDown(value: Decimal, step: Decimal): Decimal {
  if (step.lte(0)) {
    throw new Error('roundDown needs a positive step');
  }
  if (value.isNeg()) {
    throw new Error('roundDown is only defined for amounts of zero or more');
  }
  return value.toNearest(step, Decimal.ROUND_DOWN);
}
```

- [ ] **Step 4: Create `src/engine/cycleDate.ts`**

```ts
export const DAY_MS = 86_400_000;

/** A run that completes more than this long after its candle closed is recorded as late. */
export const LATE_AFTER_MS = 30 * 60_000;

/** YYYY-MM-DD for an epoch-millisecond time, in UTC. */
export function isoDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * The cycle date at `now`: the open date of the most recently closed daily
 * candle. Bybit's daily candles open and close at midnight UTC, so from the
 * instant a day ends until the next midnight, that day is the one to act on.
 */
export function cycleDate(now: number): string {
  return isoDate(Math.floor(now / DAY_MS) * DAY_MS - DAY_MS);
}

/** Epoch milliseconds of a cycle date's midnight UTC. Rejects anything but a real YYYY-MM-DD date. */
export function cycleDateStart(date: string): number {
  const time = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : Number.NaN;
  if (Number.isNaN(time) || isoDate(time) !== date) {
    throw new Error(`"${date}" is not a valid cycle date`);
  }
  return time;
}

/** When a cycle date's run is due: the moment its candle closes. */
export function dueAt(date: string): number {
  return cycleDateStart(date) + DAY_MS;
}

export function isLate(date: string, completedAt: number): boolean {
  return completedAt - dueAt(date) > LATE_AFTER_MS;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/math.test.ts tests/engine/cycleDate.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/math.ts src/engine/cycleDate.ts tests/math.test.ts tests/engine/cycleDate.test.ts
git commit -m "feat: add roundDown and cycle dates"
git push
```

---

## Task 3: Market types, the order book, and the candle window

The strategy returns FLAT on too little history, so a truncated or corrupted fetch would sell everything. The window is validated before any signal (spec section 4.1).

**Files:**
- Create: `src/market/orderBook.ts`, `src/market/types.ts`, `src/engine/candleWindow.ts`, `tests/helpers/candles.ts`
- Test: `tests/market/orderBook.test.ts`, `tests/engine/candleWindow.test.ts`

- [ ] **Step 1: Create the candle helper `tests/helpers/candles.ts`**

```ts
import Decimal from 'decimal.js';
import type { Candle } from '../../src/types.js';

export const DAY = 86_400_000;

/** Daily candles opening at `firstDay` midnight UTC, one per close, with open = high = low = close. */
export function dailyCandles(firstDay: string, closes: Array<number | string>): Candle[] {
  const start = Date.parse(`${firstDay}T00:00:00Z`);
  return closes.map((close, i) => {
    const price = new Decimal(close);
    return { time: start + i * DAY, open: price, high: price, low: price, close: price, volume: new Decimal(1) };
  });
}

/** `count` daily candles moving steadily up or down from 50,000, ending well clear of their average. */
export function trendingCandles(firstDay: string, count: number, direction: 'up' | 'down'): Candle[] {
  const step = direction === 'up' ? 100 : -100;
  return dailyCandles(
    firstDay,
    Array.from({ length: count }, (_, i) => 50_000 + i * step),
  );
}

/** The UTC date of the last candle. */
export function lastDay(candles: Candle[]): string {
  return new Date(candles[candles.length - 1]!.time).toISOString().slice(0, 10);
}

/** The day after a YYYY-MM-DD date. */
export function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/market/orderBook.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { midPrice } from '../../src/market/orderBook.js';

const level = (price: string, qty = '1') => ({ price: new Decimal(price), qty: new Decimal(qty) });

describe('midPrice', () => {
  it('is halfway between the best bid and the best ask', () => {
    const book = { bids: [level('99'), level('98')], asks: [level('101'), level('102')] };
    expect(midPrice(book).toFixed()).toBe('100');
  });

  it('refuses a book that is empty on either side', () => {
    expect(() => midPrice({ bids: [], asks: [level('101')] })).toThrow('empty');
    expect(() => midPrice({ bids: [level('99')], asks: [] })).toThrow('empty');
  });
});
```

Create `tests/engine/candleWindow.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { checkCandleWindow } from '../../src/engine/candleWindow.js';
import type { Candle } from '../../src/types.js';
import { dailyCandles, lastDay } from '../helpers/candles.js';

const WINDOW = dailyCandles('2026-01-01', Array.from({ length: 130 }, (_, i) => 100 + i));
const NEWEST = lastDay(WINDOW);
const copy = (): Candle[] => WINDOW.map((c) => ({ ...c }));
const reasonOf = (candles: Candle[], expected = NEWEST): string => {
  const check = checkCandleWindow(candles, expected, 125);
  if (check.ok) {
    throw new Error('expected the window to be rejected');
  }
  return check.reason;
};

describe('checkCandleWindow', () => {
  it('accepts a long enough, current, consecutive window', () => {
    expect(checkCandleWindow(WINDOW, NEWEST, 125)).toEqual({ ok: true });
  });

  it('rejects a window that is too short', () => {
    expect(reasonOf(WINDOW.slice(-124))).toContain('at least 125');
  });

  it('rejects an empty window', () => {
    expect(checkCandleWindow([], NEWEST, 0).ok).toBe(false);
  });

  it('rejects a window whose newest candle is not the expected day', () => {
    expect(reasonOf(WINDOW.slice(0, -1))).toContain(`expected ${NEWEST}`);
  });

  it('rejects candles out of order', () => {
    const candles = copy();
    [candles[128], candles[129]] = [candles[129]!, candles[128]!];
    expect(reasonOf(candles)).toContain('out of order');
  });

  it('rejects a repeated candle', () => {
    const candles = copy();
    candles.splice(100, 0, { ...candles[100]! });
    expect(reasonOf(candles)).toContain('out of order or repeated');
  });

  it('rejects a gap', () => {
    const candles = copy();
    candles.splice(100, 1);
    expect(reasonOf(candles)).toContain('missing');
  });

  it.each([
    ['a zero close', (c: Candle) => ({ ...c, close: new Decimal(0), low: new Decimal(0) })],
    ['a negative open', (c: Candle) => ({ ...c, open: new Decimal(-1), low: new Decimal(-1) })],
    ['a NaN high', (c: Candle) => ({ ...c, high: new Decimal(Number.NaN) })],
  ])('rejects %s', (_name, breakCandle) => {
    const candles = copy();
    candles[120] = breakCandle(candles[120]!);
    expect(reasonOf(candles)).toContain('not a positive number');
  });

  it('rejects a high below the close', () => {
    const candles = copy();
    candles[120] = { ...candles[120]!, high: candles[120]!.close.minus(1) };
    expect(reasonOf(candles)).toContain('high and low');
  });

  it('rejects a candle that does not open at midnight UTC', () => {
    const candles = copy();
    candles[120] = { ...candles[120]!, time: candles[120]!.time + 1_000 };
    expect(reasonOf(candles)).toContain('midnight');
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/market/orderBook.test.ts tests/engine/candleWindow.test.ts`
Expected: FAIL — the modules do not exist.

- [ ] **Step 4: Create `src/market/orderBook.ts`**

```ts
import type Decimal from 'decimal.js';

export type BookLevel = { price: Decimal; qty: Decimal };

/** Bids best (highest) first; asks best (lowest) first. */
export type OrderBook = { bids: BookLevel[]; asks: BookLevel[] };

/** Halfway between the best bid and the best ask. */
export function midPrice(book: OrderBook): Decimal {
  const bid = book.bids[0];
  const ask = book.asks[0];
  if (bid === undefined || ask === undefined) {
    throw new Error('the order book is empty on one side');
  }
  return bid.price.plus(ask.price).div(2);
}
```

- [ ] **Step 5: Create `src/market/types.ts`**

```ts
import type Decimal from 'decimal.js';
import type { Candle } from '../types.js';
import type { OrderBook } from './orderBook.js';

/** Bybit's trading rules for one spot pair, from /v5/market/instruments-info. */
export type InstrumentRules = {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  /** Quantity step for the base coin. */
  basePrecision: Decimal;
  /** Amount step for the quote coin. */
  quotePrecision: Decimal;
  minOrderQty: Decimal;
  /** Minimum order value, in the quote coin. */
  minOrderAmt: Decimal;
  maxMarketOrderQty: Decimal;
};

export type Ticker = { symbol: string; lastPrice: Decimal; bid: Decimal; ask: Decimal };

/** Public market data. Nothing here needs an API key. */
export interface MarketData {
  /** Up to `count` of the most recent daily candles whose day has closed by `now`, oldest first. */
  getClosedDailyCandles(symbol: string, count: number, now: number): Promise<Candle[]>;
  getOrderBook(symbol: string): Promise<OrderBook>;
  getTicker(symbol: string): Promise<Ticker>;
  getInstrumentRules(symbol: string): Promise<InstrumentRules>;
}
```

- [ ] **Step 6: Create `src/engine/candleWindow.ts`**

```ts
import type { Candle } from '../types.js';
import { DAY_MS, isoDate } from './cycleDate.js';

export type WindowCheck = { ok: true } | { ok: false; reason: string };

/**
 * Checks a candle window before any signal is computed from it: long enough,
 * current, ordered, unique, consecutive, and with valid prices. The strategy
 * returns FLAT on too little history, so a truncated or corrupted fetch would
 * otherwise sell everything. See spec section 4.1.
 */
export function checkCandleWindow(
  candles: Candle[],
  expectedNewest: string,
  minLength: number,
): WindowCheck {
  if (candles.length === 0 || candles.length < minLength) {
    return { ok: false, reason: `only ${candles.length} candles, at least ${minLength} needed` };
  }
  // Three passes, so each fault gets its own name: two swapped candles make a
  // forward jump before the backward one, which a single pass would call a gap.
  for (const candle of candles) {
    const day = Number.isFinite(candle.time) ? isoDate(candle.time) : 'a';
    if (!Number.isInteger(candle.time) || candle.time % DAY_MS !== 0) {
      return { ok: false, reason: `the ${day} candle does not open at midnight UTC` };
    }
    const { open, high, low, close } = candle;
    if ([open, high, low, close].some((price) => !price.isFinite() || price.lte(0))) {
      return { ok: false, reason: `the ${day} candle has a price that is not a positive number` };
    }
    if (low.gt(open) || low.gt(close) || high.lt(open) || high.lt(close)) {
      return { ok: false, reason: `the ${day} candle's high and low do not contain its open and close` };
    }
  }
  for (let i = 1; i < candles.length; i++) {
    if (candles[i]!.time <= candles[i - 1]!.time) {
      return { ok: false, reason: `candles are out of order or repeated at ${isoDate(candles[i]!.time)}` };
    }
  }
  for (let i = 1; i < candles.length; i++) {
    if (candles[i]!.time - candles[i - 1]!.time !== DAY_MS) {
      return { ok: false, reason: `candles are missing before ${isoDate(candles[i]!.time)}` };
    }
  }
  const newest = isoDate(candles[candles.length - 1]!.time);
  if (newest !== expectedNewest) {
    return { ok: false, reason: `the newest candle is ${newest}, expected ${expectedNewest}` };
  }
  return { ok: true };
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/market/orderBook.test.ts tests/engine/candleWindow.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/market tests/market src/engine/candleWindow.ts tests/engine/candleWindow.test.ts tests/helpers/candles.ts
git commit -m "feat: add market types and validate the whole candle window"
git push
```

---

## Task 4: Bybit public market data

Live prices come from Bybit **mainnet**'s public endpoints, even for paper trading, through the host fallback and the new deadlines. No key is involved.

**Files:**
- Create: `src/market/bybitPublic.ts`, `tests/fixtures/bybitPublic.ts`
- Test: `tests/market/bybitPublic.test.ts`

- [ ] **Step 1: Create the fixtures `tests/fixtures/bybitPublic.ts`**

These are the live responses' shapes and values, fetched 2026-09-22.

```ts
/** The `result` of GET /v5/market/instruments-info?category=spot&symbol=BTCUSDT. */
export const INSTRUMENTS_RESULT = {
  category: 'spot',
  list: [
    {
      symbol: 'BTCUSDT',
      baseCoin: 'BTC',
      quoteCoin: 'USDT',
      status: 'Trading',
      lotSizeFilter: {
        basePrecision: '0.000001',
        quotePrecision: '0.0000001',
        minOrderQty: '0.000001',
        maxOrderQty: '230',
        minOrderAmt: '5',
        maxOrderAmt: '8000000',
        maxLimitOrderQty: '230',
        maxMarketOrderQty: '120',
        postOnlyMaxLimitOrderSize: '1150',
      },
      priceFilter: { tickSize: '0.1' },
    },
  ],
};

/** The `result` of GET /v5/market/orderbook — deliberately out of order, to prove the parser sorts. */
export const ORDERBOOK_RESULT = {
  s: 'BTCUSDT',
  a: [
    ['85531.0', '0.5'],
    ['85530.5', '0.126626'],
  ],
  b: [
    ['85530.0', '1.2'],
    ['85530.4', '0.482439'],
  ],
  ts: 1789900000000,
  u: 1,
  seq: 1,
  cts: 1789900000000,
};

/** The `result` of GET /v5/market/tickers?category=spot&symbol=BTCUSDT. */
export const TICKERS_RESULT = {
  category: 'spot',
  list: [
    {
      symbol: 'BTCUSDT',
      bid1Price: '85530.4',
      bid1Size: '0.482439',
      ask1Price: '85530.5',
      ask1Size: '0.126626',
      lastPrice: '85530.5',
      prevPrice24h: '84000',
      price24hPcnt: '0.0182',
      highPrice24h: '86000',
      lowPrice24h: '83900',
      turnover24h: '537000000',
      volume24h: '6300',
      usdIndexPrice: '85520',
    },
  ],
};

/** Wraps a result in Bybit's response envelope. */
export function envelope(result: unknown, retCode = 0, retMsg = 'OK') {
  return { retCode, retMsg, result, retExtInfo: {}, time: 1789900000000 };
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/market/bybitPublic.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  BybitPublicMarket,
  parseInstrumentRules,
  parseOrderBook,
  parseTicker,
} from '../../src/market/bybitPublic.js';
import { envelope, INSTRUMENTS_RESULT, ORDERBOOK_RESULT, TICKERS_RESULT } from '../fixtures/bybitPublic.js';
import { DAY } from '../helpers/candles.js';

/** Serves one response body for every request and records the URLs. */
function serve(body: unknown) {
  const urls: string[] = [];
  const impl = async (url: string) => {
    urls.push(url);
    return { ok: true, status: 200, json: async () => body };
  };
  return { impl, urls };
}

const marketServing = (body: unknown) => {
  const served = serve(body);
  return { market: new BybitPublicMarket({ hosts: ['https://x.test'], fetchImpl: served.impl }), urls: served.urls };
};

describe('parseInstrumentRules', () => {
  it('reads the lot size filter as decimals', () => {
    const rules = parseInstrumentRules(INSTRUMENTS_RESULT, 'BTCUSDT');
    expect(rules.baseCoin).toBe('BTC');
    expect(rules.quoteCoin).toBe('USDT');
    expect(rules.basePrecision.toFixed()).toBe('0.000001');
    expect(rules.quotePrecision.toFixed()).toBe('0.0000001');
    expect(rules.minOrderQty.toFixed()).toBe('0.000001');
    expect(rules.minOrderAmt.toFixed()).toBe('5');
    expect(rules.maxMarketOrderQty.toFixed()).toBe('120');
  });

  it('refuses a pair that is not trading', () => {
    const halted = { list: [{ ...INSTRUMENTS_RESULT.list[0]!, status: 'PreLaunch' }] };
    expect(() => parseInstrumentRules(halted, 'BTCUSDT')).toThrow('not trading');
  });

  it('refuses a different symbol', () => {
    expect(() => parseInstrumentRules(INSTRUMENTS_RESULT, 'ETHUSDT')).toThrow('not ETHUSDT');
  });

  it('refuses a missing rule', () => {
    const item = INSTRUMENTS_RESULT.list[0]!;
    const broken = { list: [{ ...item, lotSizeFilter: { ...item.lotSizeFilter, minOrderAmt: undefined } }] };
    expect(() => parseInstrumentRules(broken, 'BTCUSDT')).toThrow('minOrderAmt');
  });
});

describe('parseOrderBook', () => {
  it('sorts asks lowest first and bids highest first', () => {
    const book = parseOrderBook(ORDERBOOK_RESULT);
    expect(book.asks.map((l) => l.price.toFixed())).toEqual(['85530.5', '85531']);
    expect(book.bids.map((l) => l.price.toFixed())).toEqual(['85530.4', '85530']);
    expect(book.asks[0]!.qty.toFixed()).toBe('0.126626');
  });

  it('refuses a malformed level', () => {
    expect(() => parseOrderBook({ a: [['1']], b: [] })).toThrow('malformed');
  });
});

describe('parseTicker', () => {
  it('reads the last price and the best bid and ask', () => {
    const ticker = parseTicker(TICKERS_RESULT, 'BTCUSDT');
    expect(ticker.lastPrice.toFixed()).toBe('85530.5');
    expect(ticker.bid.toFixed()).toBe('85530.4');
    expect(ticker.ask.toFixed()).toBe('85530.5');
  });
});

describe('BybitPublicMarket', () => {
  it('asks for spot instrument rules', async () => {
    const { market, urls } = marketServing(envelope(INSTRUMENTS_RESULT));
    await market.getInstrumentRules('BTCUSDT');
    expect(urls).toEqual(['https://x.test/v5/market/instruments-info?category=spot&symbol=BTCUSDT']);
  });

  it('asks for 50 levels of the spot order book', async () => {
    const { market, urls } = marketServing(envelope(ORDERBOOK_RESULT));
    await market.getOrderBook('BTCUSDT');
    expect(urls).toEqual(['https://x.test/v5/market/orderbook?category=spot&symbol=BTCUSDT&limit=50']);
  });

  it('asks for the spot ticker', async () => {
    const { market, urls } = marketServing(envelope(TICKERS_RESULT));
    await market.getTicker('BTCUSDT');
    expect(urls).toEqual(['https://x.test/v5/market/tickers?category=spot&symbol=BTCUSDT']);
  });

  it('turns a non-zero retCode into an error', async () => {
    const { market } = marketServing(envelope(null, 10001, 'params error'));
    await expect(market.getTicker('BTCUSDT')).rejects.toThrow('Bybit error 10001');
  });

  it('returns only the last `count` closed daily candles', async () => {
    const row = (day: number) => [String(day * DAY), '1', '1', '1', '1', '1', '1'];
    // Bybit returns newest first; day 105 is still in progress at `now`.
    const page = envelope({ list: [105, 104, 103, 102, 101, 100].map(row) });
    const { market, urls } = marketServing(page);
    const candles = await market.getClosedDailyCandles('BTCUSDT', 3, 105 * DAY + 3_600_000);
    expect(candles.map((c) => c.time / DAY)).toEqual([102, 103, 104]);
    expect(urls[0]).toContain('category=spot');
    expect(urls[0]).toContain('interval=D');
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/market/bybitPublic.test.ts`
Expected: FAIL — `src/market/bybitPublic.ts` does not exist.

- [ ] **Step 4: Create `src/market/bybitPublic.ts`**

```ts
import Decimal from 'decimal.js';
import { fetchDailyCandles } from '../data/bybit.js';
import { unwrap } from '../exchange/bybit/client.js';
import { bybitHosts } from '../exchange/bybit/hosts.js';
import { getJson, type FetchLike } from '../net/http.js';
import type { Candle } from '../types.js';
import type { BookLevel, OrderBook } from './orderBook.js';
import type { InstrumentRules, MarketData, Ticker } from './types.js';

const DAY_MS = 86_400_000;
const BOOK_DEPTH = 50;

/** A string field that must parse as a finite decimal. Straight from string to Decimal: never a float. */
function decimalField(value: unknown, name: string): Decimal {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Bybit's response is missing ${name}`);
  }
  let parsed: Decimal;
  try {
    parsed = new Decimal(value);
  } catch {
    throw new Error(`Bybit's response has an invalid ${name}`);
  }
  if (!parsed.isFinite()) {
    throw new Error(`Bybit's response has an invalid ${name}`);
  }
  return parsed;
}

function textField(value: unknown, name: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`Bybit's response is missing ${name}`);
  }
  return value;
}

function firstListItem(result: unknown, what: string): Record<string, unknown> {
  const list = (result as { list?: unknown } | null)?.list;
  const item = Array.isArray(list) ? list[0] : undefined;
  if (typeof item !== 'object' || item === null) {
    throw new Error(`Bybit returned no ${what}`);
  }
  return item as Record<string, unknown>;
}

export function parseInstrumentRules(result: unknown, symbol: string): InstrumentRules {
  const item = firstListItem(result, `instrument for ${symbol}`);
  if (item.symbol !== symbol) {
    throw new Error(`Bybit returned the instrument ${String(item.symbol)}, not ${symbol}`);
  }
  if (item.status !== 'Trading') {
    throw new Error(`${symbol} is not trading on Bybit (its status is ${String(item.status)})`);
  }
  const lot = (item.lotSizeFilter ?? {}) as Record<string, unknown>;
  return {
    symbol,
    baseCoin: textField(item.baseCoin, 'baseCoin'),
    quoteCoin: textField(item.quoteCoin, 'quoteCoin'),
    basePrecision: decimalField(lot.basePrecision, 'basePrecision'),
    quotePrecision: decimalField(lot.quotePrecision, 'quotePrecision'),
    minOrderQty: decimalField(lot.minOrderQty, 'minOrderQty'),
    minOrderAmt: decimalField(lot.minOrderAmt, 'minOrderAmt'),
    maxMarketOrderQty: decimalField(lot.maxMarketOrderQty, 'maxMarketOrderQty'),
  };
}

function parseLevels(value: unknown, side: string): BookLevel[] {
  if (!Array.isArray(value)) {
    throw new Error(`Bybit's order book is missing its ${side}`);
  }
  return value.map((row: unknown) => {
    if (!Array.isArray(row) || row.length < 2) {
      throw new Error(`malformed level in Bybit's order book ${side}`);
    }
    return { price: decimalField(row[0], `${side} price`), qty: decimalField(row[1], `${side} size`) };
  });
}

/** Parses the order book, sorting defensively: asks lowest first, bids highest first. */
export function parseOrderBook(result: unknown): OrderBook {
  const book = (result ?? {}) as { a?: unknown; b?: unknown };
  return {
    asks: parseLevels(book.a, 'asks').sort((x, y) => x.price.comparedTo(y.price)),
    bids: parseLevels(book.b, 'bids').sort((x, y) => y.price.comparedTo(x.price)),
  };
}

export function parseTicker(result: unknown, symbol: string): Ticker {
  const item = firstListItem(result, `ticker for ${symbol}`);
  if (item.symbol !== symbol) {
    throw new Error(`Bybit returned the ticker for ${String(item.symbol)}, not ${symbol}`);
  }
  return {
    symbol,
    lastPrice: decimalField(item.lastPrice, 'lastPrice'),
    bid: decimalField(item.bid1Price, 'bid1Price'),
    ask: decimalField(item.ask1Price, 'ask1Price'),
  };
}

export type PublicMarketOptions = { hosts?: string[]; fetchImpl?: FetchLike };

/**
 * Bybit's public market data. Always mainnet: paper trading fills on live
 * prices. Requests go through the host fallback (bybit.com is DNS-blocked on
 * Nigerian networks; bytick.com answers) and the ten-second deadline.
 */
export class BybitPublicMarket implements MarketData {
  readonly #hosts: string[];
  readonly #fetch: FetchLike;

  constructor(options: PublicMarketOptions = {}) {
    this.#hosts = options.hosts ?? bybitHosts('mainnet');
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async getInstrumentRules(symbol: string): Promise<InstrumentRules> {
    return parseInstrumentRules(await this.#get('/v5/market/instruments-info', { category: 'spot', symbol }), symbol);
  }

  async getOrderBook(symbol: string): Promise<OrderBook> {
    return parseOrderBook(
      await this.#get('/v5/market/orderbook', { category: 'spot', symbol, limit: String(BOOK_DEPTH) }),
    );
  }

  async getTicker(symbol: string): Promise<Ticker> {
    return parseTicker(await this.#get('/v5/market/tickers', { category: 'spot', symbol }), symbol);
  }

  async getClosedDailyCandles(symbol: string, count: number, now: number): Promise<Candle[]> {
    // A few days of margin: the newest day may still be open.
    const start = new Date(now - (count + 3) * DAY_MS);
    const candles = await fetchDailyCandles(symbol, start, {
      category: 'spot',
      hosts: this.#hosts,
      fetchImpl: this.#fetch,
      now,
    });
    return candles.slice(-count);
  }

  async #get(path: string, params: Record<string, string>): Promise<unknown> {
    return unwrap(await getJson(this.#hosts, `${path}?${new URLSearchParams(params).toString()}`, this.#fetch));
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/market/bybitPublic.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/market/bybitPublic.ts tests/market/bybitPublic.test.ts tests/fixtures/bybitPublic.ts
git commit -m "feat: read Bybit's public candles, order book, ticker, and trading rules"
git push
```

---

## Task 5: The trading interface and client order IDs

Every attempt at an order gets its own deterministic ID, so each ID has exactly one intent and one result (spec section 4.2).

**Files:**
- Create: `src/exchange/trading.ts`, `src/engine/orderId.ts`
- Test: `tests/engine/orderId.test.ts`

- [ ] **Step 1: Create `src/exchange/trading.ts`**

It holds only types, so it needs no test of its own.

```ts
import type Decimal from 'decimal.js';
import type { CoinBalance } from './account.js';

export type OrderSide = 'BUY' | 'SELL';

/** A buy names the quote coin to spend; a sell names the base coin to sell — Bybit's convention for spot market orders. */
export type MarketOrderRequest =
  | { clientOrderId: string; symbol: string; side: 'BUY'; quoteAmount: Decimal }
  | { clientOrderId: string; symbol: string; side: 'SELL'; baseQty: Decimal };

export type OrderStatus = 'FILLED' | 'PARTIALLY_FILLED_CANCELLED' | 'REJECTED' | 'PENDING';

export type OrderState = {
  clientOrderId: string;
  side: OrderSide;
  status: OrderStatus;
  filledBaseQty: Decimal;
  filledQuoteAmount: Decimal;
  /** Null when nothing filled. */
  avgPrice: Decimal | null;
  fee: Decimal;
  feeCoin: string;
  rejectReason: string | null;
};

/**
 * The account's answer about one client order ID:
 * - FOUND: the order exists, in this state;
 * - ABSENT: the adapter can PROVE no such order exists or ever will. The paper
 *   account can, because its database is the whole truth;
 * - NOT_VISIBLE: the adapter looked and did not see it, but cannot prove it
 *   absent. An exchange that is slow to show new orders answers this way.
 * A lookup that fails — a timeout, an error — throws.
 */
export type OrderLookup =
  | { kind: 'FOUND'; state: OrderState }
  | { kind: 'ABSENT' }
  | { kind: 'NOT_VISIBLE' };

/** An account the engine can trade: the paper account now, Bybit in Phase 2b. */
export interface TradingAccount {
  getBalances(): Promise<CoinBalance[]>;
  /**
   * Places a market order. If this throws, the order's fate is uncertain — it
   * may have reached the account — and the engine settles it through getOrder.
   */
  placeMarketOrder(order: MarketOrderRequest): Promise<OrderState>;
  getOrder(clientOrderId: string): Promise<OrderLookup>;
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/engine/orderId.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { clientOrderId, intentFor } from '../../src/engine/orderId.js';

describe('clientOrderId', () => {
  it('is the same for the same user, day, intent, and attempt', () => {
    expect(clientOrderId('founder', '2026-09-21', 'ENTER_LONG', 1)).toBe(
      clientOrderId('founder', '2026-09-21', 'ENTER_LONG', 1),
    );
  });

  it('differs when any one of them differs', () => {
    const ids = new Set([
      clientOrderId('founder', '2026-09-21', 'ENTER_LONG', 1),
      clientOrderId('someone', '2026-09-21', 'ENTER_LONG', 1),
      clientOrderId('founder', '2026-09-22', 'ENTER_LONG', 1),
      clientOrderId('founder', '2026-09-21', 'EXIT_TO_FLAT', 1),
      clientOrderId('founder', '2026-09-21', 'ENTER_LONG', 2),
    ]);
    expect(ids.size).toBe(5);
  });

  it("fits Bybit's orderLinkId rules", () => {
    const id = clientOrderId('founder', '2026-09-21', 'ENTER_LONG', 1);
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,36}$/);
    expect(id).toHaveLength(34);
  });

  it('cannot be confused by separators inside the inputs', () => {
    expect(clientOrderId('a|b', '2026-09-21', 'ENTER_LONG', 1)).not.toBe(
      clientOrderId('a', 'b|2026-09-21', 'ENTER_LONG', 1),
    );
  });

  it('rejects an attempt that is not a whole number from 1', () => {
    expect(() => clientOrderId('founder', '2026-09-21', 'ENTER_LONG', 0)).toThrow('attempt');
    expect(() => clientOrderId('founder', '2026-09-21', 'ENTER_LONG', 1.5)).toThrow('attempt');
  });
});

describe('intentFor', () => {
  it('maps a buy to entering LONG and a sell to leaving for FLAT', () => {
    expect(intentFor('BUY')).toBe('ENTER_LONG');
    expect(intentFor('SELL')).toBe('EXIT_TO_FLAT');
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/engine/orderId.test.ts`
Expected: FAIL — `src/engine/orderId.ts` does not exist.

- [ ] **Step 4: Create `src/engine/orderId.ts`**

```ts
import { createHash } from 'node:crypto';
import type { OrderSide } from '../exchange/trading.js';

export type OrderIntent = 'ENTER_LONG' | 'EXIT_TO_FLAT';

export function intentFor(side: OrderSide): OrderIntent {
  return side === 'BUY' ? 'ENTER_LONG' : 'EXIT_TO_FLAT';
}

/**
 * A deterministic client order ID for one attempt at one intent, for one user
 * on one cycle date. The same inputs always give the same ID, so a tick that
 * crashes before recording its intent recreates exactly the same order. Each
 * attempt has its own ID, so every ID has one intent and one result.
 *
 * The inputs are JSON-encoded before hashing so no separator inside them can
 * make two different tuples collide. Bybit's orderLinkId allows up to 36
 * letters, digits, hyphens, and underscores; this returns 34.
 */
export function clientOrderId(
  userId: string,
  cycleDate: string,
  intent: OrderIntent,
  attempt: number,
): string {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error('attempt must be a whole number from 1');
  }
  const digest = createHash('sha256')
    .update(JSON.stringify([userId, cycleDate, intent, attempt]))
    .digest('hex');
  return `ca${digest.slice(0, 32)}`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/engine/orderId.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/exchange/trading.ts src/engine/orderId.ts tests/engine/orderId.test.ts
git commit -m "feat: add the trading interface and per-attempt client order IDs"
git push
```

---

## Task 6: Walking the order book

The paper account fills against the live book, and the Risk Guard uses the same function to check the book can take an order.

**Files:**
- Create: `src/paper/fill.ts`
- Test: `tests/paper/fill.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/paper/fill.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { fillBuy, fillSell } from '../../src/paper/fill.js';

const D = (value: string) => new Decimal(value);
const level = (price: string, qty: string) => ({ price: D(price), qty: D(qty) });
const STEP = D('0.000001');

describe('fillBuy', () => {
  it('fills inside the best level', () => {
    const fill = fillBuy([level('100', '10')], D('50'), STEP);
    expect(fill.filledBaseQty.toFixed()).toBe('0.5');
    expect(fill.filledQuoteAmount.toFixed()).toBe('50');
    expect(fill.avgPrice?.toFixed()).toBe('100');
    expect(fill.complete).toBe(true);
  });

  it('walks up through the levels, paying more at each', () => {
    // 1 BTC at 100, then 55 USDT buys 0.5 at 110.
    const fill = fillBuy([level('100', '1'), level('110', '1')], D('155'), STEP);
    expect(fill.filledBaseQty.toFixed()).toBe('1.5');
    expect(fill.filledQuoteAmount.toFixed()).toBe('155');
    expect(fill.avgPrice?.toFixed(4)).toBe('103.3333');
    expect(fill.complete).toBe(true);
  });

  it('rounds the quantity down to the step, leaving dust unspent', () => {
    const fill = fillBuy([level('3', '100')], D('1'), STEP);
    expect(fill.filledBaseQty.toFixed()).toBe('0.333333');
    expect(fill.filledQuoteAmount.toFixed()).toBe('0.999999');
    expect(fill.complete).toBe(true);
  });

  it('is incomplete when the book runs out', () => {
    const fill = fillBuy([level('100', '1')], D('500'), STEP);
    expect(fill.filledBaseQty.toFixed()).toBe('1');
    expect(fill.filledQuoteAmount.toFixed()).toBe('100');
    expect(fill.complete).toBe(false);
  });

  it('fills nothing from an empty book', () => {
    const fill = fillBuy([], D('100'), STEP);
    expect(fill.filledBaseQty.isZero()).toBe(true);
    expect(fill.avgPrice).toBeNull();
    expect(fill.complete).toBe(false);
  });
});

describe('fillSell', () => {
  it('fills inside the best bid', () => {
    const fill = fillSell([level('100', '10')], D('2'));
    expect(fill.filledBaseQty.toFixed()).toBe('2');
    expect(fill.filledQuoteAmount.toFixed()).toBe('200');
    expect(fill.complete).toBe(true);
  });

  it('walks down through the bids, receiving less at each', () => {
    const fill = fillSell([level('100', '1'), level('90', '1')], D('1.5'));
    expect(fill.filledQuoteAmount.toFixed()).toBe('145');
    expect(fill.avgPrice?.toFixed(4)).toBe('96.6667');
    expect(fill.complete).toBe(true);
  });

  it('is incomplete when the bids run out', () => {
    const fill = fillSell([level('100', '1')], D('3'));
    expect(fill.filledBaseQty.toFixed()).toBe('1');
    expect(fill.complete).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/paper/fill.test.ts`
Expected: FAIL — `src/paper/fill.ts` does not exist.

- [ ] **Step 3: Create `src/paper/fill.ts`**

```ts
import Decimal from 'decimal.js';
import type { BookLevel } from '../market/orderBook.js';
import { roundDown } from '../math.js';

export type Fill = {
  filledBaseQty: Decimal;
  filledQuoteAmount: Decimal;
  /** Null when nothing filled. */
  avgPrice: Decimal | null;
  /** False when the book ran out before the order was fully filled. */
  complete: boolean;
};

const ZERO = new Decimal(0);

function result(base: Decimal, quote: Decimal, complete: boolean): Fill {
  return {
    filledBaseQty: base,
    filledQuoteAmount: quote,
    avgPrice: base.isZero() ? null : quote.div(base),
    complete,
  };
}

/**
 * A market buy spending `quoteAmount`, walking the asks from the best price up.
 * Quantities are whole multiples of `basePrecision`, so a remainder too small to
 * buy one more step stays unspent — as on the exchange.
 */
export function fillBuy(asks: BookLevel[], quoteAmount: Decimal, basePrecision: Decimal): Fill {
  let remaining = quoteAmount;
  let base = ZERO;
  let quote = ZERO;
  for (const level of asks) {
    const affordable = roundDown(remaining.div(level.price), basePrecision);
    const qty = Decimal.min(affordable, level.qty);
    if (qty.lte(0)) {
      return result(base, quote, true);
    }
    const cost = qty.times(level.price);
    base = base.plus(qty);
    quote = quote.plus(cost);
    remaining = remaining.minus(cost);
    if (qty.lt(level.qty)) {
      return result(base, quote, true);
    }
  }
  // Every level consumed: complete only if what is left cannot buy one more step.
  const last = asks[asks.length - 1];
  return result(base, quote, last !== undefined && remaining.lt(last.price.times(basePrecision)));
}

/** A market sell of `baseQty`, walking the bids from the best price down. */
export function fillSell(bids: BookLevel[], baseQty: Decimal): Fill {
  let remaining = baseQty;
  let base = ZERO;
  let quote = ZERO;
  for (const level of bids) {
    if (remaining.lte(0)) {
      break;
    }
    const qty = Decimal.min(remaining, level.qty);
    base = base.plus(qty);
    quote = quote.plus(qty.times(level.price));
    remaining = remaining.minus(qty);
  }
  return result(base, quote, remaining.lte(0));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/paper/fill.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/paper/fill.ts tests/paper/fill.test.ts
git commit -m "feat: fill market orders against an order book"
git push
```

---

## Task 7: Holdings, reconciliation, and sizing

Orders are sized from **available** funds; being at the target is judged on **totals**, so a lock can never make an account look emptier than it is (spec section 5).

**Files:**
- Create: `src/engine/holdings.ts`, `src/engine/reconcile.ts`, `src/engine/sizing.ts`, `tests/helpers/market.ts`
- Test: `tests/engine/sizing.test.ts`

- [ ] **Step 1: Create the market helper `tests/helpers/market.ts`**

```ts
import Decimal from 'decimal.js';
import type { CoinBalance } from '../../src/exchange/account.js';
import type { OrderBook } from '../../src/market/orderBook.js';
import type { InstrumentRules, Ticker } from '../../src/market/types.js';

/** Bybit's live BTCUSDT spot rules, fetched 2026-09-22. */
export const RULES: InstrumentRules = {
  symbol: 'BTCUSDT',
  baseCoin: 'BTC',
  quoteCoin: 'USDT',
  basePrecision: new Decimal('0.000001'),
  quotePrecision: new Decimal('0.0000001'),
  minOrderQty: new Decimal('0.000001'),
  minOrderAmt: new Decimal('5'),
  maxMarketOrderQty: new Decimal('120'),
};

/** A one-level book, `spread` either side of `price`, `qty` deep on each side. */
export function bookAround(
  price: Decimal.Value,
  qty: Decimal.Value = '5',
  spread: Decimal.Value = '0.0001',
): OrderBook {
  const p = new Decimal(price);
  const s = new Decimal(spread);
  return {
    asks: [{ price: p.times(new Decimal(1).plus(s)), qty: new Decimal(qty) }],
    bids: [{ price: p.times(new Decimal(1).minus(s)), qty: new Decimal(qty) }],
  };
}

export function tickerAt(price: Decimal.Value): Ticker {
  const p = new Decimal(price);
  return { symbol: 'BTCUSDT', lastPrice: p, bid: p, ask: p };
}

/** BTC and USDT balances, with optional locked and borrowed amounts. */
export function balances(
  btc: string,
  usdt: string,
  options: { lockedBtc?: string; lockedUsdt?: string; borrowedUsdt?: string } = {},
): CoinBalance[] {
  return [
    {
      coin: 'BTC',
      walletBalance: new Decimal(btc),
      locked: new Decimal(options.lockedBtc ?? '0'),
      borrowAmount: new Decimal(0),
    },
    {
      coin: 'USDT',
      walletBalance: new Decimal(usdt),
      locked: new Decimal(options.lockedUsdt ?? '0'),
      borrowAmount: new Decimal(options.borrowedUsdt ?? '0'),
    },
  ];
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/engine/sizing.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  accountValue,
  borrowedCoins,
  holdingsFor,
  lockedCoins,
  type Holdings,
} from '../../src/engine/holdings.js';
import { atTarget } from '../../src/engine/reconcile.js';
import { sizeOrder, type SizedOrder, type Sizing } from '../../src/engine/sizing.js';
import { fillBuy, fillSell } from '../../src/paper/fill.js';
import type { TargetState } from '../../src/types.js';
import { balances, RULES } from '../helpers/market.js';

const D = (value: string) => new Decimal(value);
const PRICE = D('85000');
const hold = (btc: string, usdt: string, options: Parameters<typeof balances>[2] = {}) =>
  holdingsFor(balances(btc, usdt, options), RULES);

/** A sizing as plain text, so assertions never depend on Decimal internals. */
function describeSizing(sizing: Sizing): string {
  if (sizing.kind !== 'ORDER') {
    return sizing.kind;
  }
  return sizing.order.side === 'BUY'
    ? `BUY ${sizing.order.quoteAmount.toFixed()}`
    : `SELL ${sizing.order.baseQty.toFixed()}`;
}

describe('holdingsFor', () => {
  it('separates what can be traded from what the account holds', () => {
    const h = hold('0.5', '100', { lockedBtc: '0.2', lockedUsdt: '10' });
    expect(h.base.available.toFixed()).toBe('0.3');
    expect(h.base.total.toFixed()).toBe('0.5');
    expect(h.quote.available.toFixed()).toBe('90');
    expect(h.quote.total.toFixed()).toBe('100');
  });

  it('treats a missing coin as zero, and ignores coins outside the pair', () => {
    const h = holdingsFor(
      [{ coin: 'ETH', walletBalance: D('3'), locked: D('0'), borrowAmount: D('0') }],
      RULES,
    );
    expect(h.base.total.isZero()).toBe(true);
    expect(h.quote.total.isZero()).toBe(true);
  });

  it('values the account from totals', () => {
    expect(accountValue(hold('0.01', '100', { lockedBtc: '0.01' }), PRICE).toFixed()).toBe('950');
  });
});

describe('borrowedCoins and lockedCoins', () => {
  it('name the coins that are borrowed or locked', () => {
    expect(borrowedCoins(balances('0', '100', { borrowedUsdt: '5' }))).toEqual(['USDT']);
    expect(lockedCoins(hold('1', '100', { lockedBtc: '1' }), RULES)).toEqual(['BTC']);
    expect(lockedCoins(hold('1', '100'), RULES)).toEqual([]);
  });
});

describe('atTarget', () => {
  it('counts an all-USDT account as FLAT, not LONG', () => {
    expect(atTarget('FLAT', hold('0', '1000'), PRICE, RULES)).toBe(true);
    expect(atTarget('LONG', hold('0', '1000'), PRICE, RULES)).toBe(false);
  });

  it('counts an all-BTC account as LONG, not FLAT', () => {
    expect(atTarget('LONG', hold('0.1', '0'), PRICE, RULES)).toBe(true);
    expect(atTarget('FLAT', hold('0.1', '0'), PRICE, RULES)).toBe(false);
  });

  it("tolerates dust below the exchange minimum", () => {
    expect(atTarget('LONG', hold('0.1', '4.99'), PRICE, RULES)).toBe(true);
  });

  it('tolerates up to 0.5% of the account in the wrong coin', () => {
    // 1 BTC at 85,000: 0.5% is 425 USDT.
    expect(atTarget('LONG', hold('1', '425'), PRICE, RULES)).toBe(true);
    expect(atTarget('LONG', hold('1', '430'), PRICE, RULES)).toBe(false);
  });

  it('judges exposure on totals, so locked BTC still counts against FLAT', () => {
    expect(atTarget('FLAT', hold('0.01', '1000', { lockedBtc: '0.01' }), PRICE, RULES)).toBe(false);
  });
});

describe('sizeOrder', () => {
  it('buys with 99.9% of the available USDT, rounded down', () => {
    // 1234.5678901 × 0.999 = 1233.3333222099, rounded down to 7 decimal places.
    expect(describeSizing(sizeOrder('LONG', hold('0', '1234.5678901'), PRICE, RULES))).toBe('BUY 1233.3333222');
  });

  it('sizes a buy from available USDT only', () => {
    const sizing = sizeOrder('LONG', hold('0', '1000', { lockedUsdt: '400' }), PRICE, RULES);
    expect(describeSizing(sizing)).toBe('BUY 599.4');
  });

  it('sells all available BTC, rounded down', () => {
    expect(describeSizing(sizeOrder('FLAT', hold('0.1234567', '0'), PRICE, RULES))).toBe('SELL 0.123456');
  });

  it('does nothing at the target', () => {
    expect(describeSizing(sizeOrder('FLAT', hold('0', '1000'), PRICE, RULES))).toBe('AT_TARGET');
  });

  it('reports an account too small to trade', () => {
    expect(describeSizing(sizeOrder('LONG', hold('0', '3'), PRICE, RULES))).toBe('TOO_SMALL');
  });

  it('reports an order that would fall below the minimum', () => {
    // 5.003 USDT is above the minimum, but 99.9% of it is not.
    expect(describeSizing(sizeOrder('LONG', hold('0', '5.003'), PRICE, RULES))).toBe('TOO_SMALL');
  });
});

describe('the invariant: after any sized order fills, the account is at the target', () => {
  const FEE = D('0.001');

  function afterFill(h: Holdings, order: SizedOrder, price: Decimal): Holdings {
    if (order.side === 'BUY') {
      const fill = fillBuy([{ price: price.times('1.0001'), qty: D('1000') }], order.quoteAmount, RULES.basePrecision);
      const btc = h.base.total.plus(fill.filledBaseQty.times(D('1').minus(FEE)));
      return holdingsFor(balances(btc.toFixed(), h.quote.total.minus(fill.filledQuoteAmount).toFixed()), RULES);
    }
    const fill = fillSell([{ price: price.times('0.9999'), qty: D('1000') }], order.baseQty);
    const usdt = h.quote.total.plus(fill.filledQuoteAmount.times(D('1').minus(FEE)));
    return holdingsFor(balances(h.base.total.minus(fill.filledBaseQty).toFixed(), usdt.toFixed()), RULES);
  }

  const cases: Array<[TargetState, string, string, string]> = [];
  for (const target of ['LONG', 'FLAT'] as const) {
    for (const usdt of ['6', '10', '999.99', '1000', '123456.78']) {
      for (const btc of ['0', '0.000123', '0.5', '3']) {
        for (const price of ['20000', '85530.4']) {
          cases.push([target, usdt, btc, price]);
        }
      }
    }
  }

  it.each(cases)('%s with %s USDT and %s BTC at %s', (target, usdt, btc, priceText) => {
    const price = D(priceText);
    const h = hold(btc, usdt);
    const sizing = sizeOrder(target, h, price, RULES);
    if (sizing.kind === 'ORDER') {
      expect(atTarget(target, afterFill(h, sizing.order, price), price, RULES)).toBe(true);
    } else {
      expect(['AT_TARGET', 'TOO_SMALL']).toContain(sizing.kind);
    }
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/engine/sizing.test.ts`
Expected: FAIL — the modules do not exist.

- [ ] **Step 4: Create `src/engine/holdings.ts`**

```ts
import Decimal from 'decimal.js';
import type { CoinBalance } from '../exchange/account.js';
import type { InstrumentRules } from '../market/types.js';

/** One coin seen two ways: what can be traded, and what the account is exposed to. */
export type CoinHolding = { available: Decimal; total: Decimal; locked: Decimal };
export type Holdings = { base: CoinHolding; quote: CoinHolding };

const ZERO = new Decimal(0);

function holdingOf(balances: CoinBalance[], coin: string): CoinHolding {
  const balance = balances.find((b) => b.coin === coin);
  if (balance === undefined) {
    return { available: ZERO, total: ZERO, locked: ZERO };
  }
  return {
    available: Decimal.max(ZERO, balance.walletBalance.minus(balance.locked)),
    total: balance.walletBalance,
    locked: balance.locked,
  };
}

/** The pair's two coins. Every other coin is ignored: the strategy neither trades nor values it. */
export function holdingsFor(balances: CoinBalance[], rules: InstrumentRules): Holdings {
  return { base: holdingOf(balances, rules.baseCoin), quote: holdingOf(balances, rules.quoteCoin) };
}

/** Coins with borrowed funds. The engine never trades while anything is borrowed. */
export function borrowedCoins(balances: CoinBalance[]): string[] {
  return balances.filter((b) => b.borrowAmount.gt(0)).map((b) => b.coin);
}

/** The pair's coins with funds locked — in a dedicated account, by an order the engine did not place. */
export function lockedCoins(holdings: Holdings, rules: InstrumentRules): string[] {
  const coins: string[] = [];
  if (holdings.base.locked.gt(0)) {
    coins.push(rules.baseCoin);
  }
  if (holdings.quote.locked.gt(0)) {
    coins.push(rules.quoteCoin);
  }
  return coins;
}

/** Account value in the quote coin, from totals. */
export function accountValue(holdings: Holdings, price: Decimal): Decimal {
  return holdings.quote.total.plus(holdings.base.total.times(price));
}
```

- [ ] **Step 5: Create `src/engine/reconcile.ts`**

```ts
import Decimal from 'decimal.js';
import type { InstrumentRules } from '../market/types.js';
import type { TargetState } from '../types.js';
import { accountValue, type Holdings } from './holdings.js';

/** How much of the account may sit in the wrong coin while still counting as at the target. */
export const TARGET_TOLERANCE = new Decimal('0.005');

/**
 * Whether the account is where the target wants it. Judged on TOTAL balances,
 * so funds locked in an order can never make the account look emptier than it
 * is. The allowance absorbs rounding and the buy headroom: whatever is left in
 * the wrong coin must be below the exchange minimum or 0.5% of the account.
 */
export function atTarget(
  target: TargetState,
  holdings: Holdings,
  price: Decimal,
  rules: InstrumentRules,
): boolean {
  const allowance = Decimal.max(rules.minOrderAmt, accountValue(holdings, price).times(TARGET_TOLERANCE));
  const wrongSide = target === 'LONG' ? holdings.quote.total : holdings.base.total.times(price);
  return wrongSide.lte(allowance);
}
```

- [ ] **Step 6: Create `src/engine/sizing.ts`**

```ts
import Decimal from 'decimal.js';
import type { InstrumentRules } from '../market/types.js';
import { roundDown } from '../math.js';
import type { TargetState } from '../types.js';
import { accountValue, type Holdings } from './holdings.js';
import { atTarget } from './reconcile.js';

/** A buy spends at most 99.9% of the available quote coin, so it can never exceed the balance. */
export const BUY_HEADROOM = new Decimal('0.001');

export type SizedOrder = { side: 'BUY'; quoteAmount: Decimal } | { side: 'SELL'; baseQty: Decimal };

export type Sizing =
  | { kind: 'AT_TARGET' }
  | { kind: 'TOO_SMALL'; reason: string }
  | { kind: 'ORDER'; order: SizedOrder };

/**
 * The one order that moves the account to the target, if any. All in or all
 * out, from available funds, rounded down to the exchange's steps. See spec
 * section 5.
 */
export function sizeOrder(
  target: TargetState,
  holdings: Holdings,
  price: Decimal,
  rules: InstrumentRules,
): Sizing {
  const minimum = `${rules.minOrderAmt.toFixed()} ${rules.quoteCoin}`;
  if (accountValue(holdings, price).lt(rules.minOrderAmt)) {
    return { kind: 'TOO_SMALL', reason: `the account is worth less than the exchange minimum order of ${minimum}` };
  }
  if (atTarget(target, holdings, price, rules)) {
    return { kind: 'AT_TARGET' };
  }
  if (target === 'LONG') {
    const quoteAmount = roundDown(
      holdings.quote.available.times(new Decimal(1).minus(BUY_HEADROOM)),
      rules.quotePrecision,
    );
    if (quoteAmount.lt(rules.minOrderAmt)) {
      return { kind: 'TOO_SMALL', reason: `the buy would be below the exchange minimum order of ${minimum}` };
    }
    return { kind: 'ORDER', order: { side: 'BUY', quoteAmount } };
  }
  const baseQty = roundDown(holdings.base.available, rules.basePrecision);
  if (baseQty.lt(rules.minOrderQty) || baseQty.times(price).lt(rules.minOrderAmt)) {
    return { kind: 'TOO_SMALL', reason: `the sell would be below the exchange minimum order of ${minimum}` };
  }
  return { kind: 'ORDER', order: { side: 'SELL', baseQty } };
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/engine/sizing.test.ts`
Expected: PASS — including all 80 invariant cases.

- [ ] **Step 8: Commit**

```bash
git add src/engine/holdings.ts src/engine/reconcile.ts src/engine/sizing.ts tests/engine/sizing.test.ts tests/helpers/market.ts
git commit -m "feat: size orders from available funds and reconcile on totals"
git push
```

---

## Task 8: The Risk Guard

Every rule in spec section 6, each failure listed. A veto freezes the account (Task 15).

**Files:**
- Modify: `src/types.ts`
- Create: `src/engine/riskGuard.ts`
- Test: `tests/engine/riskGuard.test.ts`

- [ ] **Step 1: Add `AccountStatus` to `src/types.ts`**

Append:

```ts
/** Whether an account may trade. Only `active` accounts do. */
export type AccountStatus = 'active' | 'paused' | 'frozen';
```

- [ ] **Step 2: Write the failing tests**

Create `tests/engine/riskGuard.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { holdingsFor } from '../../src/engine/holdings.js';
import { checkOrder, type RiskContext } from '../../src/engine/riskGuard.js';
import type { SizedOrder } from '../../src/engine/sizing.js';
import { balances, bookAround, RULES, tickerAt } from '../helpers/market.js';

const D = (value: string) => new Decimal(value);
const BUY: SizedOrder = { side: 'BUY', quoteAmount: D('999') };

function context(overrides: Partial<RiskContext> = {}): RiskContext {
  return {
    killSwitchOn: false,
    accountStatus: 'active',
    priorOrderToday: false,
    attempt: 1,
    holdings: holdingsFor(balances('0', '1000'), RULES),
    rules: RULES,
    book: bookAround('85000'),
    ticker: tickerAt('85000'),
    signalClose: D('84000'),
    maxOrderUsdt: null,
    ...overrides,
  };
}

function reasons(order: SizedOrder, ctx: RiskContext): string[] {
  const decision = checkOrder(order, ctx);
  return decision.approved ? [] : decision.reasons;
}

describe('checkOrder', () => {
  it('approves an order that breaks no rule', () => {
    expect(checkOrder(BUY, context())).toEqual({ approved: true });
  });

  const VETOES: Array<[string, Partial<RiskContext>, string]> = [
    ['the kill switch is on', { killSwitchOn: true }, 'kill switch'],
    ['the account is paused', { accountStatus: 'paused' }, 'The account is paused'],
    ['an order already went out today', { priorOrderToday: true }, 'already went'],
    ['this would be a fourth attempt', { attempt: 4 }, 'failed to reach'],
    ['the spread is wide', { book: bookAround('85000', '5', '0.01') }, 'spread'],
    ['the last trade disagrees with the book', { ticker: tickerAt('87000') }, 'last trade'],
    ['the price is far from the signal close', { signalClose: D('60000') }, 'signal used'],
    ['the book is too thin', { book: bookAround('85000', '0.001') }, 'cannot fill'],
    ['the order is above the cap', { maxOrderUsdt: D('500') }, 'cap'],
  ];

  it.each(VETOES)('vetoes a buy when %s', (_name, overrides, fragment) => {
    expect(reasons(BUY, context(overrides)).join(' ')).toContain(fragment);
  });

  it('vetoes spending more than is available', () => {
    expect(reasons({ side: 'BUY', quoteAmount: D('1001') }, context()).join(' ')).toContain('more than the 1000');
  });

  it('vetoes a buy below the minimum', () => {
    expect(reasons({ side: 'BUY', quoteAmount: D('4') }, context()).join(' ')).toContain('minimum order value');
  });

  it('vetoes selling more than is held', () => {
    const ctx = context({ holdings: holdingsFor(balances('0.01', '0'), RULES) });
    expect(reasons({ side: 'SELL', baseQty: D('0.02') }, ctx).join(' ')).toContain('more than the 0.01');
  });

  it('vetoes a sell below the minimum', () => {
    const ctx = context({ holdings: holdingsFor(balances('0.01', '0'), RULES) });
    expect(reasons({ side: 'SELL', baseQty: D('0.00005') }, ctx).join(' ')).toContain('below the exchange minimum');
  });

  it('vetoes a sell above the market order maximum', () => {
    const ctx = context({ holdings: holdingsFor(balances('200', '0'), RULES), book: bookAround('85000', '500') });
    expect(reasons({ side: 'SELL', baseQty: D('121') }, ctx).join(' ')).toContain('maximum market order');
  });

  it('vetoes a crossed book', () => {
    const book = { asks: [{ price: D('84990'), qty: D('5') }], bids: [{ price: D('85010'), qty: D('5') }] };
    expect(reasons(BUY, context({ book })).join(' ')).toContain('best ask is not above');
  });

  it('vetoes an empty book', () => {
    expect(reasons(BUY, context({ book: { asks: [], bids: [] } })).join(' ')).toContain('empty');
  });

  it('vetoes a fill that would average far from the price', () => {
    const book = {
      asks: [
        { price: D('85008.5'), qty: D('0.001') },
        { price: D('90000'), qty: D('10') },
      ],
      bids: [{ price: D('84991.5'), qty: D('5') }],
    };
    expect(reasons(BUY, context({ book })).join(' ')).toContain('average');
  });

  it('lists every rule that fails, not just the first', () => {
    expect(reasons(BUY, context({ killSwitchOn: true, accountStatus: 'frozen' }))).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/engine/riskGuard.test.ts`
Expected: FAIL — `src/engine/riskGuard.ts` does not exist.

- [ ] **Step 4: Create `src/engine/riskGuard.ts`**

```ts
import Decimal from 'decimal.js';
import { midPrice, type OrderBook } from '../market/orderBook.js';
import type { InstrumentRules, Ticker } from '../market/types.js';
import { fillBuy, fillSell } from '../paper/fill.js';
import type { AccountStatus } from '../types.js';
import type { Holdings } from './holdings.js';
import type { SizedOrder } from './sizing.js';

/** The widest acceptable spread, as a fraction of the mid price. */
export const MAX_SPREAD = new Decimal('0.005');
/** How far the mid may be from the last traded price. */
export const MAX_LAST_TRADE_GAP = new Decimal('0.01');
/** How far the mid may be from the close the signal used — wide enough for a late run during a crash. */
export const MAX_SIGNAL_GAP = new Decimal('0.2');
/** How far the expected average fill may be from the mid. */
export const MAX_FILL_GAP = new Decimal('0.01');
/** Attempts allowed per account per day (spec section 4.2). */
export const MAX_ATTEMPTS_PER_DAY = 3;

export type RiskContext = {
  killSwitchOn: boolean;
  accountStatus: AccountStatus;
  /** An earlier intent today was not confirmed NOT_PLACED, so an order may already have executed. */
  priorOrderToday: boolean;
  /** Which attempt at today's order this is, from 1. */
  attempt: number;
  holdings: Holdings;
  rules: InstrumentRules;
  book: OrderBook;
  ticker: Ticker;
  signalClose: Decimal;
  maxOrderUsdt: Decimal | null;
};

export type RiskDecision = { approved: true } | { approved: false; reasons: string[] };

const gap = (value: Decimal, reference: Decimal): Decimal => value.minus(reference).abs().div(reference);
const percent = (fraction: Decimal): string => `${fraction.times(100).toFixed()}%`;

/**
 * Checks one order against every rule in spec section 6, and lists every rule
 * it breaks rather than stopping at the first. The engine freezes the account
 * on any veto.
 */
export function checkOrder(order: SizedOrder, context: RiskContext): RiskDecision {
  const reasons: string[] = [];
  const { rules, holdings, book } = context;

  if (context.killSwitchOn) {
    reasons.push('The kill switch is on.');
  }
  if (context.accountStatus !== 'active') {
    reasons.push(`The account is ${context.accountStatus}.`);
  }
  if (context.priorOrderToday) {
    reasons.push('An order already went to this account today.');
  }
  if (context.attempt > MAX_ATTEMPTS_PER_DAY) {
    reasons.push(`Orders have failed to reach the account ${MAX_ATTEMPTS_PER_DAY} times today.`);
  }

  const bestBid = book.bids[0];
  const bestAsk = book.asks[0];
  if (bestBid === undefined || bestAsk === undefined) {
    reasons.push('The order book is empty on one side.');
    return { approved: false, reasons };
  }
  const mid = midPrice(book);

  if (order.side === 'BUY') {
    if (order.quoteAmount.gt(holdings.quote.available)) {
      reasons.push(
        `The buy spends ${order.quoteAmount.toFixed()} ${rules.quoteCoin}, more than the ${holdings.quote.available.toFixed()} available.`,
      );
    }
    if (order.quoteAmount.lt(rules.minOrderAmt)) {
      reasons.push(`The buy is below the minimum order value of ${rules.minOrderAmt.toFixed()} ${rules.quoteCoin}.`);
    }
  } else {
    if (order.baseQty.gt(holdings.base.available)) {
      reasons.push(
        `The sell is ${order.baseQty.toFixed()} ${rules.baseCoin}, more than the ${holdings.base.available.toFixed()} available.`,
      );
    }
    if (order.baseQty.lt(rules.minOrderQty) || order.baseQty.times(mid).lt(rules.minOrderAmt)) {
      reasons.push('The sell is below the exchange minimum.');
    }
    if (order.baseQty.gt(rules.maxMarketOrderQty)) {
      reasons.push(`The sell is above the maximum market order of ${rules.maxMarketOrderQty.toFixed()} ${rules.baseCoin}.`);
    }
  }
  const notional = order.side === 'BUY' ? order.quoteAmount : order.baseQty.times(mid);
  if (context.maxOrderUsdt !== null && notional.gt(context.maxOrderUsdt)) {
    reasons.push(`The order is worth more than the cap of ${context.maxOrderUsdt.toFixed()} ${rules.quoteCoin}.`);
  }

  if (bestBid.price.lte(0)) {
    reasons.push('The best bid is not above zero.');
  }
  if (bestAsk.price.lte(bestBid.price)) {
    reasons.push('The best ask is not above the best bid.');
  } else if (bestAsk.price.minus(bestBid.price).div(mid).gt(MAX_SPREAD)) {
    reasons.push(`The spread is wider than ${percent(MAX_SPREAD)} of the price.`);
  }
  if (gap(mid, context.ticker.lastPrice).gt(MAX_LAST_TRADE_GAP)) {
    reasons.push(`The order book and the last trade disagree by more than ${percent(MAX_LAST_TRADE_GAP)}.`);
  }
  if (gap(mid, context.signalClose).gt(MAX_SIGNAL_GAP)) {
    reasons.push(`The price is more than ${percent(MAX_SIGNAL_GAP)} away from the close the signal used.`);
  }

  const fill =
    order.side === 'BUY'
      ? fillBuy(book.asks, order.quoteAmount, rules.basePrecision)
      : fillSell(book.bids, order.baseQty);
  if (!fill.complete || fill.avgPrice === null) {
    reasons.push('The order book cannot fill the whole order.');
  } else if (gap(fill.avgPrice, mid).gt(MAX_FILL_GAP)) {
    reasons.push(`Filling the order would average more than ${percent(MAX_FILL_GAP)} away from the price.`);
  }
  if (order.side === 'BUY' && fill.filledBaseQty.gt(rules.maxMarketOrderQty)) {
    reasons.push(`The buy would exceed the maximum market order of ${rules.maxMarketOrderQty.toFixed()} ${rules.baseCoin}.`);
  }

  return reasons.length === 0 ? { approved: true } : { approved: false, reasons };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/engine/riskGuard.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/engine/riskGuard.ts tests/engine/riskGuard.test.ts
git commit -m "feat: add the Risk Guard"
git push
```

---

## Task 9: Tables, and a ledger the database keeps append-only

The ledger is the track record. The database itself refuses to change or delete it, and holds each client order ID to exactly one intent and one result (spec sections 4.2 and 8).

**Files:**
- Modify: `src/db/schema.ts`, `tests/helpers/vault.ts`
- Create: `drizzle/0001_paper_engine.sql` (generated), `drizzle/0002_ledger_append_only.sql` (hand-written), `tests/helpers/database.ts`
- Test: `tests/db/paperEngineTables.test.ts`

- [ ] **Step 1: Create the database helper `tests/helpers/database.ts`**

```ts
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { openDatabase, type Database } from '../../src/db/client.js';
import {
  accountState,
  alertLog,
  cycleRuns,
  exchangeCredentials,
  ledgerEvents,
  paperBalances,
  paperOrders,
} from '../../src/db/schema.js';

/**
 * Empties every table. The ledger refuses deletes by design, so its triggers
 * are switched off just long enough to empty it — something only test code does.
 */
export async function emptyAllTables(db: Database): Promise<void> {
  await db.delete(exchangeCredentials);
  await db.delete(accountState);
  await db.delete(cycleRuns);
  await db.delete(alertLog);
  await db.delete(paperBalances);
  await db.delete(paperOrders);
  await db.execute(sql`ALTER TABLE ledger_events DISABLE TRIGGER USER`);
  try {
    await db.delete(ledgerEvents);
  } finally {
    await db.execute(sql`ALTER TABLE ledger_events ENABLE TRIGGER USER`);
  }
}

/**
 * One in-memory database for a whole test file, emptied before every test.
 *
 * Starting PGlite takes several seconds. A fresh database per test made a single
 * seven-test file take 30 seconds — slow enough to discourage running the suite.
 * Emptying the tables keeps each test independent at a fraction of the cost.
 * Call at the top level of a test file, then use `database()` inside tests.
 */
export function useTestDatabase(): () => Database {
  let opened: { db: Database; close: () => Promise<void> } | undefined;

  beforeAll(async () => {
    opened = await openDatabase();
  });
  beforeEach(async () => {
    await emptyAllTables(opened!.db);
  });
  afterAll(async () => {
    await opened?.close();
  });

  return () => {
    if (opened === undefined) {
      throw new Error('useTestDatabase() must be called at the top level of a test file');
    }
    return opened.db;
  };
}
```

- [ ] **Step 2: Point `tests/helpers/vault.ts` at it**

Replace the whole file with:

```ts
import { keyringFromEnv, type Keyring } from '../../src/vault/keyring.js';

export { useTestDatabase } from './database.js';

/**
 * A deterministic keyring for tests. `versions` maps a key version to the byte
 * every position of that 32-byte key is filled with.
 */
export function testKeyring(versions: Record<number, number> = { 1: 1 }, active = 1): Keyring {
  const env: Record<string, string> = { VAULT_ACTIVE_KEY_VERSION: String(active) };
  for (const [version, fill] of Object.entries(versions)) {
    env[`VAULT_MASTER_KEY_V${version}`] = Buffer.alloc(32, fill).toString('base64');
  }
  return keyringFromEnv(env);
}
```

- [ ] **Step 3: Write the failing tests**

Create `tests/db/paperEngineTables.test.ts`:

```ts
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { cycleRuns, ledgerEvents, paperBalances } from '../../src/db/schema.js';
import { emptyAllTables, useTestDatabase } from '../helpers/database.js';

const database = useTestDatabase();
const AT = new Date('2026-09-22T00:02:00Z');

const event = (type: string, clientOrderId?: string) => ({
  occurredAt: AT,
  userId: 'founder',
  cycleDate: '2026-09-21',
  type,
  payload: clientOrderId === undefined ? {} : { clientOrderId },
});

describe('ledger_events', () => {
  it('accepts new events', async () => {
    await database().insert(ledgerEvents).values(event('SIGNAL'));
    expect(await database().select().from(ledgerEvents)).toHaveLength(1);
  });

  it('rejects an update', async () => {
    await database().insert(ledgerEvents).values(event('SIGNAL'));
    await expect(database().update(ledgerEvents).set({ type: 'CHANGED' })).rejects.toThrow();
  });

  it('rejects a delete', async () => {
    await database().insert(ledgerEvents).values(event('SIGNAL'));
    await expect(database().delete(ledgerEvents)).rejects.toThrow();
  });

  it('rejects a truncate', async () => {
    await database().insert(ledgerEvents).values(event('SIGNAL'));
    await expect(database().execute(sql`TRUNCATE ledger_events`)).rejects.toThrow();
  });

  it('stays protected after the test helper empties it', async () => {
    await database().insert(ledgerEvents).values(event('SIGNAL'));
    await emptyAllTables(database());
    expect(await database().select().from(ledgerEvents)).toHaveLength(0);
    await database().insert(ledgerEvents).values(event('SIGNAL'));
    await expect(database().delete(ledgerEvents)).rejects.toThrow();
  });

  it('holds each client order ID to one intent and one result', async () => {
    await database().insert(ledgerEvents).values(event('ORDER_INTENT', 'ca1'));
    await expect(database().insert(ledgerEvents).values(event('ORDER_INTENT', 'ca1'))).rejects.toThrow();
    await database().insert(ledgerEvents).values(event('ORDER_RESULT', 'ca1'));
    await expect(database().insert(ledgerEvents).values(event('ORDER_RESULT', 'ca1'))).rejects.toThrow();
    await database().insert(ledgerEvents).values(event('ORDER_INTENT', 'ca2'));
    expect(await database().select().from(ledgerEvents)).toHaveLength(3);
  });

  it('returns cycle dates as YYYY-MM-DD strings', async () => {
    await database().insert(ledgerEvents).values(event('SIGNAL'));
    const [row] = await database().select().from(ledgerEvents);
    expect(row!.cycleDate).toBe('2026-09-21');
  });
});

describe('amount columns', () => {
  it('keep eighteen decimal places exactly', async () => {
    await database().insert(paperBalances).values({ userId: 'founder', coin: 'BTC', free: '0.123456789012345678' });
    const [row] = await database().select().from(paperBalances);
    expect(row!.free).toBe('0.123456789012345678');
  });
});

describe('cycle_runs', () => {
  it('allows one row per day and user', async () => {
    const run = { cycleDate: '2026-09-21', userId: 'founder', status: 'pending', attempts: 1, firstAttemptAt: AT };
    await database().insert(cycleRuns).values(run);
    await expect(database().insert(cycleRuns).values(run)).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `npx vitest run tests/db/paperEngineTables.test.ts`
Expected: FAIL — the new tables are not exported from `src/db/schema.ts`.

- [ ] **Step 5: Add the tables to `src/db/schema.ts`**

Replace the import line with:

```ts
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
```

Leave `exchangeCredentials` exactly as it is, and append:

```ts
/** Enough digits for any amount of any coin: 20 before the point, 18 after. */
const amount = (name: string) => numeric(name, { precision: 38, scale: 18 });

/**
 * The append-only record of everything the engine decided and did. The
 * migration drizzle/0002_ledger_append_only.sql adds a trigger that rejects
 * UPDATE, DELETE, and TRUNCATE, and unique indexes that hold each client order
 * ID to one ORDER_INTENT and one ORDER_RESULT.
 */
export const ledgerEvents = pgTable(
  'ledger_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    /** Null for events that concern everyone, such as the day's signal. */
    userId: text('user_id'),
    cycleDate: date('cycle_date', { mode: 'string' }),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    index('ledger_events_user_idx').on(table.userId, table.type),
    index('ledger_events_day_idx').on(table.cycleDate, table.type),
  ],
);

/** Whether each account may trade. Every change is also written to the ledger. */
export const accountState = pgTable('account_state', {
  userId: text('user_id').primaryKey(),
  status: text('status').notNull(),
  reason: text('reason'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

/** One row per user and cycle date: where that day's run stands. The history is in the ledger. */
export const cycleRuns = pgTable(
  'cycle_runs',
  {
    cycleDate: date('cycle_date', { mode: 'string' }).notNull(),
    userId: text('user_id').notNull(),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull(),
    firstAttemptAt: timestamp('first_attempt_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    late: boolean('late').notNull().default(false),
    lastError: text('last_error'),
  },
  (table) => [primaryKey({ columns: [table.cycleDate, table.userId] })],
);

/** Alerts already sent, so each goes out once rather than every 15 minutes. */
export const alertLog = pgTable('alert_log', {
  key: text('key').primaryKey(),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
});

/** The paper account's balances: the exchange's side of paper trading. */
export const paperBalances = pgTable(
  'paper_balances',
  {
    userId: text('user_id').notNull(),
    coin: text('coin').notNull(),
    free: amount('free').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.coin] })],
);

/** The paper account's orders, one per client order ID. */
export const paperOrders = pgTable('paper_orders', {
  clientOrderId: text('client_order_id').primaryKey(),
  userId: text('user_id').notNull(),
  symbol: text('symbol').notNull(),
  side: text('side').notNull(),
  /** The quote coin to spend on a buy; the base coin to sell on a sell. */
  requested: amount('requested').notNull(),
  status: text('status').notNull(),
  filledBaseQty: amount('filled_base_qty').notNull(),
  filledQuoteAmount: amount('filled_quote_amount').notNull(),
  avgPrice: amount('avg_price'),
  fee: amount('fee').notNull(),
  feeCoin: text('fee_coin').notNull(),
  rejectReason: text('reject_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});
```

- [ ] **Step 6: Generate the table migration**

Run: `npx drizzle-kit generate --name=paper_engine`

Expected: `drizzle/0001_paper_engine.sql`, plus an updated `drizzle/meta/_journal.json` and a new snapshot. Open the SQL file and check it contains `CREATE TABLE` for `account_state`, `alert_log`, `cycle_runs`, `ledger_events`, `paper_balances`, and `paper_orders`, and the two `ledger_events` indexes — and that it does **not** alter `exchange_credentials`.

- [ ] **Step 7: Create the hand-written migration**

Run: `npx drizzle-kit generate --custom --name=ledger_append_only`

Expected: an empty `drizzle/0002_ledger_append_only.sql`, registered in the journal. Replace its whole content with:

```sql
-- The ledger is the track record: history may only grow.
CREATE FUNCTION ledger_events_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_events is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ledger_events_no_update_or_delete
  BEFORE UPDATE OR DELETE ON ledger_events
  FOR EACH ROW EXECUTE FUNCTION ledger_events_reject_change();
--> statement-breakpoint
CREATE TRIGGER ledger_events_no_truncate
  BEFORE TRUNCATE ON ledger_events
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_events_reject_change();
--> statement-breakpoint
-- Each client order ID has exactly one intent and at most one result (spec section 4.2).
CREATE UNIQUE INDEX ledger_events_one_intent_per_order
  ON ledger_events ((payload->>'clientOrderId'))
  WHERE type = 'ORDER_INTENT';
--> statement-breakpoint
CREATE UNIQUE INDEX ledger_events_one_result_per_order
  ON ledger_events ((payload->>'clientOrderId'))
  WHERE type = 'ORDER_RESULT';
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run tests/db tests/vault`
Expected: PASS — the new tests, and the existing database and vault tests through the moved helper.

- [ ] **Step 9: Run the whole suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/db/schema.ts drizzle tests/helpers/database.ts tests/helpers/vault.ts tests/db/paperEngineTables.test.ts
git commit -m "feat: add the engine's tables and an append-only ledger"
git push
```

---

## Task 10: The ledger

**Files:**
- Create: `src/ledger/ledger.ts`
- Test: `tests/ledger/ledger.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/ledger/ledger.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { ledgerEvents } from '../../src/db/schema.js';
import { Ledger, type NewLedgerEvent } from '../../src/ledger/ledger.js';
import { useTestDatabase } from '../helpers/database.js';

const database = useTestDatabase();
const ledger = () => new Ledger(database());
const AT = new Date('2026-09-22T00:02:00Z');
const DAY_1 = '2026-09-21';
const DAY_2 = '2026-09-22';

const intent = (id: string, day: string): NewLedgerEvent => ({
  occurredAt: AT,
  userId: 'founder',
  cycleDate: day,
  type: 'ORDER_INTENT',
  payload: { clientOrderId: id },
});
const result = (id: string, day: string, status = 'FILLED'): NewLedgerEvent => ({
  occurredAt: AT,
  userId: 'founder',
  cycleDate: day,
  type: 'ORDER_RESULT',
  payload: { clientOrderId: id, status },
});

describe('Ledger', () => {
  it("appends and reads a user's events, oldest first", async () => {
    await ledger().append(intent('a', DAY_1));
    await ledger().append(result('a', DAY_1));
    const events = await ledger().forUser('founder');
    expect(events.map((e) => e.type)).toEqual(['ORDER_INTENT', 'ORDER_RESULT']);
    expect(events[0]!.id).toBeLessThan(events[1]!.id);
  });

  it('stores decimals as exact strings', async () => {
    await ledger().append({ ...intent('a', DAY_1), payload: { clientOrderId: 'a', amount: new Decimal('0.000123') } });
    const [event] = await ledger().forUser('founder');
    expect(event!.payload.amount).toBe('0.000123');
  });

  it("keeps everyone's events apart from a user's", async () => {
    await ledger().append({ occurredAt: AT, userId: null, cycleDate: DAY_1, type: 'SIGNAL', payload: { target: 'LONG' } });
    expect(await ledger().forUser('founder')).toEqual([]);
    expect((await ledger().signalFor(DAY_1))?.payload.target).toBe('LONG');
    expect(await ledger().signalFor(DAY_2)).toBeNull();
  });

  it('finds outstanding intents from any day, oldest first', async () => {
    await ledger().append(intent('a', DAY_1));
    await ledger().append(result('a', DAY_1));
    await ledger().append(intent('b', DAY_1));
    await ledger().append(intent('c', DAY_2));
    const outstanding = await ledger().outstandingIntents('founder');
    expect(outstanding.map((e) => e.payload.clientOrderId)).toEqual(['b', 'c']);
  });

  it("pairs each day's intents with their results", async () => {
    await ledger().append(intent('a', DAY_1));
    await ledger().append(result('a', DAY_1, 'NOT_PLACED'));
    await ledger().append(intent('b', DAY_1));
    const orders = await ledger().ordersOn('founder', DAY_1);
    expect(orders.map((o) => [o.intent.payload.clientOrderId, o.result?.payload.status ?? null])).toEqual([
      ['a', 'NOT_PLACED'],
      ['b', null],
    ]);
    expect(await ledger().ordersOn('founder', DAY_2)).toEqual([]);
  });

  it('lists the events of one type', async () => {
    await ledger().append(intent('a', DAY_1));
    await ledger().append(intent('b', DAY_2));
    expect(await ledger().ofType('ORDER_INTENT', 'founder')).toHaveLength(2);
    expect(await ledger().ofType('ORDER_INTENT', null)).toHaveLength(0);
  });

  it('refuses an event type it does not know', async () => {
    await database().insert(ledgerEvents).values({ ...intent('a', DAY_1), type: 'BOGUS' });
    await expect(ledger().forUser('founder')).rejects.toThrow('unknown ledger event type');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/ledger/ledger.test.ts`
Expected: FAIL — `src/ledger/ledger.ts` does not exist.

- [ ] **Step 3: Create `src/ledger/ledger.ts`**

```ts
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { ledgerEvents } from '../db/schema.js';

export const LEDGER_EVENT_TYPES = [
  'ACCOUNT_OPENED',
  'SIGNAL',
  'ORDER_INTENT',
  'ORDER_RESULT',
  'RECONCILED',
  'RUN_COMPLETED',
  'RUN_FAILED',
  'RUN_ABANDONED',
  'FROZEN',
  'UNFROZEN',
  'PAUSED',
  'RESUMED',
  'KILL_SWITCH_SKIP',
  'TOO_SMALL',
] as const;

export type LedgerEventType = (typeof LEDGER_EVENT_TYPES)[number];

export type LedgerEvent = {
  id: number;
  occurredAt: Date;
  /** Null for events that concern everyone, such as the day's signal. */
  userId: string | null;
  cycleDate: string | null;
  type: LedgerEventType;
  payload: Record<string, unknown>;
};

export type NewLedgerEvent = Omit<LedgerEvent, 'id'>;

export type DayOrder = { intent: LedgerEvent; result: LedgerEvent | null };

type Row = typeof ledgerEvents.$inferSelect;

function toEvent(row: Row): LedgerEvent {
  if (!(LEDGER_EVENT_TYPES as readonly string[]).includes(row.type)) {
    throw new Error(`unknown ledger event type "${row.type}"`);
  }
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    userId: row.userId,
    cycleDate: row.cycleDate,
    type: row.type as LedgerEventType,
    payload: row.payload,
  };
}

const ORDER_EVENTS = ['ORDER_INTENT', 'ORDER_RESULT'];

/**
 * The append-only record of everything the engine decided and did — the track
 * record. The database rejects updates and deletes, so history only grows, and
 * it holds each client order ID to one intent and one result. Decimal values in
 * payloads are stored as strings, through Decimal#toJSON.
 */
export class Ledger {
  constructor(private readonly db: Database) {}

  async append(event: NewLedgerEvent): Promise<void> {
    await this.db.insert(ledgerEvents).values(event);
  }

  /** Every event for one user, oldest first. */
  async forUser(userId: string): Promise<LedgerEvent[]> {
    const rows = await this.db
      .select()
      .from(ledgerEvents)
      .where(eq(ledgerEvents.userId, userId))
      .orderBy(asc(ledgerEvents.id));
    return rows.map(toEvent);
  }

  /** Every event of one type, oldest first — for one user, or for everyone when `userId` is null. */
  async ofType(type: LedgerEventType, userId: string | null): Promise<LedgerEvent[]> {
    const who = userId === null ? isNull(ledgerEvents.userId) : eq(ledgerEvents.userId, userId);
    const rows = await this.db
      .select()
      .from(ledgerEvents)
      .where(and(eq(ledgerEvents.type, type), who))
      .orderBy(asc(ledgerEvents.id));
    return rows.map(toEvent);
  }

  /** The day's signal, once it has been recorded. */
  async signalFor(cycleDate: string): Promise<LedgerEvent | null> {
    const rows = await this.db
      .select()
      .from(ledgerEvents)
      .where(and(eq(ledgerEvents.type, 'SIGNAL'), eq(ledgerEvents.cycleDate, cycleDate), isNull(ledgerEvents.userId)))
      .orderBy(asc(ledgerEvents.id))
      .limit(1);
    return rows[0] === undefined ? null : toEvent(rows[0]);
  }

  /**
   * Order intents with no result yet, oldest first — from any day. Each client
   * order ID has one intent and at most one result, so an intent is outstanding
   * exactly when no result names its ID.
   */
  async outstandingIntents(userId: string): Promise<LedgerEvent[]> {
    const rows = await this.db
      .select()
      .from(ledgerEvents)
      .where(and(eq(ledgerEvents.userId, userId), inArray(ledgerEvents.type, ORDER_EVENTS)))
      .orderBy(asc(ledgerEvents.id));
    const events = rows.map(toEvent);
    const settled = new Set(
      events.filter((e) => e.type === 'ORDER_RESULT').map((e) => String(e.payload.clientOrderId)),
    );
    return events.filter((e) => e.type === 'ORDER_INTENT' && !settled.has(String(e.payload.clientOrderId)));
  }

  /**
   * One user's orders on one cycle date, oldest first: each intent with its
   * result, if settled. Results are recorded under their intent's cycle date,
   * even when they are settled later.
   */
  async ordersOn(userId: string, cycleDate: string): Promise<DayOrder[]> {
    const rows = await this.db
      .select()
      .from(ledgerEvents)
      .where(
        and(
          eq(ledgerEvents.userId, userId),
          eq(ledgerEvents.cycleDate, cycleDate),
          inArray(ledgerEvents.type, ORDER_EVENTS),
        ),
      )
      .orderBy(asc(ledgerEvents.id));
    const events = rows.map(toEvent);
    const results = new Map(
      events.filter((e) => e.type === 'ORDER_RESULT').map((e) => [String(e.payload.clientOrderId), e]),
    );
    return events
      .filter((e) => e.type === 'ORDER_INTENT')
      .map((intent) => ({ intent, result: results.get(String(intent.payload.clientOrderId)) ?? null }));
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/ledger/ledger.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ledger/ledger.ts tests/ledger/ledger.test.ts
git commit -m "feat: add the ledger"
git push
```

---

## Task 11: Account state, runs, and the alert log

**Files:**
- Create: `src/state/accountState.ts`, `src/state/cycleRuns.ts`, `src/state/alertLog.ts`
- Test: `tests/state/accountState.test.ts`, `tests/state/cycleRuns.test.ts`, `tests/state/alertLog.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/state/accountState.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { accountState } from '../../src/db/schema.js';
import { Ledger } from '../../src/ledger/ledger.js';
import { AccountStates } from '../../src/state/accountState.js';
import { useTestDatabase } from '../helpers/database.js';

const database = useTestDatabase();
const AT = new Date('2026-09-22T00:02:00Z');

async function withAccount(): Promise<AccountStates> {
  await database().insert(accountState).values({ userId: 'founder', status: 'active', reason: null, updatedAt: AT });
  return new AccountStates(database());
}

const eventsOf = async (type: 'FROZEN' | 'UNFROZEN' | 'PAUSED' | 'RESUMED') =>
  new Ledger(database()).ofType(type, 'founder');

describe('AccountStates', () => {
  it('freezes an account and records why, under the day', async () => {
    const states = await withAccount();
    await states.freeze('founder', '2026-09-21', 'the spread was too wide', AT);
    expect(await states.get('founder')).toMatchObject({ status: 'frozen', reason: 'the spread was too wide' });
    const [frozen] = await eventsOf('FROZEN');
    expect(frozen).toMatchObject({ cycleDate: '2026-09-21', payload: { reason: 'the spread was too wide' } });
  });

  it('ignores a second freeze', async () => {
    const states = await withAccount();
    await states.freeze('founder', '2026-09-21', 'first', AT);
    await states.freeze('founder', '2026-09-21', 'second', AT);
    expect(await eventsOf('FROZEN')).toHaveLength(1);
    expect((await states.get('founder'))?.reason).toBe('first');
  });

  it('unfreezes only a frozen account, and only with a reason', async () => {
    const states = await withAccount();
    await expect(states.unfreeze('founder', 'checked', AT)).rejects.toThrow('not frozen');
    await states.freeze('founder', null, 'odd balances', AT);
    await expect(states.unfreeze('founder', '  ', AT)).rejects.toThrow('needs a reason');
    await states.unfreeze('founder', 'checked the account on Bybit', AT);
    expect((await states.get('founder'))?.status).toBe('active');
    expect(await eventsOf('UNFROZEN')).toHaveLength(1);
  });

  it('pauses only an active account and resumes only a paused one', async () => {
    const states = await withAccount();
    await expect(states.resume('founder', AT)).rejects.toThrow('not paused');
    await states.pause('founder', 'travelling', AT);
    expect((await states.get('founder'))?.status).toBe('paused');
    await expect(states.pause('founder', null, AT)).rejects.toThrow('only an active account');
    await states.resume('founder', AT);
    expect((await states.get('founder'))?.status).toBe('active');
    expect(await eventsOf('PAUSED')).toHaveLength(1);
    expect(await eventsOf('RESUMED')).toHaveLength(1);
  });

  it('names the fix when an account does not exist', async () => {
    await expect(new AccountStates(database()).freeze('nobody', null, 'x', AT)).rejects.toThrow('paper:init');
  });

  it('lists every account', async () => {
    const states = await withAccount();
    expect((await states.all()).map((a) => a.userId)).toEqual(['founder']);
  });
});
```

Create `tests/state/cycleRuns.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CycleRuns } from '../../src/state/cycleRuns.js';
import { useTestDatabase } from '../helpers/database.js';

const database = useTestDatabase();
const runs = () => new CycleRuns(database());
const AT = new Date('2026-09-22T00:02:00Z');
const LATER = new Date('2026-09-22T02:02:00Z');

describe('CycleRuns', () => {
  it('creates a pending run on the first attempt and counts the later ones', async () => {
    expect(await runs().startAttempt('2026-09-21', 'founder', AT)).toMatchObject({ status: 'pending', attempts: 1 });
    expect(await runs().startAttempt('2026-09-21', 'founder', LATER)).toMatchObject({ status: 'pending', attempts: 2 });
    expect((await runs().get('2026-09-21', 'founder'))?.firstAttemptAt).toEqual(AT);
  });

  it('puts a frozen run back to pending on the next attempt', async () => {
    await runs().startAttempt('2026-09-21', 'founder', AT);
    await runs().markFrozen('2026-09-21', 'founder', 'veto');
    expect(await runs().startAttempt('2026-09-21', 'founder', LATER)).toMatchObject({ status: 'pending', attempts: 2 });
  });

  it('refuses to restart a completed run', async () => {
    await runs().startAttempt('2026-09-21', 'founder', AT);
    await runs().complete('2026-09-21', 'founder', AT, false);
    await expect(runs().startAttempt('2026-09-21', 'founder', LATER)).rejects.toThrow('completed');
  });

  it('completes a run, recording whether it was late', async () => {
    await runs().startAttempt('2026-09-21', 'founder', AT);
    await runs().recordError('2026-09-21', 'founder', 'Bybit was down');
    await runs().complete('2026-09-21', 'founder', LATER, true);
    expect(await runs().get('2026-09-21', 'founder')).toMatchObject({
      status: 'completed',
      late: true,
      completedAt: LATER,
      lastError: null,
    });
  });

  it('abandons only pending runs from earlier days', async () => {
    await runs().startAttempt('2026-09-20', 'founder', AT);
    await runs().startAttempt('2026-09-20', 'other', AT);
    await runs().complete('2026-09-20', 'other', AT, false);
    await runs().startAttempt('2026-09-21', 'founder', AT);
    const abandoned = await runs().abandonBefore('2026-09-21');
    expect(abandoned.map((r) => [r.cycleDate, r.userId, r.status])).toEqual([['2026-09-20', 'founder', 'abandoned']]);
    expect((await runs().get('2026-09-20', 'other'))?.status).toBe('completed');
    expect((await runs().get('2026-09-21', 'founder'))?.status).toBe('pending');
  });

  it("lists the day's pending runs", async () => {
    await runs().startAttempt('2026-09-21', 'founder', AT);
    await runs().startAttempt('2026-09-21', 'other', AT);
    await runs().complete('2026-09-21', 'other', AT, false);
    expect((await runs().pendingFor('2026-09-21')).map((r) => r.userId)).toEqual(['founder']);
  });
});
```

Create `tests/state/alertLog.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AlertLog } from '../../src/state/alertLog.js';
import { useTestDatabase } from '../helpers/database.js';

const database = useTestDatabase();
const AT = new Date('2026-09-22T00:02:00Z');

describe('AlertLog', () => {
  it('lets each key be claimed once', async () => {
    const log = new AlertLog(database());
    expect(await log.has('2026-09-21:founder:failure')).toBe(false);
    expect(await log.claim('2026-09-21:founder:failure', AT)).toBe(true);
    expect(await log.claim('2026-09-21:founder:failure', AT)).toBe(false);
    expect(await log.has('2026-09-21:founder:failure')).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/state`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Create `src/state/accountState.ts`**

```ts
import { asc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { accountState, ledgerEvents } from '../db/schema.js';
import type { AccountStatus } from '../types.js';

export type AccountRecord = {
  userId: string;
  status: AccountStatus;
  reason: string | null;
  updatedAt: Date;
};

const STATUSES: readonly string[] = ['active', 'paused', 'frozen'];

function toRecord(row: typeof accountState.$inferSelect): AccountRecord {
  if (!STATUSES.includes(row.status)) {
    throw new Error(`unknown account status "${row.status}"`);
  }
  return { userId: row.userId, status: row.status as AccountStatus, reason: row.reason, updatedAt: row.updatedAt };
}

/**
 * Whether each account may trade. Accounts are created with the paper account
 * (PaperAccount.open). Every change is written to the ledger in the same
 * transaction, so the track record can always explain the current state.
 */
export class AccountStates {
  constructor(private readonly db: Database) {}

  async all(): Promise<AccountRecord[]> {
    const rows = await this.db.select().from(accountState).orderBy(asc(accountState.userId));
    return rows.map(toRecord);
  }

  async get(userId: string): Promise<AccountRecord | null> {
    const rows = await this.db.select().from(accountState).where(eq(accountState.userId, userId));
    return rows[0] === undefined ? null : toRecord(rows[0]);
  }

  /** Stops an account trading after something the engine did not understand. Already frozen: no change. */
  async freeze(userId: string, cycleDate: string | null, reason: string, at: Date): Promise<void> {
    const current = await this.#require(userId);
    if (current.status === 'frozen') {
      return;
    }
    await this.#change(userId, 'frozen', reason, 'FROZEN', cycleDate, at);
  }

  /** Lifting a freeze needs a person, and a reason that goes on the record. */
  async unfreeze(userId: string, reason: string, at: Date): Promise<void> {
    if (reason.trim() === '') {
      throw new Error('unfreezing needs a reason');
    }
    const current = await this.#require(userId);
    if (current.status !== 'frozen') {
      throw new Error(`"${userId}" is ${current.status}, not frozen`);
    }
    await this.#change(userId, 'active', reason.trim(), 'UNFROZEN', null, at);
  }

  async pause(userId: string, reason: string | null, at: Date): Promise<void> {
    const current = await this.#require(userId);
    if (current.status !== 'active') {
      throw new Error(`"${userId}" is ${current.status}; only an active account can be paused`);
    }
    await this.#change(userId, 'paused', reason, 'PAUSED', null, at);
  }

  async resume(userId: string, at: Date): Promise<void> {
    const current = await this.#require(userId);
    if (current.status !== 'paused') {
      throw new Error(`"${userId}" is ${current.status}, not paused`);
    }
    await this.#change(userId, 'active', null, 'RESUMED', null, at);
  }

  async #require(userId: string): Promise<AccountRecord> {
    const record = await this.get(userId);
    if (record === null) {
      throw new Error(`there is no account for "${userId}"; run npm run paper:init`);
    }
    return record;
  }

  async #change(
    userId: string,
    status: AccountStatus,
    reason: string | null,
    type: 'FROZEN' | 'UNFROZEN' | 'PAUSED' | 'RESUMED',
    cycleDate: string | null,
    at: Date,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.update(accountState).set({ status, reason, updatedAt: at }).where(eq(accountState.userId, userId));
      await tx.insert(ledgerEvents).values({ occurredAt: at, userId, cycleDate, type, payload: { reason } });
    });
  }
}
```

- [ ] **Step 4: Create `src/state/cycleRuns.ts`**

```ts
import { and, asc, eq, lt } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { cycleRuns } from '../db/schema.js';

export type RunStatus = 'pending' | 'completed' | 'frozen' | 'abandoned';

export type CycleRun = {
  cycleDate: string;
  userId: string;
  status: RunStatus;
  attempts: number;
  firstAttemptAt: Date;
  completedAt: Date | null;
  late: boolean;
  lastError: string | null;
};

const STATUSES: readonly string[] = ['pending', 'completed', 'frozen', 'abandoned'];

function toRun(row: typeof cycleRuns.$inferSelect): CycleRun {
  if (!STATUSES.includes(row.status)) {
    throw new Error(`unknown run status "${row.status}"`);
  }
  return { ...row, status: row.status as RunStatus };
}

/**
 * Where each day's run stands, per user: what the next tick needs to know. The
 * history of what happened lives in the ledger.
 */
export class CycleRuns {
  constructor(private readonly db: Database) {}

  async get(cycleDate: string, userId: string): Promise<CycleRun | null> {
    const rows = await this.db.select().from(cycleRuns).where(this.#key(cycleDate, userId));
    return rows[0] === undefined ? null : toRun(rows[0]);
  }

  /**
   * Counts an attempt at a day's run, creating it as pending on the first. A
   * frozen run goes back to pending: its account was unfrozen, so the day's run
   * resumes. Completed and abandoned runs never restart.
   */
  async startAttempt(cycleDate: string, userId: string, at: Date): Promise<CycleRun> {
    const existing = await this.get(cycleDate, userId);
    if (existing === null) {
      await this.db.insert(cycleRuns).values({ cycleDate, userId, status: 'pending', attempts: 1, firstAttemptAt: at });
    } else {
      if (existing.status === 'completed' || existing.status === 'abandoned') {
        throw new Error(`the ${cycleDate} run for "${userId}" is ${existing.status} and cannot restart`);
      }
      await this.db
        .update(cycleRuns)
        .set({ status: 'pending', attempts: existing.attempts + 1 })
        .where(this.#key(cycleDate, userId));
    }
    return (await this.get(cycleDate, userId))!;
  }

  async recordError(cycleDate: string, userId: string, error: string): Promise<void> {
    await this.db.update(cycleRuns).set({ lastError: error }).where(this.#key(cycleDate, userId));
  }

  async complete(cycleDate: string, userId: string, at: Date, late: boolean): Promise<void> {
    await this.db
      .update(cycleRuns)
      .set({ status: 'completed', completedAt: at, late, lastError: null })
      .where(this.#key(cycleDate, userId));
  }

  async markFrozen(cycleDate: string, userId: string, reason: string): Promise<void> {
    await this.db.update(cycleRuns).set({ status: 'frozen', lastError: reason }).where(this.#key(cycleDate, userId));
  }

  /** Marks every run still pending from before `cycleDate` as abandoned, and returns them. */
  async abandonBefore(cycleDate: string): Promise<CycleRun[]> {
    const stale = (
      await this.db
        .select()
        .from(cycleRuns)
        .where(and(eq(cycleRuns.status, 'pending'), lt(cycleRuns.cycleDate, cycleDate)))
        .orderBy(asc(cycleRuns.cycleDate), asc(cycleRuns.userId))
    ).map(toRun);
    for (const run of stale) {
      await this.db.update(cycleRuns).set({ status: 'abandoned' }).where(this.#key(run.cycleDate, run.userId));
    }
    return stale.map((run) => ({ ...run, status: 'abandoned' as const }));
  }

  async pendingFor(cycleDate: string): Promise<CycleRun[]> {
    const rows = await this.db
      .select()
      .from(cycleRuns)
      .where(and(eq(cycleRuns.cycleDate, cycleDate), eq(cycleRuns.status, 'pending')))
      .orderBy(asc(cycleRuns.userId));
    return rows.map(toRun);
  }

  #key(cycleDate: string, userId: string) {
    return and(eq(cycleRuns.cycleDate, cycleDate), eq(cycleRuns.userId, userId));
  }
}
```

- [ ] **Step 5: Create `src/state/alertLog.ts`**

```ts
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { alertLog } from '../db/schema.js';

/** Keys for things done once per day — alerts, reminders, the heartbeat — so ticks every 15 minutes do not repeat them. */
export class AlertLog {
  constructor(private readonly db: Database) {}

  /** Records `key`; true the first time, false once it is already recorded. */
  async claim(key: string, at: Date): Promise<boolean> {
    const inserted = await this.db
      .insert(alertLog)
      .values({ key, sentAt: at })
      .onConflictDoNothing()
      .returning({ key: alertLog.key });
    return inserted.length > 0;
  }

  async has(key: string): Promise<boolean> {
    const rows = await this.db.select().from(alertLog).where(eq(alertLog.key, key));
    return rows.length > 0;
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/state`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/state tests/state
git commit -m "feat: add account state, per-day runs, and the alert log"
git push
```

---

## Task 12: The paper account

**Files:**
- Create: `src/paper/paperAccount.ts`, `tests/helpers/fakeMarket.ts`
- Test: `tests/paper/paperAccount.test.ts`

- [ ] **Step 1: Create the fake market `tests/helpers/fakeMarket.ts`**

```ts
import type Decimal from 'decimal.js';
import type { OrderBook } from '../../src/market/orderBook.js';
import type { InstrumentRules, MarketData, Ticker } from '../../src/market/types.js';
import type { Candle } from '../../src/types.js';
import { DAY } from './candles.js';
import { bookAround, RULES, tickerAt } from './market.js';

type Method = 'candles' | 'book' | 'ticker' | 'rules';

/**
 * Market data the test controls. `fail` makes a method throw, as a network
 * failure would. `books` queues order books to serve, one per call, before
 * falling back to the standing `book`.
 */
export class FakeMarket implements MarketData {
  candles: Candle[] = [];
  book: OrderBook;
  ticker: Ticker;
  rules: InstrumentRules = RULES;
  books: OrderBook[] = [];
  fail: Partial<Record<Method, Error>> = {};
  calls: Record<Method, number> = { candles: 0, book: 0, ticker: 0, rules: 0 };

  constructor(price: Decimal.Value = '85000') {
    this.book = bookAround(price);
    this.ticker = tickerAt(price);
  }

  setPrice(price: Decimal.Value): void {
    this.book = bookAround(price);
    this.ticker = tickerAt(price);
  }

  async getClosedDailyCandles(_symbol: string, count: number, now: number): Promise<Candle[]> {
    this.#enter('candles');
    return this.candles.filter((c) => c.time + DAY <= now).slice(-count);
  }

  async getOrderBook(): Promise<OrderBook> {
    this.#enter('book');
    return this.books.shift() ?? this.book;
  }

  async getTicker(): Promise<Ticker> {
    this.#enter('ticker');
    return this.ticker;
  }

  async getInstrumentRules(): Promise<InstrumentRules> {
    this.#enter('rules');
    return this.rules;
  }

  #enter(method: Method): void {
    this.calls[method] += 1;
    const error = this.fail[method];
    if (error !== undefined) {
      throw error;
    }
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/paper/paperAccount.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { MarketOrderRequest, OrderState } from '../../src/exchange/trading.js';
import { Ledger } from '../../src/ledger/ledger.js';
import { PaperAccount } from '../../src/paper/paperAccount.js';
import { AccountStates } from '../../src/state/accountState.js';
import { useTestDatabase } from '../helpers/database.js';
import { FakeMarket } from '../helpers/fakeMarket.js';
import { bookAround } from '../helpers/market.js';

const database = useTestDatabase();
const AT = new Date('2026-09-22T00:02:00Z');
const FEE = new Decimal('0.001');

async function open(userId = 'founder', usdt = '1000') {
  // bookAround('85000'): asks at 85,008.5 and bids at 84,991.5, five BTC deep.
  const market = new FakeMarket('85000');
  await PaperAccount.open(database(), {
    userId,
    baseCoin: 'BTC',
    quoteCoin: 'USDT',
    startingQuote: new Decimal(usdt),
    at: AT,
  });
  return { account: new PaperAccount({ db: database(), userId, market, feeRate: FEE }), market };
}

const buy = (id: string, usdt: string): MarketOrderRequest => ({
  clientOrderId: id,
  symbol: 'BTCUSDT',
  side: 'BUY',
  quoteAmount: new Decimal(usdt),
});
const sell = (id: string, btc: string): MarketOrderRequest => ({
  clientOrderId: id,
  symbol: 'BTCUSDT',
  side: 'SELL',
  baseQty: new Decimal(btc),
});

async function holding(account: PaperAccount, coin: string): Promise<string> {
  return (await account.getBalances()).find((b) => b.coin === coin)!.walletBalance.toFixed();
}

/** An order state as plain text, so comparisons never depend on Decimal internals. */
const plain = (state: OrderState) => ({
  ...state,
  filledBaseQty: state.filledBaseQty.toFixed(),
  filledQuoteAmount: state.filledQuoteAmount.toFixed(),
  avgPrice: state.avgPrice?.toFixed() ?? null,
  fee: state.fee.toFixed(),
});

describe('PaperAccount.open', () => {
  it('creates the balances, an active account, and an ACCOUNT_OPENED event', async () => {
    const { account } = await open();
    expect(await holding(account, 'USDT')).toBe('1000');
    expect(await holding(account, 'BTC')).toBe('0');
    expect((await new AccountStates(database()).get('founder'))?.status).toBe('active');
    const [opened] = await new Ledger(database()).ofType('ACCOUNT_OPENED', 'founder');
    expect(opened?.payload).toEqual({ mode: 'paper', balances: { USDT: '1000', BTC: '0' } });
  });

  it('refuses to open a second account for the same user', async () => {
    await open();
    await expect(open()).rejects.toThrow('already has an account');
  });
});

describe('placing orders', () => {
  it('fills a buy at the ask and charges the fee in BTC', async () => {
    const { account } = await open();
    // 850.085 / 85,008.5 is exactly 0.01 BTC.
    const state = await account.placeMarketOrder(buy('o1', '850.085'));
    expect(plain(state)).toMatchObject({
      status: 'FILLED',
      filledBaseQty: '0.01',
      filledQuoteAmount: '850.085',
      avgPrice: '85008.5',
      fee: '0.00001',
      feeCoin: 'BTC',
    });
    expect(await holding(account, 'BTC')).toBe('0.00999');
    expect(await holding(account, 'USDT')).toBe('149.915');
  });

  it('fills a sell at the bid and charges the fee in USDT', async () => {
    const { account } = await open();
    await account.placeMarketOrder(buy('o1', '850.085'));
    const state = await account.placeMarketOrder(sell('o2', '0.009'));
    // 0.009 × 84,991.5 = 764.9235, less a 0.1% fee of 0.7649235.
    expect(plain(state)).toMatchObject({ status: 'FILLED', filledQuoteAmount: '764.9235', fee: '0.7649235', feeCoin: 'USDT' });
    expect(await holding(account, 'BTC')).toBe('0.00099');
    expect(await holding(account, 'USDT')).toBe('914.0735765');
  });

  it('refuses a repeated client order ID and leaves the original untouched', async () => {
    const { account } = await open();
    const first = await account.placeMarketOrder(buy('o1', '100'));
    const usdtAfterFirst = await holding(account, 'USDT');
    const repeat = await account.placeMarketOrder(buy('o1', '100'));
    expect(repeat).toMatchObject({ status: 'REJECTED', rejectReason: 'duplicate client order ID' });
    const lookup = await account.getOrder('o1');
    expect(lookup.kind === 'FOUND' && plain(lookup.state)).toEqual(plain(first));
    expect(await holding(account, 'USDT')).toBe(usdtAfterFirst);
  });

  it('rejects, and records, an order below the minimum', async () => {
    const { account } = await open();
    expect((await account.placeMarketOrder(buy('o1', '4'))).rejectReason).toContain('minimum');
    const lookup = await account.getOrder('o1');
    expect(lookup.kind === 'FOUND' && lookup.state.status).toBe('REJECTED');
    expect(await holding(account, 'USDT')).toBe('1000');
  });

  it('rejects an order larger than the balance', async () => {
    const { account } = await open();
    expect((await account.placeMarketOrder(buy('o1', '2000'))).rejectReason).toBe('insufficient USDT');
  });

  it('rejects an amount with more decimal places than the exchange allows', async () => {
    const { account } = await open();
    expect((await account.placeMarketOrder(buy('o1', '10.00000001'))).rejectReason).toContain('decimal places');
  });

  it('fills what the book can take and cancels the rest', async () => {
    const { account, market } = await open();
    market.book = bookAround('85000', '0.001');
    const state = await account.placeMarketOrder(buy('o1', '850'));
    expect(plain(state)).toMatchObject({ status: 'PARTIALLY_FILLED_CANCELLED', filledBaseQty: '0.001' });
    expect(await holding(account, 'BTC')).toBe('0.000999');
  });

  it('writes nothing when the market cannot be reached', async () => {
    const { account, market } = await open();
    market.fail.book = new Error('the request timed out');
    await expect(account.placeMarketOrder(buy('o1', '100'))).rejects.toThrow('timed out');
    expect(await account.getOrder('o1')).toEqual({ kind: 'ABSENT' });
    expect(await holding(account, 'USDT')).toBe('1000');
  });
});

describe('looking up orders', () => {
  it('is certain an unknown ID was never placed', async () => {
    const { account } = await open();
    expect(await account.getOrder('never-sent')).toEqual({ kind: 'ABSENT' });
  });

  it("does not show another account's orders", async () => {
    const { account: founder } = await open('founder');
    const { account: other } = await open('other');
    await other.placeMarketOrder(buy('theirs', '100'));
    expect(await founder.getOrder('theirs')).toEqual({ kind: 'ABSENT' });
  });

  it('reports no locks and no borrowing', async () => {
    const { account } = await open();
    for (const balance of await account.getBalances()) {
      expect(balance.locked.isZero() && balance.borrowAmount.isZero()).toBe(true);
    }
  });

  it('names the fix when the account does not exist', async () => {
    const market = new FakeMarket();
    const account = new PaperAccount({ db: database(), userId: 'nobody', market, feeRate: FEE });
    await expect(account.getBalances()).rejects.toThrow('paper:init');
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/paper/paperAccount.test.ts`
Expected: FAIL — `src/paper/paperAccount.ts` does not exist.

- [ ] **Step 4: Create `src/paper/paperAccount.ts`**

```ts
import Decimal from 'decimal.js';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { accountState, ledgerEvents, paperBalances, paperOrders } from '../db/schema.js';
import type { CoinBalance } from '../exchange/account.js';
import type {
  MarketOrderRequest,
  OrderLookup,
  OrderSide,
  OrderState,
  OrderStatus,
  TradingAccount,
} from '../exchange/trading.js';
import type { InstrumentRules, MarketData } from '../market/types.js';
import { fillBuy, fillSell } from './fill.js';

const ZERO = new Decimal(0);
const SIDES: readonly string[] = ['BUY', 'SELL'];
const STATUSES: readonly string[] = ['FILLED', 'PARTIALLY_FILLED_CANCELLED', 'REJECTED', 'PENDING'];

export type PaperAccountOptions = { db: Database; userId: string; market: MarketData; feeRate: Decimal };

export type OpenPaperAccount = {
  userId: string;
  baseCoin: string;
  quoteCoin: string;
  startingQuote: Decimal;
  at: Date;
};

type OrderRow = typeof paperOrders.$inferSelect;

function toState(row: OrderRow): OrderState {
  if (!SIDES.includes(row.side) || !STATUSES.includes(row.status)) {
    throw new Error(`paper order ${row.clientOrderId} has an unknown side or status`);
  }
  return {
    clientOrderId: row.clientOrderId,
    side: row.side as OrderSide,
    status: row.status as OrderStatus,
    filledBaseQty: new Decimal(row.filledBaseQty),
    filledQuoteAmount: new Decimal(row.filledQuoteAmount),
    avgPrice: row.avgPrice === null ? null : new Decimal(row.avgPrice),
    fee: new Decimal(row.fee),
    feeCoin: row.feeCoin,
    rejectReason: row.rejectReason,
  };
}

function rejected(order: MarketOrderRequest, feeCoin: string, reason: string): OrderState {
  return {
    clientOrderId: order.clientOrderId,
    side: order.side,
    status: 'REJECTED',
    filledBaseQty: ZERO,
    filledQuoteAmount: ZERO,
    avgPrice: null,
    fee: ZERO,
    feeCoin,
    rejectReason: reason,
  };
}

/** The first of the instrument's rules the order breaks, as Bybit would refuse it. */
function ruleProblem(order: MarketOrderRequest, rules: InstrumentRules): string | null {
  if (order.symbol !== rules.symbol) {
    return `unknown symbol ${order.symbol}`;
  }
  if (order.side === 'BUY') {
    if (!order.quoteAmount.mod(rules.quotePrecision).isZero()) {
      return `the amount has more decimal places than ${rules.quotePrecision.toFixed()} allows`;
    }
    if (order.quoteAmount.lt(rules.minOrderAmt)) {
      return `below the minimum order value of ${rules.minOrderAmt.toFixed()} ${rules.quoteCoin}`;
    }
    return null;
  }
  if (!order.baseQty.mod(rules.basePrecision).isZero()) {
    return `the quantity has more decimal places than ${rules.basePrecision.toFixed()} allows`;
  }
  if (order.baseQty.lt(rules.minOrderQty)) {
    return `below the minimum quantity of ${rules.minOrderQty.toFixed()} ${rules.baseCoin}`;
  }
  if (order.baseQty.gt(rules.maxMarketOrderQty)) {
    return `above the maximum market order of ${rules.maxMarketOrderQty.toFixed()} ${rules.baseCoin}`;
  }
  return null;
}

/**
 * A simulated exchange account that fills orders against Bybit's live order
 * book. It behaves like Bybit spot wherever the engine could notice: it
 * enforces the instrument's rules and the balance, refuses a repeated client
 * order ID, charges the taker fee in the coin received, and cancels whatever
 * the book cannot fill. Its database is the whole truth, and each order is
 * written in the same transaction as its balances, so a missing order is
 * proven absent: getOrder answers FOUND or ABSENT, never NOT_VISIBLE. A
 * database error throws, which the engine treats as inconclusive.
 */
export class PaperAccount implements TradingAccount {
  /**
   * Opens a paper account: its starting balances, its account state, and an
   * ACCOUNT_OPENED ledger event, in one transaction. In this phase, having an
   * account_state row is what makes someone a user.
   */
  static async open(db: Database, options: OpenPaperAccount): Promise<void> {
    if (!options.startingQuote.isFinite() || options.startingQuote.lte(0)) {
      throw new Error('the starting balance must be above zero');
    }
    await db.transaction(async (tx) => {
      const existing = await tx.select().from(accountState).where(eq(accountState.userId, options.userId));
      if (existing.length > 0) {
        throw new Error(`"${options.userId}" already has an account, so nothing was changed`);
      }
      await tx.insert(accountState).values({ userId: options.userId, status: 'active', reason: null, updatedAt: options.at });
      await tx.insert(paperBalances).values([
        { userId: options.userId, coin: options.quoteCoin, free: options.startingQuote.toFixed() },
        { userId: options.userId, coin: options.baseCoin, free: '0' },
      ]);
      await tx.insert(ledgerEvents).values({
        occurredAt: options.at,
        userId: options.userId,
        cycleDate: null,
        type: 'ACCOUNT_OPENED',
        payload: {
          mode: 'paper',
          balances: { [options.quoteCoin]: options.startingQuote.toFixed(), [options.baseCoin]: '0' },
        },
      });
    });
  }

  readonly #db: Database;
  readonly #userId: string;
  readonly #market: MarketData;
  readonly #feeRate: Decimal;

  constructor(options: PaperAccountOptions) {
    this.#db = options.db;
    this.#userId = options.userId;
    this.#market = options.market;
    this.#feeRate = options.feeRate;
  }

  async getBalances(): Promise<CoinBalance[]> {
    const rows = await this.#db.select().from(paperBalances).where(eq(paperBalances.userId, this.#userId));
    if (rows.length === 0) {
      throw new Error(`there is no paper account for "${this.#userId}"; run npm run paper:init`);
    }
    return rows.map((row) => ({ coin: row.coin, walletBalance: new Decimal(row.free), locked: ZERO, borrowAmount: ZERO }));
  }

  async getOrder(clientOrderId: string): Promise<OrderLookup> {
    const rows = await this.#db
      .select()
      .from(paperOrders)
      .where(and(eq(paperOrders.clientOrderId, clientOrderId), eq(paperOrders.userId, this.#userId)));
    return rows[0] === undefined ? { kind: 'ABSENT' } : { kind: 'FOUND', state: toState(rows[0]) };
  }

  async placeMarketOrder(order: MarketOrderRequest): Promise<OrderState> {
    const rules = await this.#market.getInstrumentRules(order.symbol);
    const feeCoin = order.side === 'BUY' ? rules.baseCoin : rules.quoteCoin;
    const existing = await this.#db.select().from(paperOrders).where(eq(paperOrders.clientOrderId, order.clientOrderId));
    if (existing.length > 0) {
      // As on Bybit: a repeated client order ID is refused, and the original order is untouched.
      return rejected(order, feeCoin, 'duplicate client order ID');
    }
    const problem = ruleProblem(order, rules) ?? (await this.#balanceProblem(order, rules));
    if (problem !== null) {
      return this.#store(order, rejected(order, feeCoin, problem), []);
    }
    const book = await this.#market.getOrderBook(order.symbol);
    const fill =
      order.side === 'BUY'
        ? fillBuy(book.asks, order.quoteAmount, rules.basePrecision)
        : fillSell(book.bids, order.baseQty);
    if (fill.filledBaseQty.isZero()) {
      return this.#store(order, rejected(order, feeCoin, 'the order book had nothing to fill it with'), []);
    }
    const fee =
      order.side === 'BUY' ? fill.filledBaseQty.times(this.#feeRate) : fill.filledQuoteAmount.times(this.#feeRate);
    const state: OrderState = {
      clientOrderId: order.clientOrderId,
      side: order.side,
      status: fill.complete ? 'FILLED' : 'PARTIALLY_FILLED_CANCELLED',
      filledBaseQty: fill.filledBaseQty,
      filledQuoteAmount: fill.filledQuoteAmount,
      avgPrice: fill.avgPrice,
      fee,
      feeCoin,
      rejectReason: null,
    };
    const changes: Array<[string, Decimal]> =
      order.side === 'BUY'
        ? [
            [rules.baseCoin, fill.filledBaseQty.minus(fee)],
            [rules.quoteCoin, fill.filledQuoteAmount.neg()],
          ]
        : [
            [rules.baseCoin, fill.filledBaseQty.neg()],
            [rules.quoteCoin, fill.filledQuoteAmount.minus(fee)],
          ];
    return this.#store(order, state, changes);
  }

  async #balanceProblem(order: MarketOrderRequest, rules: InstrumentRules): Promise<string | null> {
    const balances = await this.getBalances();
    const free = (coin: string) => balances.find((b) => b.coin === coin)?.walletBalance ?? ZERO;
    if (order.side === 'BUY' && order.quoteAmount.gt(free(rules.quoteCoin))) {
      return `insufficient ${rules.quoteCoin}`;
    }
    if (order.side === 'SELL' && order.baseQty.gt(free(rules.baseCoin))) {
      return `insufficient ${rules.baseCoin}`;
    }
    return null;
  }

  /** Writes the order and its balance changes in one transaction. */
  async #store(order: MarketOrderRequest, state: OrderState, changes: Array<[string, Decimal]>): Promise<OrderState> {
    await this.#db.transaction(async (tx) => {
      for (const [coin, delta] of changes) {
        const rows = await tx
          .select()
          .from(paperBalances)
          .where(and(eq(paperBalances.userId, this.#userId), eq(paperBalances.coin, coin)));
        const next = (rows[0] === undefined ? ZERO : new Decimal(rows[0].free)).plus(delta);
        if (next.isNeg()) {
          throw new Error(`the paper ${coin} balance would go below zero`);
        }
        await tx
          .insert(paperBalances)
          .values({ userId: this.#userId, coin, free: next.toFixed() })
          .onConflictDoUpdate({ target: [paperBalances.userId, paperBalances.coin], set: { free: next.toFixed() } });
      }
      await tx.insert(paperOrders).values({
        clientOrderId: state.clientOrderId,
        userId: this.#userId,
        symbol: order.symbol,
        side: order.side,
        requested: (order.side === 'BUY' ? order.quoteAmount : order.baseQty).toFixed(),
        status: state.status,
        filledBaseQty: state.filledBaseQty.toFixed(),
        filledQuoteAmount: state.filledQuoteAmount.toFixed(),
        avgPrice: state.avgPrice === null ? null : state.avgPrice.toFixed(),
        fee: state.fee.toFixed(),
        feeCoin: state.feeCoin,
        rejectReason: state.rejectReason,
        createdAt: new Date(),
      });
    });
    return state;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/paper`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/paper/paperAccount.ts tests/paper/paperAccount.test.ts tests/helpers/fakeMarket.ts
git commit -m "feat: add the paper account"
git push
```

---

## Task 13: The kill switch and the lock

**Files:**
- Create: `src/ops/killSwitch.ts`, `src/ops/lock.ts`
- Modify: `.gitignore`
- Test: `tests/ops/killSwitch.test.ts`, `tests/ops/lock.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/ops/killSwitch.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KillSwitch } from '../../src/ops/killSwitch.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kill-switch-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('KillSwitch', () => {
  it('is off until turned on, and off again once turned off', () => {
    const kill = new KillSwitch(join(dir, 'nested', 'KILL_SWITCH'));
    expect(kill.isOn()).toBe(false);
    kill.turnOn('checking a bug', new Date('2026-09-22T09:00:00Z'));
    expect(kill.isOn()).toBe(true);
    expect(readFileSync(kill.file, 'utf8')).toContain('checking a bug');
    kill.turnOff();
    expect(kill.isOn()).toBe(false);
  });

  it('can be switched on by hand with nothing but an empty file', () => {
    const file = join(dir, 'KILL_SWITCH');
    writeFileSync(file, '');
    expect(new KillSwitch(file).isOn()).toBe(true);
  });

  it('can be turned off when already off', () => {
    expect(() => new KillSwitch(join(dir, 'KILL_SWITCH')).turnOff()).not.toThrow();
  });
});
```

Create `tests/ops/lock.test.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireLock, LockBusyError, processIsAlive } from '../../src/ops/lock.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lock-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('acquireLock', () => {
  it('takes a free lock, holding its PID, and releases it', async () => {
    const file = join(dir, 'db.lock');
    const release = await acquireLock(file, { pid: 111 });
    expect(readFileSync(file, 'utf8')).toBe('111');
    release();
    expect(existsSync(file)).toBe(false);
  });

  it('waits for a live holder, then gives up', async () => {
    const file = join(dir, 'db.lock');
    await acquireLock(file, { pid: 111 });
    await expect(
      acquireLock(file, { pid: 222, waitMs: 30, pollMs: 5, isAlive: () => true }),
    ).rejects.toThrow(LockBusyError);
  });

  it('takes over a lock whose holder has died', async () => {
    const file = join(dir, 'db.lock');
    await acquireLock(file, { pid: 111 });
    const release = await acquireLock(file, { pid: 222, isAlive: (pid) => pid !== 111 });
    expect(readFileSync(file, 'utf8')).toBe('222');
    release();
  });

  it('never removes a lock that someone else now holds', async () => {
    const file = join(dir, 'db.lock');
    const release = await acquireLock(file, { pid: 111 });
    writeFileSync(file, '222');
    release();
    expect(readFileSync(file, 'utf8')).toBe('222');
  });

  it('creates the directory it needs', async () => {
    const release = await acquireLock(join(dir, 'a', 'b', 'db.lock'), { pid: 111 });
    release();
  });
});

describe('processIsAlive', () => {
  it('reports this process as alive', () => {
    expect(processIsAlive(process.pid)).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/ops`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Create `src/ops/killSwitch.ts`**

```ts
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * One file that halts all trading. It is a file rather than a database row so
 * it works even when the database, or the rest of the application, does not:
 * `touch data/KILL_SWITCH` is enough. The engine checks it at the start of
 * every tick and again immediately before placing an order.
 */
export class KillSwitch {
  constructor(readonly file: string) {}

  isOn(): boolean {
    return existsSync(this.file);
  }

  turnOn(reason: string, at: Date): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, `${at.toISOString()} ${reason}\n`, 'utf8');
  }

  turnOff(): void {
    rmSync(this.file, { force: true });
  }
}
```

- [ ] **Step 4: Create `src/ops/lock.ts`**

```ts
import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class LockBusyError extends Error {
  override name = 'LockBusyError';
}

export type LockOptions = {
  /** How long to wait for a live holder before giving up. */
  waitMs?: number;
  pollMs?: number;
  pid?: number;
  isAlive?: (pid: number) => boolean;
  sleep?: (ms: number) => Promise<void>;
};

/** True if a process with this PID exists. EPERM means it exists but belongs to someone else. */
export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readHolder(file: string): number | null {
  try {
    const pid = Number(readFileSync(file, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Creates the lock file with our PID already inside it: written to a temporary
 * file first, then hard-linked into place, which fails if the lock exists. So
 * the lock file is never seen empty.
 */
function tryCreate(file: string, pid: number): boolean {
  const temp = `${file}.${pid}.tmp`;
  writeFileSync(temp, String(pid), 'utf8');
  try {
    linkSync(temp, file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw error;
  } finally {
    rmSync(temp, { force: true });
  }
}

/**
 * Takes an exclusive lock. PGlite must never be opened by two processes at once,
 * so every command that opens the database holds this lock. A lock whose
 * process has died — for example one stopped by systemd's timeout — is removed.
 * Returns a function that releases the lock.
 */
export async function acquireLock(file: string, options: LockOptions = {}): Promise<() => void> {
  const pid = options.pid ?? process.pid;
  const waitMs = options.waitMs ?? 60_000;
  const pollMs = options.pollMs ?? 500;
  const isAlive = options.isAlive ?? processIsAlive;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  mkdirSync(dirname(file), { recursive: true });
  const giveUpAt = Date.now() + waitMs;
  for (;;) {
    if (tryCreate(file, pid)) {
      return () => {
        if (readHolder(file) === pid) {
          rmSync(file, { force: true });
        }
      };
    }
    const holder = readHolder(file);
    if (holder === null || !isAlive(holder)) {
      rmSync(file, { force: true });
      continue;
    }
    if (Date.now() >= giveUpAt) {
      throw new LockBusyError(
        `another command (process ${holder}) is using the database; try again when it has finished`,
      );
    }
    await sleep(pollMs);
  }
}
```

- [ ] **Step 5: Ignore the runtime files**

Append to `.gitignore`:

```
data/db.lock
data/*.tmp
data/KILL_SWITCH
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/ops`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ops tests/ops .gitignore
git commit -m "feat: add the file-based kill switch and the database lock"
git push
```

---

## Task 14: Alerts and the heartbeat

Alerts never fail a run: an alert that cannot be delivered goes to the log. The bot token is part of Telegram's request URL, so request errors are never printed.

**Files:**
- Create: `src/alerts/telegram.ts`, `src/alerts/heartbeat.ts`
- Test: `tests/alerts/telegram.test.ts`, `tests/alerts/heartbeat.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/alerts/telegram.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LogAlerter, TelegramAlerter, type PostFetch } from '../../src/alerts/telegram.js';
import { Secret } from '../../src/secrets/secret.js';

const TOKEN_TEXT = '123456:SECRET-TOKEN';
const TOKEN = new Secret(TOKEN_TEXT);

function alerter(fetchImpl: PostFetch, lines: string[] = [], timeoutMs?: number) {
  return new TelegramAlerter({ token: TOKEN, chatId: '42', prefix: '[paper] ', fetchImpl, log: (l) => lines.push(l), timeoutMs });
}

describe('TelegramAlerter', () => {
  it("posts the message to the bot's chat", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl: PostFetch = async (url, init) => {
      calls.push({ url, body: init.body ?? '' });
      return { ok: true, status: 200 };
    };
    await alerter(fetchImpl).send('hello');
    expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${TOKEN_TEXT}/sendMessage`);
    expect(JSON.parse(calls[0]!.body)).toEqual({ chat_id: '42', text: '[paper] hello', disable_web_page_preview: true });
  });

  it('logs the message, without the token, when Telegram refuses it', async () => {
    const lines: string[] = [];
    await alerter(async () => ({ ok: false, status: 401 }), lines).send('hello');
    expect(lines.join('\n')).toContain('401');
    expect(lines.join('\n')).toContain('hello');
    expect(lines.join('\n')).not.toContain('SECRET-TOKEN');
  });

  it('logs the message, without the token, when Telegram cannot be reached', async () => {
    const lines: string[] = [];
    const fetchImpl: PostFetch = async (url) => {
      throw new TypeError(`fetch failed: ${url}`);
    };
    await alerter(fetchImpl, lines).send('hello');
    expect(lines.join('\n')).toContain('could not be reached');
    expect(lines.join('\n')).not.toContain('SECRET-TOKEN');
  });

  it('gives up on a stalled request within its deadline, and never throws', async () => {
    const lines: string[] = [];
    const started = Date.now();
    await alerter(() => new Promise(() => {}), lines, 30).send('hello');
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(lines.join('\n')).toContain('could not be reached');
  });
});

describe('LogAlerter', () => {
  it('writes the alert to the log', async () => {
    const lines: string[] = [];
    await new LogAlerter((l) => lines.push(l), '[paper] ').send('hello');
    expect(lines).toEqual(['[alert] [paper] hello']);
  });
});
```

Create `tests/alerts/heartbeat.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { HealthcheckHeartbeat, NoHeartbeat } from '../../src/alerts/heartbeat.js';
import type { PostFetch } from '../../src/alerts/telegram.js';
import { Secret } from '../../src/secrets/secret.js';

const URL_TEXT = 'https://hc-ping.com/private-uuid';

function heartbeat(fetchImpl: PostFetch, lines: string[] = [], timeoutMs?: number) {
  return new HealthcheckHeartbeat({ url: new Secret(URL_TEXT), fetchImpl, log: (l) => lines.push(l), timeoutMs });
}

describe('HealthcheckHeartbeat', () => {
  it('pings the URL and reports success', async () => {
    const urls: string[] = [];
    expect(await heartbeat(async (url) => (urls.push(url), { ok: true, status: 200 })).ping()).toBe(true);
    expect(urls).toEqual([URL_TEXT]);
  });

  it('reports failure, without the URL, when the ping is refused', async () => {
    const lines: string[] = [];
    expect(await heartbeat(async () => ({ ok: false, status: 500 }), lines).ping()).toBe(false);
    expect(lines.join('\n')).toContain('500');
    expect(lines.join('\n')).not.toContain('private-uuid');
  });

  it('reports failure within its deadline when the request stalls', async () => {
    const lines: string[] = [];
    expect(await heartbeat(() => new Promise(() => {}), lines, 30).ping()).toBe(false);
    expect(lines.join('\n')).not.toContain('private-uuid');
  });
});

describe('NoHeartbeat', () => {
  it('does nothing and reports success', async () => {
    expect(await new NoHeartbeat().ping()).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/alerts`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Create `src/alerts/telegram.ts`**

```ts
import { raceSignal } from '../net/http.js';
import type { Secret } from '../secrets/secret.js';

export interface Alerter {
  send(message: string): Promise<void>;
}

export type Log = (line: string) => void;

export type PostFetch = (
  url: string,
  init: { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number }>;

/** Alerts must never hold up a trading run; each request gives up after this long. */
export const ALERT_TIMEOUT_MS = 5_000;

/** Telegram's limit is 4,096 characters. */
const TELEGRAM_LIMIT = 4_000;

/** Writes alerts to the log: used when Telegram is not configured. */
export class LogAlerter implements Alerter {
  constructor(
    private readonly log: Log = console.log,
    private readonly prefix = '',
  ) {}

  async send(message: string): Promise<void> {
    this.log(`[alert] ${this.prefix}${message}`);
  }
}

export type TelegramOptions = {
  token: Secret;
  chatId: string;
  prefix?: string;
  fetchImpl?: PostFetch;
  log?: Log;
  timeoutMs?: number;
};

/**
 * Sends alerts through a Telegram bot. Never throws: an alert that cannot be
 * delivered goes to the log instead. The bot token is part of the request URL,
 * so request errors are never printed.
 */
export class TelegramAlerter implements Alerter {
  readonly #token: Secret;
  readonly #chatId: string;
  readonly #prefix: string;
  readonly #fetch: PostFetch;
  readonly #log: Log;
  readonly #timeoutMs: number;

  constructor(options: TelegramOptions) {
    this.#token = options.token;
    this.#chatId = options.chatId;
    this.#prefix = options.prefix ?? '';
    this.#fetch = options.fetchImpl ?? fetch;
    this.#log = options.log ?? console.log;
    this.#timeoutMs = options.timeoutMs ?? ALERT_TIMEOUT_MS;
  }

  async send(message: string): Promise<void> {
    const text = `${this.#prefix}${message}`.slice(0, TELEGRAM_LIMIT);
    const signal = AbortSignal.timeout(this.#timeoutMs);
    try {
      const response = await raceSignal(
        this.#fetch(`https://api.telegram.org/bot${this.#token.reveal()}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: this.#chatId, text, disable_web_page_preview: true }),
          signal,
        }),
        signal,
        'Telegram',
      );
      if (!response.ok) {
        this.#log(`[alert not delivered: Telegram answered HTTP ${response.status}] ${text}`);
      }
    } catch {
      this.#log(`[alert not delivered: Telegram could not be reached] ${text}`);
    }
  }
}
```

- [ ] **Step 4: Create `src/alerts/heartbeat.ts`**

```ts
import { raceSignal } from '../net/http.js';
import type { Secret } from '../secrets/secret.js';
import { ALERT_TIMEOUT_MS, type Log, type PostFetch } from './telegram.js';

/**
 * Tells an outside monitor the engine is alive. It catches the one failure the
 * engine cannot report itself: not running at all.
 */
export interface Heartbeat {
  /** True if the ping was recorded. */
  ping(): Promise<boolean>;
}

/** Used when no Healthchecks.io URL is configured. */
export class NoHeartbeat implements Heartbeat {
  async ping(): Promise<boolean> {
    return true;
  }
}

export type HealthcheckOptions = { url: Secret; fetchImpl?: PostFetch; log?: Log; timeoutMs?: number };

/** Pings a Healthchecks.io check. Anyone holding the URL can fake a ping, so it is a Secret and never printed. */
export class HealthcheckHeartbeat implements Heartbeat {
  readonly #url: Secret;
  readonly #fetch: PostFetch;
  readonly #log: Log;
  readonly #timeoutMs: number;

  constructor(options: HealthcheckOptions) {
    this.#url = options.url;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#log = options.log ?? console.log;
    this.#timeoutMs = options.timeoutMs ?? ALERT_TIMEOUT_MS;
  }

  async ping(): Promise<boolean> {
    const signal = AbortSignal.timeout(this.#timeoutMs);
    try {
      const response = await raceSignal(this.#fetch(this.#url.reveal(), { method: 'GET', signal }), signal, 'Healthchecks.io');
      if (response.ok) {
        return true;
      }
      this.#log(`heartbeat not recorded: Healthchecks.io answered HTTP ${response.status}`);
    } catch {
      this.#log('heartbeat not recorded: Healthchecks.io could not be reached');
    }
    return false;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/alerts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/alerts tests/alerts
git commit -m "feat: add Telegram alerts and the Healthchecks.io heartbeat"
git push
```

---

## Task 15: The daily tick

This is spec sections 4, 4.2, and 9 in code. Read them first. The tests come in two files: normal days, and everything that goes wrong — including both design reviews' scenarios.

**Files:**
- Create: `src/engine/cycle.ts`, `tests/helpers/engine.ts`
- Test: `tests/engine/cycle.test.ts`, `tests/engine/cycleFailures.test.ts`

- [ ] **Step 1: Create the engine helper `tests/helpers/engine.ts`**

```ts
import Decimal from 'decimal.js';
import type { Heartbeat } from '../../src/alerts/heartbeat.js';
import type { Alerter } from '../../src/alerts/telegram.js';
import type { Database } from '../../src/db/client.js';
import type { CycleDeps, TickOutcome, UserOutcome } from '../../src/engine/cycle.js';
import type { CoinBalance } from '../../src/exchange/account.js';
import type { MarketOrderRequest, OrderLookup, OrderState, TradingAccount } from '../../src/exchange/trading.js';
import { Ledger } from '../../src/ledger/ledger.js';
import { PaperAccount } from '../../src/paper/paperAccount.js';
import { AccountStates } from '../../src/state/accountState.js';
import { AlertLog } from '../../src/state/alertLog.js';
import { CycleRuns } from '../../src/state/cycleRuns.js';
import { CHOSEN_MA_PERIOD, trendFilter } from '../../src/strategy/trendFilter.js';
import type { Candle } from '../../src/types.js';
import { DAY } from './candles.js';
import { FakeMarket } from './fakeMarket.js';

export const FEE_RATE = new Decimal('0.001');

export class RecordingAlerter implements Alerter {
  messages: string[] = [];

  async send(message: string): Promise<void> {
    this.messages.push(message);
  }
}

export class CountingHeartbeat implements Heartbeat {
  pings = 0;

  async ping(): Promise<boolean> {
    this.pings += 1;
    return true;
  }
}

export type Harness = {
  deps: CycleDeps;
  market: FakeMarket;
  alerts: RecordingAlerter;
  heartbeat: CountingHeartbeat;
  kill: { on: boolean };
  clock: { now: number };
  ledger: Ledger;
  accounts: AccountStates;
  runs: CycleRuns;
  /** Wraps the paper account the engine is given, to simulate a misbehaving exchange. */
  wrap: (account: TradingAccount) => TradingAccount;
  /** The founder's paper account, unwrapped. */
  paper: () => PaperAccount;
};

/** Real ledger, state, and paper account on the test database; fake market, clock, alerts, and heartbeat. */
export function harness(db: Database, market = new FakeMarket()): Harness {
  const clock = { now: 0 };
  const kill = { on: false };
  const alerts = new RecordingAlerter();
  const heartbeat = new CountingHeartbeat();
  const ledger = new Ledger(db);
  const accounts = new AccountStates(db);
  const runs = new CycleRuns(db);
  const paperFor = (userId: string) => new PaperAccount({ db, userId, market, feeRate: FEE_RATE });
  const h: Harness = {
    market,
    alerts,
    heartbeat,
    kill,
    clock,
    ledger,
    accounts,
    runs,
    wrap: (account) => account,
    paper: () => paperFor('founder'),
    deps: {
      ledger,
      accounts,
      runs,
      alertLog: new AlertLog(db),
      market,
      accountFor: (userId) => h.wrap(paperFor(userId)),
      killSwitch: { isOn: () => kill.on },
      alerter: alerts,
      heartbeat,
      now: () => clock.now,
      symbol: 'BTCUSDT',
      strategy: trendFilter({ maPeriod: CHOSEN_MA_PERIOD }),
      maPeriod: CHOSEN_MA_PERIOD,
      candleCount: 250,
      maxOrderUsdt: null,
      pollIntervalMs: 1_000,
      pollTimeoutMs: 5_000,
      // Sleeping advances the fake clock, so polling ends without real waiting.
      sleep: async (ms) => {
        clock.now += ms;
      },
    },
  };
  return h;
}

export async function openFounder(
  db: Database,
  usdt = '1000',
  at = new Date('2026-01-01T00:00:00Z'),
): Promise<void> {
  await PaperAccount.open(db, { userId: 'founder', baseCoin: 'BTC', quoteCoin: 'USDT', startingQuote: new Decimal(usdt), at });
}

/** Serves `candles`, and prices the market at the last close. */
export function setMarket(h: Harness, candles: Candle[]): void {
  h.market.candles = candles;
  h.market.setPrice(candles[candles.length - 1]!.close);
}

/** The first tick after a day's candle closes: 00:02 UTC the next day. */
export function tickTimeAfter(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) + DAY + 2 * 60_000;
}

/** The user outcomes of a tick that ran; fails the test if it did not. */
export function ran(outcome: TickOutcome): UserOutcome[] {
  if (outcome.kind !== 'RAN') {
    throw new Error(`expected the tick to run, but it returned ${outcome.kind}`);
  }
  return outcome.users;
}

/** Places the order for real, then throws — as when a request times out after the exchange accepted it. */
export function failsAfterPlacing(inner: TradingAccount): TradingAccount {
  return {
    getBalances: () => inner.getBalances(),
    getOrder: (id) => inner.getOrder(id),
    placeMarketOrder: async (order) => {
      await inner.placeMarketOrder(order);
      throw new Error('the request timed out');
    },
  };
}

/** Throws without placing — as when a request times out before it reaches the exchange. */
export function failsBeforePlacing(inner: TradingAccount): TradingAccount {
  return {
    getBalances: () => inner.getBalances(),
    getOrder: (id) => inner.getOrder(id),
    placeMarketOrder: async () => {
      throw new Error('the request timed out');
    },
  };
}

/** Its order lookups throw `times` times before working — inconclusive lookups. */
export function lookupFails(inner: TradingAccount, times: number): TradingAccount {
  let left = times;
  return {
    getBalances: () => inner.getBalances(),
    placeMarketOrder: (order) => inner.placeMarketOrder(order),
    getOrder: async (id) => {
      if (left > 0) {
        left -= 1;
        throw new Error('the lookup timed out');
      }
      return inner.getOrder(id);
    },
  };
}

/** Its order lookups answer NOT_VISIBLE `times` times before answering for real — an exchange slow to show orders. */
export function hidesOrders(inner: TradingAccount, times: number): TradingAccount {
  let left = times;
  return {
    getBalances: () => inner.getBalances(),
    placeMarketOrder: (order) => inner.placeMarketOrder(order),
    getOrder: async (id) => {
      if (left > 0) {
        left -= 1;
        return { kind: 'NOT_VISIBLE' };
      }
      return inner.getOrder(id);
    },
  };
}

/** Reports every order FILLED without moving any balance: a reconciliation mismatch. */
export function fillsWithoutMoving(inner: TradingAccount): TradingAccount {
  return {
    getBalances: () => inner.getBalances(),
    getOrder: (id) => inner.getOrder(id),
    placeMarketOrder: async (order) => ({
      clientOrderId: order.clientOrderId,
      side: order.side,
      status: 'FILLED',
      filledBaseQty: new Decimal('0.01'),
      filledQuoteAmount: new Decimal('799'),
      avgPrice: new Decimal('79900'),
      fee: new Decimal(0),
      feeCoin: 'BTC',
      rejectReason: null,
    }),
  };
}

/** Reports the given balances instead of the account's own. */
export function withBalances(inner: TradingAccount, read: () => Promise<CoinBalance[]>): TradingAccount {
  return {
    getBalances: read,
    getOrder: (id) => inner.getOrder(id),
    placeMarketOrder: (order) => inner.placeMarketOrder(order),
  };
}

function pendingState(order: MarketOrderRequest): OrderState {
  return {
    clientOrderId: order.clientOrderId,
    side: order.side,
    status: 'PENDING',
    filledBaseQty: new Decimal(0),
    filledQuoteAmount: new Decimal(0),
    avgPrice: null,
    fee: new Decimal(0),
    feeCoin: 'BTC',
    rejectReason: null,
  };
}

/** Accepts an order as PENDING and fills it only after `release()` — an exchange slow to settle. */
export class SlowAccount implements TradingAccount {
  #request: MarketOrderRequest | null = null;
  #settled: OrderState | null = null;
  #released = false;

  constructor(private readonly inner: TradingAccount) {}

  release(): void {
    this.#released = true;
  }

  getBalances(): Promise<CoinBalance[]> {
    return this.inner.getBalances();
  }

  async placeMarketOrder(order: MarketOrderRequest): Promise<OrderState> {
    this.#request = order;
    return pendingState(order);
  }

  async getOrder(id: string): Promise<OrderLookup> {
    if (this.#request === null || this.#request.clientOrderId !== id) {
      return this.inner.getOrder(id);
    }
    if (!this.#released) {
      return { kind: 'FOUND', state: pendingState(this.#request) };
    }
    this.#settled ??= await this.inner.placeMarketOrder(this.#request);
    return { kind: 'FOUND', state: this.#settled };
  }
}
```

- [ ] **Step 2: Write the failing tests for a normal day**

Create `tests/engine/cycle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { runTick } from '../../src/engine/cycle.js';
import { dailyCandles, lastDay, nextDay, trendingCandles } from '../helpers/candles.js';
import { useTestDatabase } from '../helpers/database.js';
import { harness, openFounder, ran, setMarket, tickTimeAfter, type Harness } from '../helpers/engine.js';

const database = useTestDatabase();
const UP = trendingCandles('2026-01-01', 300, 'up');
const DOWN = trendingCandles('2026-01-01', 300, 'down');
const MINUTE = 60_000;

async function setup(candles = UP, usdt = '1000'): Promise<Harness> {
  const h = harness(database());
  setMarket(h, candles);
  h.clock.now = tickTimeAfter(lastDay(candles));
  await openFounder(database(), usdt);
  return h;
}

async function coins(h: Harness) {
  const balances = await h.paper().getBalances();
  const of = (coin: string) => balances.find((b) => b.coin === coin)!.walletBalance;
  return { btc: of('BTC'), usdt: of('USDT') };
}

describe('a normal day', () => {
  it('buys on a LONG signal and completes the day', async () => {
    const h = await setup(UP);
    const [user] = ran(await runTick(h.deps));
    expect(user).toMatchObject({ userId: 'founder', result: 'COMPLETED' });
    const { btc, usdt } = await coins(h);
    expect(btc.gt(0)).toBe(true);
    expect(usdt.lt(5)).toBe(true);
    expect(await h.runs.get(lastDay(UP), 'founder')).toMatchObject({ status: 'completed', late: false, attempts: 1 });
    expect((await h.ledger.forUser('founder')).map((e) => e.type)).toEqual([
      'ACCOUNT_OPENED',
      'ORDER_INTENT',
      'ORDER_RESULT',
      'RECONCILED',
      'RUN_COMPLETED',
    ]);
    expect(h.alerts.messages.at(-1)).toMatch(/LONG\. Bought [\d.]+ BTC/);
    expect(h.heartbeat.pings).toBe(1);
  });

  it('records the signal once, with its close', async () => {
    const h = await setup(UP);
    await runTick(h.deps);
    const signals = await h.ledger.ofType('SIGNAL', null);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.payload).toMatchObject({ target: 'LONG', close: '79900', maPeriod: 125 });
  });

  it('does nothing, and touches no network, on later ticks the same day', async () => {
    const h = await setup(UP);
    await runTick(h.deps);
    const calls = { ...h.market.calls };
    h.clock.now += 15 * MINUTE;
    expect(await runTick(h.deps)).toEqual({ kind: 'NOTHING_TO_DO' });
    expect(h.market.calls).toEqual(calls);
    expect(h.heartbeat.pings).toBe(1);
  });

  it('holds its position the next day without trading', async () => {
    const h = await setup(UP);
    await runTick(h.deps);
    const next = trendingCandles('2026-01-01', 301, 'up');
    setMarket(h, next);
    h.clock.now = tickTimeAfter(lastDay(next));
    const [user] = ran(await runTick(h.deps));
    expect(user).toMatchObject({ result: 'COMPLETED', detail: 'no change' });
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(1);
    expect(h.alerts.messages.at(-1)).toMatch(/LONG, no change/);
  });

  it('sells everything when the trend turns', async () => {
    const h = await setup(UP);
    await runTick(h.deps);
    const turned = [...UP, ...dailyCandles(nextDay(lastDay(UP)), [40_000])];
    setMarket(h, turned);
    h.clock.now = tickTimeAfter(lastDay(turned));
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('COMPLETED');
    const { btc, usdt } = await coins(h);
    expect(btc.lt('0.000001')).toBe(true);
    expect(usdt.gt(400)).toBe(true);
    expect(h.alerts.messages.at(-1)).toMatch(/FLAT\. Sold/);
  });

  it('stays in cash on a FLAT signal with nothing to sell', async () => {
    const h = await setup(DOWN);
    const [user] = ran(await runTick(h.deps));
    expect(user).toMatchObject({ result: 'COMPLETED', detail: 'no change' });
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(0);
  });

  it('completes, with one notice, when the account is too small to trade', async () => {
    const h = await setup(UP, '3');
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('TOO_SMALL');
    expect(await h.runs.get(lastDay(UP), 'founder')).toMatchObject({ status: 'completed' });
    h.clock.now += 15 * MINUTE;
    await runTick(h.deps);
    expect(h.alerts.messages.filter((m) => m.includes('Nothing traded'))).toHaveLength(1);
  });

  it('alerts once a day when there are no accounts, and sends no heartbeat', async () => {
    const h = harness(database());
    setMarket(h, UP);
    h.clock.now = tickTimeAfter(lastDay(UP));
    expect(await runTick(h.deps)).toEqual({ kind: 'NOTHING_TO_DO' });
    expect(await runTick(h.deps)).toEqual({ kind: 'NOTHING_TO_DO' });
    expect(h.alerts.messages.filter((m) => m.includes('no accounts'))).toHaveLength(1);
    expect(h.heartbeat.pings).toBe(0);
  });
});
```

- [ ] **Step 3: Write the failing tests for everything that goes wrong**

Create `tests/engine/cycleFailures.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { runTick } from '../../src/engine/cycle.js';
import { clientOrderId } from '../../src/engine/orderId.js';
import { lastDay, trendingCandles } from '../helpers/candles.js';
import { useTestDatabase } from '../helpers/database.js';
import {
  failsAfterPlacing,
  failsBeforePlacing,
  fillsWithoutMoving,
  harness,
  hidesOrders,
  lookupFails,
  openFounder,
  ran,
  setMarket,
  SlowAccount,
  tickTimeAfter,
  withBalances,
  type Harness,
} from '../helpers/engine.js';
import { balances, bookAround } from '../helpers/market.js';

const database = useTestDatabase();
const UP = trendingCandles('2026-01-01', 300, 'up');
const DOWN = trendingCandles('2026-01-01', 300, 'down');
const NEXT = trendingCandles('2026-01-01', 301, 'up');
const DAY_ONE = lastDay(UP);
const PRICE = UP[UP.length - 1]!.close;
const MINUTE = 60_000;

async function setup(candles = UP): Promise<Harness> {
  const h = harness(database());
  setMarket(h, candles);
  h.clock.now = tickTimeAfter(lastDay(candles));
  await openFounder(database());
  return h;
}

/** Moves the harness to the first tick of the day after DAY_ONE. */
function nextDayTick(h: Harness): void {
  setMarket(h, NEXT);
  h.clock.now = tickTimeAfter(lastDay(NEXT));
}

function retryReason(outcome: Awaited<ReturnType<typeof runTick>>): string {
  if (outcome.kind !== 'RETRY_LATER') {
    throw new Error(`expected RETRY_LATER, got ${outcome.kind}`);
  }
  return outcome.reason;
}

describe('when the market cannot be read', () => {
  it('retries, alerting once, and completes late when Bybit returns', async () => {
    const h = await setup();
    h.market.fail.candles = new Error('could not reach any host: https://api.bybit.com');
    expect((await runTick(h.deps)).kind).toBe('RETRY_LATER');
    h.clock.now += 15 * MINUTE;
    expect((await runTick(h.deps)).kind).toBe('RETRY_LATER');
    expect(h.alerts.messages.filter((m) => m.includes('could not start'))).toHaveLength(1);
    expect(await h.runs.get(DAY_ONE, 'founder')).toMatchObject({ status: 'pending', attempts: 2 });

    delete h.market.fail.candles;
    h.clock.now = tickTimeAfter(DAY_ONE) + 120 * MINUTE;
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('COMPLETED');
    expect(await h.runs.get(DAY_ONE, 'founder')).toMatchObject({ status: 'completed', late: true, attempts: 3 });
    expect(h.alerts.messages.at(-1)).toContain('Completed late');
  });

  it('rejects a stale candle window and computes no signal', async () => {
    const h = await setup();
    h.market.candles = UP.slice(0, -1);
    expect(retryReason(await runTick(h.deps))).toContain(`expected ${DAY_ONE}`);
    expect(await h.ledger.ofType('SIGNAL', null)).toHaveLength(0);
  });

  it('rejects a candle window with a gap', async () => {
    const h = await setup();
    const gappy = [...UP];
    gappy.splice(250, 1);
    h.market.candles = gappy;
    expect(retryReason(await runTick(h.deps))).toContain('missing');
  });

  it('rejects a candle window with an invalid price', async () => {
    const h = await setup();
    const broken = UP.map((c) => ({ ...c }));
    broken[290] = { ...broken[290]!, close: new Decimal(0), low: new Decimal(0) };
    h.market.candles = broken;
    expect(retryReason(await runTick(h.deps))).toContain('not a positive number');
  });

  it('treats a stalled request like any failed request', async () => {
    const h = await setup();
    h.market.fail.book = new Error('the request to https://api.bybit.com/v5/market/orderbook timed out');
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('RETRY_LATER');
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(0);
    expect(h.alerts.messages.at(-1)).toContain('will retry');
  });

  it('abandons a day that never completed, then runs the next', async () => {
    const h = await setup();
    h.market.fail.candles = new Error('could not reach any host');
    await runTick(h.deps);
    delete h.market.fail.candles;
    nextDayTick(h);
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('COMPLETED');
    expect((await h.runs.get(DAY_ONE, 'founder'))?.status).toBe('abandoned');
    expect(await h.ledger.ofType('RUN_ABANDONED', 'founder')).toHaveLength(1);
    expect(h.alerts.messages.some((m) => m.startsWith(`Abandoned the ${DAY_ONE} run`))).toBe(true);
  });
});

describe('when something unexpected happens, it freezes', () => {
  it('on a Risk Guard veto', async () => {
    const h = await setup();
    h.market.book = bookAround(PRICE, '5', '0.01');
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('FROZEN');
    expect(user!.detail).toContain('spread');
    expect((await h.accounts.get('founder'))?.status).toBe('frozen');
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(0);
    expect(h.alerts.messages.at(-1)).toMatch(/^FROZE founder/);
  });

  it('on a partial fill', async () => {
    const h = await setup();
    // The first book sizes the order and passes the Risk Guard; the paper account fills against the second.
    h.market.books = [bookAround(PRICE), bookAround(PRICE, '0.001')];
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('FROZEN');
    expect(user!.detail).toContain('only partly filled');
  });

  it('on a reconciliation mismatch', async () => {
    const h = await setup();
    h.wrap = fillsWithoutMoving;
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('FROZEN');
    expect(user!.detail).toContain('not LONG');
  });

  it('on borrowed funds', async () => {
    const h = await setup();
    h.wrap = (inner) => withBalances(inner, async () => balances('0', '1000', { borrowedUsdt: '10' }));
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('FROZEN');
    expect(user!.detail).toContain('borrowed');
  });

  it('on locked BTC, rather than counting the account as FLAT', async () => {
    const h = await setup(DOWN);
    h.wrap = (inner) => withBalances(inner, async () => balances('0.01', '1000', { lockedBtc: '0.01' }));
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('FROZEN');
    expect(user!.detail).toContain('BTC is locked');
    expect((await h.runs.get(lastDay(DOWN), 'founder'))?.status).toBe('frozen');
  });

  it('on locked USDT', async () => {
    const h = await setup();
    h.wrap = (inner) => withBalances(inner, async () => balances('0', '1000', { lockedUsdt: '100' }));
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('FROZEN');
    expect(user!.detail).toContain('USDT is locked');
  });
});

describe('frozen, paused, and stopped accounts', () => {
  it('stays frozen until unfrozen, then catches up the same day', async () => {
    const h = await setup();
    h.market.book = bookAround(PRICE, '5', '0.01');
    await runTick(h.deps);
    h.clock.now += 15 * MINUTE;
    expect(await runTick(h.deps)).toEqual({ kind: 'NOTHING_TO_DO' });
    const alertsSoFar = h.alerts.messages.length;

    h.market.setPrice(PRICE);
    await h.accounts.unfreeze('founder', 'the spread was a glitch', new Date(h.clock.now));
    h.clock.now += 15 * MINUTE;
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('COMPLETED');
    expect(await h.runs.get(DAY_ONE, 'founder')).toMatchObject({ status: 'completed', attempts: 2 });
    expect(h.alerts.messages).toHaveLength(alertsSoFar + 1);
  });

  it('reminds once a day while frozen, and never abandons the frozen day', async () => {
    const h = await setup();
    h.market.book = bookAround(PRICE, '5', '0.01');
    await runTick(h.deps);
    nextDayTick(h);
    await runTick(h.deps);
    h.clock.now += 15 * MINUTE;
    await runTick(h.deps);
    expect(h.alerts.messages.filter((m) => m.startsWith('Reminder: founder is frozen'))).toHaveLength(1);
    expect((await h.runs.get(DAY_ONE, 'founder'))?.status).toBe('frozen');
  });

  it('skips a paused account, reminding once a day', async () => {
    const h = await setup();
    await h.accounts.pause('founder', 'travelling', new Date(h.clock.now));
    expect(await runTick(h.deps)).toEqual({ kind: 'NOTHING_TO_DO' });
    h.clock.now += 15 * MINUTE;
    await runTick(h.deps);
    expect(h.alerts.messages.filter((m) => m.startsWith('Reminder: founder is paused'))).toHaveLength(1);
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(0);
  });

  it('trades nothing while the kill switch is on, alerting once a day', async () => {
    const h = await setup();
    h.kill.on = true;
    expect(await runTick(h.deps)).toEqual({ kind: 'KILL_SWITCH' });
    h.clock.now += 15 * MINUTE;
    expect(await runTick(h.deps)).toEqual({ kind: 'KILL_SWITCH' });
    expect(h.alerts.messages).toHaveLength(1);
    expect(await h.ledger.ofType('KILL_SWITCH_SKIP', null)).toHaveLength(1);
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(0);
  });
});

describe('orders whose outcome is uncertain', () => {
  it('settles an order interrupted before midnight after midnight, under its own day', async () => {
    const h = await setup();
    h.clock.now = tickTimeAfter(DAY_ONE) + (23 * 60 + 45) * MINUTE; // 23:47 UTC: still DAY_ONE's run
    h.wrap = failsAfterPlacing;
    const [first] = ran(await runTick(h.deps));
    expect(first!.result).toBe('RETRY_LATER');
    const [intent] = await h.ledger.ofType('ORDER_INTENT', 'founder');
    const id = String(intent!.payload.clientOrderId);
    expect((await h.paper().getOrder(id)).kind).toBe('FOUND');

    h.wrap = (account) => account;
    nextDayTick(h);
    const [second] = ran(await runTick(h.deps));
    expect(second!.result).toBe('COMPLETED');
    expect((await h.runs.get(DAY_ONE, 'founder'))?.status).toBe('abandoned');
    const results = await h.ledger.ofType('ORDER_RESULT', 'founder');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ cycleDate: DAY_ONE, payload: { clientOrderId: id, status: 'FILLED' } });
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(1);
  });

  it('settles a placement that timed out after the order was accepted, without a second order', async () => {
    const h = await setup();
    h.wrap = failsAfterPlacing;
    ran(await runTick(h.deps));
    h.wrap = (account) => account;
    h.clock.now += 15 * MINUTE;
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('COMPLETED');
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(1);
    expect(await h.ledger.ofType('ORDER_RESULT', 'founder')).toHaveLength(1);
  });

  it('retries under a new ID only once the account proves the first order absent', async () => {
    const h = await setup();
    // The order never reaches the account.
    h.wrap = failsBeforePlacing;
    const [first] = ran(await runTick(h.deps));
    expect(first!.result).toBe('RETRY_LATER');

    // Fifteen minutes later the account still cannot see the order, and cannot
    // prove it absent. Time and an empty lookup prove nothing: no result, no new order.
    const hidden = hidesOrders(h.paper(), 1);
    h.wrap = () => hidden;
    h.clock.now += 15 * MINUTE;
    const [unsure] = ran(await runTick(h.deps));
    expect(unsure!.result).toBe('WAITING');
    expect(await h.ledger.ofType('ORDER_RESULT', 'founder')).toHaveLength(0);
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(1);

    // At the next tick the account proves the order absent. The retry gets a new ID and fills.
    h.clock.now += 15 * MINUTE;
    const [later] = ran(await runTick(h.deps));
    expect(later!.result).toBe('COMPLETED');

    const intents = await h.ledger.ofType('ORDER_INTENT', 'founder');
    const results = await h.ledger.ofType('ORDER_RESULT', 'founder');
    const ids = intents.map((e) => String(e.payload.clientOrderId));
    expect(intents.map((e) => e.payload.attempt)).toEqual([1, 2]);
    expect(ids).toEqual([
      clientOrderId('founder', DAY_ONE, 'ENTER_LONG', 1),
      clientOrderId('founder', DAY_ONE, 'ENTER_LONG', 2),
    ]);
    // Each ID has exactly one intent and one result.
    expect(results.map((e) => [e.payload.clientOrderId, e.payload.status])).toEqual([
      [ids[0], 'NOT_PLACED'],
      [ids[1], 'FILLED'],
    ]);
    // Exactly one order ever reached the account.
    expect((await h.paper().getOrder(ids[0]!)).kind).toBe('ABSENT');
    expect((await h.paper().getOrder(ids[1]!)).kind).toBe('FOUND');
  });

  it('places no replacement for an order that becomes visible late', async () => {
    const h = await setup();
    // The order reaches the account, but the placement times out and the
    // account then cannot see the order for two lookups.
    const delayed = hidesOrders(failsAfterPlacing(h.paper()), 2);
    h.wrap = () => delayed;
    ran(await runTick(h.deps));
    for (const minutes of [15, 30]) {
      h.clock.now = tickTimeAfter(DAY_ONE) + minutes * MINUTE;
      const [unsure] = ran(await runTick(h.deps));
      expect(unsure!.result, `after ${minutes} minutes`).toBe('WAITING');
    }
    h.clock.now = tickTimeAfter(DAY_ONE) + 45 * MINUTE;
    const [settled] = ran(await runTick(h.deps));
    expect(settled!.result).toBe('COMPLETED');

    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(1);
    expect((await h.ledger.ofType('ORDER_RESULT', 'founder')).map((e) => e.payload.status)).toEqual(['FILLED']);
    // No replacement order ever reached the account.
    expect((await h.paper().getOrder(clientOrderId('founder', DAY_ONE, 'ENTER_LONG', 2))).kind).toBe('ABSENT');
  });

  it('freezes, for a person to check, an order that stays invisible for an hour', async () => {
    const h = await setup();
    const hidden = hidesOrders(failsAfterPlacing(h.paper()), Number.POSITIVE_INFINITY);
    h.wrap = () => hidden;
    ran(await runTick(h.deps));
    h.clock.now += 61 * MINUTE;
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('FROZEN');
    expect(user!.detail).toContain('check the exchange by hand');
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(1);
  });

  it('records nothing when the lookup itself fails', async () => {
    const h = await setup();
    h.wrap = failsAfterPlacing;
    ran(await runTick(h.deps));
    h.wrap = (account) => lookupFails(account, 1);
    h.clock.now += 15 * MINUTE;
    const [inconclusive] = ran(await runTick(h.deps));
    expect(inconclusive!.result).toBe('RETRY_LATER');
    expect(await h.ledger.ofType('ORDER_RESULT', 'founder')).toHaveLength(0);

    h.wrap = (account) => account;
    h.clock.now += 15 * MINUTE;
    const [settled] = ran(await runTick(h.deps));
    expect(settled!.result).toBe('COMPLETED');
    expect(await h.ledger.ofType('ORDER_RESULT', 'founder')).toHaveLength(1);
  });

  it('waits for a pending order, then completes when it settles', async () => {
    const h = await setup();
    const slow = new SlowAccount(h.paper());
    h.wrap = () => slow;
    const [first] = ran(await runTick(h.deps));
    expect(first!.result).toBe('WAITING');
    expect(await h.runs.get(DAY_ONE, 'founder')).toMatchObject({ status: 'pending' });
    expect(h.heartbeat.pings).toBe(0);

    slow.release();
    h.clock.now += 15 * MINUTE;
    const [second] = ran(await runTick(h.deps));
    expect(second!.result).toBe('COMPLETED');
    expect(await h.ledger.ofType('ORDER_RESULT', 'founder')).toHaveLength(1);
  });

  it('freezes an order still pending after an hour', async () => {
    const h = await setup();
    const slow = new SlowAccount(h.paper());
    h.wrap = () => slow;
    ran(await runTick(h.deps));
    h.clock.now += 61 * MINUTE;
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('FROZEN');
    expect(user!.detail).toContain('pending for over an hour');
  });

  it('freezes rather than make a fourth attempt in one day', async () => {
    const h = await setup();
    h.wrap = failsBeforePlacing;
    for (let tick = 0; tick < 3; tick++) {
      const [user] = ran(await runTick(h.deps));
      expect(user!.result).toBe('RETRY_LATER');
      h.clock.now += 15 * MINUTE;
    }
    const [fourth] = ran(await runTick(h.deps));
    expect(fourth!.result).toBe('FROZEN');
    expect(fourth!.detail).toContain('failed to reach');
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(3);
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `npx vitest run tests/engine/cycle.test.ts tests/engine/cycleFailures.test.ts`
Expected: FAIL — `src/engine/cycle.ts` does not exist.

- [ ] **Step 5: Create `src/engine/cycle.ts`**

```ts
import type Decimal from 'decimal.js';
import type { Heartbeat } from '../alerts/heartbeat.js';
import type { Alerter } from '../alerts/telegram.js';
import type { MarketOrderRequest, OrderState, TradingAccount } from '../exchange/trading.js';
import type { Ledger } from '../ledger/ledger.js';
import { midPrice, type OrderBook } from '../market/orderBook.js';
import type { InstrumentRules, MarketData } from '../market/types.js';
import { mean } from '../math.js';
import type { AccountRecord, AccountStates } from '../state/accountState.js';
import type { AlertLog } from '../state/alertLog.js';
import type { CycleRuns } from '../state/cycleRuns.js';
import type { StrategyFn, TargetState } from '../types.js';
import { checkCandleWindow } from './candleWindow.js';
import { cycleDate, dueAt, isLate } from './cycleDate.js';
import { borrowedCoins, holdingsFor, lockedCoins, type Holdings } from './holdings.js';
import { clientOrderId, intentFor } from './orderId.js';
import { atTarget } from './reconcile.js';
import { checkOrder } from './riskGuard.js';
import { sizeOrder, type SizedOrder } from './sizing.js';

/** An order still pending this long after its intent freezes the account. */
export const PENDING_FREEZE_AFTER_MS = 60 * 60_000;

/**
 * An order the account still cannot see this long after its intent freezes the
 * account for a person to check. Time never proves absence, so the engine
 * waits rather than retries.
 */
export const NOT_VISIBLE_FREEZE_AFTER_MS = 60 * 60_000;

export type CycleDeps = {
  ledger: Ledger;
  accounts: AccountStates;
  runs: CycleRuns;
  alertLog: AlertLog;
  market: MarketData;
  accountFor: (userId: string) => TradingAccount;
  killSwitch: { isOn(): boolean };
  alerter: Alerter;
  heartbeat: Heartbeat;
  now: () => number;
  symbol: string;
  strategy: StrategyFn;
  /** The strategy's moving-average period: the window's minimum length, and the average recorded with the signal. */
  maPeriod: number;
  /** How many closed daily candles to fetch. */
  candleCount: number;
  maxOrderUsdt: Decimal | null;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  sleep: (ms: number) => Promise<void>;
};

export type UserOutcome = {
  userId: string;
  result: 'COMPLETED' | 'FROZEN' | 'TOO_SMALL' | 'WAITING' | 'RETRY_LATER';
  detail: string;
};

export type TickOutcome =
  | { kind: 'KILL_SWITCH' }
  | { kind: 'NOTHING_TO_DO' }
  | { kind: 'RETRY_LATER'; reason: string }
  | { kind: 'RAN'; users: UserOutcome[] };

type Run = { deps: CycleDeps; userId: string; date: string; at: Date };
type Stop = { kind: 'STOPPED'; outcome: UserOutcome };

/**
 * One tick of the engine. The timer runs this every 15 minutes; it does the
 * day's work once, and every later tick that day is a cheap no-op. The steps,
 * and why they come in this order, are in spec section 4.
 */
export async function runTick(deps: CycleDeps): Promise<TickOutcome> {
  const now = deps.now();
  const at = new Date(now);
  const date = cycleDate(now);

  if (deps.killSwitch.isOn()) {
    if (await deps.alertLog.claim(`${date}:system:kill-switch`, at)) {
      await deps.ledger.append({ occurredAt: at, userId: null, cycleDate: date, type: 'KILL_SWITCH_SKIP', payload: {} });
      await deps.alerter.send(`The kill switch is on, so nothing trades for ${date}.`);
    }
    return { kind: 'KILL_SWITCH' };
  }

  for (const run of await deps.runs.abandonBefore(date)) {
    await deps.ledger.append({
      occurredAt: at,
      userId: run.userId,
      cycleDate: run.cycleDate,
      type: 'RUN_ABANDONED',
      payload: { lastError: run.lastError },
    });
    await deps.alerter.send(
      `Abandoned the ${run.cycleDate} run for ${run.userId}: it did not complete before the next daily close.` +
        (run.lastError === null ? '' : ` Last error: ${run.lastError}.`) +
        ' Any order it sent is still settled and recorded before the account trades again.',
    );
  }

  const accounts = await deps.accounts.all();
  if (accounts.length === 0) {
    if (await deps.alertLog.claim(`${date}:system:no-accounts`, at)) {
      await deps.alerter.send('There are no accounts to trade. Run npm run paper:init to open one.');
    }
    return { kind: 'NOTHING_TO_DO' };
  }
  for (const account of accounts) {
    if (account.status !== 'active' && (await deps.alertLog.claim(`${date}:${account.userId}:reminder`, at))) {
      await deps.alerter.send(reminder(account));
    }
  }

  const needing: string[] = [];
  for (const account of accounts) {
    if (account.status === 'active' && (await deps.runs.get(date, account.userId))?.status !== 'completed') {
      needing.push(account.userId);
    }
  }
  if (needing.length === 0) {
    await heartbeatOnce(deps, date, at);
    return { kind: 'NOTHING_TO_DO' };
  }

  let signal: { target: TargetState; close: Decimal };
  try {
    signal = await readSignal(deps, date, at);
  } catch (error) {
    const reason = describeError(error);
    for (const userId of needing) {
      await deps.runs.startAttempt(date, userId, at);
      await deps.runs.recordError(date, userId, reason);
    }
    if (await deps.alertLog.claim(`${date}:system:failure`, at)) {
      await deps.ledger.append({ occurredAt: at, userId: null, cycleDate: date, type: 'RUN_FAILED', payload: { reason } });
      await deps.alerter.send(`The ${date} run could not start: ${reason}. It keeps retrying until the next daily close.`);
    }
    return { kind: 'RETRY_LATER', reason };
  }

  const users: UserOutcome[] = [];
  for (const userId of needing) {
    users.push(await runUser({ deps, userId, date, at }, signal.target, signal.close));
  }
  if ((await deps.runs.pendingFor(date)).length === 0) {
    await heartbeatOnce(deps, date, at);
  }
  return { kind: 'RAN', users };
}

/** Fetches and validates the candle window, evaluates the strategy, and records the day's signal once. */
async function readSignal(deps: CycleDeps, date: string, at: Date): Promise<{ target: TargetState; close: Decimal }> {
  const candles = await deps.market.getClosedDailyCandles(deps.symbol, deps.candleCount, at.getTime());
  const check = checkCandleWindow(candles, date, deps.maPeriod);
  if (!check.ok) {
    throw new Error(`the candle data was rejected: ${check.reason}`);
  }
  const target = deps.strategy(candles);
  const close = candles[candles.length - 1]!.close;
  if ((await deps.ledger.signalFor(date)) === null) {
    await deps.ledger.append({
      occurredAt: at,
      userId: null,
      cycleDate: date,
      type: 'SIGNAL',
      payload: {
        target,
        close,
        movingAverage: mean(candles.slice(-deps.maPeriod).map((c) => c.close)),
        maPeriod: deps.maPeriod,
      },
    });
  }
  return { target, close };
}

async function runUser(run: Run, target: TargetState, signalClose: Decimal): Promise<UserOutcome> {
  const { deps, userId, date, at } = run;
  await deps.runs.startAttempt(date, userId, at);
  const account = deps.accountFor(userId);
  try {
    // 1. Settle every outstanding order, from any day, before anything else.
    const settled = await settleOutstanding(run, account);
    if (settled.kind === 'STOPPED') {
      return settled.outcome;
    }
    const rules = await deps.market.getInstrumentRules(deps.symbol);
    let filled = settled.todaysFill;

    if (filled === null) {
      // 2. Balances.
      const balances = await account.getBalances();
      const borrowed = borrowedCoins(balances);
      if (borrowed.length > 0) {
        return await freeze(
          run,
          `there are borrowed funds on ${borrowed.join(' and ')}; repay them and turn off automatic borrowing`,
        );
      }
      const holdings = holdingsFor(balances, rules);
      const locked = lockedCoins(holdings, rules);
      if (locked.length > 0) {
        return await freeze(run, lockedReason(locked));
      }

      // 3. Size.
      const book = await deps.market.getOrderBook(deps.symbol);
      const sizing = sizeOrder(target, holdings, midPrice(book), rules);
      if (sizing.kind === 'TOO_SMALL') {
        return await tooSmall(run, sizing.reason);
      }
      if (sizing.kind === 'ORDER') {
        // 4 to 6: the Risk Guard, the intent, the order, and its result.
        const placement = await placeOrder(run, account, sizing.order, { holdings, rules, book, signalClose });
        if (placement.kind === 'STOPPED') {
          return placement.outcome;
        }
        filled = placement.state;
      }
    }

    // 7. Reconcile, on total balances.
    return await reconcile(run, account, rules, target, filled);
  } catch (error) {
    // Nothing is recorded as a result here. An intent written before the error
    // stays outstanding, and the next tick settles it through its client order ID.
    const reason = describeError(error);
    await deps.runs.recordError(date, userId, reason);
    if (await deps.alertLog.claim(`${date}:${userId}:failure`, at)) {
      await deps.ledger.append({ occurredAt: at, userId, cycleDate: date, type: 'RUN_FAILED', payload: { reason } });
      await deps.alerter.send(
        `The ${date} run for ${userId} hit an error and will retry: ${reason}. If an order was being sent, its outcome is settled at the next run.`,
      );
    }
    return { userId, result: 'RETRY_LATER', detail: reason };
  }
}

type Settlement = { kind: 'CLEAR'; todaysFill: OrderState | null } | Stop;

/**
 * Step 1: gives every outstanding intent, from any day, exactly one recorded
 * result — or stops. Only the adapter's proof of absence records NOT_PLACED;
 * elapsed time and an empty lookup never do (spec sections 4 and 4.2). A lookup
 * that throws is inconclusive: it records nothing and propagates to runUser,
 * which retries at the next tick.
 */
async function settleOutstanding(run: Run, account: TradingAccount): Promise<Settlement> {
  const { deps, userId, date, at } = run;
  let todaysFill: OrderState | null = null;
  for (const intent of await deps.ledger.outstandingIntents(userId)) {
    const id = String(intent.payload.clientOrderId);
    const intentDate = intent.cycleDate ?? date;
    const age = at.getTime() - intent.occurredAt.getTime();
    const lookup = await account.getOrder(id);
    if (lookup.kind === 'ABSENT') {
      await deps.ledger.append({
        occurredAt: at,
        userId,
        cycleDate: intentDate,
        type: 'ORDER_RESULT',
        payload: { clientOrderId: id, status: 'NOT_PLACED' },
      });
      continue;
    }
    if (lookup.kind === 'NOT_VISIBLE') {
      if (age >= NOT_VISIBLE_FREEZE_AFTER_MS) {
        return {
          kind: 'STOPPED',
          outcome: await freeze(
            run,
            `order ${id} from ${intentDate} has not been visible for over an hour, and the account cannot prove it was never placed; check the exchange by hand`,
          ),
        };
      }
      return waiting(
        run,
        `order ${id} from ${intentDate} is not visible yet; no replacement is placed until the account can say what happened to it`,
      );
    }
    const { state } = lookup;
    if (state.status === 'PENDING') {
      if (age >= PENDING_FREEZE_AFTER_MS) {
        return { kind: 'STOPPED', outcome: await freeze(run, `order ${id} from ${intentDate} has been pending for over an hour`) };
      }
      return waiting(run, `order ${id} from ${intentDate} is still pending`);
    }
    await recordResult(run, intentDate, state);
    if (state.status !== 'FILLED') {
      return { kind: 'STOPPED', outcome: await freeze(run, unfilledReason(state)) };
    }
    if (intentDate === date) {
      todaysFill = state;
    }
  }
  return { kind: 'CLEAR', todaysFill };
}

async function waiting(run: Run, detail: string): Promise<Stop> {
  await run.deps.runs.recordError(run.date, run.userId, detail);
  return { kind: 'STOPPED', outcome: { userId: run.userId, result: 'WAITING', detail } };
}

type MarketView = { holdings: Holdings; rules: InstrumentRules; book: OrderBook; signalClose: Decimal };
type Placement = { kind: 'FILLED'; state: OrderState } | Stop;

/** Steps 4 to 6: the attempt number, the Risk Guard, the intent, the order, and its result. */
async function placeOrder(run: Run, account: TradingAccount, order: SizedOrder, view: MarketView): Promise<Placement> {
  const { deps, userId, date, at } = run;
  const intent = intentFor(order.side);
  const today = await deps.ledger.ordersOn(userId, date);
  const attempt = today.filter((o) => o.intent.payload.intent === intent).length + 1;
  const id = clientOrderId(userId, date, intent, attempt);

  const decision = checkOrder(order, {
    killSwitchOn: deps.killSwitch.isOn(),
    accountStatus: (await deps.accounts.get(userId))?.status ?? 'frozen',
    priorOrderToday: today.some((o) => o.result?.payload.status !== 'NOT_PLACED'),
    attempt,
    holdings: view.holdings,
    rules: view.rules,
    book: view.book,
    ticker: await deps.market.getTicker(deps.symbol),
    signalClose: view.signalClose,
    maxOrderUsdt: deps.maxOrderUsdt,
  });
  if (!decision.approved) {
    return { kind: 'STOPPED', outcome: await freeze(run, `the Risk Guard vetoed the order. ${decision.reasons.join(' ')}`) };
  }

  // The intent is written first, so a crash after the order is sent is settled
  // at the next tick, never repeated. A placement that throws is uncertain, not
  // failed: its error reaches runUser, and the intent stays outstanding.
  await deps.ledger.append({
    occurredAt: at,
    userId,
    cycleDate: date,
    type: 'ORDER_INTENT',
    payload: { clientOrderId: id, intent, attempt, ...describeOrder(order), midPrice: midPrice(view.book) },
  });
  const state = await awaitSettlement(deps, account, await account.placeMarketOrder(toRequest(id, deps.symbol, order)));

  if (state.status === 'PENDING') {
    return waiting(run, `order ${id} is still pending`);
  }
  await recordResult(run, date, state);
  if (state.status !== 'FILLED') {
    return { kind: 'STOPPED', outcome: await freeze(run, unfilledReason(state)) };
  }
  return { kind: 'FILLED', state };
}

/** Polls a pending order until it settles or the poll window closes. Paper orders never pend. */
async function awaitSettlement(deps: CycleDeps, account: TradingAccount, placed: OrderState): Promise<OrderState> {
  let current = placed;
  const giveUpAt = deps.now() + deps.pollTimeoutMs;
  while (current.status === 'PENDING' && deps.now() < giveUpAt) {
    await deps.sleep(deps.pollIntervalMs);
    const lookup = await account.getOrder(placed.clientOrderId);
    if (lookup.kind === 'FOUND') {
      current = lookup.state;
    }
  }
  return current;
}

/** Step 7: the account must now be at its target, judged on totals, with nothing locked. */
async function reconcile(
  run: Run,
  account: TradingAccount,
  rules: InstrumentRules,
  target: TargetState,
  filled: OrderState | null,
): Promise<UserOutcome> {
  const { deps, userId, date, at } = run;
  const holdings = holdingsFor(await account.getBalances(), rules);
  const locked = lockedCoins(holdings, rules);
  if (locked.length > 0) {
    return freeze(run, lockedReason(locked));
  }
  const price = midPrice(await deps.market.getOrderBook(deps.symbol));
  if (!atTarget(target, holdings, price, rules)) {
    return freeze(run, `after the run the account is not ${target}: it holds ${describeHoldings(holdings, rules)}`);
  }
  const late = isLate(date, at.getTime());
  await deps.ledger.append({
    occurredAt: at,
    userId,
    cycleDate: date,
    type: 'RECONCILED',
    payload: { target, base: holdings.base.total, quote: holdings.quote.total, price },
  });
  await deps.runs.complete(date, userId, at, late);
  await deps.ledger.append({ occurredAt: at, userId, cycleDate: date, type: 'RUN_COMPLETED', payload: { late } });
  await deps.alerter.send(summary(run, target, filled, holdings, rules, late));
  return { userId, result: 'COMPLETED', detail: filled === null ? 'no change' : `${filled.side} filled` };
}

async function freeze(run: Run, reason: string): Promise<UserOutcome> {
  const { deps, userId, date, at } = run;
  const text = reason.replace(/\.\s*$/, '');
  await deps.accounts.freeze(userId, date, text, at);
  await deps.runs.markFrozen(date, userId, text);
  // This alert is today's reminder, so the next tick does not repeat it.
  await deps.alertLog.claim(`${date}:${userId}:reminder`, at);
  await deps.alerter.send(
    `FROZE ${userId} for ${date}: ${text}. Nothing trades on this account until you check it and run: npm run unfreeze -- --reason "what you found"`,
  );
  return { userId, result: 'FROZEN', detail: text };
}

async function tooSmall(run: Run, reason: string): Promise<UserOutcome> {
  const { deps, userId, date, at } = run;
  await deps.ledger.append({ occurredAt: at, userId, cycleDate: date, type: 'TOO_SMALL', payload: { reason } });
  await deps.runs.complete(date, userId, at, isLate(date, at.getTime()));
  if (await deps.alertLog.claim(`${date}:${userId}:too-small`, at)) {
    await deps.alerter.send(`Nothing traded for ${userId} on ${date}: ${reason}.`);
  }
  return { userId, result: 'TOO_SMALL', detail: reason };
}

/** Records an order's result under its intent's own cycle date. */
async function recordResult(run: Run, intentDate: string, state: OrderState): Promise<void> {
  await run.deps.ledger.append({
    occurredAt: run.at,
    userId: run.userId,
    cycleDate: intentDate,
    type: 'ORDER_RESULT',
    payload: { ...state },
  });
}

async function heartbeatOnce(deps: CycleDeps, date: string, at: Date): Promise<void> {
  const key = `${date}:system:heartbeat`;
  if (!(await deps.alertLog.has(key)) && (await deps.heartbeat.ping())) {
    await deps.alertLog.claim(key, at);
  }
}

function toRequest(id: string, symbol: string, order: SizedOrder): MarketOrderRequest {
  return order.side === 'BUY'
    ? { clientOrderId: id, symbol, side: 'BUY', quoteAmount: order.quoteAmount }
    : { clientOrderId: id, symbol, side: 'SELL', baseQty: order.baseQty };
}

function describeOrder(order: SizedOrder): Record<string, unknown> {
  return order.side === 'BUY' ? { side: 'BUY', quoteAmount: order.quoteAmount } : { side: 'SELL', baseQty: order.baseQty };
}

function unfilledReason(state: OrderState): string {
  return state.status === 'REJECTED'
    ? `order ${state.clientOrderId} was rejected: ${state.rejectReason ?? 'no reason given'}`
    : `order ${state.clientOrderId} was only partly filled (${state.filledBaseQty.toFixed()}), and the rest was cancelled`;
}

function lockedReason(coins: string[]): string {
  return `${coins.join(' and ')} is locked, which in a dedicated account means an order the engine did not place; the account must not be traded by hand`;
}

function describeHoldings(holdings: Holdings, rules: InstrumentRules): string {
  return `${holdings.base.total.toFixed()} ${rules.baseCoin} and ${holdings.quote.total.toFixed()} ${rules.quoteCoin}`;
}

function describeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
}

function reminder(account: AccountRecord): string {
  const why = account.reason === null ? '' : `: ${account.reason.replace(/\.\s*$/, '')}`;
  const how = account.status === 'frozen' ? 'npm run unfreeze -- --reason "what you found"' : 'npm run resume';
  return `Reminder: ${account.userId} is ${account.status}${why}. Nothing trades on it until you run ${how}.`;
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function summary(
  run: Run,
  target: TargetState,
  filled: OrderState | null,
  holdings: Holdings,
  rules: InstrumentRules,
  late: boolean,
): string {
  const lateText = late ? ` Completed late, ${formatDuration(run.at.getTime() - dueAt(run.date))} after the close.` : '';
  const now = `Holding ${describeHoldings(holdings, rules)}.`;
  if (filled === null) {
    return `${run.date}: ${target}, no change. ${now}${lateText}`;
  }
  const verb = filled.side === 'BUY' ? 'Bought' : 'Sold';
  const price = filled.avgPrice === null ? 'an unknown price' : filled.avgPrice.toFixed(2);
  return `${run.date}: ${target}. ${verb} ${filled.filledBaseQty.toFixed()} ${rules.baseCoin} for ${filled.filledQuoteAmount.toFixed(2)} ${rules.quoteCoin} at ${price}. ${now}${lateText}`;
}

/** One line per tick, for the log. */
export function describeOutcome(outcome: TickOutcome): string {
  switch (outcome.kind) {
    case 'KILL_SWITCH':
      return 'The kill switch is on: nothing traded.';
    case 'NOTHING_TO_DO':
      return 'Nothing to do.';
    case 'RETRY_LATER':
      return `Will retry: ${outcome.reason}`;
    case 'RAN':
      return outcome.users.map((u) => `${u.userId}: ${u.result}. ${u.detail}`).join('\n');
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/engine`
Expected: PASS. If a scenario fails, the bug is in `src/engine/cycle.ts`; fix the code, never weaken the test — each one is a way of losing money.

- [ ] **Step 7: Run the whole suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/engine/cycle.ts tests/helpers/engine.ts tests/engine/cycle.test.ts tests/engine/cycleFailures.test.ts
git commit -m "feat: add the daily tick, with recovery across days and every failure frozen or retried"
git push
```

---

## Task 16: The parity test

The most important test in the phase: the live engine and the backtest must make the same decisions on the same history (spec section 11).

**Files:**
- Create: `tests/fixtures/btcusdt-spot-1d-2023-2024.csv`
- Test: `tests/engine/parity.test.ts`

- [ ] **Step 1: Create the fixture from real Bybit candles**

```bash
npm run fetch
```

Then create `scratch-fixture.mjs` in the repository root:

```js
import { readFileSync, writeFileSync } from 'node:fs';

const lines = readFileSync('data/BTCUSDT-spot-1d.csv', 'utf8').split(/\r?\n/).filter(Boolean);
const from = Date.parse('2023-01-01T00:00:00Z');
const to = Date.parse('2024-12-31T00:00:00Z');
const rows = lines.slice(1).filter((line) => {
  const time = Number(line.split(',')[0]);
  return time >= from && time <= to;
});
writeFileSync('tests/fixtures/btcusdt-spot-1d-2023-2024.csv', [lines[0], ...rows].join('\n') + '\n');
console.log(`${rows.length} candles written`);
```

Run: `node scratch-fixture.mjs && rm scratch-fixture.mjs`
Expected: `731 candles written` — 2024 was a leap year. The file is about 50 KB; it is committed so the test never needs the network.

- [ ] **Step 2: Write the test**

Create `tests/engine/parity.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { runBacktest } from '../../src/backtest/engine.js';
import { parseCandleCsv } from '../../src/data/csv.js';
import { runTick } from '../../src/engine/cycle.js';
import { isoDate } from '../../src/engine/cycleDate.js';
import { CHOSEN_MA_PERIOD, trendFilter } from '../../src/strategy/trendFilter.js';
import { DAY } from '../helpers/candles.js';
import { useTestDatabase } from '../helpers/database.js';
import { FEE_RATE, harness, openFounder } from '../helpers/engine.js';
import { bookAround, tickerAt } from '../helpers/market.js';

/** Real Bybit BTCUSDT spot daily candles, 2023-01-01 to 2024-12-31. */
const CANDLES = parseCandleCsv(
  readFileSync(new URL('../fixtures/btcusdt-spot-1d-2023-2024.csv', import.meta.url), 'utf8'),
);
const database = useTestDatabase();

describe('parity with the backtest', () => {
  it('makes the same daily decisions and trades as the backtest, on two years of real candles', async () => {
    const h = harness(database());
    await openFounder(database(), '1000', new Date(CANDLES[0]!.time));
    h.market.candles = CANDLES;
    // The first candle with a full moving-average window behind it.
    const first = CHOSEN_MA_PERIOD - 1;

    // The live engine: one tick after each close, filling at the next candle's open.
    for (let i = first; i < CANDLES.length - 1; i++) {
      const next = CANDLES[i + 1]!;
      h.market.book = bookAround(next.open, '1000');
      h.market.ticker = tickerAt(next.open);
      h.clock.now = CANDLES[i]!.time + DAY + 2 * 60_000;
      const outcome = await runTick(h.deps);
      if (outcome.kind !== 'RAN' || outcome.users[0]!.result !== 'COMPLETED') {
        throw new Error(`the tick for ${isoDate(CANDLES[i]!.time)} did not complete: ${JSON.stringify(outcome)}`);
      }
    }

    // The backtest over the same candles: the same fee, and slippage equal to the synthetic spread.
    const backtest = runBacktest(
      CANDLES,
      trendFilter({ maPeriod: CHOSEN_MA_PERIOD }),
      { feeRate: FEE_RATE, slippageRate: new Decimal('0.0001') },
      new Decimal(1000),
      'parity',
      { evaluateFrom: CANDLES[first + 1]!.time },
    );

    // 1. Every daily target is the backtest's decision for that day: the state it
    //    holds from the next candle's open.
    const decidedOn = new Map(backtest.equityCurve.map((point) => [isoDate(point.time - DAY), point.state]));
    const signals = await h.ledger.ofType('SIGNAL', null);
    expect(signals).toHaveLength(CANDLES.length - 1 - first);
    for (const signal of signals) {
      expect(signal.payload.target, `the signal for ${signal.cycleDate}`).toBe(decidedOn.get(signal.cycleDate!));
    }

    // 2. Every trade happens on the same day, in the same direction.
    const engineTrades = (await h.ledger.ofType('ORDER_RESULT', 'founder')).map((e) => [
      e.cycleDate,
      e.payload.side,
      e.payload.status,
    ]);
    const backtestTrades = backtest.trades.map((t) => [isoDate(t.time - DAY), t.side, 'FILLED']);
    expect(engineTrades).toEqual(backtestTrades);
    expect(engineTrades.length).toBeGreaterThan(4);

    // 3. Final equity agrees within 1%. The small gap is the engine's 0.1% buy
    //    headroom and its rounding to Bybit's quantity step.
    const last = CANDLES[CANDLES.length - 1]!;
    const balances = await h.paper().getBalances();
    const coin = (name: string) => balances.find((b) => b.coin === name)!.walletBalance;
    const engineEquity = coin('USDT').plus(coin('BTC').times(last.close));
    const backtestEquity = backtest.equityCurve[backtest.equityCurve.length - 1]!.equity;
    expect(engineEquity.minus(backtestEquity).abs().div(backtestEquity).toNumber()).toBeLessThan(0.01);
  }, 300_000);
});
```

- [ ] **Step 3: Run it**

Run: `npx vitest run tests/engine/parity.test.ts`
Expected: PASS, in well under a minute. It exercises code that already exists, so it should pass first time. If it fails, the engine and the backtest disagree — **that is a real defect**; find which side is wrong before changing anything, and never loosen the assertions to make it pass.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/btcusdt-spot-1d-2023-2024.csv tests/engine/parity.test.ts
git commit -m "test: prove the live engine and the backtest make the same decisions"
git push
```

---

## Task 17: Engine settings

**Files:**
- Modify: `src/cli/env.ts`
- Test: `tests/cli/engineConfig.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/cli/engineConfig.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { killSwitchFileFrom, readEngineConfig } from '../../src/cli/env.js';

const BASE = { TRADING_MODE: 'paper' };

describe('readEngineConfig', () => {
  it('requires TRADING_MODE=paper, the only mode in this phase', () => {
    expect(() => readEngineConfig({})).toThrow('TRADING_MODE must be "paper"');
    expect(() => readEngineConfig({ TRADING_MODE: 'live' })).toThrow('not "live"');
  });

  it('has safe defaults', () => {
    const config = readEngineConfig(BASE);
    expect(config).toMatchObject({
      tradingMode: 'paper',
      userId: 'founder',
      dbDir: 'data/db',
      lockFile: 'data/db.lock',
      killSwitchFile: 'data/KILL_SWITCH',
      maxOrderUsdt: null,
      telegram: null,
      healthcheckUrl: null,
    });
    expect(config.paperFeeRate.toFixed()).toBe('0.001');
  });

  it('needs both Telegram settings or neither', () => {
    expect(() => readEngineConfig({ ...BASE, TELEGRAM_BOT_TOKEN: 'x' })).toThrow('both');
    expect(() => readEngineConfig({ ...BASE, TELEGRAM_CHAT_ID: '1' })).toThrow('both');
    expect(readEngineConfig({ ...BASE, TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_CHAT_ID: '1' }).telegram?.chatId).toBe('1');
  });

  it('keeps the bot token and the heartbeat URL secret', () => {
    const config = readEngineConfig({
      ...BASE,
      TELEGRAM_BOT_TOKEN: 'TOKEN-123',
      TELEGRAM_CHAT_ID: '1',
      HEALTHCHECK_URL: 'https://hc-ping.com/UUID-456',
    });
    expect(JSON.stringify(config)).not.toContain('TOKEN-123');
    expect(JSON.stringify(config)).not.toContain('UUID-456');
    expect(config.telegram?.token.reveal()).toBe('TOKEN-123');
  });

  it('refuses a heartbeat URL that is not https', () => {
    expect(() => readEngineConfig({ ...BASE, HEALTHCHECK_URL: 'http://example.test' })).toThrow('https://');
  });

  it('reads the fee rate and the optional order cap', () => {
    const config = readEngineConfig({ ...BASE, PAPER_FEE_RATE: '0.002', MAX_ORDER_USDT: '250' });
    expect(config.paperFeeRate.toFixed()).toBe('0.002');
    expect(config.maxOrderUsdt?.toFixed()).toBe('250');
  });

  it('rejects a fee rate or a cap that makes no sense', () => {
    expect(() => readEngineConfig({ ...BASE, PAPER_FEE_RATE: 'abc' })).toThrow('PAPER_FEE_RATE');
    expect(() => readEngineConfig({ ...BASE, PAPER_FEE_RATE: '0.5' })).toThrow('PAPER_FEE_RATE');
    expect(() => readEngineConfig({ ...BASE, MAX_ORDER_USDT: '-1' })).toThrow('MAX_ORDER_USDT');
  });

  it('puts the lock beside the database directory, never inside it', () => {
    expect(readEngineConfig({ ...BASE, DB_DIR: '/var/lib/autotrader/db/' }).lockFile).toBe('/var/lib/autotrader/db.lock');
  });
});

describe('killSwitchFileFrom', () => {
  it('defaults to data/KILL_SWITCH, and can be moved', () => {
    expect(killSwitchFileFrom({})).toBe('data/KILL_SWITCH');
    expect(killSwitchFileFrom({ KILL_SWITCH_FILE: '/run/autotrader/KILL' })).toBe('/run/autotrader/KILL');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/cli/engineConfig.test.ts`
Expected: FAIL — `readEngineConfig` and `killSwitchFileFrom` are not exported.

- [ ] **Step 3: Add the engine settings to `src/cli/env.ts`**

Add these imports at the top:

```ts
import Decimal from 'decimal.js';
import { Secret } from '../secrets/secret.js';
```

and append:

```ts
export type EngineConfig = {
  /** Only paper trading exists in Phase 2. Stated explicitly, so a mode is never implied. */
  tradingMode: 'paper';
  userId: string;
  dbDir: string;
  /** Beside the database directory, never inside it: PGlite owns that directory. */
  lockFile: string;
  killSwitchFile: string;
  paperFeeRate: Decimal;
  maxOrderUsdt: Decimal | null;
  telegram: { token: Secret; chatId: string } | null;
  healthcheckUrl: Secret | null;
};

/** Where the kill-switch file lives. Read on its own, so the kill switch works when other settings are broken. */
export function killSwitchFileFrom(env: Record<string, string | undefined> = process.env): string {
  return env.KILL_SWITCH_FILE?.trim() || 'data/KILL_SWITCH';
}

function decimalSetting(
  name: string,
  value: string | undefined,
  fallback: string | null,
  valid: (d: Decimal) => boolean,
  rule: string,
): Decimal | null {
  const text = value?.trim() || fallback;
  if (text === null) {
    return null;
  }
  let parsed: Decimal;
  try {
    parsed = new Decimal(text);
  } catch {
    throw new Error(`${name} must be a number, not "${text}"`);
  }
  if (!parsed.isFinite() || !valid(parsed)) {
    throw new Error(`${name} must be ${rule}, not "${text}"`);
  }
  return parsed;
}

/** Reads the engine's settings. Secrets are wrapped at once and never echoed in errors. */
export function readEngineConfig(env: Record<string, string | undefined> = process.env): EngineConfig {
  const mode = env.TRADING_MODE?.trim();
  if (mode !== 'paper') {
    throw new Error(
      `TRADING_MODE must be "paper", the only mode in this phase${mode ? `, not "${mode}"` : ''}. Add TRADING_MODE=paper to .env.local.`,
    );
  }
  const { userId, dbDir } = readConfig(env);
  const token = env.TELEGRAM_BOT_TOKEN?.trim() ?? '';
  const chatId = env.TELEGRAM_CHAT_ID?.trim() ?? '';
  if ((token === '') !== (chatId === '')) {
    throw new Error('Set both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, or neither.');
  }
  const healthcheck = env.HEALTHCHECK_URL?.trim() ?? '';
  if (healthcheck !== '' && !healthcheck.startsWith('https://')) {
    throw new Error('HEALTHCHECK_URL must start with https://');
  }
  return {
    tradingMode: 'paper',
    userId,
    dbDir,
    lockFile: `${dbDir.replace(/[\\/]+$/, '')}.lock`,
    killSwitchFile: killSwitchFileFrom(env),
    paperFeeRate: decimalSetting('PAPER_FEE_RATE', env.PAPER_FEE_RATE, '0.001', (d) => d.gte(0) && d.lt('0.01'), 'at least 0 and below 0.01')!,
    maxOrderUsdt: decimalSetting('MAX_ORDER_USDT', env.MAX_ORDER_USDT, null, (d) => d.gt(0), 'above zero'),
    telegram: token === '' ? null : { token: new Secret(token), chatId },
    healthcheckUrl: healthcheck === '' ? null : new Secret(healthcheck),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/cli`
Expected: PASS — the new tests and the existing `readConfig` tests.

- [ ] **Step 5: Commit**

```bash
git add src/cli/env.ts tests/cli/engineConfig.test.ts
git commit -m "feat: read the engine's settings"
git push
```

---

## Task 18: The engine context and the operating commands

The commands are thin wrappers over tested code. They are checked by running them, against a scratch database and Bybit's live public prices.

**Files:**
- Create: `src/cli/engineContext.ts`, `src/cli/cycle.ts`, `src/cli/paper-init.ts`, `src/cli/status.ts`, `src/cli/pause.ts`, `src/cli/resume.ts`, `src/cli/unfreeze.ts`, `src/cli/kill-switch.ts`, `src/cli/alerts-test.ts`
- Modify: `package.json`

- [ ] **Step 1: Create `src/cli/engineContext.ts`**

```ts
import { mkdirSync } from 'node:fs';
import { HealthcheckHeartbeat, NoHeartbeat, type Heartbeat } from '../alerts/heartbeat.js';
import { LogAlerter, TelegramAlerter, type Alerter } from '../alerts/telegram.js';
import { openDatabase, type Database } from '../db/client.js';
import type { CycleDeps } from '../engine/cycle.js';
import { Ledger } from '../ledger/ledger.js';
import { BybitPublicMarket } from '../market/bybitPublic.js';
import { KillSwitch } from '../ops/killSwitch.js';
import { acquireLock } from '../ops/lock.js';
import { PaperAccount } from '../paper/paperAccount.js';
import { AccountStates } from '../state/accountState.js';
import { AlertLog } from '../state/alertLog.js';
import { CycleRuns } from '../state/cycleRuns.js';
import { CHOSEN_MA_PERIOD, trendFilter } from '../strategy/trendFilter.js';
import { loadLocalEnv, readEngineConfig, type EngineConfig } from './env.js';

/** BTC only: docs/decisions.md #21. */
export const SYMBOL = 'BTCUSDT';

/** Every alert says it comes from paper trading, so no one mistakes it for real money. */
const ALERT_PREFIX = '[paper] ';

export type Engine = {
  config: EngineConfig;
  db: Database;
  deps: CycleDeps;
  ledger: Ledger;
  accounts: AccountStates;
  runs: CycleRuns;
  market: BybitPublicMarket;
  alerter: Alerter;
  paperAccount: (userId: string) => PaperAccount;
  close: () => Promise<void>;
};

/**
 * Loads the settings, takes the database lock, and wires the engine's real
 * dependencies. PGlite must never be opened by two processes at once, so every
 * command that touches the database goes through here.
 */
export async function openEngine(): Promise<Engine> {
  loadLocalEnv();
  const config = readEngineConfig(process.env);
  const release = await acquireLock(config.lockFile);
  try {
    mkdirSync(config.dbDir, { recursive: true });
    const database = await openDatabase(config.dbDir);
    const { db } = database;
    const ledger = new Ledger(db);
    const accounts = new AccountStates(db);
    const runs = new CycleRuns(db);
    const market = new BybitPublicMarket();
    const alerter: Alerter =
      config.telegram === null
        ? new LogAlerter(console.log, ALERT_PREFIX)
        : new TelegramAlerter({ token: config.telegram.token, chatId: config.telegram.chatId, prefix: ALERT_PREFIX });
    const heartbeat: Heartbeat =
      config.healthcheckUrl === null ? new NoHeartbeat() : new HealthcheckHeartbeat({ url: config.healthcheckUrl });
    const paperAccount = (userId: string) => new PaperAccount({ db, userId, market, feeRate: config.paperFeeRate });
    const deps: CycleDeps = {
      ledger,
      accounts,
      runs,
      alertLog: new AlertLog(db),
      market,
      accountFor: paperAccount,
      killSwitch: new KillSwitch(config.killSwitchFile),
      alerter,
      heartbeat,
      now: () => Date.now(),
      symbol: SYMBOL,
      strategy: trendFilter({ maPeriod: CHOSEN_MA_PERIOD }),
      maPeriod: CHOSEN_MA_PERIOD,
      candleCount: 250,
      maxOrderUsdt: config.maxOrderUsdt,
      pollIntervalMs: 2_000,
      pollTimeoutMs: 60_000,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    };
    return {
      config,
      db,
      deps,
      ledger,
      accounts,
      runs,
      market,
      alerter,
      paperAccount,
      close: async () => {
        try {
          await database.close();
        } finally {
          release();
        }
      },
    };
  } catch (error) {
    release();
    throw error;
  }
}
```

- [ ] **Step 2: Create `src/cli/cycle.ts`**

```ts
import { describeOutcome, runTick } from '../engine/cycle.js';
import { runCli } from './context.js';
import { openEngine } from './engineContext.js';

/**
 * The process's own deadline. A tick normally takes seconds; one still running
 * after five minutes is stopped, so it cannot hold the database lock all day.
 * Its intents stay outstanding and its lock is detected as stale, so the next
 * tick recovers. systemd's TimeoutStartSec=10min is the outer bound.
 */
const TICK_DEADLINE_MS = 5 * 60_000;
setTimeout(() => {
  console.error('The tick ran for more than 5 minutes and was stopped.');
  process.exit(1);
}, TICK_DEADLINE_MS).unref();

await runCli(async () => {
  const engine = await openEngine();
  try {
    if (engine.config.telegram === null) {
      console.warn('Telegram is not configured, so alerts only go to this log.');
    }
    console.log(describeOutcome(await runTick(engine.deps)));
    return 0;
  } finally {
    await engine.close();
  }
});
```

- [ ] **Step 3: Create `src/cli/paper-init.ts`**

```ts
import { parseArgs } from 'node:util';
import Decimal from 'decimal.js';
import { PaperAccount } from '../paper/paperAccount.js';
import { runCli } from './context.js';
import { openEngine } from './engineContext.js';

await runCli(async () => {
  const { values } = parseArgs({ options: { usdt: { type: 'string', default: '1000' } } });
  const text = String(values.usdt);
  let usdt: Decimal;
  try {
    usdt = new Decimal(text);
  } catch {
    throw new Error(`--usdt must be a number, not "${text}"`);
  }
  if (!usdt.isFinite() || usdt.lte(0)) {
    throw new Error(`--usdt must be above zero, not "${text}"`);
  }
  const engine = await openEngine();
  try {
    await PaperAccount.open(engine.db, {
      userId: engine.config.userId,
      baseCoin: 'BTC',
      quoteCoin: 'USDT',
      startingQuote: usdt,
      at: new Date(),
    });
    console.log(`Opened a paper account for "${engine.config.userId}" with ${usdt.toFixed()} USDT.`);
    return 0;
  } finally {
    await engine.close();
  }
});
```

- [ ] **Step 4: Create `src/cli/status.ts`**

```ts
import Decimal from 'decimal.js';
import { cycleDate } from '../engine/cycleDate.js';
import { midPrice } from '../market/orderBook.js';
import { runCli } from './context.js';
import { openEngine, SYMBOL } from './engineContext.js';

await runCli(async () => {
  const engine = await openEngine();
  try {
    const { userId } = engine.config;
    const account = await engine.accounts.get(userId);
    if (account === null) {
      console.error(`There is no account for "${userId}". Run npm run paper:init first.`);
      return 1;
    }
    const today = cycleDate(Date.now());
    console.log(`Account "${userId}": ${account.status}${account.reason === null ? '' : ` (${account.reason})`}`);
    console.log(`Kill switch: ${engine.deps.killSwitch.isOn() ? 'ON, so nothing trades' : 'off'}`);

    let price: Decimal | null = null;
    try {
      price = midPrice(await engine.market.getOrderBook(SYMBOL));
    } catch {
      // Shown as unavailable below; status must still work when Bybit does not.
    }
    let value = new Decimal(0);
    for (const balance of await engine.paperAccount(userId).getBalances()) {
      console.log(`  ${balance.coin.padEnd(6)} ${balance.walletBalance.toFixed()}`);
      if (balance.coin === 'USDT') {
        value = value.plus(balance.walletBalance);
      } else if (balance.coin === 'BTC' && price !== null) {
        value = value.plus(balance.walletBalance.times(price));
      }
    }
    console.log(price === null ? 'Value: unavailable, because the price could not be read' : `Value: ${value.toFixed(2)} USDT, with BTC at ${price.toFixed(2)}`);

    const signal = await engine.ledger.signalFor(today);
    console.log(signal === null ? `No signal recorded for ${today} yet.` : `Signal for ${today}: ${String(signal.payload.target)}`);
    const run = await engine.runs.get(today, userId);
    console.log(
      run === null
        ? `No run for ${today} yet.`
        : `Run for ${today}: ${run.status}${run.late ? ', late' : ''}, ${run.attempts} attempt(s)${run.lastError === null ? '' : `. Last error: ${run.lastError}`}`,
    );
    return 0;
  } finally {
    await engine.close();
  }
});
```

- [ ] **Step 5: Create `src/cli/pause.ts`, `src/cli/resume.ts`, and `src/cli/unfreeze.ts`**

`src/cli/pause.ts`:

```ts
import { parseArgs } from 'node:util';
import { runCli } from './context.js';
import { openEngine } from './engineContext.js';

await runCli(async () => {
  const { values } = parseArgs({ options: { reason: { type: 'string' } } });
  const engine = await openEngine();
  try {
    await engine.accounts.pause(engine.config.userId, values.reason?.trim() || null, new Date());
    console.log(`Paused "${engine.config.userId}". Nothing trades until you run npm run resume.`);
    return 0;
  } finally {
    await engine.close();
  }
});
```

`src/cli/resume.ts`:

```ts
import { runCli } from './context.js';
import { openEngine } from './engineContext.js';

await runCli(async () => {
  const engine = await openEngine();
  try {
    await engine.accounts.resume(engine.config.userId, new Date());
    console.log(`Resumed "${engine.config.userId}". It trades again from the next tick.`);
    return 0;
  } finally {
    await engine.close();
  }
});
```

`src/cli/unfreeze.ts`:

```ts
import { parseArgs } from 'node:util';
import { runCli } from './context.js';
import { openEngine } from './engineContext.js';

await runCli(async () => {
  const { values } = parseArgs({ options: { reason: { type: 'string' } } });
  const reason = values.reason?.trim() ?? '';
  if (reason === '') {
    console.error('Say what you checked, for the record: npm run unfreeze -- --reason "what you found"');
    return 1;
  }
  const engine = await openEngine();
  try {
    await engine.accounts.unfreeze(engine.config.userId, reason, new Date());
    console.log(`Unfroze "${engine.config.userId}". If today's run has not completed, the next tick runs it.`);
    return 0;
  } finally {
    await engine.close();
  }
});
```

- [ ] **Step 6: Create `src/cli/kill-switch.ts`**

```ts
import { parseArgs } from 'node:util';
import { KillSwitch } from '../ops/killSwitch.js';
import { runCli } from './context.js';
import { killSwitchFileFrom, loadLocalEnv } from './env.js';

// Deliberately independent of the database and of every other setting, so the
// kill switch works even when the rest of the application does not.
await runCli(async () => {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { reason: { type: 'string' } } });
  loadLocalEnv();
  const killSwitch = new KillSwitch(killSwitchFileFrom(process.env));
  const [command] = positionals;
  if (command === 'on') {
    killSwitch.turnOn(values.reason?.trim() || 'no reason given', new Date());
    console.log(`Kill switch ON (${killSwitch.file}). Nothing trades until you run: npm run kill-switch -- off`);
    return 0;
  }
  if (command === 'off') {
    killSwitch.turnOff();
    console.log('Kill switch off. Trading resumes at the next tick.');
    return 0;
  }
  console.log(
    `The kill switch is ${killSwitch.isOn() ? 'ON' : 'off'}. Use: npm run kill-switch -- on --reason "why", or: npm run kill-switch -- off`,
  );
  return command === undefined ? 0 : 1;
});
```

- [ ] **Step 7: Create `src/cli/alerts-test.ts`**

```ts
import { TelegramAlerter } from '../alerts/telegram.js';
import { runCli } from './context.js';
import { loadLocalEnv, readEngineConfig } from './env.js';

await runCli(async () => {
  loadLocalEnv();
  const config = readEngineConfig(process.env);
  if (config.telegram === null) {
    console.error('Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.local.');
    return 1;
  }
  const problems: string[] = [];
  await new TelegramAlerter({ ...config.telegram, prefix: '[paper] ', log: (line) => problems.push(line) }).send(
    'Test alert from crypto-autotrader. If you can read this, alerts work.',
  );
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    return 1;
  }
  console.log('Test alert sent. Check Telegram.');
  return 0;
});
```

- [ ] **Step 8: Add the scripts to `package.json`**

After `"out-of-asset": "tsx src/cli/outOfAsset.ts",` add:

```json
    "cycle": "tsx src/cli/cycle.ts",
    "paper:init": "tsx src/cli/paper-init.ts",
    "status": "tsx src/cli/status.ts",
    "pause": "tsx src/cli/pause.ts",
    "resume": "tsx src/cli/resume.ts",
    "unfreeze": "tsx src/cli/unfreeze.ts",
    "kill-switch": "tsx src/cli/kill-switch.ts",
    "alerts:test": "tsx src/cli/alerts-test.ts",
```

- [ ] **Step 9: Typecheck and run the suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 10: Smoke-test the commands against a scratch database and live prices**

These use Bybit's live public data, so this machine needs internet. Arguments always go after `--`, or npm keeps flags such as `--reason` for itself. In a bash shell:

```bash
export TRADING_MODE=paper DB_DIR=data/smoke-db KILL_SWITCH_FILE=data/smoke-KILL
npm run paper:init -- --usdt 1000
npm run cycle
npm run status
npm run cycle
npm run pause -- --reason "smoke test"
npm run cycle
npm run resume
npm run kill-switch -- on --reason "smoke test"
npm run cycle
npm run kill-switch -- off
npm run alerts:test
rm -rf data/smoke-db data/smoke-db.lock data/smoke-KILL
unset TRADING_MODE DB_DIR KILL_SWITCH_FILE
```

Expected, in order: an account opened with 1000 USDT; a tick that completes today's run, printing `founder: COMPLETED` and an `[alert] [paper]` summary line; a status showing the balances, a value, today's signal, and a completed run; `Nothing to do.`; a pause, then `Nothing to do.` and a reminder alert; a resume; the kill switch on, then `The kill switch is on: nothing traded.`; the kill switch off; and `Telegram is not configured` with exit code 1. Record anything different in the plan's execution notes.

- [ ] **Step 11: Commit**

```bash
git add src/cli/engineContext.ts src/cli/cycle.ts src/cli/paper-init.ts src/cli/status.ts src/cli/pause.ts src/cli/resume.ts src/cli/unfreeze.ts src/cli/kill-switch.ts src/cli/alerts-test.ts package.json
git commit -m "feat: add the engine's operating commands"
git push
```

---

## Task 19: The paper report

**Files:**
- Create: `src/app/paperReport.ts`, `src/cli/paper-report.ts`
- Modify: `package.json`
- Test: `tests/app/paperReport.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/app/paperReport.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { buildPaperReport, formatPaperReport, type ReportInput } from '../../src/app/paperReport.js';
import { isoDate } from '../../src/engine/cycleDate.js';
import type { LedgerEvent, LedgerEventType } from '../../src/ledger/ledger.js';
import { CHOSEN_MA_PERIOD, trendFilter } from '../../src/strategy/trendFilter.js';
import { trendingCandles } from '../helpers/candles.js';

// Rising prices: from candle 124 on, the strategy says LONG every day.
const CANDLES = trendingCandles('2026-01-01', 130, 'up');
const day = (i: number) => isoDate(CANDLES[i]!.time);
const AT = new Date('2026-01-01T00:00:00Z');

let nextId = 1;
function event(type: LedgerEventType, cycleDate: string | null, payload: Record<string, unknown>, userId: string | null = 'founder'): LedgerEvent {
  return { id: nextId++, occurredAt: AT, userId, cycleDate, type, payload };
}

function input(overrides: { buySide?: string; signalOn127?: string } = {}): ReportInput {
  const signals = [126, 127, 128].map((i) =>
    event('SIGNAL', day(i), { target: i === 127 ? (overrides.signalOn127 ?? 'LONG') : 'LONG', close: CANDLES[i]!.close.toFixed() }, null),
  );
  const events = [
    event('ACCOUNT_OPENED', null, { mode: 'paper', balances: { USDT: '1000', BTC: '0' } }),
    event('ORDER_RESULT', day(126), {
      clientOrderId: 'a',
      side: overrides.buySide ?? 'BUY',
      status: 'FILLED',
      filledBaseQty: '0.015958',
      avgPrice: '62606.26',
    }),
    ...[126, 127, 128].map((i) => event('RUN_COMPLETED', day(i), { late: i === 127 })),
  ];
  return {
    userId: 'founder',
    events,
    signals,
    holdings: { base: new Decimal('0.015942'), quote: new Decimal('1') },
    price: CANDLES[129]!.close,
    candles: CANDLES,
    strategy: trendFilter({ maPeriod: CHOSEN_MA_PERIOD }),
    costs: { feeRate: new Decimal('0.001'), slippageRate: new Decimal('0.0001') },
  };
}

describe('buildPaperReport', () => {
  it('counts the days, lists the trades, and values the account', () => {
    const report = buildPaperReport(input());
    expect(report).toMatchObject({
      firstDay: day(126),
      lastDay: day(128),
      daysCompleted: 3,
      daysLate: 1,
      daysAbandoned: 0,
      freezes: 0,
    });
    expect(report.trades).toEqual([{ day: day(126), side: 'BUY', qty: '0.015958', price: '62606.26' }]);
    // 1 USDT + 0.015942 BTC at 62,900.
    expect(report.value.toFixed(4)).toBe('1003.7518');
    // 1,000 USDT of BTC at the first day's close of 62,600, valued at 62,900.
    expect(report.buyAndHold!.toFixed(2)).toBe('1004.79');
  });

  it("matches the backtest's trades over the same days", () => {
    const report = buildPaperReport(input());
    expect(report.backtestTrades).toEqual([{ day: day(126), side: 'BUY' }]);
    expect(report.tradesMatch).toBe(true);
    expect(report.signalMismatches).toEqual([]);
  });

  it('reports a trade that differs from the backtest', () => {
    expect(buildPaperReport(input({ buySide: 'SELL' })).tradesMatch).toBe(false);
  });

  it('reports a recorded signal the strategy would not give', () => {
    const report = buildPaperReport(input({ signalOn127: 'FLAT' }));
    expect(report.signalMismatches).toHaveLength(1);
    expect(report.signalMismatches[0]).toContain(day(127));
  });

  it('handles an account with no runs yet', () => {
    const report = buildPaperReport({ ...input(), signals: [], events: [input().events[0]!] });
    expect(report.firstDay).toBeNull();
    expect(report.tradesMatch).toBe(true);
    expect(formatPaperReport(report)).toContain('No runs yet');
  });
});

describe('formatPaperReport', () => {
  it('reads as a summary', () => {
    const text = formatPaperReport(buildPaperReport(input()));
    expect(text).toContain('3 completed (1 late)');
    expect(text).toContain(`${day(126)}  BUY`);
    expect(text).toContain('Trades match the backtest');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/app/paperReport.test.ts`
Expected: FAIL — `src/app/paperReport.ts` does not exist.

- [ ] **Step 3: Create `src/app/paperReport.ts`**

```ts
import Decimal from 'decimal.js';
import { runBacktest } from '../backtest/engine.js';
import { DAY_MS, isoDate } from '../engine/cycleDate.js';
import type { LedgerEvent } from '../ledger/ledger.js';
import type { Candle, CostModel, StrategyFn } from '../types.js';

export type ReportInput = {
  userId: string;
  /** The user's ledger events. */
  events: LedgerEvent[];
  /** Every SIGNAL event. */
  signals: LedgerEvent[];
  holdings: { base: Decimal; quote: Decimal };
  price: Decimal;
  /** Closed daily candles covering the paper period and the strategy's warm-up before it. */
  candles: Candle[];
  strategy: StrategyFn;
  costs: CostModel;
};

export type ReportTrade = { day: string; side: string; qty: string; price: string };

export type PaperReport = {
  userId: string;
  openedAt: Date;
  startingQuote: Decimal;
  firstDay: string | null;
  lastDay: string | null;
  daysCompleted: number;
  daysLate: number;
  daysAbandoned: number;
  freezes: number;
  trades: ReportTrade[];
  value: Decimal;
  buyAndHold: Decimal | null;
  /** The backtest's trades over the same days, up to the day before the latest. */
  backtestTrades: Array<{ day: string; side: string }>;
  tradesMatch: boolean;
  signalsChecked: number;
  signalMismatches: string[];
};

/**
 * The paper account's record against buy-and-hold and against the backtest over
 * the same days. The latest day's trade fills at an open that is not yet a
 * closed candle, so trades are compared up to the day before the latest.
 */
export function buildPaperReport(input: ReportInput): PaperReport {
  const opened = input.events.find((e) => e.type === 'ACCOUNT_OPENED');
  if (opened === undefined) {
    throw new Error(`there is no ACCOUNT_OPENED event for "${input.userId}"`);
  }
  const startingQuote = new Decimal(String((opened.payload.balances as Record<string, unknown> | undefined)?.USDT ?? '0'));

  const signals = input.signals.filter(
    (s): s is LedgerEvent & { cycleDate: string } => s.cycleDate !== null && s.occurredAt >= opened.occurredAt,
  );
  const firstDay = signals[0]?.cycleDate ?? null;
  const lastDay = signals[signals.length - 1]?.cycleDate ?? null;

  const trades = input.events
    .filter((e) => e.type === 'ORDER_RESULT' && e.payload.status === 'FILLED')
    .map((e) => ({
      day: e.cycleDate ?? '?',
      side: String(e.payload.side),
      qty: String(e.payload.filledBaseQty),
      price: String(e.payload.avgPrice),
    }));
  const count = (type: string, when: (e: LedgerEvent) => boolean = () => true) =>
    input.events.filter((e) => e.type === type && when(e)).length;

  const value = input.holdings.quote.plus(input.holdings.base.times(input.price));
  const firstClose = signals[0] === undefined ? null : new Decimal(String(signals[0].payload.close));
  const buyAndHold = firstClose === null ? null : startingQuote.div(firstClose).times(input.price);

  const signalMismatches: string[] = [];
  let backtestTrades: Array<{ day: string; side: string }> = [];
  if (firstDay !== null && lastDay !== null) {
    const indexOf = new Map(input.candles.map((c, i) => [isoDate(c.time), i]));
    for (const signal of signals) {
      const i = indexOf.get(signal.cycleDate);
      if (i === undefined) {
        signalMismatches.push(`${signal.cycleDate}: no candle to check it against`);
        continue;
      }
      const expected = input.strategy(input.candles.slice(0, i + 1));
      if (expected !== signal.payload.target) {
        signalMismatches.push(`${signal.cycleDate}: recorded ${String(signal.payload.target)}, but the strategy gives ${expected}`);
      }
    }
    const window = input.candles.filter((c) => c.time <= Date.parse(`${lastDay}T00:00:00Z`));
    const evaluateFrom = Date.parse(`${firstDay}T00:00:00Z`) + DAY_MS;
    if (window.length > 0 && window[window.length - 1]!.time >= evaluateFrom) {
      backtestTrades = runBacktest(window, input.strategy, input.costs, startingQuote, 'backtest', { evaluateFrom }).trades.map(
        (t) => ({ day: isoDate(t.time - DAY_MS), side: t.side }),
      );
    }
  }
  const comparable = trades.filter((t) => lastDay !== null && t.day < lastDay).map((t) => ({ day: t.day, side: t.side }));

  return {
    userId: input.userId,
    openedAt: opened.occurredAt,
    startingQuote,
    firstDay,
    lastDay,
    daysCompleted: count('RUN_COMPLETED'),
    daysLate: count('RUN_COMPLETED', (e) => e.payload.late === true),
    daysAbandoned: count('RUN_ABANDONED'),
    freezes: count('FROZEN'),
    trades,
    value,
    buyAndHold,
    backtestTrades,
    tradesMatch: JSON.stringify(comparable) === JSON.stringify(backtestTrades),
    signalsChecked: signals.length,
    signalMismatches,
  };
}

export function formatPaperReport(report: PaperReport): string {
  const lines = [
    `Paper account "${report.userId}", opened ${report.openedAt.toISOString().slice(0, 10)} with ${report.startingQuote.toFixed()} USDT.`,
  ];
  if (report.firstDay === null) {
    lines.push('No runs yet.');
    return lines.join('\n');
  }
  lines.push(
    `Runs from ${report.firstDay} to ${report.lastDay}: ${report.daysCompleted} completed (${report.daysLate} late), ${report.daysAbandoned} abandoned, ${report.freezes} freezes.`,
    `Trades: ${report.trades.length}`,
    ...report.trades.map((t) => `  ${t.day}  ${t.side.padEnd(4)}  ${t.qty} BTC at ${t.price}`),
    `Value now: ${report.value.toFixed(2)} USDT.`,
    report.buyAndHold === null ? '' : `Buy and hold since the first run: ${report.buyAndHold.toFixed(2)} USDT.`,
    report.tradesMatch
      ? `Trades match the backtest over the same days (${report.backtestTrades.length} compared).`
      : `TRADES DIFFER from the backtest. Backtest: ${JSON.stringify(report.backtestTrades)}`,
    report.signalMismatches.length === 0
      ? `Signals match the strategy on all ${report.signalsChecked} days.`
      : `SIGNALS DIFFER on ${report.signalMismatches.length} days:\n  ${report.signalMismatches.join('\n  ')}`,
  );
  return lines.filter((line) => line !== '').join('\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/app/paperReport.test.ts`
Expected: PASS.

- [ ] **Step 5: Create `src/cli/paper-report.ts`**

```ts
import Decimal from 'decimal.js';
import { buildPaperReport, formatPaperReport } from '../app/paperReport.js';
import { midPrice } from '../market/orderBook.js';
import { runCli } from './context.js';
import { openEngine, SYMBOL } from './engineContext.js';

await runCli(async () => {
  const engine = await openEngine();
  try {
    const { userId } = engine.config;
    const balances = await engine.paperAccount(userId).getBalances();
    const coin = (name: string) => balances.find((b) => b.coin === name)?.walletBalance ?? new Decimal(0);
    const report = buildPaperReport({
      userId,
      events: await engine.ledger.forUser(userId),
      signals: await engine.ledger.ofType('SIGNAL', null),
      holdings: { base: coin('BTC'), quote: coin('USDT') },
      price: midPrice(await engine.market.getOrderBook(SYMBOL)),
      candles: await engine.market.getClosedDailyCandles(SYMBOL, 1000, Date.now()),
      strategy: engine.deps.strategy,
      costs: { feeRate: engine.config.paperFeeRate, slippageRate: new Decimal('0.0001') },
    });
    console.log(formatPaperReport(report));
    return report.tradesMatch && report.signalMismatches.length === 0 ? 0 : 1;
  } finally {
    await engine.close();
  }
});
```

- [ ] **Step 6: Add the script to `package.json`**

After `"alerts:test": "tsx src/cli/alerts-test.ts",` add:

```json
    "paper:report": "tsx src/cli/paper-report.ts",
```

- [ ] **Step 7: Typecheck, run the suite, and commit**

Run: `npm run typecheck && npm test`
Expected: PASS.

```bash
git add src/app/paperReport.ts src/cli/paper-report.ts tests/app/paperReport.test.ts package.json
git commit -m "feat: report the paper account against buy-and-hold and the backtest"
git push
```

---

## Task 20: systemd units and the VPS runbook

**Files:**
- Create: `deploy/systemd/crypto-autotrader-cycle.service`, `deploy/systemd/crypto-autotrader-cycle.timer`, `docs/deploy-vps.md`

- [ ] **Step 1: Create `deploy/systemd/crypto-autotrader-cycle.service`**

```ini
[Unit]
Description=crypto-autotrader: one engine tick (paper trading)
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
User=autotrader
Group=autotrader
WorkingDirectory=/opt/crypto-autotrader
ExecStart=/usr/bin/npm run --silent cycle
# systemd applies no start timeout to oneshot services by default, and a hung
# tick would hold the database lock and silently lose the day. The command
# stops itself after 5 minutes; this is the outer bound.
TimeoutStartSec=10min
NoNewPrivileges=true
PrivateTmp=true
```

- [ ] **Step 2: Create `deploy/systemd/crypto-autotrader-cycle.timer`**

```ini
[Unit]
Description=crypto-autotrader: a tick every 15 minutes

[Timer]
# 2, 17, 32, and 47 minutes past every hour: the first tick after the daily
# close is two minutes after it.
OnCalendar=*:02/15
# A tick missed while the machine was off runs at boot.
Persistent=true
AccuracySec=30s

[Install]
WantedBy=timers.target
```

- [ ] **Step 3: Create `docs/deploy-vps.md`**

````markdown
# Deploying the paper-trading engine to the VPS

Phase 2 runs `npm run cycle` every 15 minutes under systemd, trading a paper account on Bybit's
live prices. This runbook assumes Ubuntu 22.04 or 24.04 and a login with `sudo`.

**Secrets.** The Telegram bot token and the Healthchecks.io URL are typed by the founder, on the
VPS, into `.env.local`. They never go into a chat, a commit, or a shared document.

## 1. Check the VPS can reach Bybit

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://api.bybit.com/v5/market/time
curl -s -o /dev/null -w "%{http_code}\n" https://api.bytick.com/v5/market/time
```

At least one must print `200`. If both print `403`, Bybit refuses this server's address range —
it refuses US addresses and some cloud providers. Stop here: the engine needs a VPS in another
region or with another provider.

## 2. Install Node 24 and git

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git
node --version
```

Expect `v24`.

## 3. Create the engine's user and directory

```bash
sudo useradd --system --create-home --shell /bin/bash autotrader
sudo mkdir -p /opt/crypto-autotrader
sudo chown autotrader:autotrader /opt/crypto-autotrader
```

## 4. Get the code

The repository is private, so the VPS gets a read-only deploy key.

```bash
sudo -u autotrader mkdir -p /home/autotrader/.ssh
sudo -u autotrader ssh-keygen -t ed25519 -N "" -f /home/autotrader/.ssh/github_deploy -C "crypto-autotrader VPS"
sudo cat /home/autotrader/.ssh/github_deploy.pub
```

On GitHub, open the repository's **Settings → Deploy keys → Add deploy key**, paste the printed
public key, and leave **Allow write access unticked**. A public key is not a secret.

```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/github_deploy\n  IdentitiesOnly yes\n' | sudo -u autotrader tee /home/autotrader/.ssh/config
sudo -u autotrader chmod 600 /home/autotrader/.ssh/config
sudo -u autotrader git clone git@github.com:spade-codee/crypto-autotrader.git /opt/crypto-autotrader
cd /opt/crypto-autotrader
sudo -u autotrader git checkout phase-2-paper-engine
sudo -u autotrader npm ci
```

When asked to trust `github.com`, compare the fingerprint with the ones GitHub publishes under
*GitHub's SSH key fingerprints*, then type `yes`. `npm ci` must include development dependencies:
the commands run through `tsx`. Do not set `NODE_ENV=production`.

## 5. Settings — the founder types these

```bash
sudo -u autotrader nano /opt/crypto-autotrader/.env.local
```

```
TRADING_MODE=paper
TELEGRAM_BOT_TOKEN=the token from @BotFather
TELEGRAM_CHAT_ID=your chat ID
HEALTHCHECK_URL=the ping URL from Healthchecks.io
```

```bash
sudo chmod 600 /opt/crypto-autotrader/.env.local
```

## 6. First run, by hand

```bash
cd /opt/crypto-autotrader
sudo -u autotrader npm run alerts:test
sudo -u autotrader npm run paper:init -- --usdt 1000
sudo -u autotrader npm run cycle
sudo -u autotrader npm run status
```

The test alert and the tick's summary should both arrive in Telegram.

## 7. Install the timer

```bash
sudo cp deploy/systemd/crypto-autotrader-cycle.service deploy/systemd/crypto-autotrader-cycle.timer /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/crypto-autotrader-cycle.service /etc/systemd/system/crypto-autotrader-cycle.timer
sudo systemctl daemon-reload
sudo systemctl enable --now crypto-autotrader-cycle.timer
systemctl list-timers crypto-autotrader-cycle.timer
```

`systemd-analyze verify` must print nothing. `list-timers` shows the next tick.

## 8. Watching it

| To | Run, from `/opt/crypto-autotrader` |
|---|---|
| See recent ticks | `journalctl -u crypto-autotrader-cycle -n 50 --no-pager` |
| See the account | `sudo -u autotrader npm run status` |
| Compare with the backtest | `sudo -u autotrader npm run paper:report` |

## 9. Updating

Stop the timer first, so no tick runs while `npm ci` replaces the dependencies.

```bash
sudo systemctl stop crypto-autotrader-cycle.timer
cd /opt/crypto-autotrader
sudo -u autotrader git pull --ff-only
sudo -u autotrader npm ci
sudo systemctl start crypto-autotrader-cycle.timer
```

A tick missed while stopped runs as soon as the timer starts.

## 10. Stopping

| To stop | Do |
|---|---|
| One account | `sudo -u autotrader npm run pause -- --reason "why"` |
| All trading, at once | `sudo -u autotrader npm run kill-switch -- on --reason "why"`, or `sudo -u autotrader touch /opt/crypto-autotrader/data/KILL_SWITCH` |
| The engine itself | `sudo systemctl disable --now crypto-autotrader-cycle.timer` |

A frozen account restarts only with `npm run unfreeze -- --reason "what you found"`.

## 11. Healthchecks.io

Create one check: **Simple** schedule, period **1 day**, grace **2 hours**. Its ping URL is
`HEALTHCHECK_URL`. Under **Integrations**, add Telegram or email, so a missed day reaches you.

To prove the alert path, create a temporary second check with a 1-minute period and 1-minute
grace, ping it once with `curl -fsS` and its URL, wait three minutes for its "down" alert, then
delete it.
````

- [ ] **Step 4: Commit**

```bash
git add deploy docs/deploy-vps.md
git commit -m "docs: add the systemd units and the VPS runbook"
git push
```

---

## Task 21: Founder setup and deployment

**This task is the founder's.** It needs a Telegram bot token and a Healthchecks.io URL, which are secrets. The executing agent explains each step and checks outputs the founder shares, but never asks for, sees, or types a token, a URL, or a password.

- [ ] **Step 1: The founder creates the Telegram bot**

1. In Telegram, message **@BotFather**, send `/newbot`, and follow the prompts. It replies with the bot's token.
2. Send any message to the new bot.
3. In a browser, open `https://api.telegram.org/bot` followed by the token and `/getUpdates`. The number after `"chat":{"id":` is the chat ID.

- [ ] **Step 2: The founder creates the Healthchecks.io check**

As in section 11 of `docs/deploy-vps.md`: a free account, one check with a 1-day period and 2 hours' grace, and a Telegram or email integration.

- [ ] **Step 3: Deploy, following `docs/deploy-vps.md` sections 1 to 7**

If section 1 fails with `403` on both hosts, stop and report it: Phase 2 cannot run on that VPS, and the choice of VPS goes back to the founder.

**If the founder wants the agent to drive the deployment over SSH:** the founder creates a key pair for this purpose, adds its public key to the VPS login's `~/.ssh/authorized_keys`, and either runs the `sudo` lines themselves or grants that login passwordless `sudo`. The agent never types a password. Section 5, `.env.local`, is always typed by the founder.

- [ ] **Step 4: Prove alerts and the heartbeat**

1. `npm run alerts:test` on the VPS delivers a Telegram message.
2. The temporary one-minute check from section 11 raises its "down" alert.
3. After the first timed tick, `journalctl -u crypto-autotrader-cycle -n 20 --no-pager` shows it, and Healthchecks.io shows the main check as up.

- [ ] **Step 5: Record the deployment**

Append to this plan's execution notes: the VPS provider and region, which Bybit host answered, the Node version, the date and time of the first timed tick, and anything that differed from the runbook — along with the fix. Record no secret.

```bash
git add docs/superpowers/plans/2026-09-22-phase-2-paper-engine.md
git commit -m "docs: record the Phase 2 deployment"
git push
```

---

## Task 22: Update the handoff documents

**Files:**
- Modify: `docs/stack-and-setup.md`, `CLAUDE.md`, this plan

- [ ] **Step 1: `docs/stack-and-setup.md`**

Replace the `Jobs / scheduling` row of the stack table with:

```markdown
| Jobs / scheduling | A one-shot command on a `systemd` timer; `pg-boss` only if Phase 4's load needs a queue | Nothing runs between ticks, so nothing can hang or leak. systemd survives crashes and reboots, catches up missed runs, and every run is recorded in the ledger. In-process `node-cron` stays disqualified: it dies with the process and leaves no record. See `docs/decisions.md` #22 |
```

- [ ] **Step 2: `CLAUDE.md`**

1. In the *Current state* table, replace the Phase 2 row with:

```markdown
| Phase 2 — paper-trading engine | **Code complete** on branch `phase-2-paper-engine`, N tests. Paper trading on the VPS since YYYY-MM-DD; the phase completes after 14 clean days (spec section 12) |
```

filling in the test count from `npm test` and the date of the first timed tick.

2. Replace the paragraph that begins **Phase 2 is designed on branch** with:

```markdown
**Phase 2 runs on the VPS from branch `phase-2-paper-engine`**: the daily engine, trading a paper
account on live Bybit prices. Spec: `docs/superpowers/specs/2026-09-22-phase-2-paper-engine-design.md`.
Plan: `docs/superpowers/plans/2026-09-22-phase-2-paper-engine.md` — read its execution notes.
Runbook: `docs/deploy-vps.md`. **Merge order:** `phase-1-exchange-adapter`, then
`research-robustness`, then `phase-2-paper-engine`.
```

3. In the *Running the code* table, add after the `balance` row:

```markdown
| `npm run paper:init` | Open the paper account. `-- --usdt 1000` sets the starting balance |
| `npm run cycle` | One engine tick: what the systemd timer runs every 15 minutes |
| `npm run status` | Account state, balances, today's signal and run, the kill switch |
| `npm run pause` / `resume` | Stop or restart trading on the account |
| `npm run unfreeze` | Lift a freeze. `-- --reason "what you found"` is required |
| `npm run kill-switch` | `-- on --reason "why"` halts all trading; `-- off` resumes |
| `npm run alerts:test` | Send a test Telegram alert |
| `npm run paper:report` | The paper account against buy-and-hold and against the backtest |
```

and, after the paragraph listing the key commands' settings, add:

```markdown
The engine commands also read `TRADING_MODE` (required; only `paper` exists in Phase 2),
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, `HEALTHCHECK_URL`, `KILL_SWITCH_FILE` (default
`data/KILL_SWITCH`), `PAPER_FEE_RATE` (default `0.001`), and `MAX_ORDER_USDT` (unset). Every
command that opens the database holds a lock beside it, `data/db.lock`: PGlite must never be
opened by two processes at once.
```

4. In the repository layout block, replace the `src/` lines from `app/credentials.ts` to `cli/` with:

```
  app/credentials.ts          connect, check, and balance flows
  app/paperReport.ts          the paper account against buy-and-hold and the backtest
  market/                     Bybit public data: candles, order book, ticker, trading rules
  engine/                     the daily tick: candle window, sizing, Risk Guard, reconciliation, order IDs
  paper/                      the paper account and order-book fills
  ledger/                     the append-only ledger
  state/                      account state, per-day runs, alerts already sent
  alerts/                     Telegram alerts and the Healthchecks.io heartbeat
  ops/                        the kill switch and the database lock
  cli/                        every command, including the engine's
deploy/systemd/               the engine's service and timer
```

and add `docs/deploy-vps.md` to the `docs/` lines as `deploy-vps.md               the VPS runbook`.

- [ ] **Step 3: This plan's execution notes**

Append a section `## Execution notes — <date>` recording every place the code deliberately differs from this plan, and why.

- [ ] **Step 4: Commit**

```bash
git add docs/stack-and-setup.md CLAUDE.md docs/superpowers/plans/2026-09-22-phase-2-paper-engine.md
git commit -m "docs: update the handoff documents for Phase 2"
git push
```

---

## Task 23: Fourteen days of paper trading, and completion

Spec section 12 defines when Phase 2 is complete. This task checks it.

- [ ] **Step 1: Let it run**

Fourteen consecutive days on the VPS. Each day must be either completed or explicitly alerted — a freeze, an abandoned day, a Healthchecks.io alert — with the cause understood. Every freeze is investigated before it is lifted, and the reason given to `npm run unfreeze` says what was found.

- [ ] **Step 2: Run the report**

On the VPS: `sudo -u autotrader npm run paper:report`

Expected: exit code 0, `Trades match the backtest`, and `Signals match the strategy`.

- [ ] **Step 3: Record the result in the spec**

Append to `docs/superpowers/specs/2026-09-22-phase-2-paper-engine-design.md`:

```markdown
## 15. Verified on the VPS

- **Period:** YYYY-MM-DD to YYYY-MM-DD, N days.
- **Days:** N completed (N late), N abandoned.
- **Freezes:** N — each with its cause and what was done.
- **Report:** trades and signals matched the backtest over the same days, or what differed and why.
- **Anything unexpected**, and its fix.
```

- [ ] **Step 4: Commit, and merge once the earlier branches are in**

```bash
git add docs/superpowers/specs/2026-09-22-phase-2-paper-engine-design.md
git commit -m "docs: record fourteen days of paper trading"
git push
```

Merge `phase-2-paper-engine` into `master` only after `phase-1-exchange-adapter` and `research-robustness` are merged, in that order. Never force-push. Paper trading then continues toward the parent spec's 2–4 weeks while Phase 2b — real orders on Bybit — is built.

---

## Execution notes — 2026-09-22

Tasks 1 to 20 and 22 were executed inline on 2026-09-22, one commit per task, each pushed. The
suite grew from 173 tests to 455, and typecheck is clean. **Task 21 (deployment) and Task 23 (the
fourteen days) are the founder's and have not started**, so the handoff documents describe the
engine as code complete and awaiting deployment.

### Where the work differs from the plan

- **Task 16 — the parity fixture** was cut from the existing `data/BTCUSDT-spot-1d.csv`, fetched
  2026-09-17, instead of a fresh `npm run fetch`: 2023–2024 are closed candles and cannot change.
  The throwaway script ran from outside the repository. It wrote the expected 731 candles.
- **Tasks 18 and 19 — the smoke tests** used a scratch database outside the repository rather
  than `data/smoke-db`, so nothing could be committed by accident. They ran from a machine in
  Nigeria, where `api.bybit.com` does not resolve, so the host fallback carried every request.
  Every command behaved as Step 10 expects. `paper:report` was also run live, which the plan did
  not require.
- **Task 20 — the runbook** gained three notes: the engine needs outbound HTTPS only and opens no
  port; section 9 waits for a running tick before `npm ci`, because stopping the timer does not
  stop a tick in progress; section 11 warns that no heartbeat is sent while the kill switch is
  on, so Healthchecks.io reports the engine down.
- **Task 22 — `CLAUDE.md`** also corrects its opening paragraph, which still said no
  order-placing code existed: paper orders now exist, real ones do not. It adds the deployment to
  the founder's list and records the older machine's Node version, v20.20.2.

### Verification beyond the plan's steps

- **The visibility rule has teeth.** A deliberate mutation — treating `NOT_VISIBLE` as proof of
  absence, the "time plus an empty lookup" rule the founder rejected — made three scenarios fail:
  the retry-after-proven-absence test, the delayed-visibility test, and the invisible-for-an-hour
  freeze. The code was restored byte for byte.
- **Parity, in figures.** On 731 real candles, all 606 daily signals and all 19 trades match the
  backtest by day and direction, at identical fill prices. Final equity is 2,285.52 USDT against
  the backtest's 2,286.61, a gap of 0.048%. Quantities differ slightly by design: the engine pays
  the buy fee in BTC, as Bybit does, and keeps 0.1% of the USDT back on every buy.
- **Live smoke test.** The first tick bought 0.01161 BTC at 86,045.90 for 998.99 USDT, and was
  recorded as late — correctly, since it ran 8 hours 46 minutes after the daily close.

### Code review of the implementation — 2026-09-22

A review found six defects before deployment. Each was reproduced, fixed at its cause, and given
regression tests; the suite grew from 455 tests to 508. Where a test first passed, a planted
defect proved it could fail.

1. **Stale-lock takeover race** (`src/ops/lock.ts`). The file lock read a dead holder's PID, then
   deleted the lock file by path; a deterministic reproduction had a second contender take over
   inside that gap, leaving two holders. Accepting this as a limitation, as the notes above first
   did, was wrong. The lock is now a name the operating system owns — a named pipe on Windows, an
   abstract socket on Linux — freed the moment its holder exits, so there is no stale lock and no
   takeover. Tests: `tests/ops/lock.test.ts`, including four processes racing for a holder killed
   with SIGKILL, each proving it held the lock alone.
2. **The key commands bypassed the lock** (`src/cli/context.ts`). `openDatabase(dir)` now takes
   the lock, named for the canonical directory, releases it only after the database has closed,
   and is the only way to open a database on disk; tests use `openMemoryDatabase()`. Tests:
   `tests/cli/databaseLock.test.ts` and `tests/db/client.test.ts`.
3. **The kill switch could be missed** (`src/engine/cycle.ts`). It was read before awaiting the
   ticker. It is now read after every awaited request and again at the submission boundary, and
   it stops a run without freezing it. Tests: "the kill switch, turned on during a run" in
   `tests/engine/cycleFailures.test.ts`.
4. **The paper account missed instrument limits** (`src/paper/paperAccount.ts`). It now enforces
   `maxMarketOrderQty`, `minOrderQty`, and `minOrderAmt` on what it would actually execute
   against its own book. Tests: the limit and boundary cases in `tests/paper/paperAccount.test.ts`,
   and "when the market moves between the Risk Guard and the fill" in the engine's failure tests.
5. **Signed requests reused expired headers on the fallback host** (`src/exchange/bybit/client.ts`,
   `src/net/http.ts`). Every host attempt is now signed as it is sent, and the clock offset is
   timed on the attempt that answered — a stalled primary had also shifted it five seconds.
   Tests: `tests/exchange/bybit/client.test.ts` and `tests/net/http.test.ts`.
6. **Order books lost their market and timestamp** (`src/market/bybitPublic.ts`,
   `src/market/orderBook.ts`). The parser now requires the requested symbol, a valid timestamp,
   and positive prices and sizes; the engine and the paper account refuse a book more than 5
   seconds old or 2 seconds ahead of the clock. Tests: `tests/market/`, "order books that cannot
   be trusted" in the engine's failure tests, and the stale and wrong-market cases in the paper
   account's tests.

### Known limitations, accepted for Phase 2

- **The lock is proven on Windows only, so far.** Its Linux form, an abstract socket, runs the
  same code with a different address; `docs/deploy-vps.md` has `npm test` run on the VPS before
  deployment to prove it there. The lock refuses to run on other systems, such as macOS.
- **Any local process could claim the lock's name first**, since abstract sockets have no
  permissions. The engine would then wait, fail, and alert through the missing heartbeat. The VPS
  has no other users, so this is accepted.
- **A key command holds the lock while the founder types a key.** `key:add` opens the database
  before prompting, so a tick that starts meanwhile waits up to 60 seconds, then exits and runs
  again 15 minutes later. No key is used on the VPS in Phase 2.
- **Tiny decimals in ledger payloads use exponent notation.** `Decimal#toJSON` writes values
  below 1e-7 as, for example, `2.99e-7`. They stay exact and parse back unchanged, and no
  realistic BTC order reaches that range, since Bybit's minimum order is 5 USDT.
- **A frozen day's `cycle_runs` row stays `frozen`** after the account is unfrozen on a later
  day: only pending runs are abandoned. Trading is unaffected, and the report reads the ledger.
- **`paper_orders.created_at` uses the wall clock**, not the engine's clock. Nothing reads it.

# Phase 2 — Paper-trading engine: design

- **Date:** 2026-09-22
- **Status:** approved by the founder, 2026-09-22. Implementation plan:
  `docs/superpowers/plans/2026-09-22-phase-2-paper-engine.md`
- **Revised:** 2026-09-22, after a design review: outstanding orders are resolved across days,
  exposure counts locked funds, every request and every tick has a deadline, and the whole candle
  window is validated. A second pass the same day separated inconclusive order lookups from
  confirmed non-submission, and gave every retry its own client order ID (section 4.2). A third
  made non-submission something only the exchange adapter can prove: elapsed time and an empty
  lookup never authorize a new order
- **Parent spec:** `2026-09-16-crypto-trading-automation-design.md` — sections 4 to 7, and 9
- **Builds on:** Phase 1 (`2026-09-17-phase-1-exchange-adapter-design.md`) and the robustness
  research (`docs/research/phase-0-findings.md`)
- **Branch:** `phase-2-paper-engine`, created from `research-robustness`. Merge order:
  `phase-1-exchange-adapter`, then `research-robustness`, then this branch.

## 1. Goal

Run the complete execution cycle unattended on the VPS every day, against a **paper account that
fills on live Bybit prices**, for the 2–4 weeks of paper trading the parent spec's testing stage 3
requires. No Bybit key is needed, so this phase is not blocked by the key problems recorded in
`docs/decisions.md` #8.

It must produce two kinds of evidence: that the live pipeline makes **exactly the decisions the
backtest makes**, and how it behaves when things go wrong.

### In scope

- Live market data from Bybit's public API: closed daily candles, the order book, the last trade,
  and the instrument's trading rules.
- A `TradingAccount` interface, and a paper implementation of it.
- Sizing, the Risk Guard, reconciliation, and deterministic client order IDs.
- The append-only ledger, account state (active, paused, frozen), and per-day run records.
- The daily cycle, with catch-up, crash recovery, and abandonment.
- Freeze and unfreeze, pause and resume, and a file-based kill switch.
- Telegram alerts and a Healthchecks.io heartbeat.
- A systemd service and timer, and the commands to operate everything.

### Out of scope, and where it goes

| Item | Goes to |
|---|---|
| Placing real orders on Bybit — the Bybit implementation of `TradingAccount` | **Phase 2b**, once a key exists |
| Onboarding, a dashboard, an admin UI, more than one real user | Phase 4 |
| Production Postgres, a compiled build | Phase 3 |
| A job queue such as `pg-boss` | Phase 4, if multi-user load calls for it |
| Any asset except BTC | `docs/decisions.md` #21 |

## 2. Decisions

Made with the founder on 2026-09-22:

| Decision | Choice | Why |
|---|---|---|
| How much money the strategy controls | **The whole of a dedicated account**, ideally a Bybit sub-account. Every BTC and USDT in it belongs to the strategy | The exchange stays the single source of truth, and it is exactly what the backtest tested: all in or all out. Tracking a slice inside a shared account would make our database the source of truth, the pattern that double-buys after a partial failure |
| A run that cannot happen on time | **Catch up as soon as possible**, any time before the next daily close. After that it is abandoned | Skipping usually means trading 24 hours late, since the next day's signal is normally the same. A few hours late is closer to what the backtest tested |
| Who lifts a freeze | **Only the founder**, with a reason that is recorded | A freeze means the engine does not understand what happened, which is exactly when it must not act alone |
| How the engine runs | **A one-shot command on a systemd timer** every 15 minutes | Nothing runs between ticks, so nothing can hang or leak. systemd survives crashes and reboots and catches up missed runs, and every run is recorded — which answers the stack document's objection to in-process timers. It also suits PGlite, which must only ever be opened by one process |

Design defaults, which are not founder decisions: the paper account starts with **1,000 USDT**, the
same as the backtest; orders are market orders; at most **one order per account per day**.

## 3. Architecture

Dependencies point one way: `cli → engine → (market, trading, ledger, state, alerts, ops) → (net, db)`.
The strategy is untouched: the engine calls `trendFilter({ maPeriod: CHOSEN_MA_PERIOD })`, the
same function and constant the backtest uses.

| File | Responsibility |
|---|---|
| `src/market/bybitPublic.ts` | Closed daily candles, order book, ticker, instrument rules. Public mainnet endpoints through `getJson` with host fallback; reuses `fetchDailyCandles` and `closedCandles` |
| `src/exchange/trading.ts` | `TradingAccount` interface and its types |
| `src/paper/fill.ts` | Pure: fill a market order against an order book |
| `src/paper/paperAccount.ts` | `PaperAccount`, which implements `TradingAccount`; its state lives in `paper_balances` and `paper_orders` |
| `src/engine/candleWindow.ts` | Pure: is a candle window long enough, current, ordered, consecutive, and valid? |
| `src/engine/cycleDate.ts` | Pure: which daily candle a moment belongs to, when a run is due, late, or abandoned |
| `src/engine/sizing.ts` | Pure: target and balances in, the one order needed out, or none |
| `src/engine/reconcile.ts` | Pure: does an account match a target? |
| `src/engine/riskGuard.ts` | Pure: approve an order, or veto it with every failed rule listed |
| `src/engine/orderId.ts` | Pure: deterministic client order IDs |
| `src/engine/cycle.ts` | One tick, orchestrating everything above through injected dependencies |
| `src/ledger/ledger.ts` | Append events; read a user's events for a day |
| `src/state/accountState.ts` | Account status, and the `cycle_runs` records |
| `src/ops/killSwitch.ts` | Is the kill-switch file present? |
| `src/ops/lock.ts` | The exclusive lock every database-opening command holds |
| `src/alerts/telegram.ts`, `src/alerts/heartbeat.ts` | `Alerter` and `Heartbeat`, each with a log-only fallback when not configured |
| `src/cli/*` | `cycle`, `paper-init`, `status`, `pause`, `resume`, `unfreeze`, `kill-switch`, `paper-report` |
| `deploy/systemd/` | `crypto-autotrader-cycle.service` and `.timer` |
| `src/net/http.ts` | Modified: every request gets a deadline |
| `drizzle/0001_*.sql` | The new tables |

### The trading interface

```ts
export type InstrumentRules = {
  symbol: string;              // 'BTCUSDT'
  baseCoin: string;            // 'BTC'
  quoteCoin: string;           // 'USDT'
  basePrecision: Decimal;      // quantity step, live value 0.000001
  quotePrecision: Decimal;     // quote amount step, live value 0.0000001
  minOrderQty: Decimal;        // live value 0.000001
  minOrderAmt: Decimal;        // minimum order value in USDT, live value 5
  maxMarketOrderQty: Decimal;  // live value 120
};

export type MarketOrderRequest =
  | { clientOrderId: string; symbol: string; side: 'BUY'; quoteAmount: Decimal }
  | { clientOrderId: string; symbol: string; side: 'SELL'; baseQty: Decimal };

export type OrderStatus = 'FILLED' | 'PARTIALLY_FILLED_CANCELLED' | 'REJECTED' | 'PENDING';

export type OrderState = {
  clientOrderId: string;
  status: OrderStatus;
  filledBaseQty: Decimal;
  filledQuoteAmount: Decimal;
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

export interface TradingAccount {
  getBalances(): Promise<CoinBalance[]>;      // the Phase 1 type
  placeMarketOrder(order: MarketOrderRequest): Promise<OrderState>;
  getOrder(clientOrderId: string): Promise<OrderLookup>;
}
```

A buy names the USDT to spend and a sell names the BTC to sell — the same convention as Bybit's
spot market orders, so the Bybit implementation in Phase 2b maps onto it directly.

## 4. One tick

The timer fires at 2, 17, 32, and 47 minutes past every hour. The first tick after the daily close
is therefore 00:02 UTC (01:02 in Lagos), two minutes after the candle closes.

**Definitions.** A candle's `time` is its open time. At any moment `now`, the most recently closed
daily candle opened at `cycleDate(now)` = the start of `now`'s UTC day, minus one day. A run for
that cycle date is **due** at its close, `cycleDate + 1 day`. It is **late** if it completes more
than 30 minutes after it was due, and **abandoned** if it has not completed by the next close.

**Every tick:**

1. **Take the lock.** If another command holds it, wait up to 60 seconds, then exit. A lock left by
   a process that no longer exists is detected by its PID and removed.
2. **Kill switch.** If the file exists, record it once per day, alert once, and stop.
3. **Abandon stale runs.** Any `cycle_runs` row still `pending` for an earlier cycle date becomes
   `abandoned`, with an alert.
4. **Who needs a run?** Active users — not paused, not frozen — whose run for the current cycle
   date has not completed. If there are none, exit. This step touches no network, so every tick
   after the day's work is done costs almost nothing.
5. **Candles.** Fetch the last 250 closed daily candles and validate the whole window before
   using any of it (section 4.1). Invalid or stale data means try again at the next tick; the
   first failure of the day alerts.
6. **Signal.** Evaluate the strategy and record a `SIGNAL` event once per cycle date: the target,
   the close, and the moving average.
7. **Each user in turn**, as below.
8. **Finish.** When no user is left with a `pending` run for the current cycle date, ping the
   heartbeat. A freeze counts as handled, since it raises its own alert.

**For each user:**

1. **Resolve every outstanding order, from any day.** An `ORDER_INTENT` without a matching
   `ORDER_RESULT` is outstanding whatever its cycle date: an order sent at 23:50 and interrupted
   is still outstanding after midnight. For each, oldest first, ask the account for its client
   order ID and record exactly one `ORDER_RESULT` under the intent's own cycle date:
   - **found and settled:** record it. Anything but `FILLED` freezes the account;
   - **found and still pending:** an order is in flight, so do nothing more for this user this
     tick and try again at the next. One still pending an hour after its intent was recorded
     freezes the account;
   - **absent — the adapter proves the order does not exist:** confirmed non-submission, so
     record `NOT_PLACED`. Only the adapter's proof counts: elapsed time and an empty lookup
     never do;
   - **not visible — the adapter looked but cannot prove absence:** inconclusive. Record
     nothing, place nothing, and ask again at the next tick. One still not visible an hour
     after its intent freezes the account, for a person to check the exchange;
   - **the lookup fails or times out:** inconclusive. Record nothing; the intent stays
     outstanding, and the next tick asks again.

   The run goes on only when nothing is outstanding. If today's own order was among them and
   filled, go straight to step 7.
2. **Read balances** from the account. Any borrowing freezes the account. So does **locked BTC
   or USDT**: with every order of ours resolved, a lock can only come from an order the engine
   did not place, which means someone is trading the dedicated account by hand. Other coins are
   ignored.
3. **Size** the order (section 5). No order needed: go to step 7.
4. **Risk Guard** (section 6). A veto freezes the account.
5. **Record `ORDER_INTENT`**, then place the order. The intention is written first, so a crash
   between placing and recording is recovered by step 1, never repeated. **A placement that times
   out or fails without a definite answer is uncertain, not failed:** its intent stays
   outstanding, and step 1 of the next tick settles it through the client order ID.
6. **Record `ORDER_RESULT`.** Anything but `FILLED` freezes the account. A `PENDING` order is polled
   for up to 60 seconds; if it is still pending, its intent stays outstanding and step 1 of the
   next tick takes over. Paper orders never pend.
7. **Reconcile.** Re-read the balances. If the account matches the target, record `RECONCILED`,
   mark the run `completed`, flag it late if it was, and send the one-line summary. If not, freeze.

**Nothing can be bought twice.** Every order carries a deterministic client order ID, the
account rejects a repeated ID exactly as Bybit does, and at most one order a day can execute
(section 4.2).

### 4.1 A valid candle window

The strategy returns FLAT when it has too little history, so a truncated or corrupted fetch would
sell everything. Before the signal is computed, the window must pass every check:

- **Long enough:** at least `CHOSEN_MA_PERIOD` (125) candles.
- **Current:** the newest candle is the one for the current cycle date.
- **Ordered and unique:** open times strictly increase.
- **Consecutive:** each candle opens exactly one day after the one before it.
- **Valid prices:** every open, high, low, and close is finite and above zero; the low is at
  most the open and the close, and the high is at least both.

A failure is handled like stale data: try again at the next tick, and record the reason.

### 4.2 Client order IDs and retries

- **The ID is built from who, which day, what for, and which attempt:** `(user, cycle date,
  intent, attempt)`, hashed. Attempt 1 is the day's first order.
- **The attempt number comes from the ledger:** one more than the number of earlier intents for
  the same user, day, and intent. The ledger is append-only, so a tick that crashes before
  writing its intent recomputes the same attempt, and therefore the same ID.
- **The ledger rule:** each client order ID appears in exactly one `ORDER_INTENT` and, once
  settled, exactly one `ORDER_RESULT`. A retry never reuses an ID.
- **A retry needs proven non-submission.** Attempt *k + 1* is possible only when attempts 1
  to *k* were all recorded `NOT_PLACED`, and `NOT_PLACED` is recorded only when the adapter
  proves an order absent. Elapsed time and an empty lookup never authorize a new order ID.
  Any other result ends the day's ordering: `FILLED`
  goes to reconciliation, and anything else freezes the account. So at most one order a day
  can ever execute.
- **At most three attempts a day.** Needing a fourth freezes the account: orders are not
  reaching it, and a person should find out why.

**Why a new ID rather than the same one.** Reusing the ID would give it two intents and two
results. If the first attempt then turned up late, its fill could not be attributed to either.
A new ID keeps every order's history unambiguous. The protection it gives up — the exchange
refusing a repeated ID — is covered three ways: non-submission must be proven by the adapter, never inferred from time or an empty lookup;
sizing always reads real balances, so an order that did execute makes the account already at
its target; and the attempt cap bounds the worst case.

## 5. Sizing and reconciliation

Each coin has two views. `available(coin)`, the wallet balance minus the locked amount, is what
can be traded. `total(coin)`, the whole wallet balance, is what the account is exposed to. `P` is
the order book's mid price, and the account value is `V = total(USDT) + total(BTC) × P`.

**Orders are sized from available funds; being at the target is judged on totals**, so a lock can
never make an account look emptier than it is. Step 2 of section 4 freezes on any lock before
sizing, so the two views agree whenever an order is sized.

**Borrowing.** Any coin with a borrowed amount above zero freezes the account. The engine never
trades on borrowed funds; a Unified Trading Account can borrow automatically, so this is checked
every run.

**At the target** means the amount left in the wrong coin is too small to matter:

- LONG: `total(USDT) ≤ max(minOrderAmt, 0.5% × V)`
- FLAT: `total(BTC) × P ≤ max(minOrderAmt, 0.5% × V)`

The 0.5% tolerance absorbs rounding and the buy headroom below.

**The order**, when the account is not at the target:

- LONG: buy with `quoteAmount = roundDown(available(USDT) × 0.999, quotePrecision)`. The 0.1%
  headroom means an order can never exceed the available balance.
- FLAT: sell `baseQty = roundDown(available(BTC), basePrecision)`.

If the order would fall below `minOrderQty` or `minOrderAmt`, there is nothing to do. An account
too small to trade at all gets a notice, not a freeze.

**The invariant, tested:** after any successful order, the account is at the target.

## 6. Risk Guard

Every rule must pass. A failure vetoes the order and freezes the account, listing every rule that
failed.

1. **The kill switch is off** — checked again immediately before placing.
2. **The account is active** — not paused, not frozen.
3. **One executed order per account per day.** Every earlier intent for this account today was
   confirmed `NOT_PLACED`, and this is attempt 3 or earlier (section 4.2).
4. **Within the available balance.** A buy's USDT is at most `available(USDT)`; a sell's BTC is
   at most `available(BTC)`.
5. **Within the exchange's limits.** At least `minOrderQty` and `minOrderAmt`; at most
   `maxMarketOrderQty`.
6. **Within the optional cap.** If `MAX_ORDER_USDT` is set, the order's value is at most that. It is
   unset in Phase 2, and exists for Phase 3.
7. **Prices make sense:**
   - the order book is sane: best bid above zero, best ask above best bid, and a spread of at most
     0.5% of the mid;
   - two views agree: the mid is within 1% of the last traded price;
   - the price is not wildly off the signal: the mid is within 20% of the close the signal used.
     That catches a wrong symbol or a decimal-shift error, while leaving room for a late run
     during a real crash to still trade;
   - the book can take the order: walking it fills the whole order at an average within 1% of the
     mid.

## 7. The paper account

- **State:** `paper_balances` (user, coin, free amount) and `paper_orders` (one row per client
  order ID). Created by `npm run paper:init`, which also creates the user's `account_state` row as
  `active` — in this phase, that row is what makes someone a user. It refuses to overwrite an
  existing account.
- **Placing an order** behaves like Bybit's spot market orders:
  - a repeated client order ID is rejected;
  - an order breaking the instrument's rules or exceeding the free balance is rejected;
  - otherwise it fills against the **live** order book, fetched at that moment: a buy walks up the
    asks spending its USDT, a sell walks down the bids selling its BTC. If the book runs out, the
    order fills partially and the rest is cancelled.
- **Fees:** `PAPER_FEE_RATE`, default 0.1% — Bybit's spot taker fee. On a buy it comes off the BTC
  received; on a sell, off the USDT received.
- **Atomicity:** balance changes and the order row are written in one transaction.
- `getBalances` reports no locked and no borrowed amounts. `getOrder` reads `paper_orders` and
  answers `FOUND` or `ABSENT`, never `NOT_VISIBLE`: its database is the whole truth, and each
  order is written in the same transaction as its balances, so a missing row proves the order
  was never placed.

## 8. Ledger and state

All money is `Decimal` in code and `NUMERIC` in the database. In JSON payloads, decimals are
strings.

- **`ledger_events`** — append-only: id, time, user (null for events that concern everyone, such
  as `SIGNAL`), cycle date, type, payload. A database trigger rejects every `UPDATE`, `DELETE`,
  and `TRUNCATE`. Types: `ACCOUNT_OPENED`, `SIGNAL`, `ORDER_INTENT`, `ORDER_RESULT`, `RECONCILED`,
  `RUN_COMPLETED`, `RUN_FAILED`, `RUN_ABANDONED`, `FROZEN`, `UNFROZEN`, `PAUSED`, `RESUMED`,
  `KILL_SWITCH_SKIP`, `TOO_SMALL`. Each client order ID has exactly one `ORDER_INTENT` and, once
  settled, exactly one `ORDER_RESULT`, recorded under the intent's own cycle date. `NOT_PLACED`
  is recorded only for a confirmed non-submission.
- **`account_state`** — mutable, one row per user: `active`, `paused`, or `frozen`, with a reason.
  Every change is also written to the ledger.
- **`cycle_runs`** — mutable, one row per user and cycle date: status (`pending`, `completed`,
  `frozen`, `abandoned`), attempts, first attempt, completion time, whether it was late, the last
  error. A freeze during a run marks that day's row `frozen`; after an unfreeze, the next tick
  sets it back to `pending` and runs it. Only `pending` rows are ever abandoned. A user who is
  already paused or frozen when the day begins gets no row, just a daily reminder.
- **`alert_log`** — one row per alert already sent, keyed by day, user, and kind, so each alert
  goes out once rather than every 15 minutes.

## 9. When things go wrong

| Situation | What happens |
|---|---|
| Bybit unreachable, a server error, or a timeout **before** any order intent | Try again at the next tick. The first failure of the day alerts |
| Stale or invalid candles (section 4.1) | Try again at the next tick. The first failure of the day alerts |
| A request stalls | It is abandoned after 10 seconds and handled like any failed request |
| An unexpected error in our code **before** any order intent | Try again at the next tick, with an alert. Nothing has happened, so retrying is safe |
| A crash, or a placement that times out or gets no definite answer, **after** an order intent | **Uncertain, not failed.** The next tick settles it through the client order ID, even after midnight |
| An order still pending | Nothing more for that account until it settles. Still pending an hour after its intent: **freeze** |
| The adapter proves an order absent | Confirmed non-submission: record `NOT_PLACED`; a retry gets a new ID |
| The adapter cannot see an order, and cannot prove it absent | Inconclusive: nothing is recorded, and **no replacement is placed**. Still not visible an hour after its intent: **freeze**, for a person to check the exchange |
| An order lookup fails or times out | Inconclusive: nothing is recorded, the intent stays outstanding, and the next tick asks again |
| Orders keep failing to arrive | The fourth attempt in a day is vetoed and the account **frozen** |
| Locked BTC or USDT that is not one of our orders | **Freeze**: the dedicated account is being traded by hand |
| Risk Guard veto, rejected order, partial fill, reconciliation mismatch, or borrowing | **Freeze**, and alert |
| A frozen or paused account | Skipped every day, with a daily reminder, until the founder lifts it |
| Kill switch on | No trading for anyone; one alert per day |
| Still not completed at the next close | **Abandoned**, with an alert. The new day's run takes over, but only after any outstanding order from the abandoned day is settled and recorded |
| No successful run for a day, for any reason — including the VPS being off | Healthchecks.io alerts, independently of the engine |

**Unfreezing** records the founder's reason. If the day's run has not completed, the next tick runs
it, re-reading the balances first. **Alerts** never fail a run: if Telegram cannot be reached, the
message goes to the log.

## 10. Operations

- **systemd:** `crypto-autotrader-cycle.service` is `Type=oneshot` and runs `npm run --silent
  cycle` from the repository directory as a dedicated user. `crypto-autotrader-cycle.timer` uses
  `OnCalendar=*:02/15` and `Persistent=true`. systemd never starts a second copy while one is
  running, and the lock guards against a manual command overlapping a tick.
- **Deadlines.** Node's `fetch` otherwise waits up to five minutes for a stalled request, and
  systemd applies no start timeout to a oneshot service by default, so a hung tick could hold the
  lock and silently lose the day. Every request to Bybit is abandoned after 10 seconds, and every
  request to Telegram or Healthchecks.io after 5. A tick still running after 5 minutes exits with
  an error, and the unit's `TimeoutStartSec=10min` stops it if even that fails. A tick stopped
  part-way is safe to rerun: its intents are outstanding, and its lock is detected as stale.
- **Settings**, in `.env.local` or the environment:

| Setting | Default | Notes |
|---|---|---|
| `TRADING_MODE` | none — required | Only `paper` is accepted in this phase, so the mode is never implied |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | unset | Without them, alerts go to the log with a warning. The token is a `Secret` |
| `HEALTHCHECK_URL` | unset | A `Secret`, since anyone holding it can fake a heartbeat |
| `KILL_SWITCH_FILE` | `data/KILL_SWITCH` | |
| `PAPER_FEE_RATE` | `0.001` | |
| `MAX_ORDER_USDT` | unset | |
| `DB_DIR`, `USER_ID` | as in Phase 1 | The new tables share the Phase 1 database |

- **Commands:**

| Command | Does |
|---|---|
| `npm run paper:init` | Create the paper account. `--usdt` sets the starting balance, default 1,000 |
| `npm run cycle` | One tick — what the timer runs |
| `npm run status` | Account state, balances and value, the current signal, today's run, the kill switch |
| `npm run pause` / `resume` | Pause or resume an account |
| `npm run unfreeze` | Lift a freeze. Requires `--reason` |
| `npm run kill-switch` | `on` or `off` |
| `npm run paper:report` | The paper account over time, against buy-and-hold and against the backtest over the same days |

- **On the VPS:** Node 24, the repository, `npm ci`. Before anything else, confirm the VPS can reach
  Bybit's API (`curl -s -o /dev/null -w "%{http_code}" https://api.bybit.com/v5/market/time`
  returns `200`), because Bybit refuses some cloud and US address ranges. Phase 2 runs through
  `tsx` like the existing commands; a compiled build waits for Phase 3.
- **Healthchecks.io:** one daily check with two hours' grace, pinged when a day's runs complete.

## 11. Testing

- **Unit tests** for every pure unit: cycle dates, sizing and its invariant, reconciliation on
  totals, every Risk Guard rule, client order IDs, walking the book, fees, and rounding. The
  candle-window validator is tested for a short, stale, out-of-order, duplicated, and gapped
  window, and for each kind of invalid price. `getJson` is tested to give up on a stalled
  request within its deadline.
- **Paper account tests:** duplicate IDs, rule enforcement, partial fills on a thin book, fees in
  the right coin, and atomicity.
- **Scenario tests** for the full tick, with a fake clock, fake market data, a paper account, and a
  real PGlite database: a normal switch; nothing to do; Bybit down, then back; stale candles; a
  crash right after an order is sent, with recovery and no duplicate; a partial fill; a
  reconciliation mismatch; borrowing; a Risk Guard veto; freeze, then unfreeze and same-day catch-
  up; pause; the kill switch; abandonment at the next close; a late completion; alerts sent once.
  From the design review: **an order interrupted before midnight and settled after it**, recorded
  under its own day, with no duplicate; an order still pending, then settled; an order still
  pending after an hour; **a placement that times out after the order was accepted**, and one
  that times out before it arrived; a stalled request that gives up within its deadline; and
  **locked BTC with a FLAT target**, and locked USDT, each freezing rather than passing as at the
  target. From the recovery clarifications: **an order that never arrived** — a lookup that
  cannot see it records nothing and places nothing, and only the adapter's proof of absence
  records `NOT_PLACED` and lets a retry under a new ID fill, with every ID holding exactly one
  intent and one result; **an order that becomes visible late**, for which no replacement is
  ever placed; an order that stays invisible for an hour, which freezes; a lookup that fails,
  recording nothing; and a fourth attempt in a day, which freezes.
- **The parity test.** Replay real daily candles from a committed fixture — BTCUSDT spot, 2023 and
  2024 — through the live tick one day at a time, with the clock at 00:02 UTC and a synthetic order
  book at the next candle's open. Run the backtest engine over the same candles. The **daily
  targets and the days and sides of every trade must match exactly**; final equity must agree
  within 1%. This is what proves the engine and the backtest run the same strategy.

## 12. When Phase 2 is complete

1. `npm test` and `npm run typecheck` pass, including the parity test, and `npm audit` reports no
   vulnerabilities in production dependencies.
2. The engine is deployed on the VPS under systemd, with alerts and the heartbeat working —
   proven by a deliberate test alert and a deliberately missed heartbeat.
3. It has run **14 consecutive days**, each either completed or explicitly alerted, with no
   unexplained gap.
4. `npm run paper:report` shows the paper account's trades matching the backtest's decisions over
   the same days.

The rest of the parent spec's 2–4 weeks of paper trading then continues while Phase 2b is built.

## 13. Carry forward

- **Phase 2b — Bybit orders.** A `BybitTradingAccount`: orders through `/v5/order/create` with
  `orderLinkId` set to the client order ID and `marketUnit` set to `quoteCoin` for buys; order
  state from the open-orders endpoint, then order history; fees from the execution list. Its
  `getOrder` returns `ABSENT` only when the adapter can prove the order was never created, and
  `NOT_VISIBLE` whenever it simply cannot see it; failures throw. An exchange lookup rarely
  proves a negative, so Phase 2b must also give the founder a way to record a human-verified
  outcome for an order stuck `NOT_VISIBLE`, before any real order is placed. The key is
  re-validated before every use, as Phase 1 requires. The account's automatic borrowing must be
  confirmed off. Testnet first, then mainnet with the founder's own money.
- **Phase 3:** production Postgres, a compiled build, `MAX_ORDER_USDT` set small, `SERVER_IPS` set
  to the VPS address.
- **Phase 4:** onboarding built around the dedicated account, written for beginners:
  - say plainly that the strategy controls **every BTC and USDT in the connected account**, and
    nothing outside it — which is why a separate sub-account is recommended, with the steps to
    create one;
  - make **connecting** an account and **activating trading** separate steps. Connecting
    validates the key and shows the balances. Activating shows the exact amounts the strategy
    will take over and requires an explicit confirmation;
  - pause and unfreeze from the dashboard, and a job queue if many users make one worthwhile.

## 14. Changes to other documents

- `docs/stack-and-setup.md` — the scheduling row: a one-shot command on a systemd timer until
  Phase 4, replacing `pg-boss`.
- `docs/decisions.md` — #22, this phase's decisions.
- `CLAUDE.md` — current state, the new commands, and the merge order.

# The engine checks itself: design

- **Date:** 2026-09-23
- **Status:** design agreed with the founder, 2026-09-23. Not implemented.
- **Parent spec:** `2026-09-22-phase-2-paper-engine-design.md`, with Phase 2a
  (`2026-09-23-phase-2a-order-settlement-design.md`). This adds to its section 4 (one tick) and
  its paper report, and changes nothing about how the engine trades.
- **Branch:** `engine-self-check`, created from `phase-2-paper-engine`; one pull request per task,
  from branches named `self-check/…`.
- **Why now:** the founder asked for the engine to be made "more efficient and smart", and chose
  this first, then a compiled build. It is built before the Phase 2 deployment if the founder
  waits for it, so the fourteen paper-trading days record its evidence from the first day.

## 1. Goal

**Each day, the engine checks its own work against the backtest it claims to reproduce**, and
says what it finds:

1. **Does yesterday's decision still hold on today's data?** The engine traded on the candles it
   fetched at 01:02. If Bybit has since revised a closing price, the decision the engine acted on
   may no longer be the one the data gives.
2. **What did each fill really cost, against what the backtest assumes?** The Phase 0 result rests
   on a 0.1% fee and 0.05% slippage for every buy and sell, 0.15% a trade. Paper fills are made on
   Bybit's live order book, and later real fills on the exchange itself; both can show whether
   that assumption holds.

`paper:report` already replays past decisions against the strategy, but only when the founder
runs it, and it never looks at what a fill cost. This makes both checks daily, recorded, and
automatic.

**"Smart" here means the engine knows itself, not the market.** Nothing in this design changes a
decision, an order, or a position. The strategy is the one thing the project has evidence for
(`docs/decisions.md` #19, #21), and "AI trading" is how the frauds this product must stand apart
from sold themselves.

### Out of scope

| Item | Why, or where it goes |
|---|---|
| Acting on a finding — freezing, pausing, trading differently | Never. See decision 1 in section 2 |
| Fetching anything extra, from Bybit or elsewhere | Not needed: section 3 |
| Comparing prices with another exchange | Not needed to test the backtest's assumptions |
| Cheaper execution, such as limit orders | Only if this check shows fills cost more than assumed |
| A compiled build | The founder's next item, with its own spec |

## 2. Decisions

| Decision | Choice | Why |
|---|---|---|
| What a failed check does | **Records and alerts. It never freezes, pauses, or changes a trade** | If Bybit revises a price after the engine traded on it, the next day's run already trades on the revised data, so the account corrects itself. Freezing would stop exactly that correction. The Risk Guard and reconciliation already protect the money; this check produces evidence |
| How it reaches the founder | **One sentence in the daily summary already sent, and a separate alert only when something is off** | Chosen by the founder, 2026-09-23. No extra message on an ordinary day |
| When a fill is too expensive | **When its fee, spread, and price impact together cost more than the backtest's 0.15% a trade** — the figure the Phase 0 evidence rests on | The backtest's own assumption is the only threshold that means something here |
| Which price the backtest would have paid | **The day's opening price**, as the backtest fills a decision at the next day's open | Reported, not alerted: the minutes between the open and the fill move the price both ways, so single trades are noise and only the average says anything |
| Where it runs | **Inside the existing tick**, on the candles it already fetches | No extra request, no new process, and no second fight for the database lock |

## 3. Where the data comes from

Nothing new is fetched. Each day's run already fetches the last 250 closed daily candles and
validates the window (Phase 2 spec 4.1). That window covers everything the check needs:

- **Yesterday's decision:** every candle up to yesterday's close, fetched today. Replaying the
  strategy on them gives the decision today's data makes.
- **The backtest's price for a fill:** the fill for cycle date *c* is made just after the start of
  day *c + 1*, and the backtest fills that decision at the open of day *c + 1*. That candle closes
  at the start of day *c + 2*, so it is in the window fetched on day *c + 2* — the day after the
  fill.
- **The market when the order was sized:** every `ORDER_INTENT` already records the order book's
  mid price at sizing, seconds before the order was sent (`midPrice`).
- **What the fill cost:** every `ORDER_RESULT` already records the average price, the amounts, and
  the fee and its coin.

So the check for cycle date *c* — its decision and its fill — runs at the first successful fetch
for cycle date *c + 1*: normally 01:02 the next morning. It runs only on a tick that fetches
candles, which is any tick with an active account still to run that day. A day with nothing to
fetch leaves the check to the next day that fetches; anything unchecked among the seven cycle
dates before that day's is picked up then.

**Order within a tick:** the check runs after the day's candle window is validated and its signal
recorded, and before any account's run, so each account's summary can carry its sentence. Its
failures are caught (section 7), so the runs that follow are never affected.

## 4. The two checks

### 4.1 The decision, replayed

For each cycle date *d* among the seven before today's, with a recorded `SIGNAL` and no
`DECISION_REPLAY` yet:

1. Take today's validated window up to and including *d*, and evaluate the strategy on it, with
   the same function and period the engine uses.
2. Compare with the recorded `SIGNAL` for *d*: its target, its close, and its moving average.
3. The verdict:

| Verdict | When | What happens |
|---|---|---|
| `HOLDS` | Same target, same close, same average | Recorded. The summary says the decision still holds |
| `DATA_REVISED` | Same target, but the close or the average has changed | Recorded. The summary says Bybit revised the data and the decision still holds |
| `DECISION_CHANGED` | The target differs | Recorded, and a separate alert, once. Nothing is frozen: today's decision is already made on the current data |

A `DECISION_REPLAY` event records, under cycle date *d* and for everyone (no user): the recorded
and replayed targets, the recorded and current closes, the recorded and current averages, and the
verdict. There is at most one for each cycle date.

### 4.2 What a fill cost

For each user, for each `ORDER_RESULT` whose cycle date is among the seven before today's, with
something filled — fully or partly — and no `FILL_COST` yet, once the open of the day after its
cycle date is in the window:

| Measure | Calculation, with the cost against us positive |
|---|---|
| **Fee** | The fee in the quote coin, over the amount filled. A fee charged in BTC is converted at the fill's average price |
| **Spread and impact** | Against the mid when the order was sized. A buy: (average price − mid) / mid. A sell: (mid − average price) / mid |
| **Against the market** | Fee + spread and impact. **Compared with the backtest's 0.15%** |
| **Against the backtest's price** | Against the open of the day after the cycle date, plus the fee. A buy: (average price − open) / open + fee; a sell the other way round. Reported only |

A `FILL_COST` event records, under the order's own cycle date and user: the client order ID, the
side, the mid, the average price, the open, each measure above, the 0.15% it is compared with,
and whether the result came from the exchange or was recorded by a person (`source`, from Phase
2a's `npm run order:record`). There is at most one for each order.

**The expensive-fill alert does not wait for the next day.** Everything "against the market" is
known the moment the fill is recorded, so the run that makes the fill checks it straight away,
alerts if it costs more than 0.15%, and says what it cost in that day's summary. The `FILL_COST`
record, which needs the next day's open, is written once, when it is complete.

The 0.15% is the backtest's `DEFAULT_COSTS` in `src/backtest/costs.ts` — a 0.1% fee plus 0.05%
slippage — read from there, never typed again.

## 5. What the founder sees

**The daily summary gains one sentence** — the check of the day before:

> 22 Sep: LONG, no change. Holding 0.011740 BTC and 1.08 USDT. **Checked 21 Sep: the decision
> still holds.**

and, the morning after a fill:

> **Checked 21 Sep: the decision still holds. Its buy cost 0.11% against the backtest's price;
> the backtest assumes 0.15%.**

When the data was revised, or the decision would now be different:

> **Checked 21 Sep: Bybit revised that day's data, and the decision still holds.**
>
> **Checked 21 Sep: the decision would now be different — see the separate alert.**

On the day of a fill, the fill's own sentence says what it cost against the market:

> 22 Sep: LONG. Bought 0.011740 BTC for 998.92 USDT at 85086.88, **costing 0.10% against the
> market (the backtest assumes 0.15%)**. Holding …

**Separate alerts, each sent once:**

- *"Self-check: the 21 Sep decision would now be FLAT, not LONG. Bybit's data for that day has
  changed since the engine traded on it. Nothing was frozen: today's run already trades on the
  current data. If this happens again, the price data needs a closer look."*
- *"Self-check: order ca… cost 0.42% against the market, more than the 0.15% the backtest
  assumes: fee 0.10%, spread and impact 0.32%."*

**`npm run paper:report` gains a section:**

```
Self-check
  Decisions rechecked: 14. All held; 1 with revised data (19 Sep).
  Fills costed: 3. Against the market: average 0.10%, worst 0.11% (the backtest assumes 0.15%).
  Against the backtest's price: average 0.09%, worst 0.31%.
```

A changed decision also makes `paper:report` exit with a failure, as a signal mismatch does now.

## 6. Architecture

| File | Change | Responsibility |
|---|---|---|
| `src/engine/selfCheck.ts` | New, pure | `replayDecision`: a verdict from a recorded signal and a candle window. `fillCost`: the measures from an intent, a result, and an open. No I/O |
| `src/engine/dailyCheck.ts` | New | Finds what is unchecked in the ledger, calls `selfCheck`, records `DECISION_REPLAY` and `FILL_COST`, sends the separate alerts, and returns what each user's summary should say |
| `src/engine/cycle.ts` | Modify | Runs the daily check once the day's candle window is validated; checks a new fill against the market; adds the sentences to the summary |
| `src/ledger/ledger.ts` | Modify | Two new event types: `DECISION_REPLAY`, `FILL_COST` |
| `src/app/paperReport.ts` | Modify | The self-check section, and the exit status |

The ledger's `type` column is plain text, so the new types need no migration. `readSignal` returns
its validated window as well as the target, so the check reuses it instead of fetching again.

## 7. When things go wrong

| Situation | What happens |
|---|---|
| No recorded signal for a day — the first day, or the engine was down | Nothing to replay for that day |
| The day's candles cannot be fetched or fail validation | No check that tick. The next tick that fetches picks up everything unchecked among the seven cycle dates before its own |
| An error inside the check | The check stops for that tick and alerts once a day. **It never fails the trading run**: the run's own steps come first and are untouched |
| A fill recorded by a person with `npm run order:record` | Costed the same way, and labelled as recorded by a person |
| A result with nothing filled — rejected, or not placed | No cost: nothing was traded |

## 8. Testing

Every test must fail before its change and pass after it. The full suite, the type check, the
historical parity test, and `npm audit --omit=dev` must all still pass.

- **`replayDecision`, pure:** `HOLDS`; `DATA_REVISED` on a revised close that leaves the decision;
  `DATA_REVISED` on a revised earlier close that moves only the average; `DECISION_CHANGED`; a
  window too short for the day.
- **`fillCost`, pure:** a buy with the fee in BTC; a sell with the fee in USDT; a fill better than
  the mid, which gives a negative spread and impact; a partial fill.
- **In the engine harness:**
  1. An ordinary morning after a fill: `DECISION_REPLAY` `HOLDS` and `FILL_COST` are recorded, the
     summary carries the sentence, and no separate alert is sent.
  2. A revised close that keeps the decision: `DATA_REVISED`, mentioned in the summary, no alert.
  3. A revised history that flips yesterday's decision: `DECISION_CHANGED`, one alert, **the
     account is not frozen**, and today's run completes on the current data.
  4. An expensive fill, from a thin order book: the alert comes the same day, and the next day's
     `FILL_COST` records a cost above 0.15%.
  5. **No extra request:** the market is asked for candles no more often than before.
  6. The first day: nothing to replay, and no error.
  7. A result recorded by a person: costed, and labelled so.
  8. An error inside the check: alerted once, and the trading run still completes.
- **`paper:report`:** the new section, and a failing exit status when a decision changed.

## 9. When this is complete

1. Every test in section 8 exists and fails without its change; the full suite, the type check,
   the parity test, and `npm audit --omit=dev` pass.
2. `CLAUDE.md`, the Phase 2 spec's revision note, and `docs/decisions.md` record it.
3. The branch is merged into `phase-2-paper-engine` through a pull request. **When it reaches the
   VPS is the founder's decision**: before the fourteen paper-trading days start, so that they
   record this evidence from the first day, or after them, as its own deployment.

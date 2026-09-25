# Research candidate: liquidity sweep with structure confirmation

- **Status:** draft for the founder and Codex to review, 2026-09-23. It works as a
  pre-registration: it fixes the rules and the result they must reach before anyone looks at any
  results.
- **Development result, 2026-09-24: UNTESTABLE.** Version 0 made **3 trades in 2022–2024**, against
  the 30 the bar in 6.5 needs.
  - An independent recomputation found no bug.
  - The full evaluation was not run, and no rule was loosened.
  - The locked period is still unseen.
  - Details: `docs/research/liquidity-sweep-results.md` on branch `research-liquidity-sweep` (PR
    #44).
  - The founder then chose one pre-registered version 1.
- **Version 1, 2026-09-25: UNTESTABLE too, so the idea is not pursued.** Its four-step ladder
  counted 16, 16, 26 and 29 trades; none reached 30.
  - An independent recomputation again found no bug.
  - No return was ever computed, and the locked period is still unseen.
  - Details: `docs/research/liquidity-sweep-v1.md` on `research-liquidity-sweep` (PR #49), and
    `docs/decisions.md` #27.
- **Asked for by:** the founder, relayed by Codex on 2026-09-23. They want to find liquidity, check
  the market structure, then wait for confirmation, and want the idea worked out, improved, and
  brought onto the platform.
- **Founder decisions it works within (2026-09-23):** it is an **addition to MA-125, never a
  replacement**. Users will choose among strategies, with more added over time; see
  `docs/product/strategy-catalogue.md`. The founder left the choice of approach to Claude and
  Codex, and intends to test a strategy personally with real money before offering it to anyone.
  **None of this authorizes an order now.**
- **Scope:** BTC/USDT on Bybit spot, long or flat. No leverage (design spec §3).
- **Builds on:** Codex's `prototypes/customer/STRATEGY-RESEARCH-NOTE.md` at `70311ab`. Codex asked
  for its numbers to be critiqued and simplified rather than kept. Section 7 says what was kept,
  what was changed, and why.

## 1. The recommendation in brief

1. **Test one fixed rule set.** Run it once on 2022–2024 and, only if that passes, once on a
   locked 2025-01 to 2026-08. Then run it as a practice account. Every threshold is fixed in this
   document before any data is examined.
2. **Research code only until the locked period passes.** That means no engine change, no second
   paper account, and nothing in the product beyond a research card.
3. **Judge it against a placebo, not against zero.** The placebo is random entries taken in the
   same market structure, with the same stop, target and time limit. Beating zero could just mean
   holding BTC in uptrends. Beating the placebo is what would show the sweep matters.
4. **Expect "not pursued" to be the likeliest outcome, and find out cheaply.** On 15-minute
   candles the stop sits a fraction of a percent away, and each round trip pays about 0.3% in
   costs. The design spec chose daily candles for this reason: "Faster timeframes multiply cost and
   risk without a corresponding edge at this stage" (§3). The test should settle that, not
   assume it.

## 2. The idea, and the claim that can fail

The founder's idea, made mechanical:

1. **Liquidity:** the previous UTC day's low, as the level where stop orders might gather.
2. **Structure:** the 4-hour trend is up.
3. **Sweep:** a 15-minute candle dips below that level and closes back above it.
4. **Confirmation:** a later 15-minute close above the last swing high that was already known
   before the sweep.
5. **Trade:** buy, with a stop just under the sweep's low, a target at twice the risk, and a time
   limit.

**The claim under test:** on Bybit spot BTC/USDT, entries taken this way (1) average a positive
result after costs, and (2) average better than random entries taken in the same 4-hour structure
with the same stop distance, target and time limit.

Part 1 alone would not show that "liquidity" matters. Part 2 is the test of the idea itself.

**What no test here can show:** where real stop orders sit. The previous day's low is a price
level computed from candles, and candles cannot show who holds which orders. Codex's note says
the same.

## 3. Rules, version 0

Every value below is fixed here, and none was chosen by looking at data. Results are reported in
**R**, the trade's **planned risk**: the confirmation close's distance to the stop trigger (R8). A
trade stopped out is about −1R and a trade that reaches its target about +2R, before costs.

- **Net R** is the profit per BTC after fees and slippage, divided by the planned risk.
- **Gross R** is the same before costs.

Measuring from the confirmation close, not the fill, stops an opening gap from distorting the
unit. The clarifications of 2026-09-24, all made before any data was fetched, are listed in
section 3a.

**R1. Candles.** Bybit spot BTCUSDT 15-minute candles, and only completed ones. The 4-hour and
daily figures are built from them, aligned to UTC (4-hour blocks start at 00:00, 04:00 and so on;
days start at 00:00). They are never fetched separately, so the three timeframes cannot disagree.
A 4-hour candle counts from the 15-minute close that completes it. Missing or duplicated candles
are rejected (R9 and R13).

**R2. Swing points, both timeframes.** A candle is a swing high when its high is strictly above
the highs of the two candles before it and the two after it. A tie with any of them makes no
swing. Swing lows mirror this. A swing exists for these rules only **from the close of the second
candle after it**: 30 minutes later on 15-minute candles, 8 hours later on 4-hour candles.
Counting a swing at its own candle is the hindsight that makes chart-drawn versions of this idea
look better than they trade.

**R3. Structure is up** when all three hold, using only 4-hour candles completed and swings known
at the moment of the check:

- the last two 4-hour swing highs rise;
- the last two 4-hour swing lows rise;
- the latest 4-hour close is above the latest 4-hour swing low.

Anything else means no long: a downtrend, a flat market, or too few swings yet. It is checked
when a sweep arms and again at every 15-minute close until entry.

**R4. The level** is the previous UTC day's low: the lowest low of its 96 15-minute candles, fixed
at 00:00 UTC. If that day is missing a candle, there is no level and no setup that day.

**R5. The sweep: the first touch decides.** The first completed 15-minute candle of the UTC day
whose low is below the level is the only candidate that day.

- If it **closes above the level**, it is a sweep.
- If it **closes at or below it**, the level broke rather than swept, and the day has no setup.

A sweep arms a setup only if, at its close, the structure is up (R3), the account holds no trade
and no other setup is waiting, and a reference swing high exists (R6).

**The first touch is spent whether or not it arms.** It may fail to arm because the account is in
a trade, a setup is still waiting, the structure is not up, or there is no reference. Either way
the day has no setup, and no later candle that day becomes its first touch. A day with no level
has no touch at all.

**R6. The reference swing high** is the most recent 15-minute swing high that was already known
when the sweep candle opened and sits above the sweep candle's close. If there is none, there is
no setup. A swing confirmed by the sweep candle's own close was not known when it opened, so it
cannot be the reference. The reference is frozen at arming, with the level, the sweep low and the
stop trigger. Nothing is recalculated later.

**R7. Waiting.** At each of the next eight 15-minute closes (two hours), in this order:

1. **Discard** if the candle traded below the sweep low.
2. **Discard** if the structure is no longer up.
3. **Confirm** if it closed above the reference swing high. The entry is the next candle's open.
4. **Discard** after the eighth close without confirmation.

Discarding comes before confirming, so a candle that does both counts as a failure. When the order
of events inside a candle is unknown, the rules take the worse one.

**A waiting setup survives midnight.** Everything frozen at arming stays frozen, and it keeps
counting its eight closes. The new day still gets its own level: yesterday's low, which may be the
sweep's own low. It also gets its own first touch. If that touch comes on a candle that opened
while the old setup was still waiting, the touch is spent without arming, even if the old setup
ends on that same candle.

**R8. Entry.** A market buy, decided at the confirmation close.

- **Planned risk** is the confirmation close minus the stop trigger (R9). If it is under **0.6% of
  the confirmation close**, skip the trade. Section 4 derives this screen from costs.
- **In the research,** the buy fills at the open of the next candle, plus slippage. If that candle
  is missing, there is no entry. The trade never takes a later open.
- **In practice and live trading, later,** the buy must be sent before that next candle closes,
  within 15 minutes of the confirmation. Otherwise the setup is void, whether the cause is an
  outage, stale data or a failed request. **No late entries, ever.** A practice or real fill is
  recorded at its own price, never at the historical open. Practice must show that the average
  cost of the delay stays within the slippage assumed here.
- **An entry open at or below the stop trigger is skipped.** The trade would be stopped at once,
  with no risk distance left.

**R9. Exits.** Set when the entry fills, from its fill price:

- **Stop trigger:** one price step below the sweep low. That is 0.1 USDT for BTCUSDT, per Bybit's
  instrument rules on 2026-09-23.
- **Target:** entry + 2 × (entry − stop trigger).
- **Time limit:** 32 completed candles (8 hours) after entry.

They are checked on every completed candle, starting with the entry candle itself:

- **Stop:** if the candle's low reaches the trigger, sell at the trigger, or at the candle's open
  if it opened below it. Slippage applies.
- **Target:** if the candle's high reaches the target, sell at the target. Slippage applies.
- **Both in one candle:** the stop wins. A 15-minute candle cannot say which came first.
- **Neither by the 32nd close:** sell at the next candle's open. Slippage applies.
- **A candle missing mid-trade:** sell at the next available candle's open, or at the stop if that
  candle reaches it, whichever is worse, and flag the trade.

The stop never moves to break-even, and there are no partial exits.

**R10. Size.** Risk **0.25%** of the account's value per trade. This is a research setting, not a
product decision. Sizing uses only what is known at the confirmation close:

- **Risk per BTC** is the loss if the buy fills at the confirmation close plus slippage and the stop
  sells at its trigger less slippage, with both fees on those two prices.
- **The order is an amount of USDT:** 0.25% of equity divided by the risk per BTC, times the
  confirmation close plus slippage. It is capped at the available USDT divided by 1.001, so the buy
  fee can never overdraw the account. There is no borrowing.
- **At the fill,** the BTC bought is that amount divided by the fill price, rounded down to the
  exchange's lot step of 0.000001 BTC. An opening gap therefore buys a little more or less than
  planned. A buy under the exchange minimum of 5 USDT is skipped.
- **Fees are counted in USDT on both sides.** Bybit takes a buy's fee in BTC; its value is the
  same.

A price that jumps past the stop can lose more than 0.25%, so intended risk is not the maximum
loss. Pass or fail is judged on per-trade R, which sizing does not change.

**R11. Costs.** A **0.1% fee** and **0.05% slippage** on every fill: entry, stop, target and time
exit are all market orders once triggered. Section 8 explains why the target cannot be a resting
limit order. The **stress test uses 0.15% slippage** per fill, because stops and breakout entries
are the fills that slip most.

**R12. One at a time.** At most one trade open and one setup waiting, and at most one setup per
UTC day.

**R13. Order of evaluation**, at each 15-minute close:

1. Check the candle. If it is missing, duplicated, or not the one expected, act only on the exits
   of an open trade (R9).
2. Exits for an open trade.
3. Update swings, structure, and the day's level.
4. A waiting setup: discard, confirm, or expire.
5. A new sweep, only if the account was flat when this candle opened.

## 3a. Clarifications, 2026-09-24, before any data

Codex's review of the handoff (`prototypes/customer/CLAUDE-HANDOFF-RESPONSE.md` at `6115b80`)
found boundary cases the rules had left open. Each was settled before any data was fetched, and
the rules above now say so. None changes a number.

| Question | Settled |
|---|---|
| Is a first touch that cannot arm still spent? | Yes (R5) |
| Does a waiting setup survive midnight? | Yes, frozen, still counting its eight closes. The new day's first touch is spent without arming if a setup was waiting at that candle's open (R7) |
| Can the sweep candle's own close confirm the reference? | No: it was not known when that candle opened (R6) |
| Next open, or "during the candle"? | Two separate assumptions. The research fills at the next open. Later execution must send within 15 minutes and records its own fill (R8) |
| An entry open at or below the stop | Skipped (R8) |
| What sizing may know | Only the confirmation close. Entry slippage is now in the risk per BTC, and the USDT cap includes the buy fee (R10) |
| The unit of R | The planned risk from the confirmation close, not from the fill, so an opening gap cannot distort it. Net and gross R are reported separately (section 3) |
| Bootstrap and placebo | Months are the resampling unit. The placebo is matched by calendar month and timed like a real entry. The seeds are fixed (6.4) |

## 4. Costs, and the floor on the stop distance

The standard costs make each round trip about **0.3%**: two 0.1% fees and two 0.05% slippages.
Measured in R, that cost grows as the stop gets closer. With a 2R target, the win rate needed just
to break even is (1 + cost in R) ÷ 3:

| Stop distance (R, as a share of price) | Cost in R | Win rate needed to break even |
|---|---|---|
| No costs | 0 | 33% |
| 2.0% | 0.15 | 38% |
| 1.5% | 0.20 | 40% |
| 1.0% | 0.30 | 43% |
| **0.6% (the floor)** | **0.50** | **50%** |
| 0.3% | 1.00 | 67% |

This is approximate, since time exits land between the two outcomes. Below 0.6%, the strategy
would need to win more than half its trades just to break even, so R8 skips those trades. The
floor comes from the cost arithmetic, not from any data. It has a second effect. A candle can only
reach both the stop and the target if its range is at least 3R, which is 1.8% in 15 minutes at the
floor. That should be rare, so treating such candles as losses (R9) should cost little. The report
counts them rather than assuming so. The floor is a screen on costs, not a guarantee of an exact
break-even rate.

## 5. How much a result can prove

The result of a 2R-or-stop trade varies by about 1.4R (one standard deviation). To detect an average of **+0.2R** with the
usual confidence (one-sided 5%, 80% power), a test needs about **300 trades**. With **50 trades** it
can only detect about **+0.5R**, which would be an extraordinary edge.

So this test can **reject** the idea convincingly. It cannot **confirm** a modest real edge: a
modest one would look like noise. A pass means "worth practice trading", never "proven". An edge
too small to see in 50 trades is also too small to justify an intraday engine, whose cost is
listed in section 8.

## 6. Research plan

### 6.1 Approaches considered

| | Approach | Verdict |
|---|---|---|
| **A** | **Fix one rule set; run it once on development data with a placebo and a neighbour check; once on a locked period; then practice trading** | **Recommended** |
| B | Search the settings on 2022–2024, then confirm on the locked period | Rejected. With tens of trades, a search finds noise that looks like signal, which is the overfitting problem Codex's note cites, and the locked period is too small to catch it |
| C | Skip history: go straight to practice trading or a small real-money test | Rejected. At tens of trades a year, months of practice say almost nothing about an edge, and real money adds losses without adding evidence. Practice trading tests the engine, not the idea |

### 6.2 Periods

| Period | Dates | Use |
|---|---|---|
| Warm-up | 2021-07-05 to 2021-12-31 | Swings and structure only; no trades counted |
| Development | 2022-01-01 to 2024-12-31 | One run of the fixed rules |
| **Locked** | **2025-01-01 to 2026-08-31** | One run, only if development passes |
| Forward | From the practice account's first tick | The only truly unseen data |

- **Why 2022, not 2021.** Bybit spot BTCUSDT 15-minute history begins at 2021-07-05 12:00 UTC.
  That was checked against Bybit's public API on 2026-09-23. At first the market was thin. Single
  15-minute candles sampled around midday UTC held about 0.01 BTC on the first day, 1 BTC on
  2021-09-01, and 7 BTC on 2021-12-01. From 2022-03-01 on, the samples held between 29 and 175
  BTC. A rule about wicks is only as good as the market that printed them.
- **Not the perpetual.** The inverse perpetual reaches back to 2018, and Phase 0 used it for its
  long history. But Phase 0 validated it against spot on daily closes, not on wicks, and
  liquidations make perpetual wicks differ most. It could only stand in for spot here after its
  own check, which would ask whether both markets sweep on the same days.
- **The locked period is not perfectly clean.** The idea came from watching markets, likely
  recent ones, and everyone involved has seen BTC's 2025–26 charts. That is why practice trading
  follows it.
- **The lock is enforced.** The research command refuses any candle after 2024-12-31 without an
  explicit flag. The locked run happens in its own pull request, which names the commit of the
  rules it runs and commits the output as it comes.

### 6.3 The next bounded research implementation

The founder and Codex asked for this list. Each item is one pull request on branch
`research-liquidity-sweep`, from `phase-2-paper-engine`. The detailed plan is
`docs/superpowers/plans/2026-09-24-liquidity-sweep-research.md` on that branch. No item touches the
engine, the ledger, the database or order code. The strategy functions go in `src/strategy/`, so
the same code would later run in the engine: that is the rule "One strategy implementation, ever".
`src/strategy/` imports only `math`, `types`, `decimal.js` and its own files, and a test enforces
it.

1. **15-minute candles.** The candle fetcher takes an interval and an end date, with daily fetching
   unchanged. Add integrity checks for gaps, duplicates and impossible prices, and a fetch command
   that keeps the locked period off the disk.
2. **Candles, swings and structure.** Pure functions for R1 to R4: 4-hour and daily candles built
   from 15-minute ones, swings with the time they become known, and structure. Tests cover ties and
   no lookahead: adding later candles must never change an earlier answer.
3. **The rules.** A step function for R5 to R8, R12 and R13, fed one completed candle at a time. It
   keeps its own history, rebuilt by replaying candles, so the same candles always give the same
   events. Each rule and each boundary in section 3a gets a test.
4. **The backtester.** R9 to R11: fills, stop-first, missing candles, sizing, and results in net
   and gross R. Tested on synthetic candles.
5. **Evidence.** The seeded generator, the month-block bootstrap and the month-matched placebo.
6. **Report and lock.** The report in 6.4, the bar in 6.5, and the enforced lock.
7. **Commands.** A data check against Bybit's own 4-hour and daily candles, and the research
   command with a count-only step and the attempt log.
8. **Run the development period.** First check the data, then count trades before looking at any
   result, then do the one run. The results are recorded as they are, in their own pull request.
9. **Run the locked period.** Its own pull request, and only if development passed.

### 6.4 What every run reports

- **Trades:** count, per year, win rate, and the average win and loss in R.
- **Result:** mean net R per trade and total R, and the same in gross R. The mean has a 90%
  interval from 10,000 bootstrap resamples. The resampling unit is the calendar month: all of a
  month's trades are drawn together, so months that bunch trades together are not treated as
  independent. Results are also broken down by calendar year: 2022 fell, 2023 recovered, and 2024
  rose and went sideways.
- **Costs:** the same results at 0.15% slippage, and the round-trip cost at which the mean
  reaches zero.
- **Placebo:** for each real trade, one random 15-minute candle **in the same calendar month**,
  entered at its open. It must be a candle where a real entry could have been decided: the one
  directly after a close at which the structure was up and the day had a level. Only information
  known at that open is used.
  - Each placebo trade gets the real trade's stop distance as a share of price, and the same target
    multiple, time limit, costs and exits. It is measured in its own planned risk.
  - That makes one placebo set. 1,000 sets give a distribution of mean R, and the report says where
    the real mean ranks.
  - Placebo trades may overlap; each is scored alone.
  - Matching by month stops a different mix of market periods from passing for skill at timing.
- **Randomness is fixed:** the seeded generator mulberry32, with seed 20260924 for the bootstrap and
  20260925 for the placebo. Both are printed in every report.
- **Ambiguous candles:** the actual number of trades that ended on a candle reaching both the stop
  and the target.
- **Account view at 0.25% risk:** return, maximum drawdown, time in the market, capital in use,
  and the longest losing streak.
- **Context only, never a pass criterion:** buy-and-hold, MA-125 and cash over the same dates and
  costs, and the correlation of daily returns with MA-125.
- **Neighbours, shown and never used to choose:** each of these changes one rule and keeps the
  rest:

  | Changed | Values |
  |---|---|
  | Swing size, both timeframes | 3 |
  | Waiting window | 4 or 16 candles |
  | Target | 1.5R or 3R |
  | Time limit | 16 or 96 candles |
  | Stop | 0.25 × 14-candle ATR below the sweep low, Codex's proposal |

- **Attempt log:** every run ever made, with its date, commit, rules version, period and outcome.
  Nothing is deleted.

### 6.5 The bar, fixed now

**Development passes only if all five hold:**

1. **At least 30 trades.** Fewer means untestable on this history, which is not a pass. The next
   step would then be the founder's call on the perpetual check in 6.2. The rules would not be
   loosened to get more trades.
2. **Mean R after standard costs is above zero, and so is the bottom of its 90% interval.**
3. **Mean R is still above zero at 0.15% slippage.**
4. **Mean R is above the placebo's 95th percentile.**
5. **At least 5 of the 8 neighbours have a positive mean R** at standard costs. A result that
   stands alone among its neighbours is luck.

**The locked period passes only if all three hold:** mean R above zero after standard costs; mean
R at or above the placebo's median; and a trade rate within half to double the development rate.
With fewer trades, this bar can only catch a clear failure. The development bar does the heavy
lifting.

**Revisions.** At most one, before the locked run, and only to fix a mistranslation: a bug, or a
misreading of the founder's idea. A disappointing number does not count. The reason is recorded
here before the rerun. Changing the rules to improve a result ends the test.

**If it fails,** it is recorded here as not pursued, with its numbers, as Phase 0 did for meme
coins.

### 6.6 After the bar

- **Practice.** First a spec for the engine gaps in section 8, then the strategy runs in its own
  paper account. Practice checks the engine, not the edge. It needs at least 60 days and at least
  10 trades, whichever is later, with these results:
  - every decision replays identically from its candles;
  - every trade had its stop resting from its first tick;
  - no exit was missed;
  - average entry and exit costs stayed within the assumptions.

  Performance is reported but not judged on so few trades.
- **The founder's own real money.** This comes after practice and needs all of the following:
  - real orders, which is Phase 2b;
  - the Bybit key question answered (`docs/decisions.md` #8);
  - the stop and target mechanics verified on the founder's own account (section 8);
  - a dedicated Bybit sub-account for this strategy alone;
  - `MAX_ORDER_USDT` set small;
  - the founder's recorded decision.

  A handful of real trades can show that orders, stops and fees behave as modelled. It cannot show
  an edge: at this trade rate that takes years.
- **Anyone else.** The catalogue's gates apply, after the founder's run and the legal opinion
  (`docs/decisions.md` #18).

## 7. Codex's note: kept, changed, dropped

| Codex's note at `70311ab` | This draft | Why |
|---|---|---|
| 4-hour structure, 15-minute entries, UTC, completed candles only | Kept | |
| Swing: strict, two bars each side, known at the second right-hand close, ties make none | Kept | |
| Structure up: last two highs and last two lows rising | **Kept, plus one condition:** the latest 4-hour close is above the latest swing low | Without it, the structure still reads "up" for about 8 hours after price closes below the last higher low, until the new lower low is confirmed |
| Previous UTC day's low only; no equal lows, order blocks or fair-value gaps in version one | Kept | One level keeps the test about one idea |
| Sweep: a bar trades below the level and closes back above | **Tightened: the day's first touch decides** | As written, a recovery hours after a breakdown counts as a sweep, and its "sweep low" is just some candle's low. The first touch also gives at most one setup a day |
| Reference: the most recent swing high above the reclaim close, confirmed before the sweep | Kept | |
| Freeze the 14-period Wilder ATR | **Dropped** | Only the ATR stop buffer needed it |
| Confirmation within eight bars; discard on a sweep-low breach, lost structure or expiry | Kept, with the discard checks before the confirm check | Pessimistic when one candle does both |
| Retest entry as the one registered alternative | **Left out of round one** | Resting buys at a level are the most flattering fills a candle backtest can give: it fills the trades that come back and misses the ones that run. A second variant also halves what each result can prove |
| Next-bar entry; no same-bar fill; one position; no resurrected setups | Kept | |
| Stop: sweep low − 0.25 × ATR | **Changed: one price step below the sweep low** | Two fewer numbers, and one sentence to explain. Codex's buffer is tested as a neighbour, not assumed |
| — | **Added: skip if the stop is under 0.6% away** | Derived from costs (section 4). It should also make candles that reach both exits rare; the report counts them |
| Target 2R; time exit after 32 bars; no break-even, no partials | Kept | |
| How the target fills (not specified) | **Specified: a triggered market sell, with slippage** | On Bybit spot, a sell order resting at the target would lock the BTC the stop must sell (section 8) |
| Risk 0.25% per trade, costs included in the risk, capped by available USDT | Kept, as a research setting | Research is judged on R, which sizing does not change |
| Stop and target in one bar: use lower-timeframe data, then the adverse ordering | **Changed: always the adverse ordering;** 1-minute data only as a reported sensitivity | Simpler, and with the floor such candles should be rare; the report counts them. If they turn out common, that is itself a finding |
| Development, validation and final untouched periods | **Two historical periods, then practice trading as the untouched one** | No settings are chosen, so a validation period has nothing to do, and a three-way split of about three good years leaves each piece too small |
| Choose acceptance thresholds before the final evaluation | **Fixed now, before development** | Thresholds set after seeing development results are chosen to pass |
| Record every configuration; compare with buy-and-hold, MA-125 and cash; report exposure | Kept (6.4) | |

## 8. What the engine lacks — built only if the locked period passes

| Need | The engine today, branch `phase-2-paper-engine` | This strategy |
|---|---|---|
| **When it decides** | Once a day. It already ticks at :02, :17, :32 and :47 (`OnCalendar=*:02/15`), two minutes after each 15-minute close | At every 15-minute close. The backtest fills at the next open; the two-minute lag costs price movement that practice must measure |
| **Strategy shape** | `StrategyFn(candles) → LONG \| FLAT`, pure | A pure step function over completed candles, the same code in research and engine |
| **Orders a day** | At most one per account, three attempts (`MAX_ATTEMPTS_PER_DAY`) | Up to four per trade: entry, stop, target, and a time exit or a cancel |
| **Protective exits** | None: MA-125 exits at its next daily decision | A stop and a target resting on the exchange from the moment the entry fills. A stop the engine checks every 15 minutes is not a stop: a fall between ticks, or a server outage, leaves the trade open, and the backtest's fill at the stop becomes fiction |
| **Locked funds** | Locked BTC or USDT that is not one of our orders freezes the account | The engine's own resting orders are expected; anything else still freezes |
| **Sizing** | All USDT in, all BTC out (`sizeOrder`) | Risk-based quantity, lot rounding, skipped under the minimum |
| **Identity** | One implicit strategy. Order IDs hash user, cycle date, intent and attempt; signals name no strategy | A strategy id and version on every event, report and order ID |
| **Allocation** | #22: a strategy controls the whole of a dedicated account; a slice of a shared account was rejected | Unchanged. It gets its own dedicated account, bound to one strategy version: a second paper account for practice, its own Bybit sub-account for real money. See the catalogue |
| **Market data** | Daily candles only: `fetchDailyCandles` asks for `interval=D`, and `closedCandles` assumes a day | 15-minute candles with interval-aware completeness and gap checks |
| **Missed runs** | A late daily run catches up until the next close | Entries never catch up. Exits always settle: resting orders are looked up, and in paper the missed candles are replayed in order |
| **Paper account** | Market orders against the live order book | Resting conditional orders, triggered from completed candles exactly as the backtest does |
| **Self-check** | Replays each daily decision; costs fills against the next day's open | Replays every 15-minute decision; costs entries against the next open and exits against their triggers |
| **Tick cost** | About 2.2 seconds a tick through npm, 0.9 compiled, measured on the Windows machine | With 96 decisions a day, the compiled build matters more. It is still waiting for the founder's answer |

**Bybit spot's protective orders,** from its create-order documentation
(`https://bybit-exchange.github.io/docs/v5/order/create-order`, read 2026-09-23):

- A conditional order (`orderFilter=StopOrder`) does not occupy funds until its trigger price is
  reached.
- A take-profit/stop-loss order (`tpslOrder`) occupies them from the start.
- Take-profit and stop-loss can be attached only to a limit entry.
- The page documents no one-cancels-the-other behaviour for spot.

So a limit sell resting at the target would lock the BTC that a triggered stop must sell. The
candidate design is **two conditional market sells, one below and one above, neither holding funds
until triggered**. The first to trigger should sell everything, and the engine then cancels the
other. **That is an assumption to verify, not a fact.** Bybit documents market orders as
immediate-or-cancel, and they can be cancelled when liquidity runs short, so a trigger is not proof
of a full exit. The backtest models exits this way, which is why R9 and R11 apply slippage at the
target.

**The live gate.** Before any real money, the engine spec must handle each of these. Codex raised
them on 2026-09-24:

- **A partial exit.** After any exit order ends, the engine compares the account's BTC with the
  trade. A remainder above the exchange minimum stays in the trade and keeps a protective stop, for
  the rest of the quantity. If the price is already past the trigger, the remainder is sold at
  market, completing an exit that has already triggered.
- **Races.** Both conditional orders may fire in one fast move. Every fill is reconciled against
  the trade's quantity, and anything unexplained freezes the account, as locked funds already do.
- **Required exits and orphans are different.** An exit order that still protects a position is
  never cancelled by a pause, a freeze or the kill switch. An exit order whose position is
  confirmed gone is an orphan. It is cancelled in every state, the kill switch included: cancelling
  cannot add risk, and a stale sell could act on funds deposited later.
- **Stale exit orders** are looked for at every tick. Any of ours that matches no open trade is
  cancelled, with an alert.
- **Completing an exit that has triggered** is allowed under a pause or a freeze. Under the kill
  switch it is not placed: the engine alerts at once, and the operator decides.

All five must be verified on a real account in Phase 2b, including what Bybit does with the second
order once the first has sold the BTC.

**Codex's integration questions, answered:**

1. **The smallest independent harness** is 6.3: five research pull requests, pure functions and a
   backtester, and nothing in the engine.
   - **Reusable later from order settlement:** deterministic client order IDs; one recorded answer
     per sent order (intent and result, `FOUND`, `ABSENT` and `NOT_VISIBLE`, and
     `order:record`); the kill switch meaning no new orders; pause and freeze as independent facts;
     the Risk Guard's checks on book age, spread and fill price; `TOO_SMALL`; the database lock;
     alerts.
   - **Not reusable as they stand:** one order a day, all-in sizing, daily cycle dates,
     `StrategyFn`, the daily self-check, and the paper account's market-only orders.
2. **History, filters and fees:** section 6.2 covers history. The engine already reads the lot
   step, minimum quantity and minimum order value (`getInstrumentRules`). Fees are assumed at 0.1%
   everywhere, as in Phase 0. The founder's real rate needs a key, which comes in Phase 2b.
3. **Protective exits survive failures by resting on the exchange** (above). They are reconciled
   like any order: the intent is recorded before sending, each order gets one result, and every
   tick looks them up.
4. **Pause, proposed for this strategy:** no state places a new entry, and no state cancels an
   exit that still protects a position. That covers a pause, a freeze, the kill switch and an
   outage.
   - A waiting setup is discarded, never resumed.
   - An open trade keeps its stop and target resting.
   - Its time exit is a new order, so it waits until the account can trade again.
   - Orphaned exits, and exits that have already triggered, follow the live gate above.
   - Someone who wants out closes the trade explicitly.

   MA-125's wording does not carry over. For MA-125, a pause holds the position with no stop at
   all.
5. **Identity, allocation and version consent:** `docs/product/strategy-catalogue.md`.
6. **From research to practice to live:** 6.5, 6.6, and the catalogue's eligibility gates.

## 9. What the product may show

**The research card in `design-lab.html` at `70311ab`** matches this draft on the points that
matter. It is not available to activate, and it says its steps are "not current market signals,
and no performance has been established". It warns that the prior low "does not reveal real stop
orders", and says the candidate "cannot simply share control of the daily strategy's whole
account". Codex made both suggested wording changes at `6115b80`: the same candle dips below the
level and closes back above it, as the day's first touch; and the rules are "fixed before any
testing". The card now shows the exact version, *Liquidity sweep · v0*, labelled *Research · not
available*.

**Setup states, only once practice trading runs,** from the engine's recorded events, never from
sample data dressed as live:

- **Watching** for the day's first dip below yesterday's low.
- **Waiting for confirmation**, until a stated time.
- **In a trade**, showing its stop, target and time limit.
- **Closed** by its stop, its target, or the time limit.
- **Not taken**, with the reason: the level broke, the structure turned, the setup expired, the
  stop was too close, or the entry candle was missed.

Each state carries the fields Codex listed at `6115b80`:
- the recorded event time;
- the rule and version;
- the expiry;
- the reason code;
- the reconciled position;
- the stop, target and time limit;
- whether reconciliation is complete.

**An empty or delayed event stream is never shown as "Watching".** The screen then shows when the
last check succeeded.

Before practice trading, the card describes the rules and nothing else. It shows no backtest
figures on customer screens, per the brand rule never to state or imply a return, and uses no
"smart money" vocabulary. Keeping the design lab separate from the prototype used in the
participant sessions, as Codex has done, keeps an untested idea out of the study.

## 10. Questions for the founder

1. **Go on version 0 and the research code in 6.3?** Nothing is built until then. The choice of
   approach was delegated, so the recommendation above stands unless the founder overrules it.
2. **Where did the idea come from:** a course, a particular trader, or your own charts? If it has a
   named source with its own rules, version 0 should follow those rules rather than our reading.
   And if the source's examples come from 2025–26, the locked period is weaker than it looks.

## Sources

- `docs/research/phase-0-findings.md`: the method this follows. It covers costs, warm-up, the
  in-sample and out-of-sample split, and the perpetual's validation against spot.
- `docs/decisions.md` #3 (why a trend filter), #8 (the Bybit key question), #18 (the legal
  opinion), #21 (assets earn their way in), and #22 (whole dedicated account). #24 (the kill switch
  means no new orders) and #25 (the self-check) are on `phase-2-paper-engine`.
- Bybit V5 kline and create-order documentation, and the public kline endpoint, checked
  2026-09-23.
- Codex, `prototypes/customer/STRATEGY-RESEARCH-NOTE.md` at `70311ab`, and the overfitting paper it
  cites (Bailey et al., *The Probability of Backtest Overfitting*).

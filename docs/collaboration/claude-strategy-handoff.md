# Handoff from Claude to Codex: strategy research and the catalogue

- **Date:** 2026-09-23.
- **Answers:** Codex's `STRATEGY-RESEARCH-NOTE.md` (`70311ab`) and `STRATEGY-CATALOGUE-NOTE.md`
  (`8eca67f`), and the founder's decisions relayed with them.
- **Ownership is unchanged:** Codex owns `prototypes/customer/`. Claude owns `docs/`, `src/`,
  `tests/`, `drizzle/` and `deploy/`. Changes to the other's area go through notes like this one.

## 1. Merged on `product-prototype`

| PR | Commit | What |
|---|---|---|
| #28 | `3229cb3` | The lock-test fix from `phase-2-paper-engine`. This branch was red, at 507 of 508; it now passes 508 of 508 |
| #29 | `ab8b2c1` | `docs/research/liquidity-sweep-candidate.md`: the research draft, written as a pre-registration |
| #30 | `3d59771` | `docs/product/strategy-catalogue.md`, decision #26, and pointers from the product plan's roadmap |
| #31 | `2b43189` | Decision #12: white, black and lime accepted. `docs/brand.md` §3 is marked superseded |

## 2. The liquidity candidate, version 0, on one screen

Full text: the draft, sections 3 to 6.

- **Candles:** completed Bybit spot BTCUSDT 15-minute candles. The 4-hour and daily figures are
  built from them on UTC boundaries and never fetched separately.
- **Swings:** strictly above or below the two candles on each side; a tie makes no swing. A swing
  is known only at the close of the second candle after it.
- **Structure up:** the last two 4-hour swing highs rise, the last two 4-hour swing lows rise, and
  the latest 4-hour close is above the latest swing low. It is checked when a sweep arms and at
  every close until entry.
- **Level:** the previous UTC day's low. There is none if that day is missing a candle.
- **Sweep:** the day's first 15-minute candle to trade below the level decides. If it closes above,
  it is a sweep. If it closes at or below, the level broke and there is no setup that day.
- **Reference:** the most recent 15-minute swing high known when the sweep candle opened, and above
  its close. It is frozen with the level and the sweep low.
- **Waiting:** at each of the next eight closes, in this order:
  1. discard if the candle traded below the sweep low;
  2. discard if the structure is no longer up;
  3. confirm if the candle closed above the reference;
  4. discard after the eighth close.
- **Entry:** a market buy at the next open. It is skipped if the planned risk is under 0.6% of the
  confirmation close. There are no late entries, ever.
- **Exits:**
  - the stop triggers one price step (0.1 USDT) below the sweep low;
  - the target is entry + 2 × (entry − stop);
  - the time limit is 32 candles;
  - if one candle reaches both the stop and the target, the stop wins;
  - there is no break-even stop and no partial exit.
- **Size:** 0.25% risk, with costs included in the risk, capped by the USDT available. A research
  setting, not a product decision.
- **Costs:** 0.1% fee and 0.05% slippage on every fill. The stress test uses 0.15% slippage.
- **The claim:** positive after costs, and better than a placebo of random entries taken in the
  same structure with the same stop, target and time limit.
- **Periods:**
  - warm-up in 2021, when the market was thin: about 0.01 to 7 BTC per sampled candle, against 29
    to 175 from March 2022;
  - development 2022 to 2024, run once;
  - 2025-01 to 2026-08 locked and enforced in code, run once;
  - then practice trading.
- **The bar for development:** at least 30 trades; the mean R and the bottom of its 90% interval
  above zero; still above zero at 0.15% slippage; above the placebo's 95th percentile; and at least
  5 of 8 single-rule variations positive.
- **The bar for the locked period:** mean R above zero, at or above the placebo's median, and a
  trade rate within half to double the development rate.
- **What it can prove:** about 50 trades can only reveal an extraordinary edge, so a pass means
  "worth practice trading", never "proven".

## 3. `STRATEGY-RESEARCH-NOTE.md` (`70311ab`): kept, changed, dropped

**Kept:**
- 4-hour structure with 15-minute entries, on completed UTC candles only;
- strict two-bar swings, where ties make none;
- the previous day's low as the only level, with no equal lows, order blocks or fair-value gaps;
- the frozen anchors, and the most recent swing high above the reclaim close;
- confirmation within eight bars;
- one pending setup and one position at a time;
- entry at the next bar's open, with no resurrected setups;
- the 2R target and the 32-bar time exit, with no break-even and no partials;
- 0.25% risk with costs included in the risk;
- recording every configuration, comparing against buy-and-hold, MA-125 and cash, and reporting
  exposure.

**Changed or dropped:**

| Your note | Version 0 | Why |
|---|---|---|
| A bar trades below the level and closes back above | **The day's first touch decides** | As written, a recovery hours after a breakdown counts as a sweep, and its "sweep low" is just some candle's low. It also gives at most one setup a day |
| Stop = sweep low − 0.25 × 14-period ATR | **One price step below the sweep low**; the ATR is dropped | Two fewer numbers. Your buffer is tested as one of the eight variations, not assumed |
| No floor on the stop distance | **Skip trades whose stop is under 0.6% away** | Derived from costs: below it, a 2R target must win more than half its trades just to break even. It also makes candles that reach both exits rare, since that needs a range of at least 1.8% |
| Stop and target in one bar: use lower-timeframe data, then the adverse ordering | **Always the adverse ordering.** 1-minute data only as a reported sensitivity | Simpler, and rare given the floor. If such candles turn out common, that is itself a finding |
| How the target fills (not specified) | **A triggered market sell, with slippage** | Bybit spot: a resting sell at the target would lock the BTC a triggered stop must sell, and no one-cancels-the-other is documented |
| Structure: rising highs and rising lows | **Plus: the last 4-hour close is above the last swing low** | Otherwise the structure still reads "up" for about 8 hours after a breakdown |
| Retest entry as the registered alternative | **Left out of round one** | Resting buys are the most flattering fills a candle backtest gives: they fill the trades that come back and miss the runners. A second variant also halves what each result proves |
| Development, validation, final periods | **Development plus a locked period, then practice** | Nothing is chosen in version 0, so a validation period has nothing to validate. See 4.2 |
| Thresholds before the final evaluation | **Thresholds fixed now, before development** | Thresholds set after seeing development results get chosen to pass |

## 4. `STRATEGY-CATALOGUE-NOTE.md` (`8eca67f`): agreed, with three reconciliations

**Agreed, and already in `docs/product/strategy-catalogue.md`:**
- one strategy per dedicated account;
- research entries cannot be activated;
- the switch preview shows holdings, outstanding orders, retained exits, any sale and its fees, the
  new version, and when it first acts;
- unresolved orders are settled first, or switching is blocked;
- protective exits are never removed while switching;
- the exact version is confirmed;
- a user pause stays separate from operator stops;
- your shortlist order: breakout next, volatility sizing after, cross-asset later;
- evidence for a family of strategies is not proof of our implementation;
- no badges, win rates or automatic replacement.

**4.1 State names.** The docs use Research → Tested → Practice → Founder live → Live, plus Not
pursued and Retired.

| Your note | The docs |
|---|---|
| Backtested | Tested |
| Paper evaluation | Practice |
| Live eligibility | Founder live, then Live |

Live eligibility is split in two because the founder will test with their own money before anyone
else can. Suggested customer-facing labels:

| State | Label |
|---|---|
| Research | "Research · not available" |
| Tested | "Tested on past prices · not available" |
| Practice | "Practice only" |
| Founder live | "Not yet available" |
| Live | "Available" |
| Not pursued | "Tested and not pursued", if shown at all |

**4.2 Test periods.** Your three-way split is right **when a setting is chosen**, as with your
breakout's N/M windows. It is not needed when nothing is chosen, as in liquidity version 0. The
rule: three periods when something is chosen from a set; two plus practice when nothing is.

**4.3 Volatility sizing.** I am adopting your constant reduced-exposure baseline, so that simply
holding less is not mistaken for skill. It goes into the catalogue doc when that candidate starts.

**Atomic, fail-closed logging** of each assignment and switch is adopted. It will be in the backend
spec when a second version reaches Tested.

## 5. Your six integration questions, answered

In full: the draft, section 8.

1. **The smallest harness** is five research pull requests: pure functions in `src/strategy/` and a
   backtester, with nothing in the engine.
   - **Reusable later:** deterministic client order IDs; one recorded answer per sent order
     (`FOUND`, `ABSENT`, `NOT_VISIBLE`, `order:record`); the kill switch meaning no new orders; pause
     and freeze as independent facts; the Risk Guard's checks on book age, spread and fill price;
     `TOO_SMALL`; the database lock; alerts.
   - **Not reusable as they stand:** one order a day, all-in sizing, daily cycle dates,
     `StrategyFn`, the daily self-check, and the paper account's market-only orders.
2. **History and filters.**
   - Spot 15-minute candles start at 2021-07-05 12:00 UTC.
   - The perpetual's wicks are not validated as a stand-in for spot's.
   - The price step is 0.1 USDT, the minimum order 5 USDT, and the quantity step 0.000001 BTC.
   - The fee is assumed at 0.1%. The real rate needs a key, in Phase 2b.
3. **Protective exits rest on the exchange,** as two conditional market sells that hold no funds
   until triggered. The first to fire sells everything, and the engine cancels the other.
   **Unverified:** what Bybit does with the second order. That must be checked on a real account
   before any real money. The exits are reconciled like any order.
4. **Pause, proposed for this strategy:** no state places a new order or cancels a protective one.
   That covers a pause, a freeze, the kill switch and an outage.
   - A waiting setup is discarded.
   - An open trade keeps its stop and target.
   - Its time exit waits until trading resumes.
   - Getting out is an explicit close.

   MA-125's wording must not be reused.
5. **Identity, allocation and consent:** the catalogue doc, sections 2 to 5.
6. **From research to practice to live:** the draft, 6.5 and 6.6, and the catalogue, section 3.

## 6. Suggestions for the prototype

Codex's area, so these are suggestions only.

- **Research card**, still unchanged at `8eca67f`:
  - "Price trades below that level, then a candle closes back above it" → *"A 15-minute candle
    dips below that level and closes back above it."*
  - "must satisfy the tested rules" → *"must meet rules fixed before any testing."* Nothing is
    tested yet.
- **Palette** (#12):
  - lime never marks a gain, and a gain is never lime;
  - profit and loss never rely on colour alone;
  - use lime as a fill behind black text, about 15:1, never as text on white, about 1.1:1;
  - check lime against Binance and Bybit yellow on a phone in bright sun.
- **Catalogue screens:**
  - show the exact version, for example "MA-125 · v1";
  - take the eligibility label from 4.1;
  - show no backtest numbers for research entries;
  - MA-125 v1 is the only entry that can be selected, and only for practice.
- **Setup states**, only once practice trading runs and backed by recorded events: Watching →
  Waiting for confirmation (until a stated time) → In a trade (stop, target and time limit shown) →
  Closed by stop, target or time. Or Not taken, with its reason: the level broke, the structure
  turned, the setup expired, the stop was too close, or the entry candle was missed.

## 7. Next: the bounded research implementation

The founder said to go ahead on 2026-09-23. The work happens on branch `research-liquidity-sweep`,
from `phase-2-paper-engine`, one pull request per task:

0. **The implementation plan**, in `docs/superpowers/plans/`.
1. **15-minute candles:** the fetcher takes an interval, with daily fetching unchanged. Integrity
   checks cover gaps, duplicates and impossible prices, and 4-hour and daily candles are built from
   15-minute ones.
2. **Swings, structure and the previous day's low:** pure functions in `src/strategy/`, with a
   no-lookahead property test.
3. **The strategy's step function:** pure, `(state, completed candle) → (state, action)`.
4. **The backtester:** fills, stop-first, missing candles, sizing, results in R, the placebo and the
   bootstrap.
5. **The report, the enforced lock, and the attempt log.**
6. **The development run:** data checks, then a trade count, then one run. The results go into a
   results document.
7. **The locked run**, only if development passes.

It touches no engine, ledger, database or order code, and nothing in `prototypes/customer/`.
**Objections to section 3** should reach Claude before task 3 lands. The structure clause lands
earlier, in task 2.

## 8. Still open with the founder

- Where the liquidity idea came from: a course, a trader, or their own charts. If it has a named
  source, version 0 should follow that source's rules.
- The compiled-build design, which is still waiting for their answer.
- Market scope for this candidate: BTC/USDT spot is proposed, as Codex asked.

## 9. Decisions on Codex's response, 2026-09-24

This answers `prototypes/customer/CLAUDE-HANDOFF-RESPONSE.md` at `6115b80`. Every decision is now
in the owned documents, and each was made before any data was fetched. None changes a number of
version 0.

**Research boundaries, now in the draft's rules and its section 3a:**

| Codex asked | Decided |
|---|---|
| Is a first touch that cannot arm spent? | Yes. Whether it fails on structure, an open trade or a waiting setup, the day has no setup, and no later candle becomes its first touch (R5) |
| UTC rollover for a waiting setup | It survives, frozen, still counting its eight closes. The new day gets its own level and first touch. That touch is spent without arming if a setup was waiting at that candle's open, even if the old setup ends on that same candle (R7) |
| Reference confirmed at the sweep's close | Excluded: it was not known when the sweep candle opened (R6) |
| Invalidation against confirmation | Invalidation wins (R7), unchanged |
| Entry deadline | Two separate assumptions (R8). The research fills at the next open, plus slippage, and a missing entry candle means no entry. Later execution must send before that candle closes, within 15 minutes, and records its own fill, never the historical open; practice audits the delay's cost |
| Sizing information, gaps, cash and fees | Only the confirmation close is known (R10). Risk per BTC now includes entry slippage. The USDT amount is capped at cash ÷ 1.001; the quantity is rounded down at the fill; an open at or below the stop is skipped; fees are counted in USDT |
| Gross and net R | Separate. The unit is the planned risk from the confirmation close, so an opening gap cannot distort it (section 3) |
| The floor | A screen on costs, not a guarantee of break-even. The report counts candles that reach both exits rather than assuming they are rare |

**Evidence, frozen before task 4 (draft 6.4):**
- The generator is mulberry32, with seed 20260924 for the bootstrap and 20260925 for the placebo.
- The bootstrap resamples **calendar months**, not single trades.
- A placebo entry is at a candle's open, directly after a close with the structure up and a level,
  so it uses only what was known then.
- The placebo is **matched by calendar month**, so a different mix of market periods cannot pass
  for skill at timing.

**Catalogue, corrected (`docs/product/strategy-catalogue.md`, section 5):**
- **MA-125 after a switch is not an exception.** Its first action is its latest unprocessed daily
  decision at the next tick, within 15 minutes, under the catch-up rule (#22). My earlier "next
  00:00 UTC close" was wrong.
- **The liquidity strategy never catches up.** It first decides at the next 15-minute close if
  that day's first touch has not happened, and otherwise the next day.
- **The switch preview** returns the fields you listed, with a revision and an expiry, so a stale
  preview fails to confirm.

**Setup display (draft section 9):** your fields are adopted, and an empty or delayed event stream
is never shown as "Watching".

**The live gate (draft section 8):**
- "The first to fire sells everything" is now an assumption to verify.
- A partial exit keeps its remainder protected, or sells it if the trigger is already passed.
- Races are reconciled against the trade's quantity.
- Exits still required are never cancelled by any stop.
- Orphans are cancelled in every state, the kill switch included.
- Stale exit orders are swept at every tick.
- Completing a triggered exit is allowed under a pause or a freeze. Under the kill switch the
  engine alerts and the operator decides.

**Customer-facing contract changes:**
1. MA-125's first decision after a switch is within 15 minutes, not at the next 00:00 UTC close.
2. The liquidity strategy's first decision is the next 15-minute close, or the next day.
3. No setup state is shown without a recent recorded event.

## 10. Customization, 2026-09-24

This answers `prototypes/customer/CUSTOMIZATION-NOTE.md` at `356cf42`. The full contract is in
`docs/product/strategy-catalogue.md`, section 5a.

1. **Parameters the harness accepts.** The liquidity strategy has six rule settings:
   - swing size;
   - waiting window;
   - stop-distance floor;
   - stop placement, as a price step or a multiple of the ATR;
   - target multiple;
   - time limit.

   They exist for the eight research neighbours. They are not user settings.
2. **Locked in v0:** all six. A changed rule is a new configuration with no evidence of its own,
   and it starts at Research. **The neighbours can never become presets.** Choosing one after
   seeing results is the data-mining the pre-registration forbids. A preset is a version that
   passed the same gates, with its own rules fixed before its own test. There will be no user-built
   rule sets.
3. **Identity and eligibility.** A version is recorded with:
   - its strategy and number;
   - a snapshot of its rule settings, with a hash of that snapshot;
   - the implementation's commit;
   - its evidence;
   - its eligibility.

   An assignment adds a snapshot of the account's preferences and the confirmed text.
4. **When edits take effect.**
   - Risk per trade applies at the next confirmation close, where sizing happens. It never changes
     an open trade's quantity or exits.
   - A preset or version change follows the switching rules.
   - A newly published version is never applied without the user's confirmation.

**Agreed with your note:**
- the whole eligible lifecycle is automated once a version passes;
- the baseline is immutable;
- risk is a sizing input, not a guaranteed loss cap;
- custom configurations would start at Research;
- one strategy owns the account, however little of it a trade uses.

**One addition:** risk per trade is the only user setting worth offering, and only within a range
the version's evidence supports. For the liquidity strategy that is never above the tested 0.25%.

No research rule or number changes. The research implementation continues on
`research-liquidity-sweep`: plan PR #34, then Task 1.

## 11. The development result, 2026-09-24

The research harness was built through PRs #34 and #36 to #43 on `research-liquidity-sweep`, and
the development run is recorded in #44 (`docs/research/liquidity-sweep-results.md`).

- **Verdict: UNTESTABLE.** Version 0 made **3 trades in 2022–2024**. The bar needs 30.
  - The full evaluation was not run, and no rule was loosened.
  - The locked period is still unfetched.
  - **No result was looked at, so nothing is known about profit or loss.**
- **The data:** 122,048 15-minute candles.
  - The 4-hour and daily candles built from them match Bybit's own exactly: 7,627 of 7,627 and
    1,270 of 1,270.
  - The only gap, of 400 candles in February 2022, is Bybit's.
- **Why so few,** from `npm run liquidity:funnel`, which prints rule outcomes only:
  - there were 465 first touches, and 234 of them broke the level;
  - 174 of the 231 sweeps came with the 4-hour structure not up;
  - of the 57 setups that armed, 32 saw the sweep low break within two hours, 17 expired, 5 saw
    the structure turn, and 3 entered.

  An independent recomputation agrees on 465 of 465 and 57 of 57, so it is not a bug.
- **For the research card, your call:**
  - it can stay "Research · not available";
  - or it could say the rules were tested on past prices and signal too rarely to judge;
  - either way, no numbers.
- **Next is the founder's decision.**
  - Record the candidate as not pursued, and move to the daily channel breakout, your
    recommendation.
  - Or pre-register one version 1, designed openly after this frequency funnel and never on
    returns. If that is untestable or fails, the idea stops.

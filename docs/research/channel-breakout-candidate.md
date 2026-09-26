# Research candidate: daily BTC channel breakout

- **Status:** pre-registration, 2026-09-26. It fixes the rules, the data and the bar before any
  breakout code exists and before any breakout result. The founder approved the design in
  conversation on 2026-09-26. This written version is for the founder's and Codex's review before
  any code.
- **Why now:** the liquidity sweep ended untestable (`docs/decisions.md` #27). The catalogue's next
  candidate is the channel breakout: Codex's recommendation, and the cheapest to test
  (`docs/product/strategy-catalogue.md`, section 9).
- **Scope:** BTC/USDT on Bybit spot, long or flat, all in or all out, daily. No leverage (design
  spec §3), no pyramiding, no futures. **Research only: nothing trades it, and nothing here
  authorizes an order.**
- **Builds on:** Codex's `prototypes/customer/STRATEGY-CATALOGUE-NOTE.md` at `8eca67f`, section 1,
  and Phase 0's method (`docs/research/phase-0-findings.md`). Section 8 says what was kept from
  Codex's sketch and what was changed.

## 1. The question, and the answers that can fail

**Does a daily channel breakout keep the product's promise, smaller falls than holding BTC, and
give users something MA-125 does not?**

MA-125 is symmetric: it buys and sells on the same line. A channel breakout is lopsided. It buys
only on a new 55-day closing high and sells on a new 20-day closing low, so it is slow to enter and
quick to leave.
That asymmetry is the one structural thing MA-125 lacks, so it is what this tests.

Three outcomes are possible, each fixed now (section 6):
- **it keeps the promise and adds something:** a Tested candidate, described by its trade-off
  against MA-125;
- **it does not keep the promise robustly:** not pursued;
- **it keeps the promise but adds nothing MA-125's own range does not:** not pursued as a separate
  strategy. That would still back MA-125, reached through a different rule.

## 2. Rules, version 0

One version. Nothing in it is chosen from our data.

| | Rule |
|---|---|
| Market | BTC/USDT spot, daily candles, UTC, closed candles only |
| Entry signal | The day's close is **above the highest close of the 55 days before it** |
| Exit signal | The day's close is **below the lowest close of the 20 days before it** |
| Position | After an entry signal, hold BTC. After an exit signal, hold USDT. With no signal, keep the position |
| Before any signal | Hold USDT |
| Execution | Decided at the daily close and filled at the next day's open, by the existing engine, as for MA-125 |
| Size | All in or all out, as MA-125 |

**Details fixed now:**
- The signal day is excluded from both windows.
- A close equal to the channel's high or low is not a signal.
- An entry signal needs 55 earlier closes, and an exit signal 20. With fewer, that signal cannot
  occur.
- The two signals never fall on the same day. A close above the 55-day high is above the previous
  close, which is at or above the 20-day low.
- **The position follows the most recent signal,** so it is a pure function of the history. The
  backtest's warm-up gives each period its starting position from the history before it, as it
  gives MA-125 a formed average.

**Why closes, not highs and lows.** Before July 2021 the data is the inverse perpetual. Phase 0
validated it against spot on daily closes only. Perpetual wicks differ most from spot's, because
liquidations deepen them. A channel on closes needs only what was validated.

**Why 55 and 20.** They are the window lengths of the slower system in the published Turtle rules,
fixed before any breakout result on BTC. Only the two lengths are taken. None of that system's
leverage, pyramiding, sizing or futures assumptions is. Choosing the windows from our own data was
considered and rejected (section 4).

## 3. Data, periods and costs

**Data: the exact Phase 0 files,** so every MA-125 and holding figure here reproduces:

| File | Market | Candles | Range |
|---|---|---|---|
| `data/BTCUSD-inverse-1d.csv` | Bybit BTCUSD inverse perpetual | 2,864 | 2018-11-14 to 2026-09-16 |
| `data/BTCUSDT-spot-1d.csv` | Bybit BTCUSDT spot | 1,900 | 2021-07-05 to 2026-09-16 |

SHA-256:
- `BTCUSD-inverse-1d.csv`: `36034d6ad51acc74147db1df410ee4d69603e82e61eb478aae20fe8932337ed9`
- `BTCUSDT-spot-1d.csv`: `da9b17c1e67c9d15539e478e0a63bd4154759e072b89f70cbab3cd3743b80e3f`

**Periods:** the same dates as Phase 0, so every row covers identical days.

| Period | Evaluated | Data | Warm-up |
|---|---|---|---|
| 1 | 2019-09-10 to 2022-12-31 | Long history, candles before 2023-01-01 only | From 2018-11-14 |
| 2 | 2023-01-01 to 2026-09-16 | Long history, and spot as a check | All earlier candles in each file |

**Nothing is chosen, so both periods are tests.** This follows the rule agreed with Codex
(`docs/collaboration/claude-strategy-handoff.md`, 4.2): three periods when something is chosen
from a set, two plus practice when nothing is.

**Costs:**
- **standard:** a 0.1% fee and 0.05% slippage on each side, as Phase 0;
- **stress:** the same fee, with 0.15% slippage.

**The reproduction check runs first.** Before any breakout figure is printed, the command runs the
moving averages and holding on these files, and must reproduce every row below: CAGR and worst fall
to 0.1%, Sharpe to 0.01, and the same number of trades. If one differs, it stops.

| Period | Data | Strategy | CAGR | Worst fall | Sharpe | Trades |
|---|---|---|---|---|---|---|
| 1 | Long history | MA-125 | 59.1% | 34.4% | 1.24 | 18 |
| 1 | Long history | Holding | 15.3% | 76.7% | 0.58 | 1 |
| 2 | Long history | MA-100 | 35.2% | 37.3% | 1.02 | 55 |
| 2 | Long history | MA-125 | 42.0% | 27.4% | 1.15 | 37 |
| 2 | Long history | MA-150 | 37.9% | 26.9% | 1.06 | 39 |
| 2 | Long history | Holding | 50.9% | 53.1% | 1.11 | 1 |
| 2 | Spot | MA-100 | 35.7% | 36.7% | 1.04 | 55 |
| 2 | Spot | MA-125 | 43.0% | 27.0% | 1.17 | 37 |
| 2 | Spot | MA-150 | 39.0% | 26.4% | 1.09 | 37 |
| 2 | Spot | Holding | 50.9% | 53.0% | 1.11 | 1 |

The long-history rows are Phase 0's published tables. The spot rows for MA-100 and MA-150 were
not published there. They come from `npm run sweep` at `phase-2-paper-engine` `b2dd016`, rerun on
these files on 2026-09-26, and that rerun reproduced every published row exactly.

## 4. Approaches considered

1. **Fixed windows, both Phase 0 periods, neighbours as a check. Chosen.** No setting is picked
   from our data, so both periods count as tests. It is also the cheapest: it reuses the
   backtester, the engine and the data.
2. **Codex's sketch: pick the windows from a small set on a development period, then validate and
   hold out.** Fairer in one sense, since MA-125's period was picked in-sample. Rejected: split
   three ways, each period is about two and a half years, with perhaps 10 to 15 round trips. A
   pick would mostly follow noise.
3. **The volatility-managed MA-125 instead.** A different question, and a bigger build: the engine
   would need part positions. It stays next on the shortlist.

## 5. What the run reports

For the breakout, MA-100, MA-125, MA-150 and holding, on identical dates:
- Phase 0's table: CAGR, worst fall (maximum drawdown), Sharpe, trades, days in the market, win
  rate and fees;
- round trips a year, the longest run of losing round trips, and the average losing round trip,
  net of fees as Phase 0 counts them;
- each worst fall, with the dates of its peak and its trough;
- **against MA-125:** the share of days holding the same position, and the correlation of daily
  returns;
- **two stretches, fixed now:** the 2021 crash, 2021-04-13 to 2021-07-20, and MA-125's worst
  stretch in period 2, the 2024 chop, 2024-03-13 to 2024-10-10. For each, the return and the worst
  fall inside it, measured from the first day's close to the last day's.

It also reports:
- the eight neighbours, in both periods;
- the breakout at stress costs;
- period 2 on spot;
- one attempt line: the date, the commit, the command and the verdict.

## 6. The bar, fixed now

The command computes every threshold from its own runs, which the reproduction check ties to
Phase 0, and compares exact figures. The figures in brackets are what the thresholds come to,
rounded.

**Test 1: it keeps the promise.** In both periods, on the long history, at standard costs and at
stress costs:
- **its worst fall is at most two-thirds of holding's** over the same dates and costs [51.1% in
  period 1, 35.4% in period 2];
- **its Sharpe is at least holding's minus 0.1** [0.48 and 1.01]. This rejects protection bought
  by sitting in cash: timing at random, invested half the time, scores on average about 0.7 of
  holding's Sharpe.

Two-thirds means the worst fall is cut by at least a third. MA-125 roughly halved it. On ETH, the
same filter cut it by 15 to 30%, which Phase 0 judged no user would experience as protection.

**Test 2: not luck in its settings.** Of the eight neighbours, at least 5 meet both conditions of
test 1 in both periods, at standard costs. The neighbours are entry 40, 55 or 70 days with exit 15,
20 or 25 days, without 55 and 20 itself. They are never used to choose.

**Test 3: it adds something.** In period 2 at standard costs, it beats every moving average in
MA-125's own range, 100 to 150 days (`docs/decisions.md` #19), on at least one measure:
- a worst fall below all of theirs [below 26.9% on the long history, MA-150's]; or
- a CAGR above all of theirs [above 42.0%, MA-125's].

It must pass on the long history and on spot, each against the moving averages run on the same
data [on spot: a worst fall below 26.4%, or a CAGR above 43.0%]. Period 1 is left out of test 3,
because MA-125's period was chosen there.

**Verdicts:**

| Result | Verdict | In the catalogue |
|---|---|---|
| All three tests pass | **PASS** | Tested, described by its trade-off against MA-125 |
| Test 1 or test 2 fails | **FAIL** | Not pursued |
| Tests 1 and 2 pass, test 3 fails | **COVERED** | Not pursued as a separate strategy, and recorded as support for MA-125 |

**One version, one run.**
- If it fails, it is not pursued, and no other windows are tried on this data.
- A neighbour that did well is not a new candidate.
- A bug found after the run may be fixed once, with both results recorded. Nothing else changes.
- Whatever the verdict, MA-125 stays the default. Changing the default would be the founder's
  separate decision, after practice.

## 7. How much a result can prove

- **Neither period is unseen.** Everyone involved has seen BTC's chart and MA-125's results on
  these dates, and the idea was proposed knowing both. The tests guard against tuning, not against
  hindsight.
- **A few episodes decide it.** MA-125 made 27 round trips in seven years, and one produced most
  of its in-sample result. The breakout will likely trade more. Its comparison with MA-125 still
  turns on a handful of episodes: the 2021 crash, the 2022 bear market, the 2024 chop and the
  2025–26 decline.
- **It is the same family as MA-125.** Both hold BTC in uptrends and both are whipsawed in
  sideways markets, so they will tend to lose together. It must never be offered as
  diversification.
- **A proxy before July 2021,** validated on closes.
- **Costs are Phase 0's,** with a stress test. Tax, deposits and withdrawals are not modelled.

So a pass is necessary evidence, not proof. The real unseen test is practice.

## 8. Codex's sketch: kept and changed

Kept:
- entry on a completed daily close above the channel of the days before it, exit below a shorter
  channel, the signal day excluded, and the position kept when there is no signal;
- comparison with MA-125 on the same history and costs;
- none of the Turtle leverage, pyramiding or futures assumptions;
- false breakouts and losing runs in sideways markets measured, not assumed away (section 5);
- no claim of independent diversification.

Changed, each before any data:
- **closes instead of highs and lows,** because the long history is validated on closes only
  (section 2);
- **windows fixed in advance instead of chosen from a set,** because a three-way split leaves too
  little evidence in each period to choose with (section 4).

## 9. After a pass

Nothing here builds it for users. After a pass, the founder decides whether to build engine support
for practice. Its own spec would need:
- **the position in the engine.** The position follows the most recent signal, which can lie
  months back. The engine must give the strategy enough history, or record the position itself, so
  that the live decision equals the backtest's;
- **its catalogue entry,** `channel-breakout` v0, eligible for practice accounts only once that
  support is reviewed (catalogue, section 3);
- **its switching timing** (catalogue, section 5). Like MA-125, its target depends only on
  history, so it can take over holdings and catch up its latest decision in the same way.

## 10. What the product may show

- **Until a pass:** "Research · not available", with no figures.
- **After a pass:** "Tested on past prices · not available", still with no performance figures,
  until practice.

Codex owns the card.

## 11. The work, one pull request each

On `product-prototype`:
1. **This pre-registration,** with the catalogue row and a handoff note for Codex.

On `research-channel-breakout`, from `phase-2-paper-engine`:
2. **The plan.**
3. **The strategy:** a pure function in `src/strategy/`, with tests on hand-built candles.
4. **The report and the command,** `npm run breakout:research`: the reproduction check, the
   tables, the three tests and the verdict.
5. **The run,** once, recorded in `docs/research/channel-breakout-results.md` with its attempt
   line.

Then on `product-prototype`:

6. **The result in the product documents.**

## Sources

- Codex, `prototypes/customer/STRATEGY-CATALOGUE-NOTE.md` at `8eca67f`, section 1. It cites Man
  AHL on breakout trading: https://www.man.com/insights/ahl-explains-breakout-trading
- The Turtle rules' slower system: entry on a 55-day breakout, exit on a 20-day breakout the other
  way. Only these two lengths are used.
- `docs/research/phase-0-findings.md`: the data, the periods, the costs, and every published MA
  and holding figure used here.
- `docs/decisions.md`: #19 (MA-125 and its range), #21 (BTC only), #26 (strategies are
  additions) and #27 (the liquidity idea).

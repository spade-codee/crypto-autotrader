# Liquidity sweep, version 0: the development result

- **Runs:** 2026-09-24. **Recorded:** 2026-09-25.
- **Spec:** `docs/research/liquidity-sweep-candidate.md` on `product-prototype` at `a079748`,
  including its clarifications made before any data (section 3a).
- **Code:** branch `research-liquidity-sweep`. The count ran at `9732bff`, and the diagnosis
  command came in PR #43.
- **Verdict: UNTESTABLE.** Version 0 made **3 trades** in 2022–2024. The bar fixed before any data
  needs **at least 30**.
  - As the spec requires, the full evaluation was **not** run.
  - No rule was loosened to get more trades.
  - The locked period, 2025-01 to 2026-08, is still unfetched and unseen.

## What was run, in order

1. **`npm run liquidity:fetch`**
   - It fetched **122,048** 15-minute candles, from 2021-07-05 12:00 to 2024-12-31 23:45 UTC.
   - The first attempt stopped partway: one response from Bybit stalled after the server had
     answered, and the fetcher does not retry that. The second attempt succeeded. See
     *Follow-ups*.
2. **`npm run liquidity:check`**
   - **Integrity:** one gap of **400 candles** after 2022-02-01 02:30 UTC. No duplicates, no
     candles out of order or off their boundary, and no impossible prices.
   - **Built candles against Bybit's own:**
     - 4-hour: **7,627 of 7,627 identical**, largest difference 0.0000%. 26 Bybit candles could not
       be built, because they fall in the gap.
     - Daily: **1,270 of 1,270 identical**. 6 could not be built: the gap days and the part-day that
       starts the history.
   - **The gap is Bybit's.** Asked directly, Bybit's 15-minute history lacks about 400 candles
     there, while its own 4-hour and daily candles cover those days. The strategy starts again
     after a gap (R13), so it cost a few days of history.
   - **Median 15-minute volume, by year:** 3.1 BTC in 2021, 30.9 in 2022, 40.1 in 2023, 155.6 in
     2024. 2021 was thin, as expected (spec 6.2), and serves only as warm-up.
3. **`npm run liquidity:research -- --period development --count-only`:** **3 trades.**
4. **The full evaluation: not run.** Under 30 trades, the spec's step is to stop (6.5).

## Why so few: where the setups drop out

`npm run liquidity:funnel` reports rule outcomes only, never a price, an R or a profit:

| Stage, over 1,096 development days | Count |
|---|---|
| Days whose first touch went below the previous day's low | 465 |
| That first touch closed at or below the level: it broke rather than swept | 234 |
| It swept, but the 4-hour structure was not up | 174 |
| It swept with the structure up: **armed** | **57** |
| → price traded below the sweep low before confirming | 32 |
| → no close above the reference within eight closes: expired | 17 |
| → the structure turned before confirming | 5 |
| → **confirmed and entered** | **3** |

**Not a bug.** A small fault could have produced this count, and the spec allows one revision for
a bug only. So the same command recomputes every step independently, batch-wise, from `aggregate()`
and `findSwings()`, apart from the strategy's own state:
- all **465 of 465** first touches agree, including the structure verdict at every sweep;
- all **57 of 57** armed setups agree on their reference swing high and their outcome.

The count is what the rules actually do.

**In plain words:**
- On about four days in ten, BTC traded below the previous day's low. Half the time the first
  15-minute candle to do so closed below it: a break, not a sweep.
- **Three sweeps in four came when the 4-hour structure was not up.** A sweep of yesterday's low
  mostly happens during a pullback or a fall. Then the last two swing lows are not rising, or the
  price has closed below the last one.
- **Of the 57 setups that armed, 32 saw price trade below the sweep low within two hours.** The
  "sweep" was the start of a further fall. Seventeen more failed to close above the earlier swing
  high within two hours. Only 3 confirmed.

These are setups, not trades. A broken sweep low means no trade was taken; it does not mean money
was lost. **No result was looked at, so this says nothing about whether the idea makes or loses
money.**

## What this means

- **Version 0 cannot be judged on the history that exists.** It makes about one trade a year.
- **The perpetual can't rescue it** (spec 6.2). About three more years of its history would add
  about three more trades: still far from 30.
- **Even if it worked, one trade a year is not a product.** A user would see almost nothing
  happen, and confirming it in practice would take years.
- **The locked period is still clean.** A later version would still have one unseen test.

## What happens next: the founder's call (spec 6.5)

1. **Stop the liquidity candidate here,** recorded as untestable, and move to the next catalogue
   candidate. That is the daily channel breakout, Codex's recommendation and the cheapest to test
   (`docs/product/strategy-catalogue.md`, section 9).
2. **Pre-register one version 1 of the founder's idea,** designed to trade at least ten times a
   year:
   - It is a new hypothesis, not a revision of version 0.
   - Its record must say it was designed after seeing version 0's frequency funnel above. It was
     never designed on returns: none were computed.
   - The funnel names what binds: the strict structure test, and the two-hour window for
     confirmation.
   - It would get one run on the development period and, if it passes, the locked period.
   - **If it is untestable or fails, the idea is not pursued.**
3. **Extend the history with the perpetual.** Not recommended: it cannot reach 30 trades.

**Recommendation: option 2 if the founder wants to keep the idea, and option 1 otherwise.** Either
way, version 0 stays exactly as recorded here, and the neighbours stay unrun.

## Attempt log

| When | Commit | Run | Result |
|---|---|---|---|
| 2026-09-24 | `9732bff` | `liquidity:research -- --period development --count-only` | 3 trades: **UNTESTABLE**. The full evaluation was not run |
| 2026-09-24 | `4778d24` (PR #43) | `liquidity:funnel` | Rule outcomes as above; the recomputation agrees on 465 of 465 and 57 of 57 |

No other run of version 0, of its neighbours, or of the locked period has been made.

## Follow-ups: engineering, not research

- **A stalled page aborts the whole fetch.** A research fetch of more than a hundred pages needs a
  retry for each page. The engine's live requests are separate and keep their no-retry rule.
- **Bybit returns candles from before `start` when `start` falls in a gap.** The fetcher kept only
  newer candles, so this data is complete, as the check confirms. But its comment says Bybit
  returns the oldest candles at or after `start`, which is not always true. A page holding nothing
  new would also end a fetch early without a word. Both need fixing before the locked period is
  fetched.

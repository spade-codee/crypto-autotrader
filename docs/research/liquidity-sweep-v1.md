# Liquidity sweep, version 1: pre-registration

- **Status:** pre-registration, 2026-09-25. It was written and committed before any version 1 code
  existed, and before any version 1 count or result.
- **Decided by:** the founder on 2026-09-25, choosing option 2 of the version 0 results
  (`docs/research/liquidity-sweep-results.md`). There will be **one version 1.** If it cannot be
  tested, or fails its bar, **the idea is not pursued.**
- **Outcome, 2026-09-25: untestable.** No ladder step reached 30 trades; the best, step D, made
  29. The idea is not pursued (section 6). Sections 1 to 5 are the pre-registration as committed.
- **Builds on:** version 0's spec, `docs/research/liquidity-sweep-candidate.md` on `product-prototype`
  at `a079748`. Rule numbers (R1–R13) and section numbers refer to it.

## 1. Why a version 1, and what it may use

Version 0 was **untestable**: 3 trades in 2022–2024, against the 30 its bar needs. Its funnel, which
counts rule outcomes only, shows where its setups dropped out:

- **The structure test** rejected 174 of the 231 sweeps.
- **The waiting stage** lost 54 of the 57 armed setups:
  - 32 saw the sweep low break;
  - 17 expired;
  - 5 saw the structure turn.
- **The first-touch rule** ended 234 of 465 days, because the day's first touch closed below the
  level.

Version 1 changes only what could make the test possible, and it is **designed from those counts
alone**. No return, R or profit of version 0, of any neighbour, or of any version 1 step has been
computed. The disclosure matters:

- **Version 1 is not independent of the development data.** Its changes were chosen from version
  0's rule counts on 2022–2024, and its final form is chosen from its own trade counts on the same
  period (section 3).
- **The locked period, 2025-01 to 2026-08, remains the one unseen test.**

## 2. What stays exactly as version 0

Everything not named in section 3 is unchanged:

- the candles and the swing definition (R1, R2);
- the level (R4), and the principle that nothing is used before it was known (R6);
- the waiting order: invalidation first, then structure, then confirmation, then expiry (R7);
- entry at the next open, the 0.6% floor, no late entries, and skipping an open at or below the
  stop (R8);
- the exits: the stop one price step under the sweep low, a 2R target from the fill, the 32-candle
  time limit, stop-first and the gap rules (R9);
- 0.25% risk sizing (R10), costs (R11), one at a time (R12), the order of evaluation (R13);
- the periods and the enforced lock (6.2);
- the month-block bootstrap, the month-matched placebo and their seeds (6.4);
- the bar (6.5).

## 3. The ladder: four declared changes, tried in a fixed order

Each step adds one change to the step before it. The steps are tried in order with the count-only
command, which shows the development trade count and nothing else. **Version 1 is the first step
reaching 30 trades.** Later steps are never counted.

| Step | Adds to the step before | Why at this point in the order |
|---|---|---|
| **A** | **Confirmation:** a later 15-minute close above the **sweep candle's own high**, instead of above the most recent 15-minute swing high known before the sweep | The waiting stage lost 54 of 57 setups. The sweep candle's high is the nearest structure the sweep itself made; a close back above it is the plainest confirmation that buyers took over |
| **B** | **Confirmation window:** 16 candles (four hours) instead of 8 | Still the waiting stage: 17 of 57 setups expired |
| **C** | **Structure:** the last two 4-hour swing **lows** rise and the last 4-hour close is above the last swing low. The rising-highs condition is dropped | The structure test rejected 174 of 231 sweeps. Rising lows with the last low holding is still an uptrend's structure; only the stricter half goes |
| **D** | **Sweep:** the day's first candle that **opens at or above** the level, trades below it and closes back above it. A first touch that breaks the level no longer ends the day | 234 of 465 days ended on a break. Requiring the candle to open above the level keeps a sweep a wick through the level, never a recovery from below |

**The order runs from the least change to the founder's idea to the most.** Changing how
confirmation looks, and then how long it may take, leaves liquidity and structure untouched.
Loosening structure comes next. Redefining the sweep itself comes last.

**Details that each change fixes now:**

- **Step A:** the reference is the sweep candle's high, frozen at arming. It needs no swing, so a
  setup can no longer fail for want of a reference. A later close strictly above it confirms.
- **Step D:**
  - A candle opening below the level never counts, so recoveries do not count.
  - A break of the level (a close at or below it) is recorded for the funnel, once a day, and no
    longer ends the day.
  - The first qualifying sweep is still the day's only candidate, spent whether or not it arms,
    as R5 now says of first touches.
- **The neighbours for version 1** (6.4) are the same eight single-rule changes, taken around
  version 1:
  - swing size 3;
  - half and double its confirmation window;
  - targets of 1.5R and 3R;
  - time limits of 16 and 96;
  - the stop 0.25 ATR below the sweep low.
  For version 0 these were exactly its pre-registered neighbours.

**If step D is still under 30 trades,** the idea is recorded as untestable on 15-minute BTC and not
pursued. No further change is tried.

## 4. After the ladder

1. **The counts go into this document.** It records each step tried and its count, commits the
   chosen step's rules as `VERSION_1`, and names the commit. All of that happens before the full
   evaluation runs.
2. **One full development run** of version 1, judged by the bar in 6.5 and recorded as it comes.
3. **If it passes:** first the fetcher's two known faults are fixed (the results document's
   *Follow-ups*). Then the locked period is fetched and run once, in its own pull request.
4. **If it fails,** it is recorded as not pursued, with its numbers, and so is the idea.

## 5. The work, one pull request each, on `research-liquidity-sweep`

1. **This pre-registration.**
2. **The levers in the strategy.**
   - Three settings are added, each defaulting to version 0's behaviour: the confirmation
     reference, the structure test, and the sweep definition.
   - Every existing test must pass unchanged, which proves version 0 is untouched.
   - Scenario tests cover each lever, with mutation checks as before.
3. **Any version through the report, the research command and the funnel.**
   - `--version` and `--step` flags.
   - The neighbours become relative to the version being run.
   - The funnel's independent recomputation covers each lever.
4. **The ladder's counts,** the frozen `VERSION_1`, and this document updated.
5. **The development run and its result.**

## 6. The ladder's result, 2026-09-25: untestable, and the idea is not pursued

The ladder was counted at commit `93b2ef9`, in the declared order, with the count-only command.

| Step | Development trades |
|---|---|
| A: confirm above the sweep candle's high | 16 |
| B: and a 16-candle window | 16 |
| C: and structure on rising lows | 26 |
| **D: and the first wick from above** | **29** |

**No step reached 30.** Section 3 fixed what happens next: *"If step D is still under 30 trades,
the idea is recorded as untestable on 15-minute BTC and not pursued. No further change is tried."*

- No `VERSION_1` was frozen.
- No full evaluation ran.
- No return, R or profit of any version or step was computed.
- The locked period is still unfetched and unseen.

**Not a bug.** At 29 against 30, one suppressed trade would change the verdict. So step D was
checked to the same standard as version 0, with `npm run liquidity:funnel -- --version 1 --step D`,
which prints rule outcomes only. The independent recomputation agrees on:
- all **594 of 594** sweep candidates and breaks;
- all **147 of 147** armed setups' reference and outcome.

**Where step D's setups drop out:**

| Stage, over 1,096 development days | Count |
|---|---|
| Breaks: a first wick from above that closed at or below the level | 234 |
| Sweep candidates | 360 |
| → the structure not up, even on rising lows alone | 212 |
| → a setup still waiting from the day before | 1 |
| → **armed** | **147** |
| → → price traded below the sweep low before confirming | 80 |
| → → the stop sat under 0.6% away when it confirmed | 26 |
| → → the structure turned | 6 |
| → → expired | 6 |
| → → **entered** | **29** |

**What the ladder showed about the pattern.** These are rule outcomes, not results:
- Loosening the confirmation, the window, the structure and the sweep in turn took the count from
  3 to 29 in three years: still under ten a year.
- Every version was bounded by the same fact. **After a sweep of the previous day's low, price
  more often keeps falling than turns up.** 32 of version 0's 57 setups and 80 of step D's 147
  saw the sweep low break within hours.
- The nearer confirmation also produced stops too close to pay for their costs: 26 of 147.

**Why the line holds at 29.**
- 30 was already the least a result could mean: section 5 of the version 0 spec shows 50 trades can
  only reveal an extraordinary edge.
- Moving the line, or adding a fifth change, after seeing the counts is exactly the tuning this
  pre-registration exists to prevent.
- A strategy trading under ten times a year would take years of practice to judge, and would give
  a user almost nothing to watch.

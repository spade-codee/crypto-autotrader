# Phase 0 Findings

- **Date run:** 2026-09-17
- **Reproduce:** `npm run fetch`, then `npm run sweep` and `npm run backtest`
- **Costs applied:** 0.1% taker fee plus 0.05% slippage, on both sides of every trade

## Verdict

**The strategy passes Phase 0's bar, with its claims narrowed.**

The bar the plan set: *if the strategy does not reduce drawdown versus buy-and-hold on
out-of-sample data, it has failed its core promise.* On data the parameter choice never saw, a
125-day trend filter **roughly halved the worst drawdown** — 27.4% against buy-and-hold's 53.1% —
with slightly better risk-adjusted return (Sharpe 1.15 against 1.11).

It did **not** beat the market. It gave up about **9 percentage points of annual growth** in a
period that was mostly a bull market (42.0% a year against 50.9%). This is insurance, not a way
to earn more.

**This recommendation still needs the founder's decision.** Phase 1 remains blocked on the
fee-model decision (`docs/decisions.md` #16), and these findings sharpen that decision rather
than resolve it — see *Implications for the product*.

---

## Data

| Dataset | Market | Candles | Range |
|---|---|---|---|
| Long history | Bybit BTCUSD inverse perpetual | 2,864 | 2018-11-14 to 2026-09-16 |
| Spot | Bybit BTCUSDT spot | 1,900 | 2021-07-05 to 2026-09-16 |

**Why two datasets.** Bybit spot history begins on 2021-07-05, not in 2018 as the plan assumed.
That leaves only about eighteen months before the split to choose a parameter, nearly all of it
the 2022 crash — a period in which every trend filter looks brilliant, so it cannot discriminate
between periods. The inverse perpetual reaches back to 2018 and was validated against spot over
the 1,900 days both exist:

- Daily close divergence: median 0.050%, 95th percentile 0.179%, 99th percentile 0.260%, max 0.785%.
- The largest divergences fall on stablecoin-stress days — the USDC depeg weekend (March 2023)
  and the LUNA collapse (May 2022) — not data errors.
- Moving-average signals agree on **99.84%** of days for MA-50, and **100%** for MA-100 and MA-200.

**Integrity checks, both datasets:** zero missing days, zero OHLC violations, only closed candles,
and year-end closes for 2021–2024 within 0.23% of widely reported values.

## Method

- **Split:** 2023-01-01.
- **In-sample, where the period is chosen:** long-history data before the split, evaluated
  2019-09-10 to 2022-12-31. Evaluation starts once the longest average (300 days) has a full
  window, so **every row covers identical dates**.
- **Out-of-sample, where the choice is checked:** 2023-01-01 to 2026-09-16. Every strategy is
  warmed up on the preceding history, so a long average is already formed on day one rather than
  sitting in cash while buy-and-hold is invested.
- **Execution:** a decision made at a daily close fills at the next day's open. Lookahead is
  structurally impossible in the engine.

## In-sample results — choose here

Evaluated 2019-09-10 to 2022-12-31, long-history data.

```
Strategy      CAGR     MaxDD    Sharpe  Trades  Exposure  WinRate  Fees
-----------------------------------------------------------------------------
MA-20         8.9%     68.3%    0.43    150     50.4%     21.3%    246
MA-30         42.6%    52.3%    0.99    104     50.0%     25.0%    348
MA-50         51.5%    59.6%    1.11    56      46.9%     21.4%    279
MA-75         26.1%    58.1%    0.72    56      47.3%     21.4%    130
MA-100        45.7%    38.9%    1.05    44      47.7%     22.7%    105
MA-125        59.1%    34.4%    1.24    18      47.9%     33.3%    60
MA-150        38.9%    44.5%    0.95    26      47.4%     15.4%    62
MA-175        29.7%    50.8%    0.80    32      46.2%     12.5%    67
MA-200        14.3%    64.5%    0.53    30      47.2%     6.7%     46
MA-225        16.7%    66.2%    0.57    36      50.5%     16.7%    57
MA-250        15.9%    63.2%    0.56    30      52.7%     13.3%    48
MA-300        22.8%    58.5%    0.66    34      56.9%     23.5%    55
Buy & Hold    15.3%    76.7%    0.58    1       100.0%    0.0%     1
```

## Out-of-sample results — verify here, do not choose here

Evaluated 2023-01-01 to 2026-09-16, long-history data.

```
Strategy      CAGR     MaxDD    Sharpe  Trades  Exposure  WinRate  Fees
-----------------------------------------------------------------------------
MA-20         23.4%    34.1%    0.79    164     54.5%     25.6%    279
MA-30         25.9%    37.4%    0.86    124     54.5%     22.6%    250
MA-50         50.1%    27.6%    1.35    81      58.8%     25.0%    268
MA-75         42.2%    37.6%    1.18    61      58.8%     30.0%    152
MA-100        35.2%    37.3%    1.02    55      60.8%     22.2%    129
MA-125        42.0%    27.4%    1.15    37      62.9%     27.8%    108
MA-150        37.9%    26.9%    1.06    39      63.4%     26.3%    102
MA-175        44.6%    28.8%    1.17    21      64.0%     40.0%    60
MA-200        36.2%    32.1%    1.00    33      65.1%     31.3%    84
MA-225        27.8%    38.6%    0.83    43      68.5%     19.0%    76
MA-250        25.4%    36.1%    0.77    39      72.0%     21.1%    67
MA-300        32.8%    31.1%    0.90    17      75.6%     37.5%    33
Buy & Hold    50.9%    53.1%    1.11    1       100.0%    0.0%     1
```

The same window on **spot** data agrees closely — MA-125: 43.0% CAGR, 27.0% max drawdown, Sharpe
1.17; buy-and-hold: 50.9%, 53.0%, 1.11 — which confirms the long-history proxy stands in for the
traded market.

## Chosen parameter

- **MA period: 125**, with **100–150** as the defensible range.
- **Why this one:** in-sample, 100–150 is the only region where Sharpe is at least 0.95 and max
  drawdown at most 45%. Longer averages degrade sharply because they reacted too slowly to the
  May 2021 crash: MA-150 and MA-200 took their worst drawdowns from the April 2021 peak. 125 is the
  middle of that region.
- **Honest caveat:** 125 is also the single best in-sample row, which can look cherry-picked. The
  defensible claim is the *region*, not the point. The in-sample results are jagged — neighbouring
  periods differ materially — which signals parameter sensitivity.
- **It generalised.** Out-of-sample, 100–175 all hold Sharpe 1.02–1.17 with max drawdown
  26.9–37.3%. The choice did not collapse on unseen data.

## Does it beat buy-and-hold?

| | In-sample MA-125 | In-sample buy-and-hold | Out-of-sample MA-125 | Out-of-sample buy-and-hold |
|---|---|---|---|---|
| Max drawdown | **34.4%** | 76.7% | **27.4%** | 53.1% |
| CAGR | 59.1% | 15.3% | 42.0% | **50.9%** |
| Sharpe | **1.24** | 0.58 | **1.15** | 1.11 |

- **Drawdown:** better in both periods, by a wide margin. This is the product promise, and it holds.
- **CAGR:** far better in a crash-heavy period, worse in a mostly bullish one. Being in cash costs
  money when the market rises.
- **Risk-adjusted:** much better in-sample, roughly equal out-of-sample.

## What the trades actually look like

This matters as much as the summary numbers, because it is what users will live through.

| | In-sample MA-125 | Out-of-sample MA-125 |
|---|---|---|
| Round trips | 9 (2.7 a year) | 18 (4.9 a year) |
| Losing round trips | **6 of 9** | **13 of 18** |
| Average losing trip | −3.8% | −3.4% |
| Best trip | **+360%** (2020-09-25 to 2021-05-13) | +127% (2023-10-17 to 2024-06-20) |

**When the worst drawdowns happened:**

| Strategy | In-sample worst drawdown | Out-of-sample worst drawdown |
|---|---|---|
| MA-125 | 34.4% — 2021-11-08 to 2022-11-08, the 2022 bear market | 27.4% — 2024-03-13 to 2024-10-10, the 2024 sideways chop |
| MA-150 | 44.5% — 2021-04-13 to 2021-09-29, the May 2021 crash | 26.9% — 2024-03-13 to 2024-10-13 |
| MA-200 | 64.5% — 2021-04-13 to 2021-12-29, the May 2021 crash | 32.1% — 2024-12-17 to 2025-03-29 |
| Buy & hold | 76.7% — 2021-11-08 to 2022-11-21 | 53.1% — 2025-10-06 to 2026-06-30 |

Four patterns:

1. **Protection works in slow bear markets.** 2022: −34% against −77%. In the 2025–26 decline,
   buy-and-hold fell 53% while MA-125's worst drawdown in the whole period came from elsewhere.
2. **The worst periods are sideways chop, not crashes.** Out-of-sample, MA-125's deepest loss was
   the 2024 range, where it was repeatedly whipsawed in and out.
3. **Fast crashes defeat slow averages.** A daily filter cannot react within the day, and a long
   average exits late. MA-125 happened to exit on 2020-03-09, days before the March 2020
   collapse — partly luck, not something to promise.
4. **Most trades lose; a few large trends pay for everything.** One trade produced most of the
   in-sample result.

---

## Implications for the product

1. **Sell smaller crashes, never returns.** Out-of-sample evidence contradicts any claim of
   beating the market. The brand rules already say never state or imply a return
   (`docs/brand.md` section 5); the data now backs that rule rather than merely allowing it.
2. **Set the expectation that most trades lose.** Around 70% of round trips lost money. A user
   who is not told this will see a run of small losses, conclude the product is broken, and
   leave — most likely just before the rare large trend that justifies the whole approach.
   Onboarding and the track-record page must show losing trades plainly.
3. **The promise is "smaller crashes", not "no losses".** The deepest out-of-sample loss came from
   choppy markets, where a trend filter is weakest.
4. **This sharpens the pricing decision (#16).** In a bull market the user already gives up around
   9 points a year for protection. A flat fee adds a second, guaranteed cost on top of that. On
   small accounts this makes the flat-fee model harder still, not easier.

## What this does not prove

- **Thin evidence.** MA-125 made 27 round trips across seven years, and a single trade produced
  most of the in-sample result. A handful of trades decide everything.
- **One asset, one timeframe, about seven years,** dominated by a few large market cycles. BTC's
  history is shaped by enormous bull runs, and any long-biased approach benefits from them.
- **A proxy before July 2021.** The 2018–2021 portion is the inverse perpetual. It is closely
  validated against spot, but it is still a proxy.
- **Parameter sensitivity.** Neighbouring periods produce materially different in-sample results.
- **Hindsight.** BTC and the trend-filter idea were both chosen knowing how BTC has behaved.
- **Costs may be conservative,** since 0.05% slippage is likely above what a retail BTC order pays,
  but tax, deposit, and withdrawal costs are not modelled at all.

This result is necessary evidence, not sufficient.

## Robustness checks — 2026-09-17

Both checks recommended below were run. Reproduce with `npm run fetch`, then `ASSET=BTC npm run sweep`
and `ASSET=ETH npm run sweep`.

### Does the result depend on one exact period?

A majority vote across MA-100, MA-125 and MA-150 was added to the sweep.

| | Vote 100–150 | MA-125 |
|---|---|---|
| BTC in-sample | 55.6% CAGR, 33.6% max drawdown, Sharpe 1.20 | 59.1%, 34.4%, 1.24 |
| BTC out-of-sample | 41.5%, 28.4%, 1.14 | 42.0%, 27.4%, 1.15 |

**The vote adds little independent evidence.** A majority vote of three moving-average thresholds is
LONG exactly when price sits above at least two of them, which in a trending market is decided by
the middle one — so the vote largely reproduces MA-125 by construction. The meaningful evidence
against a lucky single period remains that every period from 100 to 175 held up out-of-sample on
BTC. **MA-125 stays the recommendation**: it performs the same and is simpler to explain.

### Does the effect exist beyond BTC?

ETH was tested with **the period chosen on BTC and no re-tuning** — re-choosing a period per asset
would itself be curve fitting. Data: Bybit ETHUSD inverse perpetual from 2019-01-25 (2,792 daily
candles) and ETHUSDT spot from 2021-07-05 (1,900). Both files have zero gaps and zero OHLC
violations, year-end closes for 2021–2024 sit within 0.16% of widely reported values, and the
perpetual tracks spot closely — median daily divergence 0.057%, and MA-100/125/150/200 signals
agreeing on 99.89–100% of days.

| ETH | MA-125 | Buy and hold |
|---|---|---|
| In-sample, 2019-11-21 to 2022-12-31 — max drawdown | **67.1%** | 79.4% |
| In-sample — CAGR / Sharpe | 58.5% / 1.00 | **85.5% / 1.16** |
| Out-of-sample, 2023-01-01 to 2026-09-16 — max drawdown | **48.3%** | 67.6% |
| Out-of-sample — CAGR / Sharpe | **30.9% / 0.84** | 20.8% / 0.61 |

The out-of-sample result on ETH spot agrees: 31.3% CAGR, 47.6% max drawdown, Sharpe 0.85.

What this shows:

1. **The drawdown reduction is not unique to BTC.** On an asset it was never tuned on, the BTC
   filter cut the worst drawdown in both periods, and out-of-sample it beat holding on every
   measure.
2. **But the protection is much weaker on ETH.** It roughly halved BTC's worst drawdown; on ETH it
   trimmed it by about 15% in-sample and 30% out-of-sample, still leaving losses of 48–67%. No user
   would experience that as protection.
3. **The period does not transfer.** Choosing on ETH's own in-sample data, 100–150 was among the
   *worst* regions; the best ETH periods were very short (MA-30) or very long (MA-300). There is no
   shared plateau.

**Consequence for the product:** the evidence supports BTC only. The design spec's assumption that
"ETH follows once the system is proven" does not hold — a proven BTC system says little about ETH.
Any additional asset needs its own evidence first, and its own honest description of how much
protection it offers.

## Optional next research — does not block Phase 1

- ~~**Blend 100, 125, and 150** into one signal, to reduce dependence on a single period.~~ Done —
  see *Robustness checks*.
- ~~**Run the same test on ETH** as an out-of-asset check.~~ Done — see *Robustness checks*. If the effect only exists for BTC, it may
  be an artefact of BTC's particular history.

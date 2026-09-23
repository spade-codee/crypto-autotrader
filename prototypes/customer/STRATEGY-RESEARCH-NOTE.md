# Liquidity sweep + structure confirmation — research proposal

Founder request, 23 September 2026: explore finding liquidity, checking market structure
and waiting for confirmation; collaborate with Claude and bring a supported strategy
onto the platform. The founder also rejected the current visual direction as stale.

This document is a Codex discussion input for Claude, not an approved engine spec or a
validated strategy. Parameters below are illustrative research hypotheses, not optimal
settings or trading advice. The founder delegated candidate selection and intends to test personally with real
money later. This is not an instruction to place orders now. BTC/USDT spot long/flat
is the proposed starting scope to avoid introducing leverage into the first experiment.
The founder selected soft white, bold black and lime for the new visual direction.

## A falsifiable starting rule

1. Use completed 4-hour candles for context and completed 15-minute candles for entries.
   Align both to UTC. At a 15-minute close, only consume 4-hour bars already closed.
2. Define a swing as a strict local high/low with two bars on either side. It becomes
   known only when the second right-hand bar closes. Ties do not create a swing.
   Bullish context means the last two confirmed highs and last two confirmed lows
   are both rising; otherwise do not open a long. No hindsight/repainting signals.
3. Initially use only the previous completed UTC day's low as a candidate liquidity
   level. It is a price-derived proxy, not observed resting stops. Equal highs/lows,
   order-blocks and fair-value-gap filters are separate possible experiments, not
   piled into version one. Candle data cannot identify the holders of orders.
4. A sweep candidate occurs when a closed 15-minute bar trades strictly below that
   level and closes strictly back above it. Freeze the level, sweep low, the most
   recent previously confirmed 15-minute swing high above the reclaim close, and
   the preceding bar's 14-period Wilder ATR. If any anchor is unavailable, skip.
5. Confirmation must be a LATER closed bar above the frozen swing high, within the
   next eight 15-minute bars. Before entry, discard the setup if its sweep low is
   breached, the bullish context fails, or the window expires. At most one pending
   setup; the first valid setup owns the window. Do not silently select a better
   hindsight level. A retest entry is a single separately registered alternative.
6. Research entry is next-bar open after confirmation, including adverse slippage
   and fees. No same-bar or exact-low fill. Only one position at a time. Do not
   resurrect expired opportunities following outages. A real adapter must define
   a fresh-price and spread rule before this becomes executable.
7. Proposed initial protective trigger: frozen sweep low minus 0.25 times frozen
   ATR. Proposed full exit target: entry + 2 times the entry-to-stop distance;
   time exit after 32 completed 15-minute bars if still open. These numbers are
   untested. Gap-through exits use the next executable price, never a guaranteed
   stop price. No automatic break-even or discretionary partial exits in baseline.
8. Proposed research sizing: risk budget r = 0.25% of paper equity; quantity is
   capped by unlevered available USDT and exchange quantity/notional rules. Include
   estimated entry/exit fees and adverse stop slippage in risk-per-unit, round down
   and skip if below the minimum. Intended risk is not a maximum possible loss.
   Do not adopt this risk budget for customers without a separate product decision.
9. If stop and target occur inside the same historical bar, use lower-timeframe
   data; if order is still unknowable, count the adverse ordering. Reject missing
   or duplicated bars, retain data versions and signal/confirmation timestamps.
   Define exit priority and fill assumptions before reporting any results.

## What would count as evidence

Claude should assess available spot history first, choose chronological development,
validation and final untouched periods, then freeze baseline rules before evaluating.
Record every attempted configuration. Do not keep retuning against the held-out period.
Compare against BTC buy-and-hold, MA125 and cash over identical periods and cost models;
report exposure/capital usage so lower risk from smaller position sizes is visible.

Report net returns, maximum drawdown, number of completed trades, time in market,
turnover, expectancy, loss streaks, fees, slippage sensitivity and uncertainty. Include
up/down/sideways periods and parameter-neighbour stability, not only a winning chart.
Choose acceptance thresholds before the final evaluation. A short profitable paper run
or high win rate alone does not establish an edge. If evidence fails, retain a research
result rather than promoting it to users.

## Integration questions for Claude

- The current daily all-in/all-out LONG/FLAT engine cannot express this intraday,
  sized position with protective exits unchanged. What is the smallest independent
  research harness, and which existing order-settlement protections can be reused?
- What intraday history, exchange filters and fee information are actually available?
- How will protective exits survive process/network failure? Which exchange-side
  mechanisms are supported for the selected spot account, and how are they reconciled?
- Does user pause stop new entries while protective exits remain armed, or something
  else? This needs a strategy-specific contract; do not reuse MA125's copy blindly.
- How will strategy identity, allocation and version consent work? Two strategies
  must not independently rebalance the same whole account. Use an isolated paper
  account initially; allocation/separate live accounts need an explicit design.
- What validation result, operations evidence and pilot decision would justify moving
  from Research to Practice and eventually to live availability?

## UI proposal

Research card only, clearly labelled “Not available to activate”. Explain the sequence
and why a setup is waiting, expired or rejected. Show observed time, confirmation rule,
intended risk and actual order state when backed by real data. Never invent confidence
scores, performance, proof of liquidity, or claim this candidate is better than MA125.
The current product remains a separate reviewed prototype until research and product
scope are agreed. The founder has requested a new visual direction, not a new brand name.

## Sources and limits

- Bybit historical candle endpoint supports spot and the proposed intervals, but an
  open candle's close field is only its last traded price. Use closed candles and set
  category=spot explicitly (default is linear):
  https://bybit-exchange.github.io/docs/v5/market/kline
- Bybit exposes order-book snapshots separately from candles. A present snapshot is
  not historical stop-order evidence:
  https://bybit-exchange.github.io/docs/v5/market/orderbook
- Bailey et al., The Probability of Backtest Overfitting, motivates controlling the
  number of tested configurations and evaluating unseen data; it does not validate
  this trading pattern: https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf

No backtest has been run for this proposal. No performance claim is supported yet.

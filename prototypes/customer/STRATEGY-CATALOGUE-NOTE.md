# Selectable strategy catalogue — founder direction and research shortlist

23 September 2026. Codex discussion input for Claude's authoritative product/engine docs.

## Confirmed by the founder

- Soft white, bold black and lime is the accepted visual direction. Keep it.
- Liquidity + structure confirmation is an ADDITION to MA125, not a replacement.
- Users should be able to choose their strategy; more candidates can join over time.
- Candidate selection and recommendations were delegated to us. That is not proof of
  profitability, approval of the parameter values, or an instruction to place an order.

## Proposed initial product contract

A strategy catalogue shows purpose, exact version, instruments, timing, exposure policy,
entry/exit rules, expected failure modes, costs, historical evidence and readiness.
Keep Research, Backtested, Paper evaluation and Live eligibility distinct. The status
must be driven by reviewed evidence and account eligibility, not a UI label alone.

Initially: one selected strategy per dedicated exchange account. A user's choice is
explicit. Research strategies cannot be activated. Supporting simultaneous strategies
requires separate dedicated accounts or an implemented, reconciled allocation system.
Two strategies cannot each assume they own the same whole BTC/USDT balance.

A switch is not merely changing an ID. The preview should disclose current holdings,
outstanding orders, retained protective exits, any proposed sale/purchase and its fees,
the new strategy/version and when it may first act. Settle unresolved orders or block
switching. Define who owns existing positions throughout the transition. Do not remove
protective exits while switching. Require confirmation of the selected version and the
specific transition; log it atomically with the assignment. Fail closed if that cannot
be completed. User pause and operator/review stops remain separate controls.

Claude owns the backend design: versioned registry, supported capabilities, assignment,
allocation identity, order provenance, position ownership, strategy-specific pause/exit
semantics, compatibility checks and restart/reconciliation behaviour. No engine code is
changed by this note. The founder approved the destination; the contract above is a
proposal for implementing it, not a claim that these capabilities already exist.

## Research shortlist

These are credible candidates to INVESTIGATE, not three proven profitable crypto bots.
Published evidence for a strategy family is not evidence for our exact assets, venue,
parameters, fee tier, execution or future performance.

### 1. BTC channel breakout — proposed next comparison

Idea: enter BTC after a completed daily close exceeds the highest high of the preceding
N completed daily bars. Exit after a completed close below the lowest low of a shorter
M-bar window; execute only after the signal, with fees and slippage. Exclude the signal
bar from both reference windows. If no signal, retain the prior position state.

Choose a small, preregistered set of N/M horizons on development data, then freeze one
candidate. Do not copy Turtle leverage, pyramiding, futures assumptions or vendor
parameter defaults into a spot product. Compare to MA125 on the same BTC history and
cost model. This is a distinct entry/exit rule, but both are trend-following and may
suffer together in sideways markets; do not market it as independent diversification.

Why research: transparent rules and a well-established systematic family. Man AHL
explains breakout trading and its connection to momentum, scaling and diversification:
https://www.man.com/insights/ahl-explains-breakout-trading
That explanation does not validate this proposed BTC adaptation.

Implementation need: stateful entry/exit hysteresis, lookback handling, cost-aware
spot sizing and separately versioned configuration. False breakouts and repeated small
losses in choppy periods are a central hypothesis to measure, not a solved problem.

### 2. Volatility-managed trend — a sizing variant

Idea: retain MA125's trend signal but reduce BTC exposure as measured volatility rises;
hold the remainder as USDT. Cap exposure at 100%, with no borrowing. Estimate volatility
using only past closed returns; cap/floor inputs and define missing-data behaviour.
Set rebalance thresholds to avoid buying/selling tiny amounts every day. Decide the
estimator, observation window, target and turnover budget before holdout evaluation.

Why research: Moreira and Muir document volatility management in equity factors and
currency carry. This is motivation, not crypto proof:
https://www.nber.org/papers/w22208

Do not promise lower drawdowns, safety or better returns without evidence. It can trim
exposure before a rebound, trade more often, or miss a sudden jump in volatility. It
belongs as a clearly named version/variant, not a claim of a new independent signal.
Compare with both full-exposure MA125 and a constant reduced-exposure baseline, so
simple capital reduction is not mistaken for a new predictive advantage.

Implementation need: fractional target allocations, cash buffer, turnover controls,
min-notional rounding and clear disclosure that this is no longer all-in/all-out.

### 3. Relative momentum — later multi-asset research

Idea: periodically rank an explicitly eligible set of liquid spot assets by trailing
returns, hold a limited strongest subset only if an absolute-trend requirement is met,
and otherwise remain in USDT. Use a fixed rebalance schedule and turnover constraints.
Do not silently add newly popular coins or assume BTC evidence transfers to altcoins.

Why research: Liu, Tsyvinski and Wu identify a momentum factor in cryptocurrency returns:
https://www.nber.org/papers/w25882
This does not establish profitability for a long-only retail portfolio after real costs.

This is later work because the product is presently BTC-only. Research requires
point-in-time asset membership, listings/delistings, real historical liquidity filters,
missing-market handling and costs for changing holdings. Test downside correlation,
reversal episodes, concentration and whether any benefit survives turnover. Avoid a
universe made only of today's survivors. Multiple coins can still fall together.

Implementation need: multi-asset portfolio accounting, instrument-specific filters,
allocation and aggregate risk limits, robust market data and a revised product scope.

## Sequencing and evidence

Keep MA125 and the founder's liquidity research intact. Finish the bounded liquidity
research draft already underway. Channel breakout is my next research recommendation;
volatility sizing follows, and cross-asset momentum waits for justified scope expansion.
These three candidates have not been backtested in this task.

For every candidate: freeze rules and acceptance criteria, record every trial, split
chronologically into development/validation/final holdout, use point-in-time inputs,
include fees/slippage and failures, then compare net return, drawdown, exposure,
turnover, tail losses and uncertainty. Compare candidates' return and loss correlations;
do not count highly similar strategies as independent diversification. Keep failed
experiments. Paper execution evidence is a separate milestone from simulated returns.

Background evidence for the trend family includes Moskowitz, Ooi and Pedersen's work
on diversified futures markets, not a guarantee for a single crypto pair:
https://www.aqr.com/Insights/Research/Journal-Article/Time-Series-Momentum

No guaranteed win rate, profit label, 'best strategy' badge or automatic replacement of
a user's selected version. New strategies enter the catalogue only at their actual
research/availability state. Live eligibility and migration are separate decisions.

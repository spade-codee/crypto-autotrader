# Design: Non-Custodial Crypto Trading Automation

- **Date:** 2026-09-16
- **Status:** Design approved. Phase 0 plan written. **Business model reopened by research — see note below.**
- **Working name:** crypto-autotrader (placeholder; no brand chosen)

> **Update 2026-09-17 — read before relying on section 2.**
> Product research (`docs/research/`) reopened part of this spec. Architecture, strategy,
> failure handling, and testing stand. Two things do not:
>
> 1. **Target account size and pricing.** A flat monthly fee cannot be carried by $100–$1,000
>    accounts: $10/month is 12% of a $1,000 account a year and 40% of a $300 one. The viable
>    flat-fee segment starts around $3,000. Profit share fits small accounts but is what
>    triggers portfolio-management classification. **Open decision** — `docs/decisions.md` #16.
> 2. **Regulatory exposure.** SEC Nigeria VASP rules cover activity "for or on behalf of another
>    person", and no software carve-out was located. The legal opinion should move to month
>    one rather than wait for the pilot — `docs/decisions.md` #18.
>
> Neither blocks Phase 0. The strategy has to work regardless of who it is sold to.

---

## 1. Problem and product

Retail crypto holders in Nigeria hold spot positions and ride them all the way down through
drawdowns, because acting requires discipline they do not have at 3am. Manual trading tools
exist; discipline does not.

We build **non-custodial trading automation**. The user keeps their money in their own
exchange account. They connect it with a trade-only API key, choose a strategy, set a risk
limit, and press Start. The software executes the strategy on their account on a schedule.
They can pause or stop at any time.

This is the crypto analogue of forex copy-trading (ZuluTrade, MT5 MAM), with one important
difference: the trade decisions come from a published mechanical strategy, not from a human
signal provider.

### Why non-custodial is the whole design

Exchange API keys can be issued with **trade enabled and withdrawal disabled**. The platform
can place orders and read balances; it cannot move funds out. This holds even if the platform
is fully compromised.

Consequences:

- We never hold customer money, so we are not a custodian or money transmitter.
- The trust pitch is verifiable rather than promised: the user can see the key permissions.
- A breach of our systems is serious but not fatal to users' funds.

Everything else in this design assumes this model.

---

## 2. Positioning and business model

Two postures are available for the same engine:

| Posture | Pitch | Regulatory weight |
|---|---|---|
| Managed service | "We trade your account, we take a cut of profits" | Discretionary portfolio management |
| SaaS tool | "Here is automation software; you configure it, you can stop it" | Software product |

We take the **SaaS tool** posture. The user selects the strategy, sets their own risk
parameters, and retains a stop control at all times. We do not promise returns, do not take
custody, and do not charge a performance fee.

**Launch sequence:**

1. **Pilot (free).** Run live on the founder's own capital, then a small group of informed
   volunteers. Build a verified public track record over 3-6 months.
2. **Then flat monthly subscription.** Priced for Nigerian retail account sizes
   ($100-$1,000 typical), decided once there are results to point at.

Rationale: nobody pays a monthly fee to an unknown trading platform with no track record. The
track record is the product's first real asset, and it can only be earned with time.

### Regulatory note

Nigeria's Investments and Securities Act 2025 brought digital-asset service providers under
SEC Nigeria's remit. The SaaS posture plus non-custodial architecture materially reduces
exposure compared to a managed-account model, but does not eliminate it.

**Action required before opening the pilot beyond the founder:** review with a Nigerian
securities lawyer. Nothing in this document is legal advice. Additionally, block US and EU
signups at onboarding — those jurisdictions require investment-adviser registration
(SEC RIA) or MiFID II portfolio-management authorisation respectively, which is out of reach
at this stage.

---

## 3. Strategy: trend filter

**Rule:** hold the asset while its price is above a long moving average; hold stablecoin
when it is below.

- Asset: **BTC only** for v1. Most liquid, simplest. ETH follows once the system is proven.
- Timeframe: **daily candles.** One execution cycle per day.
- Venue: **Bybit spot** first. Binance second, behind the same adapter interface.
- **Spot only. No leverage, no futures, no margin.**

Why this strategy: it is mechanical, explainable in one sentence, backtestable on free data,
and its failure mode is whipsaw (a series of small losses in choppy markets) rather than
catastrophe. For a platform whose entire asset is trust, a boring failure mode is worth more
than a higher expected return.

Why daily candles: fewer trades means less slippage, lower fees, fewer API calls, a smaller
bug surface, and an operational cadence a single person can actually supervise. Faster
timeframes multiply cost and risk without a corresponding edge at this stage.

Why no leverage: leverage introduces liquidation. A liquidation caused by our bug is a
business-ending event. Excluding it removes an entire category of catastrophe at zero cost.

Exact MA period and any confirmation filter are outputs of Phase 0 (below), not assumptions
of this design.

---

## 4. Architecture

Eight components, each with a single responsibility and a defined interface.

### 4.1 Market Data Service

- **Does:** fetches and stores OHLC candles from the exchange; serves candle history.
- **Interface:** `getCandles(symbol, timeframe, from, to) -> Candle[]`
- **Depends on:** exchange adapter, database.

Single source of price truth. Both backtest and live read candles through this interface.

### 4.2 Strategy Engine

- **Does:** decides the target state.
- **Interface:** `evaluate(candles: Candle[], currentState: State) -> TargetState`
  where `TargetState` is `LONG` or `FLAT`.
- **Depends on:** nothing. Pure function. No I/O, no clock, no network.

**This is the most important structural decision in the design.** Because the strategy is a
pure function, the identical code path runs in backtest, paper trading, and production.
Backtest results therefore describe the system that actually trades, rather than a parallel
implementation that silently drifts from it.

### 4.3 Risk Guard

- **Does:** validates every proposed order before it is sent. Has veto power.
- **Interface:** `validate(user, proposedOrders, accountState) -> Approved | Rejected(reason)`
- **Enforces:** max percentage of account per order; max orders per user per day; price
  sanity (reject if the execution price deviates more than N% from the reference price);
  minimum order size; per-user pause flag; global kill switch.
- **Depends on:** user config, market data.

### 4.4 Order Router

- **Does:** reconciles a user's actual account with the target state.
- **Interface:** `reconcile(user, targetState) -> ExecutionResult`
- **Depends on:** exchange adapter, Risk Guard, Ledger.

**Idempotent.** Every order carries a client order ID derived deterministically from
`(userId, cycleId, intent)`. Re-running a cycle cannot produce duplicate orders, because the
exchange rejects a repeated client order ID. Handles lot-size rounding, minimum notional,
partial fills, and retries.

### 4.5 Credential Vault

- **Does:** stores and retrieves exchange API keys.
- **Interface:** `store(userId, exchange, key, secret)` / `retrieve(userId, exchange)`

Encrypted at rest with an envelope key held in a managed KMS. Decrypted only inside the
execution path. Never logged, never returned to the frontend, never included in error reports
or stack traces. Validated on connection: reject any key that has withdrawal permission
enabled.

### 4.6 Ledger

- **Does:** append-only record of every intent, order, fill, and resulting position.
- **Interface:** `append(event)` / `getPositions(userId)` / `getPnL(userId, period)`

Never updated or deleted, only appended. This is the artefact that produces the track record,
so its integrity is the product's credibility.

### 4.7 Dashboard (web)

Connect exchange account, view current position, view P&L history, pause, stop.

### 4.8 Admin

All users and their states, error queue, reconciliation mismatches, global kill switch.

### Exchange adapter

All exchange access goes through one interface (`getCandles`, `getBalances`, `placeOrder`,
`getOrder`, `cancelOrder`). Bybit is the first implementation. This is what makes "Binance
later" a small change rather than a rewrite.

---

## 5. Data flow: one execution cycle

```
Scheduler fires at daily candle close
  -> Market Data pulls latest candles
  -> Strategy Engine computes target state (LONG | FLAT)
  -> for each active user:
       read ACTUAL balances from the exchange
       compute the order delta needed to reach target state
       Risk Guard validates       -> rejected: halt this user, alert
       Order Router places orders  (client order ID = idempotency key)
       poll for fills -> append to Ledger
       reconcile: does the account now match the target state?
         mismatch -> freeze this user, alert admin
```

**The exchange is the source of truth for positions, never our database.** Every cycle reads
real balances before acting. Our database records what happened; it does not assert what is
true. Systems that trust their own position table are the ones that double-buy after a
partial failure.

---

## 6. Failure handling

Trading platforms are not killed by bad strategies. They are killed by bad failure handling.

- **Idempotent by construction.** Deterministic client order IDs make a repeated cycle a
  no-op at the exchange.
- **Fail closed.** Cannot fetch prices, cannot read balances, or any ambiguity at all:
  do nothing and alert. Inaction is nearly always safer than action on bad information.
- **Reconcile every cycle.** Compare expected against actual. Any mismatch freezes that user
  immediately and raises an alert; it does not retry blindly.
- **Kill switch.** One control that halts all trading for all users, on a separate code path
  and separately deployable, so it works when the main application does not.
- **Rate limiting.** Per-exchange limiter, exponential backoff, circuit breaker that trips
  after N consecutive failures.
- **Alerts on:** failed orders, reconciliation mismatches, authentication failures, and a
  cycle that did not run when it was scheduled to (silent non-execution is a failure too).

---

## 7. Testing strategy

Staged, and stages are not skipped. Each stage exists to find a class of bug with our money
instead of a user's.

1. **Unit tests** — strategy logic, order sizing, lot rounding, risk rules. The strategy
   engine is a pure function, which makes this straightforward.
2. **Backtest** — multi-year historical run, **including fees and slippage**. A backtest
   without transaction costs is fiction.
3. **Paper trading** — the complete live pipeline against testnet or simulated fills, in
   real time, minimum 2-4 weeks. This is what catches integration bugs.
4. **Live, founder's own capital**, smallest viable size, 2-4 weeks.
5. **Live, a small group of informed volunteers.**
6. **Pilot opens.**

---

## 8. Tech stack

- **Language:** TypeScript end to end (existing familiarity from `staff-hub`).
- **Frontend:** React + Vite + Tailwind.
- **Backend:** Node/Bun. Worker process separate from the web application, so a web deploy
  cannot interrupt an execution cycle.
- **Database:** Postgres. The ledger needs transactional integrity.
- **Exchange access:** CCXT, wrapped behind our own adapter interface.
- **Secrets:** managed KMS for the vault's envelope key.

---

## 9. Build order

The design is too large for a single implementation plan. It decomposes into phases, each of
which gets its own plan.

- **Phase 0 — Strategy proof.** Backtest harness plus Strategy Engine. Offline, no exchange
  credentials, no users, no database. **Output: does this strategy work, and with what
  parameters?** This is the first plan, and it is deliberately first: it is roughly a week of
  work, and it determines whether the remaining months are worth spending.
- **Phase 1 — Exchange adapter, read-only.** Bybit connection, key storage and validation,
  candle and balance reads. No order placement at all.
- **Phase 2 — Execution engine, paper.** Order Router, Risk Guard, Ledger, reconciliation,
  against testnet.
- **Phase 3 — Live, single user.** Founder's own account, minimum size.
- **Phase 4 — Multi-user.** Onboarding flow, dashboard, admin, kill switch.
- **Phase 5 — Pilot opens** to volunteers.

---

## 10. Success criteria for v1

v1 succeeds if, after the pilot period:

1. No user lost money due to a software defect.
2. Every scheduled execution cycle either executed correctly or failed closed and alerted.
3. There is a continuous, verifiable P&L record covering at least three months of live
   trading.

Profitability is explicitly **not** a v1 success criterion. The strategy may underperform in
a given quarter; that is a property of markets. Correct, safe, auditable execution is what v1
must prove.

---

## 11. Deferred decisions

- Exact MA period and any confirmation filter — determined by Phase 0.
- Subscription price — determined after the pilot produces a track record.
- Binance adapter — after Bybit is live.
- ETH and additional assets — after BTC is proven.
- Whether KYC is required — depends on the lawyer review in section 2.

# Beginner product plan

Draft for discussion with the founder, 2026-09-22. This proposes the customer experience; it does not authorize deployment, change approved trading rules, or claim customer demand is established.

## Product direction

Help someone with limited trading knowledge understand a defined BTC strategy, experience it in practice, and choose to automate it on a dedicated exchange account. The experience should make its scope, current actions, losses, fees, and controls understandable.

First-customer hypothesis: people in the founder's community who have tried trading, found the analysis and decision-making difficult, and want a repeatable process. Validate this with actual use. Complete beginners can be supported, but the product should not assume everyone wants the same frequency of trades or accepts the strategy's trade-offs.

Working assumption for this draft: guided automation is the first release. Coin discovery, independent discretionary trading tools, and a strategy marketplace are later possibilities. This is a recommendation for the founder to overrule, not a newly settled business decision.

## Existing decisions to preserve

- BTC spot only; the same MA-125 strategy implementation runs in research and execution.
- A daily strategy decision; 15-minute engine checks handle operation and recovery, not a promise of trades every 15 minutes.
- A dedicated account: every BTC and USDT in it belongs to the strategy. Do not add a shared-account allocation slider without redesigning accounting and execution.
- Exchange funds stay in the user's exchange account. Trade authority can still incur losses; withdrawal-disabled permissions do not make funds risk-free.
- Free pilot. The existing business decision is a yearly fee in USDT with a free tier below an account-size threshold; exact price and threshold remain open for pilot learning.
- User pauses and system freezes have different meanings. The current system requires founder/operator review to lift a freeze.
- The six recent review findings were addressed at commit 77fec9e, with 508 tests and typecheck passing locally. Linux verification, deployment, and monitored paper trading are separate remaining engineering milestones.

## Release sequence

| Release | What ships | Evidence required to move on |
|---|---|---|
| A: experience prototype | Clickable phone-sized screens with clearly labelled sample data; strategy explanation, practice flow, dashboard states and controls | Observe 5–10 representative people performing the core tasks; revise the confusing parts |
| B: private practice pilot | Persistent practice accounts using the verified engine, decision timeline, summaries, feedback and account controls | Users understand the strategy and simulation, return voluntarily, and can operate the controls; engine behavior and notifications are observable |
| C: controlled live pilot | Verified exchange connection, dedicated-account onboarding, explicit activation, live account reporting and operator support | Real-order integration and operational recovery are verified; the project's existing exchange-access and legal pilot gates are satisfied |
| D: paid release | Confirmed pricing, billing, entitlement handling and support policies | Pilot evidence supports charging for the experience; users understand price, trade-offs and service boundaries |

These releases describe product milestones, not replacements for the repository's engineering phases. In particular, inviting multiple practice users requires authenticated server APIs and user isolation; the current founder CLI is not a customer service backend.

## Proposed navigation

Four main destinations: **Home, Strategy, Activity, Account**. Practice/live is a prominent account-mode label and a deliberate switch, not two unrelated applications. Put help within the relevant screen and in Account. Avoid making users search through a separate analytics area to understand their position.

### Home

The first screen answers: Is my automation active? What do I hold? What is the strategy doing? When did it last check successfully?

- Mode: Practice or Live, always visible.
- Account value and trading result, with clearly defined time range and fees.
- BTC and USDT holdings; exact scope of the connected dedicated account.
- Strategy state: holding BTC or holding USDT, with a short explanation.
- Automation state: not activated, active, paused by user, stopped for review, or connection/data problem.
- Last successful account/data check and next scheduled decision time, shown in local time.
- A relevant action: start practice, finish connection, activate, view issue, or pause.

Show the timestamp of displayed balances. When data becomes stale, retain the last known figures with a clear timestamp and unavailable-current-value state; do not present zero or stale figures as fresh balances.

### Strategy

One strategy card initially, with a full detail page:

- Plain-language purpose and entry/exit rule.
- BTC/USDT scope, daily schedule, all-in/all-out behavior and dedicated-account requirement.
- When it can struggle: sideways markets, rapid changes, long inactivity and missed upside.
- Historical results with dates, assumptions, costs and drawdowns alongside the comparison benchmark.
- Separate labels for historical backtest, forward paper results and eventual live results.
- A simple walkthrough of an entry, exit and losing period.
- Strategy version and a readable record of changes. Users must know when the rules governing their account change.

No star ratings implying safety, unsupported return targets or unexplained risk scores. A strategy can be clearly described without being described as suitable for everyone.

### Activity

One chronological history, with filters for decisions, trades and issues:

- Signal/decision, actual submission, actual execution and any failure are separate events.
- Each trade shows asset, quantity, price, fee, time and current settlement state.
- Explanations use the recorded strategy and risk events; do not invent post-hoc analysis.
- Quiet periods are understandable without filling the timeline with duplicate entries every 15 minutes.
- Show corrective actions and whether they require the user or operator.

Opening an entry reveals enough detail for a user or support person to reconcile it with the exchange. Keep technical diagnostics behind an optional details panel.

### Account

- Exchange connection status, permissions and masked key identification.
- Dedicated-account scope and setup guidance.
- Notification preferences and destination verification.
- Pause/resume, disconnect guidance and account-session security.
- Help and a support request linked to an activity reference.
- Data export and account-deletion path once user accounts exist.
- Billing and entitlement status when charging begins.

## Essential flows

### First visit to practice

1. Explain the product, scope and loss possibility in plain language.
2. Show the strategy and its trade-offs.
3. Start a labelled practice account without asking for an exchange key.
4. Show its starting simulated funds and first scheduled decision.
5. Offer a short historical walkthrough so the user can see both loss and inactivity immediately.

Historical replay and forward practice must be visibly distinct. If practice reset is offered, create a new run/version and preserve the old record; never silently erase losses from the same track record.

### Connect to activate

1. Sign in and secure the user account.
2. Check the supported exchange/account setup and explain why a dedicated account is needed.
3. Guide account/sub-account creation and required key permissions.
4. Enter credentials in the product's protected form; never in support chat or screenshots.
5. Validate permissions and connection, then show balances. Connection alone starts no trading.
6. Show exactly which funds activation controls, the rules selected, the next possible action and the pause behavior.
7. Require explicit activation; record the acknowledged strategy version and displayed scope.
8. Confirm active status and notification setup.

Current dedicated-account behavior also covers later deposits. Explain that added BTC/USDT can be traded by the strategy. Detect external transfers so performance accounting separates cash flows from trading results.

### Pause, disconnect and system freeze

- **Pause:** stop new strategy submissions; already-submitted orders may still settle. Existing BTC is not automatically sold. Resume after showing current holdings and the next expected behavior.
- **Disconnect:** stop new submissions, retain visibility into unresolved orders where possible, and guide exchange-side key revocation. Define how records and eventual settlements are retained. Never imply that deleting a key from this app alone cancels orders or sells assets.
- **System freeze:** state why execution stopped, what is known about holdings/orders, and what action is needed. Users can request review; do not provide an unrestricted resume button that bypasses an unresolved safety condition.
- A separate sell-to-USDT action would be a new trading feature needing its own order, risk and recovery design. It is not part of the initial pause button.

## What else is worth adding

### Short explanations where users need them

Add brief definitions beside terms such as drawdown, fees, unrealized result and pending order. A three-screen onboarding check should establish that the user understands possible losses, account scope and pause behavior. If an answer is wrong, explain it and let them retry. Avoid turning onboarding into a trading course or an intrusive financial questionnaire.

### A useful weekly summary

Show opening and closing account value, trading result, external cash movements, fees, decisions and unresolved issues. Let users choose routine summaries; critical account problems need an explicit delivery path. Design notification attempts and delivery status so temporary failure does not silently discard an important message.

### Honest cost visibility

Keep exchange fees separate from the platform fee. When pricing is set, show the actual yearly cost and any payment/network charges known at checkout. Explain the free-tier threshold and transition before charging. Define what happens if payment expires or an account crosses the threshold; never silently liquidate a position as a billing side effect. These policies remain open decisions.

### Help connected to what happened

Offer “Get help with this” on an activity entry, creating a support reference containing non-secret diagnostics. Clearly distinguish general product support from trading recommendations. Never ask users to send keys, secrets or unredacted credential screenshots.

### A lightweight phone experience

Design the primary tasks for small screens and constrained connections. Use readable figures, visible state labels, compact charts and retryable requests. Avoid mandatory heavy charts or constant polling merely to make the product look busy. Accessible text and icons must accompany color.

### Operator tools users may never see

Before accepting live customers, provide an operator view of overdue cycles, unresolved orders, rejected keys, frozen accounts, failed alerts and support requests. Actions need an attributable audit record. Operator access must be separate from customer access, and sensitive changes must be protected. Backups must be restored in a test, not merely configured.

## Engineering bridge from the CLI to the product

- An authenticated API and server-owned account identity; a browser must never select an arbitrary USER_ID to access another account.
- Tenant authorization on every read/action, secure sessions and recovery, protected credential entry, and no secret values in browser logs or analytics.
- Persisted activation/consent and strategy-version records. User interface state must reflect engine state, not optimistic assumptions.
- Read models for balances, status and the event timeline, so viewing a dashboard does not interfere with trading execution.
- Cash-flow-aware performance accounting and explicit data timestamps.
- Idempotent activation/control requests with clear pending/error outcomes.
- Critical notification retry/delivery tracking and operator visibility.
- Follow the repository's planned production-database and multi-user phases before public access. A frontend alone does not supply these capabilities.

These belong in implementation specifications after the product flows are agreed. This document is not a request to build them immediately.

## Pilot questions and observable measures

Observe 5–10 invited participants first. Treat this as qualitative learning, not proof of broad demand.

| Question | Observe |
|---|---|
| Can they understand it? | Explain the trading rule, a possible losing scenario, controlled funds and pause behavior in their own words |
| Can they begin unaided? | Time and assistance needed to start practice; where setup is abandoned |
| Does it remain useful? | Voluntary returns after a few days and after inactivity or a loss; reasons for disengagement |
| Do they feel in control? | Find the last decision, identify account health, and pause without prompting |
| Is the service understandable when it fails? | Correctly interpret a simulated stale-data or connection-failure screen |
| Is there willingness to pay? | Discuss a concrete price and conditions after experience; distinguish verbal enthusiasm from commitment |

Measure product events such as practice_started, explanation_opened, activation_previewed, connection_failed and pause_requested without recording keys, sensitive form contents or unnecessary financial details in analytics. Define success thresholds after the first observations; do not invent conversion forecasts now.

## Decisions for the next brainstorming conversation

1. Confirm guided automation as the first product scope.
2. Choose the first invited user segment: trading-fatigued beginners, completely new users, or a deliberately mixed learning group.
3. Decide how much practice is encouraged before live activation, without inventing a mandatory waiting period.
4. Define pause, disconnect, strategy-update acknowledgement and billing-expiry behavior in user language.
5. Set pilot size and support capacity. Establish pricing/free-tier rules from pilot evidence, preserving the yearly-USDT direction unless the founder changes it.
6. Choose the brand/name separately; the functional plan does not need to wait for it.

## Immediate next deliverable

Design the phone-sized prototype for five concrete scenarios: first visit, active and holding BTC, active and holding USDT, paused by the user, and stopped because of a connection or execution problem. Walk representative users through these before implementing all customer screens. Continue the separate engine-verification work in parallel.

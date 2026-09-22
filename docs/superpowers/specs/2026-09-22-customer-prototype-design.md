# Customer experience prototype (Release A): design

- **Date:** 2026-09-22
- **Status:** scope agreed by the founder, 2026-09-22. **Ownership:** Codex builds the prototype
  — its screens, interactions, accessibility, and visual QA; Claude owns this spec, the product
  context, the engine, and the factual review of the prototype. See
  `docs/collaboration/claude-handoff.md`.
- **Input:** the founder's draft product plan, kept unchanged at
  `docs/product/2026-09-22-product-plan-draft.md`. It is input to planning, not approval of
  every feature in it.
- **Revised:** 2026-09-22, after reviewing Codex's first draft: when decisions happen (§4.8, and
  the new decision D4), the resume sheet, sample figures corrected or added in §5, pause in the
  problem states, and history that only grows (§6). Review notes:
  `docs/collaboration/claude-ui-review.md`.
- **Builds on:** `docs/decisions.md` #5, #16–#22; `docs/brand.md` §§1, 3–6; the parent spec's
  dashboard (`2026-09-16-crypto-trading-automation-design.md` §4.7); the Phase 2 engine
  (`2026-09-22-phase-2-paper-engine-design.md`).
- **Branch:** `product-prototype`, created from `phase-2-paper-engine`. The engine's
  verification continues on its own branch and does not wait for this work.

## 1. Goal

Find out, before any customer software is built, whether people understand the product. Put a
clickable phone mock-up in front of 5–10 invited people and watch whether they can explain what
the strategy does, that most of its trades lose, which funds it controls, what pausing does, and
what a problem screen is telling them. What confuses them gets fixed while fixing it costs
nothing.

This is Release A of the draft product plan. It moves on when the sessions have been held, their
notes summarised, and the resulting changes listed (section 11).

## 2. Boundary

This spec is **not** production implementation and **not** deployment.

- The prototype is a throwaway mock-up with sample data. None of it becomes product code; the
  real dashboard is built in the multi-user phase, from what the sessions teach.
- It touches no engine code, reads no real account, and takes no keys, passwords, or personal
  details. It has no backend and records nothing about the people who use it.
- It lives in `prototypes/customer/`, outside `src/` and `tests/`, so it is neither typechecked
  nor tested with the engine and adds no dependency to the root `package.json`. Nothing in `src/`
  imports it, and it is never deployed with the engine.

## 3. The prototype

- **One self-contained web page**, laid out for a 375-pixel phone screen, working offline once
  opened. Sessions run on the facilitator's phone or on the participant's own phone through a
  private link; which one is Codex's call as the prototype's builder, agreed with the founder.
- **A start page for the facilitator** lists the scenarios, and each scenario also has its own
  direct link, so a session can jump straight to one.
- **On every screen:**
  - a fixed ribbon: **"Prototype — sample data, not real results"**;
  - a mode label, **PRACTICE** or **LIVE**, always visible;
  - four tabs: **Home · Strategy · Activity · Account**, once the first-visit sequence is done.
    Home is the dashboard: whether the automation is running, what the account holds, its value
    and result, and the last and next decision.
- **Look:** the decided "Instrument" palette and IBM Plex fonts (`docs/brand.md` §§3–4). No
  product name, since the name is undecided (#14): a plain placeholder mark only. Light or dark
  follows the phone's setting.
- **English only** for this round.

## 4. Content rules

### 4.1 What the product is, preserved on every screen

- **BTC only**, spot, against USDT (#21).
- **The whole dedicated account.** The strategy controls every BTC and USDT in the one exchange
  account set aside for it, ideally a sub-account (#22).
- **Connecting is separate from activating.** Connecting checks the key and shows balances;
  nothing trades until the user activates, after seeing exactly which funds that means (#22).
- **A pause is the user's; a stop for review is the system's.** A pause is lifted by the user. A
  stop for review is lifted only after the account has been reviewed (#22). An operator-wide stop
  is a third, separate state (section 5, 5c).

### 4.2 Sample data

- Every account figure is invented, stated in section 5, and deliberately ordinary: a 1,000 USDT
  start, one losing cycle, no growth chart.
- Dates are sample dates in 2026, with "today" as 22 September. Times are Lagos time (WAT, UTC+1).
- The ribbon stays on every screen, so a screenshot cannot pass as a real result.

### 4.3 The historical evidence, on the Strategy page

These are the **real figures** from the project's documented test, not sample data, and every
screen that shows them names the test. Source: `docs/research/phase-0-findings.md`.

| | |
|---|---|
| Test | Out-of-sample, **1 January 2023 to 16 September 2026**. The 125-day average was chosen on 2019–2022 data, before this period, and not adjusted afterwards |
| Data | Bybit BTCUSD inverse perpetual daily candles — the project's long-history dataset, checked against Bybit's BTCUSDT spot prices over the 1,900 days both exist (median daily close difference 0.05%) |
| Costs | A 0.1% trading fee plus 0.05% slippage on every buy and every sell. Tax, deposit, and withdrawal costs are not included |
| Execution | A decision at each daily close, filled at the next day's open |
| Completed buy–sell cycles | **18, of which 13 lost money.** The average losing cycle lost 3.4%; a few long trends made up for them |
| Worst drop from a peak | **27.4%**, 13 March to 10 October 2024, during a sideways market. Holding BTC over the same test: **53.1%**, 6 October 2025 to 30 June 2026 |
| Missed upside | Over the whole test it grew less than simply holding BTC |

Required copy, shown with the figures:

> **Past test, not a forecast.** This is how the rule would have behaved on past prices, with
> the costs above. It is not a record of real trading and does not predict future results.
>
> **The worst past drop is not a limit on future losses.** A fast crash can fall further before a
> once-a-day rule reacts, and future markets can behave differently from this period.

The prototype shows **no annual-growth figure** anywhere — neither the strategy's nor
buy-and-hold's.

### 4.4 Growth and results

- **Onboarding promotes no growth.** The first-visit screens (scenario 1) state what the rule
  does, what it costs, and how it loses; they carry no growth figures, projections, or
  percentages of past gains.
- **Account results are reported honestly, gains and losses alike.** Home shows the account's
  result since activation in USDT and as a percentage, with its period, a sign and an arrow, and
  the fees paid shown separately — for example `+11.92 USDT ▲ (+1.19%) since 2 Aug · 51 days ·
  fees 1.00 USDT`. A gain is not hidden or played down, a loss is not softened, and no result is
  ever annualised or projected.

### 4.5 Money added to the account

Required copy, wherever deposits are explained:

> **Money you add may be traded.** BTC or USDT you add to this account may be traded at the next
> eligible daily decision: added USDT may be used to buy BTC while the strategy holds BTC, and
> added BTC may be sold while it holds USDT. Small amounts — below the exchange's minimum order,
> or too small to change the account's position — may be left as they are, and nothing is traded
> if a safety check fails.

### 4.6 Trading the account by hand

What the engine does today, which the copy must not overstate:

- At each daily decision, **funds locked by an open order the engine did not place stop the
  account for review.** That is the only manual activity it detects.
- A manual trade that completes immediately locks nothing and is not detected as manual. At the
  next decision the strategy moves the account back to its own position, which can reverse the
  trade.
- Broader detection of manual activity does not exist yet (requirement R2).

Required copy, in the Account screen and the going-live preview:

> **Please don't trade in this account yourself.** At its next decision the strategy may reverse
> a trade you make, and an order you leave open can stop the automation until the account is
> reviewed.

### 4.7 Voice, accessibility, and time

- `docs/brand.md` §5: describe state, not achievement; say what happened and what to do next; no
  urgency, hype, or "AI trading" vocabulary.
- `docs/brand.md` §6: profit and loss always carry a sign and an arrow, never colour alone;
  screens read in greyscale; body text at least 4.5:1 contrast.
- The daily decision is shown as **"about 01:00"** — the daily close is 00:00 UTC, 01:00 in Lagos.
  The 15-minute checks are mentioned only where they explain what happens next (4.8) or recovery
  (scenario 5a).

### 4.8 When decisions happen

This is what the engine does today (`src/engine/cycle.ts`), and screens must not contradict it:

- The engine checks every active account every 15 minutes, at :02, :17, :32, and :47.
- Normally the day's decision is made at the first check after the daily close — about 01:00 in
  Lagos.
- **An account that becomes active later in the day** — practice just started, trading just
  activated, or resumed after a pause — gets the latest daily decision at its **next check,
  within about 15 minutes**, if that decision has not yet been applied to it. The decision comes
  from the latest daily close, the same one every other account used that day.
- Once the day's decision has been applied to an account, nothing more happens to it until after
  the next close.
- An order is placed only if the safety checks pass at that moment; otherwise nothing is traded.

Every screen that says what happens next — starting practice, activating, resuming — follows this.
Whether a newly active account should instead wait for the next daily close is open decision D4.

## 5. The scenarios

Each scenario stands alone: it starts from the sample data below, and what happens in one does
not carry into another. Scenario 5b's partial sale, for instance, never happens in scenario 2.

### Sample data

| | Figure |
|---|---|
| Live account | Bybit sub-account `···7f3a`, connected 2 Aug 18:31, activated 2 Aug 18:40, 1,000.00 USDT at activation |
| First check after activating | 2 Aug 18:47: hold USDT, no change — the 1 Aug close was below the average (4.8) |
| First trade | 3 Aug 01:02: buy, after the 2 Aug close rose above the average. Order sent: buy with up to 999.00 USDT, 99.9% of the USDT. Filled: 0.011752 BTC at 85,000.00 for 998.92 USDT; fee 0.000012 BTC (about 1.00 USDT) |
| Holding BTC | 0.011740 BTC and 1.08 USDT |
| Latest daily close, 21 Sep | 86,100.00 USDT; 125-day average 82,400.00 (4.5% above). For simplicity, balances at 14:05 are valued at the same price |
| Value holding BTC | 1,011.92 USDT; result since activation on 2 Aug `+11.92 USDT ▲ (+1.19%)`, fees 1.00 USDT |
| The sale (scenario 3) | 18 Sep 01:02: sell, after the 17 Sep close fell below the average. Sold 0.011740 BTC at 83,500.00 for 980.29 USDT; fee 0.98 USDT |
| The completed cycle | 3 Aug to 18 Sep, 46 days: `−19.61 USDT ▼ (−1.96%)`, fees 1.98 USDT — what the purchase cost against what the sale returned |
| Holding USDT | 980.39 USDT and a remainder under 0.000001 BTC, together worth 980.41 USDT; result since activation on 2 Aug `−19.59 USDT ▼ (−1.96%)`, fees 1.98 USDT |
| Latest daily close in scenario 3 | 82,900.00 USDT; average 84,500.00 (1.9% below) |
| Stopped for review (5b) | Holdings when checked at 21 Sep 01:04: 0.006740 BTC and 422.16 USDT, worth 990.36 USDT at 84,300.00 |
| Key last checked | Scenarios 2, 3, and 5c: 22 Sep 01:02. Scenario 4: 19 Sep 01:02, its last check before the pause. Scenarios 5a and 5b: 21 Sep 01:02 |

### 1. First visit (PRACTICE)

A short sequence, each screen one idea:

1. **Welcome.** It follows one rule for Bitcoin, in the user's own exchange account. BTC only;
   one decision a day; money can be lost; practise first with pretend money.
2. **How it decides.** After each daily close it compares BTC's closing price with its average
   over the last 125 days: above, hold BTC; below, hold USDT. It moves the whole account at once.
   A simple static picture of a price line crossing its average.
3. **What to expect.** The historical evidence of section 4.3, with its required copy, plus: weeks
   can pass with no trade, and that is normal.
4. **Which money.** The whole dedicated account (4.1), money added later (4.5), and trading by
   hand (4.6).
5. **Check your understanding.** Three questions; a wrong answer shows a short explanation and
   the question again:
   - Can you lose money with this? — *Yes: most completed cycles in the test lost a little, and
     large drops can happen.*
   - Which money does it control? — *Every BTC and USDT in the account you set aside for it,
     including money added later.*
   - What happens when you pause? — *No new orders; what you hold stays as it is. BTC is not
     sold.*
6. **Start practice.** 1,000 pretend USDT, following the real rule on real prices; no money moves.
7. **Practice Home.** PRACTICE label; 1,000.00 USDT and 0 BTC; "No decisions yet. The first
   decision comes at the next check, within about 15 minutes, from the latest daily close. After
   that, one decision a day, about 01:00." (4.8)

**Going-live preview**, reachable from Practice Home, as two separate steps and no key form:

- **Step 1 — Connect.** Create a separate Bybit sub-account. Make an API key that can trade spot
  and nothing else — no withdrawals — restricted to our server's address. We check the key and
  show your balances. Nothing trades.
- **Step 2 — Activate.** See exactly what the strategy will control — "every BTC and USDT in
  `···7f3a`: now 0 BTC and 500.00 USDT (sample)" — the rule and its version, what pause does, and
  what activating does next: "The strategy applies the latest daily decision at its next check,
  within about 15 minutes. The latest close is above the average, so it would buy BTC with about
  499.50 USDT, unless a safety check stops it. After that, one decision a day, about 01:00." (4.8)
  You confirm.
- Available to users in Nigeria (#5). The manual-trading copy of 4.6 appears here.

### 2. Active, holding BTC (LIVE)

- **Home:** Active; holding BTC; `0.011740 BTC` and `1.08 USDT`; value 1,011.92 USDT, balances as
  of today 14:05; result and fees as in the sample data; last decision today 01:02, "hold BTC — no
  change"; next decision tonight, about 01:00. Action: **Pause**.
- **Strategy:** why it holds BTC now (price 4.5% above its average) and what would make it sell
  (a daily close below the average); the historical evidence; "MA-125, version 1 — the version
  you activated on 2 Aug".
- **Activity**, newest first, each entry openable for details:
  - today 01:02, decision: hold BTC, no change;
  - 4 Aug to 21 Sep, collapsed: "49 daily decisions, no change";
  - 3 Aug 01:02, filled: bought 0.011752 BTC at 85,000.00 for 998.92 USDT, fee 0.000012 BTC;
  - 3 Aug 01:02, order sent: buy with up to 999.00 USDT;
  - 3 Aug 01:02, decision: buy, after the 2 Aug close rose above the average;
  - 2 Aug 18:47, decision: hold USDT, no change — the 1 Aug close was below the average;
  - 2 Aug 18:40, trading activated by you; 2 Aug 18:31, account connected.
- **Account:** *Connection* and *Trading* as separate sections. Connection: `···7f3a`, key
  checked today 01:02 — spot trading only, withdrawals off, restricted to our server. Trading:
  active since 2 Aug, MA-125 version 1, every BTC and USDT in `···7f3a`. Also notifications (a
  mock), help, and the copy of 4.6.
- **Pause sheet:** "Pausing stops new orders. What you hold stays as it is: your BTC is not sold.
  An order already on its way is still confirmed and recorded. You can resume at any time." →
  paused (scenario 4).

### 3. Active, holding USDT (LIVE)

- **Home:** Active; holding USDT; 980.39 USDT and less than 0.000001 BTC, worth 980.41 USDT;
  result `−19.59 USDT ▼ (−1.96%) since 2 Aug · 51 days · fees 1.98 USDT`.
- **Strategy:** why it holds USDT now (the latest close 1.9% below its average) and what would
  make it buy (a daily close above the average).
- **Activity:** the 18 Sep sale, its decision, and the 3 Aug purchase — together one completed
  cycle, a losing one, labelled as such, with the cycle's own result and period: `−19.61 USDT ▼
  (−1.96%)`, 3 Aug to 18 Sep, fees 1.98 USDT. Not the account's result since activation, which
  runs to today.
- **"What if I add money?"**, the copy of 4.5.

### 4. Paused by you (LIVE)

- **Home:** "Paused by you since 19 Sep, 20:15. Nothing is bought or sold while paused." Holdings
  as scenario 3. "The strategy's latest decision is to hold BTC — the price closed above its
  average on 21 Sep — but nothing is traded while you are paused."
- **Resume sheet:** current holdings, then: "If you resume now, the strategy applies today's
  decision at its next check, within about 15 minutes. The latest daily close, on 21 Sep, was
  above the average, so it will use about 979.41 USDT to buy BTC, unless a safety check stops it.
  After that, one decision a day, about 01:00." (4.8) Confirm → active. Home and Activity then
  show the same next step, and nothing about today's decision beyond it.
- **Resuming when today's decision was already applied** — pausing at 14:05 in scenario 2 or 3,
  after that day's 01:02 check — changes nothing until the next decision, tonight about 01:00;
  what happens then depends on that close and the safety checks.
- *Corrected after reviewing the first draft:* this sheet first said the purchase would happen
  "at the next decision, about 01:00", unconditionally. The engine acts at the next check, and
  only if the safety checks pass.

### 5. Problem states (LIVE)

Each variant is its own link. Values that could not be refreshed are shown as last known, with
their time, never as current — and marked as such where the number is, not only in a caption.

**Pause stays available in 5a and 5c**, where the account itself is still active: the user can
pause it so it does not trade when the problem clears. **5b offers neither pause nor resume**: the
engine cannot pause an account stopped for review, and only a review lifts the stop.

**5a — Can't reach the exchange (temporary; nothing to do).** Holding BTC, as scenario 2.

- "Today's decision is delayed. We couldn't reach Bybit at 01:02, so nothing has been traded
  today. We keep trying every 15 minutes until the next daily close, tomorrow about 01:00. If
  today's decision still can't run by then, it is skipped and we'll tell you. You don't need to
  do anything."
- Balances as of yesterday 01:03: 0.011740 BTC and 1.08 USDT. Value then: 1,007.22 USDT, at
  85,700.00. Current value: unavailable. Last attempt 13:47; next about 14:02.

**5b — Stopped for review (an order didn't complete as expected).**

- "Trading stopped for review on 21 Sep at 01:03. An order to sell your BTC was only partly
  filled; the exchange cancelled the rest."
- What is known: sold 0.005000 of 0.011740 BTC at 84,300.00; holdings when checked at 01:04,
  0.006740 BTC and 422.16 USDT, worth 990.36 USDT then. The exchange is reachable here, so do not
  say the current value is unavailable — that is 5a's message; show the holdings as last checked,
  with their time.
- Activity shows the steps separately: the 21 Sep 01:02 decision to sell, after the 20 Sep close
  fell below the average; the order sent to sell 0.011740 BTC; the partial fill at 01:03; the stop
  for review.
- "No new orders will be placed until this is reviewed." One action: **Request review**, with a
  sample reference `R-0921-7F3A`. **No resume button.** The copy of 4.6.

**5c — Stopped for everyone by the operator.** Holding BTC, as scenario 2.

- "Trading is stopped for all accounts by the operator since 22 Sep, 09:40. This isn't caused by
  your account. No new orders are placed while the stop is on, and what you hold stays as it is.
  An order already on its way is still confirmed and recorded. You'll be told when trading
  resumes. You don't need to do anything."
- Last decision today 01:02, no change; next decision on hold while the stop is on.

The "still confirmed and recorded" promises in the pause sheet and in 5c describe required
behaviour that the engine does not have yet: requirement R1.

## 6. Interactions

Tab switching; the pause and resume sheets; the going-live preview; activity entries that open to
show their details, including a sample order reference; short definitions on tap for *completed
cycle*, *drop from a peak*, *fee*, and *pending order*; the understanding check. Nothing is saved
between visits.

**History only grows**, as the ledger does. Pausing and resuming each add an entry; a later action
never removes an earlier one, and no decision appears for an account on a day it was paused.

## 7. Out of scope

Real data of any kind; sign-in; key or credential entry; notifications beyond a mock setting;
weekly summaries; billing; resetting practice; charts beyond the static picture in scenario 1;
languages other than English; analytics; any production code; any deployment of the engine or of
customer software.

## 8. Facilitator guide

### 8.1 Participants and setup

- **5–10 people** from the founder's community. Record for each whether they have traded before
  and found it hard, or are new to trading — the draft plan's open segment question.
- **Before starting**, say: this is a prototype; every account figure is made up; nothing is
  connected to any account; you are testing the design, not being tested; please think aloud.
  Never ask for, look at, or accept keys, passwords, or screenshots of real accounts.
- **30–40 minutes.** Don't explain unless the participant is stuck; note every point where you
  had to.

### 8.2 Background questions (before the prototype)

1. Do you hold any crypto now? Mostly BTC, mostly USDT, or something else — and what do you use
   it for? (This tests the open assumption in `docs/research/validation.md` §6.)
2. Have you ever sold, or held on, during a big drop and regretted it?
3. Have you used a trading bot or copy-trading before? What happened?

### 8.3 Tasks

| # | Scenario | Ask | Success looks like |
|---|---|---|---|
| 1 | 1 | "In your own words, what does this do — and what doesn't it do?" | BTC only; one decision a day; moves the whole account; can lose money |
| 2 | 1 | "Based on what you saw, what happens to most of its trades?" | Most completed cycles lost a little; a few long trends made up for them |
| 3 | 1 | "Could it ever lose more than the 27.4% shown?" | Yes — the past worst drop is not a limit |
| 4 | 1 | "If you went live, which of your money would it control?" | Every BTC and USDT in the dedicated account, including money added later |
| 5 | 1 | "Start practising." | Done unaided; time it |
| 6 | 1 | "What's the difference between connecting and activating?" | Connecting only checks and reads; activating starts trading, after confirming the funds, and can trade within about 15 minutes |
| 7 | 2 | "Is it working right now? What does it hold, and when does it next decide?" | Active; BTC; about 01:00 tonight |
| 8 | 2 | "Find the last trade. What was the fee?" | Opens the 3 Aug fill and reads the fee |
| 9 | 2 | "Pause it. What happens to your BTC?" | Stays BTC; no new orders |
| 10 | 3 | "Why is it holding USDT, and what would make it buy?" | Price below the average; a daily close above it |
| 11 | 3 | "If you added 200 USDT, what might happen?" | It may be used to buy BTC at the next eligible decision, if checks pass |
| 12 | 3 | "If you bought some BTC in this account yourself, what could happen?" | The strategy may sell it again at its next decision |
| 13 | 4 | "It's paused. If you resume now, what happens next?" | Within about 15 minutes it buys BTC with its USDT, unless a safety check stops it |
| 14 | 5a | "Is something wrong? Do you need to do anything?" | Temporary; nothing needed; the figures are last known |
| 15 | 5b | "What happened, and what can you do?" | Stopped for review; request review; it can't simply be resumed |
| 16 | 5c | "What does this mean for your account?" | The operator stopped everyone; not their account's fault; nothing to do |

### 8.4 Closing questions

1. What was the most confusing moment?
2. Knowing that most completed cycles in the test lost money, would you still want this? Why?
3. Would you practise first? For how long?
4. If this cost a yearly fee in USDT, what would make it worth paying for? (No figure is quoted:
   the price is set by the pilot, #16.)

### 8.5 Recording and review

- For each task: done unaided, done with help, or not done; the participant's words; where they
  hesitated. Time task 5.
- After the first 2–3 sessions, fix the worst confusions before continuing, and note which
  sessions saw which version.
- At the end, a short summary: tasks that failed and why, the changes made, and what the
  sessions suggest for the open decisions of section 10.

## 9. Requirements the prototype reveals

None of these is built as part of this spec. Each belongs in a later engine or product spec.

**Before live customer use:**

- **R1 — Reconcile orders while paused or stopped.** An order already sent must still be looked up
  and its result recorded while the account is paused by its user, stopped for review, or under
  the operator-wide stop. Settling places nothing new. Today the engine skips such accounts
  entirely, so an order already on its way stays unrecorded until trading resumes.
- **R2 — Detect manual activity beyond locked funds**, for example by reconciling the exchange's
  order and trade history against the ledger. Today only open orders that lock funds are
  detected, and only at the daily decision.
- **R3 — A connected-but-not-active state.** Today, having an account at all means trading is
  active.
- **R4 — A record of the strategy version each user activated**, and a way to acknowledge a
  change before it governs their account.
- **R5 — The US and EU signup block, and the IP-restriction step**, in onboarding (#5, #20).

**Before the customer dashboard can show what the prototype shows:**

- **R6 — Cash-flow tracking**, so a result since activation separates deposits and withdrawals
  from trading.
- **R7 — The daily decision recorded every day**, even when no account is active, so a paused
  user can see what the strategy would do.
- **R8 — Balances read on demand**, separately from the engine's once-a-day run, each with the
  time it was read.
- **R9 — Per-user notifications**, with delivery tracking. Today alerts reach only the founder.
- **R10 — An account identity separate from the user**, so practice and live can exist side by
  side.

## 10. Open decisions

- **D1 — Where the multi-user practice pilot (Release B) sits.** It needs sign-in, per-user
  accounts, and a read API — work the build order puts in Phase 4, after the founder trades live
  in Phase 3 (#15). Options: (a) keep it there; (b) bring it forward, before real orders; (c) a
  small founder-run practice pilot with no self-service. Decide after the prototype sessions and
  the Bybit key test (#8), and ask the lawyer whether a practice-only pilot counts as opening the
  pilot (#18). Recorded as `docs/decisions.md` #23.
- **D2 — The first invited segment:** trading-fatigued, completely new, or a mixed group. The
  sessions' background questions inform it.
- **D3 — Whether annual growth is ever shown**, and where. Not in this prototype; the founder and
  the lawyer decide before any public page.
- **D4 — When a newly active account first acts.** Today the engine applies the latest daily
  decision at the next check, within about 15 minutes, when practice starts, trading is
  activated, or an account resumes (4.8) — the catch-up rule of #22 applied to a new start. The
  alternative is to wait for the next daily close. Recommendation: keep it, so an account that
  becomes active mid-day holds what the strategy holds, as a caught-up run would; activation and
  resume screens say so plainly. Changing it is an engine change and the founder's decision.

## 11. Done when

- The prototype covers every scenario in section 5, with the rules of section 4.
- 5–10 sessions are held with the facilitator guide.
- Their notes are summarised, the changes made are listed, and the summary is recorded alongside
  this spec.

The findings then feed the specs for Release B and C, and decision D1.

## 12. How this relates to the draft plan

**Adopted:** the four destinations; the automation states, with the operator-wide stop added; the
five scenarios; pause, freeze, and disconnect semantics; honest, timestamped data with no stale
figure shown as current; separate labels for historical test, practice, and live.

**Tightened:** historical results show drawdown and losing cycles, never growth; deposits "may be
traded", subject to minimums and safety checks; manual activity described as the engine actually
detects it.

**Added:** the IP-restriction step and the US/EU block (#5, #20); the operator-wide stop.

**Deferred:** weekly summaries, help references, notifications, billing, operator tools, and the
engineering bridge — to the Release B and C specs.

**Corrected elsewhere:** the parent spec's "set a risk limit" is superseded; the funds in the
dedicated account are the limit (#22).

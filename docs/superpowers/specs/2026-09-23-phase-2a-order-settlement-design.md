# Phase 2a — Settling orders while an account is not trading: design

- **Date:** 2026-09-23
- **Status:** design agreed with the founder, 2026-09-23. **Built** the same day on this branch,
  through pull requests #1 to #6; the plan's execution notes record what differed.
- **Parent spec:** `2026-09-22-phase-2-paper-engine-design.md`. This revises its section 4
  (one tick), section 8 (`account_state`), section 9 (when things go wrong), and settles one of
  its section 13 carry-forward items.
- **Comes from:** requirement **R1** and the Phase 2b note in
  `2026-09-22-customer-prototype-design.md` and the parent spec's section 13.
- **Branch:** `phase-2a-order-settlement`, created from `phase-2-paper-engine`. It comes before
  Phase 2b, because both parts must exist before the first real order.
- **Nothing here is deployed by an agent.** The founder deploys, as in `docs/deploy-vps.md`.

## 1. Goal

**An order that has been sent always ends with a recorded answer, whatever state its account is
in.** Today two paths lead nowhere, and both of them only bite when orders are real.

### Gap 1 — an account that is not trading is skipped completely

`runTick` processes accounts whose status is `active` (`src/engine/cycle.ts`, the `needing`
loop), and returns as soon as it sees the kill switch, before reading any account. So an order
already on its way when its user paused, when the engine froze the account, or when the founder
turned on the kill switch, stays unrecorded until trading starts again. The ledger is then
missing a trade the exchange has already made, the balances say one thing and the record says
another, and the user is told nothing.

This is requirement R1, and the prototype already promises users the opposite: *an order already
on its way is still confirmed and recorded*.

### Gap 2 — an order the exchange cannot show is a dead end

An order that stays `NOT_VISIBLE` for an hour freezes the account, correctly: elapsed time never
proves that an order was not placed, so a person must look. But after the founder unfreezes it,
the next tick asks the exchange again, gets `NOT_VISIBLE` again, finds the intent more than an
hour old, and freezes the account again. The ledger is append-only, so there is no way to record
what the person found, and the account can never trade again.

The parent spec's section 13 already requires the way out **before any real order is placed**.
The paper account can always answer, so neither gap can be reached in Phase 2; both are certain
in Phase 2b.

### In scope

- Settling outstanding orders for accounts that are paused, frozen, or under the kill switch.
- Pause and freeze as independent facts, so lifting a freeze never restarts a user's trading.
- A command that records what a person found for an order the exchange cannot show.
- `npm run status` listing orders that are still waiting for an answer.

### Out of scope, and where it goes

| Item | Goes to |
|---|---|
| Placing real orders on Bybit | Phase 2b |
| Detecting manual trading beyond funds locked in open orders (R2) | Phase 2b: it needs the exchange's order and trade history |
| Re-checking an order after a person has recorded its outcome, to catch a contradiction | Phase 2b, with R2 |
| Cancelling an order that is already on its way | Not planned: market orders settle in seconds, and a cancel the engine cannot confirm is worse than waiting |
| Per-user notifications (R9), a dashboard, more than one real user | Phase 4 |

## 2. Decisions

| Decision | Choice | Why |
|---|---|---|
| What the kill switch means | **No new orders.** Orders already sent are still looked up and recorded, and an account can still be frozen | An operator stop is when the record matters most. Reading an order the engine itself sent changes nothing on the exchange. A complete stop already exists: stopping the engine's timer, `crypto-autotrader-cycle.timer`, on the VPS |
| Whether a freeze can lift a pause | **Never.** Pause and freeze become two independent facts. Unfreezing an account its user paused returns it to paused | Only the user restarts their own trading. Without this, settling a paused account could freeze it, and the founder's unfreeze would start trading again on an account the user had stopped |
| What a person may record for an order | **Any settled outcome** — never placed, rejected, filled, or partly filled with its amounts — with the evidence they checked | A partial fill or a rejection that the exchange cannot show would otherwise be as much of a dead end as a missing order |
| When that is allowed | **Only while the exchange still cannot show the order.** If it can see the order, or can prove it absent, the command refuses | The exchange is the source of truth. A person's word is the last resort, not an override |
| Where settlement runs | **Inside the existing 15-minute tick**, as one code path with two callers | One set of rules, already tested. A second process would duplicate the rules and fight for the same database lock |

## 3. What changes in a tick

The numbered steps are the parent spec's section 4. Changes are marked **new**.

1. **Take the lock.** Unchanged.
2. **Kill switch.** Record it once a day and alert once a day, as today. **New:** then settle
   outstanding orders for every account (section 4), and stop. Nothing is sized or placed.
3. **Abandon stale runs.** Unchanged.
4. **Who needs a run?** Unchanged: active accounts whose run for the cycle date has not
   completed. **New:** every other account — paused or frozen — has its outstanding orders
   settled (section 4) before the tick moves on. Accounts with nothing outstanding cost nothing:
   one indexed query each.
5. **Candles**, 6. **signal**, 7. **each user in turn**, 8. **finish.** Unchanged. A tick that
   only settles never fetches candles and never computes a signal.

**New, in step 7 for each user:** the day's own fill is read from the ledger rather than only
from what this tick settled. An account whose order filled while it was paused, and which its
user then resumes the same day, goes straight to reconciliation with that fill in its summary,
instead of reporting "no change". Its `ORDER_RESULT` is already recorded, so nothing is placed
either way; this makes the summary and the ledger agree.

## 4. Settling an order for an account that is not trading

The rules are exactly the parent spec's section 4, step 1 — the same code, called from a second
place — with one difference: **nothing is ever sized, placed, or reconciled afterwards.** For
each outstanding intent, oldest first:

| The account's answer | What happens |
|---|---|
| **Found and settled** | Record the one `ORDER_RESULT` under the intent's own cycle date, and alert. Anything but `FILLED` freezes the account |
| **Found and still pending** | Nothing, and try again at the next tick. Still pending an hour after its intent: **freeze** |
| **Absent** — the adapter proves the order does not exist | Record `NOT_PLACED`. No replacement is ever placed here: this account is not trading |
| **Not visible** — the adapter looked and cannot prove absence | Record nothing, and try again at the next tick. Still not visible an hour after its intent: **freeze**, with the message naming `npm run order:record` |
| **The lookup fails or times out** | Record nothing. The intent stays outstanding and the next tick asks again |

Notes:

- **A freeze here is not a new state for an already frozen account:** its status does not change,
  the reason on the record stays the first one, and the alert says what settled and that the
  account stays frozen. This matters because most settlement while frozen happens on exactly the
  order that caused the freeze.
- **No `cycle_runs` row is created.** A paused or frozen account has no run for the day; settling
  is not a run. If a row for the current date does exist, a freeze marks it frozen, as today.
- **One alert per order settled**, not per tick, because each order settles once. Under the kill
  switch the daily kill-switch alert is still sent once, as today.
- **Balances are not read**, because nothing is sized. Manual trading on a stopped account is
  therefore not detected until it trades again — R2, in Phase 2b, is what detects it properly.
- **Nothing is reconciled.** A fill recorded here leaves the account holding whatever the fill
  produced, and the account is judged against its target only when it trades again.

## 5. Pause and freeze become independent

`account_state` holds one row per user. Today its `status` is one of `active`, `paused`, or
`frozen`, so a freeze overwrites a pause and an unfreeze produces `active`. Instead it records
two independent facts, each with its own reason and time:

- **paused** — the user stopped their own trading;
- **frozen** — the engine stopped it, and a person must look.

Everything that reads an account still sees a single status, derived: **frozen** if frozen,
otherwise **paused** if paused, otherwise **active**. The Risk Guard, the tick's `needing` loop,
`npm run status`, and the daily reminders are unchanged, except that a reminder names both facts
when both hold.

| Command | Today | After |
|---|---|---|
| `npm run pause` | Only an active account | An account that is not already paused, including a frozen one. Pausing before unfreezing is how the founder keeps an account stopped while a freeze is lifted, without the next tick trading in between |
| `npm run resume` | Only a paused account | Clears the pause. If the account is frozen it stays frozen, and the output says so |
| `npm run unfreeze` | Frozen to active | Clears the freeze. If the account is paused it stays paused, with the user's own reason, and the output says so |

The ledger keeps recording `PAUSED`, `RESUMED`, `FROZEN`, and `UNFROZEN` in the same
transaction as the change, and each payload gains the state that resulted, so the record still
explains the current state on its own. The migration maps every existing row to the same
meaning: `paused` becomes paused, `frozen` becomes frozen.

## 6. Recording what a person found

```
npm run order:record -- --order <clientOrderId> --status not-placed   --reason "what you checked"
npm run order:record -- --order <clientOrderId> --status rejected     --reason "..."
npm run order:record -- --order <clientOrderId> --status filled       --base <BTC> --quote <USDT> --fee <amount> --fee-coin <COIN> --reason "..."
npm run order:record -- --order <clientOrderId> --status partly-filled --base <BTC> --quote <USDT> --fee <amount> --fee-coin <COIN> --reason "..."
```

The command opens the database, so it holds the same lock as every other command: no tick can
run while it does. Then, in order:

1. **The order must be outstanding** for this user — an `ORDER_INTENT` with no `ORDER_RESULT`.
   Anything else is refused, naming what is already recorded.
2. **The exchange is asked once more.** Only `NOT_VISIBLE` allows the command to continue:
   - **found** — refused: the exchange can see the order, and the engine records its state at the
     next tick;
   - **absent** — refused: the account proves it was never placed, and the engine records that at
     the next tick;
   - **the lookup fails** — refused: try again when the exchange answers.
3. **The amounts are validated:** filled and partly filled need the base quantity that filled and
   the quote amount spent or received, both above zero, a fee of zero or more, and a fee coin
   that is the instrument's base or quote coin. The average price is computed from the amounts,
   never typed. Not placed and rejected take no amounts. The four words map to the statuses the
   engine already records: `not-placed` to `NOT_PLACED`, `rejected` to `REJECTED`, `filled` to
   `FILLED`, and `partly-filled` to `PARTIALLY_FILLED_CANCELLED`.
4. **A reason is required**, and is the founder's evidence: what they looked at, and what it
   showed.
5. **One `ORDER_RESULT` is appended**, under the intent's own cycle date, with the same fields
   the engine would have written, plus `source: 'operator'` and `evidence`, the reason given, so
   the record says who decided and on what. The unique index
   still holds each client order ID to one result, so this is the order's only answer.

It changes no account status: the founder unfreezes separately, when their check is finished, and
the output says so. A recorded `NOT_PLACED` authorizes a retry under a new ID at the next tick,
exactly as the adapter's own proof does, and the attempt cap of three a day still applies.

**What a wrong entry can and cannot do.** It cannot cause a second execution: sizing reads real
balances, so an order that did execute leaves the account already at its target, and the Risk
Guard vetoes a second order the same day. It can make the record wrong, which is why the evidence
is required and kept. Catching a contradiction automatically needs the exchange's trade history,
which is R2 in Phase 2b.

## 7. What does not change

- **`FOUND`, `ABSENT`, and `NOT_VISIBLE` keep their meanings.** Elapsed time and an empty lookup
  never prove that an order was not submitted.
- **No new order is ever placed for an account that is not trading**, whatever settlement finds.
- At most one order a day can execute; every retry gets its own client order ID; the ledger stays
  append-only; each client order ID has one intent and one result.
- The kill switch still stops all trading, and still records and alerts once a day.
- Freezing still needs a person to lift it, with a recorded reason.
- The strategy, sizing, the Risk Guard, reconciliation, and the paper account are untouched.

## 8. Operations

- **`npm run status`** gains a line per order still waiting for an answer: its client order ID,
  side, amount, the day it belongs to, and how long it has been outstanding. This is how the
  founder finds the order to check.
- **`docs/deploy-vps.md`** gains: when to stop the engine completely — `sudo systemctl disable
  --now crypto-autotrader-cycle.timer`, already in its section 10 — rather than use the kill
  switch; and what to do about an order the exchange cannot show, ending in
  `npm run order:record` and then `npm run unfreeze`.

## 9. Testing

Every test below must fail before its change and pass after it. The existing suite, the type
check, the historical parity test, and `npm audit --omit=dev` must all still pass.

**Settling while not trading** — the engine harness, with the paper account wrapped to simulate a
misbehaving exchange, since paper orders never pend and are never invisible:

1. A paused account with an order in flight: the next tick records its result, alerts, places
   nothing, and leaves the account paused.
2. The same for a frozen account: the result is recorded, the alert says the account stays
   frozen, and the freeze's reason is unchanged.
3. The kill switch on: outstanding orders are settled for every account, no order is placed, the
   tick still reports the kill switch, and the daily kill-switch alert is still sent once.
4. A paused account whose order comes back rejected, or partly filled: the account freezes, and
   unfreezing returns it to paused with the user's own reason.
5. A paused account whose order stays invisible for an hour: the account freezes.
6. An account resumed later the same day, after its fill was recorded while it was paused: the
   run completes, places nothing, and its summary names the fill.
7. Nothing outstanding: a paused or frozen account costs no exchange call.

**The dead end** — one test that reproduces it and one that clears it:

8. An order invisible for over an hour freezes the account; unfreezing and ticking freezes it
   again, with nothing recorded.
9. `order:record` with `not-placed` records the result; after unfreezing, the next tick places a
   new order under a new ID, and the day completes.

**The command's refusals:** the order is not outstanding; the exchange can see it; the exchange
proves it absent; the lookup throws; amounts missing, zero, or in a coin the instrument does not
use.

**Account state:** pause while frozen; resume while frozen leaves it frozen; unfreeze keeps a
pause and its reason; the derived status; the ledger events and their payloads; and the migration
mapping existing rows.

## 10. When this is complete

1. `npm test`, `npm run typecheck`, the parity test, and `npm audit --omit=dev` all pass.
2. Every test in section 9 exists and fails without its change.
3. `docs/deploy-vps.md`, `docs/decisions.md`, the parent spec's revision note, and `CLAUDE.md`
   are updated.
4. The branch is pushed. The founder decides when it merges and when it reaches the VPS: during
   the fourteen paper-trading days, deploying it would mix two versions of the engine into the
   evidence.

## 11. Changes to other documents

- `docs/superpowers/specs/2026-09-22-phase-2-paper-engine-design.md` — a revision note pointing
  here, for sections 4, 8, 9, and the section 13 carry-forward item this settles.
- `docs/superpowers/specs/2026-09-22-customer-prototype-design.md` — R1 is built; R2 is not.
- `docs/decisions.md` — a new entry for the three decisions in section 2: what the kill switch
  means, pause and freeze as independent facts, and what a person may record for an order.
- `docs/deploy-vps.md` — section 8.
- `CLAUDE.md` — the current state, the new command, and the merge order.

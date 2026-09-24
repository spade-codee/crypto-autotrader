# Strategy catalogue: requirements

- **Status:** requirements for later work, 2026-09-23. It records the founder's decision
  (`docs/decisions.md` #26) and what any later spec for more than one strategy must satisfy.
  **Nothing here is built, and nothing here is permission to trade.**
- **The founder's decision, relayed by Codex:** new strategies are **additions, never replacements
  for MA-125**. Users choose among strategies, and more are added over time.
- **Written with Codex's input:** Codex proposed one strategy per dedicated account for the first
  release, a switching contract, and eligibility per strategy. All three are adopted below, with
  details added.

## 1. What the catalogue is

The catalogue is a list of **strategy versions**. Each has its own evidence and its own
eligibility. A user picks from it, and the engine runs what they picked only where that version is
eligible.

## 2. A version is the unit

- **Every strategy has a stable id**, such as `ma-125` or `liquidity-sweep`.
- **Any change to what it trades, when, how much, or how it exits makes a new version.** A recorded
  version never changes.
- **A version is pinned to its evidence:** the commit where its rules were frozen, its research
  documents, and its results.
- **A version has exactly one implementation**, a pure function run unchanged in research and in
  the engine. This extends the rule "One strategy implementation, ever" to every version.

Each entry records:

| Field | MA-125, version 1 |
|---|---|
| Id and version | `ma-125` v1 |
| The rule in plain words | Holds BTC while its price is above its 125-day average, and USDT below it |
| Market | Bybit spot BTC/USDT, long or flat |
| When it decides | Once a day, after the 00:00 UTC close |
| How much of the account it uses | All of it: all in or all out |
| How it exits | At its next daily decision. It has no stop |
| What a user must accept | Most round trips lose, about 70% out-of-sample. Its worst stretches are choppy markets, and it gives up growth in bull markets |
| Evidence | `docs/research/phase-0-findings.md`; `docs/decisions.md` #19 |
| What it needs from the engine | Daily decisions and market orders |
| Eligibility | Practice (section 3) |

## 3. Eligibility belongs to a version, never to a switch

| State | Who may select it | Evidence to enter it |
|---|---|---|
| **Research** | Nobody. It may appear as a research card with no activate action | A written description with its rules |
| **Tested** | Nobody | Rules frozen at a commit, and the bars set in advance met on development data and on locked data |
| **Practice** | Practice (paper) accounts | Tested, and engine support built and reviewed |
| **Founder live** | Only the founder's own dedicated real-money account | Its practice bar met, real orders working (Phase 2b), its own checks (for example, exchange-side stops verified), `MAX_ORDER_USDT` set small, and the founder's recorded decision |
| **Live** | Customers' dedicated real-money accounts | The founder's run reviewed, the legal opinion (#18), the live-pilot gates, and the founder's recorded decision |
| **Not pursued** | Nobody | It failed a bar. The record stays, with its numbers |
| **Retired** | No new assignments | A recorded decision with its reason. Existing assignments follow the switching rules (section 5) |

- **The engine checks eligibility against each account's mode before every new entry.** A
  practice version never trades real money, and a research version never runs anywhere.
- **Every change of state is recorded**: who made it, when, and the evidence.
- **Moving down takes effect at once.** When a version is found broken, it stops opening trades
  everywhere. Its open trades keep their exits, and its users are told and asked to choose.
- **There is no blanket "strategies enabled" flag.** The global kill switch stays as the operator's
  emergency stop for everything.

**The catalogue on 2026-09-23:**

| Version | State | Next gate |
|---|---|---|
| MA-125 v1 | **Practice.** The paper engine is complete. Deploying it and the 14-day run are the founder's (plan Tasks 21 and 23) | Its practice bar, 14 clean days (Phase 2 spec §12). Then Phase 2b and the Bybit key test (#8) before Founder live |
| Liquidity sweep v0 | **Research**, in `docs/research/liquidity-sweep-candidate.md` | Tested: its development and locked-period bars |

## 4. Assignment

- **In the first release, one strategy version per dedicated exchange account.** Every BTC and USDT
  in the account belongs to that version (#22), ideally in a Bybit sub-account.
- **Assigning a version needs three things:**
  - the version is eligible for the account's mode;
  - the account meets the version's needs, such as a balance whose trades clear the exchange
    minimum under its sizing, or exchange features its exits rely on;
  - the user confirms that **exact version** after seeing its summary: what it does, how often
    it trades, how much of the account it uses, how it exits, what losing looks like, and its
    costs.
- **Each assignment is recorded:** the version, the account, who confirmed it, when, and the text
  they saw. The engine refuses to act on an account that has no assignment, or whose version is
  not eligible for its mode.
- **More strategies for one user means more dedicated accounts,** each with its own trade-only
  key and its own assignment. Two strategies never control one account: MA-125 is all in or all
  out, so it would sell the other strategy's BTC and spend its USDT. Slices of one shared account
  stay out unless #22 is reopened. It rejected them because our database would become the source of
  truth for each slice.

## 5. Switching

Switching moves an account from version A to version B. That covers both a change of strategy and
an upgrade to a new version of the same strategy. **No version changes under a user silently.**

1. **Nothing new while switching.** From the request until B is active, neither version opens a
   trade.
2. **Every sent order gets its answer first.** A's outstanding orders settle under the existing
   rule before B starts.
3. **An open position never loses its protection.** If A holds a position with protective exits,
   they stay until the position is gone.
4. **The user chooses what happens to A's holdings,** from the options the pair allows:
   - **Wait for A to finish.** A opens nothing new, its open trade ends by its own rules, and then
     B starts. This is the default and is always allowed.
   - **Close now.** Sell A's position at market, with the estimated fee and slippage shown. Cancel
     A's protective orders only once the sale is confirmed, then start B.
   - **Hand over.** B takes the holdings as they are. This is allowed only where B's rules can own
     an existing position. MA-125 can, because its next decision moves the account to its target.
     The liquidity strategy cannot: it has no stop for a position it did not open.
5. **Disclosure before confirmation,** in plain words:
   - what the account holds now;
   - what will happen to it under the chosen option, with estimated costs;
   - which protective orders remain, and until when;
   - when B first decides: for MA-125 the next 00:00 UTC close, for the liquidity strategy the
     next day it can arm a setup;
   - B's version summary.

   Switching does not change the product fee, which is a flat yearly fee (#16).
6. **Confirmation of the exact version,** recorded as for an assignment.
7. **Recorded and repeatable safely.** A switch is recorded when requested and when completed. A
   repeated request changes nothing, and an account never has two active assignments.

A pause is not a switch: it stops new entries under the same assignment. What a pause, a freeze
and the kill switch mean for a strategy with protective exits is set per strategy. For the
liquidity candidate, see its draft, section 8, question 4.

## 6. Operator controls

- **The global kill switch, unchanged:** no new orders for anyone, while orders already sent
  still settle (#24, on `phase-2-paper-engine`).
- **A stop for one version, new:** it stops new entries for that version everywhere, while exits
  and settlement continue. It is needed before a second version runs anywhere.

## 7. What the engine will need later

These are specs for when a second version reaches **Tested**, not before:

- a registry mapping each version to its implementation and its declared needs: when it decides,
  which orders it uses, and how it sizes;
- assignment and switch records, with the eligibility check before every new entry;
- a strategy version on every event, order ID and report;
- the stop for one version;
- reports and self-checks per strategy;
- practice accounts for more than one strategy.

The product plan's engineering bridge already lists "persisted activation/consent and
strategy-version records". These requirements give those records their shape.

## 8. Where this sits in the release sequence

| Release (product plan) | The catalogue's part |
|---|---|
| A: experience prototype | Shows MA-125 as the strategy to practise, and research entries as research cards with no activate action. Codex's design lab does this |
| B: private practice pilot | Users pick a version eligible for Practice, which today is only MA-125 v1. Assignment and confirmation are recorded |
| C: controlled live pilot | Real money only for Live versions, or Founder live on the founder's own account. The switching rules are built, including waiting for a trade to finish |
| Later | Several strategies per user, through several dedicated sub-accounts. New versions enter only through the gates |

## 9. Candidates after the liquidity research

Codex is saving this shortlist with its sources, and is keeping evidence for a family of
strategies separate from proof of our own implementation. **None is built now, and the liquidity
research does not widen to include them.** Each enters as Research with its own evidence. What
each would meet:

| Candidate | Fits today's engine? | What to watch |
|---|---|---|
| **BTC channel breakout** (Donchian) | Largely. Daily, long or flat, all in or all out: the shape the existing backtester and engine already run | It is close kin to MA-125, since both hold BTC in uptrends. The question is whether it adds anything MA-125 does not |
| **Volatility-managed trend** | As a new version of MA-125, not a new strategy: the same signal, with the amount held set by recent volatility | Holding part of the account changes all-in-or-out sizing. It must beat MA-125 v1 on the same out-of-sample data to earn its place |
| **Cross-asset relative momentum** | No. It needs several assets, point-in-time listings, and multi-asset accounts | #21 admits only assets that earned their way in. Delisted coins must be in the data, or the survivors flatter the result, as the meme-coin check found |

**On order, since the founder delegated the choice:** the liquidity research is already bounded
and comes first. If the founder then wants a second entry quickly, a daily channel breakout is the
cheapest to test, because it reuses the existing backtester, data and engine. It is also the one
most likely to duplicate MA-125.

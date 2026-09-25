# Strategy catalogue: requirements

- **Status:** requirements for later work, 2026-09-23. It records the founder's decision
  (`docs/decisions.md` #26) and what any later spec for more than one strategy must satisfy.
  **Nothing here is built, and nothing here is permission to trade.**
- **The founder's decision, relayed by Codex:** new strategies are **additions, never replacements
  for MA-125**. Users choose among strategies, and more are added over time.
- **Written with Codex's input:** Codex proposed one strategy per dedicated account for the first
  release, a switching contract, and eligibility per strategy. All three are adopted below, with
  details added.
- **2026-09-25:** the liquidity sweep, the first candidate, could not be tested and is not pursued
  (section 3, and #27). Sections 5 and 5a keep it as their worked example of a second strategy with
  its own timing and exits. Their rules hold for any strategy.

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
| **Not pursued** | Nobody | It failed a bar, or made too few trades to be judged by one. The record stays, with its numbers |
| **Retired** | No new assignments | A recorded decision with its reason. Existing assignments follow the switching rules (section 5) |

- **The engine checks eligibility against each account's mode before every new entry.** A
  practice version never trades real money, and a research version never runs anywhere.
- **Every change of state is recorded**: who made it, when, and the evidence.
- **Moving down takes effect at once.** When a version is found broken, it stops opening trades
  everywhere. Its open trades keep their exits, and its users are told and asked to choose.
- **There is no blanket "strategies enabled" flag.** The global kill switch stays as the operator's
  emergency stop for everything.

**The catalogue on 2026-09-25:**

| Version | State | Next gate |
|---|---|---|
| MA-125 v1 | **Practice.** The paper engine is complete. Deploying it and the 14-day run are the founder's (plan Tasks 21 and 23) | Its practice bar, 14 clean days (Phase 2 spec §12). Then Phase 2b and the Bybit key test (#8) before Founder live |
| Liquidity sweep v0 and v1 | **Not pursued. Untestable on 2022–2024,** against the 30 trades needed: version 0 made 3, and version 1's best ladder step 29. No return was ever computed. Results: `docs/research/liquidity-sweep-results.md` and `docs/research/liquidity-sweep-v1.md` on `research-liquidity-sweep` | None. No further version is tried (#27) |

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
   - when B first decides, as one effective time the backend computes (see below);
   - B's version summary.

   Switching does not change the product fee, which is a flat yearly fee (#16).
6. **Confirmation of the exact version,** recorded as for an assignment.
7. **Recorded and repeatable safely.** A switch is recorded when requested and when completed. A
   repeated request changes nothing, and an account never has two active assignments.
8. **A preview is confirmed against a revision.** The backend returns:
   - the exact version;
   - its eligibility, or the reason it is blocked;
   - the current position and any unresolved orders;
   - the exits kept;
   - the transitions allowed;
   - the estimated cost, with its timestamp;
   - the earliest possible new decision.

   The preview carries the account's revision and an expiry. Confirming it after the account has
   changed, or after it has expired, fails, and a fresh preview is needed.

**When B first decides** (corrected 2026-09-24, after Codex's review at `6115b80`). An earlier
version of this document said MA-125 first acts at the next 00:00 UTC close. That was wrong.
**Switching is not an exception to a strategy's own timing:**

| Version | First decision after the switch |
|---|---|
| **MA-125** | Its latest unprocessed daily decision, at the next tick, within 15 minutes. This is the same catch-up rule as any late run (#22), and like one it is abandoned at the next daily close. The prototype's activation rule already says this |
| **The liquidity strategy** | The next 15-minute close, if that UTC day's first touch has not happened yet; otherwise the next UTC day. It never catches up, because it allows no late entries |

The difference between strategies is the point to show. MA-125 catches up its latest decision; the
liquidity strategy never does.

A pause is not a switch: it stops new entries under the same assignment. What a pause, a freeze
and the kill switch mean for a strategy with protective exits is set per strategy. For the
liquidity candidate, see its draft, section 8, question 4.

## 5a. What a user may change, and when

Added 2026-09-24. The founder asked whether the liquidity strategy will be automated and whether
users can tweak it. Codex proposed a contract (`prototypes/customer/CUSTOMIZATION-NOTE.md` at
`356cf42`), and this section is the backend's answer to its four questions.

**Automation.** If a version passes every gate in section 3, the engine runs its whole life
without a person:
- it watches, arms, confirms and enters;
- it reconciles the fills;
- it keeps the position protected until it exits.

Nothing is automated before then: version 0 is offline research.

**Two kinds of setting, kept apart.**

| Kind | Examples | Who sets it | Changes the version? |
|---|---|---|---|
| **Strategy rules** | Swing size, confirmation window, the stop-distance floor, stop placement, target, time limit | Only a published version | **Yes**: every change is a new version |
| **Account preferences** | Risk per trade, within the version's allowed range; pause; notifications | The user | No |

**Which rules the research harness accepts.** The liquidity strategy's configuration has six rule
settings:
- swing size;
- waiting window;
- stop-distance floor;
- stop placement, as one price step or a multiple of the ATR;
- target multiple;
- time limit.

The price step is an exchange fact, not a setting. The fields exist so the research can run its
eight neighbours; they are not user settings. **In version 0 all six are locked.**

- **A changed rule is a new configuration with no evidence of its own.** It inherits nothing from
  version 0's results, and it starts at Research.
- **The neighbours can never become presets.** They are shown, and never used to choose (the
  draft, 6.4). Picking the best one after seeing results is the data-mining the pre-registration
  exists to prevent. A preset is a version that went through the same gates: its own rules, fixed
  before any data, and its own test.
- **There will be no user-built rule sets.** Each would be a separate, untested hypothesis traded
  with this engine under this product's name. "Tweak your bot" is also the language of the signal
  sellers that the fraud context in `docs/decisions.md` warns about.

**Risk per trade is the one user setting worth offering,** once a version is live-eligible:

- It changes the size of a trade, never which trades happen. Results in R do not depend on it, so
  a version's evidence holds across its allowed range. The one exception is a buy too small for the
  exchange's minimum, which is skipped.
- **Its allowed range belongs to the version.** It is set from that version's evidence and never
  above the risk it was tested at. For the liquidity strategy that is 0.25%, the research setting.
  The floor is the lowest risk at which the account's buys still clear the exchange minimum of 5
  USDT, and the screen shows that minimum account.
- **A risk setting is an input to sizing, not a guaranteed cap on loss.** A price that jumps past
  the stop can lose more.
- **It never frees the rest of the account for anything else.** A strategy still owns its whole
  dedicated account (#22), however much of it a trade uses.

**How a configuration is identified.** Each version is recorded with:
- its strategy and version number;
- a snapshot of every rule setting, with a hash of that snapshot, so identical rules are one
  configuration;
- the commit of its implementation;
- its evidence;
- its eligibility.

An assignment records the version, a snapshot of the account's preferences, the text the user
confirmed, and when (section 4).

**When a change takes effect.**

| Change | Takes effect | Never |
|---|---|---|
| Risk per trade | At the next confirmation close, where sizing happens. A setup already waiting is sized with the setting in force at its confirmation | Changes an open trade's quantity or its exits |
| Another version or preset | By the switching rules (section 5). Waiting for the open trade to finish is the default; a waiting setup is discarded when the switch is requested | Alters the protection of an open trade |
| A new version published | Never on its own: the user confirms it. Until then the account runs the version it confirmed, while that version stays eligible | Silently upgrades anyone |

## 6. Operator controls

- **The global kill switch, unchanged:** no new orders for anyone, while orders already sent
  still settle (#24, on `phase-2-paper-engine`).
- **A stop for one version, new:** it stops new entries for that version everywhere, while exits
  and settlement continue. It is needed before a second version runs anywhere.
- **No stop of any kind cancels an exit that still protects a position.** An orphaned exit is one
  whose position is confirmed gone. It is cancelled in every state, the kill switch included,
  because a stale sell could act on funds deposited later. The liquidity draft's live gate, in
  section 8, sets out partial exits, races and completing a triggered exit.

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

**2026-09-25:** the liquidity research has ended, untestable. The channel breakout is next once the
founder says go, with its own pre-registration. Nothing has started.

# CLAUDE.md

Orientation for any agent working in this repository. Read this first, then the documents it
points to.

## What this is

A non-custodial crypto trading automation product for the Nigerian market, currently at the
design and research stage. Users would connect their own exchange account with an API key that
has trading enabled and **withdrawals disabled**, and the software would run a mechanical BTC
trend-following strategy on their account. Money never leaves the user's own exchange account.

**No application code exists yet.** The repository holds the design, the build plan for the
first phase, product research, and a full decision log.

- **Working name: `crypto-autotrader`.** A placeholder, not a brand. No name has been chosen.
- **Founder:** a solo technical builder based in Nigeria, with an existing local crypto
  community and a VPS.

## Current state — as of 2026-09-17

| Area | State |
|---|---|
| Design | Approved |
| Phase 0 — strategy proof | **Complete** on branch `phase-0-backtest`. 67 tests. Result in `docs/research/phase-0-findings.md` |
| Phase 0 result | **Passes, with claims narrowed.** Out-of-sample, MA-125 cut max drawdown to 27.4% from buy-and-hold's 53.1%, but gave up ~9 points of annual growth. Insurance, not a return enhancer |
| Product research | Complete — and it **reopened the business model** |
| Name | **Undecided** — "Keel" was rejected after a verified conflict |

**Decisions waiting on the founder:**

1. **Target account size and fee model** — flat fee at $3,000+ accounts, profit share at small
   accounts, or signals only. This is the blocking one. See `docs/decisions.md` #16. Phase 0
   sharpened it: users already give up return in bull markets, so a fee is a second cost.
2. **Review the Phase 0 verdict** — `docs/research/phase-0-findings.md`. See `docs/decisions.md` #19.
3. **The name** — Duro is recommended. See `docs/brand.md` section 2.
4. Billing in USDT, and moving the legal opinion to month one — both recommended. `docs/decisions.md` #17 and #18.
5. **Upgrade Node on both machines** to 22.12+ (or 24) before Phase 1. One machine runs Node 20,
   which reached end-of-life in April 2026; `vitest` was held at 4.1.11 because 5.x needs 22.12+.

## Read in this order

1. **`docs/decisions.md`** — every decision, the alternatives, the reasoning, and what is still open. Start here.
2. `docs/research/phase-0-findings.md` — whether the strategy works, and what that means for the product.
3. `docs/superpowers/specs/2026-09-16-crypto-trading-automation-design.md` — the design spec. Read its 2026-09-17 update note first.
4. `docs/superpowers/plans/2026-09-16-phase-0-backtest.md` — what Phase 0 built. Its closing
   *Execution notes* explain where the code deliberately differs from the plan.
5. `docs/stack-and-setup.md` — stack choices, and the operational pitfalls that cost real money.
6. `docs/brand.md` — palette, typography, voice rules, and name status.
7. `docs/research/` — validation, competitor teardown, naming, landing copy.

## What to do next

**Phase 0 is done.** To reproduce its result on any machine: `npm install`, `npm run fetch`, then
`npm run sweep`.

**Do not start Phase 1 or later** until the founder resolves the fee-model decision. It changes
who the product is for, and therefore onboarding, pricing, and licensing exposure.

Work that does not depend on that decision, if the founder asks for it:

- The optional research in `docs/research/phase-0-findings.md` — blending MA-100/125/150 into one
  signal, and repeating the test on ETH as an out-of-asset check.
- The waitlist landing page, once a name is chosen — copy is drafted in `docs/research/landing-copy.md`.

## Running the code

| Command | Does |
|---|---|
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run fetch` | Downloads Bybit spot and long-history daily candles into `data/` (gitignored) |
| `npm run backtest` | MA-200 against buy-and-hold on both datasets. Set `MA_PERIOD` to change |
| `npm run sweep` | Every period, in-sample and out-of-sample — the Phase 0 result |

**Bybit is DNS-blocked on Nigerian networks.** `api.bybit.com` fails to resolve, while Bybit's
official alternate domain `api.bytick.com` answers. The fetcher falls back automatically; set
`BYBIT_API_BASE` to force one host.

## Working across two machines

The founder builds on two machines, kept in sync through GitHub. Neither machine is the source
of truth — the remote is.

- **`git pull` before starting any work**, every session. Check which branch the current phase
  lives on before creating anything.
- **Commit and push after every task.** Small, frequent pushes keep the machines from drifting
  far enough apart to conflict.
- **One branch per phase** — for example `phase-0-backtest`. Merge to `master` only when the
  phase is complete and verified.
- **If a push is rejected**, the other machine pushed first: `git pull --rebase`, re-run the
  tests, then push. **Never force-push.**
- **Not in git, so rebuild on each machine:** `node_modules/` (`npm install`), `data/*.csv`
  (`npm run fetch`), the subagent collection (`setup/update-subagents.ps1`), and Claude's
  memory, which is local to each machine.
- **Keep Node versions matched** across machines, so a test that passes on one passes on the
  other.

## Rules that are not negotiable

Each rule prevents a specific way of losing a user's money.

- **Never use JavaScript floats for money or quantities.** `decimal.js` in code, `NUMERIC` in
  Postgres. Never `parseFloat` an exchange response — go straight from string to Decimal.
- **One strategy implementation, ever.** The strategy is a pure function (`StrategyFn`), and the
  identical function runs in backtest and production. Never write a second implementation.
  `src/strategy/` must import nothing except `../math.js` and `../types.js`.
- **No lookahead.** A signal computed from candle N's close executes at candle N+1's open.
- **Backtests include fees and slippage.** Without them the results are fiction.
- **Choose parameters in-sample, verify out-of-sample**, and pick from a broad plateau of working
  values — never the single best one.
- **Spot only.** No leverage, futures, or margin.
- **The exchange is the source of truth for positions**, never the database.
- **Fail closed.** On any ambiguity — cannot read balances, cannot fetch prices — do nothing and
  alert.
- **Idempotent orders** through deterministic client order IDs.
- **Never accept an API key that has withdrawal permission.** Verify it with the exchange, not by
  trusting the user.
- **Never state or imply a return** in any user-facing text. No urgency, no hype, no "AI trading"
  vocabulary. See `docs/brand.md` section 5 and the fraud context in `docs/decisions.md`.

## Working with the founder

- **Prefers a clear recommendation with reasoning**, alongside two or three genuine options,
  over an open-ended survey. Often asks to be led — so lead, but keep each decision explicit
  enough to overrule.
- **Wants honest pushback.** Agreeable answers are not useful here. The research agents were
  commissioned specifically to argue against the idea.
- **Defer to the founder on the Nigerian market** — which exchanges people use, language,
  payment behaviour, the community. Their read beats desk research on those.
- **Writes informally and quickly.** Read for intent.
- **Verify research-agent claims before relaying them.** In this project a research agent cited
  trademark serial numbers that contradicted its own findings, and a conversation summary
  overstated an exchange-access problem. Check load-bearing claims against their sources.

## Repository layout

```
CLAUDE.md                     this file
README.md                     overview and new-machine setup
docs/
  decisions.md                decision log — start here
  stack-and-setup.md          stack, pitfalls, accounts checklist
  brand.md                    brand system and name status
  superpowers/
    specs/                    design spec
    plans/                    implementation plans, one per phase
  research/                   validation, competitors, naming, landing copy, Phase 0 findings
src/
  types.ts, math.ts           shared types; exact Decimal mean
  strategy/trendFilter.ts     THE strategy — pure, reused unchanged in production
  backtest/                   engine (next-open execution, warm-up), costs, metrics, report
  data/                       Bybit fetcher with host fallback, CSV storage, dataset definitions
  cli/                        fetch, backtest, sweep
tests/                        mirrors src/
data/                         downloaded candles — gitignored, rebuild with npm run fetch
setup/
  update-subagents.ps1        installs or updates the VoltAgent subagent collection
```

## Placeholders and stale references to watch for

- **`crypto-autotrader`** — the repository, folder, and planned `package.json` name. Rename
  everywhere once a brand is chosen.
- **"Keel"** — appears throughout `docs/research/`, which predates its rejection. Do not use it.
- `docs/research/landing-copy.md` assumes the $100–$1,000 target segment, which is now open.

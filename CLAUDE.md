# CLAUDE.md

Orientation for any agent working in this repository. Read this first, then the documents it
points to.

## What this is

A non-custodial crypto trading automation product for the Nigerian market, currently at the
design and research stage. Users would connect their own exchange account with an API key that
has trading enabled and **withdrawals disabled**, and the software would run a mechanical BTC
trend-following strategy on their account. Money never leaves the user's own exchange account.

**Code exists for Phase 0** — the strategy, backtest engine, and data fetcher — **and Phase 1** — a
read-only Bybit connection with an encrypted key vault. **No order-placing or user-facing code
exists yet.** The repository also holds the design, product research, and a full decision log.

- **Working name: `crypto-autotrader`.** A placeholder, not a brand. No name has been chosen.
- **Founder:** a solo technical builder based in Nigeria, with an existing local crypto
  community and a VPS.

## Current state — as of 2026-09-17

| Area | State |
|---|---|
| Design | Approved |
| Phase 0 — strategy proof | **Complete and merged to `master`.** 67 tests. Result in `docs/research/phase-0-findings.md` |
| Phase 0 result | **Passes, with claims narrowed.** Out-of-sample, MA-125 cut max drawdown to 27.4% from buy-and-hold's 53.1%, but gave up ~9 points of annual growth. Insurance, not a return enhancer |
| Phase 1 — read-only Bybit connection | **Code complete** on branch `phase-1-exchange-adapter`, 156 tests. **Awaiting the founder's testnet check (plan Task 15)** before merging |
| Product research | Complete. It reopened the business model, which was re-decided 2026-09-17 |
| Name | **Undecided** — "Keel" was rejected after a verified conflict |

**Decided 2026-09-17:** the product places trades for users, with a flat yearly fee in USDT and a
free tier below an account-size threshold. The pilot sets the price and threshold.
`docs/decisions.md` #16 and #17.

**Waiting on the founder:**

0. **Run Phase 1 Task 15 on testnet** — create a spot-only testnet key at testnet.bytick.com and
   run `vault:init`, `key:add`, `key:check`, `balance`. Steps are in the Phase 1 plan.
1. **Review the Phase 0 verdict** — `docs/research/phase-0-findings.md`. See `docs/decisions.md` #19.
2. **The name** — Duro is recommended. See `docs/brand.md` section 2.
3. **The legal opinion, in month one** — it gates opening the pilot to anyone but the founder.
   `docs/decisions.md` #18.
4. **Upgrade Node on both machines** to Node 24 LTS. One machine runs Node 20, which reached
   end-of-life in April 2026; `vitest` is held at 4.1.11 because 5.x needs Node 22.12+.

## Read in this order

1. **`docs/decisions.md`** — every decision, the alternatives, the reasoning, and what is still open. Start here.
2. `docs/research/phase-0-findings.md` — whether the strategy works, and what that means for the product.
3. `docs/superpowers/specs/2026-09-16-crypto-trading-automation-design.md` — the design spec. Read its 2026-09-17 update note first.
3a. `docs/superpowers/specs/2026-09-17-phase-1-exchange-adapter-design.md` — Phase 1's security design: key allowlist, vault, signing.
4. `docs/superpowers/plans/2026-09-16-phase-0-backtest.md` — what Phase 0 built. Its closing
   *Execution notes* explain where the code deliberately differs from the plan.
5. `docs/stack-and-setup.md` — stack choices, and the operational pitfalls that cost real money.
6. `docs/brand.md` — palette, typography, voice rules, and name status.
7. `docs/research/` — validation, competitor teardown, naming, landing copy.

## What to do next

**Phase 0 is done.** To reproduce its result on any machine: `npm install`, `npm run fetch`, then
`npm run sweep`.

**Phase 1's code is complete on branch `phase-1-exchange-adapter`** — the read-only Bybit
connection: signed client, permission-allowlist key validation, encrypted vault, balance reads.

- Spec: `docs/superpowers/specs/2026-09-17-phase-1-exchange-adapter-design.md`
- Plan: `docs/superpowers/plans/2026-09-17-phase-1-exchange-adapter.md` — read its execution notes

What remains: **Task 15, which the founder runs** because it needs a real testnet API key — never
ask them for one, and never read their terminal while they enter it. Once they confirm it passed,
record the outcome in the Phase 1 spec (section 10) and merge the branch to `master`.

Other work, if the founder asks for it:

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
| `npm run vault:init` | Create this machine's `.env.local` with a vault master key. Refuses to overwrite |
| `npm run key:add` | Validate a Bybit key and store it encrypted. Interactive terminal only; secret input is hidden |
| `npm run key:check` | Re-validate the stored key |
| `npm run balance` | Read balances with the stored key, after re-validating it |

Settings for the key commands, read from the environment or `.env.local`: `BYBIT_ENV`
(`testnet`, the default, or `mainnet`), `USER_ID` (default `founder`), `DB_DIR` (default
`data/db`), and `SERVER_IPS` (comma-separated; required before a mainnet key is accepted).

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
- **Each machine has its own vault.** `.env.local` holds that machine's master key and
  `data/db/` its stored keys. Credentials never travel between machines: run `vault:init` and
  `key:add` on each one that needs them.
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
- **Never ask for, handle, log, or type an API key or secret.** Wrap them in `Secret`. Keys are
  entered only by the founder, in their own terminal.
- **Re-validate a key every time it is used.** Never place an order with a key that fails
  `validateKeyInfo`.
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
  data/                       public market data: Bybit candle fetcher, CSV storage, datasets
  net/http.ts                 GET with host fallback, shared by market data and account access
  secrets/secret.ts           Secret — prints [redacted] everywhere
  exchange/                   account access: environments, key info and balance shapes
    bybit/                    hosts, signing, signed client, parsers, key validation
  vault/                      master keyring, AES-256-GCM sealing, credential vault
  db/                         Drizzle schema and PGlite client
  app/credentials.ts          connect, check, and balance flows
  cli/                        fetch, backtest, sweep, vault-init, key-add, key-check, balance
drizzle/                      generated SQL migrations — committed
tests/                        mirrors src/, plus helpers/ and fixtures/
data/                         downloaded candles and data/db/ — gitignored
setup/
  update-subagents.ps1        installs or updates the VoltAgent subagent collection
```

## Placeholders and stale references to watch for

- **`crypto-autotrader`** — the repository, folder, and planned `package.json` name. Rename
  everywhere once a brand is chosen.
- **"Keel"** — appears throughout `docs/research/`, which predates its rejection. Do not use it.
- `docs/research/landing-copy.md` assumes a $100–$1,000 paid segment; the fee decision (#16) since
  made small accounts a free tier.

# CLAUDE.md

Orientation for any agent working in this repository. Read this first, then the documents it
points to.

## What this is

A non-custodial crypto trading automation product for the Nigerian market, currently at the
design and research stage. Users would connect their own exchange account with an API key that
has trading enabled and **withdrawals disabled**, and the software would run a mechanical BTC
trend-following strategy on their account. Money never leaves the user's own exchange account.

**Code exists for Phase 0** — the strategy, backtest engine, and data fetcher — **Phase 1** — a
read-only Bybit connection with an encrypted key vault — **and Phase 2** — the daily engine,
trading a paper account on live Bybit prices. **Nothing places a real order yet, and there is no
user-facing code.** The repository also holds the design, product research, and a full decision log.

- **Working name: `crypto-autotrader`.** A placeholder, not a brand. No name has been chosen.
- **Founder:** a solo technical builder based in Nigeria, with an existing local crypto
  community and a VPS.

## Current state — as of 2026-09-23

| Area | State |
|---|---|
| Design | Approved |
| Phase 0 — strategy proof | **Complete and merged to `master`.** 67 tests. Result in `docs/research/phase-0-findings.md` |
| Phase 0 result | **Passes, with claims narrowed.** Out-of-sample, MA-125 cut max drawdown to 27.4% from buy-and-hold's 53.1%, but gave up ~9 points of annual growth. Insurance, not a return enhancer |
| Phase 1 — read-only Bybit connection | **Code complete** on branch `phase-1-exchange-adapter`, 156 tests. **Awaiting the founder's check (plan Task 15)** before merging. Bybit refused API key creation on the founder's unverified account; testnet is untested |
| Phase 2 — paper-trading engine | **Code complete** on branch `phase-2-paper-engine`, 537 tests with Phase 2a, after a code review whose six findings were all fixed — see the plan's execution notes. **Awaiting deployment to the VPS** (plan Task 21, the founder's). The phase completes after 14 clean days of paper trading (spec section 12). Trades a paper account on live Bybit prices, so it needs no key. Its cross-process lock test was fixed on 2026-09-23 to kill the process that really holds the lock; before, it failed intermittently on Windows and would have failed on Linux, including the `npm test` the runbook asks for on the VPS |
| Phase 2a — order settlement | **Complete, and merged into `phase-2-paper-engine`** (pull request #8) before any deployment, so the 14-day paper run covers it. Built through pull requests #1 to #6. An order already sent always gets its one recorded answer, whatever state its account is in; pause and freeze are independent; `npm run order:record` records what the founder finds for an order the exchange cannot show. Required before any real order |
| Engine self-check | **Complete**, built through pull requests #15 to #24 and merged into `phase-2-paper-engine` before any deployment. Each morning the engine replays the previous days' decisions on fresh data and costs their fills against the backtest's 0.15% a trade, recording both and alerting only when something is off. It never changes a trade and makes no extra request. Spec: `docs/superpowers/specs/2026-09-23-engine-self-check-design.md` |
| Product research | Complete. It reopened the business model, which was re-decided 2026-09-17 |
| Name | **Undecided** — "Keel" was rejected after a verified conflict |

**Decided 2026-09-17:** the product places trades for users, with a flat yearly fee in USDT and a
free tier below an account-size threshold. The pilot sets the price and threshold.
`docs/decisions.md` #16 and #17.

**Waiting on the founder:**

0. **The Bybit key test** — Bybit refused to create an API key on the founder's account, most
   likely because identity verification is incomplete. Complete Standard verification and
   Google Authenticator, then retry at `www.bytick.com`. It decides `docs/decisions.md` #8:
   whether a verified Nigerian user can create an API key. Meanwhile, try testnet sign-up for
   Phase 1 Task 15 — it has not been tried. The licensed alternatives,
   Quidax and Busha, both fail as documented; `docs/research/exchange-alternatives.md` lists
   the questions to put to them.
1. **Deploy Phase 2 to the VPS** — plan Task 21. Create a Telegram bot and a Healthchecks.io
   check, then follow `docs/deploy-vps.md`, starting with its Bybit reachability check. The bot
   token and the ping URL are secrets: the founder types them into `.env.local` on the VPS, and
   no agent ever asks for them. The 14-day paper-trading clock (Task 23) starts at the first
   timed tick.
2. **Review the Phase 0 verdict** — `docs/research/phase-0-findings.md`. See `docs/decisions.md` #19.
3. **The name** — Duro is recommended. See `docs/brand.md` section 2.
4. **The legal opinion, in month one** — it gates opening the pilot to anyone but the founder.
   `docs/decisions.md` #18.
5. **Upgrade Node on both machines** to Node 24 LTS. One machine runs Node 20 (v20.20.2), which
   reached end-of-life in April 2026; `vitest` is held at 4.1.11 because 5.x needs Node 22.12+.

## Read in this order

1. **`docs/decisions.md`** — every decision, the alternatives, the reasoning, and what is still open. Start here.
2. `docs/research/phase-0-findings.md` — whether the strategy works, and what that means for the product.
3. `docs/superpowers/specs/2026-09-16-crypto-trading-automation-design.md` — the design spec. Read its 2026-09-17 update note first.
3a. `docs/superpowers/specs/2026-09-17-phase-1-exchange-adapter-design.md` — Phase 1's security design: key allowlist, vault, signing.
3b. `docs/superpowers/specs/2026-09-22-phase-2-paper-engine-design.md` — Phase 2: the daily engine, the paper account, the Risk Guard, and failure handling.
4. `docs/superpowers/plans/2026-09-16-phase-0-backtest.md` — what Phase 0 built. Its closing
   *Execution notes* explain where the code deliberately differs from the plan.
5. `docs/stack-and-setup.md` — stack choices, and the operational pitfalls that cost real money.
6. `docs/brand.md` — palette, typography, voice rules, and name status.
7. `docs/research/` — validation, competitor teardown, naming, landing copy, and the licensed
   exchange alternatives to Bybit.

## What to do next

**Phase 0 is done.** To reproduce its result on any machine: `npm install`, `npm run fetch`, then
`npm run sweep`.

**Phase 1's code is complete on branch `phase-1-exchange-adapter`** — the read-only Bybit
connection: signed client, permission-allowlist key validation, encrypted vault, balance reads.

- Spec: `docs/superpowers/specs/2026-09-17-phase-1-exchange-adapter-design.md`
- Plan: `docs/superpowers/plans/2026-09-17-phase-1-exchange-adapter.md` — read its execution notes

What remains: **Task 15, which the founder runs** because it needs a real API key — never ask
them for one, and never read their terminal while they enter it. Try testnet first; if it is
refused, the task runs on mainnet with a **read-only** key once the founder's account is
verified — the note at the top of Task 15 has the steps. **If a verified account still cannot
create a key, Bybit is not viable for Nigerian users** and `docs/decisions.md` #8 needs a new exchange — and
neither licensed exchange qualifies as documented (`docs/research/exchange-alternatives.md`).
Once they confirm it passed, record the outcome in the Phase 1 spec (section 10) and merge the
branch to `master`. **Then merge `research-robustness`**, which is built on this branch: it tests
the trend filter across neighbouring periods and on ETH, and concludes the evidence supports BTC
only.

**Phase 2's code is complete on branch `phase-2-paper-engine`**, built on `research-robustness`:
the daily engine, trading a paper account on live Bybit prices. Spec:
`docs/superpowers/specs/2026-09-22-phase-2-paper-engine-design.md`. Plan:
`docs/superpowers/plans/2026-09-22-phase-2-paper-engine.md` — read its execution notes.
Runbook: `docs/deploy-vps.md`. What remains is the founder's: deploy it (plan Task 21), then
fourteen clean days of paper trading and the report (Task 23). **Merge order:**
`phase-1-exchange-adapter`, then `research-robustness`, then `phase-2-paper-engine`.

**Phase 2a is part of `phase-2-paper-engine`**, merged in pull request #8 before any deployment,
so the paper run tests the engine that will go live: orders already sent are settled for
accounts that are paused, frozen, or under the kill switch, which now means no new orders; a
pause and a freeze are independent; and `npm run order:record` is the way out of an order the
exchange cannot show. Spec: `docs/superpowers/specs/2026-09-23-phase-2a-order-settlement-design.md`.
Plan: `docs/superpowers/plans/2026-09-23-phase-2a-order-settlement.md` — read its execution notes.
The branch `phase-2a-order-settlement` remains only as history.

Next for the engine, in the founder's order: **a compiled build**, so each 15-minute tick runs
`node` directly instead of `npm` and `tsx` — it needs a spec first. Then Phase 2b, real Bybit
orders. The engine's daily self-check is built: see the state table.

Other work, if the founder asks for it:

- ~~The optional research in `docs/research/phase-0-findings.md`.~~ Done on branch
  `research-robustness`, along with a meme-coin check the founder asked for.
- The waitlist landing page, once a name is chosen — copy is drafted in `docs/research/landing-copy.md`.

## Running the code

| Command | Does |
|---|---|
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run fetch` | Downloads Bybit spot and long-history daily candles into `data/` (gitignored) |
| `npm run backtest` | MA-200 against buy-and-hold on both datasets. Set `MA_PERIOD` to change |
| `npm run sweep` | Every period, in-sample and out-of-sample — the Phase 0 result |
| `npm run out-of-asset` | Judges BTC's MA-125, unchanged, on another asset. `ASSET=DOGE npm run out-of-asset` |
| `npm run liquidity:fetch` | Fetches Bybit spot BTCUSDT 15-minute candles into `data/` for the liquidity-sweep research, up to 2025-01-01 unless `-- --until YYYY-MM-DD` |
| `npm run liquidity:check` | Checks those candles, and compares the 4-hour and daily candles built from them with Bybit's own |
| `npm run liquidity:research` | `-- --period development`, run with `--count-only` first. The locked period also needs `--unlock-locked-period`, in its own pull request |
| `npm run liquidity:funnel` | Where version 0's setups drop out in the development period, and an independent recomputation of each step. Rule outcomes only, never a price or a profit |
| `npm run vault:init` | Create this machine's `.env.local` with a vault master key. Refuses to overwrite |
| `npm run key:add` | Validate a Bybit key and store it encrypted. Interactive terminal only; secret input is hidden |
| `npm run key:check` | Re-validate the stored key |
| `npm run balance` | Read balances with the stored key, after re-validating it |
| `npm run paper:init` | Open the paper account. `-- --usdt 1000` sets the starting balance |
| `npm run cycle` | One engine tick: what the systemd timer runs every 15 minutes |
| `npm run status` | Account state, balances, today's signal and run, the kill switch, and any order waiting for an answer |
| `npm run pause` / `resume` | Stop or restart new orders on the account. A pause survives an unfreeze |
| `npm run unfreeze` | Lift a freeze. `-- --reason "what you found"` is required. A pause underneath stays |
| `npm run order:record` | Record what you found for an order the exchange cannot show: `-- --order <id> --status not-placed --reason "..."`. Refuses if the exchange can show it |
| `npm run kill-switch` | `-- on --reason "why"` stops new orders for everyone, while orders already sent still settle; `-- off` resumes |
| `npm run alerts:test` | Send a test Telegram alert |
| `npm run paper:report` | The paper account against buy-and-hold and against the backtest, and what the daily self-check found |

Settings for the key commands, read from the environment or `.env.local`: `BYBIT_ENV`
(`testnet`, the default, or `mainnet`), `USER_ID` (default `founder`), `DB_DIR` (default
`data/db`), and `SERVER_IPS` (comma-separated; required before a mainnet key is accepted).

The engine commands also read `TRADING_MODE` (required; only `paper` exists in Phase 2),
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, `HEALTHCHECK_URL`, `KILL_SWITCH_FILE` (default
`data/KILL_SWITCH`), `PAPER_FEE_RATE` (default `0.001`), and `MAX_ORDER_USDT` (unset). Pass
arguments after `--`, or npm keeps flags such as `--reason` for itself.

**One process at a time opens the database.** PGlite must never be opened by two, so
`openDatabase(dir)` takes a lock named for the database directory — the key commands and the
engine's alike — and it is the only way to open a database on disk. The lock is a name the
operating system owns, a named pipe on Windows and an abstract socket on Linux, freed the moment
its holder exits; there is no lock file. It works only on Windows and Linux. A second command
waits up to 60 seconds for the first, then gives up.

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

## Working through pull requests

Since 2026-09-23 every change ships as a pull request, for Claude and Codex alike.

- **One pull request per task**, on its own branch from the phase branch — for example
  `phase-2a/kill-switch-settles` from `phase-2a-order-settlement` — merged back into it with a
  merge commit, so the detailed commits survive. Delete the branch once merged.
- **Detailed commit messages and descriptions:** what changed, why, and how it was tested.
- **No `Co-Authored-By` trailers, and no tool attribution** in commits or descriptions. The
  founder's instruction.
- **Tests and the type check pass before every merge.** Never merge a red branch.
- **A pull request is a real unit of work.** Never split or pad a change to add one.
- Merging a phase branch into `master` still waits for the phase to be complete and verified.

## Rules that are not negotiable

Each rule prevents a specific way of losing a user's money.

- **Never use JavaScript floats for money or quantities.** `decimal.js` in code, `NUMERIC` in
  Postgres. Never `parseFloat` an exchange response — go straight from string to Decimal.
- **One strategy implementation, ever.** The strategy is a pure function (`StrategyFn`), and the
  identical function runs in backtest and production. Never write a second implementation.
  `src/strategy/` must import nothing except `../math.js`, `../types.js`, `decimal.js` and its own
  files, and never read a clock or randomness; `tests/strategy/purity.test.ts` enforces it.
- **No lookahead.** A signal computed from candle N's close executes at candle N+1's open.
- **Backtests include fees and slippage.** Without them the results are fiction.
- **Choose parameters in-sample, verify out-of-sample**, and pick from a broad plateau of working
  values — never the single best one.
- **Spot only.** No leverage, futures, or margin.
- **BTC only, and no asset is added without its own evidence.** It must pass the out-of-asset
  check — BTC's period, no re-tuning — with a drawdown a real user would accept. Meme coins
  were tested and failed: 71-81% drawdowns remained. `docs/decisions.md` #21.
- **The exchange is the source of truth for positions**, never the database.
- **Fail closed.** On any ambiguity — cannot read balances, cannot fetch prices — do nothing and
  alert.
- **Idempotent orders** through deterministic client order IDs.
- **An order that has been sent always gets exactly one recorded answer**, whatever state its
  account is in — paused, frozen, or under the kill switch. Only the exchange's proof, or a
  person's recorded finding when the exchange cannot show the order, may say it was never placed.
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
  deploy-vps.md               the VPS runbook
  superpowers/
    specs/                    design spec
    plans/                    implementation plans, one per phase
  research/                   validation, competitors, naming, landing copy, Phase 0 findings,
                              exchange alternatives
src/
  types.ts, math.ts           shared types; exact Decimal mean and rounding
  strategy/trendFilter.ts     THE strategy — pure, reused unchanged in production
  strategy/liquiditySweep.ts  the liquidity-sweep research candidate, with bars, swings and structure; nothing trades it
  backtest/                   engine (next-open execution, warm-up), costs, metrics, report; also the
                              liquidity-sweep backtester, evidence, report and lock
  data/                       public market data: Bybit candle fetcher, CSV storage, datasets
  net/http.ts                 GET with host fallback and deadlines, shared by market data and account access
  secrets/secret.ts           Secret — prints [redacted] everywhere
  exchange/                   account access: environments, key info, balances, the trading interface
    bybit/                    hosts, signing, signed client, parsers, key validation
  vault/                      master keyring, AES-256-GCM sealing, credential vault
  db/                         Drizzle schema and PGlite client
  app/credentials.ts          connect, check, and balance flows
  app/paperReport.ts          the paper account against buy-and-hold and the backtest
  market/                     Bybit public data: candles, order book, ticker, trading rules
  engine/                     the daily tick: candle window, sizing, Risk Guard, reconciliation, order IDs
  paper/                      the paper account and order-book fills
  ledger/                     the append-only ledger
  state/                      account state, per-day runs, alerts already sent
  alerts/                     Telegram alerts and the Healthchecks.io heartbeat
  ops/                        the kill switch and the database lock
  cli/                        every command, including the engine's
deploy/systemd/               the engine's service and timer
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

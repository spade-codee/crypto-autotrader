# Decision Log

Every product and engineering decision made so far, in the order it was made, with the
alternatives that were considered and the reasoning behind each choice.

Written so that someone who was not part of the original conversation can understand not only
*what* was decided but *why* — and can tell at a glance which decisions are settled and which
are still open.

**Status labels:** DECIDED · REOPENED · OPEN · REJECTED

---

## At a glance

| # | Topic | Outcome | Status |
|---|---|---|---|
| 1 | Concept | Non-custodial automation; the platform decides and executes | DECIDED |
| 2 | Source of trade decisions | The platform's own mechanical strategy | DECIDED |
| 3 | Starter strategy | BTC trend filter | DECIDED |
| 4 | Custody and venue | Centralised exchange via trade-only API keys | DECIDED |
| 5 | First market | Nigeria | DECIDED |
| 6 | Positioning and pricing | SaaS tool; free pilot, then a flat fee — refined by #16 | DECIDED |
| 7 | Architecture | Eight components, pure strategy engine | DECIDED |
| 8 | First exchange | Bybit, then Binance | **REOPENED 2026-09-19** — can a verified Nigerian user create an API key? One test decides |
| 9 | Language | TypeScript everywhere | DECIDED |
| 10 | Hosting | Founder's existing VPS | DECIDED |
| 11 | Frontend | Vite SPA, not Next.js | DECIDED |
| 12 | Palette | "Instrument" — navy and teal | DECIDED |
| 13 | Typography | IBM Plex Sans + IBM Plex Mono | DECIDED |
| 14 | Name | Keel chosen, then rejected | **OPEN** |
| 15 | Build order | Phase 0 offline backtest first | DECIDED |
| 16 | Target account size and fee model | Place trades; flat yearly fee; free below an account-size threshold | DECIDED 2026-09-17 — price and threshold set by the pilot |
| 17 | Billing currency | USDT | DECIDED 2026-09-17 |
| 18 | Timing of the legal opinion | Month one recommended | **OPEN** |
| 19 | Phase 0 verdict and MA period | Passes, claims narrowed; MA-125, range 100–150 | **RECOMMENDED — founder to review** |
| 20 | Exchange access and API key security | Own Bybit client; spot-only permission allowlist; sealed vault | DECIDED 2026-09-17 |
| 21 | Which assets are tradable | BTC only; meme coins excluded on evidence; an asset must pass the out-of-asset check | **RECOMMENDED — founder to review** |

**What blocks what:** Phase 0 is complete and #16 is decided, so Phase 1 is unblocked. The legal
opinion (#18) gates opening the pilot to anyone other than the founder.

---

## Context that shapes every decision

- **Nigeria has been badly burned by trading fraud.** MMM Nigeria (2016, 3M+ people affected),
  MBA Forex (2021, ~$500M), and most recently **CBEX** — an "AI-powered trading platform"
  promising 100% returns in 30 days, which collapsed April–July 2025 with reported losses
  estimated anywhere from $12M to over $800M. The phrases "AI trading platform" and "connect
  your account and we trade for you" are the vocabulary of that fraud. Every trust, copy, and
  naming decision has to work against it.
- **The founder is a solo technical builder** with an existing Nigerian crypto community and a
  VPS, and no trading strategy of their own.
- **The real user problem is emotional, not informational.** People hold positions all the way
  down because acting requires discipline they do not have at 3am.

---

## 1. Concept — DECIDED

**As the founder described it:** forex copy-trading services let you connect an MT5 or broker
account, sync it, and have a provider's trades mirrored on your account automatically. Do that
for crypto — but instead of the user placing trades, the platform buys and sells on their
behalf.

**Improvement adopted:** crypto exchanges issue API keys with **trading enabled and withdrawal
disabled**. The platform can trade but can never move funds out, even if it is fully
compromised. This removes the single largest trust barrier in the forex version, and it is how
3Commas, Cryptohopper, and exchange-native copy trading already operate.

## 2. Who makes the trade decisions — DECIDED

| Option | Description |
|---|---|
| A | Marketplace of human traders; users choose whom to follow |
| **B** | **The platform runs its own strategy** |
| C | Both — a marketplace where strategies can be human or algorithmic |

**Chosen: B**, because the founder has no strategy and no network of traders yet.

**The tension, and how it was resolved.** Option B is normally the one that *requires* a
strategy. The resolution was to separate the engine from the strategy: **the engine is the
product and the strategy is a plug-in.** Securely connecting accounts, placing and managing
orders, enforcing risk limits, tracking P&L, reporting, and billing are roughly 90% of the work,
and identical whichever strategy runs. Ship v1 with one simple, honest, mechanical strategy.
More strategies, human traders (option A), or licensed signals can be added later without a
rebuild.

## 3. Starter strategy — DECIDED

| Option | Description | Verdict |
|---|---|---|
| **A** | **Trend filter — hold BTC above a long moving average, stablecoin below** | **Chosen** |
| B | Index basket with periodic rebalancing | Credible second choice |
| C | Grid bot | Rejected |
| D | Licensed third-party signals | Rejected |

**Why A:** simplest to build, explainable in one sentence ("invested in uptrends, in
stablecoins during crashes"), backtestable on free data, and its failure mode is whipsaw — a run
of small losses in choppy markets — rather than catastrophe.

**Why not C:** in a sustained downtrend a grid bot keeps buying all the way down. That failure
mode can wipe an account, which would be fatal to a new platform's reputation.

**Why not D:** inherits someone else's quality while paying them a cut.

## 4. Custody and venue — DECIDED

| Option | Description | Verdict |
|---|---|---|
| **A** | **Centralised exchange via trade-only API keys** | **Chosen** |
| B | Custodial — users deposit funds with the platform | Rejected |
| C | On-chain / DeFi with delegated smart-contract permissions | Deferred |

**Why A:** cheapest to build, fastest to launch, smallest legal surface, easiest trust pitch.
The platform never holds customer money.

**Why not B:** it makes the business a custodian and money transmitter — licensing, audits,
insurance, cold-storage operations, and a standing target for attackers. That is a
multi-million-dollar regulated business, not a first version.

**Why not C yet:** genuinely interesting and crypto-native, but it brings smart-contract risk,
audit costs, gas fees that consume small accounts, and worse liquidity. A good v2, a painful v1.

## 5. First market — DECIDED

**Chosen: Nigeria**, where the founder already has a crypto community. Distribution beats
technical quality at this stage.

**Rejected:** US and EU retail, which require SEC investment-adviser registration or MiFID II
portfolio-management authorisation respectively. "Global" was also rejected, because in
practice it means accidentally acquiring US and EU users. **Block US and EU signups at
onboarding.**

## 6. Positioning and pricing — DECIDED, refined by #16

| Option | Description |
|---|---|
| A | SaaS tool, flat monthly fee |
| B | Managed service, performance fee with a high-water mark |
| **C then A** | **Free pilot to build a public track record, then a flat fee** |

**Chosen: C then A.**

**Why the SaaS posture.** "We trade your account and take a cut of profits" is discretionary
portfolio management. "Automation software you configure, can stop at any time, and pay a flat
fee for" is a much lighter regulatory posture. Same engine and same strategy; the difference is
who is on record making the decision, and how money is charged.

**Why free first.** Nobody pays a monthly fee to an unknown trading platform with no track
record. Run live on the founder's own capital, then informed volunteers, for 3–6 months, and
publish verifiable results.

**Reopened on 2026-09-17** by research, and **re-decided the same day** in #16 and #17: the SaaS
posture and the free pilot stand; the fee becomes yearly rather than monthly, is paid in USDT,
and is waived below an account-size threshold.

## 7. Architecture — DECIDED

Eight components: Market Data, Strategy Engine, Risk Guard, Order Router, Credential Vault,
Ledger, Dashboard, and Admin. Full specification in
`docs/superpowers/specs/2026-09-16-crypto-trading-automation-design.md`.

The load-bearing choices:

- **The strategy engine is a pure function**, so the identical code runs in backtest, paper
  trading, and production. A second implementation would drift from the first, and always in
  the direction that flatters the backtest.
- **The exchange is the source of truth for positions, never the database.** Read real
  balances before every action. Systems that trust their own position table double-buy after a
  partial failure.
- **Fail closed.** On any ambiguity, do nothing and alert.
- **Idempotent orders**, with client order IDs derived deterministically from user, cycle, and
  intent, so a retried cycle cannot duplicate an order.
- **Spot only — no leverage, futures, or margin.** This removes liquidation, and with it an
  entire category of business-ending bug.
- **BTC only, daily candles** for v1. One cycle per day, supervisable by one person.
- **Staged testing:** unit tests, then a backtest with fees and slippage, then 2–4 weeks of
  paper trading, then live on the founder's money, then volunteers, then the pilot.

## 8. First exchange — REOPENED 2026-09-19, one test decides it

**Founder's read:** almost everyone in the community uses Bybit and Binance.

**Chosen: Bybit first, Binance second**, behind a single adapter interface. (Originally planned
on CCXT; replaced by an own client in Phase 1 — see #20.)

**Why not Binance first:** it discontinued all naira services in March 2024 and remains in
legal conflict with Nigeria.

**Verify before Phase 1.** An NCC ISP-level block from February 2024 names Bybit. As of the
latest reporting, **web access is carrier-dependent** — available on some networks and not
others — while **mobile apps and naira P2P work**. That is onboarding friction, not a dead end,
but the current reality should be confirmed directly before building the adapter.

**Verified 2026-09-17 from the founder's network:**

| Host | Result |
|---|---|
| `api.bybit.com`, `api-testnet.bybit.com` | Blocked — DNS resolution fails |
| `bybit.com`, `www.bybit.com`, `testnet.bybit.com` | Blocked — DNS resolution fails |
| `api.bytick.com`, `api-testnet.bytick.com` | Reachable |
| `testnet.bytick.com` | Reachable; the sign-up page loads, but sign-up is untested |
| `www.bytick.com`, `www.bybitglobal.com` | Reachable, but refuse scripted requests; likely fine in a browser |

The API is fully usable through Bybit's official alternate domain, and the code falls back to
it automatically. **Onboarding implication for Phase 4:** a user on a blocked network cannot
open `bybit.com` to create an API key. Onboarding must direct them to a route that works —
the Bybit mobile app, which reporting says functions on blocked networks, or a working mirror.
Confirm the app supports API key creation before designing that flow.

**Checked 2026-09-19 — the onboarding plan above does not work.**

- **Creating an API key was refused.** The founder tried to create a key on their own Bybit
  account, which had not completed identity verification, and was told the service is "not
  available to you due to regulatory restrictions". This entry first recorded it as a testnet
  sign-up refusal — an assumption, corrected the same day. Testnet sign-up has not been tried.
  The table above also said testnet keys can be created there, which overstated a check that
  only confirmed the host was reachable.
- **An unverified account is the likely cause.** Bybit requires at least Standard identity
  verification for every product, and decides country restrictions from the nationality on that
  verification, not the user's location (*FAQ — Individual KYC*, updated 2026-08-20). An
  unverified account gives it nothing to check. Creating a key also needs a Google Authenticator
  code, and is blocked for 48 hours after registration.
- **Nigeria is not a restricted jurisdiction.** Bybit's *Service Restricted Countries* page
  (updated 2026-09-01) excludes the US, Chinese Mainland, Hong Kong, Singapore, Canada, North
  Korea, Cuba, Iran, Uzbekistan, Russian-controlled Ukraine, Sevastopol, Sudan, and Syria. The
  refusal is narrower than a country ban, most likely a geo-fence on web registration.
- **API keys can only be created on the website, never in the app** — Bybit's help centre,
  updated 2025-11-25. Onboarding through the app is therefore impossible, and the product cannot
  work without a key.
- **Bybit holds no Nigerian licence.** TechCabal (2025-10-30) reports that it serves Nigeria
  through its mobile app without a licence or a place in the SEC's ARIP programme. Only
  **Quidax** and **Busha** hold provisional SEC licences, both through ARIP. This goes straight
  into the legal opinion (#18): the product would be directing Nigerian users to an unlicensed
  exchange.
- **The API is unaffected.** Mainnet and testnet APIs answer normally from the founder's network,
  and `www.bytick.com` pages load in a browser.

**The test that decides this:** a Bybit user who has completed Standard verification logs in at
`www.bytick.com` from a Nigerian network and tries to create a key in API Management.

- **If it works,** onboarding runs through `bytick.com` and Bybit stays, subject to the legal
  opinion. Phase 1 Task 15 then runs on mainnet with a read-only key.
- **If it is refused,** a Nigerian user cannot create the key this product needs without a VPN,
  and Bybit cannot be the first exchange. The licensed exchanges become the candidates, starting
  with one question: do they offer API keys that can trade but not withdraw?

**Not a VPN.** Bybit's terms allow immediate termination of an account, and liquidation of its
positions, for false representation of the user's location. A product whose onboarding depends on
users getting around a geo-fence would not survive a regulator or a press story.

**The licensed alternatives, researched 2026-09-19** (`docs/research/exchange-alternatives.md`):
**neither qualifies as documented.** Quidax has the right market — an order book, 0.1% fees, and
a strategy result at its costs indistinguishable from Bybit's — but its API keys come from
merchant accounts and have no permissions, so every key can withdraw. Busha has the right
connection model — OAuth2 that users approve and can revoke, with a sandbox — but executing a
trade requires the same scope that sends money out, and its roughly 3.9% quoted spread cuts the
strategy to 18.6% a year with a 44.1% worst drop. Both gaps can only be closed by the exchange,
so the next step is to ask them; the research lists the exact questions.

## 9. Language — DECIDED

**Chosen: TypeScript everywhere.**

The instinct in trading software is Python. It was rejected because the architecture's central
guarantee — a single strategy implementation shared by backtest and production — cannot be
enforced across two languages. A moving average over roughly 4,000 daily candles does not need
pandas. Types are shared from backend to frontend, and one
person maintains one toolchain.

Python remains fine for throwaway research that never becomes execution code.

**Stack:** Node 24 LTS, Hono, Postgres (PGlite in development and tests), Drizzle, `decimal.js`
with Postgres `NUMERIC`, `pg-boss`, an own Bybit client (CCXT was dropped — #20), Zod, React + Vite + Tailwind + shadcn/ui, `lightweight-charts`,
`better-auth`, `systemd`, Caddy, Sentry, Healthchecks.io, a Telegram bot for ops alerts, and
Resend. Rationale for each is in `docs/stack-and-setup.md`.

## 10. Hosting — DECIDED

**Chosen: the founder's existing VPS.** This replaced an earlier plan of Vercel, Railway, and
Supabase once the VPS came up.

**What it gains:** a static egress IP, so exchange API keys can be IP-allowlisted to exactly
one machine and a stolen key is useless anywhere else; a long-running worker free of
serverless limits; and running costs of roughly $2–3 per month plus a domain.

**What it costs — four responsibilities move onto the founder:**

1. Process supervision — `systemd` with `Restart=always`.
2. Backups — nightly off-box `pg_dump`, and a restore rehearsed before going live.
3. Patching and hardening — unattended upgrades, UFW default-deny, SSH keys only, fail2ban.
4. Being a single point of failure. Under fail-closed that is *safe* but not *harmless*: the
   user still believes the trend filter protects them. This is why a dead-man's switch on the
   daily cycle matters more on a VPS than on a managed platform.

## 11. Frontend framework — DECIDED

**The founder asked why not Next.js.**

**Chosen: Vite.** Next.js's value — server rendering, static generation, SEO, server
components — does not apply to a dashboard behind a login. Vite emits static files that Caddy
serves with no server process; Next.js adds a second supervised Node process competing for RAM
with the trading worker. Using Next.js route handlers as the backend would also couple the
money-handling API to a frontend framework, and make it harder to test and to reuse from an
Android app later.

**Where server rendering does help** — the public marketing and track-record pages — use
**Astro**.

Next.js is defensible rather than wrong. The cost is operational.

## 12. Palette — DECIDED

Three directions were rendered as real UI cards: **Instrument** (navy and teal), **Vault**
(black and brass), and **Signal** (charcoal and violet).

**Chosen: Instrument.**

**The rule behind it:** green and red are reserved for profit and loss and are never brand
colours. If green is also the button colour, it stops carrying information.

Teal is unclaimed in the category — Binance and Bybit own yellow, Coinbase blue, Kraken purple —
and is the accent furthest from green.

**Rejected Vault:** brass reads as Binance yellow on a phone in bright sun, and signals private
banking. **Rejected Signal:** violet is the default DeFi accent.

**Accessibility rule:** colour never carries P&L on its own. Always `+2.4% ▲` and `−1.1% ▼`.
Roughly 8% of men have red-green colour deficiency, and the audience skews male.

Full token table in `docs/brand.md`.

## 13. Typography — DECIDED

**Chosen: IBM Plex Sans for the interface, IBM Plex Mono for every figure**, with tabular
numerals, weights 400/500/600 only, self-hosted as subset WOFF2. Users are on Android phones and
often metered data.

The deciding argument is the numerals: the product is numbers, and Plex Mono keeps every digit
distinct at small sizes on a phone. **Rejected:** Inter, as the invisible default. Instrument
Sans is an acceptable warmer alternative.

## 14. Name — OPEN

**Constraints.** Must not sound like a Ponzi scheme — nothing containing profit, wealth, gain,
capital, double, or earn. Must sound like an instrument, not an opportunity. Must not promise a
return. Short and spellable after hearing it once, since distribution is word of mouth.

**History:**

1. Shortlist: Keel, Ballast, Duro, Tide, Plumbline, Stoic.
2. **Keel chosen** — the part of a ship that stops it capsizing; promises stability rather than
   gains. The founder liked it.
3. **Keel rejected** after a naming research agent found, and independent verification
   confirmed, **Keel Money Ltd**: an FCA-authorised Banking-as-a-Service fintech in Manchester
   (firm reference 1020783), live at `keel.money`, which exited stealth in May 2026 with a
   profitable international client base. The problem is permanent search and brand collision
   with a funded incumbent in the category.
4. The research agent recommended **Tsaya** (Hausa) or **Ase** (Yoruba). That recommendation is
   disputed.

**Recommended: Duro** — Yoruba for *stand firm, hold, wait*, which describes the product
literally. Full reasoning, and the case against Tsaya and Ase, in `docs/brand.md` section 2.

**Needs from the founder:** the final choice, and their read on whether a Hausa name fits a
crypto community concentrated in Lagos and the south.

## 15. Build order — DECIDED

| Phase | Scope |
|---|---|
| **0** | **Strategy proof — offline backtest, no exchange credentials, no users, no database** |
| 1 | Bybit adapter, read-only |
| 2 | Execution engine against testnet |
| 3 | Live, founder's own account only, minimum size |
| 4 | Multi-user — onboarding, dashboard, admin, kill switch |
| 5 | Pilot opens to volunteers |

**Phase 0 comes first** because it is about a week of work and decides whether the rest is worth
building. Plan: `docs/superpowers/plans/2026-09-16-phase-0-backtest.md`.

Two properties of that plan matter most:

- **Lookahead bias is structurally impossible** — a signal from candle N's close fills at candle
  N+1's open.
- **Parameters are chosen in-sample and verified out-of-sample**, from a broad plateau of
  working values rather than the single best one. Picking the best number is curve fitting.

## 16. Target account size and fee model — DECIDED 2026-09-17

**Decided: the product places trades for users, and charges a flat yearly fee in USDT.
Accounts below a size threshold use it free.** The exact price and threshold are set during
the pilot, which exists to measure what people will actually pay.

Why, in light of the Phase 0 result (#19):

- **Profit share charges for the wrong thing.** The product's value is losses avoided. In the
  2021–22 crash its worst drop was 34% against buy-and-hold's 77% — when it earned its keep —
  yet a profit share would have charged nothing, because the account still fell. Revenue would
  also arrive in lumps: one large trend per cycle, then months below each user's high-water
  mark, exactly when users are most upset. And it most resembles regulated fund management.
- **Signals-only removes what works.** The strategy changes position roughly 5–10 times a
  year, and every change is a frightening moment. Automating those moments is the product.
- **A flat fee matches what the product is — insurance** — which is sold as a flat premium,
  and it keeps revenue steady through the bear markets when users need it most.
- **A free tier is affordable**, because each user costs one daily check and a few trades a
  year. Small accounts become word of mouth and track record rather than revenue.
- **Yearly rather than monthly** means fewer payments to fail, and no charge in a quiet month
  where nothing visibly happened.

**Accepted weakness:** for someone who would hold calmly through every crash, any fee makes
this a worse deal. The fee is only earned from people who would otherwise panic-sell. That is
the product's premise, and the pilot has to prove it.

**Why Phase 1 needed only part of this decision:** flat fee versus profit share changes no
Phase 1 code. Placing trades versus sending signals does, because a signals-only product needs
no user API keys at all.

The research that informed the decision follows.


Two research agents, working independently, reached the same arithmetic:

| Fee | $300 account | $1,000 | $3,000 | $10,000 |
|---|---|---|---|---|
| $10/month | 40% a year | 12% a year | 4% a year | 1.2% a year |
| $20/month | 80% a year | 24% a year | 8% a year | 2.4% a year |

**A flat fee cannot be carried by the originally targeted $100–$1,000 accounts.** Not
competitively — arithmetically. The product may be right while the customer is wrong.

**The fork:**

| Option | Upside | Downside |
|---|---|---|
| **Flat fee, move up to ~$3,000+ accounts** | Keeps the lighter SaaS regulatory posture | Much smaller market |
| **Profit share, keep small accounts** | Right economics — nothing charged in a losing year, which is why every exchange copy-trading product works this way | Triggers portfolio-management classification |
| **Signals only, no execution** | Least regulatory exposure | Does not solve the discipline problem the product exists for |

**Evidence that demand exists at some price.** **Cornix** — Tel Aviv, founded 2019,
non-custodial, trade-only API keys with withdrawal disabled, $25/month — is already used by
Nigerian subscribers through Telegram signal groups charging $50–300/month on top. Handing a
third party a trade-enabled API key at roughly $25/month is already normal behaviour in this
market.

**Evidence that it is hard.** Shrimpy, a funded non-custodial platform in exactly this category,
shut down after six years with no architectural failure. Unit economics in retail bot software
are genuinely difficult.

**Other research suggestions:** the validation agent proposed targeting the diaspora or $5,000+
accounts. Caution — diaspora users bring UK, US, and EU jurisdiction back in, reversing
decision #5.

**What the competitive research established about the gap:** no exchange-native tool and none of
eight dedicated platforms ships a no-leverage, spot-only trend filter as a simple done-for-you
product. Bybit's free copy trading is leveraged perpetuals following a human; its free bots are
grid (mean-reversion, wrong in a trend) and DCA (no exit). The algorithm itself is not a moat —
OKX's Signal Bot plus a TradingView webhook can replicate it — so the value is packaging, trust,
a verifiable track record, and local distribution. The likeliest long-term threat is Bybit or
Bitget shipping a Nigerian-marketed spot-trend template.

## 17. Billing currency — DECIDED 2026-09-17

Naira cards are routinely declined for recurring international subscriptions under CBN foreign
exchange caps. Users already hold USDT in the very exchange account being connected.

**Decided: bill in USDT.** None of the eight international competitors researched designs
around this failure point.

## 18. Timing of the legal opinion — OPEN, recommended

SEC Nigeria's VASP definition covers activity "for or on behalf of another person", and no
carve-out for non-custodial software was located. Checked against the cited Mondaq source: a
₦30,000,000 registration fee, ₦500,000,000 minimum paid-up capital, and a fidelity bond of 25%
of that capital. A separate ₦2 billion threshold, reported but not independently verified,
applies to exchanges and custodians — which this product is not.

**Whether a non-custodial automation tool is a VASP at all is unresolved.**

**Recommended: obtain a written legal opinion in month one**, not before the pilot as
originally sequenced. Worth raising with the lawyer: Cornix appears to serve this market
without Nigerian registration. That is market intelligence, not a legal defence.

---

## 19. Phase 0 verdict and moving-average period — RECOMMENDED, founder to review

Full analysis: `docs/research/phase-0-findings.md`.

**The strategy passes the bar Phase 0 set** — that it must reduce drawdown against buy-and-hold
on data the parameter choice never saw.

| Out-of-sample, 2023-01 to 2026-09 | MA-125 | Buy and hold |
|---|---|---|
| Max drawdown | **27.4%** | 53.1% |
| Annual growth (CAGR) | 42.0% | **50.9%** |
| Sharpe | **1.15** | 1.11 |

**Recommended period: 125 days**, with 100–150 as the defensible range. Chosen in-sample
(2019–2022) as the middle of the only region with Sharpe at least 0.95 and drawdown at most 45%,
then confirmed out-of-sample, where 100–175 all held up.

**What it means:**

- It is **drawdown insurance, not a way to beat the market.** In a mostly bullish period it gave
  up about 9 points of annual growth to halve the worst drawdown. This confirms the brand rule
  never to state or imply a return.
- **Most trades lose** — about 70% of round trips — and a few large trends pay for everything.
  Users must be told this up front, or they will leave during the losing runs.
- Its worst out-of-sample stretch was **choppy sideways markets**, not a crash. The promise is
  smaller crashes, not no losses.
- **It sharpens #16.** Users already pay for protection with lower returns in bull markets; a fee
  is a second, guaranteed cost on top.

**Robustness checks, 2026-09-17** (`docs/research/phase-0-findings.md`). A vote across
MA-100/125/150 reproduces MA-125, which is expected by construction, so MA-125 stays. On ETH, with
the BTC-chosen period and no re-tuning, the filter still reduced the worst drawdown in both
periods — 48% against 68% out-of-sample — so the effect is not unique to BTC. But the protection
was much weaker than on BTC, and ETH's own best periods were entirely different. **Evidence
supports BTC only; any other asset needs its own evidence.** Meme coins were then tested the
same way and failed — see #21.

**How much weight it bears:** thin. MA-125 made 27 round trips in seven years, one trade produced
most of the in-sample result, and nearby periods behave quite differently. The evidence is
necessary, not sufficient.

**Three methodology flaws in the original plan were fixed before these numbers were produced** —
too little spot history to tune on, no warm-up in the out-of-sample test, and a win rate that
ignored fees. Left in place, the spot-only data would have made the strategy look far better
than it is: on 2022 onward, MA-200 appeared to double buy-and-hold's growth at half the
drawdown. Details in the Phase 0 plan's execution notes.

## 20. Exchange access and API key security — DECIDED 2026-09-17

Full design: `docs/superpowers/specs/2026-09-17-phase-1-exchange-adapter-design.md`.

- **Our own Bybit client, not CCXT.** CCXT declares every price, amount, and balance as a
  JavaScript `number` (verified in its source), which breaks the no-floats rule. This reverses
  the CCXT choice in #9.
- **Keys are validated against an allowlist:** the only permission allowed is `Spot: SpotTrade`.
  Anything else is rejected with the exact permission to remove, so a dangerous permission Bybit
  adds in future is refused rather than silently accepted.
- **Mainnet keys must be IP-restricted to our servers.** A stolen key is useless elsewhere.
- **Credentials are sealed with AES-256-GCM**, bound to their owner, under a versioned master key
  that never enters git.
- **A key is re-validated every time it is used**, because permissions can be widened on the
  exchange after the key was stored.
- **The founder enters keys in their own terminal with hidden input.** No agent ever handles them.

## 21. Which assets are tradable — RECOMMENDED, founder to review

Evidence: `docs/research/phase-0-findings.md`, *Robustness checks*.

**BTC only. Meme coins are excluded.** DOGE, SHIB, and PEPE were each tested with BTC's MA-125
unchanged. The filter reduced the worst drawdown on all three — and left it at 71-81%, against 33%
on BTC. On DOGE and SHIB it still lost money over four and a half years; on PEPE it took half the
return and delivered a worse Sharpe than simply holding. Neighbouring periods flip sign on every
meme coin, so there is no stable setting to choose even in hindsight.

The structural reason matters more than the numbers: a trend filter needs a decline slow enough to
cross a long average and stay there, and it assumes the asset eventually recovers. Meme coins fall
vertically, rally on attention, and may never come back. **An asset that might not recover should
not be timed; it should not be held.**

**The rule this sets:** an asset is tradable only after passing the out-of-asset check on its own
history — BTC's chosen period, no re-tuning, a drawdown a real user would accept, and neighbouring
periods that agree. BTC is the only asset that has passed. ETH did not: it cut drawdown but only to
48%.

**Alternatives considered:**

- **Support meme coins because that is what the market asks for.** Rejected. It is the most
  commercially tempting option and the one most likely to end the business: the system would trade
  a DOGE account 56 times in four years, look busy, lose the user money, and charge a yearly fee for
  it. In a market where crypto fraud is a live public issue, that is the story that gets told.
- **Support them with a warning label.** Rejected. The evidence says the tool does not work there;
  a disclaimer does not convert a product that loses money into one that does not.
- **Re-tune the period per asset.** Rejected as curve fitting, and the tables show it would not even
  work — the best period differs wildly per asset with no plateau anywhere.
- **Offer them unfiltered, as plain holding.** Out of scope. The product exists to decide and
  execute; a buy-and-hold button is a different product and needs its own case.

**How much weight it bears:** solid for the negative claim, and the negative claim is the one being
made. Three assets, one boom-bust cycle each, and they are the survivors — the meme coins that went
to zero are absent from the data, which flatters the category rather than the conclusion.

**If the founder wants to overrule this,** the bar is evidence on that specific asset, not
enthusiasm for it, and the marketing cannot describe the result as protection.

## Corrections made along the way

Recorded so the reasoning trail stays honest.

- **Bybit access was overstated** in a conversation summary as a "brutal funnel." The underlying
  sources are more precise: web access is blocked and carrier-dependent, while mobile apps and
  naira P2P work.
- **Regulatory exposure was stated too absolutely.** The heaviest capital thresholds attach to
  exchanges and custodians; the VASP question for a non-custodial tool is genuinely open.
- **The naming research's USPTO claims** could not be verified and contradicted that document's
  own findings.
- **The first stack plan assumed managed hosting** (Vercel, Railway, Supabase) before the VPS
  was known about.

---

## Research documents

| Document | Contents |
|---|---|
| `docs/research/validation.md` | Pressure test and go/no-go. Verdict: conditional go |
| `docs/research/competitors.md` | Exchange-native tools, eight automation platforms, the Nigerian landscape |
| `docs/research/naming.md` | Stress test of Keel and ten alternatives |
| `docs/research/landing-copy.md` | Waitlist page draft — uses the rejected placeholder name |

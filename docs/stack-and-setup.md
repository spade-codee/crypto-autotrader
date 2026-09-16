# Stack, Brand, and Setup Checklist

Companion to `docs/superpowers/specs/2026-09-16-crypto-trading-automation-design.md`.

---

## 1. Language: TypeScript everywhere

The instinct in trading software is Python, because Python owns quantitative research
(pandas, numpy, backtrader, vectorbt). That instinct is wrong for this project, and the
reason comes straight out of the design rather than out of preference.

The spec commits to one principle above all others: **the same strategy code runs in the
backtest and in production.** That principle is unenforceable across two languages. A Python
backtest and a TypeScript executor are two implementations of one strategy, and they drift —
silently, and in the direction that makes the backtest look better than reality. The only
way to actually keep the guarantee is a single language.

Given one language, TypeScript wins:

- The strategy is a moving average over daily candles: roughly 4,000 data points and about
  100 lines of arithmetic. This workload does not need pandas. The Python advantage is real
  for machine learning and heavy statistics, and irrelevant here.
- CCXT, the exchange library, is first-class in TypeScript.
- Frontend and backend share types. An `Order` or `Position` type is defined once.
- One runtime, one package manager, one deployment story, one debugger — which matters when
  one person maintains all of it.
- Existing familiarity: `staff-hub` is already React + Vite + Tailwind + TypeScript.

**Escape hatch:** Python stays available for throwaway research — exploring a new indicator,
plotting, statistics. Anything that graduates to production gets rewritten in TypeScript and
becomes the single source of truth. Research code is not execution code.

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript, `strict: true` | Above |
| Runtime | Node 22 LTS | Bun is fine for frontend tooling; for a long-running process that moves money, Node's maturity with Postgres drivers and process supervision is worth more than the speed |
| API | Hono | Small, fast, excellent TypeScript inference; this API is not big enough to need Fastify's plugin ecosystem |
| Database | Postgres | The ledger needs real transactions |
| ORM | Drizzle | TypeScript-first, generates honest SQL, trivial escape hatch to raw SQL for reporting queries |
| Money math | `decimal.js` + Postgres `NUMERIC` | See section 3 — this is not optional |
| Jobs / scheduling | `pg-boss` | Postgres-backed queue, so no Redis to run and pay for. In-process `node-cron` is disqualified: it dies with the process and leaves no record of whether a cycle ran |
| Exchange access | CCXT, behind our own adapter | Bybit now, Binance later, one interface |
| Validation | Zod | Validate every exchange response; never trust a third-party payload's shape |
| Frontend | React + Vite + Tailwind + shadcn/ui | Already known from `staff-hub` |
| Charts | `lightweight-charts` (TradingView) | Purpose-built for price and equity curves; Recharts for simple bars |
| Auth | `better-auth` (self-hosted) | Postgres is already on the box; no reason to add a vendor |
| Hosting | **Self-hosted VPS** | Already available. Static egress IP is a genuine security win — see section 3.2 |
| Process supervision | `systemd` | Restarts the worker on crash and on reboot. Not PM2 — systemd is already installed and owns boot order |
| TLS / reverse proxy | Caddy | Automatic certificates, one-line config |
| Error tracking | Sentry | |
| Cycle monitoring | Healthchecks.io or Better Stack | See section 3 |
| Ops alerts | Telegram bot | Free, instant, and already where the team lives |
| Transactional email | Resend | |

---

## 3. Three things that will cost real money if ignored

### 3.1 Never use JavaScript floats for money

```js
0.1 + 0.2 === 0.3   // false
```

Floating-point error in a position size becomes a rejected order, a dust balance that never
clears, or a reconciliation mismatch that freezes a user for no reason. In a system whose
entire v1 success criterion is "no user lost money to a defect," this is the single most
likely way to fail it.

- All monetary and quantity values: `decimal.js` in application code, `NUMERIC` in Postgres.
- Never `parseFloat` an exchange response. Parse to Decimal directly from the string.
- Never store money as `float8` or `double precision`. Ever.

### 3.2 The VPS solves one problem and hands you four

A long-running execution worker cannot live on serverless: Vercel, Netlify, and Lambda-style
functions are request-scoped and time-limited, while the worker must hold a process, own a
schedule, poll for fills, and survive between cycles. A VPS removes that constraint entirely,
and it comes with a real bonus — a **static egress IP**, which means the Bybit API keys can
be IP-allowlisted to exactly one machine. A stolen key is then useless from anywhere else.
That is a security property serverless hosting cannot offer at any price.

In exchange, four responsibilities move from a platform onto us:

1. **Process supervision.** A `systemd` unit with `Restart=always` and `WantedBy=multi-user.target`,
   so the worker comes back after a crash and after a reboot. Without this, an unnoticed OOM
   kill silently stops all trading.
2. **Backups.** The ledger is the track record, and the track record is the product's entire
   credibility. Nightly `pg_dump` to off-box object storage, and **a restore rehearsed at
   least once before going live.** An untested backup is not a backup.
3. **Patching and hardening.** `unattended-upgrades` for security patches, UFW default-deny
   with only 22/80/443 open, SSH keys only with password auth disabled, `fail2ban`.
4. **Being a single point of failure.** If the box dies, trading stops. Under the fail-closed
   design that is *safe* — no trades happen — but it is not *harmless*, because the user still
   believes the trend filter is protecting them. This is precisely why section 3.3 matters
   more on a VPS than it would on a managed platform.

Keep the frontend deploy separate from the worker (separate systemd unit, separate directory,
separate restart) so that shipping a UI change can never interrupt a trading cycle.

### 3.3 Monitor for the cycle that did not run

Standard error monitoring catches code that ran and threw. It cannot catch a cycle that
never fired — a crashed worker, a dead scheduler, an expired credential. Silent non-execution
is a genuine failure mode: a user believes they are protected by a trend filter, the market
turns, and nothing happens.

Use a dead-man's switch: the worker pings a monitoring URL after every successful cycle, and
the monitor alerts when a ping does not arrive on time. Healthchecks.io does this on a free
tier. This single alert is worth more than most of the dashboard.

---

## 4. Brand

### Positioning first

The product's promise is the removal of panic. It is discipline, sold to people who know
they lack it at 3am. That has a direct visual consequence: **it must not look like a crypto
casino.** No neon gradients, no rocket emoji, no lime-on-black hype. It should look like an
instrument — calm, precise, slightly boring, obviously careful with your money.

It also must not look like Binance or Bybit. Both own yellow-on-black. Borrowing that palette
reads as imitation, and imitation is the opposite of the trust being sold.

### The rule that drives the palette

**Green and red are reserved for profit and loss. They are never brand colours.**

In a P&L product, green means "you made money." If green is also the button colour, the
header colour, and the logo, then green stops carrying information. So the brand accent must
be something other than green or red — which rules out most of the category and is a gift,
because it makes the brand distinctive for free.

### Recommended direction — "Instrument"

Deep navy ground, cool teal accent, warm neutral text. Reads as a precision tool rather than
a trading floor.

| Token | Hex | Use |
|---|---|---|
| `bg` | `#0B1220` | App background |
| `surface` | `#141E30` | Cards, panels |
| `border` | `#243449` | Dividers, input borders |
| `text` | `#E8EDF4` | Primary text |
| `text-muted` | `#8FA3BC` | Labels, secondary text |
| `accent` | `#2DD4BF` | Primary actions, links, focus rings, logo |
| `accent-deep` | `#0D9488` | Hover, pressed |
| `profit` | `#34D399` | Positive P&L only |
| `loss` | `#F87171` | Negative P&L only |
| `warn` | `#FBBF24` | Paused, degraded, needs attention |

Light mode inverts to a warm off-white ground (`#F7F9FC`) with the same accent, since the
teal holds contrast on both.

### Alternatives if that reads too cold

- **"Vault"** — near-black `#0A0A0B` with a brass accent `#C9A227`. Premium, private-banking
  feel. Risk: sits close to Binance/Bybit yellow.
- **"Signal"** — charcoal `#16161A` with electric violet `#7C5CFF`. More startup, more
  modern, slightly less serious about money.

### Accessibility, and why it matters more here than usual

Roughly 8% of men have some red-green colour deficiency. This is a profit-and-loss product
whose primary signal is encoded in red versus green, and its audience skews heavily male.
**Colour alone is never allowed to carry the P&L signal.** Always pair it with a sign and an
arrow: `+2.4% ▲`, `−1.1% ▼`. Test every screen in greyscale; if it still reads, it is right.

Body text against background must meet at least 4.5:1 contrast. The palette above is built
to clear that.

### Other brand basics

- **Type:** Inter or Geist for UI. **Numbers must be tabular** (`font-variant-numeric:
  tabular-nums`) so figures in a column align and do not jitter as they update.
- **Tone of voice:** plain, calm, never hyped. "Your position moved to cash" — not
  "🚀 Strategy activated!" Never state or imply a return. Every performance figure carries
  the period it covers.
- **Mobile first.** Nigerian users are overwhelmingly on Android phones, often on metered
  data. Design at 375px first and keep the bundle small.

---

## 5. Setup checklist

### Accounts and services

| # | Item | Notes | Cost |
|---|---|---|---|
| 1 | Bybit account, API keys | Create **two**: testnet for Phase 2, live for Phase 3. Trade on, **withdrawal off**, IP-allowlisted to the worker | Free |
| 2 | GitHub repo | **Private.** Enable secret scanning | Free |
| 3 | VPS | Already available. Record its **static egress IP** — needed for the Bybit allowlist | Existing |
| 4 | Postgres on the VPS | Plus off-box backup storage (S3, R2, or Backblaze B2) | ~$1/mo |
| 5 | Domain name | | ~$12/yr |
| 6 | Sentry | Error tracking | Free tier |
| 7 | Healthchecks.io | Dead-man's switch on the cycle | Free tier |
| 8 | Telegram bot token | Ops alerts, via @BotFather | Free |
| 9 | Resend | Transactional email | Free tier |
| 10 | Object storage for backups | Cloudflare R2 or Backblaze B2 | ~$1/mo |

Total running cost at pilot scale, with the VPS already paid for: roughly **$2–3/month plus
the domain**. This is not a capital-intensive build. The expensive inputs are time and care.

### Data

Bybit's API serves historical daily candles directly, which is enough for Phase 0. Binance's
public data dumps are a good free cross-check — comparing two independent sources catches
bad data before it produces a beautiful, fictional backtest.

### Legal and business (before the pilot opens beyond the founder)

| # | Item | Notes |
|---|---|---|
| 11 | Nigerian securities lawyer consult | Confirm the SaaS posture holds under the Investments and Securities Act 2025. Blocking item for section 2 of the spec |
| 12 | CAC business registration | Needed before charging anyone |
| 13 | Terms of Service | Must state: not investment advice, no guaranteed returns, user retains custody and control |
| 14 | Risk disclaimer | Shown and acknowledged at onboarding, not buried in a footer |
| 15 | Privacy policy | Required by Vercel, Supabase, and app stores later |

### Security baseline from day one

- API keys encrypted at rest; encryption key in the host's secret manager, never in the repo.
- Reject any submitted key that has withdrawal permission enabled — verify by calling the
  exchange's key-info endpoint rather than trusting the user.
- IP-allowlist the exchange keys to the worker's static egress IP.
- Secret scanning enabled on the repo, plus a pre-commit hook.
- No secrets in logs, error messages, or Sentry payloads. Scrub at the transport layer.
- Two-factor authentication on every account in the table above, starting today.

---

## 6. What to build first

Phase 0 from the spec: **the backtest, offline, with no exchange credentials and no users.**

About a week of work, and it answers the only question that matters before the rest is worth
building — does this strategy hold up, and at what parameters? If the answer is no, that is
the cheapest possible discovery. If the answer is yes, the strategy engine written in Phase 0
is the same code that trades in production.

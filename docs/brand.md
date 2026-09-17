# Brand System

Companion to `docs/superpowers/specs/2026-09-16-crypto-trading-automation-design.md`
and `docs/stack-and-setup.md`.

---

## 1. Positioning

The product sells the removal of panic. It is discipline, sold to people who know they lack
it at 3am. Every brand decision follows from that one sentence.

Three consequences, and they are constraints rather than preferences:

**It must not look like a crypto casino.** No neon, no gradients, no rockets, no countdown
timers. Those signal excitement, and excitement is the thing we are removing.

**It must not look like Binance or Bybit.** Both own yellow-on-black. Borrowing that palette
reads as imitation, and imitation is the opposite of the trust being sold.

**It must not sound like a Ponzi scheme.** Nigeria has been badly burned — MMM and its
successors poisoned an entire vocabulary. Anything containing *profit*, *wealth*, *gain*,
*capital*, *double*, or *earn* is disqualified, regardless of how well it tests otherwise.
The name must sound like an instrument, not an opportunity.

---

## 2. Name

**Status: undecided.** The working name is `crypto-autotrader`, which is a placeholder, not a
brand.

### Rejected: Keel

Keel was chosen on 2026-09-16 and rejected the same day after verification. **Keel Money Ltd**
is a live, FCA-authorised Banking-as-a-Service fintech in Manchester (FCA firm reference
1020783), operating at `keel.money`. It exited stealth in May 2026 with a profitable,
international client base that includes trading platforms. Every search for "Keel fintech"
lands on them. The objection is not primarily a trademark fight — it is permanent search and
brand confusion with a funded incumbent in the same category.

The naming research (`docs/research/naming.md`) also cites USPTO serial numbers owned by New
York entities. Those claims could not be verified and contradict that document's own Manchester
finding. Do not rely on them. Formal trademark clearance is a lawyer's task regardless.

The reasoning that originally favoured Keel still describes what a good name here must do:
promise stability rather than gains, be spellable after hearing it once, and carry a simple
mark.

### Live candidates

- **Duro** — Yoruba for *stand firm, hold, wait*. **Recommended.** It describes the product
  literally: it stops people panic-selling. Transparent to Yoruba speakers, the largest group
  in Nigeria's Lagos-centred crypto community. Four letters, pronounceable globally. Weakness:
  reads as a surname internationally — a year-three problem, not a year-one problem.
- **Tsaya** — Hausa for *stand firm, stop, pause*. The naming research's first choice. Clean
  metaphor, no conflict found. Concern: Hausa is predominantly northern while the crypto
  community skews Lagos and the south, so the name may be opaque to most of the actual market.
  **This concern needs the founder's read — they know the market.**
- **Ase (Àṣẹ)** — Yoruba, roughly *power, authority, so be it*. The research's second choice.
  Not recommended: spiritually loaded in a way that may read as irreverent on a trading
  product, and it promises *control* — the opposite note from a product whose value is that
  the user stops acting.

Also considered and rejected earlier: Ballast (on-message but heavy; the research found
existing companies using it), Tide (too common a word), Plumbline (a syllable too long, harder
to spell), Stoic (can read pretentious).

### Before committing to any name

- Search for existing fintech and crypto products using it. This is the step that caught Keel.
- For any Nigerian-language name, a native-speaker check for unintended or colloquial meanings.
- Check domain and handle availability directly. Assume the exact `.com` is taken.

---

## 3. Colour — "Instrument"

**The rule that drives everything: green and red are reserved for profit and loss. They are
never brand colours.** In a P&L product, if green is also the button colour and the logo
colour, green stops carrying information. This rules out most of the category, which is a
gift — it makes the brand distinctive for free.

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

Light mode inverts to a warm off-white ground (`#F7F9FC`) with the same accent; the teal
holds contrast in both.

Teal is unclaimed territory in this category — Binance and Bybit own yellow, Coinbase owns
blue, Kraken owns purple. It is also the accent furthest from green, so it never competes
with the profit colour for meaning.

### Rejected palettes

- **"Vault"** — near-black with brass `#C9A227`. The most attractive option and the most
  dangerous: brass is yellow-adjacent and, glanced at on a phone in bright sun, reads as
  Binance. It also signals private banking, the wrong note for a $200 account.
- **"Signal"** — charcoal with violet `#7C5CFF`. Clean and modern, but violet is the default
  accent of every DeFi protocol. Reads as a competent app rather than a distinctive
  instrument.

---

## 4. Typography

**IBM Plex Sans** for interface. **IBM Plex Mono** for every figure.

Plex was commissioned by IBM as an engineering typeface. It reads precise without reading
cold, which is the register the product needs. The Sans and Mono were drawn as one family,
so they harmonise — most sans/mono pairings do not. Both are free under the SIL Open Font
License.

The decisive argument is the numerals. This product *is* numbers, and Plex Mono gives them an
instrument-panel quality while keeping every digit unmistakably distinct at small sizes on a
phone.

- Weights: 400, 500, 600 only. Nothing else ships.
- All figures use `font-variant-numeric: tabular-nums` so columns align and values do not
  jitter as they update.
- Considered: Inter (competent but the default — looks like every other SaaS) and Instrument
  Sans (warmer, a fine alternative if Plex reads too technical).

### Loading

**Self-host the fonts.** Do not link to the Google Fonts CDN. Users are on Android phones
and often metered data, and a third-party round trip costs real time on a slow connection.

- WOFF2 only, subset to Latin.
- `font-display: swap`.
- Served from the VPS behind Caddy with a long cache header.

---

## 5. Voice

Plain, calm, never hyped. The interface should sound like an instrument reporting a reading,
not a broker selling.

- **Never state or imply a return.** Not in copy, not in onboarding, not in a testimonial.
- **Every performance figure carries its period.** `+12.4% (90d)`, never a bare `+12.4%`.
- **Describe state, not achievement.** "Your position moved to cash" — not
  "🚀 Strategy activated!"
- **Errors say what happened and what to do next.** "We could not reach Bybit, so no trade
  was placed. We will retry at the next daily close." Never "Something went wrong."
- **Never use urgency.** No countdowns, no "spots remaining", no fear of missing out. The
  entire product premise is that urgency is the enemy.

---

## 6. Accessibility

Roughly 8% of men have some red-green colour deficiency. This is a profit-and-loss product
whose primary signal is encoded in red versus green, with an audience that skews heavily
male. That combination makes this a correctness issue, not a nicety.

- **Colour alone never carries the P&L signal.** Always pair it with a sign and an arrow:
  `+2.4% ▲`, `−1.1% ▼`.
- Test every screen in greyscale. If it still reads, it is right.
- Body text meets at least 4.5:1 contrast against its background. The palette is built to
  clear this.
- **Mobile first.** Design at 375px before anything else, and keep the bundle small.

---

## 7. Asset checklist

| Asset | Spec |
|---|---|
| Wordmark | SVG, light and dark variants |
| Logo mark | SVG, square-safe, legible at 16px |
| Favicon | 32px and 16px ICO plus SVG |
| App icons | 180px apple-touch, 192px and 512px PWA |
| OG image | 1200×630 — matters more than usual, because links get shared into WhatsApp and Telegram where the preview *is* the first impression |
| Design tokens | Defined once in the Tailwind config, imported everywhere. The brand lives in the repo, not in a PDF |

---

## 8. Launch checklist

### Same day as the domain — land grab

Handle consistency matters more than which platforms get used. Claim the chosen
name on X, Instagram, Telegram (channel and group), WhatsApp Business, LinkedIn, and GitHub
on the day the domain is bought, before anyone else does.

### Email and deliverability

This is where startups fail silently. **A trading alert that lands in spam is a product
failure, not a marketing one.**

- Domain mailboxes: `founder@`, `support@`, `no-reply@`.
- **SPF, DKIM, and DMARC records configured before the first send.** Without all three,
  mail goes to spam by default.
- Send transactional mail from a dedicated subdomain (for example `mail.<domain>`) so that marketing
  sending can never damage transactional reputation.

### Support

Telegram and WhatsApp, not email-only. That is where Nigerian users already are, and
response speed in those channels is itself a trust signal.

### Analytics

Plausible or Umami, self-hosted on the VPS. Privacy-respecting, and — usefully — needs no
cookie banner, which removes a piece of friction and a piece of legal surface at once.

### Landing page and waitlist

Ship a landing page with an email waitlist **before** the build is finished. It costs almost
nothing, it validates demand while Phase 0 runs, and it gives a warm list to invite into the
pilot. The public track-record page becomes the real marketing asset later, once there is a
record to publish.

### Legal — blocking before the pilot opens beyond the founder

- CAC business registration.
- Terms of Service: not investment advice, no guaranteed returns, user retains custody and
  control at all times.
- Risk disclaimer, shown and explicitly acknowledged at onboarding, with the acknowledgement
  logged. Not buried in a footer.
- Privacy policy.
- Review by a Nigerian securities lawyer.

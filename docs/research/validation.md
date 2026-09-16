# Validation: Keel — Non-Custodial Crypto Trading Automation for Nigeria

- **Date:** 2026-09-16
- **Method:** Read the design spec, stack doc, and brand doc in full. Then ran ~17 web
  searches and 2 fetches across Nigerian crypto regulation, competitor landscape, market
  sizing, income data, exchange-rate data, and comparable copy-trading businesses. Sources
  listed at the end. Where I could not verify a claim, or where the data itself is
  contradictory, I say so in the text rather than picking the number that makes the best
  story.
- **What this is not:** legal advice, a financial model, or a guarantee. It is an outside,
  adversarial read of the plan against the best evidence I could find in a few hours.

---

## Bottom line

**Conditional go — but not on the current business model, and not on the current sequencing.**
The engineering design is unusually disciplined for a solo first build and the regulatory
instincts (non-custodial, SaaS posture, lawyer consult flagged) are correct in direction.
But the plan as written spends five months building a subscription product for $100–$1,000
accounts in a market where the exact product already exists for free, inside the exchange
the user already trusts, and where the realistic dollar edge of the strategy on an account
that size is smaller than any subscription fee worth collecting. That is an arithmetic
problem, not an execution problem, and no amount of trust-building fixes arithmetic. Full
reasoning below, with a specific recommendation on what to change before committing the five
months (see §7).

---

## 1. The strongest argument this fails

Not a list — one argument, in three linked steps.

**Step one: the strategy's realistic dollar edge on a $100–$1,000 account is small.**
A daily-candle trend filter is a real, sound approach — mechanical, explainable, and its
failure mode (whipsaw in sideways markets) is genuinely more survivable than most retail
strategies. But "sound" is not the same as "large." Even taking a favorable reference point
(a 200-day MA system beat S&P 500 buy-and-hold 317% to 125% over 2000–2016 with less
drawdown), that is an edge measured over 16 years on an index, not a promise of annual
outperformance on a volatile single asset. In any given year the strategy might beat holding
by a wide margin, roughly match it, or lose to it during a choppy year via whipsaw — the
design doc says as much itself. On a $200 account, a good year might be worth an
incremental $20–$60 versus simply holding. A bad, choppy year could be worth less than zero
versus holding. There is no version of this where the strategy reliably manufactures large
absolute dollars on a small account, because the account is small. This isn't a criticism of
the strategy — it is a description of what trend-following on $200 can physically produce.

**Step two: any subscription fee that is operationally worth collecting is large relative to
that edge.** The professional benchmark for what's a "fair" fee on assets under management is
roughly 0.25%–2%/year (robo-advisors at the low end, actively managed retail products at the
high end). On $200, that is $0.50–$4.00 a year — far below any price a SaaS business can
sanely bill (payment processing, support cost, and plain cognitive overhead put the practical
floor around $3–5/month for most consumer subscriptions). So the fee that is "fair" relative
to the account is uncollectible, and the fee that is collectible is unfair relative to the
account. A $5/month fee is $60/year — on a $200 account, that is a 30%/year hurdle the
strategy's edge has to clear before the user is ahead of doing nothing, in a strategy whose
own design doc concedes a bad year is possible. This is why the established competitors in
this exact category (3Commas, Bitsgap, Cryptohopper, WunderTrading, Gainium) all give away a
free tier for a single bot on one exchange, and only charge once a user runs enough
pairs/exchanges/bots that the fee is trivial against the larger balance being managed. **Keel,
as a single-strategy, single-exchange tool, has no equivalent upsell surface** — there is no
natural point at which a $200-account user's usage grows enough to make a flat fee rational,
because the product is deliberately one strategy on one asset. The free-tier-then-power-user-
upsell mechanism that makes this category's economics work at small account sizes is exactly
the mechanism the current "free pilot, then flat subscription" plan skips.

**Step three: the free substitute is not a rumor, it is one tap away in the same app.**
Bybit already ships Spot Grid, DCA, Martingale, and Combo bots, plus native copy trading,
built into the exchange the user already has an account and trust relationship with, at zero
additional signup, zero additional API key, and zero subscription fee. A user weighing
"give a five-month-old startup my API key and pay $5/month" against "tap the bot icon I
already see in the app I already use, for free" is not making a close call. (Bybit's grid/DCA
bots are architecturally different from a trend filter — they're built for range-bound
markets, not directional moves — which is a real, defensible distinction I address in §5. But
it is a distinction a $200 retail user has to be taught to care about, and teaching it is a
cost the free alternative doesn't have to pay.)

**Put together:** the account size caps the dollar edge, the small edge caps the fee that can
rationally be charged, and the fee that can rationally be charged has to compete against a
free, built-in, zero-trust-required substitute. This ceiling exists **independent of how well
the product is built, how honest the marketing is, or how good the eventual track record
looks.** Perfect execution does not raise the ceiling — it just gets you to the ceiling faster.
That is the single most likely cause of death: not a bug, not a regulator, not a competitor's
marketing budget, but a market that is structurally too small-dollar, for a product with no
upsell surface, standing next to a free substitute.

---

## 2. Market reality

### What the adoption numbers actually say — and where they disagree

Nigeria's crypto-adoption numbers are genuinely impressive and genuinely inconsistent across
sources, and the inconsistency itself is a finding worth flagging rather than smoothing over:

- One estimate: **~22 million Nigerians (≈10.3% of population)** owned or used crypto by
  2025, versus ~0.4% a decade earlier, with projected 2025 crypto-market revenue of
  **$2.4 billion** and user penetration climbing toward 28.7 million by 2026
  ([Mular](https://mular.co/blog/nigeria-crypto-ownership-2025/)).
- A different, adult-survey-based figure in the same search results claims **35% of Nigerian
  adults** have invested in crypto, with 90% "planning future investment" — a much higher rate
  than the 10.3%-of-total-population figure implies, even accounting for a younger population
  skew. Self-reported adoption surveys in this category are prone to social-desirability bias
  and small, non-representative samples; I was not able to verify the methodology behind
  either number, and **I would not treat either as precise.** Treat them as "meaningfully large
  and growing," not as a defensible TAM input.
- **The ranking commonly repeated in pitch decks — "Nigeria is #1 or #2 globally in crypto
  adoption" — is now stale.** Chainalysis's 2025 Global Crypto Adoption Index (published
  September 2025) has Nigeria at **#6**, down from #2 in 2024, behind India, the US, Pakistan,
  and Vietnam. Chainalysis attributes part of the drop to a **methodology change** (replacing
  a retail-DeFi sub-index with institutional activity), not necessarily to Nigerians using
  crypto less — but this also means the index measures adoption *intensity relative to
  population/purchasing power*, not headcount, and it is not a market-sizing number at all.
  Do not use "#1 in crypto adoption" as a demand argument in a pitch; it is both outdated and
  the wrong kind of statistic for this question.
  ([Chainalysis](https://www.chainalysis.com/blog/2025-global-crypto-adoption-index/),
  [Bitcoinist](https://bitcoinist.com/crypto-adoption-2025-chainalysis-report/))

**My honest read:** there is a real, large, and growing population of Nigerian crypto holders
— high single-digit millions is defensible, low tens of millions is optimistic-but-plausible
depending on whose survey you believe. I could not find a reliable, methodologically sound
number and I'd treat every published figure in this space as directional at best.

### The gap between "crypto holders" and "addressable market for paid trading automation"

The relevant number for this business is not "crypto holders." It's crypto holders who (a)
hold spot BTC with a buy-and-hold posture rather than active day-trading or pure
remittance/stablecoin pass-through, (b) have $100–$1,000 sitting in it that isn't needed for
near-term spending, (c) are willing to link a live-money API key to a brand-new, unproven,
solo-founder company, and (d) will pay a recurring fee for it in a category where the
dominant products are free or near-free. Nigeria's crypto usage is disproportionately
**stablecoin-driven and P2P/remittance-driven** — Nigeria ranked 1st in P2P exchange volume in
Chainalysis's 2023 index — which is a different use case from "buy-and-hold BTC, automate the
exit." I could not find a breakdown of how much of Nigeria's crypto activity is
buy-and-hold-BTC versus stablecoin-remittance versus short-term speculation, which is itself a
gap: the plan's core demand assumption (people holding BTC through drawdowns because they lack
3am discipline) is plausible but **unquantified**, and it should be the first thing tested
cheaply (see §6).

### Existing demand signals — real, but already being served

Demand signals do exist: there is Nigeria-specific SEO content actively targeting this search
intent right now — CryptoRobotics runs country-specific landing pages ("Best Crypto Trading
Bot for Nigeria," "AI Crypto Trading Bots for Nigeria," "Arbitrage Crypto Trading Bots for
Nigeria"), and a Nigerian finance-content site (forexbroker.ng) published a "7 Best Crypto
Trading Robots In Nigeria" roundup recommending Pionex, KuCoin, Bitsgap, IC Markets, Mudrex,
Chartscout, and TradeSanta. **This is genuinely useful evidence that people are searching for
this** — but it is also evidence the search intent is **already being captured by global
platforms**, not evidence of an underserved niche. I found no Nigerian-founded competitor in
this exact space, which is a real gap Keel could fill — but "no local competitor" and "no
competitor" are very different claims, and only the weaker one is true here.

### Realistic addressable market — a skeptical estimate

I want to be explicit that what follows is a **Fermi estimate built on guessed conversion
rates, not measured data.** Treat the shape of the argument as more reliable than the exact
numbers.

Starting from ~22M crypto holders (the more optimistic of the contested figures):
- ~20% hold BTC specifically with a buy-and-hold-style posture rather than pure stablecoin
  P2P/remittance use → **~4.4M**
- ~5% would ever consider ceding trade execution to third-party automation at all (most
  people who "should" act at 3am also simply won't install anything to fix that) → **~220K**
- ~2% would trust an unproven solo-founder company enough to link a live API key before there
  is a public track record → **~4,400**
- ~10–20% of those convert to paying once the free pilot ends, given how many free
  alternatives exist in the category → **~440–880 realistic paying users, at full national
  saturation, not month-one or year-one traction.**

That ceiling is not zero — it's a real, if small, niche. Whether it is enough is the subject
of §3.

---

## 3. The unit economics problem — the arithmetic

**On a $200 account:**

| Reference point | Implied fee | Monthly equivalent |
|---|---|---|
| "Fair" AUM fee, robo-advisor style (0.25–0.5%/yr) | $0.50–$1.00/yr | $0.04–$0.08/mo |
| "Fair" AUM fee, active-management style (1–2%/yr) | $2–$4/yr | $0.17–$0.33/mo |
| Practical SaaS billing floor (support cost, payment friction, "not worth thinking about") | — | ~$3–5/mo |
| Competitor entry-tier pricing (3Commas, Bitsgap, Cryptohopper) | — | $20–$29/mo |

Every number a real business could plausibly charge ($3–10/month) is **9x to 60x** the
"fair" AUM-based fee on a $200 account. There is no honest price in between — the gap between
"what's fair for this account size" and "what's operationally worth billing" doesn't close,
it just gets less absurd as the account gets bigger. This is exactly why $100–$1,000 is a hard
account-size band to build a subscription business on, independent of Nigeria specifically.

**Plausible price a $200-account user pays:** Given Nigeria's income context — statutory
minimum wage is **₦70,000/month (≈$52 at ₦1,350/$)**, one recruiter-sourced average formal
salary figure is **₦275,000/month (≈$200)**, and GDP per capita implies roughly **$213/month**
economy-wide — a recurring fee north of $10/month is a hard sell for a meaningful share of the
target population, and even $5/month is 2.5–10% of monthly income depending which band you're
in, before any conversation about whether the strategy is working. I'd put **$3–7/month** as
the realistic willingness-to-pay band for this account size, with $10 as an outer edge, not a
midpoint. (I could not verify a Nigeria-specific willingness-to-pay study for crypto tools
specifically; this is inferred from income data and adjacent-category pricing, not measured.)

**How many paying users are needed:** this depends entirely on what "worth a founder's time"
means, which is the founder's call, not mine — I'll show the arithmetic at three bars:

| Monthly income bar | Users needed @ $5/mo | Users needed @ $10/mo |
|---|---|---|
| "Beer money" — $300/mo | 60 | 30 |
| "Meaningful side income" — $1,500/mo | 300 | 150 |
| "Replaces a modest full-time income" — $3,000/mo | 600 | 300 |

*(I have not verified a specific opportunity-cost figure for a Nigeria-based or
remote-earning TypeScript engineer capable of this build — plug in your own number for the
third row; $3,000/month is a placeholder, not a researched benchmark.)*

**Compare to §2's realistic ceiling of ~440–880 paying users at full national saturation.**
Hitting the "meaningful side income" bar at $5/month requires converting roughly **35–70% of
the entire realistic national market for this exact product** — not a beachhead, most of the
beach. That is not mathematically impossible, but it means there is effectively no room for a
competitor to also succeed in this niche, no room for the founder to under-market, and no
slack if the Fermi assumptions above are even modestly optimistic. At $10/month the picture
improves (17–35% of ceiling) but $10/month is already past where I'd expect meaningful price
resistance on a $200 account (see above). **The realistic operating zone for this business is
thin, not comfortable, under either pricing assumption.**

**One more angle, because it's a natural question: could exchange affiliate revenue replace
the subscription?** Bybit pays affiliates up to 50% of the trading fees generated by referred
users. But do the math on what a trend-following strategy on a $200 account actually
generates: assume a whipsaw-heavy year with ~10 round trips (buy+sell) and a ~0.1% taker fee
— that's $200 × 0.1% × 2 × 10 ≈ **$4 of trading fees generated per user per year**, of which
an affiliate share is at most **~$2/year per user**. Low-frequency, daily-candle strategies
are fee-light by design (the design doc is explicit that this is intentional, for cost and
bug-surface reasons) — which is good engineering and bad affiliate economics. This pivot does
not work at this account size and this trade frequency; it might be viable only at much larger
account sizes than the stated $100–$1,000 target.

---

## 4. Willingness to pay — Ponzi trust, argued both ways

**The case that Nigeria's Ponzi history makes trust harder to earn:** MMM (2016) and its
successors already poisoned the vocabulary — the brand doc's own instinct to ban "profit,"
"wealth," "gain," "earn," and "double" from the copy is correct and evidence-based. More
urgently: **CBEX collapsed in April 2025 — five months before this document, not a
decade-old memory.** It ran for nearly two years promising 100% returns in 30 days through an
"AI-powered trading platform," and losses are estimated anywhere from ~$12M to over $800M
depending on the source (a genuinely enormous range, which is itself a sign of how murky the
post-mortem accounting is —
[Elliptic](https://www.elliptic.co/insights/investigating-cbex/),
[CryptoSlate](https://cryptoslate.com/nigerian-investors-blindsided-by-massive-cbex-ponzi-scheme/)).
The phrase "automated trading platform" is, right now, close enough to "AI-powered trading
platform" that a first impression of Keel risks pattern-matching to the thing that just hurt
people. And critically: **most Ponzi victims are not equipped to evaluate the difference
between custodial and non-custodial.** Understanding "trade-enabled, withdrawal-disabled API
key" as a meaningful safety property requires a level of technical literacy that the mass
retail market — the population actually vulnerable to MMM/CBEX-style schemes — generally does
not have. The trust pitch is real, but it may only land with people who were never going to be
scammed anyway.

**The case that transparent non-custody is MORE attractive by contrast:** No Ponzi scheme can
make Keel's core claim, because a Ponzi scheme requires custody of the money to run the scheme
at all — "your funds never leave your own exchange account, and here's how to verify the key
has no withdrawal permission" is structurally something CBEX could never say and mean. For the
slice of the market that survived MMM or CBEX and is now actively scanning for exactly this
red flag (does this platform ask me to send money to it, or move my funds to a wallet it
controls?), a verifiable non-custodial design is a strong, differentiated, and honest signal —
and this slice is disproportionately likely to be vocal in Nigerian crypto Twitter/Telegram
circles, which matters for word-of-mouth distribution in a market this plan is explicitly
counting on.

**My position:** both are true, but they apply to different-sized populations, and that
matters for strategy, not just sentiment. The "burned and now skeptical of custody" segment is
real but is a **minority of a minority** — technically literate enough to understand API key
permissions, still active in crypto after being burned, and specifically evaluating
custody structure rather than pattern-matching on vocabulary alone. The "another trading
platform, no thanks" mass-market reaction is the more common response and is not solved by
better fine print, because it isn't a literacy problem — it's a pattern-matching problem.
**Practical implication: this is not a mass-retail trust story and shouldn't be marketed like
one.** The go-to-market has to be narrow and crypto-native (Telegram/Twitter/Discord crowds
that already discuss API keys and self-custody, not general Nigerian social media), which is
consistent with — and actually reinforces — the thin, niche market size in §2–3, not a
contradiction of it.

---

## 5. The strategy problem — product or feature?

**Feature, not product, as currently scoped — and this is worth being direct about.** A
moving-average trend filter on BTC daily candles is public domain: thousands of free
TradingView scripts implement it, open-source bots (Freqtrade, Hummingbot) let a technical
user run it for free on their own infrastructure, and every major "crypto trading bot" SaaS
(3Commas, Bitsgap, Cryptohopper, WunderTrading, Gainium, Octobot) already supports
custom/DCA/signal-driven strategies against Bybit specifically, several with a **free tier**
([Gainium](https://gainium.io/bybit): free forever, single-pair, four exchanges including
Bybit; [WunderTrading](https://wundertrading.com/en/account/subscription/pricing): lifetime
free plan; [OctoBot](https://www.octobot.cloud/bybit-trading-bot): no platform fee at all).
The architectural choice that the design doc treats as the core trust differentiator — "trade-
enabled, withdrawal-disabled API key, you keep custody, we're software not a manager" — is not
a Keel innovation. **It is the default architecture of this entire product category,** and has
been since roughly 2017 (3Commas). Calling it "non-custodial" as if it were a novel design
decision, when it is simply how every serious player in the space has always had to build this
kind of product (nobody in this category holds customer funds; the exchange does), oversells
the differentiation.

**What would make it defensible — and what wouldn't:**

- **Would not work:** a better or more "sophisticated" version of the same MA filter. There is
  no realistic amount of strategy tuning that turns a public, well-understood signal into a
  durable edge competitors can't replicate in a weekend; if it worked reliably enough to
  matter, it would already be arbitraged away by the many well-funded quant desks that have
  run exactly this family of strategy for over a decade.
- **Would not work:** "we have a verified track record." A track record proves the software
  didn't break, which is genuinely valuable for v1's own success criteria (§10 of the design
  doc is right to define success this way) — but it doesn't create switching costs. A better
  or equally good track record is always reproducible by a competitor running the same public
  strategy, including Bybit itself if it ever ships a trend-following bot template.
- **Might work: localization as the actual moat.** The things global competitors structurally
  underinvest in for a market like Nigeria are exactly the things the brand doc already
  instinctively gets right: Telegram/WhatsApp-native support (not English-only ticket queues),
  a name and palette deliberately built to avoid both crypto-casino and Ponzi-adjacent
  signaling, and — the one I'd bet on most — **Naira-denominated billing via local rails
  (Paystack/Flutterwave/bank transfer) instead of requiring an internationally-capable card.**
  Nigerian-issued cards have a long history of CBN-imposed international/FX spending
  restrictions that have made paying a USD-billed SaaS product a genuine, repeated friction
  point for Nigerian consumers over the years. I was not able to verify the exact current card
  limit rules as of September 2026, so treat this as a plausible, cheaply testable hypothesis,
  not a confirmed fact — but if it holds, it is a real, boring, unglamorous advantage that
  3Commas and Bitsgap are unlikely to prioritize solving for a market this size, and it doesn't
  depend on the strategy being good at all.
- **Might work: being the multi-strategy platform, later — not the single-strategy tool, now.**
  The category's economics (§3) work because free entry tiers fund themselves on power users
  running many bots/pairs/exchanges. A single MA filter on one asset never reaches that upsell
  surface. If this is to become a real product rather than a feature, the roadmap needs a path
  to "multiple strategies, multiple assets, a marketplace" — which is a materially bigger build
  than what's currently scoped, and a decision to make consciously rather than discover a year
  in.

**Bottom line on this question:** ship it as a feature-quality trust-builder (which is what
the current design already treats it as — boring, explainable, safe failure mode, used to earn
a track record), not as the thing that's being sold. The thing worth selling, if anything is,
is distribution and localization for an underserved specific market, not the algorithm.

---

## 6. What would need to be true

Ordered roughly from cheapest-to-test to hardest-to-test:

1. **The strategy has a genuine multi-year edge over buy-and-hold, net of fees and slippage,
   including through at least one full bear market.** *Testable cheaply* — this is already
   Phase 0 in the design doc, about a week of offline backtesting. Correctly sequenced first.
   Keep it first regardless of anything else in this document.

2. **A meaningful share of Nigerian crypto holders actually hold BTC buy-and-hold style,
   rather than using crypto primarily for stablecoin P2P/remittance.** *Testable cheaply* —
   this can be answered with a short survey to the planned landing-page waitlist, before any
   execution-engine code is written. I could not find public data breaking this down and it is
   a load-bearing assumption for the whole "we solve 3am panic-selling" narrative.

3. **Users will state a willingness to pay $X/month for this before the pilot ends, and that
   stated willingness survives contact with an actual invoice.** *Partially testable cheaply*
   — ask pilot volunteers directly, early, what they'd pay, rather than waiting for the full
   3–6 month track record to conclude before having this conversation. A landing page with a
   visible price and a "join with a small refundable deposit" step is a much less biased signal
   than a free email waitlist, and is cheap to build.

4. **Strangers — not the founder's personal network — will link a live-money API key to a
   brand-new company before there's a public track record.** *Only partially testable cheaply.*
   The "informed volunteers" step in the plan tests this with people who already trust the
   founder personally, which is a biased sample for exactly the variable being tested (trust in
   a stranger's software). Getting a true read requires reaching people outside that network,
   which is slower and can't be rushed without undermining the thing being measured.

5. **Bybit remains reasonably accessible to Nigerian retail users, on web or app, for the
   life of the business.** *Not controllable, only monitorable.* This is not hypothetical —
   Nigeria's NCC/CBN already ordered ISPs to block Binance, Coinbase, OKX, Kraken, Luno, **and
   Bybit by name** in February 2024, and reporting as recent as October 2025 describes access
   as still fragmented by carrier, workable mainly via VPN or the mobile app depending on
   network ([TechCabal](https://techcabal.com/2025/10/30/despite-pro-crypto-moves-major-exchanges-remain-offline-in-nigeria/)).
   A product built entirely on one exchange integration is exposed to a policy risk that has
   already materialized once against that exact exchange, in that exact country, within the
   last two and a half years. This is a real platform-risk assumption with a concrete track
   record of failing, not a theoretical one.

6. **The "SaaS tool, not managed account" framing holds up against Nigeria's SEC under the
   Investments and Securities Act 2025.** *Not testable cheaply — but urgently answerable, and
   currently under-prioritized in the plan's own sequencing.* What I found in secondary
   sources (law-firm summaries, not the primary statute) is that Nigeria's SEC rules are
   written broadly: "no person or entity shall provide any virtual assets service unless
   registered with the SEC," with named categories (VASP, Digital Assets Exchange, Digital
   Assets Custodian, Digital Assets Offering Platform) and **no software/execution-only
   carve-out that I could locate.** The registration fee for a VASP licence alone is
   **₦30,000,000 (≈$22,200 at ₦1,350/$)**, before a required fidelity bond and paid-up capital.
   If, instead, the activity is read as portfolio/fund management (discretionary trading
   decisions on a client's behalf, even without custody), the minimum paid-up capital is
   **₦150,000,000 (≈$111,000)** under the older threshold, or into the **billions of naira**
   under a 2026 tiered revision for larger managers — categorically unreachable for a solo
   bootstrapped founder. The comparatively cheaper path, if it applies, is an investment
   adviser registration at roughly **₦2,000,000–₦50,000,000 (≈$1,500–$37,000)**. Which of
   these — if any — actually applies to a non-custodial, non-discretionary, published-algorithm
   execution tool is a genuinely unresolved legal question, not one this research can answer,
   and I want to be explicit that **I read secondary sources, not the full primary text of the
   ISA 2025 or the SEC's digital asset rules**, so treat my read as directional pressure, not a
   legal conclusion. What I can say confidently: this is not a formality-only risk. It is
   large enough in naira terms, and ambiguous enough in scope, that it should be answered with
   a **specific, written opinion on this exact structure** in month one — not deferred to
   "before the pilot opens beyond the founder," which under the current phased plan could be
   month four or five, after most of the time investment has already happened. The design doc
   already flags the lawyer consult as blocking; my disagreement is only with *when*, not
   *whether*.

7. **A solo founder can sustain multi-year operational vigilance** (uptime, exchange API
   changes, security posture, regulatory monitoring) without the one mistake that ends trust
   permanently. *Not really testable in advance* except by the founder's own honest read of
   their track record on prior solo projects. Not a market question — an execution-capacity
   question, and the one I'm least equipped to assess from outside.

---

## 7. Go / no-go / pivot

**Not a clean no-go.** Credit where it's due, specifically: the non-custodial architecture is
the right call and rare to see chosen deliberately rather than backed into; the fail-closed,
idempotent, reconciliation-freezes-on-mismatch design in §§4–6 of the spec is meaningfully more
disciplined than the median first solo trading system, and that discipline is precisely what
prevents the boring, survivable failure mode (whipsaw) from becoming a catastrophic one (a bug
that loses someone's money); the brand's deliberate avoidance of Ponzi-adjacent vocabulary and
crypto-casino visual language is evidence-based rather than aesthetic preference; and the
build order — backtest first, offline, before a single line of user-facing code — is exactly
the right sequencing to find out cheaply whether the riskiest technical assumption holds. None
of that is faint praise; it's a genuinely above-average starting position for a solo build.

**But the business model wrapped around that engineering does not currently clear the bar,**
for the reasons in §1 and §3: the account-size band has no natural upsell surface, the
plausible per-user revenue is small relative to any operationally sane fee, the realistic
national ceiling of paying users requires capturing most of a thin niche rather than a
beachhead within a larger market, and the core "non-custodial API key" trust pitch is the
default architecture of an already-mature, free-tier-rich global competitor set, not a Keel
differentiator.

**Recommendation: pivot the model and re-sequence, keep the engine.**

1. **Keep Phase 0 exactly as planned** — the backtest is cheap, informative regardless of
   business model, and correctly sequenced first. Do it.
2. **Move the lawyer consult from "before pilot opens beyond founder" to month one**, and ask
   for a specific written answer on whether non-custodial, non-discretionary, published-
   algorithm trade execution for a fee requires VASP, investment-adviser, or portfolio-manager
   registration under the ISA 2025 — before committing to months two through five. If the
   answer requires portfolio-manager-tier capital, this specific model is dead regardless of
   anything else in this document, and it's better to know in week three than month five.
3. **Do not default to a flat subscription on $100–$1,000 accounts.** Test pricing and true
   willingness-to-pay with the very first pilot cohort — a stated price plus a real (small,
   refundable) commitment — rather than waiting for a 3–6 month track record to have that
   conversation. The arithmetic in §3 suggests the honest answer may be "this account size
   doesn't support a subscription," and it's cheaper to learn that in month two than month six.
4. **Seriously consider retargeting upmarket** — larger Nigerian and diaspora holders
   ($5,000–$50,000+ accounts) where a flat monthly fee is a trivial percentage of assets and
   the "I don't want to think about this" pitch is actually worth paying for, rather than
   agonized over. This changes the marketing motion (referral through crypto-literate
   networks and diaspora channels, not mass retail) but is far more consistent with the
   underlying unit economics than the stated $100–$1,000 target.
5. **Build the localization moat on purpose** — Naira billing via Paystack/Flutterwave,
   Telegram/WhatsApp-native support, and Nigeria-specific trust signals — and stop treating the
   MA strategy as the product. Treat it as what it already functionally is: a trust-building
   feature. If a second, third, and fourth strategy (plus a marketplace) become the actual
   product later, that's a bigger, consciously-made decision — make it consciously, not by
   default eleven months in.

If, after steps 1–3 (cheap, fast, doable inside 4–6 weeks), the lawyer's answer is clean and
pilot volunteers show real stated willingness to pay at a price the arithmetic in §3 says is
survivable — proceed to the full five-month build with genuine conviction, because the
engineering foundation underneath it is sound. If either comes back badly, the founder will
have spent weeks, not months, finding out.

---

## Sources

- [Mular — Nigeria's Crypto Adoption in 2025](https://mular.co/blog/nigeria-crypto-ownership-2025/)
- [Triple-A — Cryptocurrency Ownership Data, Nigeria](https://www.triple-a.io/cryptocurrency-ownership-data/nigeria)
- [Chainalysis — 2025 Global Crypto Adoption Index](https://www.chainalysis.com/blog/2025-global-crypto-adoption-index/)
- [Bitcoinist — Crypto Adoption 2025: Chainalysis Reveals Leading Countries](https://bitcoinist.com/crypto-adoption-2025-chainalysis-report/)
- [Mondaq — How VASPs Can Obtain Licenses in Nigeria](https://www.mondaq.com/nigeria/fin-tech/1695342/how-virtual-assets-service-providers-vasps-can-obtain-licenses-in-nigeria)
- [Mondaq — Overview of SEC's Amendments to Digital Asset Rules under ISA](https://www.mondaq.com/nigeria/fin-tech/1631786/overview-of-the-secs-amendments-to-the-rules-on-digital-assets-issuance-offering-platform-exchange-and-custody-and-inclusion-of-digital-assets-as-security-in-the-new-investment-and-securities-act)
- [SEC Nigeria — Fund/Portfolio Managers Registration Requirements](https://sec.gov.ng/about/resources/checklists/individual-registration-requirements-for-each-cmo/fundportfolio-managers-registration-requirements/)
- [Brandiconimage — SEC Raises Minimum Capital Requirements Across Nigeria's Capital Market](https://www.brandiconimage.com/2026/01/sec-raises-minimum-capital-requirements.html)
- [Koriat Law — Requirements for Registration as Fund/Portfolio Managers in Nigeria](https://koriatlaw.com/requirements-for-registration-as-fund-portfolio-managers-in-nigeria/)
- [TechCabal — Despite pro-crypto moves, major exchanges remain offline in Nigeria (Oct 2025)](https://techcabal.com/2025/10/30/despite-pro-crypto-moves-major-exchanges-remain-offline-in-nigeria/)
- [Bloomberg — Nigeria Detains Binance Executives in Overseas Tax Crackdown](https://www.bloomberg.com/news/articles/2024-02-29/ngn-usd-nigeria-detains-binance-executives)
- [TechCrunch — Nigeria demands Binance disclose top users, executives remain detained](https://techcrunch.com/2024/03/12/nigeria-demands-binance-disclose-top-users-executives-remain-detained/)
- [Elliptic — Investigating CBEX](https://www.elliptic.co/insights/investigating-cbex/)
- [CryptoSlate — Nigerian investors blindsided by massive CBEX Ponzi scheme](https://cryptoslate.com/nigerian-investors-blindsided-by-massive-cbex-ponzi-scheme/)
- [Afriwise — CBN Lifts "Ban" on Crypto Banking Transactions](https://www.afriwise.com/blog/cbn-lifts-ban-on-crypto-banking-transactions)
- [Gainium — Bybit Trading Bot / Pricing](https://gainium.io/bybit), [Gainium Pricing](https://gainium.io/pricing)
- [WunderTrading — Pricing](https://wundertrading.com/en/account/subscription/pricing)
- [OctoBot — Bybit trading bot](https://www.octobot.cloud/bybit-trading-bot)
- [Bitsgap blog — Bitsgap vs 3Commas 2026](https://bitsgap.com/blog/ecommasvbitsgap)
- [forexbroker.ng — 7 Best Crypto Trading Robots in Nigeria (2026)](https://forexbroker.ng/cryptocurrencies/crypto-trading-robots/)
- [CryptoRobotics — Best Crypto Trading Bot for Nigeria](https://cryptorobotics.ai/crypto-bot/country/nigeria/)
- [Vanguard Nigeria — Dollar to Naira exchange rate, September 15, 2026](https://www.vanguardngr.com/2026/09/dollar-to-naira-exchange-rate-today-september-15-2026/)
- [NgnRates — Dollar to Naira Black Market Rate, September 15, 2026](https://www.ngnrates.com/market/exchange-rates/us-dollar-to-naira/black-market)
- [Eulerpool — Nigeria Minimum Wages 2026](https://eulerpool.com/macro/nigeria/minimum-wages)
- [Trading Economics — Nigeria GDP per Capita](https://tradingeconomics.com/nigeria/gdp-per-capita-us-dollar-wb-data.html)
- [WageCentre — Salary in Nigeria in 2026](https://wagecentre.com/work/work-in-africa/salary-in-nigeria)
- [Getlasso — Bybit Affiliate Program: Commission & Program Details (2026)](https://getlasso.co/affiliate/bybit/)
- [CB Insights — ZuluTrade financials/investor history](https://www.cbinsights.com/company/zulutrade/financials)

**Explicit gaps I could not verify:** a Nigeria-specific breakdown of buy-and-hold BTC holders
versus stablecoin/P2P/remittance users; current CBN card international-spending limits as of
September 2026; the primary legal text of the ISA 2025 and the SEC's digital asset rules
(I relied on law-firm and news summaries); any measured willingness-to-pay study for crypto
automation tools in Nigeria specifically; free-to-paid conversion benchmarks for this exact
product category. Where the analysis above depends on these, I've flagged it as an estimate,
not a fact.

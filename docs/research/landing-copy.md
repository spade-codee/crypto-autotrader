# Keel — Waitlist Landing Page Copy

Companion to `docs/brand.md` (voice rules, §5) and
`docs/superpowers/specs/2026-09-16-crypto-trading-automation-design.md`.

- **Date:** 2026-09-16
- **Status:** Draft copy, ready for design/build. Risk disclosure needs a lawyer pass before
  the page goes live (brand.md §8).
- **Stage this copy is written for:** pre-launch waitlist. Nothing is built. No backtest, no
  track record, no users. Accordingly, this copy contains **no performance figures, no
  invented testimonials, no user counts, and no urgency mechanics** — that's not a stylistic
  choice, it's a hard constraint from brand.md §5, and breaking it would also just be false.

### How to read this file

Anything in a blockquote like the one below is a note for the team, not copy for the page:

> Example: this is an implementation or rationale note, not something a user should see.

Everything else — headlines, body copy, button labels, microcopy — is written to be copied
directly into the page.

Readability target is roughly 8th grade throughout. Objection 3 and the risk disclosure run
a little denser than that, because the subject genuinely needs the extra clause or two — I'd
rather they be complete than artificially short.

---

## 1. Hero

### Headline options

**Option 1 — "Your BTC, run by a rule instead of a feeling."**
Benefit-first, mechanism-forward. States plainly what happens (a rule governs the BTC) and
implies the contrast (rule vs. feeling) without needing the subhead to complete the thought.

**Option 2 — "You know the rule. You just don't follow it at 3am."**
Self-recognition / problem-first. Names the exact psychological gap from the brief in the
headline itself. More emotionally pointed, but it's a headline that needs its subhead to
finish the sentence — on its own it reads as a tagline, not a description of a product.

**Which I'd ship: Option 1.**

Reasoning: this page's first impression usually won't be the page itself — brand.md §7 flags
that links get shared into WhatsApp and Telegram, where the link preview *is* the first
impression, sometimes with the subhead cut off or not rendered at all depending on the app.
For a suspicious audience seeing a crypto link cold in a forwarded chat, "you know the rule"
is a hook that requires trust to land — it asks the reader to stay curious for one more line.
"Run by a rule instead of a feeling" is legible on its own: it says what the product does
(applies a rule to BTC) in a register that sounds like an instrument, not a pitch. Clarity
beats intrigue when the reader's default posture is skepticism, not curiosity.

I didn't throw Option 2 away — its phrasing does real work naming the 3am gap precisely, so
it's reused (see §2) as the opening line of the Problem section, where the reader has already
gotten the mechanism from the hero and the emotional hook can land without any ambiguity cost.

### Page copy (using Option 1)

**Kicker (small text above the headline):**
Pre-launch — the strategy is being backtested now.

**Headline:**
Your BTC, run by a rule instead of a feeling.

**Subhead:**
Keel holds Bitcoin while the trend is up, and moves your account to stablecoin when it turns
down — automatically, on your own Bybit account, using an API key that can trade and cannot
withdraw.

**Trust microline (smaller text, directly under the subhead):**
You can check that last part yourself, in your own Bybit settings. It takes about two
minutes.

**Primary CTA button:**
Join the waitlist

**Microcopy under the button:**
One email when the backtest is done. Nothing before that.

**Secondary link (text link, not a button — scrolls to §3):**
See how it works ↓

> Visual note: a simple line chart, BTC price crossing a single moving-average line, drawn in
> the accent teal against the dark background. No candles on fire, no rocket, no floating
> percentage badge — brand.md §3 reserves green/red for real P&L, not decoration, and a
> hero graphic with a number on it will get read as a performance claim the moment it's
> screenshotted and forwarded without this page's context attached.

---

## 2. The problem

**Headline:**
The problem was never information.

**Body:**
You already know that BTC has fallen hard before and climbed back before. That's not really
in question.

What's in question, at 3am, watching the number drop, is whether this is the time it doesn't
— and whether you'll still be holding when you find out.

So you check the price again. And again. You tell yourself a story about why it's fine, and
you might even be right. But you're not deciding based on a rule you chose while you were
calm — you're deciding based on how you feel at the exact moment you're least equipped to
decide anything.

That gap — between the plan you'd write down in daylight and the thing you actually do at
3am — is the whole problem. It has nothing to do with how much you know about crypto.

**Bridge line into §3:**
Keel is one way to close that gap: decide the rule once, while you're calm, and let it run
the same way every time — including at 3am.

---

## 3. How it works

**Headline:**
How it works

**Intro:**
No discretion, no signals, no guessing what "the market is telling us." Four steps — and the
one about your money, you can verify yourself, today, without waiting for anything to launch.

**Steps:**

**1. Connect a trade-only key.**
You generate an API key inside your own Bybit account, with trading turned on and withdrawals
turned off — a setting Bybit enforces, not a promise we make. Paste the key and secret into
Keel. We never see your password, your email, or your 2FA. You can check the key's
permissions yourself, anytime, in your own Bybit account.

**2. Keel checks the trend once a day.**
At each daily close, it compares BTC's price to a long moving average — the average price
over a long stretch of time. Above the average, the trend counts as up. Below it, the trend
counts as down. That's the entire decision. BTC only and spot only (you own the actual coin,
not a leveraged bet on it) for now.

**3. Your account moves to match — or it doesn't.**
If the trend is up and you're not already holding BTC, Keel buys it. If the trend turns down,
Keel sells to stablecoin (USDT). Most days, nothing happens, because nothing needs to.
You'll always be able to see what happened and why.

**4. Pause or stop, any time.**
Pausing freezes the account exactly where it is. Stopping disconnects Keel and hands full
manual control back to you. Neither one needs a reason. You can also revoke the API key
directly from Bybit, whether or not Keel agrees.

**Callout — why step 1 matters more than the other three combined:**
Trade-enabled, withdrawal-disabled is a Bybit setting. Bybit enforces it, on Bybit's servers.
It has nothing to do with whether you trust us. If Keel's servers were compromised tomorrow,
or the company disappeared, or the strategy turned out to be wrong, nobody — including us —
could move your money out of your account. Go check that permission screen in your own Bybit
settings, right now if you want. That's not a sales pitch. It's just true, and it's the one
claim on this page that doesn't require taking our word for it.

**Early-exit CTA (small, between §3 and §4):**
Convinced already? [Join the waitlist ↓] Otherwise, here are the three questions worth asking
first.

---

## 4. Objection handling

**Headline:**
Three questions you're right to ask

**Intro:**
If you're skeptical of anything in crypto that wants access to your account, good — you
should be. Here are the three questions we'd ask too, answered directly.

### "Isn't this just another Ponzi scheme?"

Fair question, and if you lived through MMM or anything like it, you have every right to ask
it of everyone.

A Ponzi needs two things: your money moving into a pool someone else controls, and a promised
number big enough to stop you asking questions. Keel does neither. Your BTC and your
stablecoin stay in your own Bybit account the entire time you use it. We never take custody —
not briefly, not to "process" anything. And we won't tell you what return to expect, because
we don't know yet. Anyone who does tell you is the one to be suspicious of.

What we're actually asking you to trust is smaller than it sounds: that a piece of software
reads a price and places spot orders on a schedule. You don't have to take our word for the
part that matters most — you can check the API key's permissions in your own Bybit account
before you join anything.

### "Why would I give you access to my account?"

You're not giving us access to your account. You're giving one piece of software one specific
permission: place spot orders. That's the whole grant.

The key has no access to your password, your email, your 2FA, or any withdrawal function —
Bybit blocks that last one at the exchange level, before it ever reaches us. If our systems
were compromised tomorrow, someone could place trades on your account. They could not move a
single dollar out of it. That's the actual difference between "access to your account" and
"access to trade on it."

You're also not relying on us to hand that permission back. You can revoke or delete the API
key from inside your own Bybit account at any time — whether Keel is behaving itself or not,
whether our servers are even online or not. Bybit holds that control, the same as before
you'd ever heard of us.

### "Why not just use Bybit's own free bots?"

This is the fair one. Worth answering properly, not talking around it.

Bybit's built-in bots are real and free. If you're asking this, you've probably already
looked at them. Most are grid bots or DCA bots — built to trade inside a range, or to buy at
set intervals. That's a genuinely useful job. It is not the same job as deciding when to
leave a market that's falling, which is the one problem this product exists to solve.

You could build Keel's exact rule yourself, in principle. Watch BTC's price against a long
moving average. Move to stablecoin by hand when it breaks. None of that math needs special
software — it's public.

But then you're back to the real problem: a rule you have to remember to execute, under
pressure, at the exact moment your account is down and every instinct says wait one more day,
is barely different from having no rule at all. If that has ever happened to you, you already
know it.

What Keel replaces isn't the arithmetic. It's the moment a person is supposed to act on it and
doesn't. It runs the same rule, the same way, on a schedule, regardless of how the chart makes
you feel that day. That is a narrower job than a general bot platform is built for — on
purpose. Nothing to tune, nothing to "just adjust once" at 3am. Less to configure is the
point, not a missing feature.

---

## 5. What Keel doesn't do

**Headline:**
What Keel doesn't do. On purpose.

**Intro:**
For an audience that's heard every promise in the book, what a product refuses to do is worth
more than what it claims. This is the complete list.

- **Hold your money.** Your BTC and your stablecoin stay in your own Bybit account, always.
  Keel never takes custody, not even for a second.
- **Withdraw funds.** The API key it uses has withdrawal permission switched off, at the
  exchange level — not a policy we follow, a permission we don't have.
- **Promise a return.** We don't know what the strategy will do next month or next year, and
  we're not going to invent a number to make this easier to say yes to.
- **Guarantee the rule is right.** Trend-following rules are sometimes late and sometimes
  wrong, like every mechanical rule. What Keel promises is that it follows the rule exactly,
  every time — not that the rule is always the correct call.
- **Use leverage, margin, or futures.** Spot only. There's no liquidation to worry about,
  because there's nothing borrowed to liquidate.
- **Trade on news, signals, or discretion.** One mechanical rule, checked once a day, applied
  the same way every time — not a person's judgment call. Not ours, and once it's running,
  not yours either.
- **Lock you in.** Pause it, stop it, or disconnect the key entirely, whenever you want, for
  any reason or none.
- **Charge based on performance.** Pricing isn't decided yet. When it is, it will be a flat
  fee — never a percentage of your account.
- **Show you a track record it doesn't have.** There isn't one yet. The backtest is being
  written now, and it will be published as it turns out, not as we'd prefer it to look.

**Closing line:**
If any of that changes, this page changes with it. That's the deal.

---

## 6. Waitlist form

**Headline:**
Join the waitlist

**Framing line:**
There's nothing to buy yet. Just a form, and an honest description of what happens after you
fill it in.

### Form fields

**Email address** — *required*
- Label: `Email`
- Placeholder: `you@example.com`
- Helper text: For the backtest results and pilot invitation. Nothing else.

**Which exchange do you mainly use?** — *optional*
- Options: Bybit / Binance / Other / I don't currently trade
- Helper text: Keel starts on Bybit. This just helps us know what to build next.

**Roughly how much do you keep on the exchange?** — *optional*
- Options: Under $100 / $100–$500 / $500–$1,000 / Over $1,000
- Helper text: Optional, never shown to anyone, and only used to size what we build.

### Button and states

- Button (default): `Join the waitlist`
- Button (loading): `Adding you…`
- Error, invalid email: `That email address doesn't look complete. Mind checking it?`
- Error, empty submit: `We'll need an email address to add you to the list.`
- Already registered: `You're already on the list. We'll be in touch when there's something
  worth saying.`
- Success (replaces the form on submit): `You're on the list. Check your inbox for one
  confirmation email — that's the only thing you'll get from us today.`

### On-page "what happens after you join" (sits beside or under the form, visible before
submit — reduces the perceived risk of handing over an email address)

Here's exactly what happens after you sign up:

1. One confirmation email, so you know the address went through.
2. Then quiet, while the backtest gets written — several years of BTC price history, tested
   honestly, including fees and slippage.
3. Before Keel runs on anyone else's account, it runs on the founder's own. That happens
   before any pilot opens to volunteers.
4. One email when the backtest is done, whatever it shows. If the strategy doesn't hold up,
   that's what the email will say.
5. If it does hold up, an invitation to an early, free pilot — running on real money, in a
   small group of accounts, before anything opens more broadly.

No countdown. No "X people ahead of you." We'll write when there's something real to report,
not on a schedule designed to make you anxious about waiting.

### Confirmation email

**From:** founder@[keel domain — brand.md §2 lists `getkeel.com`, `keel.app`, `usekeel.com`
as candidates; none is confirmed yet]

> Note: sending this one from the founder's personal-sounding address rather than
> `no-reply@` is deliberate. brand.md §8 lists `no-reply@` for transactional trading alerts;
> a pre-launch waitlist confirmation is a relationship email, not an alert, and for an
> audience this skeptical, "a real person will read your reply" is worth more than
> deliverability polish. Flag if the team disagrees.

**Subject:** You're on the Keel waitlist

**Body:**

> Hi,
>
> You're on the list — no action needed.
>
> Here's exactly what happens from here:
>
> 1. We're writing the backtest now: several years of BTC price history, tested honestly,
>    including fees and slippage.
> 2. Before it runs on anyone else's account, it runs on the founder's own. That happens
>    before any pilot opens to volunteers.
> 3. You'll get one email when the backtest is done, whatever it shows. If the strategy
>    doesn't hold up, that's what this email will say.
> 4. If it does hold up, you'll be invited to an early, free pilot — running on real money,
>    in a small group of accounts, before anything opens more broadly.
>
> No countdown, no "X people ahead of you," no reason to check back early. We'll write when
> there's something real to report.
>
> Questions before then? Just reply to this email — it reaches the person who built this,
> not a queue.
>
> — [Founder's first name], Keel

### CTA copy variants (documented for testing)

| Variant | Copy | Rationale |
|---|---|---|
| A (default) | Join the waitlist | Plain, accurate, sets correct expectations. |
| B | Send me the backtest | Reframes the ask around a specific forthcoming artefact instead of an abstract list — may land better with an audience that trusts deliverables more than promises. |
| C | Keep me posted | Lowest-commitment framing; may reduce hesitation from users wary of "joining" anything crypto-branded by name. |

**Do not test:** anything implying status, scarcity, or urgency — "Reserve your spot," "Get
early access," "Don't miss the pilot." All three read as manufactured urgency and contradict
the product's actual premise (brand.md §5).

---

## 7. Footer

**Name and one-liner:**
Keel
Software that follows one rule on your own exchange account. Not a fund. Not an advisor.
Your keys, your stop button, the whole time.

**Contact line:**
Questions? Reply to the waitlist confirmation email once you're on the list, or write to
founder@[keel domain — see brand.md §2].

**Risk disclosure:**

> Keel is pre-launch. Nothing on this page is investment advice. Joining the waitlist does
> not open a trading account and does not move any money.
>
> Cryptocurrency prices are volatile. Spot trading carries a real risk of loss — including
> the risk of losing the full amount held on an exchange, whatever strategy is applied to
> it. A moving-average rule, once backtested and published, describes history. It is not a
> forecast, and it is not a promise about what happens next.
>
> Keel is non-custodial. Your funds stay in your own exchange account at all times. Keel
> connects using an API key that can place trades and cannot withdraw. That reduces some
> risks. It does not remove market risk, exchange risk, or the risk of holding a volatile
> asset.
>
> Keel cannot currently accept sign-ups from the United States or the European Union, where
> different rules apply. This may change later.
>
> Keel is a product in development. It is not yet a licensed or regulated financial service
> in Nigeria or anywhere else. This page is not an offer to manage funds and not investment
> advice.

**Copyright line:**
© 2026 Keel. [Legal entity name pending CAC registration — brand.md §8.]

> Note: the risk disclosure above is working copy, written to be honest and consistent with
> the design spec (§2 regulatory note, §11). It is not legal advice and has not been reviewed
> by a lawyer. brand.md §8 requires review by a Nigerian securities lawyer before the pilot
> opens beyond the founder — do that review before this specific block ships, too, since it's
> the page's only legal-adjacent copy and will be publicly visible earlier than the pilot is.

---

## Bonus: share-preview copy (not one of the seven requested sections)

brand.md §7 calls out the OG image as unusually important for this audience specifically
because links get shared into WhatsApp and Telegram, where the preview often *is* the whole
first impression. Worth having this written even though it wasn't asked for directly.

- **Title tag:** Keel — a rule for your BTC, not a feeling (waitlist)
- **Meta description:** Non-custodial BTC automation on your own Bybit account: hold when the
  trend is up, stablecoin when it isn't. The API key can trade, not withdraw. Join the
  waitlist.
- **OG title:** Your BTC, run by a rule instead of a feeling.
- **OG description:** Non-custodial BTC automation for Nigerian holders. Your money never
  leaves your own Bybit account. Waitlist open — nothing's built yet, and that's on purpose.

> Visual note: the OG image should reuse the hero's line-chart-crossing-a-moving-average
> motif plus the wordmark, and should carry no price or percentage figure anywhere on the
> image itself. A number on the image will get separated from this page's context the moment
> it's forwarded in a WhatsApp group, and a bare number with no context is exactly the shape
> of the claims this brand exists to not make.

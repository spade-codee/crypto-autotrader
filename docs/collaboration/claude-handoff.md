# Handoff from Claude to Codex: the customer experience prototype

- **Date:** 2026-09-22
- **Context:** the founder asked Claude and Codex to work hand in hand, and assigned the
  prototype's UI and UX to Codex.
- **Spec:** `docs/superpowers/specs/2026-09-22-customer-prototype-design.md` on branch
  `product-prototype`. First committed at `8152c93`; its ownership and folder lines were updated
  in the commit that adds this handoff. Work from the head of `product-prototype`.

## Who owns what

| | Owns | Does not touch |
|---|---|---|
| **Codex** | `prototypes/customer/`: the mobile-first prototype — Home, Strategy, Activity, Account, onboarding, interactions, accessibility, visual QA | `src/`, `tests/`, `drizzle/`, `deploy/`, `docs/decisions.md`, the spec |
| **Claude** | The spec and product context in `docs/`; the engine and backend in `src/`, `tests/`, `drizzle/`, `deploy/`; factual review of the prototype | Anything in `prototypes/customer/` |

Changes to the other's area go through review notes, not edits. Neither of us merges into
`product-prototype` or `master` without the founder, and nothing is deployed.

## Answers

**Is the product name still undecided?** Yes (`docs/decisions.md` #14). Duro is recommended, not
chosen. The prototype carries no name, only a plain placeholder mark (spec §3). Do not use Duro,
Keel, Tsaya, or Ase anywhere in the UI.

**Spec path and commit?** Above. The founder agreed the scope on 2026-09-22, with seven
refinements, all written into the spec: sections 4.3 to 4.6, 5c, R1, and D1.

**Approved decisions not in the repo?** None for design, product, or copy. Everything the founder
approved is in the spec or the decision log. The only other thing decided in conversation
concerns the engine, not the UI: the founder deferred proving the database lock on Linux until
the VPS deployment.

**Is `prototypes/customer/` a suitable folder?** Yes, and the spec now names it (§2). It sits
outside `src/` and `tests/`, so the engine's typecheck and tests ignore it. Keep it self-contained:
no dependency added to the root `package.json`, no backend, no analytics, nothing stored between
visits, and no network request it needs to work. If fonts load from a CDN, the page must stay
legible on system fonts without them.

## What I need from you

1. **Your own branch from `product-prototype`**, for example `codex/customer-prototype`. Send me
   its name and commit for review; don't merge it.
2. **The sample fixtures in one data file**, matching the spec's §5 sample-data table exactly. I
   checked every figure there by recomputing it, so a changed number is probably a typo.
3. **Every block the spec marks "Required copy" word for word** (§§4.3, 4.5, 4.6). If a screen
   works better with different wording, keep the original and propose yours in your notes; the
   founder and I check it neither overstates what the engine does nor implies a return.
4. **No claim about how the engine behaves beyond the spec.** If a screen needs one — a time, a
   consequence, what happens next — ask me. The pause sheet's and 5c's "an order already on its
   way is still confirmed and recorded" stays: it is requirement R1, required before any live
   customer, though not yet built.
5. **Which way sessions run**: the facilitator's phone or a private link. The spec leaves it to
   you and the founder.

## What my review checks

Facts, not visual design: every statement about engine behaviour; the historical figures and
their labels; the sample data's consistency; the brand's voice rules — no return claims, no
urgency, results always with a period and fees; and that nothing could pass for real data.

## Facts the screens must get right

A quick reference; the spec is authoritative.

- **One decision a day, about 01:00 Lagos time**, after the 00:00 UTC daily close. The 15-minute
  checks appear only where they explain recovery (5a).
- **All in or all out.** A buy spends 99.9% of the USDT, which is why the BTC state keeps about 1
  USDT. The 0.1% fee comes off what is received: in BTC on a buy, in USDT on a sale.
- **Six states:** practice (not activated), active, paused by you, a temporary problem (retrying,
  nothing to do), stopped for review (no resume button), stopped for everyone by the operator.
- **Pause:** no new orders; holdings stay as they are; BTC is not sold.
- **Connecting is not activating.** Connecting checks the key — spot trading only, withdrawals
  off, restricted to our server's address — and shows balances. Activating shows exactly which
  funds, and needs the user's confirmation. Available to users in Nigeria.
- **Data that could not be refreshed** is shown as last known, with its time, never as current.
- **Historical evidence**, exactly as spec §4.3: 13 of 18 completed buy–sell cycles lost; worst
  drop 27.4% against 53.1% for holding BTC; the test's dates, dataset, and costs; "not a
  forecast"; the worst past drop is not a limit on future losses. No annual growth anywhere.
- **"Practice"** is the user-facing word for paper trading.

## Engine status, for context

The Phase 2 engine is code complete on `phase-2-paper-engine` (508 tests), awaiting VPS
deployment and fourteen days of paper trading. The Bybit key test (#8) is still pending. None of
this blocks the prototype.

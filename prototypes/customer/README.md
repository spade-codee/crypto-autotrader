# Customer experience prototype — working draft

Owned by Codex; product facts and spec reviewed by Claude. Based on `product-prototype`
at `b806ad7`. No production code or dependencies are changed.

Open `index.html` directly in a browser. All files and fonts are local; no server, API,
network access, account connection, analytics or persistent storage is used. Each hash
link selects an independent scenario, for example `#btc/home` or `#review/account`.

This is an initial interaction draft, **not an approved visual design or completed
usability study**. The founder asked to brainstorm profile avatars, supporting artwork,
libraries and typography before settling the visual direction. No avatar pack has been
selected, bought or integrated. Sessions can initially run from a facilitator's local
device; a private hosting decision remains open.

## Files

- `fixtures.js`: invented account values and separately labelled real historical evidence.
- `app.js`: four destinations, seven starting scenarios, onboarding, understanding check,
  definitions, pause/resume and going-live preview. State is memory-only.
- `styles.css`: mobile layout, system light/dark preference, focus states and reduced motion.
- `fonts/`: self-hosted Latin IBM Plex Sans (400/500/600) and Mono (400), from Fontsource
  5.3.0 packages. SIL Open Font License is included.

## Review still required

- Claude's factual review, including the pause/resume and operator stop copy referring
  to future reconciliation requirement R1.
- The source spec's unconditional resumed-purchase sentence versus checking the next
  daily signal and safety conditions. The source wording remains in the preview pending review.
- Full visual, keyboard and state-transition QA, especially both colour schemes and Android.
- Founder selection of avatar/art direction and typography before final visual polish.

Initial verification: JavaScript syntax checks passed. A headless Chrome smoke check
visited all 28 scenario/tab combinations at 375px: no script errors or horizontal
overflow. Pause and the full three-question onboarding flow reached their expected states.
This does not replace the remaining visual, accessibility or factual review.

## Visual exploration, 22 September 2026

Candidate references, not adopted dependencies:

- Sculpted characters: https://craftwork.design/product/stylized-3d-avatars
- Configurable illustrated portraits: https://www.dicebear.com/styles/personas/
- Hand-drawn people: https://www.openpeeps.com/
- Consistent navigation icons: https://lucide.dev/
- Optional purposeful transitions: https://motion.dev/

Recommendation for discussion: one cohesive family of human avatars for profiles,
with varied skin tones and hair; keep the balance and decision areas typographically
clear. A small preset picker can be explored in a later revision. No profile data is
collected by the current prototype.

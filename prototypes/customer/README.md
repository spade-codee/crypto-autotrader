# Customer experience prototype — working draft

Owned by Codex; product facts and spec reviewed by Claude. Includes `product-prototype`
through `91cd081`. No production code or dependencies are changed.

Open `index.html` directly in a browser. All files and fonts are local; no server, API,
network access, account connection, analytics or persistent storage is used. Each hash
link selects an independent scenario, for example `#btc/home` or `#review/account`.

This is an initial interaction draft, **not an approved visual design or completed
usability study**. The founder asked to brainstorm profile avatars, supporting artwork,
libraries and typography before settling the visual direction. No avatar pack has been
selected, bought or integrated. Sessions can initially run from a facilitator's local
device; a private hosting decision remains open.

## Run a participant session

Open `session-guide.html` directly on the facilitator’s own device. It is deliberately
not linked from participant screens, so reference answers cannot be opened mid-task. It contains
the 16 agreed tasks, seven scenario links, collapsible facilitator references and a
two-page printable blank notes sheet. Keep the guide with the facilitator; show only
the prototype to the participant. Use participant codes and record the UI commit.
The guide has no forms or storage. Actual sessions have not yet been conducted.

Verified the guide at 375px and 1440px in light/dark: all seven scenario links open,
no horizontal overflow, script errors or network requests, no selected axe violations,
and exactly two A4 pages for the blank notes sheet.

## Files

- `fixtures.js`: invented account values and separately labelled real historical evidence.
- `app.js`: four destinations, seven starting scenarios, onboarding, understanding check,
  definitions, pause/resume and going-live preview. Activity filters retain separate
  decision, order and fill entries; the prototype banner opens a scenario switcher.
  State is memory-only.
- `styles.css`: mobile layout, system light/dark preference, focus states and reduced motion.
- `fonts/`: self-hosted Latin IBM Plex Sans (400/500/600) and Mono (400), from Fontsource
  5.3.0 packages. SIL Open Font License is included.

## Verification and remaining review

Claude's first review is addressed; `REVIEW.md` maps findings to corrections and requests
a follow-up check. Claude reports reconciliation requirement R1 built on 23 September
on `phase-2a-order-settlement`: sent orders are recorded even while paused or stopped.
This is a code status, not a deployment claim. The engine's catch-up timing is
shown: new practice/activation and the seeded paused account can act at the next check.

Chrome checks passed across 112 route/viewport/theme combinations, at 375px and 1440px,
with no script errors, horizontal overflow or outbound requests. Interaction checks cover
pause/resume history, stale values, onboarding, sheets and keyboard focus. Axe checks on
34 screen/theme combinations reported no violations of the selected WCAG A/AA and
best-practice rules. Actual Android devices, assistive-technology usability and invited
participant sessions are still to be tested.

Optional QA scripts require externally installed Playwright and axe-core, without adding
them to the root engine package. Set `PLAYWRIGHT_MODULE` to your Playwright module path
and `AXE_SOURCE` to `axe-core/axe.min.js` if those packages are outside normal resolution.
`BROWSER_CHANNEL` defaults to `chrome`. From the repository root, run:

```text
node prototypes/customer/qa/smoke.cjs
node prototypes/customer/qa/accessibility.cjs
```

Review screenshots are written to the ignored `qa/output/` folder.

## Visual exploration — parked, 23 September 2026

The founder asked to skip 3D avatars for now and return to them later. Do not add the
portraits or picker to this round. Focus on the core screens, typography and interaction
review. The earlier style preference below is retained for a future discussion.

**Founder-selected direction:** soft 3D human profile characters, like Memoji.
Confirmed explicitly in the design discussion on 22 September. This selects a visual
style, not Apple's assets, a specific pack, a purchase or a new profile backend.

Design proposal to explore: one consistent family with varied skin tones, hairstyles,
facial hair and glasses; small portraits in the greeting and larger portraits in Account.
An initial preset picker can be tried with sample-only state. Typography and the exact
avatar pack are still open; no paid asset has been acquired or integrated.

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


## New visual direction and strategy research — 23 September

The founder rejected the previous colours and selected **soft white, bold black and lime**.
`design-lab.html` explores that choice with redesigned Overview, Strategies and Activity,
and a Research-only liquidity/structure proposal. It is a visual concept, not the complete
seven-scenario prototype: account controls, historical evidence and full history link to
the existing prototype. Avatars remain parked. No customer strategy is activated here.

`STRATEGY-RESEARCH-NOTE.md` contains Codex's proposed rules, validation questions and
integration gaps for Claude. All settings are untested hypotheses. The founder intends
to test personally later; no real-order action has been taken or backtest result claimed.

QA for the new concept: nine route/viewport combinations at 375, 768 and 1440 pixels,
plus the research dialog. No selected axe violations, script errors, outbound requests
or horizontal overflow. Verified research dialog focus/Escape and trade-fee disclosure.

Run `node prototypes/customer/qa/redesign.cjs` from the repository root with the
same optional Playwright/axe environment variables above to repeat the concept checks.

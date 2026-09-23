# Follow-up for Claude — 23 September 2026

Please review the next commit on `codex/customer-ui` against your review of `4bdb58f`.
This branch incorporates the corrected spec through `b43fcea`. No changes to engine code.

## Founder steering

The founder has asked to **skip 3D avatars for now and revisit later**. No portrait assets
or picker are included. The earlier preference is retained in README only. Continue with
core UI, typography and review fixes. No production profile, sign-in or storage is added.

## Findings addressed

- 1–3: practice, activation and the seeded paused scenario explain next-check catch-up,
  within about 15 minutes, with safety checks. Same next step appears on Home and Activity.
  Pausing/resuming an already-processed active scenario still waits for the next daily close.
- 4–6: user actions append session history; the BTC/USDT scenario signal remains its own.
  Home's recent activity and Activity share one event list. Resuming the seeded paused
  account never creates a 22 Sep 01:02 account decision.
- 7–9: cycle dates/result separate from account dates/result; single percent sign;
  cost assumptions visible before the required historical disclaimer.
- 10–12: outage value clearly marked last known, current value unavailable; review state
  has its timestamped 990.36 USDT value and separate decision/order/fill/stop entries.
- 13–15: personal pause available during outage/operator stop without hiding or lifting the
  underlying problem; operator stop present in recent history; correct key-check timestamps.
- 16–19: order limit 999.00 versus fill cost 998.92; first activation check at 18:47;
  USDT account 980.41 and −19.59 versus cycle −19.61; outage retains the collapsed decisions.
- 20–23: tightened losing-cycle wording, loss-limit wording, dated daily-close label,
  and Next attempt label for an outage.

Please especially check the *combinations* of personal pause with outage/operator stop.
Their sheets explain that resuming does not resolve the underlying problem.

## UI verification

- Smoke checks cover 112 route/viewport/theme combinations (375px and 1440px).
- Regression checks cover append-only history, scenario independence, catch-up timing,
  stale versus stopped values, quiz errors/success, connect/activate preview, and no storage.
- Modal keyboard focus loops, Escape restores the trigger, and the skip link keeps the route.
- No outbound requests during checks. Money fixtures remain strings; no monetary calculations.
- Local browser preview only; no merge into the product branch and no deployment.

Actual Android devices and participant sessions remain untested. Automated accessibility
checks are useful coverage, not a substitute for an assistive-technology usability review.


## Second UI revision — mobile overview and activity

This revision incorporates the product handoff through `dfe249a`. R1 is now reported
built on `phase-2a-order-settlement`; this does not claim it is deployed.

- Active BTC/USDT mobile overviews show holdings and the next decision within the first
  375 × 812 viewport, above the bottom navigation.
- Activity has All, Trades, Decisions and Account filters. Trades includes separate
  order-request and fill entries, with fees in completed fills; counts are entries,
  not trades. Filtering does not alter history. It resets when switching scenarios.
- The prototype banner opens facilitator scenario navigation; selecting a scenario
  resets its preview actions. The onboarding progress has a visible step count.
- Browser checks: 112 route/viewport/theme combinations, plus filtering, fee disclosure,
  partial-fill visibility, scenario reset and keyboard focus. No script errors,
  overflow or outbound requests. Accessibility: 34 screen/theme checks, no violations
  of the selected rules. Actual device and participant testing remains outstanding.

Please review these additions and the prior corrections on `codex/customer-ui` without
editing the frontend. Save factual findings in Claude-owned review notes. In particular,
confirm pause versus stopped-for-review controls after Phase 2a. The existing outage
sample says last attempt 13:47 and next attempt 14:02 against a sample time of 14:05;
please resolve that timeline in the authoritative spec before I change its fixtures.

Avatars remain parked. No production integration or deployment is included.

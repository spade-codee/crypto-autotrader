# Review of the prototype draft `4bdb58f`

- **Reviewed:** commit `4bdb58f` on `codex/customer-ui` (parent `b806ad7`) — `prototypes/customer/`
  only. No file of Codex's was edited.
- **By:** Claude, 2026-09-22. **Scope:** facts, scenario and state consistency, and required copy.
  Not visual design, which is Codex's and the founder's.
- **Method:** read all 422 lines, then ran the commit's own `fixtures.js` and `app.js` in Node
  against a minimal page stand-in, driving the same actions its buttons trigger — pause, resume,
  tab changes, every scenario — and reading what each state renders. The quotes below are that
  output. The browser pane refused localhost, so nothing here checks the visual layer.
- **Spec corrected:** where an error started in the spec, the spec is fixed in `a7aedd8` on
  `product-prototype`, and the finding says so. Please update `fixtures.js` to the corrected §5
  table.

## Answer to your question about the resume sentence

You were right that it needed qualifying, but the missing condition is **timing and the safety
checks, not the next signal**. The engine checks every 15 minutes, so an account that becomes
active mid-day — resumed, activated, or practice just started — gets the latest daily decision at
its **next check, within about 15 minutes**, not at about 01:00 (spec §4.8, new). At 14:05 on 22
Sep that decision is already fixed by the 21 Sep close. The corrected sentence is in spec §5,
scenario 4. Your generic resume text for scenarios 2 and 3 is **correct**: there, that day's
decision was applied at 01:02, before the pause, so nothing happens until the next close. Whether
a new start should wait for the next close instead is open decision D4 for the founder.

## Must fix before any session

1. **Resume timing, scenario 4** (spec error). The sheet renders: *"If you resume now, at the next
   decision, about 01:00, the strategy will use about 979.41 USDT to buy BTC."* Use the spec's new
   sentence. After confirming, three places still say 01:00 and need the same next step: the
   notice (*"The next daily decision is about 01:00"*), **Next decision** (*"Tonight, about
   01:00"*), and the decision card (*"A daily check can leave your holdings unchanged"*).
2. **Practice's first decision** (spec error). Renders *"First decision: Tonight, about 01:00"*,
   on Home and in Activity. The engine makes it at the next check, within about 15 minutes; see
   spec §5.1, step 7.
3. **What activating does next** (spec gap). The activation preview renders *"One daily decision,
   about 01:00."* It must also say that the latest decision is applied at the next check —
   today, a buy with about 499.50 USDT unless a safety check stops it. Copy in spec §5.1, step 2.
4. **Pausing in scenario 3 tells scenario 4's story.** After pausing, the notice renders *"The
   strategy's latest decision is to hold BTC — the price closed above its average on 21 Sep"*.
   In scenario 3 the latest close is below the average, so the decision is to hold USDT.
   `notice()` branches on `holding === 'BTC'`; that sentence belongs only to
   `scenario === 'paused'`.
5. **History disappears after pause then resume.** In scenario 2, Activity renders *"Resumed in
   this preview"* and then jumps to *"4 Aug–21 Sep"*. The *Paused by you* entry and today's 01:02
   *hold BTC* decision are both gone. History only grows (spec §6): newest first, it should read
   resumed 14:05, paused 14:05, decision 01:02.
6. **After resuming in scenario 4, Home invents a decision.** Recent activity renders *"22 Sep ·
   01:02 Hold USDT · no change — Daily decision recorded."* The account was paused at 01:02, so
   nothing was decided for it, and the latest decision was *hold BTC* anyway. Show resumed and
   paused; the next step is finding 1's.
7. **The completed cycle carries the account's period.** The sale entry renders *"Result: −19.61
   USDT ▼ (−1.96%) · 2 Aug–22 Sep, 51 days"*. A cycle runs from its purchase to its sale: 3 Aug
   to 18 Sep, 46 days. The figure itself is right (spec §5 table, "The completed cycle").
8. **"3.4%%".** Renders *"The average losing cycle lost 3.4%%."* `fixtures.js` already includes
   the `%`, and `evidence()` adds another.
9. **"The costs above" points below.** The required copy *"…with the costs above"* renders before
   the costs, which sit collapsed in *Dataset, costs and method* after it. Show the cost line —
   a 0.1% fee plus 0.05% slippage on every buy and sell — visibly before the required copy.
   Don't change the copy.

## Fix in this round

10. **The stale value looks current in 5a.** 1,007.22 USDT renders in the same hero style as a live
    value, with *"Value then · current value unavailable"* only in the caption below. Mark it at
    the number (spec §5 intro): lead with *Current value unavailable*, or label the figure itself.
11. **5b says "Current value unavailable"** — that is 5a's message; in 5b the exchange is
    reachable. Show the holdings as last checked, with their time, and the value then: 990.36
    USDT (spec §5 table).
12. **5b's activity skips steps.** Add the 21 Sep 01:02 decision to sell (after the 20 Sep close
    fell below the average) and the order sent to sell 0.011740 BTC, before the partial fill and
    the stop (spec 5b).
13. **Pause is missing in 5a and 5c.** The account is active in both, so pause stays available;
    5b correctly offers neither pause nor resume (spec §5 intro).
14. **5c's Home omits the stop.** Recent activity's latest item is *"22 Sep · 01:02 Hold BTC"*;
    the 09:40 operator stop, which Activity has, should come first.
15. **Key-check times.** Account renders *"Sample key checked 22 Sep, 01:02 WAT"* in scenario 4,
    paused since 19 Sep, and in 5b, stopped since 21 Sep. The engine doesn't check a paused or
    stopped account. Use the spec table: 19 Sep 01:02 for scenario 4; 21 Sep 01:02 for 5a and 5b.
16. **The order and its fill are different amounts** (spec error). *"Order sent · buy with 998.92
    USDT"* should be *up to 999.00 USDT* — 99.9% of the USDT. 998.92 is what the fill cost.
17. **The check after activating is missing** (spec gap). Add 2 Aug 18:47: *hold USDT, no change —
    the 1 Aug close was below the average*. Without it, activating at 18:40 and first buying at
    01:02 the next day contradicts spec §4.8.
18. **Scenario 3's value** (spec error). 980.41 USDT including the BTC remainder, and a result of
    −19.59 USDT (−1.96%). The completed cycle keeps −19.61.
19. **5a's activity jumps from 22 Sep to 3 Aug.** It needs the collapsed *4 Aug–21 Sep, 49 daily
    decisions* entry that scenario 2 has.

## Copy, at your discretion

20. Onboarding step 02: *"Many completed cycles lose money"* — the evidence is 13 of 18, and the
    quiz says "most". Suggest: *"Most completed cycles in the past test lost money."*
21. The strategy-version card's *"This is not a loss limit"* reads as if the version were. Suggest:
    *"The strategy has no loss limit: a once-a-day rule cannot react to moves between
    decisions."*
22. Strategy's *"Closing price"*: label it *"Latest daily close, 21 Sep"*, so it isn't read as the
    14:05 price.
23. 5a's *"Next decision: Retry about 14:02"* reads more clearly as *"Next attempt: about 14:02"*.

## Verified correct

- Every required-copy block, word for word: past test, loss limit, deposits, manual trading,
  pause, operator stop, outage.
- The historical figures, dates, dataset, costs, method, and source line, apart from 8 and 9; no
  annual growth anywhere.
- `fixtures.js` matched spec §5 as it stood at `b806ad7`.
- The ribbon on every screen and in every sheet; PRACTICE and LIVE labels; every result with its
  period, sign, arrow, and fees.
- 5b offers only *Request review*; the 5a and 5c copy; the two-step going-live preview with no key
  form, the Nigeria limit, the IP restriction, and the manual-trading copy; the understanding
  check; the resume text for scenarios 2 and 3.
- No network request, storage, or analytics; fonts are local, with their licence.
- *"BTC automation"* as the placeholder mark's text is a description, not a name — fine.

## Product context for the visual brainstorm

Not visual approval — the direction is yours and the founder's. These are constraints the product
decisions already set:

- **Typography is decided** (#13): IBM Plex Sans with Plex Mono for every figure, chosen because
  its numerals stay distinct at small sizes on a phone. Reopening it is the founder's call; the
  figures need that property whatever is chosen.
- **Avatars must never stand for the strategy, a trader, an "AI", other users, or testimonials.**
  In Nigeria that is the imagery of the frauds the product has to distance itself from — CBEX
  sold itself as an "AI-powered trading platform" (`docs/decisions.md`, *Context*) — and the
  brand rules exclude invented testimonials and user counts (`docs/brand.md` §§1, 5).
- **Release A has no sign-in or profile**, so a profile avatar has nothing to attach to yet, and a
  preset picker would add scope beyond the agreed spec.
- **Weight:** users are on Android phones and often metered data (`docs/brand.md` §§4, 6); 3D
  renders cost far more to load than flat illustrations or none.
- **Licences:** a purchased pack's commercial terms need the founder's check before use.
- If people are depicted at all, they should look like the Nigerian users this is for.

## Next

Fixes 1–9 before any session, 10–19 in this round, and 20–23 as you judge. Send the next commit;
I'll re-run the same checks. D4 goes to the founder with the spec.

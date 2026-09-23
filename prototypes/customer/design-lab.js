"use strict";
const F = window.PROTOTYPE;
const main = document.querySelector("main");
const modal = document.querySelector("dialog");
let trigger;
const heading = (k, h, s) =>
  `<div class="page-heading"><div><p class="kicker">${k}</p><h1 tabindex="-1">${h}</h1><p class="subtitle">${s}</p></div><span class="date-pill">22 SEP 2026 · WAT</span></div>`;
const researchBanner = () =>
  `<section class="research-banner"><div><span class="tag">IN RESEARCH · UNTESTED</span><h3>Liquidity + market structure</h3><p>A new idea: wait for a sweep, then confirmation. Being defined and evaluated; not available to activate.</p></div><button class="button" data-research>Explore the idea ↗</button></section>`;
const recent = () =>
  `<section class="card activity-card"><h2 class="sr-only">Latest account activity</h2><div class="activity-row"><span class="activity-mark" aria-hidden="true">↔</span><div><h3>Hold BTC. No change needed.</h3><p>The daily rule kept your position as it is.</p></div><time>22 Sep · 01:02 WAT</time></div><div class="activity-row"><span class="activity-mark" aria-hidden="true">↗</span><div><h3>Bought Bitcoin</h3><p>3 Aug · 01:02 WAT · confirmed fill</p></div><div class="amount mono">${F.buy.quantity} BTC<p>Fee ${F.buy.feeBtc} BTC ≈ ${F.buy.feeUsdt} USDT</p></div></div></section>`;
const views = {
  home: () =>
    heading(
      "YOUR ACCOUNT / OVERVIEW",
      "A clearer picture.",
      "What you hold, what happened, and what comes next.",
    ) +
    `<div class="dashboard-grid"><section class="card balance-card"><div class="card-top"><p class="kicker">ACCOUNT VALUE</p><span class="status">Active · sample</span></div><div class="balance-value">${F.btc.value}<small>USDT</small></div><p class="gain">↗ ${F.btc.result} USDT (${F.btc.percent})</p><p class="period">${F.account.period} · Fees ${F.btc.fees} USDT</p><div class="holding-strip"><div><p>Bitcoin</p><strong><span class="coin-icon" aria-hidden="true">₿</span><span class="mono">${F.btc.btc} BTC</span></strong></div><div><p>Tether</p><strong><span class="coin-icon" aria-hidden="true">₮</span><span class="mono">${F.btc.usdt} USDT</span></strong></div></div><p class="period" style="margin-top:18px">Balances as of ${F.btc.asOf} WAT</p></section><section class="card next-card"><p class="kicker">THE NEXT DAILY DECISION</p><div class="clock">01:00 <span>WAT</span></div><h2>Tonight, about 01:00.</h2><span class="chip">Currently holding BTC</span><p class="muted">The next daily close decides whether to keep BTC or move to USDT. A check does not always mean a trade.</p><a class="button lime" href="#strategies">Understand the rule <span aria-hidden="true">↗</span></a></section></div><div class="section-heading"><h2>Your strategy</h2><a href="index.html#btc/account">Manage automation ↗</a></div><section class="strategy-row"><div class="strategy-emblem" aria-hidden="true">⌁</div><div class="strategy-text"><span class="kicker">MA-125 / VERSION 1</span><h3>One daily rule. BTC or USDT.</h3><p>Spot only · whole dedicated account · can lose money</p></div><a class="button" href="#strategies">View strategy ↗</a></section><div class="section-heading"><h2>Recent activity</h2><a href="#activity">View activity ↗</a></div>` +
    recent() +
    researchBanner(),
  strategies: () =>
    heading(
      "YOUR ACCOUNT / STRATEGIES",
      "Know the rule.",
      "Understand what is running and what is still being researched.",
    ) +
    `<div class="strategy-grid"><section class="card"><span class="tag">CURRENT SAMPLE STRATEGY</span><h2>Daily trend.<br>One clear decision.</h2><p class="muted">Compare Bitcoin’s daily close with its 125-day average. This rule governs every BTC and USDT in the dedicated account.</p><ul class="rules"><li>Above the average → hold BTC</li><li>Below the average → hold USDT</li><li>Many days, no trade is needed</li><li>No loss limit; it can lose money between decisions</li></ul><a class="button dark" href="index.html#btc/strategy">Read the historical evidence ↗</a></section><section class="card research-card"><span class="tag">RESEARCH / UNTESTED</span><h2>Liquidity.<br>Structure. Confirmation.</h2><p class="muted">A proposed strategy that waits for a price-level sweep and a confirmed structure break before considering an entry.</p><ul class="rules"><li>Mechanical rules still being reviewed</li><li>Position sizing and protective exits required</li><li>No verified returns or win rate</li><li>Not available to activate</li></ul><button class="button" data-research>See the proposed sequence ↗</button></section></div><p class="note">Research status is separate from trading availability. This concept page cannot connect an account, switch a strategy or place an order.</p>`,
  activity: () =>
    heading(
      "YOUR ACCOUNT / ACTIVITY",
      "Every move, explained.",
      "A decision, an order request and a confirmed fill are different events.",
    ) +
    recent() +
    `<section class="card" style="margin-top:22px"><p class="kicker">3 AUG · 01:02 WAT</p><details class="trade-details"><summary>Bought BTC · inspect the confirmed fill and fee</summary><dl><dt>Bought</dt><dd class="mono">${F.buy.quantity} BTC</dd><dt>Price</dt><dd class="mono">${F.buy.price} USDT</dd><dt>Cost</dt><dd class="mono">${F.buy.cost} USDT</dd><dt>Exchange fee</dt><dd>${F.buy.feeBtc} BTC<br>≈ ${F.buy.feeUsdt} USDT</dd></dl><p class="note">Sample order reference: ${F.buy.reference}. The 999.00 USDT request limit differs from the filled cost.</p></details><a class="button" href="index.html#btc/activity">Open full sample history ↗</a></section>`,
};
function render() {
  const key = Object.hasOwn(views, location.hash.slice(1))
    ? location.hash.slice(1)
    : "home";
  main.innerHTML = views[key]();
  document.querySelectorAll("[data-nav]").forEach((a) => {
    if (a.dataset.nav === key) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  main.querySelector("h1").focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-research]")) {
    trigger = e.target.closest("[data-research]");
    modal.showModal();
    modal.querySelector(".close").focus();
  }
  if (e.target.closest(".close,.close-research")) modal.close();
  if (e.target.closest(".skip")) {
    e.preventDefault();
    main.focus();
  }
});
modal.addEventListener("close", () => trigger?.isConnected && trigger.focus());
modal.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const first = modal.querySelector(".close"),
    last = modal.querySelector(".close-research");
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});
window.addEventListener("hashchange", () => {
  if (modal.open) modal.close();
  render();
});
render();

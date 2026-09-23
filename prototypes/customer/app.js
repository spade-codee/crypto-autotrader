"use strict";
const F = window.PROTOTYPE;
const app = document.querySelector("#app");
const dialog = document.querySelector("#sheet");
const scenarios = {
  first: [
    "01",
    "First visit",
    "Understand the rule, check the risks, start practice.",
  ],
  btc: [
    "02",
    "Active · holding BTC",
    "Read a decision, find a fee, and pause.",
  ],
  usdt: [
    "03",
    "Active · holding USDT",
    "Understand a sale and money added later.",
  ],
  paused: [
    "04",
    "Paused by you",
    "See what stays the same, then preview resuming.",
  ],
  outage: [
    "05a",
    "Exchange unavailable",
    "Recognise a temporary delay and last-known data.",
  ],
  review: [
    "05b",
    "Stopped for review",
    "Understand a partial fill and request a review.",
  ],
  operator: [
    "05c",
    "Stopped for everyone",
    "Understand an operator-wide stop.",
  ],
};
const paths = {
  home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
  strategy: '<path d="M4 19V5m0 14h16M7 14l4-4 4 2 5-7"/>',
  activity:
    '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="19" cy="18" r="1"/>',
  account:
    '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  shield:
    '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.arrow}</svg>`;
const brand =
  '<span class="mark" aria-hidden="true">∕</span><span>BTC automation</span>';
const button = (text, action, primary = false) =>
  `<button class="button${primary ? " primary" : ""}" data-action="${action}">${text}</button>`;
const kv = (label, value) =>
  `<div class="key-value"><dt>${label}</dt><dd>${value}</dd></div>`;
const definition = (name, label = name) =>
  `<button class="definition" data-definition="${name}">${label}</button>`;
let scenario = "";
let page = "home";
let paused = false;
let resumed = false;
let actionHistory = [];
let activityFilter = "all";
const activityFilters = {
  all: "All",
  trades: "Trades",
  decisions: "Decisions",
  account: "Account",
};
let onboardingStep = 0;
let question = 0;
let modalTrigger;
function data() {
  if (scenario === "practice") return F.practice;
  if (scenario === "outage") return F.outage;
  if (scenario === "review") return F.review;
  return ["usdt", "paused"].includes(scenario) ? F.usdt : F.btc;
}
const isPaused = () => paused;
const mode = () =>
  ["practice", "first"].includes(scenario) ? "PRACTICE" : "LIVE";
function status() {
  if (isPaused()) return "Paused by you";
  return (
    {
      practice: "Waiting for first decision",
      outage: "Decision delayed",
      review: "Stopped for review",
      operator: "Stopped for everyone",
    }[scenario] || "Active"
  );
}
function route() {
  const [next, tab = "home"] = location.hash.slice(1).split("/");
  const valid = Object.hasOwn(scenarios, next) || next === "practice";
  if (next !== scenario) {
    paused = next === "paused";
    resumed = false;
    actionHistory = [];
    activityFilter = "all";
    onboardingStep = 0;
    question = 0;
  }
  scenario = valid ? next : "";
  page = ["home", "strategy", "activity", "account"].includes(tab)
    ? tab
    : "home";
  if (dialog.open) dialog.close();
  render(true);
  window.scrollTo(0, 0);
}
function render(focus = false) {
  if (!scenario) app.innerHTML = facilitator();
  else if (scenario === "first") app.innerHTML = onboarding();
  else app.innerHTML = shell();
  if (focus) app.querySelector("h1")?.focus({ preventScroll: true });
}
function facilitator() {
  return `<main id="content" class="facilitator"><a class="brand" href="#">${brand}</a><div class="eyebrow">Facilitator · customer experience study</div><h1 tabindex="-1">One rule. Seven moments to understand.</h1><p class="muted">Choose a starting point. Each scenario resets to its own invented account.<br>No exchange is connected and nothing is saved between visits.</p><p style="margin-top:18px"><a href="session-guide.html">Open the facilitator guide and printable notes sheet</a></p><div class="scenario-grid">${Object.entries(
    scenarios,
  )
    .map(
      ([key, [n, title, description]]) =>
        `<a class="card scenario-link" href="#${key}/home"><span class="number">${n}</span><div><h2>${title}</h2><p>${description}</p></div></a>`,
    )
    .join(
      "",
    )}</div><div class="callout"><strong>Before you begin</strong><p>“This is a prototype. Every account figure is made up. We’re testing the design, not you. Please think aloud.”</p></div><p class="footnote">Sample date: ${F.account.today}. ${F.account.timezone}.<br>The historical test on Strategy is labelled separately from the invented account figures.</p></main>`;
}
function shell() {
  const live = mode() === "LIVE";
  return `<div class="shell"><aside class="sidebar"><a href="#" class="brand" aria-label="BTC automation · scenario selector">${brand}</a><div><div class="eyebrow">Your account</div><nav class="nav" aria-label="Main navigation">${["home", "strategy", "activity", "account"].map((name) => `<a href="#${scenario}/${name}" ${page === name ? 'aria-current="page"' : ""}>${icon(name)}<span>${name[0].toUpperCase() + name.slice(1)}</span></a>`).join("")}</nav></div><div class="sidebar-bottom"><div class="side-rule">BTC only. One daily decision.<br>Your account, your funds.</div><a href="#">Change sample scenario</a><span>Sample · 22 September 2026<br>${F.account.timezone}</span></div></aside><div class="workspace"><header class="topbar"><a class="brand" href="#">${brand}</a><span class="muted small">${live ? "Dedicated exchange account" : "Learn with pretend money"}</span><div class="account-id"><span class="mode ${live ? "" : "practice"}">${mode()}</span><span class="small muted">${live ? "Bybit " + F.account.id : "Practice account"}</span></div></header><main id="content" class="content">${{ home, strategy, activity, account }[page]()}<p class="footnote">Sample date: 22 Sep 2026 · All times in Lagos (WAT).<br>Prototype only. No account is connected and no order can be placed.</p><a class="mobile-only small" href="#">Change sample scenario</a></main></div></div>`;
}
function title(eyebrow, heading, subtitle, action = "") {
  return `<div class="page-title"><div><div class="eyebrow">${eyebrow}</div><h1 tabindex="-1">${heading}</h1>${subtitle ? `<p class="muted">${subtitle}</p>` : ""}</div>${action}</div>`;
}
function controls() {
  if (isPaused()) return button("Resume", "resume", true);
  if (["btc", "usdt", "paused", "outage", "operator"].includes(scenario))
    return button(icon("pause") + "Pause", "pause");
  return "";
}
function notice() {
  let notices = "";
  if (isPaused()) {
    const since = actionHistory.length ? "22 Sep, 14:05" : "19 Sep, 20:15";
    const context =
      scenario === "paused"
        ? "The strategy’s latest decision is to hold BTC — the price closed above its average on 21 Sep — but nothing is traded while you are paused."
        : data().holding === "BTC"
          ? "Your BTC has not been sold."
          : "The latest daily close is below the average. Your USDT stays as it is.";
    notices +=
      '<section class="notice"><h2>Paused by you since ' +
      since +
      "</h2><p>No new orders while paused. Your holdings stay as they are. " +
      context +
      "</p></section>";
  }
  if (scenario === "outage") {
    notices +=
      '<section class="notice"><h2>We’re waiting to reach Bybit</h2><p>' +
      (isPaused()
        ? "Bybit could not be reached. Today’s decision has not been applied. You have paused the account, so no new orders will be placed if the connection returns. The figures below are last known."
        : F.copy.outage) +
      "</p><p>Last attempt 14:02" +
      (isPaused() ? " · Account paused" : " · Next attempt about 14:17") +
      "</p></section>";
  }
  if (scenario === "review")
    notices +=
      '<section class="notice"><h2>An order needs a review</h2><p>Trading stopped for review on 21 Sep at 01:03. An order to sell your BTC was only partly filled; the exchange cancelled the rest.</p><p>No new orders will be placed until this is reviewed.</p>' +
      button("Request review", "review", true) +
      "</section>";
  if (scenario === "operator")
    notices +=
      '<section class="notice"><h2>Trading is stopped for everyone</h2><p>' +
      F.copy.operator +
      "</p>" +
      (isPaused()
        ? "<p>Your own pause will remain in place even if the operator lifts the stop.</p>"
        : "") +
      "</section>";
  if (resumed && !isPaused()) {
    const next =
      scenario === "paused"
        ? F.copy.resumedPending
        : scenario === "operator"
          ? "Your own pause is lifted, but the operator stop still prevents new orders. Your holdings have not changed."
          : scenario === "outage"
            ? "Your own pause is lifted. Today’s decision is still delayed while Bybit cannot be reached. Your holdings have not changed."
            : "Today’s decision was already applied at 01:02. Your holdings have not changed. The next daily decision is tonight, about 01:00, subject to the latest close and safety checks.";
    notices +=
      '<section class="notice"><h2>Resumed in this preview</h2><p>' +
      next +
      "</p></section>";
  }
  return notices;
}
function holdings() {
  const d = data();
  const stale = ["outage", "review"].includes(scenario);
  let value =
    '<div class="hero-value mono">' + d.value + "<span>USDT</span></div>";
  if (scenario === "outage")
    value =
      '<h2>Current value unavailable</h2><div class="last-known"><span>Last-known value</span><strong class="mono">' +
      d.value +
      " USDT</strong></div>";
  if (scenario === "review")
    value = '<p class="small muted">Value when last checked</p>' + value;
  return (
    '<section class="card"><div class="card-head"><span class="eyebrow">' +
    (scenario === "practice"
      ? "Pretend account value"
      : stale
        ? "Last-known account"
        : "Account value") +
    '</span><span class="status ' +
    (isPaused() || stale || scenario === "operator" ? "warn" : "") +
    '">' +
    status() +
    "</span></div>" +
    value +
    '<p class="period">' +
    (scenario === "practice" ? d.asOf : "Balances as of " + d.asOf + " WAT") +
    (d.lastPrice ? "<br>BTC price then " + d.lastPrice + " USDT" : "") +
    "</p>" +
    (d.result
      ? '<p class="result ' +
        (d.positive ? "positive" : "negative") +
        ' mono">' +
        d.result +
        " USDT " +
        (d.positive ? "▲" : "▼") +
        " (" +
        d.percent +
        ')</p><p class="period">' +
        F.account.period +
        " · fees " +
        d.fees +
        " USDT</p>"
      : "") +
    '<div class="balance-list"><div class="balance-row"><span class="holding-label"><span class="coin">₿</span>Bitcoin</span><span class="mono">' +
    d.btc.replace("<", "&lt;") +
    ' BTC</span></div><div class="balance-row"><span class="holding-label"><span class="coin">₮</span>Tether</span><span class="mono">' +
    d.usdt +
    " USDT</span></div></div>" +
    `<div class="account-summary"><div><span class="small muted">${stale ? "Last recorded holdings" : "Holding"}</span><strong>${d.holding === "BTC + USDT" ? "BTC and USDT" : d.holding}</strong></div><div><span class="small muted">${scenario === "outage" && !isPaused() ? "Next attempt" : "Next decision"}</span><strong>${nextDecision()}</strong></div></div></section>`
  );
}
function nextDecision() {
  if (isPaused()) return "On hold · paused by you";
  if (scenario === "operator") return "On hold · operator stop";
  if (scenario === "review") return "On hold · review required";
  if (scenario === "outage") return "About 14:17";
  if (scenario === "practice" || scenario === "paused")
    return "Next check · within about 15 minutes";
  return "Tonight, about 01:00";
}
function decisionCard() {
  const practice = scenario === "practice";
  const waiting = ["outage", "review"].includes(scenario);
  let heading = "Hold " + data().holding + " · no change";
  let explanation =
    "A daily check can leave your holdings unchanged. That is normal.";
  if (practice) {
    heading = "No decisions yet";
    explanation = F.copy.practiceStart;
  } else if (scenario === "paused") {
    heading = "Latest strategy signal: hold BTC";
    explanation = isPaused()
      ? "A strategy signal is not a trade. This account is paused."
      : F.copy.resumedPending;
  } else if (waiting) {
    heading = "No completed decision today";
    explanation =
      "See the account status above. Last-known figures are not current readings.";
  } else if (isPaused())
    explanation =
      "Today’s decision was applied at 01:02, before you paused. No new orders while paused.";
  const label = practice
    ? "First decision"
    : scenario === "outage" && !isPaused()
      ? "Next attempt"
      : "Next decision";
  return (
    '<section class="card"><div class="card-head"><h2>' +
    (practice ? "Your first decision" : "The daily decision") +
    "</h2>" +
    icon("clock") +
    '</div><div class="signal"><h3>' +
    heading +
    '</h3><p class="muted">' +
    explanation +
    "</p></div><dl>" +
    (!practice && !waiting && scenario !== "paused"
      ? kv("Last decision", "22 Sep, 01:02 WAT")
      : "") +
    kv(label, nextDecision()) +
    '</dl><hr class="divider"><a class="inline-link" href="#' +
    scenario +
    '/strategy">Understand the rule ' +
    icon("arrow") +
    "</a></section>"
  );
}
function home() {
  return `${title(mode() === "PRACTICE" ? "Practice account" : "Your overview", scenario === "practice" ? "A place to practise." : "Your overview.", "Know what’s held. Know what happens next.", controls())}${notice()}<div class="grid"><div class="stack">${holdings()}${decisionCard()}</div><div class="stack"><section class="card"><div class="card-head"><h2>${scenario === "practice" ? "Start with the rule" : "Recent activity"}</h2>${icon("activity")}</div>${scenario === "practice" ? '<p class="muted">You have pretend money and time to understand how this works. There’s no need to connect an account.</p>' : recentActivity()}<hr class="divider"><a class="inline-link" href="#${scenario}/${scenario === "practice" ? "strategy" : "activity"}">${scenario === "practice" ? "Explore the strategy" : "See all activity"} ${icon("arrow")}</a></section><section class="card"><div class="eyebrow">${scenario === "practice" ? "At your own pace" : "Good to know"}</div><h2 style="margin:10px 0">${scenario === "practice" ? "What would going live involve?" : "One account, one strategy."}</h2><p class="muted">${scenario === "practice" ? "Connecting checks the account. Activating is a separate choice." : "The rule applies to every BTC and USDT in the dedicated account, including money added later."}</p>${scenario === "practice" ? button("Preview going live " + icon("arrow"), "connect") : '<button class="text-button" data-action="deposits">What if I add money?</button>'}</section></div></div>`;
}
function recentActivity() {
  if (scenario === "practice")
    return '<p class="muted">' + F.copy.practiceStart + "</p>";
  return (
    '<ol class="timeline">' +
    history()
      .slice(0, 3)
      .map(
        (item) =>
          "<li><time>" +
          item.date +
          "</time><h3>" +
          item.title +
          "</h3><p>" +
          item.summary +
          "</p></li>",
      )
      .join("") +
    "</ol>"
  );
}
function evidence() {
  const e = F.evidence;
  return `<section class="card evidence"><div class="eyebrow">Historical test · real research, not account data</div><h2 style="margin-top:10px">What happened in the past test?</h2><p class="muted small">Out-of-sample · ${e.period}</p><div class="evidence-numbers"><div><div class="evidence-number">${e.losing} / ${e.cycles}</div><small>${definition("completed cycle", "completed buy–sell cycles")} lost money</small></div><div><div class="evidence-number">${e.drawdown}</div><small>Worst ${definition("drop from a peak")} with the strategy</small></div></div><p class="muted">The average losing cycle lost ${e.averageLoss}. A few long trends made up for them. Over the whole test it grew less than simply holding BTC.</p><div class="callout"><strong>Holding BTC: ${e.holdDrawdown} worst drop.</strong><p class="small muted">Strategy: ${e.drawdownPeriod}. Holding BTC: ${e.holdDrawdownPeriod}.</p></div><p class="evidence-costs">${e.costs}</p><div class="callout"><p>${F.copy.past}</p><p>${F.copy.limit}</p></div><details class="disclosure"><summary>Dataset, costs and method</summary><p>${e.data}</p><p>${e.costs}</p><p>A decision at each daily close, filled at the next day’s open. The 125-day average was chosen on 2019–2022 data, before this test period, and not adjusted afterwards.</p><p>Source: project research, phase-0-findings.md. This was a historical simulation, not live trading.</p></details></section>`;
}
function strategy() {
  const current = ["btc", "usdt", "operator", "paused"].includes(scenario);
  const d = scenario === "paused" ? F.btc : data();
  return `${title("The strategy", "A rule, not a prediction.", "BTC only · Spot trading · One decision a day")}${notice()}<div class="grid"><div><section class="card"><div class="card-head"><h2>The 125-day rule</h2><span class="mode">MA-125 · V1</span></div><p class="muted">After each daily close, compare Bitcoin’s closing price with its average over the last 125 days. The strategy moves the whole account at once.</p><div class="rule-steps"><div class="rule-step"><div class="eyebrow">Close above average</div><h3>Hold BTC</h3></div><div class="rule-step"><div class="eyebrow">Close below average</div><h3>Hold USDT</h3></div></div><p class="small muted" style="margin-top:18px">Weeks can pass without a trade. That is normal. Money can be lost, including during fast crashes.</p></section>${evidence()}</div><div class="stack"><section class="card"><div class="eyebrow">${current ? "Latest sample reading" : "Account context"}</div><h2 style="margin:12px 0">${scenario === "paused" ? "Latest signal: hold BTC" : current ? `Why hold ${d.holding}?` : status()}</h2>${current ? `<p class="muted">The closing price is ${d.distance} its average.</p><div class="metric-line ${d.holding === "USDT" ? "below" : ""}" aria-hidden="true"></div><div class="metric-captions"><span>Below average</span><span>Above average</span></div><dl>${kv("Latest daily close, 21 Sep", d.price + " USDT")}${kv("125-day average", d.average + " USDT")}</dl><hr class="divider"><p>A daily close ${d.holding === "BTC" ? "below" : "above"} the average would signal a ${d.holding === "BTC" ? "sale into USDT" : "purchase of BTC"}.</p>` : `<p class="muted">${isPaused() ? "The latest signal is to hold BTC. This account stays as it is while paused." : scenario === "practice" ? F.copy.practiceStart : "The account status takes priority. We do not display an unverified current price."}</p>`}</section><section class="card"><h3>Your strategy version</h3><p class="muted small" style="margin-top:8px">${F.account.version}${scenario === "practice" ? " · practice preview" : " — the version you activated on 2 Aug"}.</p><hr class="divider"><p class="small muted">The strategy has no loss limit: a once-a-day rule cannot react to moves between decisions.</p></section></div></div>`;
}
function entry(date, heading, body) {
  return `<details class="activity-item"><summary><span><time>${date} · WAT</time>${heading}</span></summary><div class="detail-box">${body}</div></details>`;
}
function history() {
  const rows = [...actionHistory];
  const add = (kind, date, title, detail, summary = "") =>
    rows.push({ kind, date, title, detail, summary });
  if (scenario === "operator")
    add(
      "account",
      "22 Sep, 09:40",
      "Operator stopped all accounts",
      F.copy.operator,
      "No new orders while the operator stop is on.",
    );
  if (scenario === "outage")
    add(
      "decisions",
      "22 Sep, 14:02",
      "Could not reach Bybit · retrying",
      F.copy.outage,
      "Today’s decision was delayed.",
    );
  if (scenario === "review") {
    add(
      "account",
      "21 Sep, 01:04",
      "Holdings checked",
      "Holdings: " +
        F.review.btc +
        " BTC and " +
        F.review.usdt +
        " USDT. Value then: " +
        F.review.value +
        " USDT.",
      "Holdings recorded after the partial fill.",
    );
    add(
      "account",
      "21 Sep, 01:03",
      "Trading stopped for review",
      "The exchange cancelled the unfilled remainder. No new orders until review. Reference " +
        F.partial.reference +
        ".",
      "The sale did not complete as expected.",
    );
    add(
      "trades",
      F.partial.date,
      "Sell partly filled",
      "<dl>" +
        kv("Sold", F.partial.quantity + " BTC") +
        kv("Requested", F.partial.requested + " BTC") +
        kv("Price", F.partial.price + " USDT") +
        "</dl>",
      F.partial.quantity + " of " + F.partial.requested + " BTC sold.",
    );
    add(
      "trades",
      "21 Sep, 01:02",
      "Order sent · sell " + F.partial.requested + " BTC",
      "The order was sent, but was not yet a confirmed fill.",
      "Sent and filled are separate events.",
    );
    add(
      "decisions",
      "21 Sep, 01:02",
      "Decision: sell BTC",
      "The 20 Sep close fell below the average.",
      "The rule signalled a move to USDT.",
    );
  } else if (scenario === "paused")
    add(
      "account",
      "19 Sep, 20:15",
      "Paused by you",
      "No new orders while paused. Holdings stay as they are.",
      "No decision was applied to this account on 22 Sep.",
    );
  else if (["btc", "usdt", "operator"].includes(scenario))
    add(
      "decisions",
      "22 Sep, 01:02",
      "Decision: hold " + data().holding + " · no change",
      "Daily decision recorded. No order was needed.",
      "Daily decision recorded.",
    );
  if (["usdt", "paused"].includes(scenario)) {
    add(
      "trades",
      F.sale.date,
      "Sold BTC · one completed losing cycle",
      "<dl>" +
        kv("Sold", F.sale.quantity + " BTC") +
        kv("Price", F.sale.price + " USDT") +
        kv("Proceeds before fee", F.sale.proceeds + " USDT") +
        kv(definition("fee", "Fee"), F.sale.fee + " USDT") +
        "</dl><p>Together with the 3 Aug purchase, this is one " +
        definition("completed cycle") +
        ". Cycle result: " +
        F.cycle.result +
        " USDT ▼ (" +
        F.cycle.percent +
        ") · " +
        F.cycle.period +
        " · fees " +
        F.cycle.fees +
        ' USDT.</p><p class="sample-note">Sample order reference: ' +
        F.sale.reference +
        "</p>",
      F.sale.quantity + " BTC · order filled",
    );
    add(
      "trades",
      F.sale.date,
      "Order sent · sell " + F.sale.quantity + " BTC",
      "The sell order was sent to the exchange before its fill was confirmed.",
      "The order and its fill are recorded separately.",
    );
    add(
      "decisions",
      F.sale.date,
      "Decision: sell BTC",
      "The 17 Sep close fell below the average.",
      "The rule signalled a move to USDT.",
    );
  } else if (["btc", "operator", "outage"].includes(scenario))
    add(
      "decisions",
      "4 Aug–21 Sep",
      "49 daily decisions · no change",
      "The account continued to hold BTC. No new order was needed on these days.",
      "The rule continued to hold BTC.",
    );
  add(
    "trades",
    F.buy.date,
    "Bought BTC · filled",
    "<dl>" +
      kv("Bought", F.buy.quantity + " BTC") +
      kv("Price", F.buy.price + " USDT") +
      kv("Cost", F.buy.cost + " USDT") +
      kv(
        definition("fee", "Fee"),
        F.buy.feeBtc + " BTC ≈ " + F.buy.feeUsdt + " USDT",
      ) +
      '</dl><p class="sample-note">Sample order reference: ' +
      F.buy.reference +
      "</p>",
    F.buy.quantity + " BTC · order filled",
  );
  add(
    "trades",
    F.buy.date,
    "Order sent · buy with up to " + F.buy.orderLimit + " USDT",
    "An order was sent to the exchange. A " +
      definition("pending order") +
      " is not a confirmed fill. Sample reference: " +
      F.buy.reference +
      ".",
    "The order limit and the eventual fill cost are different.",
  );
  add(
    "decisions",
    F.buy.date,
    "Decision: buy BTC",
    "The 2 Aug daily close rose above its 125-day average.",
    "The rule signalled a move to BTC.",
  );
  add(
    "decisions",
    "2 Aug, 18:47",
    "Decision: hold USDT · no change",
    "First check after activating. The 1 Aug close was below the average.",
    "The latest daily decision was applied after activation.",
  );
  add(
    "account",
    F.account.activated,
    "Trading activated by you",
    "Every BTC and USDT in " +
      F.account.id +
      ". " +
      F.account.version +
      ". Starting value " +
      F.account.start +
      " USDT.",
    F.account.version,
  );
  add(
    "account",
    F.account.connected,
    "Account connected",
    "Connection checked and balances read. Connecting did not activate trading.",
    "Nothing traded on connection.",
  );
  return rows;
}
function activity() {
  const rows = scenario === "practice" ? [] : history();
  const visible = rows.filter(
    (item) => activityFilter === "all" || item.kind === activityFilter,
  );
  const filters =
    scenario === "practice"
      ? ""
      : `<div class="activity-toolbar"><div class="activity-filters" role="group" aria-label="Filter activity">${Object.entries(
          activityFilters,
        )
          .map(
            ([key, label]) =>
              `<button data-filter="${key}" aria-pressed="${activityFilter === key}" aria-controls="activity-results">${label}</button>`,
          )
          .join(
            "",
          )}</div><p class="small muted" id="activity-count">${visible.length} entries${activityFilter === "all" ? "" : " · " + activityFilters[activityFilter]}</p></div>`;
  const entries =
    scenario === "practice"
      ? '<div class="callout"><h2>No decisions yet</h2><p>' +
        F.copy.practiceStart +
        "</p><p>This is a static prototype; it will not run a trade.</p></div>"
      : visible.length
        ? visible
            .map((item) => entry(item.date, item.title, item.detail))
            .join("")
        : '<div class="callout"><h2>No matching activity</h2><p>Choose All to see the full account history.</p></div>';
  return (
    title(
      "Your activity",
      "Every decision has a reason.",
      "Decisions, orders and fills are shown separately. Open a filled trade to see its fee.",
    ) +
    filters +
    '<section class="card" id="activity-results" aria-label="Activity entries">' +
    entries +
    "</section>"
  );
}
function account() {
  const practice = scenario === "practice";
  return `${title("Your account", "You stay in control.", "Connection and trading are separate choices.")}<div class="grid"><div class="stack"><section class="card"><div class="card-head"><h2>Connection</h2><span class="mode">${practice ? "NOT CONNECTED" : "SAMPLE ACCOUNT"}</span></div>${practice ? `<p class="muted">No exchange account is needed for practice.</p>${button("Preview connecting", "connect")}` : `<h3>Bybit sub-account ${F.account.id}</h3><p class="muted small">${"Sample key last checked " + F.keyChecked[scenario] + " WAT." + (scenario === "outage" ? " Cannot refresh the connection now." : "")}</p><dl>${kv("Permissions", "Spot trading only")}${kv("Withdrawals", "Off")}${kv("Access", "Restricted to our server")}</dl><p class="sample-note">Prototype only. No key has been entered or checked.</p>`}</section><section class="card"><div class="card-head"><h2>Trading</h2><span class="status ${isPaused() || ["review", "outage", "operator"].includes(scenario) ? "warn" : ""}">${status()}</span></div><p>${practice ? "Practice · pretend money" : `Every BTC and USDT in ${F.account.id}`}</p><p class="muted small">${F.account.version}${practice ? "" : " · activated 2 Aug"}</p><div style="margin-top:18px">${controls()}</div>${scenario === "review" ? button("Request review", "review", true) : ""}<hr class="divider"><p class="muted">${F.copy.manual}</p><details class="disclosure"><summary>What if I add money?</summary><p>${F.copy.deposits}</p></details></section></div><div class="stack"><section class="card"><h2>Preferences</h2><label class="setting-row"><div>Trade updates<span>Mock setting · nothing is sent</span></div><input class="toggle" type="checkbox" checked aria-label="Trade updates, mock setting"></label><div class="setting-row"><div>Time zone<span>Africa/Lagos · WAT (UTC+1)</span></div>${icon("clock")}</div></section><section class="card"><h2>Need a hand?</h2><p class="muted" style="margin-top:12px">Understand a status or a decision before taking the next step.</p><button class="text-button" data-action="help">Get help</button><p class="small muted">Support is a preview. No request leaves this device.</p></section></div></div>`;
}
const questions = [
  {
    title: "Can you lose money with this?",
    choices: [
      "Yes. Losing trades and large drops can happen.",
      "No. The strategy prevents losses.",
    ],
    correct: 0,
    explanation:
      "Yes: most completed cycles in the test lost a little, and large drops can happen. The worst historical drop is not a limit.",
  },
  {
    title: "Which money does it control?",
    choices: [
      "Only the money I first deposited.",
      "Every BTC and USDT in the account I set aside, including money added later.",
    ],
    correct: 1,
    explanation:
      "It controls every BTC and USDT in the dedicated account, including money added later.",
  },
  {
    title: "What happens when you pause?",
    choices: [
      "It sells my Bitcoin into USDT.",
      "No new orders. What I hold stays as it is.",
    ],
    correct: 1,
    explanation:
      "No new orders; what you hold stays as it is. BTC is not sold.",
  },
];
function onboarding() {
  const screens = [
    `<div class="eyebrow">A calmer way to follow a rule</div><h1 tabindex="-1">Less reacting.<br>More understanding.</h1><p class="lead">A simple rule for Bitcoin, in your own exchange account. Start by learning how it behaves.</p><div class="card">${[
      [
        "strategy",
        "One rule for BTC",
        "Spot trading against USDT. No other coins or leverage.",
      ],
      [
        "clock",
        "One decision a day",
        "About 01:00 in Lagos. Many days, no trade is needed.",
      ],
      [
        "shield",
        "Practise before connecting",
        "Use pretend money. The strategy can lose money.",
      ],
    ]
      .map(
        ([i, h, p]) =>
          `<div class="feature-row">${icon(i)}<div><h2>${h}</h2><p>${p}</p></div></div>`,
      )
      .join("")}</div>`,
    `<div class="eyebrow">01 · Understand the rule</div><h1 tabindex="-1">Follow the daily close.</h1><p class="lead">After each daily close, compare Bitcoin’s closing price with its average over the last 125 days.</p><div class="card"><svg class="rule-chart" viewBox="0 0 440 150" role="img" aria-label="Illustration, not market data: a price line crosses above a smoother average line."><path d="M10 120H430M10 70H430M10 20H430" stroke="var(--border)" stroke-dasharray="3 5"/><path d="M10 97C130 97 230 76 430 70" fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="6 5"/><path d="m10 118 35-15 32 8 37-36 30 9 32-31 33 10 33-26 30 15 40-22 40 3 38-22 35 12" fill="none" stroke="currentColor" stroke-width="3"/></svg><p class="small muted">Illustration only · solid: price · dashed: average</p><div class="rule-steps"><div class="rule-step"><div class="eyebrow">Above</div><h2>Hold BTC</h2></div><div class="rule-step"><div class="eyebrow">Below</div><h2>Hold USDT</h2></div></div></div><p class="muted">It moves the whole account at once. It does not predict tomorrow’s price.</p>`,
    `<div class="eyebrow">02 · Know the tradeoffs</div><h1 tabindex="-1">Losses are part of it.</h1><p class="lead">Weeks can pass with no trade. Most completed cycles in the past test lost money. A few long trends made up for those losses in the past test.</p>${evidence()}`,
    `<div class="eyebrow">03 · Know which money</div><h1 tabindex="-1">A dedicated account.<br>The whole balance.</h1><p class="lead">Every BTC and USDT in the exchange account you set aside is controlled by the strategy. Ideally, use a separate sub-account.</p><div class="card"><p>${F.copy.deposits}</p><hr class="divider"><p>${F.copy.manual}</p></div>`,
    `<div class="eyebrow">04 · A quick understanding check</div><h1 tabindex="-1">Make sure it’s clear.</h1><p class="muted">Question ${question + 1} of ${questions.length}. You can try again.</p><form id="quiz"><fieldset><legend>${questions[question].title}</legend>${questions[question].choices.map((choice, n) => `<label class="answer"><input required type="radio" name="answer" value="${n}"><span>${choice}</span></label>`).join("")}</fieldset><p id="quiz-feedback" class="feedback" role="status"></p><button class="button primary wide" type="submit">Check answer</button></form>`,
    `<div class="eyebrow">Ready to practise</div><h1 tabindex="-1">Start with pretend money.</h1><p class="lead">${F.practice.value} pretend USDT. No exchange account, no money moving.</p><div class="card"><div class="eyebrow">Your practice balance</div><div class="hero-value mono">${F.practice.value}<span>USDT</span></div><hr class="divider"><p class="muted">The planned practice product follows the real rule on real prices. This prototype uses fixed sample data and runs no decisions.</p></div>`,
  ];
  return `<main id="content" class="onboard"><div class="onboard-top"><a class="brand" href="#" aria-label="Scenario selector">${brand}</a><span class="mode practice">PRACTICE</span></div><p class="step-label small muted">Step ${onboardingStep + 1} of 6</p><div class="onboard-progress" aria-hidden="true">${screens.map((_, i) => `<span class="${i <= onboardingStep ? "done" : ""}"></span>`).join("")}</div>${screens[onboardingStep]}<div class="onboard-actions">${onboardingStep > 0 ? button("Back", "back") : ""}${onboardingStep === 4 ? "" : button(onboardingStep === 5 ? "Start practice " + icon("arrow") : onboardingStep === 0 ? "Understand the strategy " + icon("arrow") : "Continue " + icon("arrow"), onboardingStep === 5 ? "practice" : "next", true)}</div><p class="sample-note">Prototype · no connection, no real money.</p></main>`;
}
function showDialog(titleText, body, actions = "") {
  if (!dialog.open) modalTrigger = document.activeElement;
  document.querySelector("#sheet-content").innerHTML =
    `<div class="dialog-header"><h2 id="sheet-title">${titleText}</h2><button class="close" data-action="close" aria-label="Close dialog">×</button></div>${body}<div class="dialog-actions">${actions || button("Got it", "close", true)}</div><p class="sample-note">Prototype — sample data, not real results · ${mode()}</p>`;
  if (!dialog.open) dialog.showModal();
  dialog.querySelector(".close").focus();
}
function announce(text) {
  document.querySelector("#announcement").textContent = text;
}
function handleAction(action) {
  const d = data();
  if (action === "close") {
    dialog.close();
    return;
  }
  if (action === "next" || action === "back") {
    onboardingStep += action === "next" ? 1 : -1;
    render(true);
    window.scrollTo(0, 0);
    return;
  }
  if (action === "scenarios") {
    showDialog(
      "Choose a sample scenario",
      `<p>Facilitator controls. Switching scenarios resets the preview’s actions and filters. All account figures are invented.</p><p><a href="session-guide.html" target="_blank" rel="noopener">Facilitator guide and notes sheet ↗</a></p><nav class="scenario-menu" aria-label="Sample scenarios">${Object.entries(
        scenarios,
      )
        .map(
          ([key, [n, name]]) =>
            `<a href="#${key}/home"${scenario === key ? ' aria-current="true"' : ""}><span>${n}</span>${name}</a>`,
        )
        .join("")}</nav>`,
    );
    return;
  }
  if (action === "practice") {
    location.hash = "practice/home";
    return;
  }
  if (action === "pause")
    showDialog(
      "Pause new orders?",
      `<p>${F.copy.pause}</p><div class="callout"><strong>You’ll still hold</strong><p class="mono">${d.btc.replace("<", "&lt;")} BTC · ${d.usdt} USDT</p></div>`,
      button("Keep active", "close") +
        button("Pause automation", "confirm-pause", true),
    );
  if (action === "confirm-pause") {
    if (isPaused() || scenario === "review") return;
    paused = true;
    actionHistory.unshift({
      kind: "account",
      date: "22 Sep, 14:05",
      title: "Paused by you",
      detail: F.copy.pause,
      summary: "No new orders. Holdings unchanged.",
    });
    dialog.close();
    render(true);
    announce("Paused. Your holdings are unchanged.");
  }
  if (action === "resume")
    showDialog(
      "Resume automation?",
      `<p>Your current holdings:</p><div class="callout mono">${d.btc.replace("<", "&lt;")} BTC · ${d.usdt} USDT</div><p style="margin-top:16px">${scenario === "paused" ? F.copy.resumePending : scenario === "outage" ? "Bybit is still unavailable. Resuming allows retries of today’s decision; a trade can happen only after the connection returns and safety checks pass. Holdings are unchanged now." : scenario === "operator" ? "The operator-wide stop remains in place. Resuming your account does not override that stop. No new orders while the stop is on." : "The next decision is tonight, about 01:00. What happens depends on the latest daily close and safety checks. Resuming does not immediately change your holdings."}</p>`,
      button("Stay paused", "close") +
        button("Resume automation", "confirm-resume", true),
    );
  if (action === "confirm-resume") {
    if (!isPaused()) return;
    paused = false;
    resumed = true;
    const next =
      scenario === "paused"
        ? F.copy.resumedPending
        : scenario === "outage"
          ? "Today’s decision remains delayed while Bybit is unavailable."
          : scenario === "operator"
            ? "The operator stop still prevents new orders."
            : "Today’s decision was already applied. Next decision tonight, about 01:00.";
    actionHistory.unshift({
      kind: "account",
      date: "22 Sep, 14:05",
      title: "Resumed in this preview",
      detail: next,
      summary: next,
    });
    dialog.close();
    render(true);
    announce("Resumed in this preview. No trade has been placed.");
  }
  if (action === "deposits")
    showDialog("What if I add money?", `<p>${F.copy.deposits}</p>`);
  if (action === "review")
    showDialog(
      "Request a review",
      `<p>Sample reference <strong class="mono">${F.partial.reference}</strong></p><p>Sold ${F.partial.quantity} of ${F.partial.requested} BTC. The exchange cancelled the rest. New orders remain stopped until the account has been reviewed.</p><div class="callout">Preview only: this shows the information included in a review request. No request has been sent.</div>`,
      button("Back to account", "close", true),
    );
  if (action === "help")
    showDialog(
      "Help with your account",
      "<p>In the product, support would help explain a status or decision. This prototype does not connect to support or send messages.</p><p>You can ask the facilitator about anything unclear.</p>",
    );
  if (action === "connect")
    showDialog(
      "1. Connect an account",
      `<div class="eyebrow">Going-live preview · available in Nigeria</div><ol><li>Create a separate Bybit sub-account.</li><li>Create an API key for spot trading only, with withdrawals disabled and access restricted to our server’s address.</li><li>We check the key and show the balances. Nothing trades.</li></ol><p>${F.copy.manual}</p><div class="callout">No key form in this prototype. Never enter an API key, password or personal details here.</div>`,
      button("Back to practice", "close") +
        button("Preview activation", "activate", true),
    );
  if (action === "activate")
    showDialog(
      "2. Choose whether to activate",
      `<p>After connection, you review exactly which funds the strategy will control:</p><div class="callout"><strong>Every BTC and USDT in ${F.account.id}</strong><p class="mono">${F.preview.btc} BTC · ${F.preview.usdt} USDT (sample)</p></div><p style="margin-top:16px">${F.account.version}. ${F.copy.activationNext} Pausing stops new orders; holdings stay as they are.</p><p>${F.copy.deposits}</p><p>${F.copy.manual}</p><p class="sample-note">Live access would be limited to Nigeria, with US and EU signups blocked. This preview has no signup flow.</p>`,
      button("Back", "connect") +
        button("Confirm in preview", "activated", true),
    );
  if (action === "activated")
    showDialog(
      "Activation preview complete",
      '<p>You’ve seen the difference: connecting checks and reads the account; activating allows the strategy to trade its BTC and USDT.</p><div class="callout">Nothing has been connected or activated. Your practice account is unchanged.</div>',
      button("Return to practice", "close", true),
    );
}
document.addEventListener("click", (event) => {
  if (event.target.closest(".skip")) {
    event.preventDefault();
    const main = document.querySelector("#content");
    main.setAttribute("tabindex", "-1");
    main.focus();
    return;
  }
  const scenarioLink = event.target.closest(".scenario-menu a");
  if (scenarioLink) {
    event.preventDefault();
    scenario = "";
    if (scenarioLink.hash === location.hash) route();
    else location.hash = scenarioLink.hash;
    return;
  }
  const filterTarget = event.target.closest("[data-filter]");
  if (
    filterTarget &&
    Object.hasOwn(activityFilters, filterTarget.dataset.filter)
  ) {
    activityFilter = filterTarget.dataset.filter;
    render();
    app
      .querySelector(`[data-filter="${activityFilter}"]`)
      .focus({ preventScroll: true });
    announce(document.querySelector("#activity-count").textContent);
    return;
  }
  const actionTarget = event.target.closest("[data-action]");
  if (actionTarget) handleAction(actionTarget.dataset.action);
  const definitionTarget = event.target.closest("[data-definition]");
  if (definitionTarget) {
    const definitions = {
      "completed cycle":
        "One purchase of BTC followed by a sale of that BTC back into USDT. A buy that is still being held is not a completed cycle.",
      "drop from a peak":
        "How far an account’s value fell from an earlier high before reaching a new high. The worst past drop is not a limit on future losses.",
      fee: "The exchange’s charge for a filled trade. In these sample purchases it is charged in BTC; in the sample sale it is charged in USDT.",
      "pending order":
        "An order has been sent, but its final result is not yet confirmed. Sent is not the same as filled.",
    };
    showDialog(
      definitionTarget.dataset.definition,
      `<p>${definitions[definitionTarget.dataset.definition]}</p>`,
    );
  }
});
document.addEventListener("submit", (event) => {
  if (event.target.id !== "quiz") return;
  event.preventDefault();
  const selected = new FormData(event.target).get("answer");
  const feedback = document.querySelector("#quiz-feedback");
  if (Number(selected) !== questions[question].correct) {
    feedback.textContent = questions[question].explanation + " Try again.";
    return;
  }
  if (question < questions.length - 1) {
    question++;
    render(true);
    announce("Correct. Next question.");
  } else {
    onboardingStep++;
    render(true);
    window.scrollTo(0, 0);
    announce("Understanding check complete.");
  }
});
dialog.addEventListener("close", () => {
  if (modalTrigger?.isConnected) modalTrigger.focus();
});
dialog.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  const controls = [
    ...dialog.querySelectorAll(
      'button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]',
    ),
  ].filter((element) => element.getClientRects().length > 0);
  const first = controls[0];
  const last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
window.addEventListener("hashchange", route);
route();

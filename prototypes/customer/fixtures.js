// Invented account figures, copied from the approved spec §5. Strings, never money arithmetic.
// Historical test figures are real research, explicitly separated from account fixtures.
window.PROTOTYPE = {
  account: {
    id: "···7f3a",
    connected: "2 Aug, 18:31",
    activated: "2 Aug, 18:40",
    start: "1,000.00",
    version: "MA-125, version 1",
    period: "since 2 Aug · 51 days",
    today: "22 September 2026",
    timezone: "Lagos time · WAT (UTC+1)",
  },
  buy: {
    date: "3 Aug, 01:02",
    quantity: "0.011752",
    price: "85,000.00",
    orderLimit: "999.00",
    cost: "998.92",
    feeBtc: "0.000012",
    feeUsdt: "1.00",
    reference: "SAMPLE-BUY-0803-7F3A",
  },
  sale: {
    date: "18 Sep, 01:02",
    quantity: "0.011740",
    price: "83,500.00",
    proceeds: "980.29",
    fee: "0.98",
    reference: "SAMPLE-SELL-0918-7F3A",
  },
  partial: {
    date: "21 Sep, 01:03",
    quantity: "0.005000",
    requested: "0.011740",
    price: "84,300.00",
    reference: "R-0921-7F3A",
  },
  btc: {
    btc: "0.011740",
    usdt: "1.08",
    value: "1,011.92",
    result: "+11.92",
    percent: "+1.19%",
    fees: "1.00",
    positive: true,
    price: "86,100.00",
    average: "82,400.00",
    distance: "4.5% above",
    holding: "BTC",
    asOf: "22 Sep, 14:05",
  },
  usdt: {
    btc: "< 0.000001",
    usdt: "980.39",
    value: "980.41",
    result: "−19.59",
    percent: "−1.96%",
    fees: "1.98",
    positive: false,
    price: "82,900.00",
    average: "84,500.00",
    distance: "1.9% below",
    holding: "USDT",
    asOf: "22 Sep, 14:05",
  },
  cycle: {
    result: "−19.61",
    percent: "−1.96%",
    period: "3 Aug–18 Sep · 46 days",
    fees: "1.98",
  },
  practice: {
    btc: "0",
    usdt: "1,000.00",
    value: "1,000.00",
    holding: "USDT",
    asOf: "Practice starting balance",
  },
  outage: {
    btc: "0.011740",
    usdt: "1.08",
    value: "1,007.22",
    lastPrice: "85,700.00",
    asOf: "21 Sep, 01:03",
    holding: "BTC",
  },
  review: {
    btc: "0.006740",
    usdt: "422.16",
    value: "990.36",
    asOf: "21 Sep, 01:04",
    holding: "BTC + USDT",
  },
  keyChecked: {
    btc: "22 Sep, 01:02",
    usdt: "22 Sep, 01:02",
    operator: "22 Sep, 01:02",
    paused: "19 Sep, 01:02",
    outage: "21 Sep, 01:02",
    review: "21 Sep, 01:02",
  },
  preview: {
    btc: "0",
    usdt: "500.00",
    resumeBuy: "979.41",
    activateBuy: "499.50",
  },
  evidence: {
    period: "1 January 2023 to 16 September 2026",
    cycles: "18",
    losing: "13",
    averageLoss: "3.4%",
    drawdown: "27.4%",
    holdDrawdown: "53.1%",
    drawdownPeriod: "13 March to 10 October 2024",
    holdDrawdownPeriod: "6 October 2025 to 30 June 2026",
    data: "Bybit BTCUSD inverse perpetual daily candles — the project’s long-history dataset, checked against Bybit’s BTCUSDT spot prices over the 1,900 days both exist (median daily close difference 0.05%).",
    costs:
      "A 0.1% trading fee plus 0.05% slippage on every buy and every sell. Tax, deposit, and withdrawal costs are not included.",
  },
  copy: {
    practiceStart:
      "No decisions yet. The first decision comes at the next check, within about 15 minutes, from the latest daily close. After that, one decision a day, about 01:00.",
    resumePending:
      "If you resume now, the strategy applies today’s decision at its next check, within about 15 minutes. The latest daily close, on 21 Sep, was above the average, so it will use about 979.41 USDT to buy BTC, unless a safety check stops it. After that, one decision a day, about 01:00.",
    resumedPending:
      "Today’s decision has not been applied to this account. At the next check, within about 15 minutes, the strategy will use about 979.41 USDT to buy BTC, unless a safety check stops it. Your holdings have not changed in this preview.",
    activationNext:
      "The strategy applies the latest daily decision at its next check, within about 15 minutes. The latest close is above the average, so it would buy BTC with about 499.50 USDT, unless a safety check stops it. After that, one decision a day, about 01:00.",
    past: "Past test, not a forecast. This is how the rule would have behaved on past prices, with the costs above. It is not a record of real trading and does not predict future results.",
    limit:
      "The worst past drop is not a limit on future losses. A fast crash can fall further before a once-a-day rule reacts, and future markets can behave differently from this period.",
    deposits:
      "Money you add may be traded. BTC or USDT you add to this account may be traded at the next eligible daily decision: added USDT may be used to buy BTC while the strategy holds BTC, and added BTC may be sold while it holds USDT. Small amounts — below the exchange’s minimum order, or too small to change the account’s position — may be left as they are, and nothing is traded if a safety check fails.",
    manual:
      "Please don’t trade in this account yourself. At its next decision the strategy may reverse a trade you make, and an order you leave open can stop the automation until the account is reviewed.",
    pause:
      "Pausing stops new orders. What you hold stays as it is: your BTC is not sold. An order already on its way is still confirmed and recorded. You can resume at any time.",
    operator:
      "Trading is stopped for all accounts by the operator since 22 Sep, 09:40. This isn’t caused by your account. No new orders are placed while the stop is on, and what you hold stays as it is. An order already on its way is still confirmed and recorded. You’ll be told when trading resumes. You don’t need to do anything.",
    outage:
      "Today’s decision is delayed. We couldn’t reach Bybit at 01:02, so nothing has been traded today. We keep trying every 15 minutes until the next daily close, tomorrow about 01:00. If today’s decision still can’t run by then, it is skipped and we’ll tell you. You don’t need to do anything.",
  },
};

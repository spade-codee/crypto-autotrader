import Decimal from 'decimal.js';
import { DEFAULT_COSTS } from '../backtest/costs.js';
import { runBacktest } from '../backtest/engine.js';
import { DAY_MS, isoDate } from '../engine/cycleDate.js';
import { percent } from '../engine/selfCheck.js';
import type { LedgerEvent } from '../ledger/ledger.js';
import type { Candle, CostModel, StrategyFn } from '../types.js';

export type ReportInput = {
  userId: string;
  /** The user's ledger events. */
  events: LedgerEvent[];
  /** Every SIGNAL event. */
  signals: LedgerEvent[];
  holdings: { base: Decimal; quote: Decimal };
  price: Decimal;
  /** Closed daily candles covering the paper period and the strategy's warm-up before it. */
  candles: Candle[];
  strategy: StrategyFn;
  costs: CostModel;
  /** Every DECISION_REPLAY event. */
  replays: LedgerEvent[];
};

export type ReportTrade = { day: string; side: string; qty: string; price: string };

export type Spread = { average: Decimal; worst: Decimal };

export type SelfCheckSummary = {
  decisionsRechecked: number;
  /** Cycle dates whose decision would now differ. */
  changed: string[];
  /** Cycle dates whose data was revised, the decision holding. */
  revised: string[];
  fillsCosted: number;
  againstMarket: Spread | null;
  againstBacktestPrice: Spread | null;
  /** What the backtest assumes one trade costs. */
  assumed: Decimal;
};

export type PaperReport = {
  userId: string;
  openedAt: Date;
  startingQuote: Decimal;
  firstDay: string | null;
  lastDay: string | null;
  daysCompleted: number;
  daysLate: number;
  daysAbandoned: number;
  freezes: number;
  trades: ReportTrade[];
  value: Decimal;
  buyAndHold: Decimal | null;
  /** The backtest's trades over the same days, up to the day before the latest. */
  backtestTrades: Array<{ day: string; side: string }>;
  tradesMatch: boolean;
  signalsChecked: number;
  signalMismatches: string[];
  selfCheck: SelfCheckSummary;
};

/**
 * The paper account's record against buy-and-hold and against the backtest over
 * the same days. The latest day's trade fills at an open that is not yet a
 * closed candle, so trades are compared up to the day before the latest.
 */
export function buildPaperReport(input: ReportInput): PaperReport {
  const opened = input.events.find((e) => e.type === 'ACCOUNT_OPENED');
  if (opened === undefined) {
    throw new Error(`there is no ACCOUNT_OPENED event for "${input.userId}"`);
  }
  const startingQuote = new Decimal(String((opened.payload.balances as Record<string, unknown> | undefined)?.USDT ?? '0'));

  const signals = input.signals.filter(
    (s): s is LedgerEvent & { cycleDate: string } => s.cycleDate !== null && s.occurredAt >= opened.occurredAt,
  );
  const firstDay = signals[0]?.cycleDate ?? null;
  const lastDay = signals[signals.length - 1]?.cycleDate ?? null;

  const trades = input.events
    .filter((e) => e.type === 'ORDER_RESULT' && e.payload.status === 'FILLED')
    .map((e) => ({
      day: e.cycleDate ?? '?',
      side: String(e.payload.side),
      qty: String(e.payload.filledBaseQty),
      price: String(e.payload.avgPrice),
    }));
  const count = (type: string, when: (e: LedgerEvent) => boolean = () => true) =>
    input.events.filter((e) => e.type === type && when(e)).length;

  const value = input.holdings.quote.plus(input.holdings.base.times(input.price));
  const firstClose = signals[0] === undefined ? null : new Decimal(String(signals[0].payload.close));
  const buyAndHold = firstClose === null ? null : startingQuote.div(firstClose).times(input.price);

  const signalMismatches: string[] = [];
  let backtestTrades: Array<{ day: string; side: string }> = [];
  if (firstDay !== null && lastDay !== null) {
    const indexOf = new Map(input.candles.map((c, i) => [isoDate(c.time), i]));
    for (const signal of signals) {
      const i = indexOf.get(signal.cycleDate);
      if (i === undefined) {
        signalMismatches.push(`${signal.cycleDate}: no candle to check it against`);
        continue;
      }
      const expected = input.strategy(input.candles.slice(0, i + 1));
      if (expected !== signal.payload.target) {
        signalMismatches.push(`${signal.cycleDate}: recorded ${String(signal.payload.target)}, but the strategy gives ${expected}`);
      }
    }
    const window = input.candles.filter((c) => c.time <= Date.parse(`${lastDay}T00:00:00Z`));
    const evaluateFrom = Date.parse(`${firstDay}T00:00:00Z`) + DAY_MS;
    if (window.length > 0 && window[window.length - 1]!.time >= evaluateFrom) {
      backtestTrades = runBacktest(window, input.strategy, input.costs, startingQuote, 'backtest', { evaluateFrom }).trades.map(
        (t) => ({ day: isoDate(t.time - DAY_MS), side: t.side }),
      );
    }
  }
  const comparable = trades.filter((t) => lastDay !== null && t.day < lastDay).map((t) => ({ day: t.day, side: t.side }));

  const replays = input.replays.filter((r) => r.occurredAt >= opened.occurredAt);
  const fillCosts = input.events.filter((e) => e.type === 'FILL_COST');
  const spreadOf = (key: string): Spread | null => {
    if (fillCosts.length === 0) {
      return null;
    }
    const values = fillCosts.map((e) => new Decimal(String(e.payload[key])));
    return { average: values.reduce((a, b) => a.plus(b), new Decimal(0)).div(values.length), worst: Decimal.max(...values) };
  };
  const onVerdict = (verdict: string) => replays.filter((r) => r.payload.verdict === verdict).map((r) => r.cycleDate ?? '?');

  return {
    userId: input.userId,
    openedAt: opened.occurredAt,
    startingQuote,
    firstDay,
    lastDay,
    daysCompleted: count('RUN_COMPLETED'),
    daysLate: count('RUN_COMPLETED', (e) => e.payload.late === true),
    daysAbandoned: count('RUN_ABANDONED'),
    freezes: count('FROZEN'),
    trades,
    value,
    buyAndHold,
    backtestTrades,
    tradesMatch: JSON.stringify(comparable) === JSON.stringify(backtestTrades),
    signalsChecked: signals.length,
    signalMismatches,
    selfCheck: {
      decisionsRechecked: replays.length,
      changed: onVerdict('DECISION_CHANGED'),
      revised: onVerdict('DATA_REVISED'),
      fillsCosted: fillCosts.length,
      againstMarket: spreadOf('againstMarket'),
      againstBacktestPrice: spreadOf('againstBacktestPrice'),
      assumed: DEFAULT_COSTS.feeRate.plus(DEFAULT_COSTS.slippageRate),
    },
  };
}

export function formatPaperReport(report: PaperReport): string {
  const lines = [
    `Paper account "${report.userId}", opened ${report.openedAt.toISOString().slice(0, 10)} with ${report.startingQuote.toFixed()} USDT.`,
  ];
  if (report.firstDay === null) {
    lines.push('No runs yet.');
    return lines.join('\n');
  }
  lines.push(
    `Runs from ${report.firstDay} to ${report.lastDay}: ${report.daysCompleted} completed (${report.daysLate} late), ${report.daysAbandoned} abandoned, ${report.freezes} freezes.`,
    `Trades: ${report.trades.length}`,
    ...report.trades.map((t) => `  ${t.day}  ${t.side.padEnd(4)}  ${t.qty} BTC at ${t.price}`),
    `Value now: ${report.value.toFixed(2)} USDT.`,
    report.buyAndHold === null ? '' : `Buy and hold since the first run: ${report.buyAndHold.toFixed(2)} USDT.`,
    report.tradesMatch
      ? `Trades match the backtest over the same days (${report.backtestTrades.length} compared).`
      : `TRADES DIFFER from the backtest. Backtest: ${JSON.stringify(report.backtestTrades)}`,
    report.signalMismatches.length === 0
      ? `Signals match the strategy on all ${report.signalsChecked} days.`
      : `SIGNALS DIFFER on ${report.signalMismatches.length} days:\n  ${report.signalMismatches.join('\n  ')}`,
  );
  const s = report.selfCheck;
  const findings = [
    s.changed.length === 0 ? '' : ` DECISIONS CHANGED on ${s.changed.join(', ')}.`,
    s.revised.length === 0 ? '' : ` Revised data on ${s.revised.join(', ')}, the decision holding.`,
  ].join('');
  lines.push(
    'Self-check',
    `  Decisions rechecked: ${s.decisionsRechecked}.${s.decisionsRechecked > 0 && findings === '' ? ' All held.' : findings}`,
    `  Fills costed: ${s.fillsCosted}.` +
      (s.againstMarket === null
        ? ''
        : ` Against the market: average ${percent(s.againstMarket.average)}, worst ${percent(s.againstMarket.worst)} (the backtest assumes ${percent(s.assumed)}).`),
    s.againstBacktestPrice === null
      ? ''
      : `  Against the backtest's price: average ${percent(s.againstBacktestPrice.average)}, worst ${percent(s.againstBacktestPrice.worst)}.`,
  );
  return lines.filter((line) => line !== '').join('\n');
}

import Decimal from 'decimal.js';
import { runBacktest } from '../backtest/engine.js';
import { DAY_MS, isoDate } from '../engine/cycleDate.js';
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
};

export type ReportTrade = { day: string; side: string; qty: string; price: string };

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
  return lines.filter((line) => line !== '').join('\n');
}

import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { buildPaperReport, formatPaperReport, type ReportInput } from '../../src/app/paperReport.js';
import { isoDate } from '../../src/engine/cycleDate.js';
import type { LedgerEvent, LedgerEventType } from '../../src/ledger/ledger.js';
import { CHOSEN_MA_PERIOD, trendFilter } from '../../src/strategy/trendFilter.js';
import { trendingCandles } from '../helpers/candles.js';

// Rising prices: from candle 124 on, the strategy says LONG every day.
const CANDLES = trendingCandles('2026-01-01', 130, 'up');
const day = (i: number) => isoDate(CANDLES[i]!.time);
const AT = new Date('2026-01-01T00:00:00Z');

let nextId = 1;
function event(type: LedgerEventType, cycleDate: string | null, payload: Record<string, unknown>, userId: string | null = 'founder'): LedgerEvent {
  return { id: nextId++, occurredAt: AT, userId, cycleDate, type, payload };
}

function input(overrides: { buySide?: string; signalOn127?: string } = {}): ReportInput {
  const signals = [126, 127, 128].map((i) =>
    event('SIGNAL', day(i), { target: i === 127 ? (overrides.signalOn127 ?? 'LONG') : 'LONG', close: CANDLES[i]!.close.toFixed() }, null),
  );
  const events = [
    event('ACCOUNT_OPENED', null, { mode: 'paper', balances: { USDT: '1000', BTC: '0' } }),
    event('ORDER_RESULT', day(126), {
      clientOrderId: 'a',
      side: overrides.buySide ?? 'BUY',
      status: 'FILLED',
      filledBaseQty: '0.015958',
      avgPrice: '62606.26',
    }),
    ...[126, 127, 128].map((i) => event('RUN_COMPLETED', day(i), { late: i === 127 })),
  ];
  return {
    userId: 'founder',
    events,
    signals,
    holdings: { base: new Decimal('0.015942'), quote: new Decimal('1') },
    price: CANDLES[129]!.close,
    candles: CANDLES,
    strategy: trendFilter({ maPeriod: CHOSEN_MA_PERIOD }),
    costs: { feeRate: new Decimal('0.001'), slippageRate: new Decimal('0.0001') },
  };
}

describe('buildPaperReport', () => {
  it('counts the days, lists the trades, and values the account', () => {
    const report = buildPaperReport(input());
    expect(report).toMatchObject({
      firstDay: day(126),
      lastDay: day(128),
      daysCompleted: 3,
      daysLate: 1,
      daysAbandoned: 0,
      freezes: 0,
    });
    expect(report.trades).toEqual([{ day: day(126), side: 'BUY', qty: '0.015958', price: '62606.26' }]);
    // 1 USDT + 0.015942 BTC at 62,900.
    expect(report.value.toFixed(4)).toBe('1003.7518');
    // 1,000 USDT of BTC at the first day's close of 62,600, valued at 62,900.
    expect(report.buyAndHold!.toFixed(2)).toBe('1004.79');
  });

  it("matches the backtest's trades over the same days", () => {
    const report = buildPaperReport(input());
    expect(report.backtestTrades).toEqual([{ day: day(126), side: 'BUY' }]);
    expect(report.tradesMatch).toBe(true);
    expect(report.signalMismatches).toEqual([]);
  });

  it('reports a trade that differs from the backtest', () => {
    expect(buildPaperReport(input({ buySide: 'SELL' })).tradesMatch).toBe(false);
  });

  it('reports a recorded signal the strategy would not give', () => {
    const report = buildPaperReport(input({ signalOn127: 'FLAT' }));
    expect(report.signalMismatches).toHaveLength(1);
    expect(report.signalMismatches[0]).toContain(day(127));
  });

  it('handles an account with no runs yet', () => {
    const report = buildPaperReport({ ...input(), signals: [], events: [input().events[0]!] });
    expect(report.firstDay).toBeNull();
    expect(report.tradesMatch).toBe(true);
    expect(formatPaperReport(report)).toContain('No runs yet');
  });
});

describe('formatPaperReport', () => {
  it('reads as a summary', () => {
    const text = formatPaperReport(buildPaperReport(input()));
    expect(text).toContain('3 completed (1 late)');
    expect(text).toContain(`${day(126)}  BUY`);
    expect(text).toContain('Trades match the backtest');
  });
});

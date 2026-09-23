import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_COSTS } from '../../src/backtest/costs.js';
import {
  againstBacktestPrice,
  expensiveFillMessage,
  marketCost,
  percent,
  replayDecision,
  type RecordedSignal,
} from '../../src/engine/selfCheck.js';
import type { OrderState } from '../../src/exchange/trading.js';
import { mean } from '../../src/math.js';
import { CHOSEN_MA_PERIOD, trendFilter } from '../../src/strategy/trendFilter.js';
import type { Candle } from '../../src/types.js';
import { trendingCandles } from '../helpers/candles.js';
import { RULES } from '../helpers/market.js';

const strategy = trendFilter({ maPeriod: CHOSEN_MA_PERIOD });
// Rising prices: the strategy says LONG on the last day, whose close is 50,000 + 199 × 100 = 69,900.
const WINDOW = trendingCandles('2026-01-01', 200, 'up');

/** What the engine would have recorded for the window's last day. */
function recorded(window: Candle[]): RecordedSignal {
  return {
    target: strategy(window),
    close: window[window.length - 1]!.close,
    movingAverage: mean(window.slice(-CHOSEN_MA_PERIOD).map((c) => c.close)),
  };
}

/** The window with one close replaced, as if the exchange revised it. */
function revised(window: Candle[], index: number, close: string): Candle[] {
  const price = new Decimal(close);
  return window.map((c, i) =>
    i === index ? { ...c, close: price, high: Decimal.max(c.high, price), low: Decimal.min(c.low, price) } : c,
  );
}

describe('replayDecision', () => {
  it('holds when nothing has changed', () => {
    expect(replayDecision(WINDOW, recorded(WINDOW), strategy, CHOSEN_MA_PERIOD)?.verdict).toBe('HOLDS');
  });

  it('notices a revised close that leaves the decision as it was', () => {
    const replay = replayDecision(revised(WINDOW, 199, '69901'), recorded(WINDOW), strategy, CHOSEN_MA_PERIOD);
    expect(replay).toMatchObject({ verdict: 'DATA_REVISED', recordedTarget: 'LONG', replayedTarget: 'LONG' });
    expect(replay?.currentClose.toFixed()).toBe('69901');
  });

  it('notices a revised earlier close that moves only the average', () => {
    const replay = replayDecision(revised(WINDOW, 190, '70000'), recorded(WINDOW), strategy, CHOSEN_MA_PERIOD);
    expect(replay?.verdict).toBe('DATA_REVISED');
    expect(replay?.currentClose.equals(replay.recordedClose)).toBe(true);
    expect(replay?.currentAverage.equals(replay.recordedAverage)).toBe(false);
  });

  it('reports a decision the current data would not make', () => {
    const replay = replayDecision(revised(WINDOW, 199, '1000'), recorded(WINDOW), strategy, CHOSEN_MA_PERIOD);
    expect(replay).toMatchObject({ verdict: 'DECISION_CHANGED', recordedTarget: 'LONG', replayedTarget: 'FLAT' });
  });

  it('refuses a window too short to give that day’s decision', () => {
    const short = WINDOW.slice(0, CHOSEN_MA_PERIOD - 1);
    expect(replayDecision(short, recorded(WINDOW), strategy, CHOSEN_MA_PERIOD)).toBeNull();
  });
});

const MID = new Decimal('80000');

/** A buy of 0.01 BTC at 80,008 — 0.01% above the mid — with the 0.1% fee taken in BTC. */
function fill(over: Partial<OrderState> = {}): OrderState {
  return {
    clientOrderId: 'ca1',
    side: 'BUY',
    status: 'FILLED',
    filledBaseQty: new Decimal('0.01'),
    filledQuoteAmount: new Decimal('800.08'),
    avgPrice: new Decimal('80008'),
    fee: new Decimal('0.00001'),
    feeCoin: 'BTC',
    rejectReason: null,
    ...over,
  };
}

describe('marketCost', () => {
  it('costs a buy with its fee in BTC', () => {
    const cost = marketCost(fill(), MID, RULES, DEFAULT_COSTS);
    expect(cost.feeRate.toFixed(6)).toBe('0.001000');
    expect(cost.spreadAndImpact.toFixed(6)).toBe('0.000100');
    expect(cost.againstMarket.toFixed(6)).toBe('0.001100');
    expect(cost.assumed.toFixed(6)).toBe('0.001500');
    expect(cost.tooExpensive).toBe(false);
  });

  it('costs a sell with its fee in USDT', () => {
    const sell = fill({
      side: 'SELL',
      avgPrice: new Decimal('79992'),
      filledQuoteAmount: new Decimal('799.92'),
      fee: new Decimal('0.79992'),
      feeCoin: 'USDT',
    });
    const cost = marketCost(sell, MID, RULES, DEFAULT_COSTS);
    expect(cost.feeRate.toFixed(6)).toBe('0.001000');
    expect(cost.spreadAndImpact.toFixed(6)).toBe('0.000100');
  });

  it('shows a fill better than the mid as a negative spread and impact', () => {
    const better = fill({ avgPrice: new Decimal('79992'), filledQuoteAmount: new Decimal('799.92') });
    expect(marketCost(better, MID, RULES, DEFAULT_COSTS).spreadAndImpact.toFixed(6)).toBe('-0.000100');
  });

  it('costs a partial fill on what filled', () => {
    const partial = fill({
      status: 'PARTIALLY_FILLED_CANCELLED',
      filledBaseQty: new Decimal('0.005'),
      filledQuoteAmount: new Decimal('400.04'),
      fee: new Decimal('0.000005'),
    });
    expect(marketCost(partial, MID, RULES, DEFAULT_COSTS).againstMarket.toFixed(6)).toBe('0.001100');
  });

  it('finds a fill that costs more than the backtest assumes', () => {
    const dear = fill({ avgPrice: new Decimal('80160'), filledQuoteAmount: new Decimal('801.60') });
    const cost = marketCost(dear, MID, RULES, DEFAULT_COSTS);
    expect(cost.againstMarket.toFixed(6)).toBe('0.003000');
    expect(cost.tooExpensive).toBe(true);
    expect(expensiveFillMessage('ca1', cost)).toBe(
      'Self-check: order ca1 cost 0.30% against the market, more than the 0.15% the backtest assumes: fee 0.10%, spread and impact 0.20%.',
    );
  });

  it('refuses a fee in a coin it cannot price', () => {
    expect(() => marketCost(fill({ feeCoin: 'MNT' }), MID, RULES, DEFAULT_COSTS)).toThrow('cannot be priced');
  });
});

describe('againstBacktestPrice', () => {
  it('compares a buy with the open, and adds the fee', () => {
    expect(againstBacktestPrice(fill(), new Decimal('80000'), new Decimal('0.001')).toFixed(6)).toBe('0.001100');
  });

  it('compares a sell the other way round', () => {
    const sell = fill({ side: 'SELL', avgPrice: new Decimal('79992') });
    expect(againstBacktestPrice(sell, new Decimal('80000'), new Decimal('0.001')).toFixed(6)).toBe('0.001100');
  });
});

describe('percent', () => {
  it('writes a fraction as a percentage to two places', () => {
    expect(percent(new Decimal('0.0011'))).toBe('0.11%');
    expect(percent(new Decimal('-0.00015'))).toBe('-0.02%');
  });
});

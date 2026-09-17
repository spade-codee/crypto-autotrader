import Decimal from 'decimal.js';
import { buyFillPrice, feeOn, sellFillPrice } from './costs.js';
import { computeMetrics } from './metrics.js';
import type {
  BacktestResult,
  Candle,
  CostModel,
  EquityPoint,
  StrategyFn,
  TargetState,
  Trade,
} from '../types.js';

export type BacktestOptions = {
  /**
   * Epoch ms. Candles before this time are warm-up: the strategy sees them, so
   * a moving average is already formed on the first evaluated day, but no
   * trades or equity are recorded until this time. Defaults to the first candle.
   */
  evaluateFrom?: number;
};

/**
 * Replays candles through a strategy.
 *
 * Ordering inside the loop is the whole point of this function, and getting it
 * wrong produces a backtest that looks excellent and cannot be reproduced live:
 *
 *   1. Execute any order decided on the PREVIOUS candle, at THIS candle's open.
 *   2. Mark the account to market at THIS candle's close.
 *   3. Decide the target state from history up to and including THIS candle.
 *
 * Because step 3 runs after step 1, a signal can never be acted on before it
 * could have existed. A decision made at a daily close fills at the next open.
 * During warm-up only step 3 runs, so the last warm-up decision executes at
 * the first evaluated open.
 */
export function runBacktest(
  candles: Candle[],
  strategy: StrategyFn,
  costs: CostModel,
  initialCapital: Decimal,
  label: string,
  options: BacktestOptions = {},
): BacktestResult {
  if (candles.length === 0) {
    throw new Error('backtest requires at least one candle');
  }
  const evaluateFrom = options.evaluateFrom ?? candles[0]!.time;
  if (candles[candles.length - 1]!.time < evaluateFrom) {
    throw new Error('no candles at or after evaluateFrom');
  }

  let cash = initialCapital;
  let units = new Decimal(0);
  let state: TargetState = 'FLAT';
  let pending: TargetState | null = null;

  const trades: Trade[] = [];
  const equityCurve: EquityPoint[] = [];

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!;

    if (candle.time < evaluateFrom) {
      // Warm-up: decide only.
      pending = strategy(candles.slice(0, i + 1));
      continue;
    }

    // 1. Execute the previous candle's decision at this candle's open.
    if (pending !== null && pending !== state) {
      if (pending === 'LONG') {
        const fee = feeOn(cash, costs);
        const spendable = cash.minus(fee);
        const price = buyFillPrice(candle.open, costs);
        const quantity = spendable.div(price);

        trades.push({ time: candle.time, side: 'BUY', price, quantity, fee });
        units = quantity;
        cash = new Decimal(0);
      } else {
        const price = sellFillPrice(candle.open, costs);
        const proceeds = units.times(price);
        const fee = feeOn(proceeds, costs);

        trades.push({ time: candle.time, side: 'SELL', price, quantity: units, fee });
        cash = proceeds.minus(fee);
        units = new Decimal(0);
      }
      state = pending;
    }
    pending = null;

    // 2. Mark to market at this candle's close.
    equityCurve.push({
      time: candle.time,
      equity: cash.plus(units.times(candle.close)),
      state,
    });

    // 3. Decide, using history that ends at this candle.
    pending = strategy(candles.slice(0, i + 1));
  }

  return {
    label,
    trades,
    equityCurve,
    metrics: computeMetrics(equityCurve, trades, initialCapital),
  };
}

import Decimal from 'decimal.js';
import type { CostModel } from '../types.js';

/**
 * Bybit spot taker fee is 0.1%. Slippage of 0.05% is a deliberately
 * conservative assumption for BTC/USDT spot at retail size — real slippage on
 * a liquid pair is usually smaller, and a backtest that flatters itself on
 * costs is worthless.
 */
export const DEFAULT_COSTS: CostModel = {
  feeRate: new Decimal('0.001'),
  slippageRate: new Decimal('0.0005'),
};

/** Buying fills above the quoted price. Slippage always works against us. */
export function buyFillPrice(quoted: Decimal, costs: CostModel): Decimal {
  return quoted.times(new Decimal(1).plus(costs.slippageRate));
}

/** Selling fills below the quoted price. Slippage always works against us. */
export function sellFillPrice(quoted: Decimal, costs: CostModel): Decimal {
  return quoted.times(new Decimal(1).minus(costs.slippageRate));
}

/** Exchange fee charged on a notional amount. */
export function feeOn(notional: Decimal, costs: CostModel): Decimal {
  return notional.times(costs.feeRate);
}

import Decimal from 'decimal.js';
import type { InstrumentRules } from '../market/types.js';
import type { TargetState } from '../types.js';
import { accountValue, type Holdings } from './holdings.js';

/** How much of the account may sit in the wrong coin while still counting as at the target. */
export const TARGET_TOLERANCE = new Decimal('0.005');

/**
 * Whether the account is where the target wants it. Judged on TOTAL balances,
 * so funds locked in an order can never make the account look emptier than it
 * is. The allowance absorbs rounding and the buy headroom: whatever is left in
 * the wrong coin must be below the exchange minimum or 0.5% of the account.
 */
export function atTarget(
  target: TargetState,
  holdings: Holdings,
  price: Decimal,
  rules: InstrumentRules,
): boolean {
  const allowance = Decimal.max(rules.minOrderAmt, accountValue(holdings, price).times(TARGET_TOLERANCE));
  const wrongSide = target === 'LONG' ? holdings.quote.total : holdings.base.total.times(price);
  return wrongSide.lte(allowance);
}

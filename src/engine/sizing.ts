import Decimal from 'decimal.js';
import type { InstrumentRules } from '../market/types.js';
import { roundDown } from '../math.js';
import type { TargetState } from '../types.js';
import { accountValue, type Holdings } from './holdings.js';
import { atTarget } from './reconcile.js';

/** A buy spends at most 99.9% of the available quote coin, so it can never exceed the balance. */
export const BUY_HEADROOM = new Decimal('0.001');

export type SizedOrder = { side: 'BUY'; quoteAmount: Decimal } | { side: 'SELL'; baseQty: Decimal };

export type Sizing =
  | { kind: 'AT_TARGET' }
  | { kind: 'TOO_SMALL'; reason: string }
  | { kind: 'ORDER'; order: SizedOrder };

/**
 * The one order that moves the account to the target, if any. All in or all
 * out, from available funds, rounded down to the exchange's steps. See spec
 * section 5.
 */
export function sizeOrder(
  target: TargetState,
  holdings: Holdings,
  price: Decimal,
  rules: InstrumentRules,
): Sizing {
  const minimum = `${rules.minOrderAmt.toFixed()} ${rules.quoteCoin}`;
  if (accountValue(holdings, price).lt(rules.minOrderAmt)) {
    return { kind: 'TOO_SMALL', reason: `the account is worth less than the exchange minimum order of ${minimum}` };
  }
  if (atTarget(target, holdings, price, rules)) {
    return { kind: 'AT_TARGET' };
  }
  if (target === 'LONG') {
    const quoteAmount = roundDown(
      holdings.quote.available.times(new Decimal(1).minus(BUY_HEADROOM)),
      rules.quotePrecision,
    );
    if (quoteAmount.lt(rules.minOrderAmt)) {
      return { kind: 'TOO_SMALL', reason: `the buy would be below the exchange minimum order of ${minimum}` };
    }
    return { kind: 'ORDER', order: { side: 'BUY', quoteAmount } };
  }
  const baseQty = roundDown(holdings.base.available, rules.basePrecision);
  if (baseQty.lt(rules.minOrderQty) || baseQty.times(price).lt(rules.minOrderAmt)) {
    return { kind: 'TOO_SMALL', reason: `the sell would be below the exchange minimum order of ${minimum}` };
  }
  return { kind: 'ORDER', order: { side: 'SELL', baseQty } };
}

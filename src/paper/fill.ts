import Decimal from 'decimal.js';
import type { BookLevel } from '../market/orderBook.js';
import { roundDown } from '../math.js';

export type Fill = {
  filledBaseQty: Decimal;
  filledQuoteAmount: Decimal;
  /** Null when nothing filled. */
  avgPrice: Decimal | null;
  /** False when the book ran out before the order was fully filled. */
  complete: boolean;
};

const ZERO = new Decimal(0);

function result(base: Decimal, quote: Decimal, complete: boolean): Fill {
  return {
    filledBaseQty: base,
    filledQuoteAmount: quote,
    avgPrice: base.isZero() ? null : quote.div(base),
    complete,
  };
}

/**
 * A market buy spending `quoteAmount`, walking the asks from the best price up.
 * Quantities are whole multiples of `basePrecision`, so a remainder too small to
 * buy one more step stays unspent — as on the exchange.
 */
export function fillBuy(asks: BookLevel[], quoteAmount: Decimal, basePrecision: Decimal): Fill {
  let remaining = quoteAmount;
  let base = ZERO;
  let quote = ZERO;
  for (const level of asks) {
    const affordable = roundDown(remaining.div(level.price), basePrecision);
    const qty = Decimal.min(affordable, level.qty);
    if (qty.lte(0)) {
      return result(base, quote, true);
    }
    const cost = qty.times(level.price);
    base = base.plus(qty);
    quote = quote.plus(cost);
    remaining = remaining.minus(cost);
    if (qty.lt(level.qty)) {
      return result(base, quote, true);
    }
  }
  // Every level consumed: complete only if what is left cannot buy one more step.
  const last = asks[asks.length - 1];
  return result(base, quote, last !== undefined && remaining.lt(last.price.times(basePrecision)));
}

/** A market sell of `baseQty`, walking the bids from the best price down. */
export function fillSell(bids: BookLevel[], baseQty: Decimal): Fill {
  let remaining = baseQty;
  let base = ZERO;
  let quote = ZERO;
  for (const level of bids) {
    if (remaining.lte(0)) {
      break;
    }
    const qty = Decimal.min(remaining, level.qty);
    base = base.plus(qty);
    quote = quote.plus(qty.times(level.price));
    remaining = remaining.minus(qty);
  }
  return result(base, quote, remaining.lte(0));
}

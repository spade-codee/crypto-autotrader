import type Decimal from 'decimal.js';

export type BookLevel = { price: Decimal; qty: Decimal };

/** Bids best (highest) first; asks best (lowest) first. */
export type OrderBook = { bids: BookLevel[]; asks: BookLevel[] };

/** Halfway between the best bid and the best ask. */
export function midPrice(book: OrderBook): Decimal {
  const bid = book.bids[0];
  const ask = book.asks[0];
  if (bid === undefined || ask === undefined) {
    throw new Error('the order book is empty on one side');
  }
  return bid.price.plus(ask.price).div(2);
}

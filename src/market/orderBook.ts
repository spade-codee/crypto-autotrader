import type Decimal from 'decimal.js';

export type BookLevel = { price: Decimal; qty: Decimal };

/** Bids best (highest) first; asks best (lowest) first. */
export type BookSides = { bids: BookLevel[]; asks: BookLevel[] };

/** An order book as Bybit served it: which market, and when Bybit generated it. */
export type OrderBook = BookSides & {
  symbol: string;
  /** Epoch milliseconds at which Bybit generated the book — its `ts`. */
  time: number;
};

/**
 * How old a book may be when an order is judged or filled against it. Bybit
 * stamps a book as it serves it, so a fresh one is milliseconds old; five
 * seconds allows for a slow network without trading on yesterday's prices.
 */
export const MAX_BOOK_AGE_MS = 5_000;

/**
 * How far ahead of this machine's clock a book's timestamp may be. A little is
 * clock drift; more means this machine's clock is wrong, which would also make
 * every age check meaningless.
 */
export const MAX_BOOK_CLOCK_AHEAD_MS = 2_000;

/** Halfway between the best bid and the best ask. */
export function midPrice(book: BookSides): Decimal {
  const bid = book.bids[0];
  const ask = book.asks[0];
  if (bid === undefined || ask === undefined) {
    throw new Error('the order book is empty on one side');
  }
  return bid.price.plus(ask.price).div(2);
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/** Why `book` cannot be used to judge or fill an order for `symbol` at `now`, or null when it can. */
export function bookProblem(book: OrderBook, symbol: string, now: number): string | null {
  if (book.symbol !== symbol) {
    return `the order book is for ${book.symbol}, not ${symbol}`;
  }
  const age = now - book.time;
  if (age > MAX_BOOK_AGE_MS) {
    return `the order book is ${seconds(age)} old, and at most ${seconds(MAX_BOOK_AGE_MS)} is accepted`;
  }
  if (-age > MAX_BOOK_CLOCK_AHEAD_MS) {
    return `the order book is stamped ${seconds(-age)} ahead of this machine's clock; check the clock is set automatically`;
  }
  return null;
}

/** Throws unless `book` is for `symbol` and fresh at `now`. */
export function requireUsableBook(book: OrderBook, symbol: string, now: number): void {
  const problem = bookProblem(book, symbol, now);
  if (problem !== null) {
    throw new Error(problem);
  }
}

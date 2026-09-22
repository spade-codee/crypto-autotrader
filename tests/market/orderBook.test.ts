import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  bookProblem,
  MAX_BOOK_AGE_MS,
  MAX_BOOK_CLOCK_AHEAD_MS,
  midPrice,
  requireUsableBook,
} from '../../src/market/orderBook.js';

const level = (price: string, qty = '1') => ({ price: new Decimal(price), qty: new Decimal(qty) });

describe('midPrice', () => {
  it('is halfway between the best bid and the best ask', () => {
    const book = { bids: [level('99'), level('98')], asks: [level('101'), level('102')] };
    expect(midPrice(book).toFixed()).toBe('100');
  });

  it('refuses a book that is empty on either side', () => {
    expect(() => midPrice({ bids: [], asks: [level('101')] })).toThrow('empty');
    expect(() => midPrice({ bids: [level('99')], asks: [] })).toThrow('empty');
  });
});

describe('bookProblem', () => {
  const NOW = 1_789_900_000_000;
  const book = (time: number, symbol = 'BTCUSDT') => ({ symbol, time, bids: [level('99')], asks: [level('101')] });

  it('accepts a fresh book for the market asked for', () => {
    expect(bookProblem(book(NOW - 300), 'BTCUSDT', NOW)).toBeNull();
  });

  it('accepts a book exactly at the age limit, and refuses one a millisecond older', () => {
    expect(bookProblem(book(NOW - MAX_BOOK_AGE_MS), 'BTCUSDT', NOW)).toBeNull();
    expect(bookProblem(book(NOW - MAX_BOOK_AGE_MS - 1), 'BTCUSDT', NOW)).toContain('old');
  });

  it('tolerates a little clock drift, and refuses a book stamped further in the future', () => {
    expect(bookProblem(book(NOW + MAX_BOOK_CLOCK_AHEAD_MS), 'BTCUSDT', NOW)).toBeNull();
    expect(bookProblem(book(NOW + MAX_BOOK_CLOCK_AHEAD_MS + 1), 'BTCUSDT', NOW)).toContain('clock');
  });

  it('refuses a book for another market', () => {
    expect(bookProblem(book(NOW, 'ETHUSDT'), 'BTCUSDT', NOW)).toContain('ETHUSDT, not BTCUSDT');
  });
});

describe('requireUsableBook', () => {
  it('throws the problem, and passes a usable book', () => {
    const NOW = 1_789_900_000_000;
    const stale = { symbol: 'BTCUSDT', time: NOW - 60_000, bids: [level('99')], asks: [level('101')] };
    expect(() => requireUsableBook(stale, 'BTCUSDT', NOW)).toThrow('60.0 s old');
    expect(() => requireUsableBook({ ...stale, time: NOW }, 'BTCUSDT', NOW)).not.toThrow();
  });
});

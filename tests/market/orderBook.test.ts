import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { midPrice } from '../../src/market/orderBook.js';

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

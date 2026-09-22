import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { fillBuy, fillSell } from '../../src/paper/fill.js';

const D = (value: string) => new Decimal(value);
const level = (price: string, qty: string) => ({ price: D(price), qty: D(qty) });
const STEP = D('0.000001');

describe('fillBuy', () => {
  it('fills inside the best level', () => {
    const fill = fillBuy([level('100', '10')], D('50'), STEP);
    expect(fill.filledBaseQty.toFixed()).toBe('0.5');
    expect(fill.filledQuoteAmount.toFixed()).toBe('50');
    expect(fill.avgPrice?.toFixed()).toBe('100');
    expect(fill.complete).toBe(true);
  });

  it('walks up through the levels, paying more at each', () => {
    // 1 BTC at 100, then 55 USDT buys 0.5 at 110.
    const fill = fillBuy([level('100', '1'), level('110', '1')], D('155'), STEP);
    expect(fill.filledBaseQty.toFixed()).toBe('1.5');
    expect(fill.filledQuoteAmount.toFixed()).toBe('155');
    expect(fill.avgPrice?.toFixed(4)).toBe('103.3333');
    expect(fill.complete).toBe(true);
  });

  it('rounds the quantity down to the step, leaving dust unspent', () => {
    const fill = fillBuy([level('3', '100')], D('1'), STEP);
    expect(fill.filledBaseQty.toFixed()).toBe('0.333333');
    expect(fill.filledQuoteAmount.toFixed()).toBe('0.999999');
    expect(fill.complete).toBe(true);
  });

  it('is incomplete when the book runs out', () => {
    const fill = fillBuy([level('100', '1')], D('500'), STEP);
    expect(fill.filledBaseQty.toFixed()).toBe('1');
    expect(fill.filledQuoteAmount.toFixed()).toBe('100');
    expect(fill.complete).toBe(false);
  });

  it('fills nothing from an empty book', () => {
    const fill = fillBuy([], D('100'), STEP);
    expect(fill.filledBaseQty.isZero()).toBe(true);
    expect(fill.avgPrice).toBeNull();
    expect(fill.complete).toBe(false);
  });
});

describe('fillSell', () => {
  it('fills inside the best bid', () => {
    const fill = fillSell([level('100', '10')], D('2'));
    expect(fill.filledBaseQty.toFixed()).toBe('2');
    expect(fill.filledQuoteAmount.toFixed()).toBe('200');
    expect(fill.complete).toBe(true);
  });

  it('walks down through the bids, receiving less at each', () => {
    const fill = fillSell([level('100', '1'), level('90', '1')], D('1.5'));
    expect(fill.filledQuoteAmount.toFixed()).toBe('145');
    expect(fill.avgPrice?.toFixed(4)).toBe('96.6667');
    expect(fill.complete).toBe(true);
  });

  it('is incomplete when the bids run out', () => {
    const fill = fillSell([level('100', '1')], D('3'));
    expect(fill.filledBaseQty.toFixed()).toBe('1');
    expect(fill.complete).toBe(false);
  });
});

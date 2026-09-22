import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  accountValue,
  borrowedCoins,
  holdingsFor,
  lockedCoins,
  type Holdings,
} from '../../src/engine/holdings.js';
import { atTarget } from '../../src/engine/reconcile.js';
import { sizeOrder, type SizedOrder, type Sizing } from '../../src/engine/sizing.js';
import { fillBuy, fillSell } from '../../src/paper/fill.js';
import type { TargetState } from '../../src/types.js';
import { balances, RULES } from '../helpers/market.js';

const D = (value: string) => new Decimal(value);
const PRICE = D('85000');
const hold = (btc: string, usdt: string, options: Parameters<typeof balances>[2] = {}) =>
  holdingsFor(balances(btc, usdt, options), RULES);

/** A sizing as plain text, so assertions never depend on Decimal internals. */
function describeSizing(sizing: Sizing): string {
  if (sizing.kind !== 'ORDER') {
    return sizing.kind;
  }
  return sizing.order.side === 'BUY'
    ? `BUY ${sizing.order.quoteAmount.toFixed()}`
    : `SELL ${sizing.order.baseQty.toFixed()}`;
}

describe('holdingsFor', () => {
  it('separates what can be traded from what the account holds', () => {
    const h = hold('0.5', '100', { lockedBtc: '0.2', lockedUsdt: '10' });
    expect(h.base.available.toFixed()).toBe('0.3');
    expect(h.base.total.toFixed()).toBe('0.5');
    expect(h.quote.available.toFixed()).toBe('90');
    expect(h.quote.total.toFixed()).toBe('100');
  });

  it('treats a missing coin as zero, and ignores coins outside the pair', () => {
    const h = holdingsFor(
      [{ coin: 'ETH', walletBalance: D('3'), locked: D('0'), borrowAmount: D('0') }],
      RULES,
    );
    expect(h.base.total.isZero()).toBe(true);
    expect(h.quote.total.isZero()).toBe(true);
  });

  it('values the account from totals', () => {
    expect(accountValue(hold('0.01', '100', { lockedBtc: '0.01' }), PRICE).toFixed()).toBe('950');
  });
});

describe('borrowedCoins and lockedCoins', () => {
  it('name the coins that are borrowed or locked', () => {
    expect(borrowedCoins(balances('0', '100', { borrowedUsdt: '5' }))).toEqual(['USDT']);
    expect(lockedCoins(hold('1', '100', { lockedBtc: '1' }), RULES)).toEqual(['BTC']);
    expect(lockedCoins(hold('1', '100'), RULES)).toEqual([]);
  });
});

describe('atTarget', () => {
  it('counts an all-USDT account as FLAT, not LONG', () => {
    expect(atTarget('FLAT', hold('0', '1000'), PRICE, RULES)).toBe(true);
    expect(atTarget('LONG', hold('0', '1000'), PRICE, RULES)).toBe(false);
  });

  it('counts an all-BTC account as LONG, not FLAT', () => {
    expect(atTarget('LONG', hold('0.1', '0'), PRICE, RULES)).toBe(true);
    expect(atTarget('FLAT', hold('0.1', '0'), PRICE, RULES)).toBe(false);
  });

  it("tolerates dust below the exchange minimum", () => {
    expect(atTarget('LONG', hold('0.1', '4.99'), PRICE, RULES)).toBe(true);
  });

  it('tolerates up to 0.5% of the account in the wrong coin', () => {
    // 1 BTC at 85,000: 0.5% is 425 USDT.
    expect(atTarget('LONG', hold('1', '425'), PRICE, RULES)).toBe(true);
    expect(atTarget('LONG', hold('1', '430'), PRICE, RULES)).toBe(false);
  });

  it('judges exposure on totals, so locked BTC still counts against FLAT', () => {
    expect(atTarget('FLAT', hold('0.01', '1000', { lockedBtc: '0.01' }), PRICE, RULES)).toBe(false);
  });
});

describe('sizeOrder', () => {
  it('buys with 99.9% of the available USDT, rounded down', () => {
    // 1234.5678901 × 0.999 = 1233.3333222099, rounded down to 7 decimal places.
    expect(describeSizing(sizeOrder('LONG', hold('0', '1234.5678901'), PRICE, RULES))).toBe('BUY 1233.3333222');
  });

  it('sizes a buy from available USDT only', () => {
    const sizing = sizeOrder('LONG', hold('0', '1000', { lockedUsdt: '400' }), PRICE, RULES);
    expect(describeSizing(sizing)).toBe('BUY 599.4');
  });

  it('sells all available BTC, rounded down', () => {
    expect(describeSizing(sizeOrder('FLAT', hold('0.1234567', '0'), PRICE, RULES))).toBe('SELL 0.123456');
  });

  it('does nothing at the target', () => {
    expect(describeSizing(sizeOrder('FLAT', hold('0', '1000'), PRICE, RULES))).toBe('AT_TARGET');
  });

  it('reports an account too small to trade', () => {
    expect(describeSizing(sizeOrder('LONG', hold('0', '3'), PRICE, RULES))).toBe('TOO_SMALL');
  });

  it('reports an order that would fall below the minimum', () => {
    // 5.003 USDT is above the minimum, but 99.9% of it is not.
    expect(describeSizing(sizeOrder('LONG', hold('0', '5.003'), PRICE, RULES))).toBe('TOO_SMALL');
  });
});

describe('the invariant: after any sized order fills, the account is at the target', () => {
  const FEE = D('0.001');

  function afterFill(h: Holdings, order: SizedOrder, price: Decimal): Holdings {
    if (order.side === 'BUY') {
      const fill = fillBuy([{ price: price.times('1.0001'), qty: D('1000') }], order.quoteAmount, RULES.basePrecision);
      const btc = h.base.total.plus(fill.filledBaseQty.times(D('1').minus(FEE)));
      return holdingsFor(balances(btc.toFixed(), h.quote.total.minus(fill.filledQuoteAmount).toFixed()), RULES);
    }
    const fill = fillSell([{ price: price.times('0.9999'), qty: D('1000') }], order.baseQty);
    const usdt = h.quote.total.plus(fill.filledQuoteAmount.times(D('1').minus(FEE)));
    return holdingsFor(balances(h.base.total.minus(fill.filledBaseQty).toFixed(), usdt.toFixed()), RULES);
  }

  const cases: Array<[TargetState, string, string, string]> = [];
  for (const target of ['LONG', 'FLAT'] as const) {
    for (const usdt of ['6', '10', '999.99', '1000', '123456.78']) {
      for (const btc of ['0', '0.000123', '0.5', '3']) {
        for (const price of ['20000', '85530.4']) {
          cases.push([target, usdt, btc, price]);
        }
      }
    }
  }

  it.each(cases)('%s with %s USDT and %s BTC at %s', (target, usdt, btc, priceText) => {
    const price = D(priceText);
    const h = hold(btc, usdt);
    const sizing = sizeOrder(target, h, price, RULES);
    if (sizing.kind === 'ORDER') {
      expect(atTarget(target, afterFill(h, sizing.order, price), price, RULES)).toBe(true);
    } else {
      expect(['AT_TARGET', 'TOO_SMALL']).toContain(sizing.kind);
    }
  });
});

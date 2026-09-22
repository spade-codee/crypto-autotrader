import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { holdingsFor } from '../../src/engine/holdings.js';
import { checkOrder, type RiskContext } from '../../src/engine/riskGuard.js';
import type { SizedOrder } from '../../src/engine/sizing.js';
import { balances, bookAround, RULES, tickerAt } from '../helpers/market.js';

const D = (value: string) => new Decimal(value);
const BUY: SizedOrder = { side: 'BUY', quoteAmount: D('999') };

function context(overrides: Partial<RiskContext> = {}): RiskContext {
  return {
    killSwitchOn: false,
    accountStatus: 'active',
    priorOrderToday: false,
    attempt: 1,
    holdings: holdingsFor(balances('0', '1000'), RULES),
    rules: RULES,
    book: bookAround('85000'),
    ticker: tickerAt('85000'),
    signalClose: D('84000'),
    maxOrderUsdt: null,
    ...overrides,
  };
}

function reasons(order: SizedOrder, ctx: RiskContext): string[] {
  const decision = checkOrder(order, ctx);
  return decision.approved ? [] : decision.reasons;
}

describe('checkOrder', () => {
  it('approves an order that breaks no rule', () => {
    expect(checkOrder(BUY, context())).toEqual({ approved: true });
  });

  const VETOES: Array<[string, Partial<RiskContext>, string]> = [
    ['the kill switch is on', { killSwitchOn: true }, 'kill switch'],
    ['the account is paused', { accountStatus: 'paused' }, 'The account is paused'],
    ['an order already went out today', { priorOrderToday: true }, 'already went'],
    ['this would be a fourth attempt', { attempt: 4 }, 'failed to reach'],
    ['the spread is wide', { book: bookAround('85000', '5', '0.01') }, 'spread'],
    ['the last trade disagrees with the book', { ticker: tickerAt('87000') }, 'last trade'],
    ['the price is far from the signal close', { signalClose: D('60000') }, 'signal used'],
    ['the book is too thin', { book: bookAround('85000', '0.001') }, 'cannot fill'],
    ['the order is above the cap', { maxOrderUsdt: D('500') }, 'cap'],
  ];

  it.each(VETOES)('vetoes a buy when %s', (_name, overrides, fragment) => {
    expect(reasons(BUY, context(overrides)).join(' ')).toContain(fragment);
  });

  it('vetoes spending more than is available', () => {
    expect(reasons({ side: 'BUY', quoteAmount: D('1001') }, context()).join(' ')).toContain('more than the 1000');
  });

  it('vetoes a buy below the minimum', () => {
    expect(reasons({ side: 'BUY', quoteAmount: D('4') }, context()).join(' ')).toContain('minimum order value');
  });

  it('vetoes selling more than is held', () => {
    const ctx = context({ holdings: holdingsFor(balances('0.01', '0'), RULES) });
    expect(reasons({ side: 'SELL', baseQty: D('0.02') }, ctx).join(' ')).toContain('more than the 0.01');
  });

  it('vetoes a sell below the minimum', () => {
    const ctx = context({ holdings: holdingsFor(balances('0.01', '0'), RULES) });
    expect(reasons({ side: 'SELL', baseQty: D('0.00005') }, ctx).join(' ')).toContain('below the exchange minimum');
  });

  it('vetoes a sell above the market order maximum', () => {
    const ctx = context({ holdings: holdingsFor(balances('200', '0'), RULES), book: bookAround('85000', '500') });
    expect(reasons({ side: 'SELL', baseQty: D('121') }, ctx).join(' ')).toContain('maximum market order');
  });

  it('vetoes a crossed book', () => {
    const book = { asks: [{ price: D('84990'), qty: D('5') }], bids: [{ price: D('85010'), qty: D('5') }] };
    expect(reasons(BUY, context({ book })).join(' ')).toContain('best ask is not above');
  });

  it('vetoes an empty book', () => {
    expect(reasons(BUY, context({ book: { asks: [], bids: [] } })).join(' ')).toContain('empty');
  });

  it('vetoes a fill that would average far from the price', () => {
    const book = {
      asks: [
        { price: D('85008.5'), qty: D('0.001') },
        { price: D('90000'), qty: D('10') },
      ],
      bids: [{ price: D('84991.5'), qty: D('5') }],
    };
    expect(reasons(BUY, context({ book })).join(' ')).toContain('average');
  });

  it('lists every rule that fails, not just the first', () => {
    expect(reasons(BUY, context({ killSwitchOn: true, accountStatus: 'frozen' }))).toHaveLength(2);
  });
});

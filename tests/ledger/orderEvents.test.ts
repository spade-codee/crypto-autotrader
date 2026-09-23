import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { OrderState } from '../../src/exchange/trading.js';
import { orderStateFrom } from '../../src/ledger/orderEvents.js';

const FILLED: OrderState = {
  clientOrderId: 'ca0123456789',
  side: 'BUY',
  status: 'FILLED',
  filledBaseQty: new Decimal('0.01174'),
  filledQuoteAmount: new Decimal('998.92'),
  avgPrice: new Decimal('85087.73'),
  fee: new Decimal('0.00001174'),
  feeCoin: 'BTC',
  rejectReason: null,
};

/** What the ledger stores: Decimal#toJSON writes strings, and JSON round-trips. */
const stored = (state: OrderState) => JSON.parse(JSON.stringify({ ...state })) as Record<string, unknown>;

describe('orderStateFrom', () => {
  it('reads a filled order back exactly, with decimals intact', () => {
    const state = orderStateFrom(stored(FILLED));
    expect(state).toEqual(FILLED);
    expect(state.filledBaseQty.equals(FILLED.filledBaseQty)).toBe(true);
  });

  it('reads a rejected order, with its reason and no price', () => {
    const rejected: OrderState = {
      ...FILLED,
      status: 'REJECTED',
      filledBaseQty: new Decimal(0),
      filledQuoteAmount: new Decimal(0),
      avgPrice: null,
      fee: new Decimal(0),
      rejectReason: 'minimum order amount',
    };
    expect(orderStateFrom(stored(rejected))).toEqual(rejected);
  });

  it('refuses a payload that is not a settled order', () => {
    expect(() => orderStateFrom({ clientOrderId: 'ca1', status: 'NOT_PLACED' })).toThrow('NOT_PLACED');
  });
});

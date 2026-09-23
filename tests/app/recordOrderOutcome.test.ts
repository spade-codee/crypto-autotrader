import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { recordOrderOutcome, type Outcome, type RecordDeps } from '../../src/app/recordOrderOutcome.js';
import type { OrderLookup, TradingAccount } from '../../src/exchange/trading.js';
import { Ledger } from '../../src/ledger/ledger.js';
import { useTestDatabase } from '../helpers/database.js';
import { RULES } from '../helpers/market.js';

const database = useTestDatabase();
const AT = new Date('2026-09-22T02:00:00Z');
const ID = 'ca0123456789';

const account = (answer: OrderLookup | (() => never)): TradingAccount => ({
  getBalances: async () => [],
  placeMarketOrder: async () => {
    throw new Error('the command never places an order');
  },
  getOrder: async () => (typeof answer === 'function' ? answer() : answer),
});

async function deps(answer: OrderLookup | (() => never) = { kind: 'NOT_VISIBLE' }): Promise<RecordDeps> {
  const ledger = new Ledger(database());
  await ledger.append({
    occurredAt: new Date('2026-09-22T00:02:00Z'),
    userId: 'founder',
    cycleDate: '2026-09-21',
    type: 'ORDER_INTENT',
    payload: { clientOrderId: ID, intent: 'ENTER_LONG', attempt: 1, side: 'BUY', quoteAmount: '999' },
  });
  return { ledger, account: account(answer), rules: RULES, now: () => AT };
}

const request = {
  userId: 'founder',
  clientOrderId: ID,
  evidence: 'Bybit order history for 21 Sep shows no such order',
};

describe('recordOrderOutcome', () => {
  it('records that an invisible order was never placed, under the intent’s own day', async () => {
    const d = await deps();
    const result = await recordOrderOutcome(d, { ...request, outcome: { status: 'NOT_PLACED' } });
    expect(result).toMatchObject({ status: 'recorded', cycleDate: '2026-09-21' });
    const [recorded] = await d.ledger.ofType('ORDER_RESULT', 'founder');
    expect(recorded).toMatchObject({
      cycleDate: '2026-09-21',
      payload: { clientOrderId: ID, status: 'NOT_PLACED', source: 'operator', evidence: request.evidence },
    });
  });

  it('records a fill with its amounts and a price worked out from them', async () => {
    const d = await deps();
    const result = await recordOrderOutcome(d, {
      ...request,
      outcome: {
        status: 'FILLED',
        base: new Decimal('0.01174'),
        quote: new Decimal('998.92'),
        fee: new Decimal('0.00001174'),
        feeCoin: 'BTC',
      },
    });
    expect(result.status).toBe('recorded');
    const [recorded] = await d.ledger.ofType('ORDER_RESULT', 'founder');
    expect(recorded?.payload).toMatchObject({
      status: 'FILLED',
      side: 'BUY',
      filledBaseQty: '0.01174',
      filledQuoteAmount: '998.92',
      source: 'operator',
    });
    // 998.92 / 0.01174
    expect(new Decimal(String(recorded?.payload.avgPrice)).toFixed(2)).toBe('85086.88');
  });

  it('records a rejection with the evidence as its reason', async () => {
    const d = await deps();
    expect((await recordOrderOutcome(d, { ...request, outcome: { status: 'REJECTED' } })).status).toBe('recorded');
    const [recorded] = await d.ledger.ofType('ORDER_RESULT', 'founder');
    expect(recorded?.payload).toMatchObject({ status: 'REJECTED', filledBaseQty: '0', rejectReason: request.evidence });
  });

  it('refuses when the exchange can see the order', async () => {
    const d = await deps({
      kind: 'FOUND',
      state: {
        clientOrderId: ID,
        side: 'BUY',
        status: 'FILLED',
        filledBaseQty: new Decimal('0.01'),
        filledQuoteAmount: new Decimal('850'),
        avgPrice: new Decimal('85000'),
        fee: new Decimal(0),
        feeCoin: 'BTC',
        rejectReason: null,
      },
    });
    const result = await recordOrderOutcome(d, { ...request, outcome: { status: 'NOT_PLACED' } });
    expect(result.status === 'refused' && result.reason).toContain('can see');
    expect(await d.ledger.ofType('ORDER_RESULT', 'founder')).toHaveLength(0);
  });

  it('refuses when the account proves the order absent', async () => {
    const d = await deps({ kind: 'ABSENT' });
    const result = await recordOrderOutcome(d, { ...request, outcome: { status: 'NOT_PLACED' } });
    expect(result.status === 'refused' && result.reason).toContain('proves');
    expect(await d.ledger.ofType('ORDER_RESULT', 'founder')).toHaveLength(0);
  });

  it('refuses when the exchange cannot be asked', async () => {
    const d = await deps(() => {
      throw new Error('the lookup timed out');
    });
    const result = await recordOrderOutcome(d, { ...request, outcome: { status: 'NOT_PLACED' } });
    expect(result.status === 'refused' && result.reason).toContain('the lookup timed out');
  });

  it('refuses an order that is not waiting for an answer', async () => {
    const d = await deps();
    const result = await recordOrderOutcome(d, { ...request, clientOrderId: 'ca-nothing', outcome: { status: 'NOT_PLACED' } });
    expect(result.status === 'refused' && result.reason).toContain('npm run status');
  });

  it('refuses amounts that cannot be right', async () => {
    const d = await deps();
    const filled: Outcome = {
      status: 'FILLED',
      base: new Decimal('0.01'),
      quote: new Decimal('850'),
      fee: new Decimal(0),
      feeCoin: 'BTC',
    };
    const cases: Outcome[] = [
      { ...filled, base: new Decimal(0) },
      { ...filled, quote: new Decimal(-1) },
      { ...filled, fee: new Decimal(-1) },
      { ...filled, feeCoin: 'ETH' },
    ];
    for (const outcome of cases) {
      expect(await recordOrderOutcome(d, { ...request, outcome })).toMatchObject({ status: 'refused' });
    }
    expect(await d.ledger.ofType('ORDER_RESULT', 'founder')).toHaveLength(0);
  });

  it('refuses without evidence', async () => {
    const d = await deps();
    const result = await recordOrderOutcome(d, { ...request, evidence: '   ', outcome: { status: 'NOT_PLACED' } });
    expect(result.status === 'refused' && result.reason).toContain('what you checked');
  });
});

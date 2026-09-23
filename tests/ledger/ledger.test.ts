import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { ledgerEvents } from '../../src/db/schema.js';
import { Ledger, type NewLedgerEvent } from '../../src/ledger/ledger.js';
import { useTestDatabase } from '../helpers/database.js';

const database = useTestDatabase();
const ledger = () => new Ledger(database());
const AT = new Date('2026-09-22T00:02:00Z');
const DAY_1 = '2026-09-21';
const DAY_2 = '2026-09-22';

const intent = (id: string, day: string): NewLedgerEvent => ({
  occurredAt: AT,
  userId: 'founder',
  cycleDate: day,
  type: 'ORDER_INTENT',
  payload: { clientOrderId: id },
});
const result = (id: string, day: string, status = 'FILLED'): NewLedgerEvent => ({
  occurredAt: AT,
  userId: 'founder',
  cycleDate: day,
  type: 'ORDER_RESULT',
  payload: { clientOrderId: id, status },
});

describe('Ledger', () => {
  it("appends and reads a user's events, oldest first", async () => {
    await ledger().append(intent('a', DAY_1));
    await ledger().append(result('a', DAY_1));
    const events = await ledger().forUser('founder');
    expect(events.map((e) => e.type)).toEqual(['ORDER_INTENT', 'ORDER_RESULT']);
    expect(events[0]!.id).toBeLessThan(events[1]!.id);
  });

  it('stores decimals as exact strings', async () => {
    await ledger().append({ ...intent('a', DAY_1), payload: { clientOrderId: 'a', amount: new Decimal('0.000123') } });
    const [event] = await ledger().forUser('founder');
    expect(event!.payload.amount).toBe('0.000123');
  });

  it("keeps everyone's events apart from a user's", async () => {
    await ledger().append({ occurredAt: AT, userId: null, cycleDate: DAY_1, type: 'SIGNAL', payload: { target: 'LONG' } });
    expect(await ledger().forUser('founder')).toEqual([]);
    expect((await ledger().signalFor(DAY_1))?.payload.target).toBe('LONG');
    expect(await ledger().signalFor(DAY_2)).toBeNull();
  });

  it('finds outstanding intents from any day, oldest first', async () => {
    await ledger().append(intent('a', DAY_1));
    await ledger().append(result('a', DAY_1));
    await ledger().append(intent('b', DAY_1));
    await ledger().append(intent('c', DAY_2));
    const outstanding = await ledger().outstandingIntents('founder');
    expect(outstanding.map((e) => e.payload.clientOrderId)).toEqual(['b', 'c']);
  });

  it("pairs each day's intents with their results", async () => {
    await ledger().append(intent('a', DAY_1));
    await ledger().append(result('a', DAY_1, 'NOT_PLACED'));
    await ledger().append(intent('b', DAY_1));
    const orders = await ledger().ordersOn('founder', DAY_1);
    expect(orders.map((o) => [o.intent.payload.clientOrderId, o.result?.payload.status ?? null])).toEqual([
      ['a', 'NOT_PLACED'],
      ['b', null],
    ]);
    expect(await ledger().ordersOn('founder', DAY_2)).toEqual([]);
  });

  it('lists the events of one type', async () => {
    await ledger().append(intent('a', DAY_1));
    await ledger().append(intent('b', DAY_2));
    expect(await ledger().ofType('ORDER_INTENT', 'founder')).toHaveLength(2);
    expect(await ledger().ofType('ORDER_INTENT', null)).toHaveLength(0);
  });

  it('lists the events of one type between two days, for everyone, oldest first', async () => {
    const replay = (day: string): NewLedgerEvent => ({
      occurredAt: AT,
      userId: null,
      cycleDate: day,
      type: 'DECISION_REPLAY',
      payload: { verdict: 'HOLDS' },
    });
    await ledger().append(replay('2026-09-19'));
    await ledger().append(replay(DAY_1));
    await ledger().append(replay(DAY_2));
    await ledger().append({ occurredAt: AT, userId: 'founder', cycleDate: DAY_1, type: 'FILL_COST', payload: { clientOrderId: 'a' } });

    const between = await ledger().ofTypeBetween('DECISION_REPLAY', '2026-09-20', DAY_2);
    expect(between.map((e) => e.cycleDate)).toEqual([DAY_1, DAY_2]);
    expect(await ledger().ofTypeBetween('FILL_COST', DAY_1, DAY_1)).toHaveLength(1);
  });

  it('refuses an event type it does not know', async () => {
    await database().insert(ledgerEvents).values({ ...intent('a', DAY_1), type: 'BOGUS' });
    await expect(ledger().forUser('founder')).rejects.toThrow('unknown ledger event type');
  });
});

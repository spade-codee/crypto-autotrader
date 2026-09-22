import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { cycleRuns, ledgerEvents, paperBalances } from '../../src/db/schema.js';
import { emptyAllTables, useTestDatabase } from '../helpers/database.js';

const database = useTestDatabase();
const AT = new Date('2026-09-22T00:02:00Z');

const event = (type: string, clientOrderId?: string) => ({
  occurredAt: AT,
  userId: 'founder',
  cycleDate: '2026-09-21',
  type,
  payload: clientOrderId === undefined ? {} : { clientOrderId },
});

describe('ledger_events', () => {
  it('accepts new events', async () => {
    await database().insert(ledgerEvents).values(event('SIGNAL'));
    expect(await database().select().from(ledgerEvents)).toHaveLength(1);
  });

  it('rejects an update', async () => {
    await database().insert(ledgerEvents).values(event('SIGNAL'));
    await expect(database().update(ledgerEvents).set({ type: 'CHANGED' })).rejects.toThrow();
  });

  it('rejects a delete', async () => {
    await database().insert(ledgerEvents).values(event('SIGNAL'));
    await expect(database().delete(ledgerEvents)).rejects.toThrow();
  });

  it('rejects a truncate', async () => {
    await database().insert(ledgerEvents).values(event('SIGNAL'));
    await expect(database().execute(sql`TRUNCATE ledger_events`)).rejects.toThrow();
  });

  it('stays protected after the test helper empties it', async () => {
    await database().insert(ledgerEvents).values(event('SIGNAL'));
    await emptyAllTables(database());
    expect(await database().select().from(ledgerEvents)).toHaveLength(0);
    await database().insert(ledgerEvents).values(event('SIGNAL'));
    await expect(database().delete(ledgerEvents)).rejects.toThrow();
  });

  it('holds each client order ID to one intent and one result', async () => {
    await database().insert(ledgerEvents).values(event('ORDER_INTENT', 'ca1'));
    await expect(database().insert(ledgerEvents).values(event('ORDER_INTENT', 'ca1'))).rejects.toThrow();
    await database().insert(ledgerEvents).values(event('ORDER_RESULT', 'ca1'));
    await expect(database().insert(ledgerEvents).values(event('ORDER_RESULT', 'ca1'))).rejects.toThrow();
    await database().insert(ledgerEvents).values(event('ORDER_INTENT', 'ca2'));
    expect(await database().select().from(ledgerEvents)).toHaveLength(3);
  });

  it('returns cycle dates as YYYY-MM-DD strings', async () => {
    await database().insert(ledgerEvents).values(event('SIGNAL'));
    const [row] = await database().select().from(ledgerEvents);
    expect(row!.cycleDate).toBe('2026-09-21');
  });
});

describe('amount columns', () => {
  it('keep eighteen decimal places exactly', async () => {
    await database().insert(paperBalances).values({ userId: 'founder', coin: 'BTC', free: '0.123456789012345678' });
    const [row] = await database().select().from(paperBalances);
    expect(row!.free).toBe('0.123456789012345678');
  });
});

describe('cycle_runs', () => {
  it('allows one row per day and user', async () => {
    const run = { cycleDate: '2026-09-21', userId: 'founder', status: 'pending', attempts: 1, firstAttemptAt: AT };
    await database().insert(cycleRuns).values(run);
    await expect(database().insert(cycleRuns).values(run)).rejects.toThrow();
  });
});

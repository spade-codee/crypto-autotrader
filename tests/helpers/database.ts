import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { openDatabase, type Database } from '../../src/db/client.js';
import {
  accountState,
  alertLog,
  cycleRuns,
  exchangeCredentials,
  ledgerEvents,
  paperBalances,
  paperOrders,
} from '../../src/db/schema.js';

/**
 * Empties every table. The ledger refuses deletes by design, so its triggers
 * are switched off just long enough to empty it — something only test code does.
 */
export async function emptyAllTables(db: Database): Promise<void> {
  await db.delete(exchangeCredentials);
  await db.delete(accountState);
  await db.delete(cycleRuns);
  await db.delete(alertLog);
  await db.delete(paperBalances);
  await db.delete(paperOrders);
  await db.execute(sql`ALTER TABLE ledger_events DISABLE TRIGGER USER`);
  try {
    await db.delete(ledgerEvents);
  } finally {
    await db.execute(sql`ALTER TABLE ledger_events ENABLE TRIGGER USER`);
  }
}

/**
 * One in-memory database for a whole test file, emptied before every test.
 *
 * Starting PGlite takes several seconds. A fresh database per test made a single
 * seven-test file take 30 seconds — slow enough to discourage running the suite.
 * Emptying the tables keeps each test independent at a fraction of the cost.
 * Call at the top level of a test file, then use `database()` inside tests.
 */
export function useTestDatabase(): () => Database {
  let opened: { db: Database; close: () => Promise<void> } | undefined;

  beforeAll(async () => {
    opened = await openDatabase();
  });
  beforeEach(async () => {
    await emptyAllTables(opened!.db);
  });
  afterAll(async () => {
    await opened?.close();
  });

  return () => {
    if (opened === undefined) {
      throw new Error('useTestDatabase() must be called at the top level of a test file');
    }
    return opened.db;
  };
}

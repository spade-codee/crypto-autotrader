import { asc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { accountState, ledgerEvents } from '../db/schema.js';
import type { AccountStatus } from '../types.js';

export type AccountRecord = {
  userId: string;
  status: AccountStatus;
  reason: string | null;
  updatedAt: Date;
};

function toRecord(row: typeof accountState.$inferSelect): AccountRecord {
  const status: AccountStatus = row.frozen ? 'frozen' : row.paused ? 'paused' : 'active';
  return { userId: row.userId, status, reason: row.frozen ? row.frozenReason : row.pausedReason, updatedAt: row.updatedAt };
}

/**
 * Whether each account may trade. Accounts are created with the paper account
 * (PaperAccount.open). Every change is written to the ledger in the same
 * transaction, so the track record can always explain the current state.
 */
export class AccountStates {
  constructor(private readonly db: Database) {}

  async all(): Promise<AccountRecord[]> {
    const rows = await this.db.select().from(accountState).orderBy(asc(accountState.userId));
    return rows.map(toRecord);
  }

  async get(userId: string): Promise<AccountRecord | null> {
    const rows = await this.db.select().from(accountState).where(eq(accountState.userId, userId));
    return rows[0] === undefined ? null : toRecord(rows[0]);
  }

  /** Stops an account trading after something the engine did not understand. Already frozen: no change. */
  async freeze(userId: string, cycleDate: string | null, reason: string, at: Date): Promise<void> {
    const current = await this.#require(userId);
    if (current.status === 'frozen') {
      return;
    }
    await this.#change(userId, { frozen: true, frozenReason: reason }, 'FROZEN', cycleDate, at, { reason });
  }

  /** Lifting a freeze needs a person, and a reason that goes on the record. */
  async unfreeze(userId: string, reason: string, at: Date): Promise<void> {
    if (reason.trim() === '') {
      throw new Error('unfreezing needs a reason');
    }
    const current = await this.#require(userId);
    if (current.status !== 'frozen') {
      throw new Error(`"${userId}" is ${current.status}, not frozen`);
    }
    await this.#change(userId, { frozen: false, frozenReason: null }, 'UNFROZEN', null, at, { reason: reason.trim() });
  }

  async pause(userId: string, reason: string | null, at: Date): Promise<void> {
    const current = await this.#require(userId);
    if (current.status !== 'active') {
      throw new Error(`"${userId}" is ${current.status}; only an active account can be paused`);
    }
    await this.#change(userId, { paused: true, pausedReason: reason }, 'PAUSED', null, at, { reason });
  }

  async resume(userId: string, at: Date): Promise<void> {
    const current = await this.#require(userId);
    if (current.status !== 'paused') {
      throw new Error(`"${userId}" is ${current.status}, not paused`);
    }
    await this.#change(userId, { paused: false, pausedReason: null }, 'RESUMED', null, at, { reason: null });
  }

  async #require(userId: string): Promise<AccountRecord> {
    const record = await this.get(userId);
    if (record === null) {
      throw new Error(`there is no account for "${userId}"; run npm run paper:init`);
    }
    return record;
  }

  async #change(
    userId: string,
    fields: Partial<typeof accountState.$inferInsert>,
    type: 'FROZEN' | 'UNFROZEN' | 'PAUSED' | 'RESUMED',
    cycleDate: string | null,
    at: Date,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.update(accountState).set({ ...fields, updatedAt: at }).where(eq(accountState.userId, userId));
      await tx.insert(ledgerEvents).values({ occurredAt: at, userId, cycleDate, type, payload });
    });
  }
}

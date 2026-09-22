import { and, asc, eq, lt } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { cycleRuns } from '../db/schema.js';

export type RunStatus = 'pending' | 'completed' | 'frozen' | 'abandoned';

export type CycleRun = {
  cycleDate: string;
  userId: string;
  status: RunStatus;
  attempts: number;
  firstAttemptAt: Date;
  completedAt: Date | null;
  late: boolean;
  lastError: string | null;
};

const STATUSES: readonly string[] = ['pending', 'completed', 'frozen', 'abandoned'];

function toRun(row: typeof cycleRuns.$inferSelect): CycleRun {
  if (!STATUSES.includes(row.status)) {
    throw new Error(`unknown run status "${row.status}"`);
  }
  return { ...row, status: row.status as RunStatus };
}

/**
 * Where each day's run stands, per user: what the next tick needs to know. The
 * history of what happened lives in the ledger.
 */
export class CycleRuns {
  constructor(private readonly db: Database) {}

  async get(cycleDate: string, userId: string): Promise<CycleRun | null> {
    const rows = await this.db.select().from(cycleRuns).where(this.#key(cycleDate, userId));
    return rows[0] === undefined ? null : toRun(rows[0]);
  }

  /**
   * Counts an attempt at a day's run, creating it as pending on the first. A
   * frozen run goes back to pending: its account was unfrozen, so the day's run
   * resumes. Completed and abandoned runs never restart.
   */
  async startAttempt(cycleDate: string, userId: string, at: Date): Promise<CycleRun> {
    const existing = await this.get(cycleDate, userId);
    if (existing === null) {
      await this.db.insert(cycleRuns).values({ cycleDate, userId, status: 'pending', attempts: 1, firstAttemptAt: at });
    } else {
      if (existing.status === 'completed' || existing.status === 'abandoned') {
        throw new Error(`the ${cycleDate} run for "${userId}" is ${existing.status} and cannot restart`);
      }
      await this.db
        .update(cycleRuns)
        .set({ status: 'pending', attempts: existing.attempts + 1 })
        .where(this.#key(cycleDate, userId));
    }
    return (await this.get(cycleDate, userId))!;
  }

  async recordError(cycleDate: string, userId: string, error: string): Promise<void> {
    await this.db.update(cycleRuns).set({ lastError: error }).where(this.#key(cycleDate, userId));
  }

  async complete(cycleDate: string, userId: string, at: Date, late: boolean): Promise<void> {
    await this.db
      .update(cycleRuns)
      .set({ status: 'completed', completedAt: at, late, lastError: null })
      .where(this.#key(cycleDate, userId));
  }

  async markFrozen(cycleDate: string, userId: string, reason: string): Promise<void> {
    await this.db.update(cycleRuns).set({ status: 'frozen', lastError: reason }).where(this.#key(cycleDate, userId));
  }

  /** Marks every run still pending from before `cycleDate` as abandoned, and returns them. */
  async abandonBefore(cycleDate: string): Promise<CycleRun[]> {
    const stale = (
      await this.db
        .select()
        .from(cycleRuns)
        .where(and(eq(cycleRuns.status, 'pending'), lt(cycleRuns.cycleDate, cycleDate)))
        .orderBy(asc(cycleRuns.cycleDate), asc(cycleRuns.userId))
    ).map(toRun);
    for (const run of stale) {
      await this.db.update(cycleRuns).set({ status: 'abandoned' }).where(this.#key(run.cycleDate, run.userId));
    }
    return stale.map((run) => ({ ...run, status: 'abandoned' as const }));
  }

  async pendingFor(cycleDate: string): Promise<CycleRun[]> {
    const rows = await this.db
      .select()
      .from(cycleRuns)
      .where(and(eq(cycleRuns.cycleDate, cycleDate), eq(cycleRuns.status, 'pending')))
      .orderBy(asc(cycleRuns.userId));
    return rows.map(toRun);
  }

  #key(cycleDate: string, userId: string) {
    return and(eq(cycleRuns.cycleDate, cycleDate), eq(cycleRuns.userId, userId));
  }
}

import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { alertLog } from '../db/schema.js';

/** Keys for things done once per day — alerts, reminders, the heartbeat — so ticks every 15 minutes do not repeat them. */
export class AlertLog {
  constructor(private readonly db: Database) {}

  /** Records `key`; true the first time, false once it is already recorded. */
  async claim(key: string, at: Date): Promise<boolean> {
    const inserted = await this.db
      .insert(alertLog)
      .values({ key, sentAt: at })
      .onConflictDoNothing()
      .returning({ key: alertLog.key });
    return inserted.length > 0;
  }

  async has(key: string): Promise<boolean> {
    const rows = await this.db.select().from(alertLog).where(eq(alertLog.key, key));
    return rows.length > 0;
  }
}

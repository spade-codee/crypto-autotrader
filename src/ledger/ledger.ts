import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { ledgerEvents } from '../db/schema.js';

export const LEDGER_EVENT_TYPES = [
  'ACCOUNT_OPENED',
  'SIGNAL',
  'ORDER_INTENT',
  'ORDER_RESULT',
  'RECONCILED',
  'RUN_COMPLETED',
  'RUN_FAILED',
  'RUN_ABANDONED',
  'FROZEN',
  'UNFROZEN',
  'PAUSED',
  'RESUMED',
  'KILL_SWITCH_SKIP',
  'TOO_SMALL',
] as const;

export type LedgerEventType = (typeof LEDGER_EVENT_TYPES)[number];

export type LedgerEvent = {
  id: number;
  occurredAt: Date;
  /** Null for events that concern everyone, such as the day's signal. */
  userId: string | null;
  cycleDate: string | null;
  type: LedgerEventType;
  payload: Record<string, unknown>;
};

export type NewLedgerEvent = Omit<LedgerEvent, 'id'>;

export type DayOrder = { intent: LedgerEvent; result: LedgerEvent | null };

type Row = typeof ledgerEvents.$inferSelect;

function toEvent(row: Row): LedgerEvent {
  if (!(LEDGER_EVENT_TYPES as readonly string[]).includes(row.type)) {
    throw new Error(`unknown ledger event type "${row.type}"`);
  }
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    userId: row.userId,
    cycleDate: row.cycleDate,
    type: row.type as LedgerEventType,
    payload: row.payload,
  };
}

const ORDER_EVENTS = ['ORDER_INTENT', 'ORDER_RESULT'];

/**
 * The append-only record of everything the engine decided and did — the track
 * record. The database rejects updates and deletes, so history only grows, and
 * it holds each client order ID to one intent and one result. Decimal values in
 * payloads are stored as strings, through Decimal#toJSON.
 */
export class Ledger {
  constructor(private readonly db: Database) {}

  async append(event: NewLedgerEvent): Promise<void> {
    await this.db.insert(ledgerEvents).values(event);
  }

  /** Every event for one user, oldest first. */
  async forUser(userId: string): Promise<LedgerEvent[]> {
    const rows = await this.db
      .select()
      .from(ledgerEvents)
      .where(eq(ledgerEvents.userId, userId))
      .orderBy(asc(ledgerEvents.id));
    return rows.map(toEvent);
  }

  /** Every event of one type, oldest first — for one user, or for everyone when `userId` is null. */
  async ofType(type: LedgerEventType, userId: string | null): Promise<LedgerEvent[]> {
    const who = userId === null ? isNull(ledgerEvents.userId) : eq(ledgerEvents.userId, userId);
    const rows = await this.db
      .select()
      .from(ledgerEvents)
      .where(and(eq(ledgerEvents.type, type), who))
      .orderBy(asc(ledgerEvents.id));
    return rows.map(toEvent);
  }

  /** The day's signal, once it has been recorded. */
  async signalFor(cycleDate: string): Promise<LedgerEvent | null> {
    const rows = await this.db
      .select()
      .from(ledgerEvents)
      .where(and(eq(ledgerEvents.type, 'SIGNAL'), eq(ledgerEvents.cycleDate, cycleDate), isNull(ledgerEvents.userId)))
      .orderBy(asc(ledgerEvents.id))
      .limit(1);
    return rows[0] === undefined ? null : toEvent(rows[0]);
  }

  /**
   * Order intents with no result yet, oldest first — from any day. Each client
   * order ID has one intent and at most one result, so an intent is outstanding
   * exactly when no result names its ID.
   */
  async outstandingIntents(userId: string): Promise<LedgerEvent[]> {
    const rows = await this.db
      .select()
      .from(ledgerEvents)
      .where(and(eq(ledgerEvents.userId, userId), inArray(ledgerEvents.type, ORDER_EVENTS)))
      .orderBy(asc(ledgerEvents.id));
    const events = rows.map(toEvent);
    const settled = new Set(
      events.filter((e) => e.type === 'ORDER_RESULT').map((e) => String(e.payload.clientOrderId)),
    );
    return events.filter((e) => e.type === 'ORDER_INTENT' && !settled.has(String(e.payload.clientOrderId)));
  }

  /**
   * One user's orders on one cycle date, oldest first: each intent with its
   * result, if settled. Results are recorded under their intent's cycle date,
   * even when they are settled later.
   */
  async ordersOn(userId: string, cycleDate: string): Promise<DayOrder[]> {
    const rows = await this.db
      .select()
      .from(ledgerEvents)
      .where(
        and(
          eq(ledgerEvents.userId, userId),
          eq(ledgerEvents.cycleDate, cycleDate),
          inArray(ledgerEvents.type, ORDER_EVENTS),
        ),
      )
      .orderBy(asc(ledgerEvents.id));
    const events = rows.map(toEvent);
    const results = new Map(
      events.filter((e) => e.type === 'ORDER_RESULT').map((e) => [String(e.payload.clientOrderId), e]),
    );
    return events
      .filter((e) => e.type === 'ORDER_INTENT')
      .map((intent) => ({ intent, result: results.get(String(intent.payload.clientOrderId)) ?? null }));
  }
}

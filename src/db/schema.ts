import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * One API key per user, exchange, and environment. Both halves of the key are
 * sealed into `ciphertext` (see src/vault/crypto.ts); only the last four
 * characters of the API key are stored in the clear, as a hint for humans.
 */
export const exchangeCredentials = pgTable(
  'exchange_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    exchange: text('exchange').notNull(),
    environment: text('environment').notNull(),
    apiKeyHint: text('api_key_hint').notNull(),
    keyVersion: integer('key_version').notNull(),
    iv: text('iv').notNull(),
    authTag: text('auth_tag').notNull(),
    ciphertext: text('ciphertext').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('exchange_credentials_owner_idx').on(
      table.userId,
      table.exchange,
      table.environment,
    ),
  ],
);

/** Enough digits for any amount of any coin: 20 before the point, 18 after. */
const amount = (name: string) => numeric(name, { precision: 38, scale: 18 });

/**
 * The append-only record of everything the engine decided and did. The
 * migration drizzle/0002_ledger_append_only.sql adds a trigger that rejects
 * UPDATE, DELETE, and TRUNCATE, and unique indexes that hold each client order
 * ID to one ORDER_INTENT and one ORDER_RESULT.
 */
export const ledgerEvents = pgTable(
  'ledger_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    /** Null for events that concern everyone, such as the day's signal. */
    userId: text('user_id'),
    cycleDate: date('cycle_date', { mode: 'string' }),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    index('ledger_events_user_idx').on(table.userId, table.type),
    index('ledger_events_day_idx').on(table.cycleDate, table.type),
  ],
);

/** Whether each account may trade. Every change is also written to the ledger. */
export const accountState = pgTable('account_state', {
  userId: text('user_id').primaryKey(),
  status: text('status').notNull(),
  reason: text('reason'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

/** One row per user and cycle date: where that day's run stands. The history is in the ledger. */
export const cycleRuns = pgTable(
  'cycle_runs',
  {
    cycleDate: date('cycle_date', { mode: 'string' }).notNull(),
    userId: text('user_id').notNull(),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull(),
    firstAttemptAt: timestamp('first_attempt_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    late: boolean('late').notNull().default(false),
    lastError: text('last_error'),
  },
  (table) => [primaryKey({ columns: [table.cycleDate, table.userId] })],
);

/** Alerts already sent, so each goes out once rather than every 15 minutes. */
export const alertLog = pgTable('alert_log', {
  key: text('key').primaryKey(),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
});

/** The paper account's balances: the exchange's side of paper trading. */
export const paperBalances = pgTable(
  'paper_balances',
  {
    userId: text('user_id').notNull(),
    coin: text('coin').notNull(),
    free: amount('free').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.coin] })],
);

/** The paper account's orders, one per client order ID. */
export const paperOrders = pgTable('paper_orders', {
  clientOrderId: text('client_order_id').primaryKey(),
  userId: text('user_id').notNull(),
  symbol: text('symbol').notNull(),
  side: text('side').notNull(),
  /** The quote coin to spend on a buy; the base coin to sell on a sell. */
  requested: amount('requested').notNull(),
  status: text('status').notNull(),
  filledBaseQty: amount('filled_base_qty').notNull(),
  filledQuoteAmount: amount('filled_quote_amount').notNull(),
  avgPrice: amount('avg_price'),
  fee: amount('fee').notNull(),
  feeCoin: text('fee_coin').notNull(),
  rejectReason: text('reject_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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

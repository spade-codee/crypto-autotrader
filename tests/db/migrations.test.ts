import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Runs one migration file, statement by statement, as drizzle's migrator does. */
async function apply(client: PGlite, tag: string): Promise<void> {
  const sql = readFileSync(new URL(`../../drizzle/${tag}.sql`, import.meta.url), 'utf8');
  for (const statement of sql.split('--> statement-breakpoint')) {
    if (statement.trim() !== '') {
      await client.exec(statement);
    }
  }
}

describe('the account_state migration', () => {
  it('keeps the state and the reason every existing account had', async () => {
    const client = new PGlite();
    for (const tag of ['0000_exchange_credentials', '0001_paper_engine', '0002_ledger_append_only']) {
      await apply(client, tag);
    }
    await client.exec(`
      INSERT INTO account_state (user_id, status, reason, updated_at) VALUES
        ('active-one', 'active', NULL, now()),
        ('paused-one', 'paused', 'travelling', now()),
        ('frozen-one', 'frozen', 'a partial fill', now());
    `);

    await apply(client, '0003_pause_and_freeze');
    await apply(client, '0004_drop_account_status');

    const rows = await client.query<{
      user_id: string;
      paused: boolean;
      paused_reason: string | null;
      frozen: boolean;
      frozen_reason: string | null;
    }>('SELECT user_id, paused, paused_reason, frozen, frozen_reason FROM account_state ORDER BY user_id');
    expect(rows.rows).toEqual([
      { user_id: 'active-one', paused: false, paused_reason: null, frozen: false, frozen_reason: null },
      { user_id: 'frozen-one', paused: false, paused_reason: null, frozen: true, frozen_reason: 'a partial fill' },
      { user_id: 'paused-one', paused: true, paused_reason: 'travelling', frozen: false, frozen_reason: null },
    ]);
    await client.close();
  });
});

import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './schema.js';

export type Database = PgliteDatabase<typeof schema>;

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Opens PGlite — real Postgres compiled to WebAssembly, running inside this
 * process — and applies every migration. Without a directory the database is
 * in memory, which is what tests use. Production runs ordinary Postgres from
 * Phase 3, against the same schema and migrations.
 */
export async function openDatabase(
  dataDir?: string,
): Promise<{ db: Database; close: () => Promise<void> }> {
  const client = dataDir === undefined ? new PGlite() : new PGlite(dataDir);
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, close: () => client.close() };
}

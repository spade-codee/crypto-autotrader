import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { acquireLock, lockNameFor } from '../ops/lock.js';
import * as schema from './schema.js';

export type Database = PgliteDatabase<typeof schema>;

export type OpenedDatabase = { db: Database; close: () => Promise<void> };

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Applies every migration to `client`, closing it again if that fails. */
async function migrated(client: PGlite): Promise<OpenedDatabase> {
  try {
    const db = drizzle({ client, schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    return { db, close: () => client.close() };
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}

/**
 * An in-memory database with every migration applied: PGlite — real Postgres
 * compiled to WebAssembly — running inside this process. Tests use it; nothing
 * on disk is touched, so no lock is needed.
 */
export async function openMemoryDatabase(): Promise<OpenedDatabase> {
  return migrated(new PGlite());
}

export type OpenOptions = {
  /** How long to wait for another command to finish with the database. */
  lockWaitMs?: number;
};

/**
 * Opens the database stored in `dataDir`, for this process alone, with every
 * migration applied. PGlite must never be opened by two processes at once, so
 * this holds the database lock (src/ops/lock.ts), named for the directory
 * itself however it is written, for as long as the database is open, and gives
 * it up only after the database has closed. It is the only way to open a
 * database on disk, so no command can bypass the lock. Production moves to
 * ordinary Postgres in Phase 3, against the same schema and migrations.
 */
export async function openDatabase(dataDir: string, options: OpenOptions = {}): Promise<OpenedDatabase> {
  mkdirSync(dataDir, { recursive: true });
  const release = await acquireLock(lockNameFor(dataDir), { waitMs: options.lockWaitMs });
  let opened: OpenedDatabase;
  try {
    opened = await migrated(new PGlite(dataDir));
  } catch (error) {
    await release();
    throw error;
  }
  return {
    db: opened.db,
    close: async () => {
      try {
        await opened.close();
      } finally {
        await release();
      }
    },
  };
}

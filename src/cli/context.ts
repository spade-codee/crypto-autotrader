import type { FlowDeps } from '../app/credentials.js';
import { openDatabase } from '../db/client.js';
import { BybitAccount } from '../exchange/bybit/account.js';
import { BybitClient } from '../exchange/bybit/client.js';
import { CredentialVault, type CredentialOwner } from '../vault/credentialVault.js';
import { keyringFromEnv } from '../vault/keyring.js';
import { loadLocalEnv, readConfig } from './env.js';
import { explainError } from './guidance.js';

export type ContextOptions = {
  /** Settings to read instead of the environment and .env.local. For tests. */
  env?: Record<string, string | undefined>;
  /** How long to wait for another command to finish with the database. */
  lockWaitMs?: number;
};

/**
 * Wires the real vault, database, and Bybit client. Loads the keyring before
 * anything else, so a missing master key fails before anyone types a secret.
 * The database is opened through openDatabase, so these commands hold the same
 * lock as the engine's, and cannot open it while a tick has it.
 */
export async function openContext(options: ContextOptions = {}): Promise<{
  deps: FlowDeps;
  owner: CredentialOwner;
  close: () => Promise<void>;
}> {
  if (options.env === undefined) {
    loadLocalEnv();
  }
  const env = options.env ?? process.env;
  const config = readConfig(env);
  const keyring = keyringFromEnv(env);
  const { db, close } = await openDatabase(config.dbDir, { lockWaitMs: options.lockWaitMs });
  return {
    deps: {
      vault: new CredentialVault(db, keyring),
      accountFor: (credentials) =>
        new BybitAccount(new BybitClient({ environment: config.environment, credentials })),
      serverIps: config.serverIps,
      now: () => new Date(),
    },
    owner: { userId: config.userId, exchange: 'bybit', environment: config.environment },
    close,
  };
}

/** Runs a command body and prints guidance instead of a stack trace on failure. */
export async function runCli(body: () => Promise<number>): Promise<void> {
  try {
    process.exitCode = await body();
  } catch (error) {
    console.error(explainError(error));
    process.exitCode = 1;
  }
}

export function printList(prefix: string, lines: string[], write: (line: string) => void): void {
  for (const line of lines) {
    write(`  ${prefix} ${line}`);
  }
}

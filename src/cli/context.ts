import { mkdirSync } from 'node:fs';
import type { FlowDeps } from '../app/credentials.js';
import { openDatabase } from '../db/client.js';
import { BybitAccount } from '../exchange/bybit/account.js';
import { BybitClient } from '../exchange/bybit/client.js';
import { CredentialVault, type CredentialOwner } from '../vault/credentialVault.js';
import { keyringFromEnv } from '../vault/keyring.js';
import { loadLocalEnv, readConfig } from './env.js';
import { explainError } from './guidance.js';

/**
 * Wires the real vault, database, and Bybit client. Loads the keyring before
 * anything else, so a missing master key fails before anyone types a secret.
 */
export async function openContext(): Promise<{
  deps: FlowDeps;
  owner: CredentialOwner;
  close: () => Promise<void>;
}> {
  loadLocalEnv();
  const config = readConfig();
  const keyring = keyringFromEnv(process.env);
  mkdirSync(config.dbDir, { recursive: true });
  const { db, close } = await openDatabase(config.dbDir);
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

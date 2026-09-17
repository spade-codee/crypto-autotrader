import type { CoinBalance, ExchangeAccount } from '../exchange/account.js';
import { validateKeyInfo, type KeyValidation } from '../exchange/bybit/keyValidation.js';
import type { ApiCredentials } from '../exchange/credentials.js';
import type { CredentialOwner, CredentialVault } from '../vault/credentialVault.js';

export type FlowDeps = {
  vault: CredentialVault;
  accountFor: (credentials: ApiCredentials) => ExchangeAccount;
  serverIps: string[];
  now: () => Date;
};

export type ConnectResult =
  | { status: 'stored'; apiKeyHint: string; canTradeSpot: boolean; warnings: string[] }
  | { status: 'rejected'; problems: string[]; warnings: string[] };

export type CheckResult =
  | { status: 'no-key' }
  | { status: 'valid'; apiKeyHint: string; canTradeSpot: boolean; warnings: string[] }
  | { status: 'invalid'; apiKeyHint: string; problems: string[]; warnings: string[] };

export type BalanceResult =
  | { status: 'no-key' }
  | { status: 'key-rejected'; problems: string[] }
  | { status: 'ok'; balances: CoinBalance[]; borrowedCoins: string[] };

async function validate(
  deps: FlowDeps,
  owner: CredentialOwner,
  account: ExchangeAccount,
  now: Date,
): Promise<KeyValidation> {
  return validateKeyInfo(await account.getKeyInfo(), {
    environment: owner.environment,
    serverIps: deps.serverIps,
    now,
  });
}

/** Asks the exchange what the key can do, and stores it only if that passes validation. */
export async function connectKey(
  deps: FlowDeps,
  owner: CredentialOwner,
  credentials: ApiCredentials,
): Promise<ConnectResult> {
  const now = deps.now();
  const validation = await validate(deps, owner, deps.accountFor(credentials), now);
  if (!validation.ok) {
    return { status: 'rejected', problems: validation.problems, warnings: validation.warnings };
  }
  await deps.vault.store(owner, credentials, now);
  return {
    status: 'stored',
    apiKeyHint: credentials.apiKey.reveal().slice(-4),
    canTradeSpot: validation.canTradeSpot,
    warnings: validation.warnings,
  };
}

/**
 * Re-validates the stored key against the exchange's current view of it. A key's
 * permissions can be widened in the exchange's website after it was stored.
 */
export async function checkKey(deps: FlowDeps, owner: CredentialOwner): Promise<CheckResult> {
  const stored = await deps.vault.retrieve(owner);
  if (stored === null) {
    return { status: 'no-key' };
  }
  const now = deps.now();
  const validation = await validate(deps, owner, deps.accountFor(stored), now);
  if (!validation.ok) {
    return {
      status: 'invalid',
      apiKeyHint: stored.apiKeyHint,
      problems: validation.problems,
      warnings: validation.warnings,
    };
  }
  await deps.vault.markValidated(owner, now);
  return {
    status: 'valid',
    apiKeyHint: stored.apiKeyHint,
    canTradeSpot: validation.canTradeSpot,
    warnings: validation.warnings,
  };
}

/**
 * Reads balances with the stored key — but only after re-validating it. A key
 * that no longer passes is never used, which is the rule every later phase that
 * trades must follow too.
 */
export async function readBalances(deps: FlowDeps, owner: CredentialOwner): Promise<BalanceResult> {
  const stored = await deps.vault.retrieve(owner);
  if (stored === null) {
    return { status: 'no-key' };
  }
  const account = deps.accountFor(stored);
  const validation = await validate(deps, owner, account, deps.now());
  if (!validation.ok) {
    return { status: 'key-rejected', problems: validation.problems };
  }
  const balances = (await account.getBalances()).filter(
    (b) => !b.walletBalance.isZero() || !b.borrowAmount.isZero(),
  );
  return {
    status: 'ok',
    balances,
    borrowedCoins: balances.filter((b) => b.borrowAmount.gt(0)).map((b) => b.coin),
  };
}

import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { checkKey, connectKey, readBalances, type FlowDeps } from '../../src/app/credentials.js';
import type { CoinBalance, ExchangeAccount, KeyInfo } from '../../src/exchange/account.js';
import type { ApiCredentials } from '../../src/exchange/credentials.js';
import { Secret } from '../../src/secrets/secret.js';
import { CredentialVault, type CredentialOwner } from '../../src/vault/credentialVault.js';
import { testKeyring, useTestDatabase } from '../helpers/vault.js';

const OWNER: CredentialOwner = { userId: 'founder', exchange: 'bybit', environment: 'testnet' };
const NOW = new Date('2026-09-17T12:00:00Z');

const goodKey: KeyInfo = {
  readOnly: false,
  permissions: { Spot: ['SpotTrade'], Wallet: [] },
  ips: ['*'],
  unifiedTradingAccount: true,
  expiresAt: null,
};
const withdrawKey: KeyInfo = { ...goodKey, permissions: { Spot: ['SpotTrade'], Wallet: ['Withdraw'] } };

const balance = (coin: string, wallet: string, borrow = '0'): CoinBalance => ({
  coin,
  walletBalance: new Decimal(wallet),
  locked: new Decimal(0),
  borrowAmount: new Decimal(borrow),
});

class FakeAccount implements ExchangeAccount {
  constructor(
    private readonly info: KeyInfo,
    private readonly balances: CoinBalance[] = [],
  ) {}
  async getKeyInfo() {
    return this.info;
  }
  async getBalances() {
    return this.balances;
  }
}

const credentials = (): ApiCredentials => ({
  apiKey: new Secret('FOUNDERKEY42'),
  apiSecret: new Secret('FOUNDERSECRET'),
});

const database = useTestDatabase();

/** Deps whose exchange reports `info` and `balances`, recording which API keys it was given. */
function setup(info: KeyInfo, balances: CoinBalance[] = [], serverIps: string[] = []) {
  const vault = new CredentialVault(database(), testKeyring());
  const usedKeys: string[] = [];
  const deps: FlowDeps = {
    vault,
    accountFor: (creds) => {
      usedKeys.push(creds.apiKey.reveal());
      return new FakeAccount(info, balances);
    },
    serverIps,
    now: () => NOW,
  };
  return { deps, vault, usedKeys };
}

describe('connectKey', () => {
  it('stores a key that passes validation', async () => {
    const { deps, vault } = setup(goodKey);
    const result = await connectKey(deps, OWNER, credentials());

    expect(result).toMatchObject({ status: 'stored', apiKeyHint: 'EY42', canTradeSpot: true });
    expect((await vault.retrieve(OWNER))?.apiSecret.reveal()).toBe('FOUNDERSECRET');
  });

  it('never stores a key that fails validation', async () => {
    const { deps, vault } = setup(withdrawKey);
    const result = await connectKey(deps, OWNER, credentials());

    expect(result.status).toBe('rejected');
    expect(result.status === 'rejected' && result.problems.join(' ')).toContain('Wallet: Withdraw');
    expect(await vault.retrieve(OWNER)).toBeNull();
  });

  it('validates against the owner environment', async () => {
    const { deps, vault } = setup(goodKey, [], ['203.0.113.10']);
    const result = await connectKey(deps, { ...OWNER, environment: 'mainnet' }, credentials());

    // Unrestricted keys are fine on testnet but not on mainnet.
    expect(result.status).toBe('rejected');
    expect(await vault.retrieve({ ...OWNER, environment: 'mainnet' })).toBeNull();
  });
});

describe('checkKey', () => {
  it('reports when no key is stored', async () => {
    const { deps } = setup(goodKey);
    expect(await checkKey(deps, OWNER)).toEqual({ status: 'no-key' });
  });

  it('uses the stored credentials and refreshes the validation time', async () => {
    const { deps, vault, usedKeys } = setup(goodKey);
    await vault.store(OWNER, credentials(), new Date('2026-01-01T00:00:00Z'));

    const result = await checkKey(deps, OWNER);

    expect(result).toMatchObject({ status: 'valid', apiKeyHint: 'EY42' });
    expect(usedKeys).toEqual(['FOUNDERKEY42']);
    expect((await vault.retrieve(OWNER))?.validatedAt?.toISOString()).toBe(NOW.toISOString());
  });

  it('reports a stored key whose permissions have since been widened', async () => {
    const { deps, vault } = setup(withdrawKey);
    const earlier = new Date('2026-01-01T00:00:00Z');
    await vault.store(OWNER, credentials(), earlier);

    const result = await checkKey(deps, OWNER);

    expect(result.status).toBe('invalid');
    expect((await vault.retrieve(OWNER))?.validatedAt?.toISOString()).toBe(earlier.toISOString());
  });
});

describe('readBalances', () => {
  it('refuses to use a stored key that no longer passes validation', async () => {
    const { deps, vault } = setup(withdrawKey, [balance('USDT', '100')]);
    await vault.store(OWNER, credentials(), NOW);

    const result = await readBalances(deps, OWNER);

    expect(result.status).toBe('key-rejected');
  });

  it('returns non-zero balances and flags borrowing', async () => {
    const { deps, vault } = setup(goodKey, [
      balance('BTC', '0.5'),
      balance('ETH', '0'),
      balance('USDT', '10', '25'),
    ]);
    await vault.store(OWNER, credentials(), NOW);

    const result = await readBalances(deps, OWNER);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.balances.map((b) => b.coin)).toEqual(['BTC', 'USDT']);
      expect(result.borrowedCoins).toEqual(['USDT']);
    }
  });
});

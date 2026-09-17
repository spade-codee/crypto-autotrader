import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { exchangeCredentials } from '../../src/db/schema.js';
import { Secret } from '../../src/secrets/secret.js';
import { VaultDecryptionError } from '../../src/vault/crypto.js';
import { CredentialVault, type CredentialOwner } from '../../src/vault/credentialVault.js';
import { testKeyring, useTestDatabase } from '../helpers/vault.js';

const ALICE: CredentialOwner = { userId: 'alice', exchange: 'bybit', environment: 'testnet' };
const MALLORY: CredentialOwner = { userId: 'mallory', exchange: 'bybit', environment: 'testnet' };
const AT = new Date('2026-09-17T10:00:00Z');

const credentials = (key: string, secret: string) => ({
  apiKey: new Secret(key),
  apiSecret: new Secret(secret),
});

const database = useTestDatabase();
const newVault = () => new CredentialVault(database(), testKeyring());

describe('CredentialVault', () => {
  it('stores and retrieves credentials', async () => {
    const vault = newVault();
    await vault.store(ALICE, credentials('ALICEKEY1234', 'ALICESECRET'), AT);

    const stored = await vault.retrieve(ALICE);
    expect(stored?.apiKey.reveal()).toBe('ALICEKEY1234');
    expect(stored?.apiSecret.reveal()).toBe('ALICESECRET');
    expect(stored?.apiKeyHint).toBe('1234');
    expect(stored?.validatedAt?.toISOString()).toBe(AT.toISOString());
  });

  it('returns null when nothing is stored for an owner', async () => {
    expect(await newVault().retrieve(ALICE)).toBeNull();
  });

  it('replaces an existing key for the same owner rather than adding another', async () => {
    const vault = newVault();
    await vault.store(ALICE, credentials('OLDKEY000001', 'OLD'), AT);
    await vault.store(ALICE, credentials('NEWKEY000002', 'NEW'), AT);

    expect((await vault.retrieve(ALICE))?.apiSecret.reveal()).toBe('NEW');
    expect(await database().select().from(exchangeCredentials)).toHaveLength(1);
  });

  it('keeps testnet and mainnet keys separate', async () => {
    const vault = newVault();
    await vault.store(ALICE, credentials('TESTNETKEY01', 'T'), AT);
    await vault.store({ ...ALICE, environment: 'mainnet' }, credentials('MAINNETKEY01', 'M'), AT);

    expect((await vault.retrieve(ALICE))?.apiSecret.reveal()).toBe('T');
    expect((await vault.retrieve({ ...ALICE, environment: 'mainnet' }))?.apiSecret.reveal()).toBe('M');
  });

  it('never writes the key or secret to the database in plain text', async () => {
    await newVault().store(ALICE, credentials('PLAINKEY9876', 'PLAINSECRET'), AT);

    const [row] = await database().select().from(exchangeCredentials);
    const everything = JSON.stringify(row);
    expect(everything).not.toContain('PLAINSECRET');
    expect(everything).not.toContain('PLAINKEY9876');
    expect(row!.apiKeyHint).toBe('9876');
  });

  it('refuses to decrypt a row moved onto another owner', async () => {
    const vault = newVault();
    await vault.store(ALICE, credentials('ALICEKEY1234', 'ALICESECRET'), AT);

    await database()
      .update(exchangeCredentials)
      .set({ userId: 'mallory' })
      .where(eq(exchangeCredentials.userId, 'alice'));

    await expect(vault.retrieve(MALLORY)).rejects.toThrow(VaultDecryptionError);
  });

  it('records when a key was last validated', async () => {
    const vault = newVault();
    await vault.store(ALICE, credentials('ALICEKEY1234', 'S'), AT);
    const later = new Date('2026-09-18T08:00:00Z');

    await vault.markValidated(ALICE, later);

    expect((await vault.retrieve(ALICE))?.validatedAt?.toISOString()).toBe(later.toISOString());
  });

  it('starts every test with an empty database', async () => {
    // Guards the shared-database helper: earlier tests stored keys for ALICE.
    expect(await database().select().from(exchangeCredentials)).toHaveLength(0);
  });
});

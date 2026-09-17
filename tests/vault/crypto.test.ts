import { describe, expect, it } from 'vitest';
import { open, seal, VaultDecryptionError } from '../../src/vault/crypto.js';
import { testKeyring } from '../helpers/vault.js';

const AAD = 'exchange_credentials:alice:bybit:testnet';
const PLAINTEXT = '{"apiKey":"KEY","apiSecret":"SECRET"}';

/** Flips the first byte of a base64 string's decoded bytes. */
function tamper(base64: string): string {
  const bytes = Buffer.from(base64, 'base64');
  bytes[0] = bytes[0]! ^ 0xff;
  return bytes.toString('base64');
}

describe('seal and open', () => {
  it('round-trips', () => {
    const keyring = testKeyring();
    expect(open(seal(PLAINTEXT, keyring, AAD), keyring, AAD)).toBe(PLAINTEXT);
  });

  it('uses a fresh IV every time, so equal plaintexts look different', () => {
    const keyring = testKeyring();
    const a = seal(PLAINTEXT, keyring, AAD);
    const b = seal(PLAINTEXT, keyring, AAD);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('refuses to open a record under a different owner', () => {
    const keyring = testKeyring();
    const sealed = seal(PLAINTEXT, keyring, AAD);
    expect(() => open(sealed, keyring, 'exchange_credentials:mallory:bybit:testnet')).toThrow(
      VaultDecryptionError,
    );
  });

  it('detects a tampered ciphertext', () => {
    const keyring = testKeyring();
    const sealed = seal(PLAINTEXT, keyring, AAD);
    expect(() => open({ ...sealed, ciphertext: tamper(sealed.ciphertext) }, keyring, AAD)).toThrow(
      VaultDecryptionError,
    );
  });

  it('detects a tampered authentication tag', () => {
    const keyring = testKeyring();
    const sealed = seal(PLAINTEXT, keyring, AAD);
    expect(() => open({ ...sealed, authTag: tamper(sealed.authTag) }, keyring, AAD)).toThrow(
      VaultDecryptionError,
    );
  });

  it('fails with a wrong master key, without saying anything useful to an attacker', () => {
    const sealed = seal(PLAINTEXT, testKeyring({ 1: 1 }), AAD);
    expect(() => open(sealed, testKeyring({ 1: 2 }), AAD)).toThrow(
      'credentials could not be decrypted — wrong master key, or the record was altered',
    );
  });

  it('names a missing key version', () => {
    const sealed = seal(PLAINTEXT, testKeyring({ 3: 3 }, 3), AAD);
    expect(() => open(sealed, testKeyring({ 1: 1 }), AAD)).toThrow(
      'record was sealed with master key version 3, which is not loaded',
    );
  });

  it('opens records sealed before a rotation, and seals new ones with the new key', () => {
    const before = seal(PLAINTEXT, testKeyring({ 1: 1 }, 1), AAD);
    const rotated = testKeyring({ 1: 1, 2: 2 }, 2);
    expect(open(before, rotated, AAD)).toBe(PLAINTEXT);
    expect(seal(PLAINTEXT, rotated, AAD).keyVersion).toBe(2);
  });
});

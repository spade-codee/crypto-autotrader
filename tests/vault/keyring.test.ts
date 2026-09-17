import { describe, expect, it } from 'vitest';
import { generateMasterKey, keyringFromEnv } from '../../src/vault/keyring.js';

const key = (fill: number) => Buffer.alloc(32, fill).toString('base64');

describe('keyringFromEnv', () => {
  it('loads a single master key', () => {
    const keyring = keyringFromEnv({ VAULT_MASTER_KEY_V1: key(1), VAULT_ACTIVE_KEY_VERSION: '1' });
    expect(keyring.activeVersion).toBe(1);
    expect(keyring.keys.get(1)).toEqual(Buffer.alloc(32, 1));
  });

  it('keeps older versions loaded so existing records still open', () => {
    const keyring = keyringFromEnv({
      VAULT_MASTER_KEY_V1: key(1),
      VAULT_MASTER_KEY_V2: key(2),
      VAULT_ACTIVE_KEY_VERSION: '2',
    });
    expect(keyring.activeVersion).toBe(2);
    expect([...keyring.keys.keys()].sort()).toEqual([1, 2]);
  });

  it('ignores unrelated environment variables', () => {
    const keyring = keyringFromEnv({
      VAULT_MASTER_KEY_V1: key(1),
      VAULT_ACTIVE_KEY_VERSION: '1',
      PATH: '/usr/bin',
      VAULT_MASTER_KEY_V0: key(9),
      VAULT_MASTER_KEY_VX: key(9),
    });
    expect([...keyring.keys.keys()]).toEqual([1]);
  });

  it('requires an active version', () => {
    expect(() => keyringFromEnv({ VAULT_MASTER_KEY_V1: key(1) })).toThrow(
      'VAULT_ACTIVE_KEY_VERSION is not set',
    );
  });

  it('requires the active version to be a positive integer', () => {
    expect(() =>
      keyringFromEnv({ VAULT_MASTER_KEY_V1: key(1), VAULT_ACTIVE_KEY_VERSION: 'one' }),
    ).toThrow('VAULT_ACTIVE_KEY_VERSION must be a positive integer');
  });

  it('requires the active version to have a key', () => {
    expect(() =>
      keyringFromEnv({ VAULT_MASTER_KEY_V1: key(1), VAULT_ACTIVE_KEY_VERSION: '2' }),
    ).toThrow('VAULT_MASTER_KEY_V2 is not set');
  });

  it('rejects a key of the wrong length without printing it', () => {
    const shortKey = Buffer.alloc(16, 7).toString('base64');
    let message = '';
    try {
      keyringFromEnv({ VAULT_MASTER_KEY_V1: shortKey, VAULT_ACTIVE_KEY_VERSION: '1' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('VAULT_MASTER_KEY_V1 must be 32 bytes');
    expect(message).not.toContain(shortKey);
  });
});

describe('generateMasterKey', () => {
  it('produces 32 random bytes as base64, different each time', () => {
    const a = generateMasterKey();
    const b = generateMasterKey();
    expect(Buffer.from(a, 'base64')).toHaveLength(32);
    expect(a).not.toBe(b);
  });
});

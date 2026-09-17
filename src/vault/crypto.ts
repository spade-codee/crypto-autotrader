import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Keyring } from './keyring.js';

const ALGORITHM = 'aes-256-gcm' as const;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** A sealed payload. Every field except keyVersion is base64. */
export type Sealed = {
  keyVersion: number;
  iv: string;
  authTag: string;
  ciphertext: string;
};

/** Deliberately vague: the reason a decryption failed is useful to an attacker. */
export class VaultDecryptionError extends Error {
  constructor() {
    super('credentials could not be decrypted — wrong master key, or the record was altered');
    this.name = 'VaultDecryptionError';
  }
}

/**
 * Encrypts with AES-256-GCM under the active master key. `aad` is authenticated
 * but not encrypted: it binds the ciphertext to its owner, so the record cannot
 * be opened under any other owner's identity.
 */
export function seal(plaintext: string, keyring: Keyring, aad: string): Sealed {
  const key = keyring.keys.get(keyring.activeVersion);
  if (key === undefined) {
    throw new Error(`no master key for active version ${keyring.activeVersion}`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    keyVersion: keyring.activeVersion,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function open(sealed: Sealed, keyring: Keyring, aad: string): string {
  const key = keyring.keys.get(sealed.keyVersion);
  if (key === undefined) {
    throw new Error(
      `record was sealed with master key version ${sealed.keyVersion}, which is not loaded`,
    );
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(sealed.iv, 'base64'), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new VaultDecryptionError();
  }
}

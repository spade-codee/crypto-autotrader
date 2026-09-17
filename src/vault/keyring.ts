import { randomBytes } from 'node:crypto';

export const MASTER_KEY_BYTES = 32;

export type Keyring = {
  /** The version used to seal new records. */
  activeVersion: number;
  keys: ReadonlyMap<number, Buffer>;
};

const KEY_VARIABLE = /^VAULT_MASTER_KEY_V([1-9]\d*)$/;

/** A new random 256-bit master key, base64-encoded for an environment file. */
export function generateMasterKey(): string {
  return randomBytes(MASTER_KEY_BYTES).toString('base64');
}

/**
 * Reads versioned master keys — VAULT_MASTER_KEY_V1, VAULT_MASTER_KEY_V2, … —
 * and VAULT_ACTIVE_KEY_VERSION, which names the key that seals new records.
 * Older versions stay loaded so records sealed before a rotation still open.
 * Error messages name variables, never their values.
 */
export function keyringFromEnv(env: Record<string, string | undefined>): Keyring {
  const keys = new Map<number, Buffer>();
  for (const [name, value] of Object.entries(env)) {
    const match = KEY_VARIABLE.exec(name);
    if (match === null || value === undefined) {
      continue;
    }
    const key = Buffer.from(value, 'base64');
    if (key.length !== MASTER_KEY_BYTES) {
      throw new Error(
        `${name} must be ${MASTER_KEY_BYTES} bytes of base64 — run npm run vault:init to generate one`,
      );
    }
    keys.set(Number(match[1]), key);
  }

  const activeRaw = env.VAULT_ACTIVE_KEY_VERSION;
  if (activeRaw === undefined) {
    throw new Error('VAULT_ACTIVE_KEY_VERSION is not set — run npm run vault:init');
  }
  const activeVersion = Number(activeRaw);
  if (!Number.isInteger(activeVersion) || activeVersion < 1) {
    throw new Error('VAULT_ACTIVE_KEY_VERSION must be a positive integer');
  }
  if (!keys.has(activeVersion)) {
    throw new Error(
      `VAULT_MASTER_KEY_V${activeVersion} is not set, but VAULT_ACTIVE_KEY_VERSION points to it`,
    );
  }
  return { activeVersion, keys };
}

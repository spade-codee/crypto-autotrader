import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { exchangeCredentials } from '../db/schema.js';
import type { ApiCredentials } from '../exchange/credentials.js';
import type { Environment } from '../exchange/environment.js';
import { Secret } from '../secrets/secret.js';
import { open, seal } from './crypto.js';
import type { Keyring } from './keyring.js';

export type CredentialOwner = {
  userId: string;
  exchange: 'bybit';
  environment: Environment;
};

export type StoredCredentials = ApiCredentials & {
  apiKeyHint: string;
  validatedAt: Date | null;
};

/** Binds a sealed record to its owner: a row copied onto another owner will not decrypt. */
function aadFor(owner: CredentialOwner): string {
  return `exchange_credentials:${owner.userId}:${owner.exchange}:${owner.environment}`;
}

function belongsTo(owner: CredentialOwner) {
  return and(
    eq(exchangeCredentials.userId, owner.userId),
    eq(exchangeCredentials.exchange, owner.exchange),
    eq(exchangeCredentials.environment, owner.environment),
  );
}

export class CredentialVault {
  constructor(
    private readonly db: Database,
    private readonly keyring: Keyring,
  ) {}

  /**
   * Seals and saves validated credentials, replacing any the owner already has.
   * Callers must validate a key before storing it — see src/app/credentials.ts.
   */
  async store(owner: CredentialOwner, credentials: ApiCredentials, validatedAt: Date): Promise<void> {
    const apiKey = credentials.apiKey.reveal();
    const sealed = seal(
      JSON.stringify({ apiKey, apiSecret: credentials.apiSecret.reveal() }),
      this.keyring,
      aadFor(owner),
    );
    const values = {
      apiKeyHint: apiKey.slice(-4),
      keyVersion: sealed.keyVersion,
      iv: sealed.iv,
      authTag: sealed.authTag,
      ciphertext: sealed.ciphertext,
      validatedAt,
      updatedAt: validatedAt,
    };
    await this.db
      .insert(exchangeCredentials)
      .values({ ...owner, ...values })
      .onConflictDoUpdate({
        target: [
          exchangeCredentials.userId,
          exchangeCredentials.exchange,
          exchangeCredentials.environment,
        ],
        set: values,
      });
  }

  async retrieve(owner: CredentialOwner): Promise<StoredCredentials | null> {
    const rows = await this.db
      .select()
      .from(exchangeCredentials)
      .where(belongsTo(owner))
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    const plaintext = open(
      { keyVersion: row.keyVersion, iv: row.iv, authTag: row.authTag, ciphertext: row.ciphertext },
      this.keyring,
      aadFor(owner),
    );
    let payload: { apiKey: string; apiSecret: string };
    try {
      payload = JSON.parse(plaintext) as { apiKey: string; apiSecret: string };
    } catch {
      // A JSON parse error message can quote its input, which here is a secret.
      throw new Error('stored credentials are not in the expected format');
    }
    return {
      apiKey: new Secret(payload.apiKey),
      apiSecret: new Secret(payload.apiSecret),
      apiKeyHint: row.apiKeyHint,
      validatedAt: row.validatedAt,
    };
  }

  async markValidated(owner: CredentialOwner, at: Date): Promise<void> {
    await this.db
      .update(exchangeCredentials)
      .set({ validatedAt: at, updatedAt: at })
      .where(belongsTo(owner));
  }
}

import { BybitApiError } from '../exchange/bybit/client.js';
import { VaultDecryptionError } from '../vault/crypto.js';

const BYBIT_GUIDANCE: Record<number, string> = {
  10002:
    "Bybit rejected the request time. Make sure this computer's clock is set automatically, then try again.",
  10003:
    'Bybit does not recognise this API key. Check it was copied in full, and that a testnet key is used with BYBIT_ENV=testnet (the default) and a mainnet key with BYBIT_ENV=mainnet.',
  10004:
    'The API secret does not match this key. Copy the secret again. Bybit shows it only once, so you may need to create a new key.',
  10005: 'This key lacks a permission the request needs. Run npm run key:check for details.',
  10010: "This key is restricted to IP addresses that do not include this computer's.",
};

/** Turns an error into a sentence a person can act on. Never includes secrets. */
export function explainError(error: unknown): string {
  if (error instanceof BybitApiError) {
    return BYBIT_GUIDANCE[error.retCode] ?? `Bybit returned error ${error.retCode}: ${error.retMsg}`;
  }
  if (error instanceof VaultDecryptionError) {
    return `${error.message}. If .env.local was replaced, the original master key is needed to read credentials stored with it.`;
  }
  return error instanceof Error ? error.message : String(error);
}

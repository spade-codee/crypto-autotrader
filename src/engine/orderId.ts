import { createHash } from 'node:crypto';
import type { OrderSide } from '../exchange/trading.js';

export type OrderIntent = 'ENTER_LONG' | 'EXIT_TO_FLAT';

export function intentFor(side: OrderSide): OrderIntent {
  return side === 'BUY' ? 'ENTER_LONG' : 'EXIT_TO_FLAT';
}

/**
 * A deterministic client order ID for one attempt at one intent, for one user
 * on one cycle date. The same inputs always give the same ID, so a tick that
 * crashes before recording its intent recreates exactly the same order. Each
 * attempt has its own ID, so every ID has one intent and one result.
 *
 * The inputs are JSON-encoded before hashing so no separator inside them can
 * make two different tuples collide. Bybit's orderLinkId allows up to 36
 * letters, digits, hyphens, and underscores; this returns 34.
 */
export function clientOrderId(
  userId: string,
  cycleDate: string,
  intent: OrderIntent,
  attempt: number,
): string {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error('attempt must be a whole number from 1');
  }
  const digest = createHash('sha256')
    .update(JSON.stringify([userId, cycleDate, intent, attempt]))
    .digest('hex');
  return `ca${digest.slice(0, 32)}`;
}

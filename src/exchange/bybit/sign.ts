import { createHmac } from 'node:crypto';
import type { ApiCredentials } from '../credentials.js';

export const RECV_WINDOW_MS = 5000;

/**
 * Bybit v5 HMAC authentication. For a GET request the signed string is
 * timestamp + apiKey + recvWindow + queryString, hashed with HMAC-SHA256 and
 * encoded as lowercase hex. Bybit accepts the request only when
 * serverTime - recvWindow <= timestamp < serverTime + 1000.
 */
export function signedHeaders(
  credentials: ApiCredentials,
  timestamp: number,
  queryString: string,
): Record<string, string> {
  const apiKey = credentials.apiKey.reveal();
  const payload = `${timestamp}${apiKey}${RECV_WINDOW_MS}${queryString}`;
  const signature = createHmac('sha256', credentials.apiSecret.reveal())
    .update(payload)
    .digest('hex');
  return {
    'X-BAPI-API-KEY': apiKey,
    'X-BAPI-TIMESTAMP': String(timestamp),
    'X-BAPI-RECV-WINDOW': String(RECV_WINDOW_MS),
    'X-BAPI-SIGN': signature,
  };
}

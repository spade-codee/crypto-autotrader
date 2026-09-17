import { getJson, type FetchLike } from '../../net/http.js';
import type { ApiCredentials } from '../credentials.js';
import type { Environment } from '../environment.js';
import { bybitHosts } from './hosts.js';
import { signedHeaders } from './sign.js';

/** A non-zero retCode from Bybit. Carries the code and message, never request details. */
export class BybitApiError extends Error {
  constructor(
    readonly retCode: number,
    readonly retMsg: string,
  ) {
    super(`Bybit error ${retCode}: ${retMsg}`);
    this.name = 'BybitApiError';
  }
}

/** Unwraps Bybit's { retCode, retMsg, result } envelope, throwing on any non-zero retCode. */
export function unwrap(body: unknown): unknown {
  const envelope = body as { retCode?: unknown; retMsg?: unknown; result?: unknown } | null;
  if (typeof envelope?.retCode !== 'number') {
    throw new Error('Bybit response missing retCode');
  }
  if (envelope.retCode !== 0) {
    throw new BybitApiError(
      envelope.retCode,
      typeof envelope.retMsg === 'string' ? envelope.retMsg : '',
    );
  }
  return envelope.result;
}

export type BybitClientOptions = {
  environment: Environment;
  credentials: ApiCredentials;
  /** Overrides the environment's host list. For tests. */
  hosts?: string[];
  fetchImpl?: FetchLike;
  now?: () => number;
};

/**
 * Signed GET requests to Bybit v5.
 *
 * Bybit rejects a timestamp more than 1,000 ms ahead of its own clock, and
 * ordinary PC clocks drift further than that. Before its first signed request
 * the client measures the offset between local and server time, using the
 * midpoint of the round trip, and signs every request with local time plus
 * that offset.
 */
export class BybitClient {
  readonly #credentials: ApiCredentials;
  readonly #hosts: string[];
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  #offsetMs: number | null = null;

  constructor(options: BybitClientOptions) {
    this.#credentials = options.credentials;
    this.#hosts = options.hosts ?? bybitHosts(options.environment);
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? Date.now;
  }

  async get(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const offset = await this.#clockOffset();
    const query = new URLSearchParams(params).toString();
    const headers = signedHeaders(this.#credentials, this.#now() + offset, query);
    const body = await getJson(this.#hosts, query === '' ? path : `${path}?${query}`, this.#fetch, {
      headers,
    });
    return unwrap(body);
  }

  async #clockOffset(): Promise<number> {
    if (this.#offsetMs === null) {
      const sentAt = this.#now();
      const result = unwrap(await getJson(this.#hosts, '/v5/market/time', this.#fetch));
      const receivedAt = this.#now();
      this.#offsetMs = Math.round(serverTimeMs(result) - (sentAt + receivedAt) / 2);
    }
    return this.#offsetMs;
  }
}

function serverTimeMs(result: unknown): number {
  const time = result as { timeNano?: unknown; timeSecond?: unknown } | null;
  if (typeof time?.timeNano === 'string' && /^\d+$/.test(time.timeNano)) {
    return Number(BigInt(time.timeNano) / 1_000_000n);
  }
  if (typeof time?.timeSecond === 'string' && /^\d+$/.test(time.timeSecond)) {
    return Number(time.timeSecond) * 1000;
  }
  throw new Error('Bybit server time response has neither timeNano nor timeSecond');
}

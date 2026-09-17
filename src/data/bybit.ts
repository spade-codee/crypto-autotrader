import Decimal from 'decimal.js';
import { getJson, type FetchLike } from '../net/http.js';
import type { Candle } from '../types.js';

/**
 * Bybit serves its public API from more than one domain. `api.bybit.com` is
 * the primary, but on Nigerian networks it fails DNS resolution under the
 * NCC's February 2024 ISP block (verified 2026-09-17), while Bybit's official
 * alternate domain `api.bytick.com` still answers. Hosts are tried in order.
 */
export const BYBIT_HOSTS = ['https://api.bybit.com', 'https://api.bytick.com'];

const KLINE_PATH = '/v5/market/kline';
const MAX_LIMIT = 1000;
const DAY_MS = 86_400_000;

/**
 * Bybit v5 kline rows arrive as string arrays, newest first:
 *   [startTime, open, high, low, close, volume, turnover]
 * Everything stays a string until it becomes a Decimal, so no precision is
 * lost through a JavaScript number.
 */
export function parseKlineResponse(body: unknown): Candle[] {
  const response = body as {
    retCode?: number;
    retMsg?: string;
    result?: { list?: unknown };
  };

  if (typeof response.retCode === 'number' && response.retCode !== 0) {
    throw new Error(`Bybit error ${response.retCode}: ${response.retMsg ?? 'unknown'}`);
  }
  const list = response.result?.list;
  if (!Array.isArray(list)) {
    throw new Error('Bybit response missing result.list');
  }

  const candles = list.map((row) => {
    if (!Array.isArray(row) || row.length < 6) {
      throw new Error('malformed Bybit kline row');
    }
    return {
      time: Number(row[0]),
      open: new Decimal(String(row[1])),
      high: new Decimal(String(row[2])),
      low: new Decimal(String(row[3])),
      close: new Decimal(String(row[4])),
      volume: new Decimal(String(row[5])),
    };
  });

  // Bybit returns newest first; the rest of the system assumes oldest first.
  return candles.reverse();
}

/**
 * Keeps only daily candles whose day has fully ended by `now`.
 *
 * The exchange includes today's candle while it is still forming, and its
 * "close" is merely the latest price. The strategy decides on daily closes, so
 * acting on an unfinished candle would mean trading on a value that can still
 * change — in the backtest a small distortion, in production a real bug.
 */
export function closedCandles(candles: Candle[], now: number): Candle[] {
  return candles.filter((c) => c.time + DAY_MS <= now);
}

export type FetchCandlesOptions = {
  /**
   * Bybit market. `spot` is what the product trades. `inverse` is the BTCUSD
   * perpetual, whose history reaches back to 2018-11-14 versus spot's
   * 2021-07-05; it is used only as a longer price history for research.
   */
  category?: 'spot' | 'linear' | 'inverse';
  hosts?: string[];
  fetchImpl?: FetchLike;
  /** Epoch ms treated as the current time. Injectable for tests. */
  now?: number;
};

/**
 * Fetches CLOSED daily candles from `start` up to now, paginating forward.
 *
 * Given only a `start`, Bybit returns the OLDEST `limit` candles at or after
 * it (verified against the live API 2026-09-17), so each page continues from
 * the day after the last candle received. Stops when a page returns nothing
 * new, which also guards against looping if the API ever repeats a page.
 */
export async function fetchDailyCandles(
  symbol: string,
  start: Date,
  options: FetchCandlesOptions = {},
): Promise<Candle[]> {
  const category = options.category ?? 'spot';
  const hosts = options.hosts ?? BYBIT_HOSTS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now();

  const all: Candle[] = [];
  let cursor = start.getTime();

  for (;;) {
    const path = `${KLINE_PATH}?category=${category}&symbol=${symbol}&interval=D&start=${cursor}&limit=${MAX_LIMIT}`;
    const page = parseKlineResponse(await getJson(hosts, path, fetchImpl));
    if (page.length === 0) {
      break;
    }

    const fresh = page.filter((c) => c.time > (all[all.length - 1]?.time ?? -1));
    if (fresh.length === 0) {
      break;
    }
    all.push(...fresh);

    cursor = all[all.length - 1]!.time + DAY_MS;
    if (cursor > now) {
      break;
    }
  }

  return closedCandles(all, now);
}

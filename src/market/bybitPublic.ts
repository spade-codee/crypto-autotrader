import Decimal from 'decimal.js';
import { fetchDailyCandles } from '../data/bybit.js';
import { unwrap } from '../exchange/bybit/client.js';
import { bybitHosts } from '../exchange/bybit/hosts.js';
import { getJson, type FetchLike } from '../net/http.js';
import type { Candle } from '../types.js';
import type { BookLevel, OrderBook } from './orderBook.js';
import type { InstrumentRules, MarketData, Ticker } from './types.js';

const DAY_MS = 86_400_000;
const BOOK_DEPTH = 50;

/** A string field that must parse as a finite decimal. Straight from string to Decimal: never a float. */
function decimalField(value: unknown, name: string): Decimal {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Bybit's response is missing ${name}`);
  }
  let parsed: Decimal;
  try {
    parsed = new Decimal(value);
  } catch {
    throw new Error(`Bybit's response has an invalid ${name}`);
  }
  if (!parsed.isFinite()) {
    throw new Error(`Bybit's response has an invalid ${name}`);
  }
  return parsed;
}

function textField(value: unknown, name: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`Bybit's response is missing ${name}`);
  }
  return value;
}

function firstListItem(result: unknown, what: string): Record<string, unknown> {
  const list = (result as { list?: unknown } | null)?.list;
  const item = Array.isArray(list) ? list[0] : undefined;
  if (typeof item !== 'object' || item === null) {
    throw new Error(`Bybit returned no ${what}`);
  }
  return item as Record<string, unknown>;
}

export function parseInstrumentRules(result: unknown, symbol: string): InstrumentRules {
  const item = firstListItem(result, `instrument for ${symbol}`);
  if (item.symbol !== symbol) {
    throw new Error(`Bybit returned the instrument ${String(item.symbol)}, not ${symbol}`);
  }
  if (item.status !== 'Trading') {
    throw new Error(`${symbol} is not trading on Bybit (its status is ${String(item.status)})`);
  }
  const lot = (item.lotSizeFilter ?? {}) as Record<string, unknown>;
  return {
    symbol,
    baseCoin: textField(item.baseCoin, 'baseCoin'),
    quoteCoin: textField(item.quoteCoin, 'quoteCoin'),
    basePrecision: decimalField(lot.basePrecision, 'basePrecision'),
    quotePrecision: decimalField(lot.quotePrecision, 'quotePrecision'),
    minOrderQty: decimalField(lot.minOrderQty, 'minOrderQty'),
    minOrderAmt: decimalField(lot.minOrderAmt, 'minOrderAmt'),
    maxMarketOrderQty: decimalField(lot.maxMarketOrderQty, 'maxMarketOrderQty'),
  };
}

function parseLevels(value: unknown, side: string): BookLevel[] {
  if (!Array.isArray(value)) {
    throw new Error(`Bybit's order book is missing its ${side}`);
  }
  return value.map((row: unknown) => {
    if (!Array.isArray(row) || row.length < 2) {
      throw new Error(`malformed level in Bybit's order book ${side}`);
    }
    return { price: decimalField(row[0], `${side} price`), qty: decimalField(row[1], `${side} size`) };
  });
}

/** Parses the order book, sorting defensively: asks lowest first, bids highest first. */
export function parseOrderBook(result: unknown): OrderBook {
  const book = (result ?? {}) as { a?: unknown; b?: unknown };
  return {
    asks: parseLevels(book.a, 'asks').sort((x, y) => x.price.comparedTo(y.price)),
    bids: parseLevels(book.b, 'bids').sort((x, y) => y.price.comparedTo(x.price)),
  };
}

export function parseTicker(result: unknown, symbol: string): Ticker {
  const item = firstListItem(result, `ticker for ${symbol}`);
  if (item.symbol !== symbol) {
    throw new Error(`Bybit returned the ticker for ${String(item.symbol)}, not ${symbol}`);
  }
  return {
    symbol,
    lastPrice: decimalField(item.lastPrice, 'lastPrice'),
    bid: decimalField(item.bid1Price, 'bid1Price'),
    ask: decimalField(item.ask1Price, 'ask1Price'),
  };
}

export type PublicMarketOptions = { hosts?: string[]; fetchImpl?: FetchLike };

/**
 * Bybit's public market data. Always mainnet: paper trading fills on live
 * prices. Requests go through the host fallback (bybit.com is DNS-blocked on
 * Nigerian networks; bytick.com answers) and the ten-second deadline.
 */
export class BybitPublicMarket implements MarketData {
  readonly #hosts: string[];
  readonly #fetch: FetchLike;

  constructor(options: PublicMarketOptions = {}) {
    this.#hosts = options.hosts ?? bybitHosts('mainnet');
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async getInstrumentRules(symbol: string): Promise<InstrumentRules> {
    return parseInstrumentRules(await this.#get('/v5/market/instruments-info', { category: 'spot', symbol }), symbol);
  }

  async getOrderBook(symbol: string): Promise<OrderBook> {
    return parseOrderBook(
      await this.#get('/v5/market/orderbook', { category: 'spot', symbol, limit: String(BOOK_DEPTH) }),
    );
  }

  async getTicker(symbol: string): Promise<Ticker> {
    return parseTicker(await this.#get('/v5/market/tickers', { category: 'spot', symbol }), symbol);
  }

  async getClosedDailyCandles(symbol: string, count: number, now: number): Promise<Candle[]> {
    // A few days of margin: the newest day may still be open.
    const start = new Date(now - (count + 3) * DAY_MS);
    const candles = await fetchDailyCandles(symbol, start, {
      category: 'spot',
      hosts: this.#hosts,
      fetchImpl: this.#fetch,
      now,
    });
    return candles.slice(-count);
  }

  async #get(path: string, params: Record<string, string>): Promise<unknown> {
    return unwrap(await getJson(this.#hosts, `${path}?${new URLSearchParams(params).toString()}`, this.#fetch));
  }
}

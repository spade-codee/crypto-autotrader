import type Decimal from 'decimal.js';
import type { Candle } from '../types.js';
import type { OrderBook } from './orderBook.js';

/** Bybit's trading rules for one spot pair, from /v5/market/instruments-info. */
export type InstrumentRules = {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  /** Quantity step for the base coin. */
  basePrecision: Decimal;
  /** Amount step for the quote coin. */
  quotePrecision: Decimal;
  minOrderQty: Decimal;
  /** Minimum order value, in the quote coin. */
  minOrderAmt: Decimal;
  maxMarketOrderQty: Decimal;
};

export type Ticker = { symbol: string; lastPrice: Decimal; bid: Decimal; ask: Decimal };

/** Public market data. Nothing here needs an API key. */
export interface MarketData {
  /** Up to `count` of the most recent daily candles whose day has closed by `now`, oldest first. */
  getClosedDailyCandles(symbol: string, count: number, now: number): Promise<Candle[]>;
  getOrderBook(symbol: string): Promise<OrderBook>;
  getTicker(symbol: string): Promise<Ticker>;
  getInstrumentRules(symbol: string): Promise<InstrumentRules>;
}

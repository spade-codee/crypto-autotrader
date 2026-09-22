import type Decimal from 'decimal.js';
import type { OrderBook } from '../../src/market/orderBook.js';
import type { InstrumentRules, MarketData, Ticker } from '../../src/market/types.js';
import type { Candle } from '../../src/types.js';
import { DAY } from './candles.js';
import { bookAround, RULES, tickerAt } from './market.js';

type Method = 'candles' | 'book' | 'ticker' | 'rules';

/**
 * Market data the test controls. `fail` makes a method throw, as a network
 * failure would. `books` queues order books to serve, one per call, before
 * falling back to the standing `book`.
 */
export class FakeMarket implements MarketData {
  candles: Candle[] = [];
  book: OrderBook;
  ticker: Ticker;
  rules: InstrumentRules = RULES;
  books: OrderBook[] = [];
  fail: Partial<Record<Method, Error>> = {};
  calls: Record<Method, number> = { candles: 0, book: 0, ticker: 0, rules: 0 };

  constructor(price: Decimal.Value = '85000') {
    this.book = bookAround(price);
    this.ticker = tickerAt(price);
  }

  setPrice(price: Decimal.Value): void {
    this.book = bookAround(price);
    this.ticker = tickerAt(price);
  }

  async getClosedDailyCandles(_symbol: string, count: number, now: number): Promise<Candle[]> {
    this.#enter('candles');
    return this.candles.filter((c) => c.time + DAY <= now).slice(-count);
  }

  async getOrderBook(): Promise<OrderBook> {
    this.#enter('book');
    return this.books.shift() ?? this.book;
  }

  async getTicker(): Promise<Ticker> {
    this.#enter('ticker');
    return this.ticker;
  }

  async getInstrumentRules(): Promise<InstrumentRules> {
    this.#enter('rules');
    return this.rules;
  }

  #enter(method: Method): void {
    this.calls[method] += 1;
    const error = this.fail[method];
    if (error !== undefined) {
      throw error;
    }
  }
}

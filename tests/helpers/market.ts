import Decimal from 'decimal.js';
import type { CoinBalance } from '../../src/exchange/account.js';
import type { OrderBook } from '../../src/market/orderBook.js';
import type { InstrumentRules, Ticker } from '../../src/market/types.js';

/** Bybit's live BTCUSDT spot rules, fetched 2026-09-22. */
export const RULES: InstrumentRules = {
  symbol: 'BTCUSDT',
  baseCoin: 'BTC',
  quoteCoin: 'USDT',
  basePrecision: new Decimal('0.000001'),
  quotePrecision: new Decimal('0.0000001'),
  minOrderQty: new Decimal('0.000001'),
  minOrderAmt: new Decimal('5'),
  maxMarketOrderQty: new Decimal('120'),
};

/**
 * A one-level BTCUSDT book, `spread` either side of `price`, `qty` deep on each
 * side. FakeMarket re-stamps its time as it serves it.
 */
export function bookAround(
  price: Decimal.Value,
  qty: Decimal.Value = '5',
  spread: Decimal.Value = '0.0001',
): OrderBook {
  const p = new Decimal(price);
  const s = new Decimal(spread);
  return {
    symbol: 'BTCUSDT',
    time: 0,
    asks: [{ price: p.times(new Decimal(1).plus(s)), qty: new Decimal(qty) }],
    bids: [{ price: p.times(new Decimal(1).minus(s)), qty: new Decimal(qty) }],
  };
}

export function tickerAt(price: Decimal.Value): Ticker {
  const p = new Decimal(price);
  return { symbol: 'BTCUSDT', lastPrice: p, bid: p, ask: p };
}

/** BTC and USDT balances, with optional locked and borrowed amounts. */
export function balances(
  btc: string,
  usdt: string,
  options: { lockedBtc?: string; lockedUsdt?: string; borrowedUsdt?: string } = {},
): CoinBalance[] {
  return [
    {
      coin: 'BTC',
      walletBalance: new Decimal(btc),
      locked: new Decimal(options.lockedBtc ?? '0'),
      borrowAmount: new Decimal(0),
    },
    {
      coin: 'USDT',
      walletBalance: new Decimal(usdt),
      locked: new Decimal(options.lockedUsdt ?? '0'),
      borrowAmount: new Decimal(options.borrowedUsdt ?? '0'),
    },
  ];
}

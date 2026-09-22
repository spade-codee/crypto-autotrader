import { describe, expect, it } from 'vitest';
import {
  BybitPublicMarket,
  parseInstrumentRules,
  parseOrderBook,
  parseTicker,
} from '../../src/market/bybitPublic.js';
import { envelope, INSTRUMENTS_RESULT, ORDERBOOK_RESULT, TICKERS_RESULT } from '../fixtures/bybitPublic.js';
import { DAY } from '../helpers/candles.js';

/** Serves one response body for every request and records the URLs. */
function serve(body: unknown) {
  const urls: string[] = [];
  const impl = async (url: string) => {
    urls.push(url);
    return { ok: true, status: 200, json: async () => body };
  };
  return { impl, urls };
}

const marketServing = (body: unknown) => {
  const served = serve(body);
  return { market: new BybitPublicMarket({ hosts: ['https://x.test'], fetchImpl: served.impl }), urls: served.urls };
};

describe('parseInstrumentRules', () => {
  it('reads the lot size filter as decimals', () => {
    const rules = parseInstrumentRules(INSTRUMENTS_RESULT, 'BTCUSDT');
    expect(rules.baseCoin).toBe('BTC');
    expect(rules.quoteCoin).toBe('USDT');
    expect(rules.basePrecision.toFixed()).toBe('0.000001');
    expect(rules.quotePrecision.toFixed()).toBe('0.0000001');
    expect(rules.minOrderQty.toFixed()).toBe('0.000001');
    expect(rules.minOrderAmt.toFixed()).toBe('5');
    expect(rules.maxMarketOrderQty.toFixed()).toBe('120');
  });

  it('refuses a pair that is not trading', () => {
    const halted = { list: [{ ...INSTRUMENTS_RESULT.list[0]!, status: 'PreLaunch' }] };
    expect(() => parseInstrumentRules(halted, 'BTCUSDT')).toThrow('not trading');
  });

  it('refuses a different symbol', () => {
    expect(() => parseInstrumentRules(INSTRUMENTS_RESULT, 'ETHUSDT')).toThrow('not ETHUSDT');
  });

  it('refuses a step or limit that is not above zero', () => {
    const item = INSTRUMENTS_RESULT.list[0]!;
    const zeroStep = { list: [{ ...item, lotSizeFilter: { ...item.lotSizeFilter, basePrecision: '0' } }] };
    expect(() => parseInstrumentRules(zeroStep, 'BTCUSDT')).toThrow('basePrecision that is not above zero');
  });

  it('refuses a missing rule', () => {
    const item = INSTRUMENTS_RESULT.list[0]!;
    const broken = { list: [{ ...item, lotSizeFilter: { ...item.lotSizeFilter, minOrderAmt: undefined } }] };
    expect(() => parseInstrumentRules(broken, 'BTCUSDT')).toThrow('minOrderAmt');
  });
});

describe('parseOrderBook', () => {
  it('sorts asks lowest first and bids highest first', () => {
    const book = parseOrderBook(ORDERBOOK_RESULT, 'BTCUSDT');
    expect(book.asks.map((l) => l.price.toFixed())).toEqual(['85530.5', '85531']);
    expect(book.bids.map((l) => l.price.toFixed())).toEqual(['85530.4', '85530']);
    expect(book.asks[0]!.qty.toFixed()).toBe('0.126626');
  });

  it('keeps the market and the time Bybit generated the book', () => {
    const book = parseOrderBook(ORDERBOOK_RESULT, 'BTCUSDT');
    expect(book.symbol).toBe('BTCUSDT');
    expect(book.time).toBe(1789900000000);
  });

  it('refuses a book for another market', () => {
    expect(() => parseOrderBook({ ...ORDERBOOK_RESULT, s: 'ETHUSDT' }, 'BTCUSDT')).toThrow('ETHUSDT, not BTCUSDT');
    expect(() => parseOrderBook({ ...ORDERBOOK_RESULT, s: undefined }, 'BTCUSDT')).toThrow('not BTCUSDT');
  });

  it.each([undefined, '1789900000000', 0, -1, 1.5, Number.NaN])('refuses a book whose timestamp is %s', (ts) => {
    expect(() => parseOrderBook({ ...ORDERBOOK_RESULT, ts }, 'BTCUSDT')).toThrow('timestamp');
  });

  it('refuses a malformed level', () => {
    expect(() => parseOrderBook({ ...ORDERBOOK_RESULT, a: [['1']] }, 'BTCUSDT')).toThrow('malformed');
  });

  it.each([
    ['a zero price', ['0', '1'], 'not above zero'],
    ['a negative price', ['-85000', '1'], 'not above zero'],
    ['a zero size', ['85000', '0'], 'not above zero'],
    ['a negative size', ['85000', '-0.5'], 'not above zero'],
    ['a price that is not a number', ['abc', '1'], 'invalid'],
    ['an infinite price', ['Infinity', '1'], 'invalid'],
    ['a missing size', ['85000', ''], 'missing'],
  ])('refuses a level with %s', (_name, level, fragment) => {
    expect(() => parseOrderBook({ ...ORDERBOOK_RESULT, b: [level] }, 'BTCUSDT')).toThrow(fragment);
  });
});

describe('parseTicker', () => {
  it('reads the last price and the best bid and ask', () => {
    const ticker = parseTicker(TICKERS_RESULT, 'BTCUSDT');
    expect(ticker.lastPrice.toFixed()).toBe('85530.5');
    expect(ticker.bid.toFixed()).toBe('85530.4');
    expect(ticker.ask.toFixed()).toBe('85530.5');
  });

  it('refuses a price that is not above zero', () => {
    const zero = { list: [{ ...TICKERS_RESULT.list[0]!, lastPrice: '0' }] };
    expect(() => parseTicker(zero, 'BTCUSDT')).toThrow('lastPrice that is not above zero');
  });
});

describe('BybitPublicMarket', () => {
  it('asks for spot instrument rules', async () => {
    const { market, urls } = marketServing(envelope(INSTRUMENTS_RESULT));
    await market.getInstrumentRules('BTCUSDT');
    expect(urls).toEqual(['https://x.test/v5/market/instruments-info?category=spot&symbol=BTCUSDT']);
  });

  it('asks for 50 levels of the spot order book', async () => {
    const { market, urls } = marketServing(envelope(ORDERBOOK_RESULT));
    await market.getOrderBook('BTCUSDT');
    expect(urls).toEqual(['https://x.test/v5/market/orderbook?category=spot&symbol=BTCUSDT&limit=50']);
  });

  it('refuses an order book for a different market than the one asked for', async () => {
    const { market } = marketServing(envelope({ ...ORDERBOOK_RESULT, s: 'ETHUSDT' }));
    await expect(market.getOrderBook('BTCUSDT')).rejects.toThrow('ETHUSDT, not BTCUSDT');
  });

  it('asks for the spot ticker', async () => {
    const { market, urls } = marketServing(envelope(TICKERS_RESULT));
    await market.getTicker('BTCUSDT');
    expect(urls).toEqual(['https://x.test/v5/market/tickers?category=spot&symbol=BTCUSDT']);
  });

  it('turns a non-zero retCode into an error', async () => {
    const { market } = marketServing(envelope(null, 10001, 'params error'));
    await expect(market.getTicker('BTCUSDT')).rejects.toThrow('Bybit error 10001');
  });

  it('returns only the last `count` closed daily candles', async () => {
    const row = (day: number) => [String(day * DAY), '1', '1', '1', '1', '1', '1'];
    // Bybit returns newest first; day 105 is still in progress at `now`.
    const page = envelope({ list: [105, 104, 103, 102, 101, 100].map(row) });
    const { market, urls } = marketServing(page);
    const candles = await market.getClosedDailyCandles('BTCUSDT', 3, 105 * DAY + 3_600_000);
    expect(candles.map((c) => c.time / DAY)).toEqual([102, 103, 104]);
    expect(urls[0]).toContain('category=spot');
    expect(urls[0]).toContain('interval=D');
  });
});

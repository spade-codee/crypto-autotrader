/** The `result` of GET /v5/market/instruments-info?category=spot&symbol=BTCUSDT, fetched 2026-09-22. */
export const INSTRUMENTS_RESULT = {
  category: 'spot',
  list: [
    {
      symbol: 'BTCUSDT',
      baseCoin: 'BTC',
      quoteCoin: 'USDT',
      status: 'Trading',
      lotSizeFilter: {
        basePrecision: '0.000001',
        quotePrecision: '0.0000001',
        minOrderQty: '0.000001',
        maxOrderQty: '230',
        minOrderAmt: '5',
        maxOrderAmt: '8000000',
        maxLimitOrderQty: '230',
        maxMarketOrderQty: '120',
        postOnlyMaxLimitOrderSize: '1150',
      },
      priceFilter: { tickSize: '0.1' },
    },
  ],
};

/** The `result` of GET /v5/market/orderbook — deliberately out of order, to prove the parser sorts. */
export const ORDERBOOK_RESULT = {
  s: 'BTCUSDT',
  a: [
    ['85531.0', '0.5'],
    ['85530.5', '0.126626'],
  ],
  b: [
    ['85530.0', '1.2'],
    ['85530.4', '0.482439'],
  ],
  ts: 1789900000000,
  u: 1,
  seq: 1,
  cts: 1789900000000,
};

/** The `result` of GET /v5/market/tickers?category=spot&symbol=BTCUSDT. */
export const TICKERS_RESULT = {
  category: 'spot',
  list: [
    {
      symbol: 'BTCUSDT',
      bid1Price: '85530.4',
      bid1Size: '0.482439',
      ask1Price: '85530.5',
      ask1Size: '0.126626',
      lastPrice: '85530.5',
      prevPrice24h: '84000',
      price24hPcnt: '0.0182',
      highPrice24h: '86000',
      lowPrice24h: '83900',
      turnover24h: '537000000',
      volume24h: '6300',
      usdIndexPrice: '85520',
    },
  ],
};

/** Wraps a result in Bybit's response envelope. */
export function envelope(result: unknown, retCode = 0, retMsg = 'OK') {
  return { retCode, retMsg, result, retExtInfo: {}, time: 1789900000000 };
}

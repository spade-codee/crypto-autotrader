import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import {
  closedCandles,
  fetchCandles,
  fetchDailyCandles,
  parseKlineResponse,
} from '../../src/data/bybit.js';
import type { Candle } from '../../src/types.js';

const DAY = 86_400_000;

function candleAt(time: number): Candle {
  const one = new Decimal(1);
  return { time, open: one, high: one, low: one, close: one, volume: one };
}

describe('closedCandles', () => {
  it('drops a daily candle whose day has not finished', () => {
    // The strategy acts on daily closes. An in-progress candle's "close" is just
    // the current price, and treating it as final would trade on a guess.
    const now = 2 * DAY + 3_600_000; // one hour into day 2
    const result = closedCandles([candleAt(0), candleAt(DAY), candleAt(2 * DAY)], now);
    expect(result.map((c) => c.time)).toEqual([0, DAY]);
  });

  it('keeps a candle whose day ended exactly now', () => {
    const result = closedCandles([candleAt(0), candleAt(DAY)], 2 * DAY);
    expect(result.map((c) => c.time)).toEqual([0, DAY]);
  });

  it('returns an empty list unchanged', () => {
    expect(closedCandles([], DAY)).toEqual([]);
  });
});

describe('parseKlineResponse', () => {
  it('parses Bybit rows and returns them oldest first', () => {
    // Bybit returns newest first. The parser must reverse that.
    const body = {
      retCode: 0,
      retMsg: 'OK',
      result: {
        list: [
          ['86400000', '110', '120', '105', '115', '20', '2300'],
          ['0', '100', '110', '95', '105', '10', '1050'],
        ],
      },
    };
    const candles = parseKlineResponse(body);

    expect(candles).toHaveLength(2);
    expect(candles[0]!.time).toBe(0);
    expect(candles[0]!.close.toString()).toBe('105');
    expect(candles[1]!.time).toBe(86_400_000);
    expect(candles[1]!.close.toString()).toBe('115');
  });

  it('throws when Bybit reports a non-zero retCode', () => {
    const body = { retCode: 10001, retMsg: 'params error', result: { list: [] } };
    expect(() => parseKlineResponse(body)).toThrow('Bybit error 10001: params error');
  });

  it('returns an empty array when the list is empty', () => {
    expect(parseKlineResponse({ retCode: 0, retMsg: 'OK', result: { list: [] } })).toEqual(
      [],
    );
  });

  it('rejects a response with no result list', () => {
    expect(() => parseKlineResponse({ retCode: 0, retMsg: 'OK' })).toThrow(
      'Bybit response missing result.list',
    );
  });

  it('rejects a row with too few fields', () => {
    const body = { retCode: 0, retMsg: 'OK', result: { list: [['0', '1', '2']] } };
    expect(() => parseKlineResponse(body)).toThrow('malformed Bybit kline row');
  });
});

const row = (time: number) => [String(time), '1', '1', '1', '1', '1', '1'];
const page = (...times: number[]) => ({
  retCode: 0,
  retMsg: 'OK',
  // Bybit returns newest first.
  result: { list: times.map(row).reverse() },
});

/** Serves the given response bodies in order, recording every URL requested. */
function serve(bodies: unknown[]) {
  const urls: string[] = [];
  const impl = async (url: string) => {
    urls.push(url);
    const body = bodies[Math.min(urls.length - 1, bodies.length - 1)];
    return { ok: true, status: 200, json: async () => body };
  };
  return { impl, urls };
}

describe('fetchDailyCandles', () => {
  it('pages forward, requests the given category, and drops the unfinished candle', async () => {
    const now = 2 * DAY + 3_600_000; // day 2 has started but not finished
    const { impl, urls } = serve([page(0, DAY), page(2 * DAY), page()]);

    const candles = await fetchDailyCandles('BTCUSD', new Date(0), {
      category: 'inverse',
      hosts: ['https://x.test'],
      fetchImpl: impl,
      now,
    });

    expect(candles.map((c) => c.time)).toEqual([0, DAY]);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('category=inverse');
    expect(urls[0]).toContain('symbol=BTCUSD');
    expect(urls[0]).toContain('start=0');
    // The second page continues from the day after the last candle received.
    expect(urls[1]).toContain(`start=${2 * DAY}`);
  });

  it('defaults to the spot category', async () => {
    const { impl, urls } = serve([page()]);
    await fetchDailyCandles('BTCUSDT', new Date(0), {
      hosts: ['https://x.test'],
      fetchImpl: impl,
      now: DAY,
    });
    expect(urls[0]).toContain('category=spot');
  });

  it('stops rather than looping forever if the API repeats a page', async () => {
    const { impl, urls } = serve([page(0, DAY)]); // every request returns the same page
    const candles = await fetchDailyCandles('BTCUSDT', new Date(0), {
      hosts: ['https://x.test'],
      fetchImpl: impl,
      now: 100 * DAY,
    });
    expect(candles.map((c) => c.time)).toEqual([0, DAY]);
    expect(urls).toHaveLength(2);
  });
});

describe('closedCandles with an interval', () => {
  it('drops a 15-minute candle that has not finished', () => {
    const q = 900_000;
    const result = closedCandles([candleAt(0), candleAt(q), candleAt(2 * q)], 2 * q + 60_000, q);
    expect(result.map((c) => c.time)).toEqual([0, q]);
  });
});

describe('fetchCandles', () => {
  const q = 900_000;

  it('asks for the interval and continues one interval after the last candle', async () => {
    const { impl, urls } = serve([page(0, q), page(2 * q), page()]);
    const candles = await fetchCandles('BTCUSDT', '15', new Date(0), {
      hosts: ['https://x.test'],
      fetchImpl: impl,
      now: 3 * q,
    });
    expect(candles.map((c) => c.time)).toEqual([0, q, 2 * q]);
    expect(urls[0]).toContain('interval=15');
    expect(urls[1]).toContain(`start=${2 * q}`);
  });

  it('keeps nothing at or after the end, and stops asking past it', async () => {
    const { impl, urls } = serve([page(0, q, 2 * q, 3 * q), page(4 * q)]);
    const candles = await fetchCandles('BTCUSDT', '15', new Date(0), {
      hosts: ['https://x.test'],
      fetchImpl: impl,
      now: 100 * q,
      end: 2 * q,
    });
    expect(candles.map((c) => c.time)).toEqual([0, q]);
    expect(urls).toHaveLength(1);
  });
});

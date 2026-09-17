import { describe, expect, it } from 'vitest';
import { getJson, parseKlineResponse } from '../../src/data/bybit.js';

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

describe('getJson', () => {
  /** A fake fetch keyed by host: 'down' throws like a DNS failure, a number is an HTTP status. */
  function fakeFetch(behaviour: Record<string, 'down' | number>) {
    const calls: string[] = [];
    const impl = async (url: string) => {
      calls.push(url);
      const host = new URL(url).host;
      const b = behaviour[host];
      if (b === 'down' || b === undefined) {
        throw new TypeError('fetch failed');
      }
      return { ok: b >= 200 && b < 300, status: b, json: async () => ({ host }) };
    };
    return { impl, calls };
  }

  it('uses the first host when it answers', async () => {
    const { impl, calls } = fakeFetch({ 'a.test': 200, 'b.test': 200 });
    const body = await getJson(['https://a.test', 'https://b.test'], '/x', impl);
    expect(body).toEqual({ host: 'a.test' });
    expect(calls).toHaveLength(1);
  });

  it('falls back to the next host when a host cannot be reached', async () => {
    // This is the real situation in Nigeria: api.bybit.com fails DNS resolution
    // on blocked networks while api.bytick.com answers.
    const { impl, calls } = fakeFetch({ 'a.test': 'down', 'b.test': 200 });
    const body = await getJson(['https://a.test', 'https://b.test'], '/x', impl);
    expect(body).toEqual({ host: 'b.test' });
    expect(calls).toEqual(['https://a.test/x', 'https://b.test/x']);
  });

  it('does not fall back when a host answers with an HTTP error', async () => {
    // The exchange responded, so the problem is the request, not reachability.
    // Retrying elsewhere would hide a real error.
    const { impl, calls } = fakeFetch({ 'a.test': 429, 'b.test': 200 });
    await expect(getJson(['https://a.test', 'https://b.test'], '/x', impl)).rejects.toThrow(
      'HTTP 429 from https://a.test/x',
    );
    expect(calls).toHaveLength(1);
  });

  it('names every host it tried when none can be reached', async () => {
    const { impl } = fakeFetch({ 'a.test': 'down', 'b.test': 'down' });
    await expect(getJson(['https://a.test', 'https://b.test'], '/x', impl)).rejects.toThrow(
      'could not reach any host: https://a.test, https://b.test',
    );
  });
});

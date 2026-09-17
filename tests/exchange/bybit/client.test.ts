import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { BybitApiError, BybitClient, unwrap } from '../../../src/exchange/bybit/client.js';
import { signedHeaders } from '../../../src/exchange/bybit/sign.js';
import type { RequestOptions } from '../../../src/net/http.js';
import { Secret } from '../../../src/secrets/secret.js';

const CREDENTIALS = { apiKey: new Secret('TESTKEY123'), apiSecret: new Secret('TESTSECRET456') };
const HOSTS = ['https://a.test', 'https://b.test'];

type Call = { url: string; headers?: Record<string, string> };

/**
 * Serves /v5/market/time with the given server time, and every other path with
 * `body`. Hosts listed in `down` throw like a DNS failure.
 */
function fakeBybit(options: { serverTime?: Record<string, string>; body?: unknown; down?: string[] }) {
  const calls: Call[] = [];
  const impl = async (url: string, request?: RequestOptions) => {
    calls.push({ url, headers: request?.headers });
    if ((options.down ?? []).some((host) => url.startsWith(host))) {
      throw new TypeError('fetch failed');
    }
    const body = url.includes('/v5/market/time')
      ? { retCode: 0, retMsg: 'OK', result: options.serverTime ?? { timeSecond: '5', timeNano: '5000000000' } }
      : (options.body ?? { retCode: 0, retMsg: 'OK', result: { ok: true } });
    return { ok: true, status: 200, json: async () => body };
  };
  return { impl, calls };
}

describe('BybitClient', () => {
  it('signs with the server-adjusted time', async () => {
    // Local clock reads 1,000 ms; the server says 5,000 ms. Offset is 4,000.
    const { impl, calls } = fakeBybit({});
    const client = new BybitClient({ environment: 'testnet', credentials: CREDENTIALS, hosts: HOSTS, fetchImpl: impl, now: () => 1000 });

    await client.get('/v5/account/wallet-balance', { accountType: 'UNIFIED' });

    const signed = calls.find((c) => c.url.includes('wallet-balance'))!;
    expect(signed.headers).toEqual(signedHeaders(CREDENTIALS, 5000, 'accountType=UNIFIED'));
    expect(signed.url).toBe('https://a.test/v5/account/wallet-balance?accountType=UNIFIED');
  });

  it('measures the clock only once', async () => {
    const { impl, calls } = fakeBybit({});
    const client = new BybitClient({ environment: 'testnet', credentials: CREDENTIALS, hosts: HOSTS, fetchImpl: impl, now: () => 1000 });

    await client.get('/v5/user/query-api');
    await client.get('/v5/user/query-api');

    expect(calls.filter((c) => c.url.includes('/v5/market/time'))).toHaveLength(1);
  });

  it('falls back to seconds when the server omits nanoseconds', async () => {
    const { impl, calls } = fakeBybit({ serverTime: { timeSecond: '7' } });
    const client = new BybitClient({ environment: 'testnet', credentials: CREDENTIALS, hosts: HOSTS, fetchImpl: impl, now: () => 1000 });

    await client.get('/v5/user/query-api');

    const signed = calls.find((c) => c.url.includes('query-api'))!;
    expect(signed.headers?.['X-BAPI-TIMESTAMP']).toBe('7000');
  });

  it('sends the same signed headers to the fallback host', async () => {
    const { impl, calls } = fakeBybit({ down: ['https://a.test'] });
    const client = new BybitClient({ environment: 'testnet', credentials: CREDENTIALS, hosts: HOSTS, fetchImpl: impl, now: () => 1000 });

    await client.get('/v5/user/query-api');

    const attempts = calls.filter((c) => c.url.includes('query-api'));
    expect(attempts.map((c) => c.url)).toEqual([
      'https://a.test/v5/user/query-api',
      'https://b.test/v5/user/query-api',
    ]);
    expect(attempts[0]!.headers).toEqual(attempts[1]!.headers);
  });

  it('returns the result of a successful response', async () => {
    const { impl } = fakeBybit({ body: { retCode: 0, retMsg: 'OK', result: { answer: 42 } } });
    const client = new BybitClient({ environment: 'testnet', credentials: CREDENTIALS, hosts: HOSTS, fetchImpl: impl, now: () => 1000 });
    expect(await client.get('/v5/user/query-api')).toEqual({ answer: 42 });
  });

  it('raises Bybit error codes as BybitApiError, without the secret', async () => {
    const { impl } = fakeBybit({ body: { retCode: 10004, retMsg: 'error sign!', result: {} } });
    const client = new BybitClient({ environment: 'testnet', credentials: CREDENTIALS, hosts: HOSTS, fetchImpl: impl, now: () => 1000 });

    const error = await client.get('/v5/user/query-api').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BybitApiError);
    expect((error as BybitApiError).retCode).toBe(10004);
    expect(inspect(error)).not.toContain('TESTSECRET456');
  });
});

describe('unwrap', () => {
  it('rejects a body with no retCode', () => {
    expect(() => unwrap({ result: {} })).toThrow('Bybit response missing retCode');
  });
});

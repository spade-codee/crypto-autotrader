import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { BybitApiError, BybitClient, unwrap } from '../../../src/exchange/bybit/client.js';
import { RECV_WINDOW_MS, signedHeaders } from '../../../src/exchange/bybit/sign.js';
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

/**
 * Bybit whose servers keep exactly our time, behind a primary host that stalls
 * for its whole ten-second deadline before the request is given up. The fake
 * clock stands in for real time, so nothing actually waits.
 */
function slowPrimaryBybit(options: { stallsTimeRequest: boolean }) {
  const clock = { now: 1000 };
  const calls: Array<Call & { at: number }> = [];
  const impl = async (url: string, request?: RequestOptions) => {
    calls.push({ url, headers: request?.headers, at: clock.now });
    const isTime = url.includes('/v5/market/time');
    if (url.startsWith('https://a.test') && (options.stallsTimeRequest || !isTime)) {
      clock.now += 10_000;
      throw new Error('the request timed out');
    }
    const result = isTime ? { timeNano: `${clock.now}000000` } : { ok: true };
    return { ok: true, status: 200, json: async () => ({ retCode: 0, retMsg: 'OK', result }) };
  };
  const client = new BybitClient({
    environment: 'testnet',
    credentials: CREDENTIALS,
    hosts: HOSTS,
    fetchImpl: impl,
    now: () => clock.now,
  });
  return { client, calls };
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

  it('signs afresh for the fallback host, so a slow primary cannot make the signature stale', async () => {
    const { client, calls } = slowPrimaryBybit({ stallsTimeRequest: false });

    await client.get('/v5/user/query-api');

    const [primary, fallback] = calls.filter((c) => c.url.includes('query-api'));
    expect(fallback!.url).toBe('https://b.test/v5/user/query-api');
    // The fallback went out ten seconds after the primary attempt — twice Bybit's
    // receive window — so it must carry a timestamp taken as it was sent.
    expect(fallback!.at - primary!.at).toBe(10_000);
    expect(RECV_WINDOW_MS).toBeLessThan(10_000);
    expect(fallback!.headers).toEqual(signedHeaders(CREDENTIALS, fallback!.at, ''));
  });

  it('measures the clock offset around the host that answered, not across the fallback', async () => {
    const { client, calls } = slowPrimaryBybit({ stallsTimeRequest: true });

    await client.get('/v5/user/query-api');

    // The servers' clock is ours, so the right offset is zero. Timing the whole
    // host loop, stall included, would put the midpoint five seconds early and
    // sign every request five seconds ahead: past Bybit's one-second limit.
    const signed = calls.find((c) => c.url === 'https://b.test/v5/user/query-api')!;
    expect(signed.headers?.['X-BAPI-TIMESTAMP']).toBe(String(signed.at));
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

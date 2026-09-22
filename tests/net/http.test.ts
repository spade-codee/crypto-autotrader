import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMEOUT_MS, getJson, raceSignal } from '../../src/net/http.js';

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

describe('getJson', () => {
  it('uses the first host when it answers', async () => {
    const { impl, calls } = fakeFetch({ 'a.test': 200, 'b.test': 200 });
    const body = await getJson(['https://a.test', 'https://b.test'], '/x', impl);
    expect(body).toEqual({ host: 'a.test' });
    expect(calls).toHaveLength(1);
  });

  it('falls back to the next host when a host cannot be reached', async () => {
    const { impl, calls } = fakeFetch({ 'a.test': 'down', 'b.test': 200 });
    const body = await getJson(['https://a.test', 'https://b.test'], '/x', impl);
    expect(body).toEqual({ host: 'b.test' });
    expect(calls).toEqual(['https://a.test/x', 'https://b.test/x']);
  });

  it('does not fall back when a host answers with an HTTP error', async () => {
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

  it('sends the same request headers to every host it tries', async () => {
    const seen: Array<Record<string, string> | undefined> = [];
    const impl = async (url: string, options?: { headers?: Record<string, string> }) => {
      seen.push(options?.headers);
      if (url.startsWith('https://a.test')) {
        throw new TypeError('fetch failed');
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };
    await getJson(['https://a.test', 'https://b.test'], '/x', impl, { headers: { 'X-Test': '1' } });
    expect(seen).toEqual([{ 'X-Test': '1' }, { 'X-Test': '1' }]);
  });
});

describe('getJson deadlines', () => {
  const never = () => new Promise<never>(() => {});

  it('gives up on a host that never answers and tries the next', async () => {
    const calls: string[] = [];
    const impl = async (url: string) => {
      calls.push(url);
      if (url.startsWith('https://slow.test')) {
        return never();
      }
      return { ok: true, status: 200, json: async () => ({ ok: 1 }) };
    };
    const started = Date.now();
    const body = await getJson(['https://slow.test', 'https://fast.test'], '/x', impl, { timeoutMs: 50 });
    expect(body).toEqual({ ok: 1 });
    expect(calls).toEqual(['https://slow.test/x', 'https://fast.test/x']);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('fails within the deadline when every host stalls', async () => {
    const started = Date.now();
    await expect(
      getJson(['https://a.test', 'https://b.test'], '/x', never, { timeoutMs: 50 }),
    ).rejects.toThrow('could not reach any host');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('fails within the deadline when the body never arrives', async () => {
    const impl = async () => ({ ok: true, status: 200, json: never });
    await expect(getJson(['https://a.test'], '/x', impl, { timeoutMs: 50 })).rejects.toThrow(
      'timed out',
    );
  });

  it('hands fetch an abort signal, so a real request is cancelled rather than abandoned', async () => {
    let signal: AbortSignal | undefined;
    const impl = async (_url: string, options?: { signal?: AbortSignal }) => {
      signal = options?.signal;
      return { ok: true, status: 200, json: async () => ({}) };
    };
    await getJson(['https://a.test'], '/x', impl);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('defaults to ten seconds', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(10_000);
  });
});

describe('raceSignal', () => {
  it('returns the result when the work finishes first', async () => {
    await expect(raceSignal(Promise.resolve(7), new AbortController().signal, 'x')).resolves.toBe(7);
  });

  it('rejects when the signal fires first', async () => {
    await expect(raceSignal(new Promise(() => {}), AbortSignal.timeout(20), 'the thing')).rejects.toThrow(
      'the thing timed out',
    );
  });

  it('rejects at once if the signal has already fired', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(raceSignal(new Promise(() => {}), controller.signal, 'x')).rejects.toThrow('x timed out');
  });
});

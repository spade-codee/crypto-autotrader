import { describe, expect, it } from 'vitest';
import { getJson } from '../../src/net/http.js';

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

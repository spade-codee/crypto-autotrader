import { describe, expect, it } from 'vitest';
import { HealthcheckHeartbeat, NoHeartbeat } from '../../src/alerts/heartbeat.js';
import type { PostFetch } from '../../src/alerts/telegram.js';
import { Secret } from '../../src/secrets/secret.js';

const URL_TEXT = 'https://hc-ping.com/private-uuid';

function heartbeat(fetchImpl: PostFetch, lines: string[] = [], timeoutMs?: number) {
  return new HealthcheckHeartbeat({ url: new Secret(URL_TEXT), fetchImpl, log: (l) => lines.push(l), timeoutMs });
}

describe('HealthcheckHeartbeat', () => {
  it('pings the URL and reports success', async () => {
    const urls: string[] = [];
    expect(await heartbeat(async (url) => (urls.push(url), { ok: true, status: 200 })).ping()).toBe(true);
    expect(urls).toEqual([URL_TEXT]);
  });

  it('reports failure, without the URL, when the ping is refused', async () => {
    const lines: string[] = [];
    expect(await heartbeat(async () => ({ ok: false, status: 500 }), lines).ping()).toBe(false);
    expect(lines.join('\n')).toContain('500');
    expect(lines.join('\n')).not.toContain('private-uuid');
  });

  it('reports failure within its deadline when the request stalls', async () => {
    const lines: string[] = [];
    expect(await heartbeat(() => new Promise(() => {}), lines, 30).ping()).toBe(false);
    expect(lines.join('\n')).not.toContain('private-uuid');
  });
});

describe('NoHeartbeat', () => {
  it('does nothing and reports success', async () => {
    expect(await new NoHeartbeat().ping()).toBe(true);
  });
});

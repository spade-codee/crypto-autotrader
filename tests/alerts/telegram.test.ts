import { describe, expect, it } from 'vitest';
import { LogAlerter, TelegramAlerter, type PostFetch } from '../../src/alerts/telegram.js';
import { Secret } from '../../src/secrets/secret.js';

const TOKEN_TEXT = '123456:SECRET-TOKEN';
const TOKEN = new Secret(TOKEN_TEXT);

function alerter(fetchImpl: PostFetch, lines: string[] = [], timeoutMs?: number) {
  return new TelegramAlerter({ token: TOKEN, chatId: '42', prefix: '[paper] ', fetchImpl, log: (l) => lines.push(l), timeoutMs });
}

describe('TelegramAlerter', () => {
  it("posts the message to the bot's chat", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl: PostFetch = async (url, init) => {
      calls.push({ url, body: init.body ?? '' });
      return { ok: true, status: 200 };
    };
    await alerter(fetchImpl).send('hello');
    expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${TOKEN_TEXT}/sendMessage`);
    expect(JSON.parse(calls[0]!.body)).toEqual({ chat_id: '42', text: '[paper] hello', disable_web_page_preview: true });
  });

  it('logs the message, without the token, when Telegram refuses it', async () => {
    const lines: string[] = [];
    await alerter(async () => ({ ok: false, status: 401 }), lines).send('hello');
    expect(lines.join('\n')).toContain('401');
    expect(lines.join('\n')).toContain('hello');
    expect(lines.join('\n')).not.toContain('SECRET-TOKEN');
  });

  it('logs the message, without the token, when Telegram cannot be reached', async () => {
    const lines: string[] = [];
    const fetchImpl: PostFetch = async (url) => {
      throw new TypeError(`fetch failed: ${url}`);
    };
    await alerter(fetchImpl, lines).send('hello');
    expect(lines.join('\n')).toContain('could not be reached');
    expect(lines.join('\n')).not.toContain('SECRET-TOKEN');
  });

  it('gives up on a stalled request within its deadline, and never throws', async () => {
    const lines: string[] = [];
    const started = Date.now();
    await alerter(() => new Promise(() => {}), lines, 30).send('hello');
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(lines.join('\n')).toContain('could not be reached');
  });
});

describe('LogAlerter', () => {
  it('writes the alert to the log', async () => {
    const lines: string[] = [];
    await new LogAlerter((l) => lines.push(l), '[paper] ').send('hello');
    expect(lines).toEqual(['[alert] [paper] hello']);
  });
});

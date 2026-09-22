import { raceSignal } from '../net/http.js';
import type { Secret } from '../secrets/secret.js';

export interface Alerter {
  send(message: string): Promise<void>;
}

export type Log = (line: string) => void;

export type PostFetch = (
  url: string,
  init: { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number }>;

/** Alerts must never hold up a trading run; each request gives up after this long. */
export const ALERT_TIMEOUT_MS = 5_000;

/** Telegram's limit is 4,096 characters. */
const TELEGRAM_LIMIT = 4_000;

/** Writes alerts to the log: used when Telegram is not configured. */
export class LogAlerter implements Alerter {
  constructor(
    private readonly log: Log = console.log,
    private readonly prefix = '',
  ) {}

  async send(message: string): Promise<void> {
    this.log(`[alert] ${this.prefix}${message}`);
  }
}

export type TelegramOptions = {
  token: Secret;
  chatId: string;
  prefix?: string;
  fetchImpl?: PostFetch;
  log?: Log;
  timeoutMs?: number;
};

/**
 * Sends alerts through a Telegram bot. Never throws: an alert that cannot be
 * delivered goes to the log instead. The bot token is part of the request URL,
 * so request errors are never printed.
 */
export class TelegramAlerter implements Alerter {
  readonly #token: Secret;
  readonly #chatId: string;
  readonly #prefix: string;
  readonly #fetch: PostFetch;
  readonly #log: Log;
  readonly #timeoutMs: number;

  constructor(options: TelegramOptions) {
    this.#token = options.token;
    this.#chatId = options.chatId;
    this.#prefix = options.prefix ?? '';
    this.#fetch = options.fetchImpl ?? fetch;
    this.#log = options.log ?? console.log;
    this.#timeoutMs = options.timeoutMs ?? ALERT_TIMEOUT_MS;
  }

  async send(message: string): Promise<void> {
    const text = `${this.#prefix}${message}`.slice(0, TELEGRAM_LIMIT);
    const signal = AbortSignal.timeout(this.#timeoutMs);
    try {
      const response = await raceSignal(
        this.#fetch(`https://api.telegram.org/bot${this.#token.reveal()}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: this.#chatId, text, disable_web_page_preview: true }),
          signal,
        }),
        signal,
        'Telegram',
      );
      if (!response.ok) {
        this.#log(`[alert not delivered: Telegram answered HTTP ${response.status}] ${text}`);
      }
    } catch {
      this.#log(`[alert not delivered: Telegram could not be reached] ${text}`);
    }
  }
}

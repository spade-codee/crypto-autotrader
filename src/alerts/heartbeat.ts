import { raceSignal } from '../net/http.js';
import type { Secret } from '../secrets/secret.js';
import { ALERT_TIMEOUT_MS, type Log, type PostFetch } from './telegram.js';

/**
 * Tells an outside monitor the engine is alive. It catches the one failure the
 * engine cannot report itself: not running at all.
 */
export interface Heartbeat {
  /** True if the ping was recorded. */
  ping(): Promise<boolean>;
}

/** Used when no Healthchecks.io URL is configured. */
export class NoHeartbeat implements Heartbeat {
  async ping(): Promise<boolean> {
    return true;
  }
}

export type HealthcheckOptions = { url: Secret; fetchImpl?: PostFetch; log?: Log; timeoutMs?: number };

/** Pings a Healthchecks.io check. Anyone holding the URL can fake a ping, so it is a Secret and never printed. */
export class HealthcheckHeartbeat implements Heartbeat {
  readonly #url: Secret;
  readonly #fetch: PostFetch;
  readonly #log: Log;
  readonly #timeoutMs: number;

  constructor(options: HealthcheckOptions) {
    this.#url = options.url;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#log = options.log ?? console.log;
    this.#timeoutMs = options.timeoutMs ?? ALERT_TIMEOUT_MS;
  }

  async ping(): Promise<boolean> {
    const signal = AbortSignal.timeout(this.#timeoutMs);
    try {
      const response = await raceSignal(this.#fetch(this.#url.reveal(), { method: 'GET', signal }), signal, 'Healthchecks.io');
      if (response.ok) {
        return true;
      }
      this.#log(`heartbeat not recorded: Healthchecks.io answered HTTP ${response.status}`);
    } catch {
      this.#log('heartbeat not recorded: Healthchecks.io could not be reached');
    }
    return false;
  }
}

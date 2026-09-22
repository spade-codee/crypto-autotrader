/** Headers, plus the signal that enforces a request's deadline. */
export type RequestOptions = { headers?: Record<string, string>; signal?: AbortSignal };

type FetchResponse = { ok: boolean; status: number; json(): Promise<unknown> };
export type FetchLike = (url: string, options?: RequestOptions) => Promise<FetchResponse>;

export type GetOptions = {
  /**
   * The request's headers. A function is called just before every attempt, so
   * each host gets headers built at the moment it is asked: a signed request
   * needs a fresh timestamp, because a fallback can start a whole deadline
   * after the first attempt.
   */
  headers?: Record<string, string> | (() => Record<string, string>);
  /** How long one host may take to answer, response body included. */
  timeoutMs?: number;
  /** The clock that times the attempt that answered. */
  now?: () => number;
};

/** A response body, with when the request that got it was sent and when its answer arrived. */
export type Timed<T> = { body: T; sentAt: number; receivedAt: number };

/**
 * Node's fetch waits up to five minutes for a stalled server. The trading
 * engine holds a lock while it runs, so a hang would silently lose the day.
 * Every request gives up after this long instead.
 */
export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Settles with `work`, or rejects once `signal` aborts — whichever comes first.
 * Racing, rather than trusting the callee to honour the signal, bounds the wait
 * even when an implementation ignores it.
 */
export async function raceSignal<T>(work: Promise<T>, signal: AbortSignal, what: string): Promise<T> {
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error(`${what} timed out`));
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/**
 * GETs `path` from the first host that can be reached.
 *
 * Moves to the next host when a request cannot get an answer at all — a DNS
 * failure, a refused connection, or no response before the deadline. An HTTP
 * error means the server answered, so the problem is the request rather than
 * reachability; retrying on another host would hide it. A body that stalls
 * after the server answered is an error for the same reason.
 */
export async function getJson(
  hosts: string[],
  path: string,
  fetchImpl: FetchLike = fetch,
  options: GetOptions = {},
): Promise<unknown> {
  return (await getJsonTimed(hosts, path, fetchImpl, options)).body;
}

/**
 * getJson, also reporting when the request that answered was sent and when its
 * answer arrived. Only that attempt is timed: hosts that failed before it can
 * add a whole deadline each, which would wreck a measurement of the round trip,
 * such as the clock offset the signed client derives from it.
 */
export async function getJsonTimed(
  hosts: string[],
  path: string,
  fetchImpl: FetchLike = fetch,
  options: GetOptions = {},
): Promise<Timed<unknown>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  for (const host of hosts) {
    const url = `${host}${path}`;
    const signal = AbortSignal.timeout(timeoutMs);
    const headers = typeof options.headers === 'function' ? options.headers() : options.headers;
    const sentAt = now();
    let response: FetchResponse;
    try {
      response = await raceSignal(fetchImpl(url, { headers, signal }), signal, `the request to ${url}`);
    } catch {
      continue;
    }
    const receivedAt = now();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}`);
    }
    const body = await raceSignal(response.json(), signal, `reading the response from ${url}`);
    return { body, sentAt, receivedAt };
  }
  throw new Error(`could not reach any host: ${hosts.join(', ')}`);
}

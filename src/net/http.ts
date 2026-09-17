export type RequestOptions = { headers?: Record<string, string> };

type FetchResponse = { ok: boolean; status: number; json(): Promise<unknown> };
export type FetchLike = (url: string, options?: RequestOptions) => Promise<FetchResponse>;

/**
 * GETs `path` from the first host that can be reached.
 *
 * Moves to the next host ONLY when a request fails to connect at all — a DNS
 * failure or refused connection, which `fetch` signals by throwing. An HTTP
 * error means the server answered, so the problem is the request rather than
 * reachability; retrying on another host would hide it.
 *
 * The same headers go to every host. Bybit signatures cover the path and query
 * but not the host, so a signed request stays valid across hosts.
 */
export async function getJson(
  hosts: string[],
  path: string,
  fetchImpl: FetchLike = fetch,
  options: RequestOptions = {},
): Promise<unknown> {
  for (const host of hosts) {
    const url = `${host}${path}`;
    let response: FetchResponse;
    try {
      response = await fetchImpl(url, options);
    } catch {
      continue;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}`);
    }
    return response.json();
  }
  throw new Error(`could not reach any host: ${hosts.join(', ')}`);
}

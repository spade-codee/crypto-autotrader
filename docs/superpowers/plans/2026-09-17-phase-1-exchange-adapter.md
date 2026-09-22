# Phase 1 — Read-Only Bybit Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store a user's Bybit API key encrypted, prove the key can do nothing beyond spot trading, and read the account's balances — without placing any order.

**Architecture:** A small signed Bybit v5 client of our own (not CCXT, which returns floats) reuses Phase 0's host fallback and syncs to Bybit's clock. Keys are validated against a permission allowlist before anything is stored. Credentials are sealed with AES-256-GCM, bound to their owner, and kept in Postgres through Drizzle — PGlite in development and tests, so no machine needs a database installed. Thin CLI commands drive three testable flows: connect, check, read balances.

**Tech Stack:** TypeScript, Node 20+, Vitest, `decimal.js`, `drizzle-orm` 0.45, `drizzle-kit` 0.31, `@electric-sql/pglite` 0.5, `node:crypto`.

**Spec:** `docs/superpowers/specs/2026-09-17-phase-1-exchange-adapter-design.md` — read it first.

---

## Rules for whoever executes this plan

- **Never ask the founder for an API key or secret, and never type one into anything.** Every test
  in Tasks 1–14 uses fake credentials. Real keys are entered only by the founder, in their own
  terminal, in Task 15.
- **Never read the founder's terminal while they are entering a key.** If hidden input were ever
  to fail, the secret would be on screen.
- **Branch:** all work happens on `phase-1-exchange-adapter`. `git pull` before starting, and
  commit and push after every task — the founder works on two machines.
- **Money and quantities are never JavaScript floats.** Parse exchange strings straight into `Decimal`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/net/http.ts` | `getJson` with host fallback, moved from `src/data/bybit.ts`, now with request headers |
| `src/secrets/secret.ts` | `Secret` — a string that prints as `[redacted]` everywhere |
| `src/exchange/environment.ts` | `Environment` type; parse `BYBIT_ENV` |
| `src/exchange/credentials.ts` | `ApiCredentials` type |
| `src/exchange/account.ts` | `KeyInfo`, `CoinBalance`, `ExchangeAccount` — exchange-agnostic shapes |
| `src/exchange/bybit/hosts.ts` | Hosts per environment, primary then `bytick` |
| `src/exchange/bybit/sign.ts` | HMAC-SHA256 authentication headers |
| `src/exchange/bybit/client.ts` | Signed GET, clock sync, envelope unwrapping, `BybitApiError` |
| `src/exchange/bybit/account.ts` | Parse key info and wallet balance; `BybitAccount` |
| `src/exchange/bybit/keyValidation.ts` | `validateKeyInfo` — the allowlist rules. Pure |
| `src/vault/keyring.ts` | Versioned master keys from the environment |
| `src/vault/crypto.ts` | `seal` / `open` — AES-256-GCM with owner-bound AAD |
| `src/vault/credentialVault.ts` | Store, retrieve, mark validated |
| `src/db/schema.ts` | Drizzle table `exchange_credentials` |
| `src/db/client.ts` | Open PGlite, wrap with Drizzle, run migrations |
| `drizzle.config.ts`, `drizzle/` | Migration generation config and generated SQL |
| `src/app/credentials.ts` | `connectKey`, `checkKey`, `readBalances` |
| `src/cli/env.ts` | Load `.env.local`; read CLI config |
| `src/cli/guidance.ts` | Turn errors into instructions a person can act on |
| `src/cli/prompt.ts` | Visible and hidden terminal input |
| `src/cli/context.ts` | Wire the real dependencies for the CLIs |
| `src/cli/vault-init.ts`, `key-add.ts`, `key-check.ts`, `balance.ts` | The four commands |
| `tests/helpers/vault.ts` | Test keyring and in-memory vault |
| `tests/fixtures/bybit.ts` | Response fixtures shaped after Bybit's documented examples |

Dependencies point one way: `cli → app → (exchange, vault) → (net, secrets, db)`. Nothing in
`src/exchange/` imports from `src/vault/`, and `src/strategy/` stays untouched.

---

## Task 1: Branch, dependencies, and configuration

**Files:**
- Modify: `package.json`, `package-lock.json`, `.gitignore`, `vitest.config.ts`
- Create: `drizzle.config.ts`

- [ ] **Step 1: Create the branch**

```bash
git checkout master
git pull --ff-only
git checkout -b phase-1-exchange-adapter
git push -u origin phase-1-exchange-adapter
```

- [ ] **Step 2: Install dependencies**

```bash
npm install drizzle-orm@^0.45.2 @electric-sql/pglite@^0.5.8
npm install --save-dev drizzle-kit@^0.31.10
```

- [ ] **Step 3: Check production dependencies are clean**

Run: `npm audit --omit=dev`
Expected: `found 0 vulnerabilities`. If not, stop and report before continuing.

- [ ] **Step 4: Add scripts to `package.json`**

Add these entries to the existing `"scripts"` object:

```json
"db:generate": "drizzle-kit generate",
"vault:init": "tsx src/cli/vault-init.ts",
"key:add": "tsx src/cli/key-add.ts",
"key:check": "tsx src/cli/key-check.ts",
"balance": "tsx src/cli/balance.ts"
```

- [ ] **Step 5: Ignore the local database**

Append to `.gitignore`:

```
data/db/
```

Then confirm local secrets are already ignored:

Run: `git check-ignore -v .env.local`
Expected: a line naming `.gitignore` and the pattern `.env.*`.

- [ ] **Step 6: Give database tests enough time**

PGlite compiles WebAssembly on first use, which can exceed Vitest's 5-second default. Replace
`vitest.config.ts` with:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
```

- [ ] **Step 7: Create `drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
```

- [ ] **Step 8: Verify nothing broke**

Run: `npm test && npm run typecheck`
Expected: all Phase 0 tests pass (67), no type errors.

- [ ] **Step 9: Commit and push**

```bash
git add package.json package-lock.json .gitignore vitest.config.ts drizzle.config.ts
git commit -m "chore: add Drizzle and PGlite for Phase 1"
git push
```

---

## Task 2: Move `getJson` to `src/net/http.ts` and add request headers

Signed requests need headers, and both public market data and account access need host
fallback. The function moves to a shared module.

**Files:**
- Create: `src/net/http.ts`
- Modify: `src/data/bybit.ts`
- Create: `tests/net/http.test.ts`
- Modify: `tests/data/bybit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/net/http.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/net/http.test.ts`
Expected: FAIL — cannot resolve `../../src/net/http.js`.

- [ ] **Step 3: Create `src/net/http.ts`**

```ts
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
```

- [ ] **Step 4: Point `src/data/bybit.ts` at the shared module**

In `src/data/bybit.ts`, delete the `type FetchResponse` line, the `export type FetchLike` line, and
the whole `getJson` function with its comment. Replace the import block at the top of the file
with:

```ts
import Decimal from 'decimal.js';
import { getJson, type FetchLike } from '../net/http.js';
import type { Candle } from '../types.js';
```

- [ ] **Step 5: Remove the moved tests from `tests/data/bybit.test.ts`**

Delete the entire `describe('getJson', ...)` block at the end of the file, and change its import to:

```ts
import {
  closedCandles,
  fetchDailyCandles,
  parseKlineResponse,
} from '../../src/data/bybit.js';
```

- [ ] **Step 6: Run the full suite and type check**

Run: `npm test && npm run typecheck`
Expected: all tests pass — the four moved `getJson` tests now run from `tests/net/`, plus the new
header test — and no type errors.

- [ ] **Step 7: Commit and push**

```bash
git add src/net/http.ts src/data/bybit.ts tests/net/http.test.ts tests/data/bybit.test.ts
git commit -m "refactor: move getJson to src/net and support request headers"
git push
```

---

## Task 3: `Secret`

**Files:**
- Create: `src/secrets/secret.ts`
- Test: `tests/secrets/secret.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/secrets/secret.test.ts`:

```ts
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { Secret } from '../../src/secrets/secret.js';

const VALUE = 'sk-very-secret-value-123';

describe('Secret', () => {
  it('reveals its value only when asked explicitly', () => {
    expect(new Secret(VALUE).reveal()).toBe(VALUE);
  });

  it('redacts itself in string interpolation and concatenation', () => {
    const secret = new Secret(VALUE);
    expect(`${secret}`).toBe('[redacted]');
    expect(String(secret)).toBe('[redacted]');
    expect('key=' + secret).toBe('key=[redacted]');
  });

  it('redacts itself in JSON', () => {
    const json = JSON.stringify({ apiSecret: new Secret(VALUE) });
    expect(json).toBe('{"apiSecret":"[redacted]"}');
  });

  it('redacts itself when inspected, including when nested', () => {
    const secret = new Secret(VALUE);
    expect(inspect(secret)).not.toContain(VALUE);
    expect(inspect({ nested: { secret } }, { depth: 10 })).not.toContain(VALUE);
    expect(inspect(secret)).toContain('[redacted]');
  });

  it('does not leak through error messages built from it', () => {
    const error = new Error(`request failed for ${new Secret(VALUE)}`);
    expect(error.message).not.toContain(VALUE);
    expect(inspect(error)).not.toContain(VALUE);
  });

  it('exposes no enumerable properties', () => {
    const secret = new Secret(VALUE);
    expect(Object.keys(secret)).toEqual([]);
    expect(JSON.stringify({ ...secret })).toBe('{}');
  });

  it('rejects an empty value', () => {
    expect(() => new Secret('')).toThrow('a secret cannot be empty');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/secrets/secret.test.ts`
Expected: FAIL — cannot resolve `../../src/secrets/secret.js`.

- [ ] **Step 3: Create `src/secrets/secret.ts`**

```ts
import { inspect } from 'node:util';

const REDACTED = '[redacted]';

/**
 * A sensitive string that cannot leak by accident. String interpolation,
 * JSON serialisation, and console inspection all produce "[redacted]", and
 * the value lives in a private field that nothing can enumerate. Reading it
 * requires an explicit reveal(), which makes every use visible in review.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    if (value.length === 0) {
      throw new Error('a secret cannot be empty');
    }
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return `Secret(${REDACTED})`;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/secrets/secret.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit and push**

```bash
git add src/secrets/secret.ts tests/secrets/secret.test.ts
git commit -m "feat: add Secret wrapper that redacts itself everywhere"
git push
```

---

## Task 4: Environment, credentials type, and Bybit hosts

**Files:**
- Create: `src/exchange/environment.ts`, `src/exchange/credentials.ts`, `src/exchange/bybit/hosts.ts`
- Modify: `src/data/bybit.ts`
- Test: `tests/exchange/environment.test.ts`, `tests/exchange/bybit/hosts.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/exchange/environment.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseEnvironment } from '../../src/exchange/environment.js';

describe('parseEnvironment', () => {
  it('defaults to testnet when unset or empty', () => {
    expect(parseEnvironment(undefined)).toBe('testnet');
    expect(parseEnvironment('')).toBe('testnet');
  });

  it('accepts testnet and mainnet', () => {
    expect(parseEnvironment('testnet')).toBe('testnet');
    expect(parseEnvironment('mainnet')).toBe('mainnet');
  });

  it('rejects anything else rather than guessing', () => {
    expect(() => parseEnvironment('production')).toThrow(
      'BYBIT_ENV must be "testnet" or "mainnet", not "production"',
    );
  });
});
```

Create `tests/exchange/bybit/hosts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bybitHosts } from '../../../src/exchange/bybit/hosts.js';

describe('bybitHosts', () => {
  it('lists mainnet hosts, primary first', () => {
    expect(bybitHosts('mainnet')).toEqual(['https://api.bybit.com', 'https://api.bytick.com']);
  });

  it('lists testnet hosts, primary first', () => {
    expect(bybitHosts('testnet')).toEqual([
      'https://api-testnet.bybit.com',
      'https://api-testnet.bytick.com',
    ]);
  });

  it('returns a copy, so a caller cannot change the list for everyone', () => {
    bybitHosts('mainnet').pop();
    expect(bybitHosts('mainnet')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/exchange`
Expected: FAIL — cannot resolve the modules.

- [ ] **Step 3: Create the three modules**

Create `src/exchange/environment.ts`:

```ts
export type Environment = 'testnet' | 'mainnet';

/** Reads BYBIT_ENV. Unset means testnet: real money always requires saying so. */
export function parseEnvironment(value: string | undefined): Environment {
  if (value === undefined || value === '' || value === 'testnet') {
    return 'testnet';
  }
  if (value === 'mainnet') {
    return 'mainnet';
  }
  throw new Error(`BYBIT_ENV must be "testnet" or "mainnet", not "${value}"`);
}
```

Create `src/exchange/credentials.ts`:

```ts
import type { Secret } from '../secrets/secret.js';

/** Both halves of an exchange API key are treated as secrets. */
export type ApiCredentials = {
  apiKey: Secret;
  apiSecret: Secret;
};
```

Create `src/exchange/bybit/hosts.ts`:

```ts
import type { Environment } from '../environment.js';

/**
 * Bybit API hosts, primary first. On Nigerian networks the bybit.com hosts fail
 * DNS resolution under the NCC's February 2024 block, while Bybit's official
 * alternate bytick.com hosts answer (verified 2026-09-17). Requests fall back in
 * this order.
 */
const HOSTS: Record<Environment, readonly string[]> = {
  mainnet: ['https://api.bybit.com', 'https://api.bytick.com'],
  testnet: ['https://api-testnet.bybit.com', 'https://api-testnet.bytick.com'],
};

export function bybitHosts(environment: Environment): string[] {
  return [...HOSTS[environment]];
}
```

- [ ] **Step 4: Use the shared host list for public market data**

In `src/data/bybit.ts`, replace the `BYBIT_HOSTS` constant and its comment with:

```ts
/** Mainnet hosts in fallback order. See src/exchange/bybit/hosts.ts. */
export const BYBIT_HOSTS = bybitHosts('mainnet');
```

and add this import alongside the others:

```ts
import { bybitHosts } from '../exchange/bybit/hosts.js';
```

- [ ] **Step 5: Run the full suite and type check**

Run: `npm test && npm run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit and push**

```bash
git add src/exchange tests/exchange src/data/bybit.ts
git commit -m "feat: add Bybit environments, hosts, and credential type"
git push
```

---

## Task 5: Keyring

**Files:**
- Create: `src/vault/keyring.ts`
- Test: `tests/vault/keyring.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/vault/keyring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { generateMasterKey, keyringFromEnv } from '../../src/vault/keyring.js';

const key = (fill: number) => Buffer.alloc(32, fill).toString('base64');

describe('keyringFromEnv', () => {
  it('loads a single master key', () => {
    const keyring = keyringFromEnv({ VAULT_MASTER_KEY_V1: key(1), VAULT_ACTIVE_KEY_VERSION: '1' });
    expect(keyring.activeVersion).toBe(1);
    expect(keyring.keys.get(1)).toEqual(Buffer.alloc(32, 1));
  });

  it('keeps older versions loaded so existing records still open', () => {
    const keyring = keyringFromEnv({
      VAULT_MASTER_KEY_V1: key(1),
      VAULT_MASTER_KEY_V2: key(2),
      VAULT_ACTIVE_KEY_VERSION: '2',
    });
    expect(keyring.activeVersion).toBe(2);
    expect([...keyring.keys.keys()].sort()).toEqual([1, 2]);
  });

  it('ignores unrelated environment variables', () => {
    const keyring = keyringFromEnv({
      VAULT_MASTER_KEY_V1: key(1),
      VAULT_ACTIVE_KEY_VERSION: '1',
      PATH: '/usr/bin',
      VAULT_MASTER_KEY_V0: key(9),
      VAULT_MASTER_KEY_VX: key(9),
    });
    expect([...keyring.keys.keys()]).toEqual([1]);
  });

  it('requires an active version', () => {
    expect(() => keyringFromEnv({ VAULT_MASTER_KEY_V1: key(1) })).toThrow(
      'VAULT_ACTIVE_KEY_VERSION is not set',
    );
  });

  it('requires the active version to be a positive integer', () => {
    expect(() =>
      keyringFromEnv({ VAULT_MASTER_KEY_V1: key(1), VAULT_ACTIVE_KEY_VERSION: 'one' }),
    ).toThrow('VAULT_ACTIVE_KEY_VERSION must be a positive integer');
  });

  it('requires the active version to have a key', () => {
    expect(() =>
      keyringFromEnv({ VAULT_MASTER_KEY_V1: key(1), VAULT_ACTIVE_KEY_VERSION: '2' }),
    ).toThrow('VAULT_MASTER_KEY_V2 is not set');
  });

  it('rejects a key of the wrong length without printing it', () => {
    const shortKey = Buffer.alloc(16, 7).toString('base64');
    let message = '';
    try {
      keyringFromEnv({ VAULT_MASTER_KEY_V1: shortKey, VAULT_ACTIVE_KEY_VERSION: '1' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('VAULT_MASTER_KEY_V1 must be 32 bytes');
    expect(message).not.toContain(shortKey);
  });
});

describe('generateMasterKey', () => {
  it('produces 32 random bytes as base64, different each time', () => {
    const a = generateMasterKey();
    const b = generateMasterKey();
    expect(Buffer.from(a, 'base64')).toHaveLength(32);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/vault/keyring.test.ts`
Expected: FAIL — cannot resolve `../../src/vault/keyring.js`.

- [ ] **Step 3: Create `src/vault/keyring.ts`**

```ts
import { randomBytes } from 'node:crypto';

export const MASTER_KEY_BYTES = 32;

export type Keyring = {
  /** The version used to seal new records. */
  activeVersion: number;
  keys: ReadonlyMap<number, Buffer>;
};

const KEY_VARIABLE = /^VAULT_MASTER_KEY_V([1-9]\d*)$/;

/** A new random 256-bit master key, base64-encoded for an environment file. */
export function generateMasterKey(): string {
  return randomBytes(MASTER_KEY_BYTES).toString('base64');
}

/**
 * Reads versioned master keys — VAULT_MASTER_KEY_V1, VAULT_MASTER_KEY_V2, … —
 * and VAULT_ACTIVE_KEY_VERSION, which names the key that seals new records.
 * Older versions stay loaded so records sealed before a rotation still open.
 * Error messages name variables, never their values.
 */
export function keyringFromEnv(env: Record<string, string | undefined>): Keyring {
  const keys = new Map<number, Buffer>();
  for (const [name, value] of Object.entries(env)) {
    const match = KEY_VARIABLE.exec(name);
    if (match === null || value === undefined) {
      continue;
    }
    const key = Buffer.from(value, 'base64');
    if (key.length !== MASTER_KEY_BYTES) {
      throw new Error(
        `${name} must be ${MASTER_KEY_BYTES} bytes of base64 — run npm run vault:init to generate one`,
      );
    }
    keys.set(Number(match[1]), key);
  }

  const activeRaw = env.VAULT_ACTIVE_KEY_VERSION;
  if (activeRaw === undefined) {
    throw new Error('VAULT_ACTIVE_KEY_VERSION is not set — run npm run vault:init');
  }
  const activeVersion = Number(activeRaw);
  if (!Number.isInteger(activeVersion) || activeVersion < 1) {
    throw new Error('VAULT_ACTIVE_KEY_VERSION must be a positive integer');
  }
  if (!keys.has(activeVersion)) {
    throw new Error(
      `VAULT_MASTER_KEY_V${activeVersion} is not set, but VAULT_ACTIVE_KEY_VERSION points to it`,
    );
  }
  return { activeVersion, keys };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/vault/keyring.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit and push**

```bash
git add src/vault/keyring.ts tests/vault/keyring.test.ts
git commit -m "feat: load versioned vault master keys from the environment"
git push
```

---

## Task 6: `seal` and `open`

**Files:**
- Create: `src/vault/crypto.ts`
- Create: `tests/helpers/vault.ts`
- Test: `tests/vault/crypto.test.ts`

- [ ] **Step 1: Create the test keyring helper**

Create `tests/helpers/vault.ts`:

```ts
import { keyringFromEnv, type Keyring } from '../../src/vault/keyring.js';

/**
 * A deterministic keyring for tests. `versions` maps a key version to the byte
 * every position of that 32-byte key is filled with.
 */
export function testKeyring(versions: Record<number, number> = { 1: 1 }, active = 1): Keyring {
  const env: Record<string, string> = { VAULT_ACTIVE_KEY_VERSION: String(active) };
  for (const [version, fill] of Object.entries(versions)) {
    env[`VAULT_MASTER_KEY_V${version}`] = Buffer.alloc(32, fill).toString('base64');
  }
  return keyringFromEnv(env);
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/vault/crypto.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { open, seal, VaultDecryptionError } from '../../src/vault/crypto.js';
import { testKeyring } from '../helpers/vault.js';

const AAD = 'exchange_credentials:alice:bybit:testnet';
const PLAINTEXT = '{"apiKey":"KEY","apiSecret":"SECRET"}';

/** Flips the first byte of a base64 string's decoded bytes. */
function tamper(base64: string): string {
  const bytes = Buffer.from(base64, 'base64');
  bytes[0] = bytes[0]! ^ 0xff;
  return bytes.toString('base64');
}

describe('seal and open', () => {
  it('round-trips', () => {
    const keyring = testKeyring();
    expect(open(seal(PLAINTEXT, keyring, AAD), keyring, AAD)).toBe(PLAINTEXT);
  });

  it('uses a fresh IV every time, so equal plaintexts look different', () => {
    const keyring = testKeyring();
    const a = seal(PLAINTEXT, keyring, AAD);
    const b = seal(PLAINTEXT, keyring, AAD);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('refuses to open a record under a different owner', () => {
    const keyring = testKeyring();
    const sealed = seal(PLAINTEXT, keyring, AAD);
    expect(() => open(sealed, keyring, 'exchange_credentials:mallory:bybit:testnet')).toThrow(
      VaultDecryptionError,
    );
  });

  it('detects a tampered ciphertext', () => {
    const keyring = testKeyring();
    const sealed = seal(PLAINTEXT, keyring, AAD);
    expect(() => open({ ...sealed, ciphertext: tamper(sealed.ciphertext) }, keyring, AAD)).toThrow(
      VaultDecryptionError,
    );
  });

  it('detects a tampered authentication tag', () => {
    const keyring = testKeyring();
    const sealed = seal(PLAINTEXT, keyring, AAD);
    expect(() => open({ ...sealed, authTag: tamper(sealed.authTag) }, keyring, AAD)).toThrow(
      VaultDecryptionError,
    );
  });

  it('fails with a wrong master key, without saying anything useful to an attacker', () => {
    const sealed = seal(PLAINTEXT, testKeyring({ 1: 1 }), AAD);
    expect(() => open(sealed, testKeyring({ 1: 2 }), AAD)).toThrow(
      'credentials could not be decrypted — wrong master key, or the record was altered',
    );
  });

  it('names a missing key version', () => {
    const sealed = seal(PLAINTEXT, testKeyring({ 3: 3 }, 3), AAD);
    expect(() => open(sealed, testKeyring({ 1: 1 }), AAD)).toThrow(
      'record was sealed with master key version 3, which is not loaded',
    );
  });

  it('opens records sealed before a rotation, and seals new ones with the new key', () => {
    const before = seal(PLAINTEXT, testKeyring({ 1: 1 }, 1), AAD);
    const rotated = testKeyring({ 1: 1, 2: 2 }, 2);
    expect(open(before, rotated, AAD)).toBe(PLAINTEXT);
    expect(seal(PLAINTEXT, rotated, AAD).keyVersion).toBe(2);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/vault/crypto.test.ts`
Expected: FAIL — cannot resolve `../../src/vault/crypto.js`.

- [ ] **Step 4: Create `src/vault/crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Keyring } from './keyring.js';

const ALGORITHM = 'aes-256-gcm' as const;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** A sealed payload. Every field except keyVersion is base64. */
export type Sealed = {
  keyVersion: number;
  iv: string;
  authTag: string;
  ciphertext: string;
};

/** Deliberately vague: the reason a decryption failed is useful to an attacker. */
export class VaultDecryptionError extends Error {
  constructor() {
    super('credentials could not be decrypted — wrong master key, or the record was altered');
    this.name = 'VaultDecryptionError';
  }
}

/**
 * Encrypts with AES-256-GCM under the active master key. `aad` is authenticated
 * but not encrypted: it binds the ciphertext to its owner, so the record cannot
 * be opened under any other owner's identity.
 */
export function seal(plaintext: string, keyring: Keyring, aad: string): Sealed {
  const key = keyring.keys.get(keyring.activeVersion);
  if (key === undefined) {
    throw new Error(`no master key for active version ${keyring.activeVersion}`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    keyVersion: keyring.activeVersion,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function open(sealed: Sealed, keyring: Keyring, aad: string): string {
  const key = keyring.keys.get(sealed.keyVersion);
  if (key === undefined) {
    throw new Error(
      `record was sealed with master key version ${sealed.keyVersion}, which is not loaded`,
    );
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(sealed.iv, 'base64'), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new VaultDecryptionError();
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/vault/crypto.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit and push**

```bash
git add src/vault/crypto.ts tests/vault/crypto.test.ts tests/helpers/vault.ts
git commit -m "feat: seal credentials with AES-256-GCM bound to their owner"
git push
```

---

## Task 7: Database schema, migration, and client

**Files:**
- Create: `src/db/schema.ts`, `src/db/client.ts`
- Create (generated): `drizzle/0000_exchange_credentials.sql`, `drizzle/meta/*`
- Test: `tests/db/client.test.ts`

- [ ] **Step 1: Create `src/db/schema.ts`**

```ts
import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * One API key per user, exchange, and environment. Both halves of the key are
 * sealed into `ciphertext` (see src/vault/crypto.ts); only the last four
 * characters of the API key are stored in the clear, as a hint for humans.
 */
export const exchangeCredentials = pgTable(
  'exchange_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    exchange: text('exchange').notNull(),
    environment: text('environment').notNull(),
    apiKeyHint: text('api_key_hint').notNull(),
    keyVersion: integer('key_version').notNull(),
    iv: text('iv').notNull(),
    authTag: text('auth_tag').notNull(),
    ciphertext: text('ciphertext').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('exchange_credentials_owner_idx').on(
      table.userId,
      table.exchange,
      table.environment,
    ),
  ],
);
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate -- --name exchange_credentials`
Expected: creates `drizzle/0000_exchange_credentials.sql` plus `drizzle/meta/_journal.json` and a
snapshot. The SQL contains `CREATE TABLE "exchange_credentials"` and
`CREATE UNIQUE INDEX "exchange_credentials_owner_idx"`.

- [ ] **Step 3: Write the failing test**

Create `tests/db/client.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/client.js';
import { exchangeCredentials } from '../../src/db/schema.js';

const row = {
  userId: 'alice',
  exchange: 'bybit',
  environment: 'testnet',
  apiKeyHint: 'ABCD',
  keyVersion: 1,
  iv: 'aXY=',
  authTag: 'dGFn',
  ciphertext: 'Y3Q=',
};

describe('openDatabase', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('opens an in-memory database with migrations applied', async () => {
    const opened = await openDatabase();
    close = opened.close;
    await opened.db.insert(exchangeCredentials).values(row);
    const rows = await opened.db.select().from(exchangeCredentials);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.createdAt).toBeInstanceOf(Date);
    expect(rows[0]!.validatedAt).toBeNull();
  });

  it('enforces one credential per user, exchange, and environment', async () => {
    const opened = await openDatabase();
    close = opened.close;
    await opened.db.insert(exchangeCredentials).values(row);
    await expect(opened.db.insert(exchangeCredentials).values(row)).rejects.toThrow();
    await opened.db.insert(exchangeCredentials).values({ ...row, environment: 'mainnet' });
    expect(await opened.db.select().from(exchangeCredentials)).toHaveLength(2);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run tests/db/client.test.ts`
Expected: FAIL — cannot resolve `../../src/db/client.js`.

- [ ] **Step 5: Create `src/db/client.ts`**

```ts
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './schema.js';

export type Database = PgliteDatabase<typeof schema>;

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Opens PGlite — real Postgres compiled to WebAssembly, running inside this
 * process — and applies every migration. Without a directory the database is
 * in memory, which is what tests use. Production runs ordinary Postgres from
 * Phase 3, against the same schema and migrations.
 */
export async function openDatabase(
  dataDir?: string,
): Promise<{ db: Database; close: () => Promise<void> }> {
  const client = dataDir === undefined ? new PGlite() : new PGlite(dataDir);
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, close: () => client.close() };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/db/client.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 7: Type check**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit and push**

```bash
git add src/db drizzle tests/db
git commit -m "feat: add exchange_credentials schema with PGlite client and migration"
git push
```

---

## Task 8: Credential vault

**Files:**
- Create: `src/vault/credentialVault.ts`
- Modify: `tests/helpers/vault.ts`
- Test: `tests/vault/credentialVault.test.ts`

- [ ] **Step 1: Extend the test helper**

Replace `tests/helpers/vault.ts` with:

```ts
import { openDatabase, type Database } from '../../src/db/client.js';
import { CredentialVault } from '../../src/vault/credentialVault.js';
import { keyringFromEnv, type Keyring } from '../../src/vault/keyring.js';

/**
 * A deterministic keyring for tests. `versions` maps a key version to the byte
 * every position of that 32-byte key is filled with.
 */
export function testKeyring(versions: Record<number, number> = { 1: 1 }, active = 1): Keyring {
  const env: Record<string, string> = { VAULT_ACTIVE_KEY_VERSION: String(active) };
  for (const [version, fill] of Object.entries(versions)) {
    env[`VAULT_MASTER_KEY_V${version}`] = Buffer.alloc(32, fill).toString('base64');
  }
  return keyringFromEnv(env);
}

/** A vault over a fresh in-memory database. Call close() when done. */
export async function openTestVault(
  keyring: Keyring = testKeyring(),
): Promise<{ vault: CredentialVault; db: Database; close: () => Promise<void> }> {
  const { db, close } = await openDatabase();
  return { vault: new CredentialVault(db, keyring), db, close };
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/vault/credentialVault.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { exchangeCredentials } from '../../src/db/schema.js';
import { Secret } from '../../src/secrets/secret.js';
import { VaultDecryptionError } from '../../src/vault/crypto.js';
import type { CredentialOwner } from '../../src/vault/credentialVault.js';
import { openTestVault } from '../helpers/vault.js';

const ALICE: CredentialOwner = { userId: 'alice', exchange: 'bybit', environment: 'testnet' };
const MALLORY: CredentialOwner = { userId: 'mallory', exchange: 'bybit', environment: 'testnet' };
const AT = new Date('2026-09-17T10:00:00Z');

const credentials = (key: string, secret: string) => ({
  apiKey: new Secret(key),
  apiSecret: new Secret(secret),
});

describe('CredentialVault', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('stores and retrieves credentials', async () => {
    const opened = await openTestVault();
    close = opened.close;
    await opened.vault.store(ALICE, credentials('ALICEKEY1234', 'ALICESECRET'), AT);

    const stored = await opened.vault.retrieve(ALICE);
    expect(stored?.apiKey.reveal()).toBe('ALICEKEY1234');
    expect(stored?.apiSecret.reveal()).toBe('ALICESECRET');
    expect(stored?.apiKeyHint).toBe('1234');
    expect(stored?.validatedAt?.toISOString()).toBe(AT.toISOString());
  });

  it('returns null when nothing is stored for an owner', async () => {
    const opened = await openTestVault();
    close = opened.close;
    expect(await opened.vault.retrieve(ALICE)).toBeNull();
  });

  it('replaces an existing key for the same owner rather than adding another', async () => {
    const opened = await openTestVault();
    close = opened.close;
    await opened.vault.store(ALICE, credentials('OLDKEY000001', 'OLD'), AT);
    await opened.vault.store(ALICE, credentials('NEWKEY000002', 'NEW'), AT);

    expect((await opened.vault.retrieve(ALICE))?.apiSecret.reveal()).toBe('NEW');
    expect(await opened.db.select().from(exchangeCredentials)).toHaveLength(1);
  });

  it('keeps testnet and mainnet keys separate', async () => {
    const opened = await openTestVault();
    close = opened.close;
    await opened.vault.store(ALICE, credentials('TESTNETKEY01', 'T'), AT);
    await opened.vault.store({ ...ALICE, environment: 'mainnet' }, credentials('MAINNETKEY01', 'M'), AT);

    expect((await opened.vault.retrieve(ALICE))?.apiSecret.reveal()).toBe('T');
    expect((await opened.vault.retrieve({ ...ALICE, environment: 'mainnet' }))?.apiSecret.reveal()).toBe('M');
  });

  it('never writes the key or secret to the database in plain text', async () => {
    const opened = await openTestVault();
    close = opened.close;
    await opened.vault.store(ALICE, credentials('PLAINKEY9876', 'PLAINSECRET'), AT);

    const [row] = await opened.db.select().from(exchangeCredentials);
    const everything = JSON.stringify(row);
    expect(everything).not.toContain('PLAINSECRET');
    expect(everything).not.toContain('PLAINKEY9876');
    expect(row!.apiKeyHint).toBe('9876');
  });

  it('refuses to decrypt a row moved onto another owner', async () => {
    const opened = await openTestVault();
    close = opened.close;
    await opened.vault.store(ALICE, credentials('ALICEKEY1234', 'ALICESECRET'), AT);

    await opened.db
      .update(exchangeCredentials)
      .set({ userId: 'mallory' })
      .where(eq(exchangeCredentials.userId, 'alice'));

    await expect(opened.vault.retrieve(MALLORY)).rejects.toThrow(VaultDecryptionError);
  });

  it('records when a key was last validated', async () => {
    const opened = await openTestVault();
    close = opened.close;
    await opened.vault.store(ALICE, credentials('ALICEKEY1234', 'S'), AT);
    const later = new Date('2026-09-18T08:00:00Z');

    await opened.vault.markValidated(ALICE, later);

    expect((await opened.vault.retrieve(ALICE))?.validatedAt?.toISOString()).toBe(later.toISOString());
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/vault/credentialVault.test.ts`
Expected: FAIL — cannot resolve `../../src/vault/credentialVault.js`.

- [ ] **Step 4: Create `src/vault/credentialVault.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { exchangeCredentials } from '../db/schema.js';
import type { ApiCredentials } from '../exchange/credentials.js';
import type { Environment } from '../exchange/environment.js';
import { Secret } from '../secrets/secret.js';
import { open, seal } from './crypto.js';
import type { Keyring } from './keyring.js';

export type CredentialOwner = {
  userId: string;
  exchange: 'bybit';
  environment: Environment;
};

export type StoredCredentials = ApiCredentials & {
  apiKeyHint: string;
  validatedAt: Date | null;
};

/** Binds a sealed record to its owner: a row copied onto another owner will not decrypt. */
function aadFor(owner: CredentialOwner): string {
  return `exchange_credentials:${owner.userId}:${owner.exchange}:${owner.environment}`;
}

function belongsTo(owner: CredentialOwner) {
  return and(
    eq(exchangeCredentials.userId, owner.userId),
    eq(exchangeCredentials.exchange, owner.exchange),
    eq(exchangeCredentials.environment, owner.environment),
  );
}

export class CredentialVault {
  constructor(
    private readonly db: Database,
    private readonly keyring: Keyring,
  ) {}

  /**
   * Seals and saves validated credentials, replacing any the owner already has.
   * Callers must validate a key before storing it — see src/app/credentials.ts.
   */
  async store(owner: CredentialOwner, credentials: ApiCredentials, validatedAt: Date): Promise<void> {
    const apiKey = credentials.apiKey.reveal();
    const sealed = seal(
      JSON.stringify({ apiKey, apiSecret: credentials.apiSecret.reveal() }),
      this.keyring,
      aadFor(owner),
    );
    const values = {
      apiKeyHint: apiKey.slice(-4),
      keyVersion: sealed.keyVersion,
      iv: sealed.iv,
      authTag: sealed.authTag,
      ciphertext: sealed.ciphertext,
      validatedAt,
      updatedAt: validatedAt,
    };
    await this.db
      .insert(exchangeCredentials)
      .values({ ...owner, ...values })
      .onConflictDoUpdate({
        target: [
          exchangeCredentials.userId,
          exchangeCredentials.exchange,
          exchangeCredentials.environment,
        ],
        set: values,
      });
  }

  async retrieve(owner: CredentialOwner): Promise<StoredCredentials | null> {
    const rows = await this.db
      .select()
      .from(exchangeCredentials)
      .where(belongsTo(owner))
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    const plaintext = open(
      { keyVersion: row.keyVersion, iv: row.iv, authTag: row.authTag, ciphertext: row.ciphertext },
      this.keyring,
      aadFor(owner),
    );
    let payload: { apiKey: string; apiSecret: string };
    try {
      payload = JSON.parse(plaintext) as { apiKey: string; apiSecret: string };
    } catch {
      // A JSON parse error message can quote its input, which here is a secret.
      throw new Error('stored credentials are not in the expected format');
    }
    return {
      apiKey: new Secret(payload.apiKey),
      apiSecret: new Secret(payload.apiSecret),
      apiKeyHint: row.apiKeyHint,
      validatedAt: row.validatedAt,
    };
  }

  async markValidated(owner: CredentialOwner, at: Date): Promise<void> {
    await this.db
      .update(exchangeCredentials)
      .set({ validatedAt: at, updatedAt: at })
      .where(belongsTo(owner));
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/vault/credentialVault.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Run the full suite and type check**

Run: `npm test && npm run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 7: Commit and push**

```bash
git add src/vault/credentialVault.ts tests/vault/credentialVault.test.ts tests/helpers/vault.ts
git commit -m "feat: add credential vault storing sealed keys per owner"
git push
```

---

## Task 9: Request signing

**Files:**
- Create: `src/exchange/bybit/sign.ts`
- Test: `tests/exchange/bybit/sign.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/exchange/bybit/sign.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { signedHeaders } from '../../../src/exchange/bybit/sign.js';
import { Secret } from '../../../src/secrets/secret.js';

const CREDENTIALS = { apiKey: new Secret('TESTKEY123'), apiSecret: new Secret('TESTSECRET456') };

describe('signedHeaders', () => {
  it('matches a known signature', () => {
    // HMAC-SHA256("TESTSECRET456", "1700000000000" + "TESTKEY123" + "5000" + "accountType=UNIFIED"),
    // lowercase hex. Computed independently with node:crypto on 2026-09-17.
    const headers = signedHeaders(CREDENTIALS, 1_700_000_000_000, 'accountType=UNIFIED');
    expect(headers).toEqual({
      'X-BAPI-API-KEY': 'TESTKEY123',
      'X-BAPI-TIMESTAMP': '1700000000000',
      'X-BAPI-RECV-WINDOW': '5000',
      'X-BAPI-SIGN': 'c0b7d5fea134a194196a9ae6bb85d0fafc5d11fa84c44aad733b981ff899f0af',
    });
  });

  it('changes the signature when the query changes', () => {
    const a = signedHeaders(CREDENTIALS, 1_700_000_000_000, 'accountType=UNIFIED');
    const b = signedHeaders(CREDENTIALS, 1_700_000_000_000, 'accountType=UNIFIED&coin=BTC');
    expect(a['X-BAPI-SIGN']).not.toBe(b['X-BAPI-SIGN']);
  });

  it('never includes the secret in the headers', () => {
    const headers = signedHeaders(CREDENTIALS, 1_700_000_000_000, '');
    expect(JSON.stringify(headers)).not.toContain('TESTSECRET456');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/exchange/bybit/sign.test.ts`
Expected: FAIL — cannot resolve `../../../src/exchange/bybit/sign.js`.

- [ ] **Step 3: Create `src/exchange/bybit/sign.ts`**

```ts
import { createHmac } from 'node:crypto';
import type { ApiCredentials } from '../credentials.js';

export const RECV_WINDOW_MS = 5000;

/**
 * Bybit v5 HMAC authentication. For a GET request the signed string is
 * timestamp + apiKey + recvWindow + queryString, hashed with HMAC-SHA256 and
 * encoded as lowercase hex. Bybit accepts the request only when
 * serverTime - recvWindow <= timestamp < serverTime + 1000.
 */
export function signedHeaders(
  credentials: ApiCredentials,
  timestamp: number,
  queryString: string,
): Record<string, string> {
  const apiKey = credentials.apiKey.reveal();
  const payload = `${timestamp}${apiKey}${RECV_WINDOW_MS}${queryString}`;
  const signature = createHmac('sha256', credentials.apiSecret.reveal())
    .update(payload)
    .digest('hex');
  return {
    'X-BAPI-API-KEY': apiKey,
    'X-BAPI-TIMESTAMP': String(timestamp),
    'X-BAPI-RECV-WINDOW': String(RECV_WINDOW_MS),
    'X-BAPI-SIGN': signature,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/exchange/bybit/sign.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit and push**

```bash
git add src/exchange/bybit/sign.ts tests/exchange/bybit/sign.test.ts
git commit -m "feat: sign Bybit v5 requests with HMAC-SHA256"
git push
```

---

## Task 10: Signed client with clock sync

**Files:**
- Create: `src/exchange/bybit/client.ts`
- Test: `tests/exchange/bybit/client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/exchange/bybit/client.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/exchange/bybit/client.test.ts`
Expected: FAIL — cannot resolve `../../../src/exchange/bybit/client.js`.

- [ ] **Step 3: Create `src/exchange/bybit/client.ts`**

```ts
import { getJson, type FetchLike } from '../../net/http.js';
import type { ApiCredentials } from '../credentials.js';
import type { Environment } from '../environment.js';
import { bybitHosts } from './hosts.js';
import { signedHeaders } from './sign.js';

/** A non-zero retCode from Bybit. Carries the code and message, never request details. */
export class BybitApiError extends Error {
  constructor(
    readonly retCode: number,
    readonly retMsg: string,
  ) {
    super(`Bybit error ${retCode}: ${retMsg}`);
    this.name = 'BybitApiError';
  }
}

/** Unwraps Bybit's { retCode, retMsg, result } envelope, throwing on any non-zero retCode. */
export function unwrap(body: unknown): unknown {
  const envelope = body as { retCode?: unknown; retMsg?: unknown; result?: unknown } | null;
  if (typeof envelope?.retCode !== 'number') {
    throw new Error('Bybit response missing retCode');
  }
  if (envelope.retCode !== 0) {
    throw new BybitApiError(
      envelope.retCode,
      typeof envelope.retMsg === 'string' ? envelope.retMsg : '',
    );
  }
  return envelope.result;
}

export type BybitClientOptions = {
  environment: Environment;
  credentials: ApiCredentials;
  /** Overrides the environment's host list. For tests. */
  hosts?: string[];
  fetchImpl?: FetchLike;
  now?: () => number;
};

/**
 * Signed GET requests to Bybit v5.
 *
 * Bybit rejects a timestamp more than 1,000 ms ahead of its own clock, and
 * ordinary PC clocks drift further than that. Before its first signed request
 * the client measures the offset between local and server time, using the
 * midpoint of the round trip, and signs every request with local time plus
 * that offset.
 */
export class BybitClient {
  readonly #credentials: ApiCredentials;
  readonly #hosts: string[];
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  #offsetMs: number | null = null;

  constructor(options: BybitClientOptions) {
    this.#credentials = options.credentials;
    this.#hosts = options.hosts ?? bybitHosts(options.environment);
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? Date.now;
  }

  async get(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const offset = await this.#clockOffset();
    const query = new URLSearchParams(params).toString();
    const headers = signedHeaders(this.#credentials, this.#now() + offset, query);
    const body = await getJson(this.#hosts, query === '' ? path : `${path}?${query}`, this.#fetch, {
      headers,
    });
    return unwrap(body);
  }

  async #clockOffset(): Promise<number> {
    if (this.#offsetMs === null) {
      const sentAt = this.#now();
      const result = unwrap(await getJson(this.#hosts, '/v5/market/time', this.#fetch));
      const receivedAt = this.#now();
      this.#offsetMs = Math.round(serverTimeMs(result) - (sentAt + receivedAt) / 2);
    }
    return this.#offsetMs;
  }
}

function serverTimeMs(result: unknown): number {
  const time = result as { timeNano?: unknown; timeSecond?: unknown } | null;
  if (typeof time?.timeNano === 'string' && /^\d+$/.test(time.timeNano)) {
    return Number(BigInt(time.timeNano) / 1_000_000n);
  }
  if (typeof time?.timeSecond === 'string' && /^\d+$/.test(time.timeSecond)) {
    return Number(time.timeSecond) * 1000;
  }
  throw new Error('Bybit server time response has neither timeNano nor timeSecond');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/exchange/bybit/client.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Type check, then commit and push**

Run: `npm run typecheck` — expected: no errors.

```bash
git add src/exchange/bybit/client.ts tests/exchange/bybit/client.test.ts
git commit -m "feat: add signed Bybit client with clock synchronisation"
git push
```

---

## Task 11: Account shapes and Bybit parsers

**Files:**
- Create: `src/exchange/account.ts`, `src/exchange/bybit/account.ts`
- Create: `tests/fixtures/bybit.ts`
- Test: `tests/exchange/bybit/account.test.ts`

- [ ] **Step 1: Create the exchange-agnostic shapes**

Create `src/exchange/account.ts`:

```ts
import type Decimal from 'decimal.js';

/** What an exchange reports about the API key in use. */
export type KeyInfo = {
  readOnly: boolean;
  /** Permission group to permissions, as the exchange names them. */
  permissions: Record<string, string[]>;
  /** IP addresses the key is restricted to. Empty or containing "*" means unrestricted. */
  ips: string[];
  unifiedTradingAccount: boolean;
  /** Null when the key never expires. */
  expiresAt: Date | null;
};

export type CoinBalance = {
  coin: string;
  walletBalance: Decimal;
  locked: Decimal;
  borrowAmount: Decimal;
};

export interface ExchangeAccount {
  getKeyInfo(): Promise<KeyInfo>;
  getBalances(): Promise<CoinBalance[]>;
}
```

- [ ] **Step 2: Create the fixtures**

Create `tests/fixtures/bybit.ts`:

```ts
/**
 * The `result` of GET /v5/user/query-api, copied from Bybit's documented example
 * (fetched 2026-09-17). Note the example is read-only yet lists trade permissions.
 */
export const QUERY_API_RESULT = {
  id: '2208369',
  note: 'testnet',
  apiKey: 'XXXXXXXX',
  readOnly: 1,
  secret: '',
  permissions: {
    ContractTrade: ['Order', 'Position'],
    Spot: ['SpotTrade'],
    Wallet: ['AccountTransfer', 'SubMemberTransfer'],
    Options: [],
    Derivatives: ['DerivativesTrade'],
    CopyTrading: [],
    BlockTrade: [],
    Exchange: ['ExchangeHistory'],
    NFT: [],
    Affiliate: [],
    Earn: ['Earn'],
    FiatP2P: ['FiatP2POrder', 'Advertising'],
    FiatConvertBroker: ['FiatConvertBrokerOrder'],
    FiatGlobalPay: [],
    FiatBitPay: ['FaitPayOrder'],
    BitCard: ['BitCard'],
    ByXPost: ['ByXPost'],
  },
  ips: ['18.181.170.164', '13.212.45.47', '13.212.45.48'],
  type: 1,
  deadlineDay: -2,
  expiredAt: '1970-01-01T00:00:00Z',
  createdAt: '2025-10-13T03:20:45Z',
  unified: 0,
  uta: 1,
  userID: 1448939,
  inviterID: 0,
  vipLevel: 'PRO-1',
  mktMakerLevel: '0',
  affiliateID: 0,
  rsaPublicKey: '',
  isMaster: true,
  parentUid: '0',
  kycLevel: 'LEVEL_1',
  kycRegion: 'MYS',
  isFixApi: false,
};

/**
 * The `result` of GET /v5/account/wallet-balance?accountType=UNIFIED, shaped
 * after Bybit's documented example: every number is a string, and some optional
 * fields arrive as "". Values are illustrative.
 */
export const WALLET_BALANCE_RESULT = {
  list: [
    {
      accountType: 'UNIFIED',
      totalEquity: '1260.12',
      totalWalletBalance: '1260.12',
      coin: [
        { coin: 'BTC', walletBalance: '0.00012345', locked: '0', borrowAmount: '', equity: '0.00012345', usdValue: '9.45' },
        { coin: 'USDT', walletBalance: '1250.123456', locked: '10.5', borrowAmount: '0', equity: '1250.123456', usdValue: '1250.67' },
        { coin: 'ETH', walletBalance: '0', locked: '', borrowAmount: '', equity: '0', usdValue: '0' },
      ],
    },
  ],
};
```

- [ ] **Step 3: Write the failing test**

Create `tests/exchange/bybit/account.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseKeyInfo, parseWalletBalance } from '../../../src/exchange/bybit/account.js';
import { QUERY_API_RESULT, WALLET_BALANCE_RESULT } from '../../fixtures/bybit.js';

describe('parseKeyInfo', () => {
  it("parses Bybit's documented example", () => {
    const info = parseKeyInfo(QUERY_API_RESULT);
    expect(info.readOnly).toBe(true);
    expect(info.unifiedTradingAccount).toBe(true);
    expect(info.ips).toEqual(['18.181.170.164', '13.212.45.47', '13.212.45.48']);
    expect(info.permissions.Spot).toEqual(['SpotTrade']);
    expect(info.permissions.Options).toEqual([]);
  });

  it('treats the 1970 expiry date as never expiring', () => {
    expect(parseKeyInfo(QUERY_API_RESULT).expiresAt).toBeNull();
  });

  it('parses a real expiry date', () => {
    const info = parseKeyInfo({ ...QUERY_API_RESULT, expiredAt: '2026-12-01T00:00:00Z' });
    expect(info.expiresAt?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('rejects a response whose permissions are not lists of strings', () => {
    expect(() => parseKeyInfo({ ...QUERY_API_RESULT, permissions: { Spot: 'SpotTrade' } })).toThrow(
      'permissions.Spot must be a list of strings',
    );
  });

  it('rejects a response with an unexpected readOnly value', () => {
    expect(() => parseKeyInfo({ ...QUERY_API_RESULT, readOnly: 'yes' })).toThrow(
      'readOnly must be 0 or 1',
    );
  });
});

describe('parseWalletBalance', () => {
  it('parses every coin as Decimal, straight from strings', () => {
    const balances = parseWalletBalance(WALLET_BALANCE_RESULT);
    expect(balances.map((b) => b.coin)).toEqual(['BTC', 'USDT', 'ETH']);
    expect(balances[1]!.walletBalance.toString()).toBe('1250.123456');
    expect(balances[1]!.locked.toString()).toBe('10.5');
  });

  it('reads empty optional fields as zero', () => {
    const [btc] = parseWalletBalance(WALLET_BALANCE_RESULT);
    expect(btc!.borrowAmount.isZero()).toBe(true);
  });

  it('returns no balances for an empty account list', () => {
    expect(parseWalletBalance({ list: [] })).toEqual([]);
  });

  it('rejects a coin without a wallet balance', () => {
    expect(() => parseWalletBalance({ list: [{ coin: [{ coin: 'BTC' }] }] })).toThrow(
      'BTC.walletBalance missing',
    );
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run tests/exchange/bybit/account.test.ts`
Expected: FAIL — cannot resolve `../../../src/exchange/bybit/account.js`.

- [ ] **Step 5: Create `src/exchange/bybit/account.ts`**

```ts
import Decimal from 'decimal.js';
import type { CoinBalance, ExchangeAccount, KeyInfo } from '../account.js';
import type { BybitClient } from './client.js';

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Parses the `result` of GET /v5/user/query-api. */
export function parseKeyInfo(result: unknown): KeyInfo {
  if (typeof result !== 'object' || result === null) {
    throw new Error('Bybit key info missing');
  }
  const r = result as Record<string, unknown>;
  if (r.readOnly !== 0 && r.readOnly !== 1) {
    throw new Error('Bybit key info: readOnly must be 0 or 1');
  }
  if (typeof r.permissions !== 'object' || r.permissions === null) {
    throw new Error('Bybit key info: permissions missing');
  }
  const permissions: Record<string, string[]> = {};
  for (const [group, values] of Object.entries(r.permissions as Record<string, unknown>)) {
    if (!isStringList(values)) {
      throw new Error(`Bybit key info: permissions.${group} must be a list of strings`);
    }
    permissions[group] = values;
  }
  if (!isStringList(r.ips)) {
    throw new Error('Bybit key info: ips must be a list of strings');
  }
  if (r.uta !== 0 && r.uta !== 1) {
    throw new Error('Bybit key info: uta must be 0 or 1');
  }

  // Keys that never expire report expiredAt as the Unix epoch, 1970-01-01.
  let expiresAt: Date | null = null;
  if (typeof r.expiredAt === 'string' && r.expiredAt !== '') {
    const parsed = new Date(r.expiredAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('Bybit key info: expiredAt is not a date');
    }
    expiresAt = parsed.getTime() === 0 ? null : parsed;
  }

  return {
    readOnly: r.readOnly === 1,
    permissions,
    ips: r.ips,
    unifiedTradingAccount: r.uta === 1,
    expiresAt,
  };
}

/** Parses the `result` of GET /v5/account/wallet-balance for a Unified Trading Account. */
export function parseWalletBalance(result: unknown): CoinBalance[] {
  const list = (result as { list?: unknown } | null)?.list;
  if (!Array.isArray(list)) {
    throw new Error('Bybit wallet balance: list missing');
  }
  if (list.length === 0) {
    return [];
  }
  const coins = (list[0] as { coin?: unknown }).coin;
  if (!Array.isArray(coins)) {
    throw new Error('Bybit wallet balance: coin list missing');
  }
  return coins.map((raw) => {
    const c = raw as Record<string, unknown>;
    if (typeof c.coin !== 'string' || c.coin === '') {
      throw new Error('Bybit wallet balance: coin name missing');
    }
    return {
      coin: c.coin,
      walletBalance: requiredDecimal(c.walletBalance, `${c.coin}.walletBalance`),
      locked: optionalDecimal(c.locked, `${c.coin}.locked`),
      borrowAmount: optionalDecimal(c.borrowAmount, `${c.coin}.borrowAmount`),
    };
  });
}

/** Bybit sends every number as a string. */
function requiredDecimal(value: unknown, field: string): Decimal {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`Bybit wallet balance: ${field} missing`);
  }
  return new Decimal(value);
}

/** Optional numeric fields arrive as "" when they do not apply. */
function optionalDecimal(value: unknown, field: string): Decimal {
  if (value === undefined || value === '') {
    return new Decimal(0);
  }
  if (typeof value !== 'string') {
    throw new Error(`Bybit wallet balance: ${field} must be a string`);
  }
  return new Decimal(value);
}

export class BybitAccount implements ExchangeAccount {
  constructor(private readonly client: BybitClient) {}

  async getKeyInfo(): Promise<KeyInfo> {
    return parseKeyInfo(await this.client.get('/v5/user/query-api'));
  }

  async getBalances(): Promise<CoinBalance[]> {
    return parseWalletBalance(
      await this.client.get('/v5/account/wallet-balance', { accountType: 'UNIFIED' }),
    );
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/exchange/bybit/account.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 7: Type check, then commit and push**

Run: `npm run typecheck` — expected: no errors.

```bash
git add src/exchange/account.ts src/exchange/bybit/account.ts tests/fixtures tests/exchange/bybit/account.test.ts
git commit -m "feat: parse Bybit key info and wallet balances into exact decimals"
git push
```

---

## Task 12: Key validation

**Files:**
- Create: `src/exchange/bybit/keyValidation.ts`
- Test: `tests/exchange/bybit/keyValidation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/exchange/bybit/keyValidation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { KeyInfo } from '../../../src/exchange/account.js';
import { parseKeyInfo } from '../../../src/exchange/bybit/account.js';
import { validateKeyInfo, type ValidationContext } from '../../../src/exchange/bybit/keyValidation.js';
import { QUERY_API_RESULT } from '../../fixtures/bybit.js';

const NOW = new Date('2026-09-17T00:00:00Z');
const SERVER_IP = '203.0.113.10';
const TESTNET: ValidationContext = { environment: 'testnet', serverIps: [], now: NOW };
const MAINNET: ValidationContext = { environment: 'mainnet', serverIps: [SERVER_IP], now: NOW };

/** A key that passes every rule on mainnet. Tests change one thing at a time. */
function key(overrides: Partial<KeyInfo> = {}): KeyInfo {
  return {
    readOnly: false,
    permissions: { Spot: ['SpotTrade'], Wallet: [], ContractTrade: [], Options: [], Derivatives: [] },
    ips: [SERVER_IP],
    unifiedTradingAccount: true,
    expiresAt: null,
    ...overrides,
  };
}

const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe('validateKeyInfo', () => {
  it('accepts a spot-only key restricted to our server', () => {
    expect(validateKeyInfo(key(), MAINNET)).toEqual({ ok: true, canTradeSpot: true, warnings: [] });
  });

  it('rejects withdrawal permission, naming it', () => {
    const result = validateKeyInfo(key({ permissions: { Spot: ['SpotTrade'], Wallet: ['Withdraw'] } }), MAINNET);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.problems).toContain(
      'Remove the "Wallet: Withdraw" permission from this key. Only Spot trading is allowed.',
    );
  });

  it("rejects every non-spot permission in Bybit's example key", () => {
    const result = validateKeyInfo(parseKeyInfo(QUERY_API_RESULT), TESTNET);
    const permissionProblems = result.ok ? [] : result.problems.filter((p) => p.startsWith('Remove the "'));
    // ContractTrade 2, Wallet 2, Derivatives 1, Exchange 1, Earn 1, FiatP2P 2,
    // FiatConvertBroker 1, FiatBitPay 1, BitCard 1, ByXPost 1.
    expect(permissionProblems).toHaveLength(13);
  });

  it('rejects a permission group Bybit might add in future', () => {
    const result = validateKeyInfo(key({ permissions: { Spot: ['SpotTrade'], Lending: ['Borrow'] } }), MAINNET);
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown permission even inside the Spot group', () => {
    const result = validateKeyInfo(key({ permissions: { Spot: ['SpotTrade', 'SpotMarginTrade'] } }), MAINNET);
    expect(result.ok === false && result.problems).toContain(
      'Remove the "Spot: SpotMarginTrade" permission from this key. Only Spot trading is allowed.',
    );
  });

  it('rejects an account that is not a Unified Trading Account', () => {
    const result = validateKeyInfo(key({ unifiedTradingAccount: false }), MAINNET);
    expect(result.ok).toBe(false);
  });

  describe('on mainnet', () => {
    it('rejects an unrestricted key', () => {
      expect(validateKeyInfo(key({ ips: ['*'] }), MAINNET).ok).toBe(false);
      expect(validateKeyInfo(key({ ips: [] }), MAINNET).ok).toBe(false);
    });

    it('rejects a key that also allows an address that is not our server, naming it', () => {
      const result = validateKeyInfo(key({ ips: [SERVER_IP, '198.51.100.7'] }), MAINNET);
      expect(result.ok === false && result.problems.join(' ')).toContain('198.51.100.7');
    });

    it('rejects every key when SERVER_IPS is not configured', () => {
      const result = validateKeyInfo(key(), { ...MAINNET, serverIps: [] });
      expect(result.ok).toBe(false);
    });
  });

  it('accepts an unrestricted key on testnet, with a warning', () => {
    const result = validateKeyInfo(key({ ips: ['*'] }), TESTNET);
    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toContain('not restricted to an IP address');
  });

  it('rejects an expired key', () => {
    expect(validateKeyInfo(key({ expiresAt: days(-1) }), MAINNET).ok).toBe(false);
  });

  it('warns when a key expires within 14 days', () => {
    const result = validateKeyInfo(key({ expiresAt: days(3) }), MAINNET);
    expect(result.ok).toBe(true);
    expect(result.warnings).toContain('This key expires in 3 days.');
  });

  it('does not warn about an expiry more than 14 days away', () => {
    expect(validateKeyInfo(key({ expiresAt: days(30) }), MAINNET).warnings).toEqual([]);
  });

  it('accepts a read-only key but says it cannot trade', () => {
    const result = validateKeyInfo(key({ readOnly: true }), MAINNET);
    expect(result).toMatchObject({ ok: true, canTradeSpot: false });
    expect(result.warnings.join(' ')).toContain('cannot place spot trades');
  });

  it('treats a read-only key as unable to trade even when it lists SpotTrade', () => {
    // Bybit's own documented example does exactly this.
    const result = validateKeyInfo(key({ readOnly: true, permissions: { Spot: ['SpotTrade'] } }), MAINNET);
    expect(result).toMatchObject({ ok: true, canTradeSpot: false });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/exchange/bybit/keyValidation.test.ts`
Expected: FAIL — cannot resolve `../../../src/exchange/bybit/keyValidation.js`.

- [ ] **Step 3: Create `src/exchange/bybit/keyValidation.ts`**

```ts
import type { KeyInfo } from '../account.js';
import type { Environment } from '../environment.js';

/**
 * The ONLY permissions a key may carry. This is an allowlist on purpose: a
 * blocklist of known-dangerous permissions would silently accept whatever
 * dangerous permission Bybit adds next. Anything not listed is rejected.
 */
const ALLOWED_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  Spot: ['SpotTrade'],
};

const DAY_MS = 86_400_000;
const EXPIRY_WARNING_DAYS = 14;

export type ValidationContext = {
  environment: Environment;
  /** Public IP addresses of our servers. Required to accept a mainnet key. */
  serverIps: string[];
  now: Date;
};

export type KeyValidation =
  | { ok: true; canTradeSpot: boolean; warnings: string[] }
  | { ok: false; problems: string[]; warnings: string[] };

const plural = (count: number, word: string) => (count === 1 ? word : `${word}es`);

export function validateKeyInfo(info: KeyInfo, context: ValidationContext): KeyValidation {
  const problems: string[] = [];
  const warnings: string[] = [];

  for (const [group, granted] of Object.entries(info.permissions)) {
    const allowed = ALLOWED_PERMISSIONS[group] ?? [];
    for (const permission of granted) {
      if (!allowed.includes(permission)) {
        problems.push(
          `Remove the "${group}: ${permission}" permission from this key. Only Spot trading is allowed.`,
        );
      }
    }
  }

  if (!info.unifiedTradingAccount) {
    problems.push(
      'This account is not a Unified Trading Account. Upgrade it in Bybit, then create the key again.',
    );
  }

  const unrestricted = info.ips.length === 0 || info.ips.includes('*');
  if (context.environment === 'mainnet') {
    if (context.serverIps.length === 0) {
      problems.push(
        'SERVER_IPS is not configured, so a mainnet key cannot be checked against our servers.',
      );
    } else if (unrestricted) {
      problems.push(
        `Restrict this key to our server IP ${plural(context.serverIps.length, 'address')}: ${context.serverIps.join(', ')}.`,
      );
    } else {
      const foreign = info.ips.filter((ip) => !context.serverIps.includes(ip));
      if (foreign.length > 0) {
        problems.push(
          `Remove IP ${plural(foreign.length, 'address')} ${foreign.join(', ')} from this key. It must only work from our servers.`,
        );
      }
    }
  } else if (unrestricted) {
    warnings.push(
      'This key is not restricted to an IP address. That is acceptable on testnet, but mainnet keys must be.',
    );
  }

  if (info.expiresAt !== null) {
    const daysLeft = (info.expiresAt.getTime() - context.now.getTime()) / DAY_MS;
    if (daysLeft <= 0) {
      problems.push('This key has expired. Create a new one.');
    } else if (daysLeft <= EXPIRY_WARNING_DAYS) {
      const whole = Math.ceil(daysLeft);
      warnings.push(`This key expires in ${whole} ${whole === 1 ? 'day' : 'days'}.`);
    }
  }

  // Bybit can report a read-only key that still lists trade permissions, so
  // both conditions are required.
  const canTradeSpot = !info.readOnly && (info.permissions.Spot ?? []).includes('SpotTrade');
  if (!canTradeSpot) {
    warnings.push(
      'This key cannot place spot trades. Reading balances works, but trading from Phase 2 onward needs read-write access with "Spot: SpotTrade".',
    );
  }

  return problems.length > 0
    ? { ok: false, problems, warnings }
    : { ok: true, canTradeSpot, warnings };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/exchange/bybit/keyValidation.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit and push**

```bash
git add src/exchange/bybit/keyValidation.ts tests/exchange/bybit/keyValidation.test.ts
git commit -m "feat: validate API keys against a spot-trading-only allowlist"
git push
```

---

## Task 13: Credential flows

**Files:**
- Create: `src/app/credentials.ts`
- Test: `tests/app/credentials.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/app/credentials.test.ts`:

```ts
import Decimal from 'decimal.js';
import { afterEach, describe, expect, it } from 'vitest';
import { checkKey, connectKey, readBalances, type FlowDeps } from '../../src/app/credentials.js';
import type { CoinBalance, ExchangeAccount, KeyInfo } from '../../src/exchange/account.js';
import type { ApiCredentials } from '../../src/exchange/credentials.js';
import { Secret } from '../../src/secrets/secret.js';
import type { CredentialOwner } from '../../src/vault/credentialVault.js';
import { openTestVault } from '../helpers/vault.js';

const OWNER: CredentialOwner = { userId: 'founder', exchange: 'bybit', environment: 'testnet' };
const NOW = new Date('2026-09-17T12:00:00Z');

const goodKey: KeyInfo = {
  readOnly: false,
  permissions: { Spot: ['SpotTrade'], Wallet: [] },
  ips: ['*'],
  unifiedTradingAccount: true,
  expiresAt: null,
};
const withdrawKey: KeyInfo = { ...goodKey, permissions: { Spot: ['SpotTrade'], Wallet: ['Withdraw'] } };

const balance = (coin: string, wallet: string, borrow = '0'): CoinBalance => ({
  coin,
  walletBalance: new Decimal(wallet),
  locked: new Decimal(0),
  borrowAmount: new Decimal(borrow),
});

class FakeAccount implements ExchangeAccount {
  constructor(
    private readonly info: KeyInfo,
    private readonly balances: CoinBalance[] = [],
  ) {}
  async getKeyInfo() {
    return this.info;
  }
  async getBalances() {
    return this.balances;
  }
}

const credentials = (): ApiCredentials => ({
  apiKey: new Secret('FOUNDERKEY42'),
  apiSecret: new Secret('FOUNDERSECRET'),
});

describe('credential flows', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  /** Deps whose exchange reports `info` and `balances`, recording which API keys it was given. */
  async function setup(info: KeyInfo, balances: CoinBalance[] = [], serverIps: string[] = []) {
    const opened = await openTestVault();
    close = opened.close;
    const usedKeys: string[] = [];
    const deps: FlowDeps = {
      vault: opened.vault,
      accountFor: (creds) => {
        usedKeys.push(creds.apiKey.reveal());
        return new FakeAccount(info, balances);
      },
      serverIps,
      now: () => NOW,
    };
    return { deps, vault: opened.vault, usedKeys };
  }

  describe('connectKey', () => {
    it('stores a key that passes validation', async () => {
      const { deps, vault } = await setup(goodKey);
      const result = await connectKey(deps, OWNER, credentials());

      expect(result).toMatchObject({ status: 'stored', apiKeyHint: 'EY42', canTradeSpot: true });
      expect((await vault.retrieve(OWNER))?.apiSecret.reveal()).toBe('FOUNDERSECRET');
    });

    it('never stores a key that fails validation', async () => {
      const { deps, vault } = await setup(withdrawKey);
      const result = await connectKey(deps, OWNER, credentials());

      expect(result.status).toBe('rejected');
      expect(result.status === 'rejected' && result.problems.join(' ')).toContain('Wallet: Withdraw');
      expect(await vault.retrieve(OWNER)).toBeNull();
    });

    it('validates against the owner environment', async () => {
      const { deps, vault } = await setup(goodKey, [], ['203.0.113.10']);
      const result = await connectKey(deps, { ...OWNER, environment: 'mainnet' }, credentials());

      // Unrestricted keys are fine on testnet but not on mainnet.
      expect(result.status).toBe('rejected');
      expect(await vault.retrieve({ ...OWNER, environment: 'mainnet' })).toBeNull();
    });
  });

  describe('checkKey', () => {
    it('reports when no key is stored', async () => {
      const { deps } = await setup(goodKey);
      expect(await checkKey(deps, OWNER)).toEqual({ status: 'no-key' });
    });

    it('uses the stored credentials and refreshes the validation time', async () => {
      const { deps, vault, usedKeys } = await setup(goodKey);
      await vault.store(OWNER, credentials(), new Date('2026-01-01T00:00:00Z'));

      const result = await checkKey(deps, OWNER);

      expect(result).toMatchObject({ status: 'valid', apiKeyHint: 'EY42' });
      expect(usedKeys).toEqual(['FOUNDERKEY42']);
      expect((await vault.retrieve(OWNER))?.validatedAt?.toISOString()).toBe(NOW.toISOString());
    });

    it('reports a stored key whose permissions have since been widened', async () => {
      const { deps, vault } = await setup(withdrawKey);
      const earlier = new Date('2026-01-01T00:00:00Z');
      await vault.store(OWNER, credentials(), earlier);

      const result = await checkKey(deps, OWNER);

      expect(result.status).toBe('invalid');
      expect((await vault.retrieve(OWNER))?.validatedAt?.toISOString()).toBe(earlier.toISOString());
    });
  });

  describe('readBalances', () => {
    it('refuses to use a stored key that no longer passes validation', async () => {
      const { deps, vault } = await setup(withdrawKey, [balance('USDT', '100')]);
      await vault.store(OWNER, credentials(), NOW);

      const result = await readBalances(deps, OWNER);

      expect(result.status).toBe('key-rejected');
    });

    it('returns non-zero balances and flags borrowing', async () => {
      const { deps, vault } = await setup(goodKey, [
        balance('BTC', '0.5'),
        balance('ETH', '0'),
        balance('USDT', '10', '25'),
      ]);
      await vault.store(OWNER, credentials(), NOW);

      const result = await readBalances(deps, OWNER);

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.balances.map((b) => b.coin)).toEqual(['BTC', 'USDT']);
        expect(result.borrowedCoins).toEqual(['USDT']);
      }
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/app/credentials.test.ts`
Expected: FAIL — cannot resolve `../../src/app/credentials.js`.

- [ ] **Step 3: Create `src/app/credentials.ts`**

```ts
import type { CoinBalance, ExchangeAccount } from '../exchange/account.js';
import { validateKeyInfo, type KeyValidation } from '../exchange/bybit/keyValidation.js';
import type { ApiCredentials } from '../exchange/credentials.js';
import type { CredentialOwner, CredentialVault } from '../vault/credentialVault.js';

export type FlowDeps = {
  vault: CredentialVault;
  accountFor: (credentials: ApiCredentials) => ExchangeAccount;
  serverIps: string[];
  now: () => Date;
};

export type ConnectResult =
  | { status: 'stored'; apiKeyHint: string; canTradeSpot: boolean; warnings: string[] }
  | { status: 'rejected'; problems: string[]; warnings: string[] };

export type CheckResult =
  | { status: 'no-key' }
  | { status: 'valid'; apiKeyHint: string; canTradeSpot: boolean; warnings: string[] }
  | { status: 'invalid'; apiKeyHint: string; problems: string[]; warnings: string[] };

export type BalanceResult =
  | { status: 'no-key' }
  | { status: 'key-rejected'; problems: string[] }
  | { status: 'ok'; balances: CoinBalance[]; borrowedCoins: string[] };

async function validate(
  deps: FlowDeps,
  owner: CredentialOwner,
  account: ExchangeAccount,
  now: Date,
): Promise<KeyValidation> {
  return validateKeyInfo(await account.getKeyInfo(), {
    environment: owner.environment,
    serverIps: deps.serverIps,
    now,
  });
}

/** Asks the exchange what the key can do, and stores it only if that passes validation. */
export async function connectKey(
  deps: FlowDeps,
  owner: CredentialOwner,
  credentials: ApiCredentials,
): Promise<ConnectResult> {
  const now = deps.now();
  const validation = await validate(deps, owner, deps.accountFor(credentials), now);
  if (!validation.ok) {
    return { status: 'rejected', problems: validation.problems, warnings: validation.warnings };
  }
  await deps.vault.store(owner, credentials, now);
  return {
    status: 'stored',
    apiKeyHint: credentials.apiKey.reveal().slice(-4),
    canTradeSpot: validation.canTradeSpot,
    warnings: validation.warnings,
  };
}

/**
 * Re-validates the stored key against the exchange's current view of it. A key's
 * permissions can be widened in the exchange's website after it was stored.
 */
export async function checkKey(deps: FlowDeps, owner: CredentialOwner): Promise<CheckResult> {
  const stored = await deps.vault.retrieve(owner);
  if (stored === null) {
    return { status: 'no-key' };
  }
  const now = deps.now();
  const validation = await validate(deps, owner, deps.accountFor(stored), now);
  if (!validation.ok) {
    return {
      status: 'invalid',
      apiKeyHint: stored.apiKeyHint,
      problems: validation.problems,
      warnings: validation.warnings,
    };
  }
  await deps.vault.markValidated(owner, now);
  return {
    status: 'valid',
    apiKeyHint: stored.apiKeyHint,
    canTradeSpot: validation.canTradeSpot,
    warnings: validation.warnings,
  };
}

/**
 * Reads balances with the stored key — but only after re-validating it. A key
 * that no longer passes is never used, which is the rule every later phase that
 * trades must follow too.
 */
export async function readBalances(deps: FlowDeps, owner: CredentialOwner): Promise<BalanceResult> {
  const stored = await deps.vault.retrieve(owner);
  if (stored === null) {
    return { status: 'no-key' };
  }
  const account = deps.accountFor(stored);
  const validation = await validate(deps, owner, account, deps.now());
  if (!validation.ok) {
    return { status: 'key-rejected', problems: validation.problems };
  }
  const balances = (await account.getBalances()).filter(
    (b) => !b.walletBalance.isZero() || !b.borrowAmount.isZero(),
  );
  return {
    status: 'ok',
    balances,
    borrowedCoins: balances.filter((b) => b.borrowAmount.gt(0)).map((b) => b.coin),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/app/credentials.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run the full suite and type check**

Run: `npm test && npm run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit and push**

```bash
git add src/app tests/app
git commit -m "feat: add connect, check, and balance flows that never use an invalid key"
git push
```

---

## Task 14: Command-line tools

**Files:**
- Create: `src/cli/env.ts`, `src/cli/guidance.ts`, `src/cli/prompt.ts`, `src/cli/context.ts`
- Create: `src/cli/vault-init.ts`, `src/cli/key-add.ts`, `src/cli/key-check.ts`, `src/cli/balance.ts`
- Test: `tests/cli/env.test.ts`, `tests/cli/guidance.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/cli/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readConfig } from '../../src/cli/env.js';

describe('readConfig', () => {
  it('defaults to testnet, the founder, and the local database directory', () => {
    expect(readConfig({})).toEqual({
      environment: 'testnet',
      userId: 'founder',
      dbDir: 'data/db',
      serverIps: [],
    });
  });

  it('reads a comma-separated list of server IP addresses', () => {
    expect(readConfig({ SERVER_IPS: ' 203.0.113.10, 203.0.113.11 ,' }).serverIps).toEqual([
      '203.0.113.10',
      '203.0.113.11',
    ]);
  });

  it('rejects an unknown environment', () => {
    expect(() => readConfig({ BYBIT_ENV: 'live' })).toThrow('BYBIT_ENV must be');
  });
});
```

Create `tests/cli/guidance.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { explainError } from '../../src/cli/guidance.js';
import { BybitApiError } from '../../src/exchange/bybit/client.js';
import { VaultDecryptionError } from '../../src/vault/crypto.js';

describe('explainError', () => {
  it('turns a known Bybit code into an instruction', () => {
    expect(explainError(new BybitApiError(10004, 'error sign!'))).toContain(
      'The API secret does not match this key',
    );
  });

  it('shows the code and message for an unknown Bybit code', () => {
    expect(explainError(new BybitApiError(99999, 'something new'))).toBe(
      'Bybit returned error 99999: something new',
    );
  });

  it('explains a vault that cannot be decrypted', () => {
    expect(explainError(new VaultDecryptionError())).toContain('original master key');
  });

  it('falls back to the error message', () => {
    expect(explainError(new Error('plain failure'))).toBe('plain failure');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/cli`
Expected: FAIL — cannot resolve the modules.

- [ ] **Step 3: Create `src/cli/env.ts`**

```ts
import { parseEnvironment, type Environment } from '../exchange/environment.js';

export const ENV_FILE = '.env.local';

export type CliConfig = {
  environment: Environment;
  userId: string;
  dbDir: string;
  serverIps: string[];
};

/** Loads .env.local into process.env when it exists. */
export function loadLocalEnv(): void {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

export function readConfig(env: Record<string, string | undefined> = process.env): CliConfig {
  return {
    environment: parseEnvironment(env.BYBIT_ENV),
    userId: env.USER_ID?.trim() || 'founder',
    dbDir: env.DB_DIR?.trim() || 'data/db',
    serverIps: (env.SERVER_IPS ?? '')
      .split(',')
      .map((ip) => ip.trim())
      .filter((ip) => ip !== ''),
  };
}
```

- [ ] **Step 4: Create `src/cli/guidance.ts`**

```ts
import { BybitApiError } from '../exchange/bybit/client.js';
import { VaultDecryptionError } from '../vault/crypto.js';

const BYBIT_GUIDANCE: Record<number, string> = {
  10002:
    "Bybit rejected the request time. Make sure this computer's clock is set automatically, then try again.",
  10003:
    'Bybit does not recognise this API key. Check it was copied in full, and that a testnet key is used with BYBIT_ENV=testnet (the default) and a mainnet key with BYBIT_ENV=mainnet.',
  10004:
    'The API secret does not match this key. Copy the secret again. Bybit shows it only once, so you may need to create a new key.',
  10005: 'This key lacks a permission the request needs. Run npm run key:check for details.',
  10010: "This key is restricted to IP addresses that do not include this computer's.",
};

/** Turns an error into a sentence a person can act on. Never includes secrets. */
export function explainError(error: unknown): string {
  if (error instanceof BybitApiError) {
    return BYBIT_GUIDANCE[error.retCode] ?? `Bybit returned error ${error.retCode}: ${error.retMsg}`;
  }
  if (error instanceof VaultDecryptionError) {
    return `${error.message}. If .env.local was replaced, the original master key is needed to read credentials stored with it.`;
  }
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/cli`
Expected: PASS, 7 tests.

- [ ] **Step 6: Create `src/cli/prompt.ts`**

This module needs a real terminal and has no automated test; Task 15 checks it by hand.

```ts
import { createInterface } from 'node:readline';

export function requireInteractiveTerminal(): void {
  if (!process.stdin.isTTY) {
    throw new Error(
      'This command reads secrets and must run in an interactive terminal such as PowerShell or Windows Terminal, not through a pipe.',
    );
  }
}

/** Reads one line, echoed as typed. */
export function ask(question: string): Promise<string> {
  requireInteractiveTerminal();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Reads one line without echoing it, using raw mode rather than readline
 * internals. Handles Enter, Backspace, and Ctrl+C, and strips bracketed-paste
 * markers some terminals wrap around pasted text.
 */
export function askHidden(question: string): Promise<string> {
  requireInteractiveTerminal();
  const stdin = process.stdin;
  process.stdout.write(question);
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();

  return new Promise((resolve, reject) => {
    let value = '';

    const cleanUp = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
    };

    function onData(chunk: string) {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          cleanUp();
          resolve(value.replace(/\[20[01]~/g, '').trim());
          return;
        }
        if (char === '') {
          cleanUp();
          reject(new Error('Cancelled.'));
          return;
        }
        if (char === '' || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    }

    stdin.on('data', onData);
  });
}
```

- [ ] **Step 7: Create `src/cli/context.ts`**

```ts
import { mkdirSync } from 'node:fs';
import type { FlowDeps } from '../app/credentials.js';
import { openDatabase } from '../db/client.js';
import { BybitAccount } from '../exchange/bybit/account.js';
import { BybitClient } from '../exchange/bybit/client.js';
import { CredentialVault, type CredentialOwner } from '../vault/credentialVault.js';
import { keyringFromEnv } from '../vault/keyring.js';
import { loadLocalEnv, readConfig } from './env.js';
import { explainError } from './guidance.js';

/**
 * Wires the real vault, database, and Bybit client. Loads the keyring before
 * anything else, so a missing master key fails before anyone types a secret.
 */
export async function openContext(): Promise<{
  deps: FlowDeps;
  owner: CredentialOwner;
  close: () => Promise<void>;
}> {
  loadLocalEnv();
  const config = readConfig();
  const keyring = keyringFromEnv(process.env);
  mkdirSync(config.dbDir, { recursive: true });
  const { db, close } = await openDatabase(config.dbDir);
  return {
    deps: {
      vault: new CredentialVault(db, keyring),
      accountFor: (credentials) =>
        new BybitAccount(new BybitClient({ environment: config.environment, credentials })),
      serverIps: config.serverIps,
      now: () => new Date(),
    },
    owner: { userId: config.userId, exchange: 'bybit', environment: config.environment },
    close,
  };
}

/** Runs a command body and prints guidance instead of a stack trace on failure. */
export async function runCli(body: () => Promise<number>): Promise<void> {
  try {
    process.exitCode = await body();
  } catch (error) {
    console.error(explainError(error));
    process.exitCode = 1;
  }
}

export function printList(prefix: string, lines: string[], write: (line: string) => void): void {
  for (const line of lines) {
    write(`  ${prefix} ${line}`);
  }
}
```

- [ ] **Step 8: Create `src/cli/vault-init.ts`**

```ts
import { existsSync, writeFileSync } from 'node:fs';
import { generateMasterKey } from '../vault/keyring.js';
import { ENV_FILE } from './env.js';

if (existsSync(ENV_FILE)) {
  console.error(`${ENV_FILE} already exists, so nothing was changed.`);
  console.error('Replacing its master key would make every credential stored with it unreadable.');
  process.exit(1);
}

writeFileSync(
  ENV_FILE,
  [
    '# Secrets for this machine only. Never commit this file.',
    '# Losing VAULT_MASTER_KEY_V1 makes every credential stored with it unreadable.',
    'BYBIT_ENV=testnet',
    'VAULT_ACTIVE_KEY_VERSION=1',
    `VAULT_MASTER_KEY_V1=${generateMasterKey()}`,
    '',
  ].join('\n'),
  // 'wx' refuses to overwrite even if the file appeared since the check above.
  { encoding: 'utf8', flag: 'wx', mode: 0o600 },
);

console.log(`Created ${ENV_FILE} with a new vault master key for this machine.`);
console.log('Back it up somewhere safe: without it, credentials stored here cannot be read.');
```

- [ ] **Step 9: Create `src/cli/key-add.ts`**

```ts
import { connectKey } from '../app/credentials.js';
import { Secret } from '../secrets/secret.js';
import { openContext, printList, runCli } from './context.js';
import { ask, askHidden, requireInteractiveTerminal } from './prompt.js';

await runCli(async () => {
  // Before the vault or database is touched: secrets must never arrive through a pipe.
  requireInteractiveTerminal();
  const { deps, owner, close } = await openContext();
  try {
    console.log(`Connecting a Bybit ${owner.environment} API key for "${owner.userId}".`);
    const apiKey = await ask('API key: ');
    const apiSecret = await askHidden('API secret (typing is hidden): ');
    if (apiKey === '' || apiSecret === '') {
      console.error('Both the API key and the secret are required. Nothing was stored.');
      return 1;
    }

    const result = await connectKey(deps, owner, {
      apiKey: new Secret(apiKey),
      apiSecret: new Secret(apiSecret),
    });

    if (result.status === 'rejected') {
      console.error('This key was NOT stored. Fix these in Bybit, then run key:add again:');
      printList('-', result.problems, console.error);
      printList('!', result.warnings, console.error);
      return 1;
    }
    console.log(`Stored the key ending ...${result.apiKeyHint} for ${owner.environment}, encrypted.`);
    console.log(result.canTradeSpot ? 'It can place spot trades.' : 'It cannot place trades.');
    printList('!', result.warnings, console.log);
    return 0;
  } finally {
    await close();
  }
});
```

- [ ] **Step 10: Create `src/cli/key-check.ts`**

```ts
import { checkKey } from '../app/credentials.js';
import { openContext, printList, runCli } from './context.js';

await runCli(async () => {
  const { deps, owner, close } = await openContext();
  try {
    const result = await checkKey(deps, owner);
    if (result.status === 'no-key') {
      console.error(`No ${owner.environment} key is stored for "${owner.userId}". Run npm run key:add first.`);
      return 1;
    }
    if (result.status === 'invalid') {
      console.error(`The key ending ...${result.apiKeyHint} no longer passes validation:`);
      printList('-', result.problems, console.error);
      printList('!', result.warnings, console.error);
      return 1;
    }
    console.log(`The key ending ...${result.apiKeyHint} passes validation on ${owner.environment}.`);
    console.log(result.canTradeSpot ? 'It can place spot trades.' : 'It cannot place trades.');
    printList('!', result.warnings, console.log);
    return 0;
  } finally {
    await close();
  }
});
```

- [ ] **Step 11: Create `src/cli/balance.ts`**

```ts
import { readBalances } from '../app/credentials.js';
import { openContext, printList, runCli } from './context.js';

await runCli(async () => {
  const { deps, owner, close } = await openContext();
  try {
    const result = await readBalances(deps, owner);
    if (result.status === 'no-key') {
      console.error(`No ${owner.environment} key is stored for "${owner.userId}". Run npm run key:add first.`);
      return 1;
    }
    if (result.status === 'key-rejected') {
      console.error('The stored key no longer passes validation, so it was not used:');
      printList('-', result.problems, console.error);
      return 1;
    }

    console.log(`Balances on ${owner.environment}:`);
    if (result.balances.length === 0) {
      console.log('  (none)');
    }
    for (const b of result.balances) {
      const locked = b.locked.isZero() ? '' : `  (locked ${b.locked.toFixed()})`;
      console.log(`  ${b.coin.padEnd(8)} ${b.walletBalance.toFixed()}${locked}`);
    }
    if (result.borrowedCoins.length > 0) {
      console.error(
        `Borrowed funds on ${result.borrowedCoins.join(', ')}. This product must never trade with borrowed funds: repay them and turn off spot margin in Bybit.`,
      );
      return 1;
    }
    return 0;
  } finally {
    await close();
  }
});
```

- [ ] **Step 12: Check the commands fail safely**

Run: `echo x | npm run key:add`
Expected: exits non-zero with the message that the command must run in an interactive terminal,
and no stack trace. Nothing is opened or created first.

If this machine has no `.env.local` yet:

Run: `npm run key:check`
Expected: exits non-zero with `VAULT_ACTIVE_KEY_VERSION is not set — run npm run vault:init`, and
no stack trace.

**Do not run `vault:init` for the founder.** It creates their master key, which they need to know
about and back up.

- [ ] **Step 13: Run the full suite and type check**

Run: `npm test && npm run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 14: Commit and push**

```bash
git add src/cli tests/cli
git commit -m "feat: add vault:init, key:add, key:check, and balance commands"
git push
```

---

## Task 15: Founder verification on testnet

> **2026-09-19: try testnet first; a mainnet read-only key is the fallback.** Creating an API key
> on the founder's own Bybit account was refused with a regulatory-restriction message, most
> likely because the account had not completed identity verification. Testnet sign-up has not
> been tried. If it works, run this task as written. Otherwise, once the account is verified,
> run it on **mainnet with a read-only key** instead. A read-only key can read balances but cannot trade
> or withdraw, so nothing can move. Differences from the steps below:
>
> - **Step 1:** at `www.bytick.com`, API Management, create a system-generated **Read-Only** key
>   restricted to the founder's current public IP (`curl.exe -s https://api.ipify.org`).
> - **Step 2:** run `vault:init` first — it refuses to run if `.env.local` exists — then, in the
>   same terminal, set `$env:BYBIT_ENV = 'mainnet'` and `$env:SERVER_IPS = '<that IP>'` before
>   `key:add`. Session variables, not `.env.local`, so the machine does not stay on mainnet.
>   Expect `It cannot place trades.` plus a warning saying so — correct for a read-only key.
> - **Step 4:** make the second key **Read-Only** too, with a Derivatives permission ticked. It
>   should be refused, naming that permission. **Never create a withdrawal-enabled key on a real
>   account.** If Bybit lists no permissions on read-only keys, skip this step; the refusal logic
>   is unit-tested.
> - **If the IP check fails,** the public IP changed, which is common on Nigerian networks. Check
>   it again and update the key.
>
> See `docs/decisions.md` #8.

**This task is done by the founder, in their own terminal.** The executing agent explains the
steps and records the outcome, but never asks for, sees, or types a key or secret, and never reads
the terminal while a key is being entered.

- [ ] **Step 1: Founder creates a testnet key**

1. Open **testnet.bytick.com** — reachable on networks where `testnet.bybit.com` is blocked.
2. Sign up or log in, and confirm the account is a **Unified Trading Account**.
3. Request test funds from the testnet faucet if the account has none.
4. Under API Management, create a **system-generated** key with **Read-Write**, and tick **only
   Spot → Trade**. Leave IP restriction off; this is testnet.

- [ ] **Step 2: Founder creates the vault and checks hidden input**

```powershell
npm run vault:init
npm run key:add
```

At the secret prompt, **first type a throwaway value** and confirm nothing appears on screen.
Bybit will then reject it with guidance. Run `npm run key:add` again with the real key and secret.

Expected: `Stored the key ending ...XXXX for testnet, encrypted.` and `It can place spot trades.`,
plus a warning that the key is not IP-restricted.

- [ ] **Step 3: Founder checks the stored key and reads balances**

```powershell
npm run key:check
npm run balance
```

Expected: the key passes validation, and non-zero testnet balances are listed.

- [ ] **Step 4: Founder proves a dangerous key is refused**

Create a second testnet key with **Wallet → Withdraw** (or Account Transfer) also ticked, then run
`npm run key:add` with it.

Expected: `This key was NOT stored`, naming the extra permission. Then **delete that key in Bybit.**

- [ ] **Step 5: Record the outcome**

Append a short section to `docs/superpowers/specs/2026-09-17-phase-1-exchange-adapter-design.md`
titled `## 10. Verified on testnet`, recording the date and, for each of Steps 2–4, whether the
expected result appeared. Record anything unexpected — such as a response field whose shape
differed from the fixtures — along with the fix. Do not record key hints or balances.

```bash
git add docs/superpowers/specs/2026-09-17-phase-1-exchange-adapter-design.md
git commit -m "docs: record Phase 1 testnet verification"
git push
```

---

## Task 16: Update the handoff documents

**Files:**
- Modify: `docs/stack-and-setup.md`, `docs/decisions.md`, `CLAUDE.md`
- Modify: this plan — append execution notes

- [ ] **Step 1: `docs/stack-and-setup.md`**

In the stack table, replace the `Exchange access` row with:

```markdown
| Exchange access | Our own Bybit v5 client | CCXT types every amount as a JavaScript `number`, which breaks the no-floats rule. Bybit signing is a few dozen lines. See `docs/superpowers/specs/2026-09-17-phase-1-exchange-adapter-design.md` |
```

and replace the `Database` row with:

```markdown
| Database | Postgres; PGlite in development and tests | The ledger needs real transactions. PGlite is Postgres compiled to WebAssembly, so neither development machine needs a database installed |
```

- [ ] **Step 2: `docs/decisions.md`**

Add a row to the *At a glance* table:

```markdown
| 20 | Exchange access and API key security | Own Bybit client; spot-only permission allowlist; sealed vault | DECIDED 2026-09-17 |
```

and add a section before *Corrections made along the way*:

```markdown
## 20. Exchange access and API key security — DECIDED 2026-09-17

Full design: `docs/superpowers/specs/2026-09-17-phase-1-exchange-adapter-design.md`.

- **Our own Bybit client, not CCXT.** CCXT declares every price, amount, and balance as a
  JavaScript `number` (verified in its source), which breaks the no-floats rule. This reverses
  the CCXT choice in #9.
- **Keys are validated against an allowlist:** the only permission allowed is `Spot: SpotTrade`.
  Anything else is rejected with the exact permission to remove, so a dangerous permission Bybit
  adds in future is refused rather than silently accepted.
- **Mainnet keys must be IP-restricted to our servers.** A stolen key is useless elsewhere.
- **Credentials are sealed with AES-256-GCM**, bound to their owner, under a versioned master key
  that never enters git.
- **A key is re-validated every time it is used**, because permissions can be widened on the
  exchange after the key was stored.
- **The founder enters keys in their own terminal with hidden input.** No agent ever handles them.
```

- [ ] **Step 3: `CLAUDE.md`**

In *Current state*, add a row:

```markdown
| Phase 1 — read-only Bybit connection | See `docs/superpowers/plans/2026-09-17-phase-1-exchange-adapter.md` and its execution notes |
```

In *Running the code*, add rows:

```markdown
| `npm run vault:init` | Create this machine's `.env.local` with a vault master key. Refuses to overwrite |
| `npm run key:add` | Validate a Bybit key and store it encrypted. Interactive, hidden input |
| `npm run key:check` | Re-validate the stored key |
| `npm run balance` | Read balances with the stored key, after re-validating it |
```

In *Rules that are not negotiable*, add:

```markdown
- **Never ask for, handle, log, or type an API key or secret.** Wrap them in `Secret`. Keys are
  entered only by the founder, in their own terminal.
- **Re-validate a key every time it is used.** Never place an order with a key that fails
  `validateKeyInfo`.
```

In *Working across two machines*, replace the "Not in git" item with:

```markdown
- **Not in git, so rebuild on each machine:** `node_modules/` (`npm install`), `data/*.csv`
  (`npm run fetch`), the subagent collection (`setup/update-subagents.ps1`), and Claude's
  memory, which is local to each machine.
- **Each machine has its own vault.** `.env.local` holds that machine's master key and
  `data/db/` its stored keys. Credentials never travel between machines: run `vault:init` and
  `key:add` on each one that needs them.
```

- [ ] **Step 4: Append execution notes to this plan**

Add an `## Execution notes — <date>` section at the end of this file listing every place the code
deliberately differs from the task text, and why.

- [ ] **Step 5: Commit and push**

```bash
git add docs CLAUDE.md
git commit -m "docs: record Phase 1 decisions, commands, and rules for handoff"
git push
```

---

## Definition of done

- [ ] `npm test` passes, with no skipped tests
- [ ] `npm run typecheck` is silent
- [ ] `npm audit --omit=dev` reports 0 vulnerabilities
- [ ] Task 15 recorded: a real testnet key was stored and read balances; a withdraw-enabled key was refused
- [ ] `grep -rn "parseFloat\|Number(.*walletBalance" src/` finds nothing
- [ ] `grep -rn "from '../vault\|from '../../vault" src/exchange/` finds nothing — the exchange layer never depends on the vault
- [ ] The branch is merged to `master` only after the founder confirms Task 15

---

## Execution notes — 2026-09-17

Tasks 1–14 and 16 were executed on branch `phase-1-exchange-adapter`; **Task 15 awaits the
founder**. The suite ends at 156 tests. Where the code differs from the task text above, the code
and these notes are authoritative.

**Deviations**

1. **Tests share one database per file (Tasks 8 and 13).** The plan opened a fresh PGlite database
   for every test through `openTestVault()`. Starting PGlite takes about four seconds, so the
   seven-test vault file took 30 seconds. `tests/helpers/vault.ts` now provides
   `useTestDatabase()`: one in-memory database per file, emptied before each test. The vault file
   dropped to under 7 seconds and the whole suite runs in about 8. `openTestVault()` was removed,
   and a guard test, "starts every test with an empty database", proves the isolation holds —
   which makes the vault file 8 tests rather than 7.
2. **One accepted development-only advisory (Task 1).** `npm audit --omit=dev` reports 0
   vulnerabilities, as the plan requires. The full audit reports four moderate findings, all
   GHSA-67mh-4wv8-2f99 in esbuild 0.18.20, pulled in by `drizzle-kit` through
   `@esbuild-kit/core-utils`. The advisory concerns esbuild's development server, which
   `drizzle-kit` never starts — it uses esbuild only to transpile its config and schema. The only
   offered fix is a forced breaking change, so it was accepted.
3. **Stale references corrected beyond Task 16's list.** CCXT and Node 22 also appeared in
   `README.md`, `docs/decisions.md` #8 and #9, the language section of `docs/stack-and-setup.md`,
   and the original design spec. All now point to the own Bybit client and Node 24. The README's
   stage description and next-step link were also out of date.

**Verification beyond the unit tests**

- **Live testnet check with a made-up key (Task 10).** A signed request to Bybit testnet returned
  `retCode 10003, "API key is invalid."` — Bybit accepted the synchronised timestamp and request
  format and rejected only the key. Both the time request and the signed request fell back from
  `api-testnet.bybit.com`, which is DNS-blocked on the founder's network, to
  `api-testnet.bytick.com`. This does **not** prove the signature is correct, because Bybit rejects
  an unknown key before checking signatures; the pinned vector and Task 15 cover that.
- **Command smoke tests (Task 14).** Piped input to `key:add` is refused before anything is opened.
  `key:check` without a master key explains how to create one and creates no database. In a scratch
  folder with a throwaway master key, `vault:init` wrote `.env.local` and refused to overwrite it,
  and `key:check` created an on-disk PGlite database, applied the migration, and reported that no
  key was stored. The scratch folder was deleted afterwards. **No `.env.local` was created in the
  repository** — the founder's master key is theirs to create and back up.

**Definition of done, status**

| Check | Result |
|---|---|
| `npm test` | 156 passed, none skipped |
| `npm run typecheck` | No errors |
| `npm audit --omit=dev` | 0 vulnerabilities |
| No floats for money in `src/` | None found |
| `src/exchange/` never imports `src/vault/` | None found |
| Task 15 — founder's testnet verification | **Pending** |
| Merge to `master` | After Task 15 |

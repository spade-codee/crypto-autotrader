# Design: Phase 1 — Read-Only Bybit Connection

- **Date:** 2026-09-17
- **Status:** Approved by the founder 2026-09-17
- **Parent spec:** `2026-09-16-crypto-trading-automation-design.md`, section 9 (build order)

---

## 1. Goal

Store a user's Bybit API key encrypted, prove the key cannot withdraw or do anything beyond
spot trading, and read the account's balances. **No order is placed in this phase.**

Phase 1 is the foundation every later phase stands on: Phase 2's execution engine reuses the
signed client, the vault, and the database; Phase 4's onboarding reuses the key validation.

### In scope

- A signed Bybit v5 REST client with host fallback and clock synchronisation
- API-key validation against a permission allowlist
- An encrypted credential vault in Postgres
- Balance reads
- Command-line tools for the founder: `vault:init`, `key:add`, `key:check`, `balance`

### Out of scope, and where it goes instead

| Not in Phase 1 | Where |
|---|---|
| Placing, querying, or cancelling orders | Phase 2 |
| A users table, sign-up, web onboarding | Phase 4 |
| Production Postgres, systemd credentials, the VPS | Phase 3 |
| Binance | After Bybit is live |
| Master-key rotation tooling | When first needed — the data model already supports it |

---

## 2. Decisions

### 2.1 A small Bybit client of our own, not CCXT

This reverses stack decision #9. CCXT's own type definitions declare every price, amount, and
balance as a JavaScript `number`: `type Num = number | undefined`, with `Balance.free`,
`Order.price`, `Order.amount`, and `OHLCV` all typed `Num` (verified in
`ts/src/base/types.ts` on 2026-09-17). That violates the rule that money never passes through a
float, and wrapping CCXT cannot fix it — precision is already lost by the time its values are
returned.

Bybit's authentication is small enough to own: an HMAC-SHA256 over
`timestamp + apiKey + recvWindow + queryString`, lowercase hex, sent in four headers. Owning it
keeps every value a string until it becomes a `Decimal`, reuses the host fallback Phase 0 already
built and tested, and keeps full control of error handling. Binance, when it comes, gets a second
client behind the same interface.

### 2.2 Validate API keys against an allowlist, not a blocklist

A key is accepted only when **its only permission is `Spot: SpotTrade`**. Every other permission
group Bybit reports — `Wallet` (including `Withdraw`, `AccountTransfer`, `SubMemberTransfer`),
`ContractTrade`, `Derivatives`, `Options`, `Earn`, `FiatP2P`, `Exchange`, and the rest — must be
empty, and each non-empty one produces a specific instruction naming the box to untick.

A blocklist of known-dangerous permissions would silently accept a dangerous permission Bybit
adds next year. An allowlist fails closed.

Further rules:

- **Unified Trading Account required.** Bybit's balance endpoint now supports only
  `accountType=UNIFIED`; a key reporting `uta: 0` is rejected with an instruction to upgrade.
- **Mainnet keys must be IP-restricted to our servers.** The key's IP list must be non-empty,
  must not be `*`, and must contain only addresses in the configured `SERVER_IPS` — so a stolen key
  is useless from anywhere else. Mainnet validation fails outright if `SERVER_IPS` is unset.
- **Testnet keys may be unrestricted**, with a warning, because development machines have
  changing IP addresses.
- **Expiry.** `expiredAt` of `1970-01-01T00:00:00Z` means the key does not expire. An expired key is
  rejected; one expiring within 14 days produces a warning. Bybit expires unrestricted keys after
  90 days.
- **Read-only keys are accepted in Phase 1** with a warning, since this phase only reads. The
  result reports `canTradeSpot`, which requires both `readOnly: 0` and `Spot: SpotTrade` — Bybit's
  own example response shows a read-only key still listing trade permissions, so the permission
  list alone is not enough.

### 2.3 An encrypted vault

- **AES-256-GCM**, authenticated encryption, with a fresh random 12-byte IV per record.
- **Bound to its owner.** Additional authenticated data is
  `exchange_credentials:<userId>:<exchange>:<environment>`. Copying an encrypted row onto another
  user makes decryption fail rather than silently handing one user's key to another.
- **Versioned master keys.** Each record stores the key version it was sealed with. Master keys
  come from `VAULT_MASTER_KEY_V<n>` environment variables, with `VAULT_ACTIVE_KEY_VERSION`
  selecting the one used for new records, so rotation needs no schema change.
- **Where master keys live.** Development: a gitignored `.env.local` created by `npm run vault:init`,
  which refuses to overwrite an existing file — overwriting would make every stored credential
  permanently unreadable. Production (Phase 3): a systemd encrypted credential on the VPS.
- **Both the API key and its secret are encrypted**, as one JSON payload. Only the last four
  characters of the API key are stored in the clear, as a hint.
- **Secrets are wrapped in a `Secret` type** whose `toString`, `toJSON`, and inspection all produce
  `[redacted]`. Reading the value requires an explicit `reveal()`. Tests prove a secret does not
  appear in string interpolation, `JSON.stringify`, `util.inspect`, or error messages.

### 2.4 Postgres through Drizzle, with PGlite in development and tests

PGlite is real Postgres compiled to WebAssembly, running inside the Node process. Tests use an
in-memory instance and development uses a gitignored data directory, so **neither development
machine needs Postgres or Docker installed**. The VPS runs ordinary Postgres from Phase 3, against
the same Drizzle schema and migrations.

Versions current on 2026-09-17: `drizzle-orm` 0.45, `drizzle-kit` 0.31, `@electric-sql/pglite` 0.5.

### 2.5 Testnet by default

`BYBIT_ENV` defaults to `testnet`. Mainnet requires `BYBIT_ENV=mainnet`, and mainnet key
validation additionally requires `SERVER_IPS`.

### 2.6 The founder enters keys; the agent never sees them

`npm run key:add` runs in the founder's own terminal, reads the secret with hidden input, and
refuses to run when input is not an interactive terminal — which keeps secrets out of shell
history and pipes. The secret goes straight into the vault. It is never a command-line argument,
never written to disk unencrypted, and never pasted into a conversation.

---

## 3. Components

| Module | Responsibility |
|---|---|
| `src/net/http.ts` | `getJson` with host fallback, moved from `src/data/bybit.ts`, now accepting request headers |
| `src/secrets/secret.ts` | The `Secret` wrapper |
| `src/vault/keyring.ts` | Load versioned master keys from the environment; generate a new one |
| `src/vault/crypto.ts` | `seal` and `open` — AES-256-GCM with additional authenticated data |
| `src/db/schema.ts` | Drizzle schema: `exchange_credentials` |
| `src/db/client.ts` | Open PGlite, wrap in Drizzle, apply migrations |
| `drizzle/` | Generated SQL migrations, committed |
| `src/vault/credentialVault.ts` | Store, retrieve, mark validated |
| `src/exchange/environment.ts` | `Environment` type; parse `BYBIT_ENV`, defaulting to testnet |
| `src/exchange/credentials.ts` | `ApiCredentials` — both halves of a key, as `Secret`s |
| `src/exchange/account.ts` | `KeyInfo`, `CoinBalance`, `ExchangeAccount` — exchange-agnostic shapes |
| `src/exchange/bybit/hosts.ts` | API hosts per environment, primary then `bytick` alternate |
| `src/exchange/bybit/sign.ts` | Build the four authentication headers |
| `src/exchange/bybit/client.ts` | Signed GET with clock sync; response envelope parsing; `BybitApiError` |
| `src/exchange/bybit/account.ts` | `getKeyInfo` and `getBalances`, with parsers |
| `src/exchange/bybit/keyValidation.ts` | `validateKeyInfo` — pure, allowlist rules from 2.2. Bybit-specific, since permission names are |
| `src/app/credentials.ts` | `connectKey`, `checkKey`, `readBalances` — flows the CLIs call |
| `src/cli/env.ts`, `guidance.ts`, `prompt.ts`, `context.ts` | Load `.env.local` and config; turn errors into instructions; terminal input; wire real dependencies |
| `src/cli/vault-init.ts`, `key-add.ts`, `key-check.ts`, `balance.ts` | The four commands |

`src/data/` keeps public market data for research. `src/exchange/` is authenticated account
access. The two share only `src/net/http.ts` and the host list.

### Hosts

| Environment | Hosts, in order |
|---|---|
| mainnet | `https://api.bybit.com`, `https://api.bytick.com` |
| testnet | `https://api-testnet.bybit.com`, `https://api-testnet.bytick.com` |

On the founder's network the `bybit.com` hosts fail DNS resolution and the `bytick.com` hosts
answer (verified 2026-09-17). Fallback happens only when a host cannot be reached — never on an
HTTP error or a Bybit error code.

### Clock synchronisation

Bybit accepts a request only when `server_time - recv_window <= timestamp < server_time + 1000`.
A clock running more than one second fast is rejected. Before its first signed request, the client
reads `/v5/market/time`, computes the offset from the midpoint of the local send and receive
times, and signs with local time plus that offset. `recv_window` is 5000 ms.

---

## 4. Data flow: `npm run key:add`

```
load .env.local -> build keyring            (fail if no master key: run vault:init)
prompt: API key (visible), secret (hidden)  (fail if not an interactive terminal)
wrap both in Secret
sync clock with /v5/market/time
GET /v5/user/query-api, signed              (Bybit error -> specific guidance, nothing stored)
parse key info -> validateKeyInfo
  rejected -> print each problem, store NOTHING, exit non-zero
  accepted -> seal and upsert into exchange_credentials, set validated_at
print: key hint, environment, canTradeSpot, warnings
```

`key:check` re-runs validation on the stored key. `balance` reads balances with the stored key,
prints non-zero coins, and flags any borrowed amount — the product must never trade on margin.

## 5. Error handling

- **Fail closed.** A failed validation stores nothing; an unreadable vault record is an error,
  never a skipped row.
- **Bybit error codes map to guidance**, for example: `10002` clock or recv window, `10003` invalid key
  or wrong environment, `10004` secret does not match, `10005` permission denied, `10010` this
  machine's IP is not on the key's list. Unknown codes show code and message.
- **No secret in any error.** Errors carry codes and hints, never headers, payloads, or keys.
- **Decryption failures are deliberately vague:** "wrong master key, or the record was altered".

## 6. Testing

| Area | How |
|---|---|
| Signing | Pinned vector: payload `1700000000000TESTKEY1235000accountType=UNIFIED` with secret `TESTSECRET456` signs to `c0b7d5fe…99f0af` |
| Client | Fake fetch: clock offset applied, headers sent on every host attempt, envelope errors raised |
| Parsers | Fixtures built from Bybit's documented example responses |
| Validation | One test per rule, including each forbidden permission group and every IP case |
| Crypto | Round trip, unique IVs, wrong owner, tampered ciphertext and tag, rotation across key versions |
| Vault | In-memory PGlite: upsert, retrieve, swapped rows fail to decrypt |
| Flows | Fake exchange account with a real in-memory vault: a rejected key is never stored |
| Secret | Interpolation, `JSON.stringify`, `util.inspect`, and error messages all redact |
| End to end | The founder, on testnet — section 7 |

## 7. Founder actions

Near the end of the phase, on **testnet.bytick.com**, which is reachable on the founder's network:

1. Create a testnet account, and confirm it is a Unified Trading Account.
2. Create an API key with **only Spot trading** enabled.
3. Run `npm run vault:init`, then `npm run key:add`. First type a throwaway value to confirm the
   secret does not echo.
4. Run `npm run key:check` and `npm run balance`.
5. Create a second key that also has **Withdraw** enabled, and confirm `key:add` rejects it naming
   that permission. Then delete that key in Bybit.

## 8. Done when

- A real testnet key is validated, stored encrypted, and reads its balances.
- A key with withdrawal permission is rejected with an instruction naming it.
- Tests prove secrets never reach logs, JSON, inspection, or errors.
- `npm test` and `npm run typecheck` pass, and `npm audit` reports no vulnerabilities in production
  dependencies.

## 9. Carry forward to later phases

- **Phase 2:** the account must have spot margin borrowing off, and orders must never exceed free
  balance, since a Unified Trading Account can borrow automatically. `balance` already flags borrowing.
- **Phase 3:** production Postgres, the master key as a systemd encrypted credential, and
  `SERVER_IPS` set to the VPS address.
- **Phase 4:** onboarding must route users on blocked networks to a working way of creating keys
  (`docs/decisions.md` #8).

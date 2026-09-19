# Licensed Nigerian exchanges: Quidax and Busha

Researched 2026-09-19, after Bybit refused to create an API key on the founder's account and it
emerged that Bybit API keys can only be created on its website and that Bybit holds no Nigerian
licence (`docs/decisions.md` #8). Quidax and Busha are the only exchanges holding provisional SEC
licences, both through the ARIP programme.

## Verdict

**Neither can replace Bybit today without breaking the product's central promise** — that we can
trade a user's account but can never move their money out of it. Each fails that test in a
different way, and in both cases only the exchange can close the gap.

- **Quidax** has the right market — an order book, 0.1% fees, daily candles — but the wrong
  credentials. Its documented API keys belong to merchant accounts and carry **no permissions at
  all**, so every key can withdraw.
- **Busha** has the right connection model — OAuth2 that individual users approve and can revoke,
  with a sandbox — but **executing a trade requires the same scope that sends money out**, and its
  quoted spread of about **3.9%** would wipe out most of the strategy's protection.

## What the product needs from an exchange

1. A credential that can trade but cannot withdraw.
2. A way to verify that with the exchange, rather than trusting the user.
3. Individuals connecting their own accounts. A model where users' funds sit in sub-accounts
   under our account would make us a custodian, which the design rejects.
4. Trading costs low enough for the strategy to survive. MA-125 makes four to five round trips a
   year.
5. Daily price history for the signal — though this can come from another source.
6. A way to test without real money.

## Side by side

| | Bybit | Quidax | Busha |
|---|---|---|---|
| Nigerian licence | None | Provisional, SEC ARIP | Provisional, SEC ARIP |
| How a user connects | API key, website only | API key from a **merchant** account | **OAuth2** consent, revocable |
| 1. Trade without withdraw | **Yes** — `Spot: SpotTrade` only | **No** — keys have no permissions | **No** — trading needs `transfers:write` |
| 2. Verifiable with the exchange | **Yes** — key-info endpoint | No — nothing to verify | **Yes** — signed JWT `scp` claim |
| 3. Individual accounts | Yes | Not documented for API keys | **Yes** |
| 4. BTC/USDT round-trip cost, live | ~0.2% fees, ~0 spread | ~0.2% fees + ~0.2% spread | **~3.9% spread** |
| Strategy out-of-sample at that cost | 42.0% CAGR, 27.4% max DD | 41.3%, 27.8% | **18.6%, 44.1%** |
| 5. Daily candles | Yes | Yes | No crypto candles |
| 6. Test without real money | Testnet, sign-up untested from Nigeria | None documented | **Sandbox** |
| Request authentication | HMAC-SHA256 signature | Static bearer key | OAuth2 bearer JWT, ~1 hour |

Costs were measured from public endpoints on Saturday 2026-09-19 around 11:00 UTC. The strategy
rows run MA-125 on the BTC long-history data used in Phase 0, with costs per side of 0.1% fee +
0.05% slippage (Bybit, the Phase 0 assumption), 0.1% fee + 0.1% half-spread (Quidax), and 1.95%
half-spread (Busha). Out-of-sample is 2023-01-01 to 2026-09-16; buy-and-hold over the same window
returned 50.1% a year with a 53.1% worst drop.

## Quidax

**Licence.** Provisional SEC licence under ARIP — with Busha's, the first the SEC issued.

**Credentials — the disqualifier.** The developer docs describe creating a key from a *merchant*
account: open API management, optionally enter an IP address, enter the 2FA code, and create.
**There is no permission choice anywhere in the documentation.** The same key that places orders
can call *Create Withdrawal* and *Create Bank Withdraw*. Requests carry the key as a static bearer
token, so there is no request signing either. With no permissions, there is nothing for us to
verify, and no endpoint to read a key's settings — including whether the optional IP lock is on.

**The merchant model is custody.** The API is built for businesses that create sub-accounts on
behalf of their users, including internal withdrawals from a sub-account to the main account. Using
it that way would put users' funds under our control — exactly what the design rules out.

**Market — good.** A real order book with limit and market orders on `btcusdt` and `btcngn`, amounts
as strings. Fees are 0.1% maker and 0.1% taker on every pair, per Quidax's own fee page (updated
2026-06-15). The live `btcusdt` spread was 0.20%, with roughly 10 BTC resting within 0.1% of the
best bid and of the best ask — ample for retail sizes — though 24-hour volume was only 5.2 BTC. At these
costs the strategy is essentially unchanged: 41.3% a year and a 27.8% worst drop out-of-sample,
against 42.0% and 27.4% at Bybit's.

**Data.** Daily k-line data (`period=1440`, up to 10,000 points per request).

**Gaps besides credentials.** No documented client order ID for idempotent orders, and no
documented sandbox.

## Busha

**Licence.** Provisional SEC licence under ARIP.

**Connection model — the right shape.** Busha OAuth2 lets a Busha customer approve a partner app on
Busha's own consent screen: authorization code with PKCE, plus OpenID Connect. The partner never
sees a password; access tokens are RS256 JWTs lasting about an hour, whose scopes can be verified
cryptographically; refresh tokens rotate and slide for 30 days; the user can disconnect at any time.
There is a separate sandbox. To register, the partner needs a Busha **business** account with
completed KYB, and a Busha admin approves the app with the scopes requested.

**Scopes — the disqualifier.** Busha has twelve scopes. Converting BTC to USDT is a two-step
operation: lock a quote (`POST /v1/quotes`, scope `quotes:write`), then execute it as a transfer.
Busha's OpenAPI specification requires **`transfers:write` for `POST /v1/transfers`** — the scope
it describes as initiating outgoing transfers, real money movement. A quote's payout can be an
external crypto address given inline, with no saved recipient needed. **So any token able to trade
is also able to send the user's funds to an arbitrary address.** No narrower scope, per-app
restriction, or address allowlist is documented. The docs' own "FX / trading widget" combination
omits `transfers:write`, which suggests such a widget can lock rates but not execute them.

**Cost — the second disqualifier.** Busha is a quote desk, not an order book, and it charges no
separate trading fee: the cost is the spread. Its public pairs showed **about 390 basis points
between buy and sell on BTC/USDT** — and almost the same on nearly every volatile pair sampled
(ETH, SOL, XRP, DOGE, BNB and more), so it reflects Busha's pricing rather than a BTC anomaly.
BTC/NGN was 504. At that cost the strategy returns 18.6% a year with a 44.1% worst drop, against
50.1% and 53.1% for simply holding: it gives up 31 points of growth to shave 9 points off the worst
drop. The product promise does not survive.

**Caveats.** The spread was measured once, on a Saturday, from the public pairs endpoint. Quotes
issued to an approved partner may be tighter; only a sandbox or partner quote can show that. Busha
also has no crypto candle endpoint, so the signal would need prices from elsewhere.

## What would change the verdict

- **Quidax:** API keys for individual accounts; a per-key permission that allows trading and
  forbids withdrawal; and an endpoint that reports a key's permissions and IP restriction.
- **Busha:** a scope that converts between the user's own balances with no external payout; and
  partner quotes near market — within roughly 0.3% round trip.

## Recommendation

1. **Run the Bybit key test regardless** (`docs/decisions.md` #8). It decides whether the
   technically strongest option is usable at all.
2. **Ask both exchanges the questions above.** They are specific and cheap to ask, and a licensed
   exchange may welcome a partner that brings users. Quidax offers a technical onboarding call
   from its developer docs.
3. **Put the exchange question to the lawyer** (`docs/decisions.md` #18). The Bybit path stands
   or falls on whether a Nigerian SaaS tool may direct users to an unlicensed exchange.
4. **Do not integrate either exchange as documented.** Building on a withdrawal-capable
   credential would give our servers the power to empty users' accounts — the one thing the
   design exists to prevent.

## Sources

- Quidax developer docs: <https://docs.quidax.io/llms.txt>, especially *Getting your developer
  key*, *Security*, *Create a sell or buy order*, and *Fetch k-line for a market*
- Quidax fees: <https://support.quidax.io/hc/en-us/articles/360016166012-What-fees-does-Quidax-charge>
- Busha developer docs: <https://docs.busha.io/llms.txt>, especially the OAuth2 pages (*Scopes*,
  *Get Access*, *Token Handling*), *Quotes*, *Convert Between Balances*, and *Fees*
- Busha OpenAPI specification:
  <https://raw.githubusercontent.com/bushaHQ/openapi/refs/heads/main/openapi-spec.yaml>
- Licences: Finextra, *Busha and Quidax granted provisional licenses by Nigerian SEC*
  <https://www.finextra.com/newsarticle/44653/busha-and-quidax-granted-provisional-licenses-by-nigerian-sec>
- Live prices: `api.busha.io/v1/pairs`, `openapi.quidax.io/exchange-open-api/api/v1/markets`,
  `api.bytick.com/v5/market/tickers`

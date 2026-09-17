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

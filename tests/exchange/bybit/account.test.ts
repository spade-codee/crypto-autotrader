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

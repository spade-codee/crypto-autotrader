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

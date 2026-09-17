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

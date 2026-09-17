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

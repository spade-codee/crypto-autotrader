import type Decimal from 'decimal.js';
import type { CoinBalance } from './account.js';

export type OrderSide = 'BUY' | 'SELL';

/** A buy names the quote coin to spend; a sell names the base coin to sell — Bybit's convention for spot market orders. */
export type MarketOrderRequest =
  | { clientOrderId: string; symbol: string; side: 'BUY'; quoteAmount: Decimal }
  | { clientOrderId: string; symbol: string; side: 'SELL'; baseQty: Decimal };

export type OrderStatus = 'FILLED' | 'PARTIALLY_FILLED_CANCELLED' | 'REJECTED' | 'PENDING';

export type OrderState = {
  clientOrderId: string;
  side: OrderSide;
  status: OrderStatus;
  filledBaseQty: Decimal;
  filledQuoteAmount: Decimal;
  /** Null when nothing filled. */
  avgPrice: Decimal | null;
  fee: Decimal;
  feeCoin: string;
  rejectReason: string | null;
};

/**
 * The account's answer about one client order ID:
 * - FOUND: the order exists, in this state;
 * - ABSENT: the adapter can PROVE no such order exists or ever will. The paper
 *   account can, because its database is the whole truth;
 * - NOT_VISIBLE: the adapter looked and did not see it, but cannot prove it
 *   absent. An exchange that is slow to show new orders answers this way.
 * A lookup that fails — a timeout, an error — throws.
 */
export type OrderLookup =
  | { kind: 'FOUND'; state: OrderState }
  | { kind: 'ABSENT' }
  | { kind: 'NOT_VISIBLE' };

/** An account the engine can trade: the paper account now, Bybit in Phase 2b. */
export interface TradingAccount {
  getBalances(): Promise<CoinBalance[]>;
  /**
   * Places a market order. If this throws, the order's fate is uncertain — it
   * may have reached the account — and the engine settles it through getOrder.
   */
  placeMarketOrder(order: MarketOrderRequest): Promise<OrderState>;
  getOrder(clientOrderId: string): Promise<OrderLookup>;
}

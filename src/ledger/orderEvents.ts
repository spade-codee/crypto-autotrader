import Decimal from 'decimal.js';
import type { OrderSide, OrderState, OrderStatus } from '../exchange/trading.js';

const STATUSES: readonly string[] = ['FILLED', 'PARTIALLY_FILLED_CANCELLED', 'REJECTED', 'PENDING'];
const SIDES: readonly string[] = ['BUY', 'SELL'];

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`the order result has no ${field}`);
  }
  return value;
}

function decimal(value: unknown, field: string): Decimal {
  const amount = new Decimal(text(value, field));
  if (!amount.isFinite()) {
    throw new Error(`the order result's ${field} is not a number`);
  }
  return amount;
}

/**
 * A recorded ORDER_RESULT payload, read back as the order state it describes.
 * Decimals are stored as strings by Decimal#toJSON, so they come back exact.
 * A NOT_PLACED result is not an order state: nothing was ever placed.
 */
export function orderStateFrom(payload: Record<string, unknown>): OrderState {
  const status = text(payload.status, 'status');
  if (!STATUSES.includes(status)) {
    throw new Error(`"${status}" is not an order state that can be read back`);
  }
  const side = text(payload.side, 'side');
  if (!SIDES.includes(side)) {
    throw new Error(`"${side}" is not an order side`);
  }
  const avgPrice = payload.avgPrice;
  const rejectReason = payload.rejectReason;
  return {
    clientOrderId: text(payload.clientOrderId, 'client order ID'),
    side: side as OrderSide,
    status: status as OrderStatus,
    filledBaseQty: decimal(payload.filledBaseQty, 'filled quantity'),
    filledQuoteAmount: decimal(payload.filledQuoteAmount, 'filled amount'),
    avgPrice: avgPrice === null || avgPrice === undefined ? null : decimal(avgPrice, 'average price'),
    fee: decimal(payload.fee, 'fee'),
    feeCoin: text(payload.feeCoin, 'fee coin'),
    rejectReason: rejectReason === null || rejectReason === undefined ? null : String(rejectReason),
  };
}

import Decimal from 'decimal.js';
import { midPrice, type BookSides } from '../market/orderBook.js';
import type { InstrumentRules, Ticker } from '../market/types.js';
import { fillBuy, fillSell } from '../paper/fill.js';
import type { AccountStatus } from '../types.js';
import type { Holdings } from './holdings.js';
import type { SizedOrder } from './sizing.js';

/** The widest acceptable spread, as a fraction of the mid price. */
export const MAX_SPREAD = new Decimal('0.005');
/** How far the mid may be from the last traded price. */
export const MAX_LAST_TRADE_GAP = new Decimal('0.01');
/** How far the mid may be from the close the signal used — wide enough for a late run during a crash. */
export const MAX_SIGNAL_GAP = new Decimal('0.2');
/** How far the expected average fill may be from the mid. */
export const MAX_FILL_GAP = new Decimal('0.01');
/** Attempts allowed per account per day (spec section 4.2). */
export const MAX_ATTEMPTS_PER_DAY = 3;

export type RiskContext = {
  killSwitchOn: boolean;
  accountStatus: AccountStatus;
  /** An earlier intent today was not confirmed NOT_PLACED, so an order may already have executed. */
  priorOrderToday: boolean;
  /** Which attempt at today's order this is, from 1. */
  attempt: number;
  holdings: Holdings;
  rules: InstrumentRules;
  book: BookSides;
  ticker: Ticker;
  signalClose: Decimal;
  maxOrderUsdt: Decimal | null;
};

export type RiskDecision = { approved: true } | { approved: false; reasons: string[] };

const gap = (value: Decimal, reference: Decimal): Decimal => value.minus(reference).abs().div(reference);
const percent = (fraction: Decimal): string => `${fraction.times(100).toFixed()}%`;

/**
 * Checks one order against every rule in spec section 6, and lists every rule
 * it breaks rather than stopping at the first. The engine freezes the account
 * on any veto.
 */
export function checkOrder(order: SizedOrder, context: RiskContext): RiskDecision {
  const reasons: string[] = [];
  const { rules, holdings, book } = context;

  if (context.killSwitchOn) {
    reasons.push('The kill switch is on.');
  }
  if (context.accountStatus !== 'active') {
    reasons.push(`The account is ${context.accountStatus}.`);
  }
  if (context.priorOrderToday) {
    reasons.push('An order already went to this account today.');
  }
  if (context.attempt > MAX_ATTEMPTS_PER_DAY) {
    reasons.push(`Orders have failed to reach the account ${MAX_ATTEMPTS_PER_DAY} times today.`);
  }

  const bestBid = book.bids[0];
  const bestAsk = book.asks[0];
  if (bestBid === undefined || bestAsk === undefined) {
    reasons.push('The order book is empty on one side.');
    return { approved: false, reasons };
  }
  const mid = midPrice(book);

  if (order.side === 'BUY') {
    if (order.quoteAmount.gt(holdings.quote.available)) {
      reasons.push(
        `The buy spends ${order.quoteAmount.toFixed()} ${rules.quoteCoin}, more than the ${holdings.quote.available.toFixed()} available.`,
      );
    }
    if (order.quoteAmount.lt(rules.minOrderAmt)) {
      reasons.push(`The buy is below the minimum order value of ${rules.minOrderAmt.toFixed()} ${rules.quoteCoin}.`);
    }
  } else {
    if (order.baseQty.gt(holdings.base.available)) {
      reasons.push(
        `The sell is ${order.baseQty.toFixed()} ${rules.baseCoin}, more than the ${holdings.base.available.toFixed()} available.`,
      );
    }
    if (order.baseQty.lt(rules.minOrderQty) || order.baseQty.times(mid).lt(rules.minOrderAmt)) {
      reasons.push('The sell is below the exchange minimum.');
    }
    if (order.baseQty.gt(rules.maxMarketOrderQty)) {
      reasons.push(`The sell is above the maximum market order of ${rules.maxMarketOrderQty.toFixed()} ${rules.baseCoin}.`);
    }
  }
  const notional = order.side === 'BUY' ? order.quoteAmount : order.baseQty.times(mid);
  if (context.maxOrderUsdt !== null && notional.gt(context.maxOrderUsdt)) {
    reasons.push(`The order is worth more than the cap of ${context.maxOrderUsdt.toFixed()} ${rules.quoteCoin}.`);
  }

  if (bestBid.price.lte(0)) {
    reasons.push('The best bid is not above zero.');
  }
  if (bestAsk.price.lte(bestBid.price)) {
    reasons.push('The best ask is not above the best bid.');
  } else if (bestAsk.price.minus(bestBid.price).div(mid).gt(MAX_SPREAD)) {
    reasons.push(`The spread is wider than ${percent(MAX_SPREAD)} of the price.`);
  }
  if (gap(mid, context.ticker.lastPrice).gt(MAX_LAST_TRADE_GAP)) {
    reasons.push(`The order book and the last trade disagree by more than ${percent(MAX_LAST_TRADE_GAP)}.`);
  }
  if (gap(mid, context.signalClose).gt(MAX_SIGNAL_GAP)) {
    reasons.push(`The price is more than ${percent(MAX_SIGNAL_GAP)} away from the close the signal used.`);
  }

  const fill =
    order.side === 'BUY'
      ? fillBuy(book.asks, order.quoteAmount, rules.basePrecision)
      : fillSell(book.bids, order.baseQty);
  if (!fill.complete || fill.avgPrice === null) {
    reasons.push('The order book cannot fill the whole order.');
  } else if (gap(fill.avgPrice, mid).gt(MAX_FILL_GAP)) {
    reasons.push(`Filling the order would average more than ${percent(MAX_FILL_GAP)} away from the price.`);
  }
  if (order.side === 'BUY' && fill.filledBaseQty.gt(rules.maxMarketOrderQty)) {
    reasons.push(`The buy would exceed the maximum market order of ${rules.maxMarketOrderQty.toFixed()} ${rules.baseCoin}.`);
  }

  return reasons.length === 0 ? { approved: true } : { approved: false, reasons };
}

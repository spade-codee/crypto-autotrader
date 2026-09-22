import Decimal from 'decimal.js';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { accountState, ledgerEvents, paperBalances, paperOrders } from '../db/schema.js';
import type { CoinBalance } from '../exchange/account.js';
import type {
  MarketOrderRequest,
  OrderLookup,
  OrderSide,
  OrderState,
  OrderStatus,
  TradingAccount,
} from '../exchange/trading.js';
import type { InstrumentRules, MarketData } from '../market/types.js';
import { fillBuy, fillSell } from './fill.js';

const ZERO = new Decimal(0);
const SIDES: readonly string[] = ['BUY', 'SELL'];
const STATUSES: readonly string[] = ['FILLED', 'PARTIALLY_FILLED_CANCELLED', 'REJECTED', 'PENDING'];

export type PaperAccountOptions = { db: Database; userId: string; market: MarketData; feeRate: Decimal };

export type OpenPaperAccount = {
  userId: string;
  baseCoin: string;
  quoteCoin: string;
  startingQuote: Decimal;
  at: Date;
};

type OrderRow = typeof paperOrders.$inferSelect;

function toState(row: OrderRow): OrderState {
  if (!SIDES.includes(row.side) || !STATUSES.includes(row.status)) {
    throw new Error(`paper order ${row.clientOrderId} has an unknown side or status`);
  }
  return {
    clientOrderId: row.clientOrderId,
    side: row.side as OrderSide,
    status: row.status as OrderStatus,
    filledBaseQty: new Decimal(row.filledBaseQty),
    filledQuoteAmount: new Decimal(row.filledQuoteAmount),
    avgPrice: row.avgPrice === null ? null : new Decimal(row.avgPrice),
    fee: new Decimal(row.fee),
    feeCoin: row.feeCoin,
    rejectReason: row.rejectReason,
  };
}

function rejected(order: MarketOrderRequest, feeCoin: string, reason: string): OrderState {
  return {
    clientOrderId: order.clientOrderId,
    side: order.side,
    status: 'REJECTED',
    filledBaseQty: ZERO,
    filledQuoteAmount: ZERO,
    avgPrice: null,
    fee: ZERO,
    feeCoin,
    rejectReason: reason,
  };
}

/** The first of the instrument's rules the order breaks, as Bybit would refuse it. */
function ruleProblem(order: MarketOrderRequest, rules: InstrumentRules): string | null {
  if (order.symbol !== rules.symbol) {
    return `unknown symbol ${order.symbol}`;
  }
  if (order.side === 'BUY') {
    if (!order.quoteAmount.mod(rules.quotePrecision).isZero()) {
      return `the amount has more decimal places than ${rules.quotePrecision.toFixed()} allows`;
    }
    if (order.quoteAmount.lt(rules.minOrderAmt)) {
      return `below the minimum order value of ${rules.minOrderAmt.toFixed()} ${rules.quoteCoin}`;
    }
    return null;
  }
  if (!order.baseQty.mod(rules.basePrecision).isZero()) {
    return `the quantity has more decimal places than ${rules.basePrecision.toFixed()} allows`;
  }
  if (order.baseQty.lt(rules.minOrderQty)) {
    return `below the minimum quantity of ${rules.minOrderQty.toFixed()} ${rules.baseCoin}`;
  }
  if (order.baseQty.gt(rules.maxMarketOrderQty)) {
    return `above the maximum market order of ${rules.maxMarketOrderQty.toFixed()} ${rules.baseCoin}`;
  }
  return null;
}

/**
 * A simulated exchange account that fills orders against Bybit's live order
 * book. It behaves like Bybit spot wherever the engine could notice: it
 * enforces the instrument's rules and the balance, refuses a repeated client
 * order ID, charges the taker fee in the coin received, and cancels whatever
 * the book cannot fill. Its database is the whole truth, and each order is
 * written in the same transaction as its balances, so a missing order is
 * proven absent: getOrder answers FOUND or ABSENT, never NOT_VISIBLE. A
 * database error throws, which the engine treats as inconclusive.
 */
export class PaperAccount implements TradingAccount {
  /**
   * Opens a paper account: its starting balances, its account state, and an
   * ACCOUNT_OPENED ledger event, in one transaction. In this phase, having an
   * account_state row is what makes someone a user.
   */
  static async open(db: Database, options: OpenPaperAccount): Promise<void> {
    if (!options.startingQuote.isFinite() || options.startingQuote.lte(0)) {
      throw new Error('the starting balance must be above zero');
    }
    await db.transaction(async (tx) => {
      const existing = await tx.select().from(accountState).where(eq(accountState.userId, options.userId));
      if (existing.length > 0) {
        throw new Error(`"${options.userId}" already has an account, so nothing was changed`);
      }
      await tx.insert(accountState).values({ userId: options.userId, status: 'active', reason: null, updatedAt: options.at });
      await tx.insert(paperBalances).values([
        { userId: options.userId, coin: options.quoteCoin, free: options.startingQuote.toFixed() },
        { userId: options.userId, coin: options.baseCoin, free: '0' },
      ]);
      await tx.insert(ledgerEvents).values({
        occurredAt: options.at,
        userId: options.userId,
        cycleDate: null,
        type: 'ACCOUNT_OPENED',
        payload: {
          mode: 'paper',
          balances: { [options.quoteCoin]: options.startingQuote.toFixed(), [options.baseCoin]: '0' },
        },
      });
    });
  }

  readonly #db: Database;
  readonly #userId: string;
  readonly #market: MarketData;
  readonly #feeRate: Decimal;

  constructor(options: PaperAccountOptions) {
    this.#db = options.db;
    this.#userId = options.userId;
    this.#market = options.market;
    this.#feeRate = options.feeRate;
  }

  async getBalances(): Promise<CoinBalance[]> {
    const rows = await this.#db.select().from(paperBalances).where(eq(paperBalances.userId, this.#userId));
    if (rows.length === 0) {
      throw new Error(`there is no paper account for "${this.#userId}"; run npm run paper:init`);
    }
    return rows.map((row) => ({ coin: row.coin, walletBalance: new Decimal(row.free), locked: ZERO, borrowAmount: ZERO }));
  }

  async getOrder(clientOrderId: string): Promise<OrderLookup> {
    const rows = await this.#db
      .select()
      .from(paperOrders)
      .where(and(eq(paperOrders.clientOrderId, clientOrderId), eq(paperOrders.userId, this.#userId)));
    return rows[0] === undefined ? { kind: 'ABSENT' } : { kind: 'FOUND', state: toState(rows[0]) };
  }

  async placeMarketOrder(order: MarketOrderRequest): Promise<OrderState> {
    const rules = await this.#market.getInstrumentRules(order.symbol);
    const feeCoin = order.side === 'BUY' ? rules.baseCoin : rules.quoteCoin;
    const existing = await this.#db.select().from(paperOrders).where(eq(paperOrders.clientOrderId, order.clientOrderId));
    if (existing.length > 0) {
      // As on Bybit: a repeated client order ID is refused, and the original order is untouched.
      return rejected(order, feeCoin, 'duplicate client order ID');
    }
    const problem = ruleProblem(order, rules) ?? (await this.#balanceProblem(order, rules));
    if (problem !== null) {
      return this.#store(order, rejected(order, feeCoin, problem), []);
    }
    const book = await this.#market.getOrderBook(order.symbol);
    const fill =
      order.side === 'BUY'
        ? fillBuy(book.asks, order.quoteAmount, rules.basePrecision)
        : fillSell(book.bids, order.baseQty);
    if (fill.filledBaseQty.isZero()) {
      return this.#store(order, rejected(order, feeCoin, 'the order book had nothing to fill it with'), []);
    }
    const fee =
      order.side === 'BUY' ? fill.filledBaseQty.times(this.#feeRate) : fill.filledQuoteAmount.times(this.#feeRate);
    const state: OrderState = {
      clientOrderId: order.clientOrderId,
      side: order.side,
      status: fill.complete ? 'FILLED' : 'PARTIALLY_FILLED_CANCELLED',
      filledBaseQty: fill.filledBaseQty,
      filledQuoteAmount: fill.filledQuoteAmount,
      avgPrice: fill.avgPrice,
      fee,
      feeCoin,
      rejectReason: null,
    };
    const changes: Array<[string, Decimal]> =
      order.side === 'BUY'
        ? [
            [rules.baseCoin, fill.filledBaseQty.minus(fee)],
            [rules.quoteCoin, fill.filledQuoteAmount.neg()],
          ]
        : [
            [rules.baseCoin, fill.filledBaseQty.neg()],
            [rules.quoteCoin, fill.filledQuoteAmount.minus(fee)],
          ];
    return this.#store(order, state, changes);
  }

  async #balanceProblem(order: MarketOrderRequest, rules: InstrumentRules): Promise<string | null> {
    const balances = await this.getBalances();
    const free = (coin: string) => balances.find((b) => b.coin === coin)?.walletBalance ?? ZERO;
    if (order.side === 'BUY' && order.quoteAmount.gt(free(rules.quoteCoin))) {
      return `insufficient ${rules.quoteCoin}`;
    }
    if (order.side === 'SELL' && order.baseQty.gt(free(rules.baseCoin))) {
      return `insufficient ${rules.baseCoin}`;
    }
    return null;
  }

  /** Writes the order and its balance changes in one transaction. */
  async #store(order: MarketOrderRequest, state: OrderState, changes: Array<[string, Decimal]>): Promise<OrderState> {
    await this.#db.transaction(async (tx) => {
      for (const [coin, delta] of changes) {
        const rows = await tx
          .select()
          .from(paperBalances)
          .where(and(eq(paperBalances.userId, this.#userId), eq(paperBalances.coin, coin)));
        const next = (rows[0] === undefined ? ZERO : new Decimal(rows[0].free)).plus(delta);
        if (next.isNeg()) {
          throw new Error(`the paper ${coin} balance would go below zero`);
        }
        await tx
          .insert(paperBalances)
          .values({ userId: this.#userId, coin, free: next.toFixed() })
          .onConflictDoUpdate({ target: [paperBalances.userId, paperBalances.coin], set: { free: next.toFixed() } });
      }
      await tx.insert(paperOrders).values({
        clientOrderId: state.clientOrderId,
        userId: this.#userId,
        symbol: order.symbol,
        side: order.side,
        requested: (order.side === 'BUY' ? order.quoteAmount : order.baseQty).toFixed(),
        status: state.status,
        filledBaseQty: state.filledBaseQty.toFixed(),
        filledQuoteAmount: state.filledQuoteAmount.toFixed(),
        avgPrice: state.avgPrice === null ? null : state.avgPrice.toFixed(),
        fee: state.fee.toFixed(),
        feeCoin: state.feeCoin,
        rejectReason: state.rejectReason,
        createdAt: new Date(),
      });
    });
    return state;
  }
}

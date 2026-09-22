import Decimal from 'decimal.js';
import type { Heartbeat } from '../../src/alerts/heartbeat.js';
import type { Alerter } from '../../src/alerts/telegram.js';
import type { Database } from '../../src/db/client.js';
import type { CycleDeps, TickOutcome, UserOutcome } from '../../src/engine/cycle.js';
import type { CoinBalance } from '../../src/exchange/account.js';
import type { MarketOrderRequest, OrderLookup, OrderState, TradingAccount } from '../../src/exchange/trading.js';
import { Ledger } from '../../src/ledger/ledger.js';
import { PaperAccount } from '../../src/paper/paperAccount.js';
import { AccountStates } from '../../src/state/accountState.js';
import { AlertLog } from '../../src/state/alertLog.js';
import { CycleRuns } from '../../src/state/cycleRuns.js';
import { CHOSEN_MA_PERIOD, trendFilter } from '../../src/strategy/trendFilter.js';
import type { Candle } from '../../src/types.js';
import { DAY } from './candles.js';
import { FakeMarket } from './fakeMarket.js';

export const FEE_RATE = new Decimal('0.001');

export class RecordingAlerter implements Alerter {
  messages: string[] = [];

  async send(message: string): Promise<void> {
    this.messages.push(message);
  }
}

export class CountingHeartbeat implements Heartbeat {
  pings = 0;

  async ping(): Promise<boolean> {
    this.pings += 1;
    return true;
  }
}

export type Harness = {
  deps: CycleDeps;
  market: FakeMarket;
  alerts: RecordingAlerter;
  heartbeat: CountingHeartbeat;
  kill: { on: boolean };
  clock: { now: number };
  ledger: Ledger;
  accounts: AccountStates;
  runs: CycleRuns;
  /** Wraps the paper account the engine is given, to simulate a misbehaving exchange. */
  wrap: (account: TradingAccount) => TradingAccount;
  /** The founder's paper account, unwrapped. */
  paper: () => PaperAccount;
};

/** Real ledger, state, and paper account on the test database; fake market, clock, alerts, and heartbeat. */
export function harness(db: Database, market = new FakeMarket()): Harness {
  const clock = { now: 0 };
  const kill = { on: false };
  const alerts = new RecordingAlerter();
  const heartbeat = new CountingHeartbeat();
  const ledger = new Ledger(db);
  const accounts = new AccountStates(db);
  const runs = new CycleRuns(db);
  const paperFor = (userId: string) => new PaperAccount({ db, userId, market, feeRate: FEE_RATE });
  const h: Harness = {
    market,
    alerts,
    heartbeat,
    kill,
    clock,
    ledger,
    accounts,
    runs,
    wrap: (account) => account,
    paper: () => paperFor('founder'),
    deps: {
      ledger,
      accounts,
      runs,
      alertLog: new AlertLog(db),
      market,
      accountFor: (userId) => h.wrap(paperFor(userId)),
      killSwitch: { isOn: () => kill.on },
      alerter: alerts,
      heartbeat,
      now: () => clock.now,
      symbol: 'BTCUSDT',
      strategy: trendFilter({ maPeriod: CHOSEN_MA_PERIOD }),
      maPeriod: CHOSEN_MA_PERIOD,
      candleCount: 250,
      maxOrderUsdt: null,
      pollIntervalMs: 1_000,
      pollTimeoutMs: 5_000,
      // Sleeping advances the fake clock, so polling ends without real waiting.
      sleep: async (ms) => {
        clock.now += ms;
      },
    },
  };
  return h;
}

export async function openFounder(
  db: Database,
  usdt = '1000',
  at = new Date('2026-01-01T00:00:00Z'),
): Promise<void> {
  await PaperAccount.open(db, { userId: 'founder', baseCoin: 'BTC', quoteCoin: 'USDT', startingQuote: new Decimal(usdt), at });
}

/** Serves `candles`, and prices the market at the last close. */
export function setMarket(h: Harness, candles: Candle[]): void {
  h.market.candles = candles;
  h.market.setPrice(candles[candles.length - 1]!.close);
}

/** The first tick after a day's candle closes: 00:02 UTC the next day. */
export function tickTimeAfter(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) + DAY + 2 * 60_000;
}

/** The user outcomes of a tick that ran; fails the test if it did not. */
export function ran(outcome: TickOutcome): UserOutcome[] {
  if (outcome.kind !== 'RAN') {
    throw new Error(`expected the tick to run, but it returned ${outcome.kind}`);
  }
  return outcome.users;
}

/** Places the order for real, then throws — as when a request times out after the exchange accepted it. */
export function failsAfterPlacing(inner: TradingAccount): TradingAccount {
  return {
    getBalances: () => inner.getBalances(),
    getOrder: (id) => inner.getOrder(id),
    placeMarketOrder: async (order) => {
      await inner.placeMarketOrder(order);
      throw new Error('the request timed out');
    },
  };
}

/** Throws without placing — as when a request times out before it reaches the exchange. */
export function failsBeforePlacing(inner: TradingAccount): TradingAccount {
  return {
    getBalances: () => inner.getBalances(),
    getOrder: (id) => inner.getOrder(id),
    placeMarketOrder: async () => {
      throw new Error('the request timed out');
    },
  };
}

/** Its order lookups throw `times` times before working — inconclusive lookups. */
export function lookupFails(inner: TradingAccount, times: number): TradingAccount {
  let left = times;
  return {
    getBalances: () => inner.getBalances(),
    placeMarketOrder: (order) => inner.placeMarketOrder(order),
    getOrder: async (id) => {
      if (left > 0) {
        left -= 1;
        throw new Error('the lookup timed out');
      }
      return inner.getOrder(id);
    },
  };
}

/** Its order lookups answer NOT_VISIBLE `times` times before answering for real — an exchange slow to show orders. */
export function hidesOrders(inner: TradingAccount, times: number): TradingAccount {
  let left = times;
  return {
    getBalances: () => inner.getBalances(),
    placeMarketOrder: (order) => inner.placeMarketOrder(order),
    getOrder: async (id) => {
      if (left > 0) {
        left -= 1;
        return { kind: 'NOT_VISIBLE' };
      }
      return inner.getOrder(id);
    },
  };
}

/** Reports every order FILLED without moving any balance: a reconciliation mismatch. */
export function fillsWithoutMoving(inner: TradingAccount): TradingAccount {
  return {
    getBalances: () => inner.getBalances(),
    getOrder: (id) => inner.getOrder(id),
    placeMarketOrder: async (order) => ({
      clientOrderId: order.clientOrderId,
      side: order.side,
      status: 'FILLED',
      filledBaseQty: new Decimal('0.01'),
      filledQuoteAmount: new Decimal('799'),
      avgPrice: new Decimal('79900'),
      fee: new Decimal(0),
      feeCoin: 'BTC',
      rejectReason: null,
    }),
  };
}

/** Reports the given balances instead of the account's own. */
export function withBalances(inner: TradingAccount, read: () => Promise<CoinBalance[]>): TradingAccount {
  return {
    getBalances: read,
    getOrder: (id) => inner.getOrder(id),
    placeMarketOrder: (order) => inner.placeMarketOrder(order),
  };
}

function pendingState(order: MarketOrderRequest): OrderState {
  return {
    clientOrderId: order.clientOrderId,
    side: order.side,
    status: 'PENDING',
    filledBaseQty: new Decimal(0),
    filledQuoteAmount: new Decimal(0),
    avgPrice: null,
    fee: new Decimal(0),
    feeCoin: 'BTC',
    rejectReason: null,
  };
}

/** Accepts an order as PENDING and fills it only after `release()` — an exchange slow to settle. */
export class SlowAccount implements TradingAccount {
  #request: MarketOrderRequest | null = null;
  #settled: OrderState | null = null;
  #released = false;

  constructor(private readonly inner: TradingAccount) {}

  release(): void {
    this.#released = true;
  }

  getBalances(): Promise<CoinBalance[]> {
    return this.inner.getBalances();
  }

  async placeMarketOrder(order: MarketOrderRequest): Promise<OrderState> {
    this.#request = order;
    return pendingState(order);
  }

  async getOrder(id: string): Promise<OrderLookup> {
    if (this.#request === null || this.#request.clientOrderId !== id) {
      return this.inner.getOrder(id);
    }
    if (!this.#released) {
      return { kind: 'FOUND', state: pendingState(this.#request) };
    }
    this.#settled ??= await this.inner.placeMarketOrder(this.#request);
    return { kind: 'FOUND', state: this.#settled };
  }
}

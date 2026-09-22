import type Decimal from 'decimal.js';
import type { Heartbeat } from '../alerts/heartbeat.js';
import type { Alerter } from '../alerts/telegram.js';
import type { MarketOrderRequest, OrderState, TradingAccount } from '../exchange/trading.js';
import type { Ledger } from '../ledger/ledger.js';
import { midPrice, type OrderBook } from '../market/orderBook.js';
import type { InstrumentRules, MarketData } from '../market/types.js';
import { mean } from '../math.js';
import type { AccountRecord, AccountStates } from '../state/accountState.js';
import type { AlertLog } from '../state/alertLog.js';
import type { CycleRuns } from '../state/cycleRuns.js';
import type { StrategyFn, TargetState } from '../types.js';
import { checkCandleWindow } from './candleWindow.js';
import { cycleDate, dueAt, isLate } from './cycleDate.js';
import { borrowedCoins, holdingsFor, lockedCoins, type Holdings } from './holdings.js';
import { clientOrderId, intentFor } from './orderId.js';
import { atTarget } from './reconcile.js';
import { checkOrder } from './riskGuard.js';
import { sizeOrder, type SizedOrder } from './sizing.js';

/** An order still pending this long after its intent freezes the account. */
export const PENDING_FREEZE_AFTER_MS = 60 * 60_000;

/**
 * An order the account still cannot see this long after its intent freezes the
 * account for a person to check. Time never proves absence, so the engine
 * waits rather than retries.
 */
export const NOT_VISIBLE_FREEZE_AFTER_MS = 60 * 60_000;

export type CycleDeps = {
  ledger: Ledger;
  accounts: AccountStates;
  runs: CycleRuns;
  alertLog: AlertLog;
  market: MarketData;
  accountFor: (userId: string) => TradingAccount;
  killSwitch: { isOn(): boolean };
  alerter: Alerter;
  heartbeat: Heartbeat;
  now: () => number;
  symbol: string;
  strategy: StrategyFn;
  /** The strategy's moving-average period: the window's minimum length, and the average recorded with the signal. */
  maPeriod: number;
  /** How many closed daily candles to fetch. */
  candleCount: number;
  maxOrderUsdt: Decimal | null;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  sleep: (ms: number) => Promise<void>;
};

export type UserOutcome = {
  userId: string;
  result: 'COMPLETED' | 'FROZEN' | 'TOO_SMALL' | 'WAITING' | 'RETRY_LATER' | 'KILL_SWITCH';
  detail: string;
};

export type TickOutcome =
  | { kind: 'KILL_SWITCH' }
  | { kind: 'NOTHING_TO_DO' }
  | { kind: 'RETRY_LATER'; reason: string }
  | { kind: 'RAN'; users: UserOutcome[] };

type Run = { deps: CycleDeps; userId: string; date: string; at: Date };
type Stop = { kind: 'STOPPED'; outcome: UserOutcome };

/**
 * One tick of the engine. The timer runs this every 15 minutes; it does the
 * day's work once, and every later tick that day is a cheap no-op. The steps,
 * and why they come in this order, are in spec section 4.
 */
export async function runTick(deps: CycleDeps): Promise<TickOutcome> {
  const now = deps.now();
  const at = new Date(now);
  const date = cycleDate(now);

  if (deps.killSwitch.isOn()) {
    if (await deps.alertLog.claim(`${date}:system:kill-switch`, at)) {
      await deps.ledger.append({ occurredAt: at, userId: null, cycleDate: date, type: 'KILL_SWITCH_SKIP', payload: {} });
      await deps.alerter.send(`The kill switch is on, so nothing trades for ${date}.`);
    }
    return { kind: 'KILL_SWITCH' };
  }

  for (const run of await deps.runs.abandonBefore(date)) {
    await deps.ledger.append({
      occurredAt: at,
      userId: run.userId,
      cycleDate: run.cycleDate,
      type: 'RUN_ABANDONED',
      payload: { lastError: run.lastError },
    });
    await deps.alerter.send(
      `Abandoned the ${run.cycleDate} run for ${run.userId}: it did not complete before the next daily close.` +
        (run.lastError === null ? '' : ` Last error: ${run.lastError}.`) +
        ' Any order it sent is still settled and recorded before the account trades again.',
    );
  }

  const accounts = await deps.accounts.all();
  if (accounts.length === 0) {
    if (await deps.alertLog.claim(`${date}:system:no-accounts`, at)) {
      await deps.alerter.send('There are no accounts to trade. Run npm run paper:init to open one.');
    }
    return { kind: 'NOTHING_TO_DO' };
  }
  for (const account of accounts) {
    if (account.status !== 'active' && (await deps.alertLog.claim(`${date}:${account.userId}:reminder`, at))) {
      await deps.alerter.send(reminder(account));
    }
  }

  const needing: string[] = [];
  for (const account of accounts) {
    if (account.status === 'active' && (await deps.runs.get(date, account.userId))?.status !== 'completed') {
      needing.push(account.userId);
    }
  }
  if (needing.length === 0) {
    await heartbeatOnce(deps, date, at);
    return { kind: 'NOTHING_TO_DO' };
  }

  let signal: { target: TargetState; close: Decimal };
  try {
    signal = await readSignal(deps, date, at);
  } catch (error) {
    const reason = describeError(error);
    for (const userId of needing) {
      await deps.runs.startAttempt(date, userId, at);
      await deps.runs.recordError(date, userId, reason);
    }
    if (await deps.alertLog.claim(`${date}:system:failure`, at)) {
      await deps.ledger.append({ occurredAt: at, userId: null, cycleDate: date, type: 'RUN_FAILED', payload: { reason } });
      await deps.alerter.send(`The ${date} run could not start: ${reason}. It keeps retrying until the next daily close.`);
    }
    return { kind: 'RETRY_LATER', reason };
  }

  const users: UserOutcome[] = [];
  for (const userId of needing) {
    users.push(await runUser({ deps, userId, date, at }, signal.target, signal.close));
  }
  if ((await deps.runs.pendingFor(date)).length === 0) {
    await heartbeatOnce(deps, date, at);
  }
  return { kind: 'RAN', users };
}

/** Fetches and validates the candle window, evaluates the strategy, and records the day's signal once. */
async function readSignal(deps: CycleDeps, date: string, at: Date): Promise<{ target: TargetState; close: Decimal }> {
  const candles = await deps.market.getClosedDailyCandles(deps.symbol, deps.candleCount, at.getTime());
  const check = checkCandleWindow(candles, date, deps.maPeriod);
  if (!check.ok) {
    throw new Error(`the candle data was rejected: ${check.reason}`);
  }
  const target = deps.strategy(candles);
  const close = candles[candles.length - 1]!.close;
  if ((await deps.ledger.signalFor(date)) === null) {
    await deps.ledger.append({
      occurredAt: at,
      userId: null,
      cycleDate: date,
      type: 'SIGNAL',
      payload: {
        target,
        close,
        movingAverage: mean(candles.slice(-deps.maPeriod).map((c) => c.close)),
        maPeriod: deps.maPeriod,
      },
    });
  }
  return { target, close };
}

async function runUser(run: Run, target: TargetState, signalClose: Decimal): Promise<UserOutcome> {
  const { deps, userId, date, at } = run;
  await deps.runs.startAttempt(date, userId, at);
  const account = deps.accountFor(userId);
  try {
    // 1. Settle every outstanding order, from any day, before anything else.
    const settled = await settleOutstanding(run, account);
    if (settled.kind === 'STOPPED') {
      return settled.outcome;
    }
    const rules = await deps.market.getInstrumentRules(deps.symbol);
    let filled = settled.todaysFill;

    if (filled === null) {
      // 2. Balances.
      const balances = await account.getBalances();
      const borrowed = borrowedCoins(balances);
      if (borrowed.length > 0) {
        return await freeze(
          run,
          `there are borrowed funds on ${borrowed.join(' and ')}; repay them and turn off automatic borrowing`,
        );
      }
      const holdings = holdingsFor(balances, rules);
      const locked = lockedCoins(holdings, rules);
      if (locked.length > 0) {
        return await freeze(run, lockedReason(locked));
      }

      // 3. Size.
      const book = await deps.market.getOrderBook(deps.symbol);
      const sizing = sizeOrder(target, holdings, midPrice(book), rules);
      if (sizing.kind === 'TOO_SMALL') {
        return await tooSmall(run, sizing.reason);
      }
      if (sizing.kind === 'ORDER') {
        // 4 to 6: the Risk Guard, the intent, the order, and its result.
        const placement = await placeOrder(run, account, sizing.order, { holdings, rules, book, signalClose });
        if (placement.kind === 'STOPPED') {
          return placement.outcome;
        }
        filled = placement.state;
      }
    }

    // 7. Reconcile, on total balances.
    return await reconcile(run, account, rules, target, filled);
  } catch (error) {
    // Nothing is recorded as a result here. An intent written before the error
    // stays outstanding, and the next tick settles it through its client order ID.
    const reason = describeError(error);
    await deps.runs.recordError(date, userId, reason);
    if (await deps.alertLog.claim(`${date}:${userId}:failure`, at)) {
      await deps.ledger.append({ occurredAt: at, userId, cycleDate: date, type: 'RUN_FAILED', payload: { reason } });
      await deps.alerter.send(
        `The ${date} run for ${userId} hit an error and will retry: ${reason}. If an order was being sent, its outcome is settled at the next run.`,
      );
    }
    return { userId, result: 'RETRY_LATER', detail: reason };
  }
}

type Settlement = { kind: 'CLEAR'; todaysFill: OrderState | null } | Stop;

/**
 * Step 1: gives every outstanding intent, from any day, exactly one recorded
 * result — or stops. Only the adapter's proof of absence records NOT_PLACED;
 * elapsed time and an empty lookup never do (spec sections 4 and 4.2). A lookup
 * that throws is inconclusive: it records nothing and propagates to runUser,
 * which retries at the next tick.
 */
async function settleOutstanding(run: Run, account: TradingAccount): Promise<Settlement> {
  const { deps, userId, date, at } = run;
  let todaysFill: OrderState | null = null;
  for (const intent of await deps.ledger.outstandingIntents(userId)) {
    const id = String(intent.payload.clientOrderId);
    const intentDate = intent.cycleDate ?? date;
    const age = at.getTime() - intent.occurredAt.getTime();
    const lookup = await account.getOrder(id);
    if (lookup.kind === 'ABSENT') {
      await deps.ledger.append({
        occurredAt: at,
        userId,
        cycleDate: intentDate,
        type: 'ORDER_RESULT',
        payload: { clientOrderId: id, status: 'NOT_PLACED' },
      });
      continue;
    }
    if (lookup.kind === 'NOT_VISIBLE') {
      if (age >= NOT_VISIBLE_FREEZE_AFTER_MS) {
        return {
          kind: 'STOPPED',
          outcome: await freeze(
            run,
            `order ${id} from ${intentDate} has not been visible for over an hour, and the account cannot prove it was never placed; check the exchange by hand`,
          ),
        };
      }
      return waiting(
        run,
        `order ${id} from ${intentDate} is not visible yet; no replacement is placed until the account can say what happened to it`,
      );
    }
    const { state } = lookup;
    if (state.status === 'PENDING') {
      if (age >= PENDING_FREEZE_AFTER_MS) {
        return { kind: 'STOPPED', outcome: await freeze(run, `order ${id} from ${intentDate} has been pending for over an hour`) };
      }
      return waiting(run, `order ${id} from ${intentDate} is still pending`);
    }
    await recordResult(run, intentDate, state);
    if (state.status !== 'FILLED') {
      return { kind: 'STOPPED', outcome: await freeze(run, unfilledReason(state)) };
    }
    if (intentDate === date) {
      todaysFill = state;
    }
  }
  return { kind: 'CLEAR', todaysFill };
}

async function waiting(run: Run, detail: string): Promise<Stop> {
  await run.deps.runs.recordError(run.date, run.userId, detail);
  return { kind: 'STOPPED', outcome: { userId: run.userId, result: 'WAITING', detail } };
}

type MarketView = { holdings: Holdings; rules: InstrumentRules; book: OrderBook; signalClose: Decimal };
type Placement = { kind: 'FILLED'; state: OrderState } | Stop;

/** Steps 4 to 6: the attempt number, the Risk Guard, the intent, the order, and its result. */
async function placeOrder(run: Run, account: TradingAccount, order: SizedOrder, view: MarketView): Promise<Placement> {
  const { deps, userId, date, at } = run;
  const intent = intentFor(order.side);
  const today = await deps.ledger.ordersOn(userId, date);
  const attempt = today.filter((o) => o.intent.payload.intent === intent).length + 1;
  const id = clientOrderId(userId, date, intent, attempt);

  // Everything the Risk Guard needs that must be awaited is fetched first, so
  // the kill switch is read after it: a switch turned on during these requests
  // is seen. The kill switch stops trading; it never freezes an account.
  const accountStatus = (await deps.accounts.get(userId))?.status ?? 'frozen';
  const ticker = await deps.market.getTicker(deps.symbol);
  if (deps.killSwitch.isOn()) {
    return killSwitchStop(run, null);
  }
  const decision = checkOrder(order, {
    killSwitchOn: deps.killSwitch.isOn(),
    accountStatus,
    priorOrderToday: today.some((o) => o.result?.payload.status !== 'NOT_PLACED'),
    attempt,
    holdings: view.holdings,
    rules: view.rules,
    book: view.book,
    ticker,
    signalClose: view.signalClose,
    maxOrderUsdt: deps.maxOrderUsdt,
  });
  if (!decision.approved) {
    return { kind: 'STOPPED', outcome: await freeze(run, `the Risk Guard vetoed the order. ${decision.reasons.join(' ')}`) };
  }

  // The intent is written first, so a crash after the order is sent is settled
  // at the next tick, never repeated. A placement that throws is uncertain, not
  // failed: its error reaches runUser, and the intent stays outstanding.
  await deps.ledger.append({
    occurredAt: at,
    userId,
    cycleDate: date,
    type: 'ORDER_INTENT',
    payload: { clientOrderId: id, intent, attempt, ...describeOrder(order), midPrice: midPrice(view.book) },
  });

  // The submission boundary. The switch is read once more after the last await,
  // with nothing between this read and the call to the account. Turned on before
  // this line, no order is sent; turned on after it, the order is on its way and
  // settles like any other (spec section 4.2).
  if (deps.killSwitch.isOn()) {
    return killSwitchStop(run, id);
  }
  const placed = account.placeMarketOrder(toRequest(id, deps.symbol, order));
  const state = await awaitSettlement(deps, account, await placed);

  if (state.status === 'PENDING') {
    return waiting(run, `order ${id} is still pending`);
  }
  await recordResult(run, date, state);
  if (state.status !== 'FILLED') {
    return { kind: 'STOPPED', outcome: await freeze(run, unfilledReason(state)) };
  }
  return { kind: 'FILLED', state };
}

/** Polls a pending order until it settles or the poll window closes. Paper orders never pend. */
async function awaitSettlement(deps: CycleDeps, account: TradingAccount, placed: OrderState): Promise<OrderState> {
  let current = placed;
  const giveUpAt = deps.now() + deps.pollTimeoutMs;
  while (current.status === 'PENDING' && deps.now() < giveUpAt) {
    await deps.sleep(deps.pollIntervalMs);
    const lookup = await account.getOrder(placed.clientOrderId);
    if (lookup.kind === 'FOUND') {
      current = lookup.state;
    }
  }
  return current;
}

/** Step 7: the account must now be at its target, judged on totals, with nothing locked. */
async function reconcile(
  run: Run,
  account: TradingAccount,
  rules: InstrumentRules,
  target: TargetState,
  filled: OrderState | null,
): Promise<UserOutcome> {
  const { deps, userId, date, at } = run;
  const holdings = holdingsFor(await account.getBalances(), rules);
  const locked = lockedCoins(holdings, rules);
  if (locked.length > 0) {
    return freeze(run, lockedReason(locked));
  }
  const price = midPrice(await deps.market.getOrderBook(deps.symbol));
  if (!atTarget(target, holdings, price, rules)) {
    return freeze(run, `after the run the account is not ${target}: it holds ${describeHoldings(holdings, rules)}`);
  }
  const late = isLate(date, at.getTime());
  await deps.ledger.append({
    occurredAt: at,
    userId,
    cycleDate: date,
    type: 'RECONCILED',
    payload: { target, base: holdings.base.total, quote: holdings.quote.total, price },
  });
  await deps.runs.complete(date, userId, at, late);
  await deps.ledger.append({ occurredAt: at, userId, cycleDate: date, type: 'RUN_COMPLETED', payload: { late } });
  await deps.alerter.send(summary(run, target, filled, holdings, rules, late));
  return { userId, result: 'COMPLETED', detail: filled === null ? 'no change' : `${filled.side} filled` };
}

async function freeze(run: Run, reason: string): Promise<UserOutcome> {
  const { deps, userId, date, at } = run;
  const text = reason.replace(/\.\s*$/, '');
  await deps.accounts.freeze(userId, date, text, at);
  await deps.runs.markFrozen(date, userId, text);
  // This alert is today's reminder, so the next tick does not repeat it.
  await deps.alertLog.claim(`${date}:${userId}:reminder`, at);
  await deps.alerter.send(
    `FROZE ${userId} for ${date}: ${text}. Nothing trades on this account until you check it and run: npm run unfreeze -- --reason "what you found"`,
  );
  return { userId, result: 'FROZEN', detail: text };
}

/**
 * Stops a run because the kill switch was turned on before its order was sent.
 * The run stays pending, so it resumes if the switch is turned off before the
 * next close. When the order's intent is already recorded, its one result is
 * recorded now as NOT_PLACED: this is proof, not an inference from time — the
 * engine never called the account with this ID, and no other process can have,
 * because each ID has exactly one intent.
 */
async function killSwitchStop(run: Run, unsentOrderId: string | null): Promise<Stop> {
  const { deps, userId, date, at } = run;
  let detail = 'the kill switch was turned on before the order was sent, so nothing was sent';
  if (unsentOrderId !== null) {
    await deps.ledger.append({
      occurredAt: at,
      userId,
      cycleDate: date,
      type: 'ORDER_RESULT',
      payload: { clientOrderId: unsentOrderId, status: 'NOT_PLACED', reason: 'the kill switch was turned on before it was sent' },
    });
    detail = `the kill switch was turned on after order ${unsentOrderId} was recorded and before it was sent, so it was not sent`;
  }
  await deps.runs.recordError(date, userId, detail);
  if (await deps.alertLog.claim(`${date}:system:kill-switch`, at)) {
    await deps.ledger.append({ occurredAt: at, userId: null, cycleDate: date, type: 'KILL_SWITCH_SKIP', payload: {} });
    await deps.alerter.send(`The kill switch is on, so nothing trades for ${date}. For ${userId}: ${detail}.`);
  }
  return { kind: 'STOPPED', outcome: { userId, result: 'KILL_SWITCH', detail } };
}

async function tooSmall(run: Run, reason: string): Promise<UserOutcome> {
  const { deps, userId, date, at } = run;
  await deps.ledger.append({ occurredAt: at, userId, cycleDate: date, type: 'TOO_SMALL', payload: { reason } });
  await deps.runs.complete(date, userId, at, isLate(date, at.getTime()));
  if (await deps.alertLog.claim(`${date}:${userId}:too-small`, at)) {
    await deps.alerter.send(`Nothing traded for ${userId} on ${date}: ${reason}.`);
  }
  return { userId, result: 'TOO_SMALL', detail: reason };
}

/** Records an order's result under its intent's own cycle date. */
async function recordResult(run: Run, intentDate: string, state: OrderState): Promise<void> {
  await run.deps.ledger.append({
    occurredAt: run.at,
    userId: run.userId,
    cycleDate: intentDate,
    type: 'ORDER_RESULT',
    payload: { ...state },
  });
}

async function heartbeatOnce(deps: CycleDeps, date: string, at: Date): Promise<void> {
  const key = `${date}:system:heartbeat`;
  if (!(await deps.alertLog.has(key)) && (await deps.heartbeat.ping())) {
    await deps.alertLog.claim(key, at);
  }
}

function toRequest(id: string, symbol: string, order: SizedOrder): MarketOrderRequest {
  return order.side === 'BUY'
    ? { clientOrderId: id, symbol, side: 'BUY', quoteAmount: order.quoteAmount }
    : { clientOrderId: id, symbol, side: 'SELL', baseQty: order.baseQty };
}

function describeOrder(order: SizedOrder): Record<string, unknown> {
  return order.side === 'BUY' ? { side: 'BUY', quoteAmount: order.quoteAmount } : { side: 'SELL', baseQty: order.baseQty };
}

function unfilledReason(state: OrderState): string {
  return state.status === 'REJECTED'
    ? `order ${state.clientOrderId} was rejected: ${state.rejectReason ?? 'no reason given'}`
    : `order ${state.clientOrderId} was only partly filled (${state.filledBaseQty.toFixed()}), and the rest was cancelled`;
}

function lockedReason(coins: string[]): string {
  return `${coins.join(' and ')} is locked, which in a dedicated account means an order the engine did not place; the account must not be traded by hand`;
}

function describeHoldings(holdings: Holdings, rules: InstrumentRules): string {
  return `${holdings.base.total.toFixed()} ${rules.baseCoin} and ${holdings.quote.total.toFixed()} ${rules.quoteCoin}`;
}

function describeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 300 ? `${text.slice(0, 300)}...` : text;
}

function reminder(account: AccountRecord): string {
  const why = account.reason === null ? '' : `: ${account.reason.replace(/\.\s*$/, '')}`;
  const how = account.status === 'frozen' ? 'npm run unfreeze -- --reason "what you found"' : 'npm run resume';
  return `Reminder: ${account.userId} is ${account.status}${why}. Nothing trades on it until you run ${how}.`;
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function summary(
  run: Run,
  target: TargetState,
  filled: OrderState | null,
  holdings: Holdings,
  rules: InstrumentRules,
  late: boolean,
): string {
  const lateText = late ? ` Completed late, ${formatDuration(run.at.getTime() - dueAt(run.date))} after the close.` : '';
  const now = `Holding ${describeHoldings(holdings, rules)}.`;
  if (filled === null) {
    return `${run.date}: ${target}, no change. ${now}${lateText}`;
  }
  const verb = filled.side === 'BUY' ? 'Bought' : 'Sold';
  const price = filled.avgPrice === null ? 'an unknown price' : filled.avgPrice.toFixed(2);
  return `${run.date}: ${target}. ${verb} ${filled.filledBaseQty.toFixed()} ${rules.baseCoin} for ${filled.filledQuoteAmount.toFixed(2)} ${rules.quoteCoin} at ${price}. ${now}${lateText}`;
}

/** One line per tick, for the log. */
export function describeOutcome(outcome: TickOutcome): string {
  switch (outcome.kind) {
    case 'KILL_SWITCH':
      return 'The kill switch is on: nothing traded.';
    case 'NOTHING_TO_DO':
      return 'Nothing to do.';
    case 'RETRY_LATER':
      return `Will retry: ${outcome.reason}`;
    case 'RAN':
      return outcome.users.map((u) => `${u.userId}: ${u.result}. ${u.detail}`).join('\n');
  }
}

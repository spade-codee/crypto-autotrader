import Decimal from 'decimal.js';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { paperBalances } from '../../src/db/schema.js';
import { runTick } from '../../src/engine/cycle.js';
import { clientOrderId } from '../../src/engine/orderId.js';
import { lastDay, trendingCandles } from '../helpers/candles.js';
import { useTestDatabase } from '../helpers/database.js';
import {
  failsAfterPlacing,
  failsBeforePlacing,
  fillsWithoutMoving,
  harness,
  hidesOrders,
  lookupFails,
  openFounder,
  ran,
  setMarket,
  SlowAccount,
  tickTimeAfter,
  withBalances,
  type Harness,
} from '../helpers/engine.js';
import { balances, bookAround, RULES } from '../helpers/market.js';

const database = useTestDatabase();
const UP = trendingCandles('2026-01-01', 300, 'up');
const DOWN = trendingCandles('2026-01-01', 300, 'down');
const NEXT = trendingCandles('2026-01-01', 301, 'up');
const DAY_ONE = lastDay(UP);
const PRICE = UP[UP.length - 1]!.close;
const MINUTE = 60_000;

async function setup(candles = UP): Promise<Harness> {
  const h = harness(database());
  setMarket(h, candles);
  h.clock.now = tickTimeAfter(lastDay(candles));
  await openFounder(database());
  return h;
}

/** Moves the harness to the first tick of the day after DAY_ONE. */
function nextDayTick(h: Harness): void {
  setMarket(h, NEXT);
  h.clock.now = tickTimeAfter(lastDay(NEXT));
}

/** The founder's paper balances, as text. */
async function holdings(h: Harness): Promise<{ btc: string; usdt: string }> {
  const balances = await h.paper().getBalances();
  const of = (coin: string) => balances.find((b) => b.coin === coin)!.walletBalance.toFixed();
  return { btc: of('BTC'), usdt: of('USDT') };
}

function retryReason(outcome: Awaited<ReturnType<typeof runTick>>): string {
  if (outcome.kind !== 'RETRY_LATER') {
    throw new Error(`expected RETRY_LATER, got ${outcome.kind}`);
  }
  return outcome.reason;
}

describe('when the market cannot be read', () => {
  it('retries the whole tick when the instrument’s rules cannot be read', async () => {
    const h = await setup();
    h.market.fail.rules = new Error('the rules request timed out');
    expect(retryReason(await runTick(h.deps))).toContain('the rules request timed out');
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(0);
  });

  it('retries, alerting once, and completes late when Bybit returns', async () => {
    const h = await setup();
    h.market.fail.candles = new Error('could not reach any host: https://api.bybit.com');
    expect((await runTick(h.deps)).kind).toBe('RETRY_LATER');
    h.clock.now += 15 * MINUTE;
    expect((await runTick(h.deps)).kind).toBe('RETRY_LATER');
    expect(h.alerts.messages.filter((m) => m.includes('could not start'))).toHaveLength(1);
    expect(await h.runs.get(DAY_ONE, 'founder')).toMatchObject({ status: 'pending', attempts: 2 });

    delete h.market.fail.candles;
    h.clock.now = tickTimeAfter(DAY_ONE) + 120 * MINUTE;
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('COMPLETED');
    expect(await h.runs.get(DAY_ONE, 'founder')).toMatchObject({ status: 'completed', late: true, attempts: 3 });
    expect(h.alerts.messages.at(-1)).toContain('Completed late');
  });

  it('rejects a stale candle window and computes no signal', async () => {
    const h = await setup();
    h.market.candles = UP.slice(0, -1);
    expect(retryReason(await runTick(h.deps))).toContain(`expected ${DAY_ONE}`);
    expect(await h.ledger.ofType('SIGNAL', null)).toHaveLength(0);
  });

  it('rejects a candle window with a gap', async () => {
    const h = await setup();
    const gappy = [...UP];
    gappy.splice(250, 1);
    h.market.candles = gappy;
    expect(retryReason(await runTick(h.deps))).toContain('missing');
  });

  it('rejects a candle window with an invalid price', async () => {
    const h = await setup();
    const broken = UP.map((c) => ({ ...c }));
    broken[290] = { ...broken[290]!, close: new Decimal(0), low: new Decimal(0) };
    h.market.candles = broken;
    expect(retryReason(await runTick(h.deps))).toContain('not a positive number');
  });

  it('treats a stalled request like any failed request', async () => {
    const h = await setup();
    h.market.fail.book = new Error('the request to https://api.bybit.com/v5/market/orderbook timed out');
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('RETRY_LATER');
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(0);
    expect(h.alerts.messages.at(-1)).toContain('will retry');
  });

  it('abandons a day that never completed, then runs the next', async () => {
    const h = await setup();
    h.market.fail.candles = new Error('could not reach any host');
    await runTick(h.deps);
    delete h.market.fail.candles;
    nextDayTick(h);
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('COMPLETED');
    expect((await h.runs.get(DAY_ONE, 'founder'))?.status).toBe('abandoned');
    expect(await h.ledger.ofType('RUN_ABANDONED', 'founder')).toHaveLength(1);
    expect(h.alerts.messages.some((m) => m.startsWith(`Abandoned the ${DAY_ONE} run`))).toBe(true);
  });
});

describe('when something unexpected happens, it freezes', () => {
  it('on a Risk Guard veto', async () => {
    const h = await setup();
    h.market.book = bookAround(PRICE, '5', '0.01');
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('FROZEN');
    expect(user!.detail).toContain('spread');
    expect((await h.accounts.get('founder'))?.status).toBe('frozen');
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(0);
    expect(h.alerts.messages.at(-1)).toMatch(/^FROZE founder/);
  });

  it('on a partial fill', async () => {
    const h = await setup();
    // The first book sizes the order and passes the Risk Guard; the paper account fills against the second.
    h.market.books = [bookAround(PRICE), bookAround(PRICE, '0.001')];
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('FROZEN');
    expect(user!.detail).toContain('only partly filled');
  });

  it('on a reconciliation mismatch', async () => {
    const h = await setup();
    h.wrap = fillsWithoutMoving;
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('FROZEN');
    expect(user!.detail).toContain('not LONG');
  });

  it('on borrowed funds', async () => {
    const h = await setup();
    h.wrap = (inner) => withBalances(inner, async () => balances('0', '1000', { borrowedUsdt: '10' }));
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('FROZEN');
    expect(user!.detail).toContain('borrowed');
  });

  it('on locked BTC, rather than counting the account as FLAT', async () => {
    const h = await setup(DOWN);
    h.wrap = (inner) => withBalances(inner, async () => balances('0.01', '1000', { lockedBtc: '0.01' }));
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('FROZEN');
    expect(user!.detail).toContain('BTC is locked');
    expect((await h.runs.get(lastDay(DOWN), 'founder'))?.status).toBe('frozen');
  });

  it('on locked USDT', async () => {
    const h = await setup();
    h.wrap = (inner) => withBalances(inner, async () => balances('0', '1000', { lockedUsdt: '100' }));
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('FROZEN');
    expect(user!.detail).toContain('USDT is locked');
  });
});

describe('frozen, paused, and stopped accounts', () => {
  it('stays frozen until unfrozen, then catches up the same day', async () => {
    const h = await setup();
    h.market.book = bookAround(PRICE, '5', '0.01');
    await runTick(h.deps);
    h.clock.now += 15 * MINUTE;
    expect(await runTick(h.deps)).toEqual({ kind: 'NOTHING_TO_DO' });
    const alertsSoFar = h.alerts.messages.length;

    h.market.setPrice(PRICE);
    await h.accounts.unfreeze('founder', 'the spread was a glitch', new Date(h.clock.now));
    h.clock.now += 15 * MINUTE;
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('COMPLETED');
    expect(await h.runs.get(DAY_ONE, 'founder')).toMatchObject({ status: 'completed', attempts: 2 });
    expect(h.alerts.messages).toHaveLength(alertsSoFar + 1);
  });

  it('reminds once a day while frozen, and never abandons the frozen day', async () => {
    const h = await setup();
    h.market.book = bookAround(PRICE, '5', '0.01');
    await runTick(h.deps);
    nextDayTick(h);
    await runTick(h.deps);
    h.clock.now += 15 * MINUTE;
    await runTick(h.deps);
    expect(h.alerts.messages.filter((m) => m.startsWith('Reminder: founder is frozen'))).toHaveLength(1);
    expect((await h.runs.get(DAY_ONE, 'founder'))?.status).toBe('frozen');
  });

  it('skips a paused account, reminding once a day', async () => {
    const h = await setup();
    await h.accounts.pause('founder', 'travelling', new Date(h.clock.now));
    expect(await runTick(h.deps)).toEqual({ kind: 'NOTHING_TO_DO' });
    h.clock.now += 15 * MINUTE;
    await runTick(h.deps);
    expect(h.alerts.messages.filter((m) => m.startsWith('Reminder: founder is paused'))).toHaveLength(1);
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(0);
  });

  it('trades nothing while the kill switch is on, alerting once a day', async () => {
    const h = await setup();
    h.kill.on = true;
    expect(await runTick(h.deps)).toEqual({ kind: 'KILL_SWITCH' });
    h.clock.now += 15 * MINUTE;
    expect(await runTick(h.deps)).toEqual({ kind: 'KILL_SWITCH' });
    expect(h.alerts.messages).toHaveLength(1);
    expect(await h.ledger.ofType('KILL_SWITCH_SKIP', null)).toHaveLength(1);
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(0);
  });

  it('names both stops in the daily reminder when an account is paused and frozen', async () => {
    const h = await setup();
    await h.accounts.pause('founder', 'travelling', new Date(h.clock.now));
    await h.accounts.freeze('founder', DAY_ONE, 'a partial fill', new Date(h.clock.now));
    await runTick(h.deps);
    const [reminder] = h.alerts.messages.filter((m) => m.startsWith('Reminder:'));
    expect(reminder).toContain('frozen: a partial fill');
    expect(reminder).toContain('paused: travelling');
    expect(reminder).toContain('npm run unfreeze');
    expect(reminder).toContain('npm run resume');
  });
});

describe('when the market moves between the Risk Guard and the fill', () => {
  it('rejects a buy that would now exceed the maximum market order, and freezes, changing nothing', async () => {
    const h = await setup();
    // At 79,900 the buy is 0.012501 BTC, within a 0.0126 maximum; at 79,100 it would be 0.012628.
    h.market.rules = { ...RULES, maxMarketOrderQty: new Decimal('0.0126') };
    h.market.books = [bookAround(PRICE), bookAround('79100')];
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('FROZEN');
    expect(user!.detail).toContain('above the maximum market order of 0.0126 BTC');
    expect((await h.ledger.ofType('ORDER_RESULT', 'founder')).map((e) => e.payload.status)).toEqual(['REJECTED']);
    expect(await holdings(h)).toEqual({ btc: '0', usdt: '1000' });
  });

  it('rejects a sell that would now be worth less than the minimum, and freezes, changing nothing', async () => {
    const h = await setup(DOWN);
    await database().update(paperBalances).set({ free: '0.00025' }).where(eq(paperBalances.coin, 'BTC'));
    await database().update(paperBalances).set({ free: '0' }).where(eq(paperBalances.coin, 'USDT'));
    // 0.00025 BTC is worth 5.025 USDT at 20,100, but only 4.9745 at the next book's bid.
    h.market.books = [bookAround(DOWN[DOWN.length - 1]!.close), bookAround('19900')];
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('FROZEN');
    expect(user!.detail).toContain('below the minimum order value of 5 USDT');
    expect(await holdings(h)).toEqual({ btc: '0.00025', usdt: '0' });
  });
});

describe('order books that cannot be trusted', () => {
  it('does not trade on a stale order book, and retries rather than freezing', async () => {
    const h = await setup();
    h.market.bookAgeMs = 60_000;
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('RETRY_LATER');
    expect(user!.detail).toContain('60.0 s old');
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(0);
    expect((await h.accounts.get('founder'))?.status).toBe('active');
  });

  it('does not trade on an order book stamped in the future', async () => {
    const h = await setup();
    h.market.bookAgeMs = -60_000;
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('RETRY_LATER');
    expect(user!.detail).toContain('clock');
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(0);
  });

  it('does not trade on an order book for another market', async () => {
    const h = await setup();
    h.market.book = { ...h.market.book, symbol: 'ETHUSDT' };
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('RETRY_LATER');
    expect(user!.detail).toContain('ETHUSDT, not BTCUSDT');
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(0);
  });

  it('checks the book is still fresh just before the order, after the slower requests', async () => {
    const h = await setup();
    const getTicker = h.market.getTicker.bind(h.market);
    h.market.getTicker = async () => {
      h.clock.now += 6_000; // a slow ticker request: the book fetched before it is now too old
      return getTicker();
    };
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('RETRY_LATER');
    expect(user!.detail).toContain('6.0 s old');
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(0);
  });
});

describe('the kill switch, turned on during a run', () => {
  it('sends nothing, and freezes nothing, when turned on while the ticker is fetched', async () => {
    const h = await setup();
    const getTicker = h.market.getTicker.bind(h.market);
    h.market.getTicker = async () => {
      h.kill.on = true;
      return getTicker();
    };
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('KILL_SWITCH');
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(0);
    expect(await holdings(h)).toEqual({ btc: '0', usdt: '1000' });
    expect((await h.accounts.get('founder'))?.status).toBe('active');
    expect((await h.runs.get(DAY_ONE, 'founder'))?.status).toBe('pending');

    // Once the switch is off, the day's run resumes.
    h.market.getTicker = getTicker;
    h.kill.on = false;
    h.clock.now += 15 * MINUTE;
    const [resumed] = ran(await runTick(h.deps));
    expect(resumed!.result).toBe('COMPLETED');
  });

  it('records the order as not placed when turned on between its intent and its submission', async () => {
    const h = await setup();
    const append = h.ledger.append.bind(h.ledger);
    h.ledger.append = async (event) => {
      await append(event);
      if (event.type === 'ORDER_INTENT') {
        h.kill.on = true;
      }
    };
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('KILL_SWITCH');
    const [intent] = await h.ledger.ofType('ORDER_INTENT', 'founder');
    const id = String(intent!.payload.clientOrderId);
    // The engine knows it never sent the order, so its one result is recorded at once.
    const results = await h.ledger.ofType('ORDER_RESULT', 'founder');
    expect(results.map((e) => [e.payload.clientOrderId, e.payload.status])).toEqual([[id, 'NOT_PLACED']]);
    expect(await h.paper().getOrder(id)).toEqual({ kind: 'ABSENT' });
    expect(await holdings(h)).toEqual({ btc: '0', usdt: '1000' });
    expect((await h.accounts.get('founder'))?.status).toBe('active');

    // Once the switch is off, the retry goes out under the next attempt's ID.
    h.ledger.append = append;
    h.kill.on = false;
    h.clock.now += 15 * MINUTE;
    const [resumed] = ran(await runTick(h.deps));
    expect(resumed!.result).toBe('COMPLETED');
    expect((await h.ledger.ofType('ORDER_INTENT', 'founder')).map((e) => e.payload.attempt)).toEqual([1, 2]);
    expect((await h.ledger.ofType('ORDER_RESULT', 'founder')).map((e) => e.payload.status)).toEqual(['NOT_PLACED', 'FILLED']);
  });

  it('lets an order already sent settle when turned on while it is being submitted', async () => {
    const h = await setup();
    h.wrap = (inner) => ({
      getBalances: () => inner.getBalances(),
      getOrder: (id) => inner.getOrder(id),
      placeMarketOrder: async (order) => {
        const state = await inner.placeMarketOrder(order);
        h.kill.on = true;
        return state;
      },
    });
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('COMPLETED');
    expect((await h.ledger.ofType('ORDER_RESULT', 'founder')).map((e) => e.payload.status)).toEqual(['FILLED']);
  });
});

describe('orders whose outcome is uncertain', () => {
  it('reports the day’s fill in the summary when an earlier tick recorded it', async () => {
    const h = await setup();
    // The order fills and its result is recorded, and then reconciliation cannot
    // read the balances, so the run finishes at a later tick than the fill.
    let reads = 0;
    h.wrap = (account) =>
      withBalances(account, async () => {
        reads += 1;
        if (reads === 2) {
          throw new Error('bybit is unreachable');
        }
        return account.getBalances();
      });
    const [interrupted] = ran(await runTick(h.deps));
    expect(interrupted!.result).toBe('RETRY_LATER');
    expect((await h.ledger.ofType('ORDER_RESULT', 'founder')).map((e) => e.payload.status)).toEqual(['FILLED']);

    h.wrap = (account) => account;
    h.clock.now += 15 * MINUTE;
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('COMPLETED');
    expect(h.alerts.messages.at(-1)).toContain('Bought');
  });

  it('settles an order interrupted before midnight after midnight, under its own day', async () => {
    const h = await setup();
    h.clock.now = tickTimeAfter(DAY_ONE) + (23 * 60 + 45) * MINUTE; // 23:47 UTC: still DAY_ONE's run
    h.wrap = failsAfterPlacing;
    const [first] = ran(await runTick(h.deps));
    expect(first!.result).toBe('RETRY_LATER');
    const [intent] = await h.ledger.ofType('ORDER_INTENT', 'founder');
    const id = String(intent!.payload.clientOrderId);
    expect((await h.paper().getOrder(id)).kind).toBe('FOUND');

    h.wrap = (account) => account;
    nextDayTick(h);
    const [second] = ran(await runTick(h.deps));
    expect(second!.result).toBe('COMPLETED');
    expect((await h.runs.get(DAY_ONE, 'founder'))?.status).toBe('abandoned');
    const results = await h.ledger.ofType('ORDER_RESULT', 'founder');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ cycleDate: DAY_ONE, payload: { clientOrderId: id, status: 'FILLED' } });
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(1);
  });

  it('settles a placement that timed out after the order was accepted, without a second order', async () => {
    const h = await setup();
    h.wrap = failsAfterPlacing;
    ran(await runTick(h.deps));
    h.wrap = (account) => account;
    h.clock.now += 15 * MINUTE;
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('COMPLETED');
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(1);
    expect(await h.ledger.ofType('ORDER_RESULT', 'founder')).toHaveLength(1);
  });

  it('retries under a new ID only once the account proves the first order absent', async () => {
    const h = await setup();
    // The order never reaches the account.
    h.wrap = failsBeforePlacing;
    const [first] = ran(await runTick(h.deps));
    expect(first!.result).toBe('RETRY_LATER');

    // Fifteen minutes later the account still cannot see the order, and cannot
    // prove it absent. Time and an empty lookup prove nothing: no result, no new order.
    const hidden = hidesOrders(h.paper(), 1);
    h.wrap = () => hidden;
    h.clock.now += 15 * MINUTE;
    const [unsure] = ran(await runTick(h.deps));
    expect(unsure!.result).toBe('WAITING');
    expect(await h.ledger.ofType('ORDER_RESULT', 'founder')).toHaveLength(0);
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(1);

    // At the next tick the account proves the order absent. The retry gets a new ID and fills.
    h.clock.now += 15 * MINUTE;
    const [later] = ran(await runTick(h.deps));
    expect(later!.result).toBe('COMPLETED');

    const intents = await h.ledger.ofType('ORDER_INTENT', 'founder');
    const results = await h.ledger.ofType('ORDER_RESULT', 'founder');
    const ids = intents.map((e) => String(e.payload.clientOrderId));
    expect(intents.map((e) => e.payload.attempt)).toEqual([1, 2]);
    expect(ids).toEqual([
      clientOrderId('founder', DAY_ONE, 'ENTER_LONG', 1),
      clientOrderId('founder', DAY_ONE, 'ENTER_LONG', 2),
    ]);
    // Each ID has exactly one intent and one result.
    expect(results.map((e) => [e.payload.clientOrderId, e.payload.status])).toEqual([
      [ids[0], 'NOT_PLACED'],
      [ids[1], 'FILLED'],
    ]);
    // Exactly one order ever reached the account.
    expect((await h.paper().getOrder(ids[0]!)).kind).toBe('ABSENT');
    expect((await h.paper().getOrder(ids[1]!)).kind).toBe('FOUND');
  });

  it('places no replacement for an order that becomes visible late', async () => {
    const h = await setup();
    // The order reaches the account, but the placement times out and the
    // account then cannot see the order for two lookups.
    const delayed = hidesOrders(failsAfterPlacing(h.paper()), 2);
    h.wrap = () => delayed;
    ran(await runTick(h.deps));
    for (const minutes of [15, 30]) {
      h.clock.now = tickTimeAfter(DAY_ONE) + minutes * MINUTE;
      const [unsure] = ran(await runTick(h.deps));
      expect(unsure!.result, `after ${minutes} minutes`).toBe('WAITING');
    }
    h.clock.now = tickTimeAfter(DAY_ONE) + 45 * MINUTE;
    const [settled] = ran(await runTick(h.deps));
    expect(settled!.result).toBe('COMPLETED');

    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(1);
    expect((await h.ledger.ofType('ORDER_RESULT', 'founder')).map((e) => e.payload.status)).toEqual(['FILLED']);
    // No replacement order ever reached the account.
    expect((await h.paper().getOrder(clientOrderId('founder', DAY_ONE, 'ENTER_LONG', 2))).kind).toBe('ABSENT');
  });

  it('freezes, for a person to check, an order that stays invisible for an hour', async () => {
    const h = await setup();
    const hidden = hidesOrders(failsAfterPlacing(h.paper()), Number.POSITIVE_INFINITY);
    h.wrap = () => hidden;
    ran(await runTick(h.deps));
    h.clock.now += 61 * MINUTE;
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('FROZEN');
    expect(user!.detail).toContain('check the exchange by hand');
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(1);
  });

  it('records nothing when the lookup itself fails', async () => {
    const h = await setup();
    h.wrap = failsAfterPlacing;
    ran(await runTick(h.deps));
    h.wrap = (account) => lookupFails(account, 1);
    h.clock.now += 15 * MINUTE;
    const [inconclusive] = ran(await runTick(h.deps));
    expect(inconclusive!.result).toBe('RETRY_LATER');
    expect(await h.ledger.ofType('ORDER_RESULT', 'founder')).toHaveLength(0);

    h.wrap = (account) => account;
    h.clock.now += 15 * MINUTE;
    const [settled] = ran(await runTick(h.deps));
    expect(settled!.result).toBe('COMPLETED');
    expect(await h.ledger.ofType('ORDER_RESULT', 'founder')).toHaveLength(1);
  });

  it('waits for a pending order, then completes when it settles', async () => {
    const h = await setup();
    const slow = new SlowAccount(h.paper());
    h.wrap = () => slow;
    const [first] = ran(await runTick(h.deps));
    expect(first!.result).toBe('WAITING');
    expect(await h.runs.get(DAY_ONE, 'founder')).toMatchObject({ status: 'pending' });
    expect(h.heartbeat.pings).toBe(0);

    slow.release();
    h.clock.now += 15 * MINUTE;
    const [second] = ran(await runTick(h.deps));
    expect(second!.result).toBe('COMPLETED');
    expect(await h.ledger.ofType('ORDER_RESULT', 'founder')).toHaveLength(1);
  });

  it('freezes an order still pending after an hour', async () => {
    const h = await setup();
    const slow = new SlowAccount(h.paper());
    h.wrap = () => slow;
    ran(await runTick(h.deps));
    h.clock.now += 61 * MINUTE;
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('FROZEN');
    expect(user!.detail).toContain('pending for over an hour');
  });

  it('freezes rather than make a fourth attempt in one day', async () => {
    const h = await setup();
    h.wrap = failsBeforePlacing;
    for (let tick = 0; tick < 3; tick++) {
      const [user] = ran(await runTick(h.deps));
      expect(user!.result).toBe('RETRY_LATER');
      h.clock.now += 15 * MINUTE;
    }
    const [fourth] = ran(await runTick(h.deps));
    expect(fourth!.result).toBe('FROZEN');
    expect(fourth!.detail).toContain('failed to reach');
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(3);
  });
});

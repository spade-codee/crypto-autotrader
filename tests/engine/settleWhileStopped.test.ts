import { describe, expect, it } from 'vitest';
import { recordOrderOutcome } from '../../src/app/recordOrderOutcome.js';
import { runTick } from '../../src/engine/cycle.js';
import type { OrderLookup } from '../../src/exchange/trading.js';
import { lastDay, trendingCandles } from '../helpers/candles.js';
import { useTestDatabase } from '../helpers/database.js';
import {
  failsAfterPlacing,
  harness,
  hidesOrders,
  openFounder,
  ran,
  setMarket,
  SlowAccount,
  tickTimeAfter,
  type Harness,
} from '../helpers/engine.js';
import { RULES } from '../helpers/market.js';

const database = useTestDatabase();
const UP = trendingCandles('2026-01-01', 300, 'up');
const DAY_ONE = lastDay(UP);
const MINUTE = 60_000;

async function setup(): Promise<Harness> {
  const h = harness(database());
  setMarket(h, UP);
  h.clock.now = tickTimeAfter(DAY_ONE);
  await openFounder(database());
  return h;
}

/** Places the day's order, leaves it unsettled, then stops the account. */
async function orderInFlight(h: Harness, stop: (at: Date) => Promise<void>): Promise<void> {
  h.wrap = failsAfterPlacing;
  ran(await runTick(h.deps));
  expect(await h.ledger.ofType('ORDER_RESULT', 'founder')).toHaveLength(0);
  h.wrap = (account) => account;
  await stop(new Date(h.clock.now));
}

const results = async (h: Harness) => (await h.ledger.ofType('ORDER_RESULT', 'founder')).map((e) => e.payload.status);

describe('an order already sent, on an account that is not trading', () => {
  it('settles while the account is paused, records it, and places nothing', async () => {
    const h = await setup();
    await orderInFlight(h, (at) => h.accounts.pause('founder', 'travelling', at));
    h.clock.now += 15 * MINUTE;

    expect(await runTick(h.deps)).toEqual({ kind: 'NOTHING_TO_DO' });
    expect(await results(h)).toEqual(['FILLED']);
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(1);
    expect((await h.accounts.get('founder'))?.status).toBe('paused');
    expect(h.alerts.messages.some((m) => m.includes('paused') && m.includes('has now settled'))).toBe(true);
  });

  it('settles while the account is frozen, and leaves the freeze and its reason alone', async () => {
    const h = await setup();
    await orderInFlight(h, (at) => h.accounts.freeze('founder', DAY_ONE, 'a partial fill', at));
    h.clock.now += 15 * MINUTE;

    await runTick(h.deps);
    expect(await results(h)).toEqual(['FILLED']);
    expect(await h.accounts.get('founder')).toMatchObject({ status: 'frozen', reason: 'a partial fill' });
  });

  it('freezes a paused account whose order comes back unfilled, and keeps the pause', async () => {
    const h = await setup();
    await orderInFlight(h, (at) => h.accounts.pause('founder', 'travelling', at));
    // The account reports the order as only partly filled.
    h.wrap = (account) => ({
      getBalances: () => account.getBalances(),
      placeMarketOrder: (order) => account.placeMarketOrder(order),
      getOrder: async (id): Promise<OrderLookup> => {
        const lookup = await account.getOrder(id);
        return lookup.kind === 'FOUND'
          ? { kind: 'FOUND', state: { ...lookup.state, status: 'PARTIALLY_FILLED_CANCELLED' } }
          : lookup;
      },
    });
    h.clock.now += 15 * MINUTE;

    await runTick(h.deps);
    expect(await results(h)).toEqual(['PARTIALLY_FILLED_CANCELLED']);
    expect(await h.accounts.get('founder')).toMatchObject({ status: 'frozen', paused: true });
    await h.accounts.unfreeze('founder', 'checked on Bybit', new Date(h.clock.now));
    expect((await h.accounts.get('founder'))?.status).toBe('paused');
  });

  it('freezes a paused account whose order stays invisible for an hour', async () => {
    const h = await setup();
    h.wrap = (account) => hidesOrders(failsAfterPlacing(account), Number.POSITIVE_INFINITY);
    ran(await runTick(h.deps));
    await h.accounts.pause('founder', 'travelling', new Date(h.clock.now));

    h.clock.now += 61 * MINUTE;
    await runTick(h.deps);
    expect(await h.accounts.get('founder')).toMatchObject({ status: 'frozen', paused: true });
    expect(await results(h)).toEqual([]);
  });

  it('waits, recording nothing, while a paused account’s order is still pending', async () => {
    const h = await setup();
    const slow = new SlowAccount(h.paper());
    h.wrap = () => slow;
    ran(await runTick(h.deps));
    await h.accounts.pause('founder', 'travelling', new Date(h.clock.now));

    h.clock.now += 15 * MINUTE;
    await runTick(h.deps);
    expect(await results(h)).toEqual([]);
    expect((await h.accounts.get('founder'))?.status).toBe('paused');
  });

  it('costs no exchange call when a stopped account has nothing outstanding', async () => {
    const h = await setup();
    await h.accounts.pause('founder', 'travelling', new Date(h.clock.now));
    const before = h.market.calls.rules;

    expect(await runTick(h.deps)).toEqual({ kind: 'NOTHING_TO_DO' });
    expect(h.market.calls.rules).toBe(before);
  });

  it('completes the day when the account is resumed after its fill was recorded', async () => {
    const h = await setup();
    await orderInFlight(h, (at) => h.accounts.pause('founder', 'travelling', at));
    h.clock.now += 15 * MINUTE;
    await runTick(h.deps);

    await h.accounts.resume('founder', new Date(h.clock.now));
    h.clock.now += 15 * MINUTE;
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('COMPLETED');
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(1);
    expect(h.alerts.messages.at(-1)).toContain('Bought');
  });
});

describe('the kill switch', () => {
  it('settles orders already sent, while placing nothing and reporting itself', async () => {
    const h = await setup();
    await orderInFlight(h, async () => {
      h.kill.on = true;
    });
    h.clock.now += 15 * MINUTE;

    expect(await runTick(h.deps)).toEqual({ kind: 'KILL_SWITCH' });
    expect(await results(h)).toEqual(['FILLED']);
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(1);
    expect(await h.ledger.ofType('KILL_SWITCH_SKIP', null)).toHaveLength(1);
    expect(h.alerts.messages.filter((m) => m.startsWith('The kill switch is on'))).toHaveLength(1);
    expect(h.alerts.messages.some((m) => m.includes('stopped by the kill switch'))).toBe(true);
  });

  it('freezes an account whose order has been invisible for an hour, even while it is on', async () => {
    const h = await setup();
    h.wrap = (account) => hidesOrders(failsAfterPlacing(account), Number.POSITIVE_INFINITY);
    ran(await runTick(h.deps));
    h.kill.on = true;

    h.clock.now += 61 * MINUTE;
    expect(await runTick(h.deps)).toEqual({ kind: 'KILL_SWITCH' });
    expect((await h.accounts.get('founder'))?.status).toBe('frozen');
  });
});

describe('an order the exchange cannot show', () => {
  it('freezes again after an unfreeze, because time never proves an order was not placed', async () => {
    const h = await setup();
    h.wrap = (account) => hidesOrders(failsAfterPlacing(account), Number.POSITIVE_INFINITY);
    ran(await runTick(h.deps));
    h.clock.now += 61 * MINUTE;
    expect(ran(await runTick(h.deps))[0]!.result).toBe('FROZEN');

    await h.accounts.unfreeze('founder', 'looking into it', new Date(h.clock.now));
    h.clock.now += 15 * MINUTE;
    expect(ran(await runTick(h.deps))[0]!.result).toBe('FROZEN');
    expect(await results(h)).toEqual([]);
  });

  it('is cleared by recording what the founder found, and the day then completes', async () => {
    const h = await setup();
    h.wrap = (account) => hidesOrders(failsAfterPlacing(account), Number.POSITIVE_INFINITY);
    ran(await runTick(h.deps));
    h.clock.now += 61 * MINUTE;
    ran(await runTick(h.deps));

    const [intent] = await h.ledger.ofType('ORDER_INTENT', 'founder');
    const recorded = await recordOrderOutcome(
      {
        ledger: h.ledger,
        account: h.deps.accountFor('founder'),
        rules: RULES,
        now: () => new Date(h.clock.now),
      },
      {
        userId: 'founder',
        clientOrderId: String(intent!.payload.clientOrderId),
        outcome: { status: 'NOT_PLACED' },
        evidence: 'Bybit order history shows nothing for that day',
      },
    );
    expect(recorded.status).toBe('recorded');

    // The order the founder checked was in fact placed, so the account is
    // already long: the run reconciles rather than buying again.
    await h.accounts.unfreeze('founder', 'recorded what Bybit showed', new Date(h.clock.now));
    h.wrap = (account) => account;
    h.clock.now += 15 * MINUTE;
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('COMPLETED');
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(1);
  });
});

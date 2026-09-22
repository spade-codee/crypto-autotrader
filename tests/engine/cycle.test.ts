import { describe, expect, it } from 'vitest';
import { runTick } from '../../src/engine/cycle.js';
import { dailyCandles, lastDay, nextDay, trendingCandles } from '../helpers/candles.js';
import { useTestDatabase } from '../helpers/database.js';
import { harness, openFounder, ran, setMarket, tickTimeAfter, type Harness } from '../helpers/engine.js';

const database = useTestDatabase();
const UP = trendingCandles('2026-01-01', 300, 'up');
const DOWN = trendingCandles('2026-01-01', 300, 'down');
const MINUTE = 60_000;

async function setup(candles = UP, usdt = '1000'): Promise<Harness> {
  const h = harness(database());
  setMarket(h, candles);
  h.clock.now = tickTimeAfter(lastDay(candles));
  await openFounder(database(), usdt);
  return h;
}

async function coins(h: Harness) {
  const balances = await h.paper().getBalances();
  const of = (coin: string) => balances.find((b) => b.coin === coin)!.walletBalance;
  return { btc: of('BTC'), usdt: of('USDT') };
}

describe('a normal day', () => {
  it('buys on a LONG signal and completes the day', async () => {
    const h = await setup(UP);
    const [user] = ran(await runTick(h.deps));
    expect(user).toMatchObject({ userId: 'founder', result: 'COMPLETED' });
    const { btc, usdt } = await coins(h);
    expect(btc.gt(0)).toBe(true);
    expect(usdt.lt(5)).toBe(true);
    expect(await h.runs.get(lastDay(UP), 'founder')).toMatchObject({ status: 'completed', late: false, attempts: 1 });
    expect((await h.ledger.forUser('founder')).map((e) => e.type)).toEqual([
      'ACCOUNT_OPENED',
      'ORDER_INTENT',
      'ORDER_RESULT',
      'RECONCILED',
      'RUN_COMPLETED',
    ]);
    expect(h.alerts.messages.at(-1)).toMatch(/LONG\. Bought [\d.]+ BTC/);
    expect(h.heartbeat.pings).toBe(1);
  });

  it('records the signal once, with its close', async () => {
    const h = await setup(UP);
    await runTick(h.deps);
    const signals = await h.ledger.ofType('SIGNAL', null);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.payload).toMatchObject({ target: 'LONG', close: '79900', maPeriod: 125 });
  });

  it('does nothing, and touches no network, on later ticks the same day', async () => {
    const h = await setup(UP);
    await runTick(h.deps);
    const calls = { ...h.market.calls };
    h.clock.now += 15 * MINUTE;
    expect(await runTick(h.deps)).toEqual({ kind: 'NOTHING_TO_DO' });
    expect(h.market.calls).toEqual(calls);
    expect(h.heartbeat.pings).toBe(1);
  });

  it('holds its position the next day without trading', async () => {
    const h = await setup(UP);
    await runTick(h.deps);
    const next = trendingCandles('2026-01-01', 301, 'up');
    setMarket(h, next);
    h.clock.now = tickTimeAfter(lastDay(next));
    const [user] = ran(await runTick(h.deps));
    expect(user).toMatchObject({ result: 'COMPLETED', detail: 'no change' });
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(1);
    expect(h.alerts.messages.at(-1)).toMatch(/LONG, no change/);
  });

  it('sells everything when the trend turns', async () => {
    const h = await setup(UP);
    await runTick(h.deps);
    const turned = [...UP, ...dailyCandles(nextDay(lastDay(UP)), [40_000])];
    setMarket(h, turned);
    h.clock.now = tickTimeAfter(lastDay(turned));
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('COMPLETED');
    const { btc, usdt } = await coins(h);
    expect(btc.lt('0.000001')).toBe(true);
    expect(usdt.gt(400)).toBe(true);
    expect(h.alerts.messages.at(-1)).toMatch(/FLAT\. Sold/);
  });

  it('stays in cash on a FLAT signal with nothing to sell', async () => {
    const h = await setup(DOWN);
    const [user] = ran(await runTick(h.deps));
    expect(user).toMatchObject({ result: 'COMPLETED', detail: 'no change' });
    expect(await h.ledger.ofType('ORDER_INTENT', 'founder')).toHaveLength(0);
  });

  it('completes, with one notice, when the account is too small to trade', async () => {
    const h = await setup(UP, '3');
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('TOO_SMALL');
    expect(await h.runs.get(lastDay(UP), 'founder')).toMatchObject({ status: 'completed' });
    h.clock.now += 15 * MINUTE;
    await runTick(h.deps);
    expect(h.alerts.messages.filter((m) => m.includes('Nothing traded'))).toHaveLength(1);
  });

  it('alerts once a day when there are no accounts, and sends no heartbeat', async () => {
    const h = harness(database());
    setMarket(h, UP);
    h.clock.now = tickTimeAfter(lastDay(UP));
    expect(await runTick(h.deps)).toEqual({ kind: 'NOTHING_TO_DO' });
    expect(await runTick(h.deps)).toEqual({ kind: 'NOTHING_TO_DO' });
    expect(h.alerts.messages.filter((m) => m.includes('no accounts'))).toHaveLength(1);
    expect(h.heartbeat.pings).toBe(0);
  });
});

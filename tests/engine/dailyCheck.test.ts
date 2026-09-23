import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { runTick } from '../../src/engine/cycle.js';
import type { OrderBook } from '../../src/market/orderBook.js';
import type { Candle } from '../../src/types.js';
import { lastDay, trendingCandles } from '../helpers/candles.js';
import { useTestDatabase } from '../helpers/database.js';
import { harness, openFounder, ran, setMarket, tickTimeAfter, type Harness } from '../helpers/engine.js';

const database = useTestDatabase();
const UP = trendingCandles('2026-01-01', 300, 'up');
const NEXT = trendingCandles('2026-01-01', 301, 'up');
const DAY_ONE = lastDay(UP);

/** Day one: the account opens and buys, on the given order book. */
async function dayOne(book?: OrderBook): Promise<Harness> {
  const h = harness(database());
  setMarket(h, UP);
  if (book !== undefined) {
    h.market.book = book;
  }
  h.clock.now = tickTimeAfter(DAY_ONE);
  await openFounder(database());
  ran(await runTick(h.deps));
  return h;
}

/** Moves to day two's first tick, serving `candles`. */
function dayTwo(h: Harness, candles: Candle[] = NEXT): void {
  setMarket(h, candles);
  h.clock.now = tickTimeAfter(lastDay(candles));
}

/** Day two's candles with day one's close replaced — as if Bybit revised it after the engine traded. */
function revisedDayOne(close: string): Candle[] {
  const price = new Decimal(close);
  return NEXT.map((c, i) =>
    i === NEXT.length - 2 ? { ...c, close: price, high: Decimal.max(c.high, price), low: Decimal.min(c.low, price) } : c,
  );
}

const selfCheckAlerts = (h: Harness) => h.alerts.messages.filter((m) => m.startsWith('Self-check:'));

describe('the decision, replayed the next morning', () => {
  it('says yesterday’s decision still holds, in the summary and the ledger', async () => {
    const h = await dayOne();
    dayTwo(h);
    const [user] = ran(await runTick(h.deps));
    expect(user!.result).toBe('COMPLETED');
    const [replay] = await h.ledger.ofType('DECISION_REPLAY', null);
    expect(replay).toMatchObject({
      cycleDate: DAY_ONE,
      payload: { verdict: 'HOLDS', recordedTarget: 'LONG', replayedTarget: 'LONG' },
    });
    expect(h.alerts.messages.at(-1)).toContain(`Checked ${DAY_ONE}: the decision still holds.`);
    expect(selfCheckAlerts(h)).toHaveLength(0);
  });

  it('notices a revised close that keeps the decision, without an alert', async () => {
    const h = await dayOne();
    dayTwo(h, revisedDayOne('79901'));
    ran(await runTick(h.deps));
    expect((await h.ledger.ofType('DECISION_REPLAY', null))[0]?.payload.verdict).toBe('DATA_REVISED');
    expect(h.alerts.messages.at(-1)).toContain(
      `Checked ${DAY_ONE}: Bybit revised that day's data, and the decision still holds.`,
    );
    expect(selfCheckAlerts(h)).toHaveLength(0);
  });

  it('alerts once when the decision would now differ, and freezes nothing', async () => {
    const h = await dayOne();
    dayTwo(h, revisedDayOne('1000'));
    const [user] = ran(await runTick(h.deps));
    expect((await h.ledger.ofType('DECISION_REPLAY', null))[0]?.payload.verdict).toBe('DECISION_CHANGED');
    expect(selfCheckAlerts(h)).toEqual([
      `Self-check: the ${DAY_ONE} decision would now be FLAT, not LONG. Bybit's data for that day has changed since the engine traded on it. Nothing was frozen: today's run already trades on the current data. If this happens again, the price data needs a closer look.`,
    ]);
    // Today's own decision, on the current data, is still LONG: the run completes.
    expect(user!.result).toBe('COMPLETED');
    expect((await h.accounts.get('founder'))?.status).toBe('active');
  });

  it('has nothing to replay on the first day', async () => {
    const h = await dayOne();
    expect(await h.ledger.ofType('DECISION_REPLAY', null)).toHaveLength(0);
    expect(h.alerts.messages.at(-1)).not.toContain('Checked');
  });
});

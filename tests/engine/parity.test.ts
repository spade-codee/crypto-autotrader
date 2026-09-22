import { readFileSync } from 'node:fs';
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { runBacktest } from '../../src/backtest/engine.js';
import { parseCandleCsv } from '../../src/data/csv.js';
import { runTick } from '../../src/engine/cycle.js';
import { isoDate } from '../../src/engine/cycleDate.js';
import { CHOSEN_MA_PERIOD, trendFilter } from '../../src/strategy/trendFilter.js';
import { DAY } from '../helpers/candles.js';
import { useTestDatabase } from '../helpers/database.js';
import { FEE_RATE, harness, openFounder } from '../helpers/engine.js';
import { bookAround, tickerAt } from '../helpers/market.js';

/** Real Bybit BTCUSDT spot daily candles, 2023-01-01 to 2024-12-31. */
const CANDLES = parseCandleCsv(
  readFileSync(new URL('../fixtures/btcusdt-spot-1d-2023-2024.csv', import.meta.url), 'utf8'),
);
const database = useTestDatabase();

describe('parity with the backtest', () => {
  it('makes the same daily decisions and trades as the backtest, on two years of real candles', async () => {
    const h = harness(database());
    await openFounder(database(), '1000', new Date(CANDLES[0]!.time));
    h.market.candles = CANDLES;
    // The first candle with a full moving-average window behind it.
    const first = CHOSEN_MA_PERIOD - 1;

    // The live engine: one tick after each close, filling at the next candle's open.
    for (let i = first; i < CANDLES.length - 1; i++) {
      const next = CANDLES[i + 1]!;
      h.market.book = bookAround(next.open, '1000');
      h.market.ticker = tickerAt(next.open);
      h.clock.now = CANDLES[i]!.time + DAY + 2 * 60_000;
      const outcome = await runTick(h.deps);
      if (outcome.kind !== 'RAN' || outcome.users[0]!.result !== 'COMPLETED') {
        throw new Error(`the tick for ${isoDate(CANDLES[i]!.time)} did not complete: ${JSON.stringify(outcome)}`);
      }
    }

    // The backtest over the same candles: the same fee, and slippage equal to the synthetic spread.
    const backtest = runBacktest(
      CANDLES,
      trendFilter({ maPeriod: CHOSEN_MA_PERIOD }),
      { feeRate: FEE_RATE, slippageRate: new Decimal('0.0001') },
      new Decimal(1000),
      'parity',
      { evaluateFrom: CANDLES[first + 1]!.time },
    );

    // 1. Every daily target is the backtest's decision for that day: the state it
    //    holds from the next candle's open.
    const decidedOn = new Map(backtest.equityCurve.map((point) => [isoDate(point.time - DAY), point.state]));
    const signals = await h.ledger.ofType('SIGNAL', null);
    expect(signals).toHaveLength(CANDLES.length - 1 - first);
    for (const signal of signals) {
      expect(signal.payload.target, `the signal for ${signal.cycleDate}`).toBe(decidedOn.get(signal.cycleDate!));
    }

    // 2. Every trade happens on the same day, in the same direction.
    const engineTrades = (await h.ledger.ofType('ORDER_RESULT', 'founder')).map((e) => [
      e.cycleDate,
      e.payload.side,
      e.payload.status,
    ]);
    const backtestTrades = backtest.trades.map((t) => [isoDate(t.time - DAY), t.side, 'FILLED']);
    expect(engineTrades).toEqual(backtestTrades);
    expect(engineTrades.length).toBeGreaterThan(4);

    // 3. Final equity agrees within 1%. The small gap is the engine's 0.1% buy
    //    headroom and its rounding to Bybit's quantity step.
    const last = CANDLES[CANDLES.length - 1]!;
    const balances = await h.paper().getBalances();
    const coin = (name: string) => balances.find((b) => b.coin === name)!.walletBalance;
    const engineEquity = coin('USDT').plus(coin('BTC').times(last.close));
    const backtestEquity = backtest.equityCurve[backtest.equityCurve.length - 1]!.equity;
    expect(engineEquity.minus(backtestEquity).abs().div(backtestEquity).toNumber()).toBeLessThan(0.01);
  }, 300_000);
});

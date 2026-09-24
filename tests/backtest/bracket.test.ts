import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { BTCUSDT_RULES, netR, RESEARCH_RISK, runBracketBacktest, simulateExit } from '../../src/backtest/bracket.js';
import { DEFAULT_COSTS } from '../../src/backtest/costs.js';
import { QUARTER_HOUR_MS } from '../../src/strategy/bars.js';
import { VERSION_0 } from '../../src/strategy/liquiditySweep.js';
import type { Candle } from '../../src/types.js';
import { candle, day4, DAY4, enteringScenario, START } from '../helpers/liquidity.js';

const c = (i: number, open: number, high: number, low: number, close: number) =>
  candle(i * QUARTER_HOUR_MS, open, high, low, close);
const STOP = new Decimal(99);
const TARGET = new Decimal(104);

describe('simulateExit', () => {
  it('sells at the stop less slippage when a candle reaches it', () => {
    const exit = simulateExit([c(0, 100, 101, 99.5, 100.5), c(1, 100.5, 101, 98, 99)], 0, STOP, TARGET, 32, DEFAULT_COSTS);
    expect(exit).toMatchObject({ index: 1, reason: 'STOP', ambiguous: false });
    expect([exit.rawPrice, exit.price].map(String)).toEqual(['99', '98.9505']);
  });

  it('sells at the target less slippage', () => {
    const exit = simulateExit([c(0, 100, 101, 99.5, 100.5), c(1, 100.5, 104.5, 100, 104)], 0, STOP, TARGET, 32, DEFAULT_COSTS);
    expect(exit).toMatchObject({ index: 1, reason: 'TARGET' });
    expect(exit.price.toString()).toBe('103.948');
  });

  it('assumes the stop came first when one candle reaches both', () => {
    expect(simulateExit([c(0, 100, 105, 98, 101)], 0, STOP, TARGET, 32, DEFAULT_COSTS)).toMatchObject({
      index: 0,
      reason: 'STOP',
      ambiguous: true,
    });
  });

  it('sells at the open when a candle opens below the stop', () => {
    const exit = simulateExit([c(0, 100, 101, 99.5, 100.5), c(1, 97, 98, 96, 97.5)], 0, STOP, TARGET, 32, DEFAULT_COSTS);
    expect(exit.price.toString()).toBe('96.9515');
  });

  it('sells at the open after the time limit', () => {
    const flat = Array.from({ length: 5 }, (_, i) => c(i, 100, 100.5, 99.5, 100));
    const exit = simulateExit(flat, 0, STOP, TARGET, 3, DEFAULT_COSTS);
    expect(exit).toMatchObject({ index: 3, reason: 'TIME' });
    expect(exit.price.toString()).toBe('99.95');
  });

  it('after a missing candle, takes the worse of the next open and the stop', () => {
    const exit = simulateExit([c(0, 100, 101, 99.5, 100.5), c(3, 100, 100.5, 98.5, 99)], 0, STOP, TARGET, 32, DEFAULT_COSTS);
    expect(exit).toMatchObject({ index: 1, reason: 'GAP' });
    expect(exit.price.toString()).toBe('98.9505');
  });

  it('closes at the last close when the candles end first', () => {
    const exit = simulateExit([c(0, 100, 101, 99.5, 100.5), c(1, 100.5, 101, 100, 100.8)], 0, STOP, TARGET, 32, DEFAULT_COSTS);
    expect(exit).toMatchObject({ index: 1, reason: 'END' });
  });
});

describe('netR', () => {
  it('is the profit per BTC after both fees, over the planned risk', () => {
    expect(netR(new Decimal(100), new Decimal(102), new Decimal('0.001'), new Decimal(1)).toString()).toBe('1.798');
  });
});

describe('runBracketBacktest', () => {
  const entry = candle(day4(6), 114_500, 115_000, 113_000, 113_500);
  const stopped = candle(day4(7), 113_500, 113_600, 103_000, 104_500);
  const run = (candles: Candle[], capital = 10_000, evaluateFrom = START) =>
    runBracketBacktest(candles, {
      config: VERSION_0,
      costs: DEFAULT_COSTS,
      capital: new Decimal(capital),
      riskFraction: RESEARCH_RISK,
      rules: BTCUSDT_RULES,
      evaluateFrom,
    });

  it('enters at the next open, sizes to 0.25% risk, and measures the stop-out in planned risk', () => {
    const result = run([...enteringScenario(), entry, stopped]);
    expect(result.trades).toHaveLength(1);
    const [trade] = result.trades;
    expect(trade).toMatchObject({ entryTime: day4(6), exitTime: day4(7) });
    expect(trade!.exit.reason).toBe('STOP');
    expect(trade!.entryPrice.toString()).toBe('114557.25');
    expect(trade!.quantity.toString()).toBe('0.002308');
    expect(trade!.r.toFixed(4)).toBe('-1.0312');
    expect(trade!.grossR.toString()).toBe('-1');
    expect(trade!.pnl.toFixed(2)).toBe('-24.99');
  });

  it('sizes from the confirmation close alone, so an opening gap buys a little less and loses more than 1R', () => {
    // The entry candle opens 500 above the 114,500 confirmation close. The USDT amount is still
    // 264.4966, set at the close, so it buys 264.4966 / 115,057.5 = 0.002298 BTC.
    const gapUp = candle(day4(6), 115_000, 115_200, 113_000, 113_500);
    const [trade] = run([...enteringScenario(), gapUp, stopped]).trades;
    expect(trade!.entryPrice.toString()).toBe('115057.5');
    expect(trade!.quantity.toString()).toBe('0.002298');
    expect(trade!.plannedRisk.toString()).toBe('10500.1');
    expect(trade!.grossR.toFixed(4)).toBe('-1.0476');
  });

  it('starts no trade before the evaluation begins', () => {
    const result = run([...enteringScenario(), entry, stopped], 10_000, DAY4 + 2 * 86_400_000);
    expect(result.trades).toEqual([]);
    expect(result.events).toEqual([]);
  });

  it('voids the entry when the candle after the confirmation is missing', () => {
    const result = run([...enteringScenario(), stopped]);
    expect(result.trades).toEqual([]);
    expect(result.skips).toEqual([{ time: day4(5), reason: 'MISSED_ENTRY' }]);
  });

  it('skips a buy under the exchange minimum', () => {
    expect(run([...enteringScenario(), entry, stopped], 100).skips).toEqual([{ time: day4(5), reason: 'TOO_SMALL' }]);
  });

  it('skips an entry that opens at or below its stop', () => {
    const collapse = candle(day4(6), 103_000, 103_500, 102_000, 103_000);
    expect(run([...enteringScenario(), collapse]).skips).toEqual([{ time: day4(5), reason: 'OPEN_AT_OR_BELOW_STOP' }]);
  });

  it('records placebo entries only after a close with the structure up and a level', () => {
    const candles = [...enteringScenario(), entry, stopped];
    const result = run(candles);
    expect(result.placeboEntries.length).toBeGreaterThan(0);
    for (const index of result.placeboEntries) {
      expect(candles[index]!.time).toBeGreaterThan(START + 86_400_000);
    }
    expect(result.placeboEntries).toContain(candles.findIndex((x) => x.time === day4(6)));
  });

  it('marks equity at every evaluated close, holding while the trade is open', () => {
    const candles = [...enteringScenario(), entry, stopped];
    const result = run(candles);
    expect(result.equity).toHaveLength(candles.length);
    expect(result.equity.find((mark) => mark.time === day4(6))!.holding).toBe(true);
    expect(result.equity.find((mark) => mark.time === day4(7))!.holding).toBe(false);
    expect(result.equity[result.equity.length - 1]!.equity.toFixed(2)).toBe('9975.01');
  });
});

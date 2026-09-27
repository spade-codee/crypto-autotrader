import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { runBacktest } from '../../src/backtest/engine.js';
import {
  BREAKOUT_V0,
  channelBreakout,
  type ChannelBreakoutConfig,
} from '../../src/strategy/channelBreakout.js';
import type { TargetState } from '../../src/types.js';
import { dailyCandles } from '../helpers/candles.js';

/** Short windows, so a scenario fits on a line: enter above the 3 closes before, exit below the 2 before. */
const SMALL: ChannelBreakoutConfig = { entryDays: 3, exitDays: 2 };

function positionAfter(closes: number[], config: ChannelBreakoutConfig = SMALL): TargetState {
  return channelBreakout(config)(dailyCandles('2024-01-01', closes));
}

describe('channelBreakout', () => {
  it('holds USDT before any signal, including when there is too little history for one', () => {
    expect(positionAfter([])).toBe('FLAT');
    expect(positionAfter([1, 2, 3])).toBe('FLAT');
  });

  it('enters on a close above every close of the entry window before it', () => {
    expect(positionAfter([5, 4, 3, 6])).toBe('LONG');
  });

  it('never counts the signal day in its own window', () => {
    // Were the day part of its own window, no close could ever be above it.
    expect(positionAfter([1, 2, 3, 4])).toBe('LONG');
  });

  it('does not enter on a close equal to the channel high', () => {
    expect(positionAfter([5, 4, 3, 5])).toBe('FLAT');
  });

  it('keeps the position on a day with no signal', () => {
    expect(positionAfter([5, 4, 3, 6, 5.5])).toBe('LONG');
  });

  it('exits on a close below every close of the exit window before it', () => {
    expect(positionAfter([5, 4, 3, 6, 5, 4])).toBe('FLAT');
  });

  it('does not exit on a close equal to the channel low', () => {
    expect(positionAfter([5, 4, 3, 6, 5, 5])).toBe('LONG');
  });

  it('stays in USDT after an exit until the next entry', () => {
    const afterExit = [5, 4, 3, 6, 5, 4, 4.5, 4.8];
    expect(positionAfter(afterExit)).toBe('FLAT');
    expect(positionAfter([...afterExit, 5.1])).toBe('LONG');
  });

  it('needs a full exit window of earlier closes before it can exit', () => {
    const config = { entryDays: 2, exitDays: 4 };
    // Entered at 3. At 0.5 only three earlier closes exist, so there is no exit yet.
    expect(positionAfter([1, 2, 3, 0.5], config)).toBe('LONG');
    // At 0.4 all four exist, and it is below every one.
    expect(positionAfter([1, 2, 3, 0.5, 0.4], config)).toBe('FLAT');
  });

  it('follows the most recent signal however far back it lies', () => {
    // Entered at 4. Equal closes are never beyond either channel.
    const flatAfterwards = Array.from({ length: 50 }, () => 4);
    expect(positionAfter([1, 2, 3, 4, ...flatAfterwards])).toBe('LONG');
  });

  it('rejects windows that are not positive integers', () => {
    expect(() => channelBreakout({ entryDays: 0, exitDays: 20 })).toThrow('entryDays must be a positive integer');
    expect(() => channelBreakout({ entryDays: -55, exitDays: 20 })).toThrow('entryDays must be a positive integer');
    expect(() => channelBreakout({ entryDays: 55, exitDays: 2.5 })).toThrow('exitDays must be a positive integer');
  });

  it('agrees, close by close, with a position carried forward through a long series', () => {
    // An independent reference in plain numbers: walk forward, change on each
    // signal, and compare with the strategy's look-back at every close.
    const closes = Array.from(
      { length: 600 },
      (_, i) => Math.round((50_000 + 3_000 * Math.sin(i / 17) + 1_500 * Math.sin(i / 5.3) + 7 * i) * 100) / 100,
    );
    const config = { entryDays: 10, exitDays: 4 };
    const strategy = channelBreakout(config);
    const candles = dailyCandles('2020-01-01', closes);
    let position: TargetState = 'FLAT';
    let changes = 0;
    for (let i = 0; i < closes.length; i++) {
      const enter = i >= 10 && closes[i]! > Math.max(...closes.slice(i - 10, i));
      const exit = i >= 4 && closes[i]! < Math.min(...closes.slice(i - 4, i));
      const next: TargetState = enter ? 'LONG' : exit ? 'FLAT' : position;
      changes += next === position ? 0 : 1;
      position = next;
      expect(strategy(candles.slice(0, i + 1)), `close ${i}`).toBe(position);
    }
    expect(changes).toBeGreaterThan(20);
  });

  it('runs in the existing engine: a warm-up entry is bought at the first evaluated open, and an exit sells at the next open', () => {
    const candles = dailyCandles('2024-01-01', [5, 4, 3, 6, 6, 6, 5, 4, 4]);
    const free = { feeRate: new Decimal(0), slippageRate: new Decimal(0) };
    const result = runBacktest(candles, channelBreakout(SMALL), free, new Decimal(1000), 'channel', {
      evaluateFrom: candles[5]!.time,
    });
    expect(result.trades.map((t) => [t.side, t.time])).toEqual([
      ['BUY', candles[5]!.time],
      ['SELL', candles[7]!.time],
    ]);
  });

  it('holds version 0 to the pre-registered 55 and 20', () => {
    expect(BREAKOUT_V0).toEqual({ entryDays: 55, exitDays: 20 });
  });
});

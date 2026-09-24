import type { Candle } from '../types.js';

export const QUARTER_HOUR_MS = 900_000;
export const FOUR_HOURS_MS = 14_400_000;
export const DAY_MS = 86_400_000;

/** The start of the UTC block a moment falls in: 4-hour blocks start at 00:00, 04:00 and so on; days at 00:00. */
export function blockStart(time: number, blockMs: number): number {
  return time - (time % blockMs);
}

/** One candle from consecutive ones: the first open, the highest high, the lowest low, the last close, and their total volume. */
export function combine(candles: Candle[]): Candle {
  const first = candles[0];
  if (first === undefined) {
    throw new Error('combine needs at least one candle');
  }
  let { high, low, volume } = first;
  for (const candle of candles.slice(1)) {
    if (candle.high.gt(high)) {
      high = candle.high;
    }
    if (candle.low.lt(low)) {
      low = candle.low;
    }
    volume = volume.plus(candle.volume);
  }
  return { time: first.time, open: first.open, high, low, close: candles[candles.length - 1]!.close, volume };
}

/**
 * Builds 4-hour or daily candles from 15-minute ones (R1), on UTC boundaries. A
 * block is kept only when every one of its 15-minute candles is present, so a
 * missing candle can never make a longer candle with a false high or low.
 */
export function aggregate(candles: Candle[], blockMs: number): Candle[] {
  const perBlock = blockMs / QUARTER_HOUR_MS;
  const blocks: Candle[] = [];
  let current: Candle[] = [];
  const flush = () => {
    const first = current[0];
    if (first !== undefined && current.length === perBlock && first.time === blockStart(first.time, blockMs)) {
      blocks.push(combine(current));
    }
    current = [];
  };
  for (const candle of candles) {
    const first = current[0];
    if (first !== undefined && blockStart(first.time, blockMs) !== blockStart(candle.time, blockMs)) {
      flush();
    }
    current.push(candle);
  }
  flush();
  return blocks;
}

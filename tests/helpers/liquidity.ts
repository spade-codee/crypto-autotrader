import Decimal from 'decimal.js';
import { DAY_MS, FOUR_HOURS_MS, QUARTER_HOUR_MS } from '../../src/strategy/bars.js';
import type { Candle } from '../../src/types.js';

/** 00:00 UTC on the first day of every scenario. */
export const START = Date.parse('2024-03-01T00:00:00Z');
/** Day 4, the day the scenarios test. */
export const DAY4 = START + 3 * DAY_MS;
/** The nth 15-minute candle of day 4. */
export const day4 = (n: number) => DAY4 + n * QUARTER_HOUR_MS;
/** Prices are scaled like BTC's, so one price step is small beside them. */
const SCALE = 1000;

export function candle(time: number, open: number, high: number, low: number, close: number): Candle {
  return {
    time,
    open: new Decimal(open),
    high: new Decimal(high),
    low: new Decimal(low),
    close: new Decimal(close),
    volume: new Decimal(1),
  };
}

/** Sixteen 15-minute candles making one 4-hour candle with exactly these prices: open, up to the high, down to the low, then to the close. */
export function fourHours(start: number, open: number, high: number, low: number, close: number): Candle[] {
  const anchors: Array<[number, number]> = [
    [0, open],
    [4, high],
    [10, low],
    [16, close],
  ];
  const at = (point: number): number => {
    for (let k = 1; k < anchors.length; k++) {
      const [x0, y0] = anchors[k - 1]!;
      const [x1, y1] = anchors[k]!;
      if (point <= x1) {
        return y0 + ((y1 - y0) * (point - x0)) / (x1 - x0);
      }
    }
    return close;
  };
  return Array.from({ length: 16 }, (_, j) => {
    const from = at(j);
    const to = at(j + 1);
    return candle(start + j * QUARTER_HOUR_MS, from, Math.max(from, to), Math.min(from, to), to);
  });
}

/**
 * Three complete UTC days in a clear 4-hour zigzag, eighteen 4-hour candles.
 * Rising: swing highs 107k, 109k, 111k and 113k, and swing lows 101k, 103k and
 * 105k, so the structure is up; day 3's low, 105k, is the level on day 4; the
 * last close is 111k. Falling mirrors it: the structure is not up, the level is
 * 187k, and the last close is 189k.
 */
export function zigzagDays(direction: 'up' | 'down', start = START): Candle[] {
  const sign = direction === 'up' ? 1 : -1;
  const mids = [direction === 'up' ? 100 : 200];
  const steps = [3, 3, -2, -2].map((step) => step * sign);
  for (let i = 1; i < 18; i++) {
    mids.push(mids[i - 1]! + steps[(i - 1) % 4]!);
  }
  const peaks = new Set(direction === 'up' ? [2, 6, 10, 14] : [4, 8, 12, 16]);
  const troughs = new Set(direction === 'up' ? [4, 8, 12, 16] : [2, 6, 10, 14]);
  return mids.flatMap((close, i) => {
    const open = i === 0 ? close : mids[i - 1]!;
    const high = Math.max(open, close) + (peaks.has(i) ? 1 : 0.25);
    const low = Math.min(open, close) - (troughs.has(i) ? 1 : 0.25);
    return fourHours(start + i * FOUR_HOURS_MS, open * SCALE, high * SCALE, low * SCALE, close * SCALE);
  });
}

/** Day 4 before the sweep: a 15-minute swing high of 114k at 00:15, known from 01:00. */
export function beforeSweep(): Candle[] {
  return [
    candle(day4(0), 111_000, 111_500, 110_500, 111_200),
    candle(day4(1), 111_200, 114_000, 111_000, 113_000),
    candle(day4(2), 113_000, 113_500, 112_000, 112_500),
    candle(day4(3), 112_500, 112_800, 111_500, 112_000),
  ];
}

/** 01:00 on day 4: the day's first touch below 105k, closing back above it. */
export const sweepCandle = () => candle(day4(4), 112_000, 112_200, 104_000, 110_000);

/** 01:15: a close above the 114k reference. */
export const confirmationCandle = () => candle(day4(5), 110_000, 115_000, 109_000, 114_500);

/** The rising days, then day 4 through the confirmation: version 0 enters at the 01:30 open. */
export function enteringScenario(): Candle[] {
  return [...zigzagDays('up'), ...beforeSweep(), sweepCandle(), confirmationCandle()];
}

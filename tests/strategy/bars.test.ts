import { describe, expect, it } from 'vitest';
import { aggregate, combine, DAY_MS, FOUR_HOURS_MS, QUARTER_HOUR_MS } from '../../src/strategy/bars.js';
import { bar } from '../helpers/candles.js';

const Q = QUARTER_HOUR_MS;
/** `count` 15-minute candles from `start`, each a step higher than the last. */
const rising = (start: number, count: number) =>
  Array.from({ length: count }, (_, i) => bar(start + i * Q, 100 + i, 102 + i, 99 + i, 101 + i));

describe('combine', () => {
  it('takes the first open, the highest high, the lowest low, the last close, and the total volume', () => {
    const candle = combine([bar(0, 10, 12, 9, 11), bar(Q, 11, 15, 10, 14), bar(2 * Q, 14, 14, 8, 9)]);
    expect([candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume].map(String)).toEqual([
      '0',
      '10',
      '15',
      '8',
      '9',
      '3',
    ]);
  });
});

describe('aggregate', () => {
  it('builds a 4-hour candle from its sixteen 15-minute candles', () => {
    const [four] = aggregate(rising(0, 16), FOUR_HOURS_MS);
    expect(four!.time).toBe(0);
    expect([four!.open, four!.high, four!.low, four!.close].map(String)).toEqual(['100', '117', '99', '116']);
  });

  it('drops a block with a missing candle', () => {
    expect(aggregate(rising(0, 16).filter((_, i) => i !== 7), FOUR_HOURS_MS)).toEqual([]);
  });

  it('drops a partial block at either end and keeps the whole ones', () => {
    const blocks = aggregate(rising(FOUR_HOURS_MS - 3 * Q, 3 + 16 + 5), FOUR_HOURS_MS);
    expect(blocks.map((block) => block.time)).toEqual([FOUR_HOURS_MS]);
  });

  it('builds UTC days from 96 candles', () => {
    const days = aggregate(rising(0, 192), DAY_MS);
    expect(days.map((day) => day.time)).toEqual([0, DAY_MS]);
    expect(days[1]!.low.toString()).toBe('195');
  });
});

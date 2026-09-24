import { describe, expect, it } from 'vitest';
import { QUARTER_HOUR_MS } from '../../src/strategy/bars.js';
import { findSwings, swingsAt } from '../../src/strategy/swings.js';
import { bar } from '../helpers/candles.js';

const Q = QUARTER_HOUR_MS;
/** Candles with the given highs and lows; each opens at its low and closes at its high. */
const hl = (pairs: Array<[number, number]>) => pairs.map(([high, low], i) => bar(i * Q, low, high, low, high));

describe('swingsAt', () => {
  it('finds a high strictly above the two candles on each side, known when the last one closes', () => {
    const [swing, ...rest] = swingsAt(hl([[10, 5], [11, 5], [15, 5], [12, 5], [11, 5]]), Q);
    expect(rest).toEqual([]);
    expect(swing).toMatchObject({ kind: 'HIGH', time: 2 * Q, knownAt: 5 * Q });
    expect(swing!.price.toString()).toBe('15');
  });

  it('finds no swing when a neighbour ties', () => {
    expect(swingsAt(hl([[10, 5], [15, 3], [15, 3], [12, 4], [11, 5]]), Q)).toEqual([]);
  });

  it('finds a high and a low at an outside candle', () => {
    const swings = swingsAt(hl([[10, 5], [11, 6], [20, 1], [12, 6], [11, 5]]), Q);
    expect(swings.map((s) => [s.kind, s.price.toString()])).toEqual([
      ['HIGH', '20'],
      ['LOW', '1'],
    ]);
  });
});

describe('findSwings', () => {
  it('reports each swing once, in the order the swings become known', () => {
    const candles = hl([[10, 5], [11, 6], [15, 7], [12, 4], [11, 5], [13, 6], [16, 8], [14, 7], [13, 6]]);
    expect(findSwings(candles, 2, Q).map((s) => [s.kind, s.time / Q, s.knownAt / Q])).toEqual([
      ['HIGH', 2, 5],
      ['LOW', 3, 6],
      ['HIGH', 6, 9],
    ]);
  });

  it('never changes an answer when later candles arrive', () => {
    // A seeded random walk, so the test cannot pass by accident.
    let seed = 7;
    const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let price = 100;
    const candles = Array.from({ length: 300 }, (_, i) => {
      const open = price;
      price += (next() - 0.5) * 4;
      return bar(i * Q, open, Math.max(open, price) + next(), Math.min(open, price) - next(), price);
    });
    const all = findSwings(candles, 2, Q);
    for (let end = 5; end <= candles.length; end += 17) {
      const knownBy = candles[end - 1]!.time + Q;
      expect(findSwings(candles.slice(0, end), 2, Q)).toEqual(all.filter((s) => s.knownAt <= knownBy));
    }
  });
});

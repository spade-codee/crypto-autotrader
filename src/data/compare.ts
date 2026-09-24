import Decimal from 'decimal.js';
import type { Candle } from '../types.js';

export type Comparison = {
  compared: number;
  identical: number;
  /** Built candles Bybit does not have. */
  missingOfficial: number;
  /** Bybit's candles that could not be built, usually for a missing 15-minute candle. */
  missingBuilt: number;
  /** The largest difference in any price, as a share of Bybit's. */
  largestDifference: Decimal;
  worstTime: number | null;
};

/** How closely candles built from 15-minute ones match the exchange's own, price by price (spec 6.3, item 7). */
export function compareCandles(built: Candle[], official: Candle[]): Comparison {
  const officialByTime = new Map(official.map((candle) => [candle.time, candle]));
  const builtTimes = new Set(built.map((candle) => candle.time));
  const result: Comparison = {
    compared: 0,
    identical: 0,
    missingOfficial: 0,
    missingBuilt: official.filter((candle) => !builtTimes.has(candle.time)).length,
    largestDifference: new Decimal(0),
    worstTime: null,
  };
  for (const candle of built) {
    const other = officialByTime.get(candle.time);
    if (other === undefined) {
      result.missingOfficial += 1;
      continue;
    }
    result.compared += 1;
    let same = true;
    for (const field of ['open', 'high', 'low', 'close'] as const) {
      const difference = candle[field].minus(other[field]).abs().div(other[field]);
      if (!difference.isZero()) {
        same = false;
      }
      if (difference.gt(result.largestDifference)) {
        result.largestDifference = difference;
        result.worstTime = candle.time;
      }
    }
    if (same) {
      result.identical += 1;
    }
  }
  return result;
}

/** Each UTC year's median 15-minute volume, to show how thin the early market was (spec 6.2). */
export function medianVolumeByYear(candles: Candle[]): Array<{ year: number; median: Decimal }> {
  const byYear = new Map<number, Decimal[]>();
  for (const candle of candles) {
    const year = new Date(candle.time).getUTCFullYear();
    const volumes = byYear.get(year);
    if (volumes === undefined) {
      byYear.set(year, [candle.volume]);
    } else {
      volumes.push(candle.volume);
    }
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, volumes]) => {
      const sorted = [...volumes].sort((a, b) => a.comparedTo(b));
      return { year, median: sorted[Math.ceil(sorted.length / 2) - 1]! };
    });
}

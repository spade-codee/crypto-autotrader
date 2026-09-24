import type Decimal from 'decimal.js';
import type { Candle } from '../types.js';

export type Swing = {
  kind: 'HIGH' | 'LOW';
  /** Open time of the swing candle. */
  time: number;
  price: Decimal;
  /** Close time of the candle that confirmed it: the first moment the rules may use it (R2). */
  knownAt: number;
};

/**
 * The swings confirmed at the middle of a window of 2k+1 consecutive candles
 * (R2). A candle is a swing high when its high is strictly above the highs of
 * the k candles before it and the k after it; a tie with any of them makes no
 * swing. Swing lows mirror this. A swing is known only when the window's last
 * candle closes; counting it earlier is hindsight.
 */
export function swingsAt(window: Candle[], intervalMs: number): Swing[] {
  if (window.length < 3 || window.length % 2 === 0) {
    throw new Error('a swing window needs an odd number of candles, at least 3');
  }
  const middle = (window.length - 1) / 2;
  const candidate = window[middle]!;
  const others = window.filter((_, i) => i !== middle);
  const knownAt = window[window.length - 1]!.time + intervalMs;
  const swings: Swing[] = [];
  if (others.every((candle) => candidate.high.gt(candle.high))) {
    swings.push({ kind: 'HIGH', time: candidate.time, price: candidate.high, knownAt });
  }
  if (others.every((candle) => candidate.low.lt(candle.low))) {
    swings.push({ kind: 'LOW', time: candidate.time, price: candidate.low, knownAt });
  }
  return swings;
}

/** Every swing in a series, in the order they become known. For tests and reports; the strategy finds them one window at a time. */
export function findSwings(candles: Candle[], size: number, intervalMs: number): Swing[] {
  const width = 2 * size + 1;
  const swings: Swing[] = [];
  for (let end = width; end <= candles.length; end++) {
    swings.push(...swingsAt(candles.slice(end - width, end), intervalMs));
  }
  return swings;
}

import type { Candle } from '../types.js';
import { DAY_MS, isoDate } from './cycleDate.js';

export type WindowCheck = { ok: true } | { ok: false; reason: string };

/**
 * Checks a candle window before any signal is computed from it: long enough,
 * current, ordered, unique, consecutive, and with valid prices. The strategy
 * returns FLAT on too little history, so a truncated or corrupted fetch would
 * otherwise sell everything. See spec section 4.1.
 */
export function checkCandleWindow(
  candles: Candle[],
  expectedNewest: string,
  minLength: number,
): WindowCheck {
  if (candles.length === 0 || candles.length < minLength) {
    return { ok: false, reason: `only ${candles.length} candles, at least ${minLength} needed` };
  }
  // Three passes, so each fault gets its own name: two swapped candles make a
  // forward jump before the backward one, which a single pass would call a gap.
  for (const candle of candles) {
    const day = Number.isFinite(candle.time) ? isoDate(candle.time) : 'a';
    if (!Number.isInteger(candle.time) || candle.time % DAY_MS !== 0) {
      return { ok: false, reason: `the ${day} candle does not open at midnight UTC` };
    }
    const { open, high, low, close } = candle;
    if ([open, high, low, close].some((price) => !price.isFinite() || price.lte(0))) {
      return { ok: false, reason: `the ${day} candle has a price that is not a positive number` };
    }
    if (low.gt(open) || low.gt(close) || high.lt(open) || high.lt(close)) {
      return { ok: false, reason: `the ${day} candle's high and low do not contain its open and close` };
    }
  }
  for (let i = 1; i < candles.length; i++) {
    if (candles[i]!.time <= candles[i - 1]!.time) {
      return { ok: false, reason: `candles are out of order or repeated at ${isoDate(candles[i]!.time)}` };
    }
  }
  for (let i = 1; i < candles.length; i++) {
    if (candles[i]!.time - candles[i - 1]!.time !== DAY_MS) {
      return { ok: false, reason: `candles are missing before ${isoDate(candles[i]!.time)}` };
    }
  }
  const newest = isoDate(candles[candles.length - 1]!.time);
  if (newest !== expectedNewest) {
    return { ok: false, reason: `the newest candle is ${newest}, expected ${expectedNewest}` };
  }
  return { ok: true };
}

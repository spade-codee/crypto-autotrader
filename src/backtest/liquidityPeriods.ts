import type { Candle } from '../types.js';

const QUARTER_HOUR_MS = 900_000;

/** The periods fixed in the spec, section 6.2. */
export const DEVELOPMENT = { from: Date.parse('2022-01-01T00:00:00Z'), to: Date.parse('2025-01-01T00:00:00Z') };
export const LOCKED = { from: Date.parse('2025-01-01T00:00:00Z'), to: Date.parse('2026-09-01T00:00:00Z') };

export type PeriodName = 'development' | 'locked';
export type PeriodCandles = { candles: Candle[]; evaluateFrom: number; evaluateTo: number };

/**
 * The candles a run may see. Development never sees a candle from the locked
 * period, whatever the file holds. The locked period opens only when asked
 * explicitly, in its own pull request, and keeps every earlier candle as warm-up.
 */
export function periodCandles(all: Candle[], period: PeriodName, unlockLocked: boolean): PeriodCandles {
  if (period === 'locked' && !unlockLocked) {
    throw new Error('the locked period stays closed until its own pull request runs it with --unlock-locked-period');
  }
  const range = period === 'development' ? DEVELOPMENT : LOCKED;
  const candles = all.filter((candle) => candle.time < range.to);
  const last = candles[candles.length - 1];
  if (last === undefined || last.time + QUARTER_HOUR_MS < range.to) {
    const day = new Date(range.to).toISOString().slice(0, 10);
    throw new Error(`the candles end before ${day}: run npm run liquidity:fetch -- --until ${day}`);
  }
  return { candles, evaluateFrom: range.from, evaluateTo: range.to };
}

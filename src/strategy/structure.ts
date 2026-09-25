import type Decimal from 'decimal.js';

/** Version 0 needs rising highs and rising lows; version 1's step C and later need rising lows only. */
export type StructureTest = 'HIGHS_AND_LOWS' | 'LOWS';

/**
 * R3: the 4-hour structure is up when the last two swing highs rise, the last
 * two swing lows rise, and the latest 4-hour close is above the latest swing
 * low. Anything else is not up, including too few swings yet. The last
 * condition ends an uptrend at the first close below its last higher low,
 * instead of about eight hours later when the lower low is confirmed.
 *
 * With `test` 'LOWS', version 1's step C, the highs are not consulted: rising
 * lows with the last one holding is still an uptrend's structure.
 */
export function structureIsUp(
  highs: Decimal[],
  lows: Decimal[],
  lastClose: Decimal | null,
  test: StructureTest = 'HIGHS_AND_LOWS',
): boolean {
  if (lows.length < 2 || lastClose === null) {
    return false;
  }
  const [low1, low2] = lows.slice(-2) as [Decimal, Decimal];
  const lowsHold = low2.gt(low1) && lastClose.gt(low2);
  if (test === 'LOWS') {
    return lowsHold;
  }
  if (highs.length < 2) {
    return false;
  }
  const [high1, high2] = highs.slice(-2) as [Decimal, Decimal];
  return high2.gt(high1) && lowsHold;
}

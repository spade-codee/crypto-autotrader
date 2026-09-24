import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { structureIsUp } from '../../src/strategy/structure.js';

const d = (...values: number[]) => values.map((value) => new Decimal(value));
const close = (value: number) => new Decimal(value);

describe('structureIsUp', () => {
  it('is up when the last two highs rise, the last two lows rise, and the close holds above the last low', () => {
    expect(structureIsUp(d(100, 110), d(90, 95), close(100))).toBe(true);
  });

  it('uses only the last two of each', () => {
    expect(structureIsUp(d(200, 100, 110), d(300, 90, 95), close(100))).toBe(true);
  });

  it('is not up when the highs do not rise, or the lows fall', () => {
    expect(structureIsUp(d(110, 110), d(90, 95), close(100))).toBe(false);
    expect(structureIsUp(d(100, 110), d(95, 90), close(100))).toBe(false);
  });

  it('is not up once a close is at or below the last swing low, before a lower low is confirmed', () => {
    expect(structureIsUp(d(100, 110), d(90, 95), close(95))).toBe(false);
  });

  it('is not up with too few swings, or before any 4-hour close', () => {
    expect(structureIsUp(d(110), d(90, 95), close(100))).toBe(false);
    expect(structureIsUp(d(100, 110), d(95), close(100))).toBe(false);
    expect(structureIsUp(d(100, 110), d(90, 95), null)).toBe(false);
  });
});

import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { compareCandles, medianVolumeByYear } from '../../src/data/compare.js';
import { bar } from '../helpers/candles.js';

describe('compareCandles', () => {
  it('counts identical candles, the largest difference, and candles missing on either side', () => {
    const built = [bar(0, 100, 110, 90, 105), bar(1, 105, 111, 100, 100.1), bar(2, 106, 107, 105, 106)];
    const official = [bar(0, 100, 110, 90, 105), bar(1, 105, 111, 100, 100), bar(3, 1, 1, 1, 1)];
    const result = compareCandles(built, official);
    expect(result).toMatchObject({ compared: 2, identical: 1, missingOfficial: 1, missingBuilt: 1, worstTime: 1 });
    expect(result.largestDifference.toString()).toBe('0.001');
  });
});

describe('medianVolumeByYear', () => {
  it("takes each UTC year's median 15-minute volume", () => {
    const at = (time: number, volume: number) => ({ ...bar(time, 1, 1, 1, 1), volume: new Decimal(volume) });
    const t2021 = Date.parse('2021-08-01T00:00:00Z');
    const candles = [at(t2021, 1), at(t2021 + 900_000, 3), at(Date.parse('2022-03-01T00:00:00Z'), 50)];
    expect(medianVolumeByYear(candles).map(({ year, median }) => [year, median.toString()])).toEqual([
      [2021, '1'],
      [2022, '50'],
    ]);
  });
});

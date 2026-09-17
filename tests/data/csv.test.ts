import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { parseCandleCsv, toCandleCsv } from '../../src/data/csv.js';
import type { Candle } from '../../src/types.js';

const d = (n: string | number) => new Decimal(n);

const sample: Candle[] = [
  { time: 0, open: d(1), high: d(2), low: d('0.5'), close: d('1.5'), volume: d(10) },
  { time: 86_400_000, open: d('1.5'), high: d(3), low: d(1), close: d(2), volume: d(20) },
];

describe('toCandleCsv', () => {
  it('writes a header row followed by one row per candle', () => {
    const csv = toCandleCsv(sample);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('time,open,high,low,close,volume');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('0,1,2,0.5,1.5,10');
  });
});

describe('parseCandleCsv', () => {
  it('round-trips without losing precision', () => {
    const parsed = parseCandleCsv(toCandleCsv(sample));
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.time).toBe(0);
    expect(parsed[0]!.close.toString()).toBe('1.5');
    expect(parsed[1]!.volume.toString()).toBe('20');
  });

  it('preserves precision that a float would destroy', () => {
    const precise: Candle[] = [
      {
        time: 0,
        open: d('0.1'),
        high: d('0.2'),
        low: d('0.30000000000000004'),
        close: d('12345.678901234567'),
        volume: d(1),
      },
    ];
    const parsed = parseCandleCsv(toCandleCsv(precise));
    expect(parsed[0]!.close.toString()).toBe('12345.678901234567');
    expect(parsed[0]!.low.toString()).toBe('0.30000000000000004');
  });

  it('reads a file saved with Windows line endings', () => {
    // A CSV opened and re-saved on Windows gets CRLF endings. Without handling
    // them, every row's last column carries a trailing \r and fails to parse.
    const crlf = toCandleCsv(sample).replace(/\n/g, '\r\n');
    const parsed = parseCandleCsv(crlf);
    expect(parsed).toHaveLength(2);
    expect(parsed[1]!.volume.toString()).toBe('20');
  });

  it('ignores blank trailing lines', () => {
    const parsed = parseCandleCsv(toCandleCsv(sample) + '\n\n');
    expect(parsed).toHaveLength(2);
  });

  it('rejects a file whose header is wrong', () => {
    expect(() => parseCandleCsv('t,o,h,l,c,v\n1,2,3,4,5,6')).toThrow(
      'unexpected CSV header',
    );
  });

  it('rejects a row with the wrong number of columns', () => {
    expect(() => parseCandleCsv('time,open,high,low,close,volume\n1,2,3')).toThrow(
      'malformed CSV row',
    );
  });

  it('returns an empty array for a header-only file', () => {
    expect(parseCandleCsv('time,open,high,low,close,volume\n')).toEqual([]);
  });
});

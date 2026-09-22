import { describe, expect, it } from 'vitest';
import { cycleDate, cycleDateStart, dueAt, isLate, isoDate } from '../../src/engine/cycleDate.js';

const at = (iso: string) => Date.parse(iso);

describe('cycleDate', () => {
  it('is the day whose candle closed most recently', () => {
    expect(cycleDate(at('2026-09-22T00:02:00Z'))).toBe('2026-09-21');
    expect(cycleDate(at('2026-09-22T23:59:59.999Z'))).toBe('2026-09-21');
  });

  it('moves on at the instant of the close', () => {
    expect(cycleDate(at('2026-09-21T23:59:59.999Z'))).toBe('2026-09-20');
    expect(cycleDate(at('2026-09-22T00:00:00Z'))).toBe('2026-09-21');
  });
});

describe('cycleDateStart and dueAt', () => {
  it('turn a cycle date into its midnight and its close', () => {
    expect(cycleDateStart('2026-09-21')).toBe(at('2026-09-21T00:00:00Z'));
    expect(dueAt('2026-09-21')).toBe(at('2026-09-22T00:00:00Z'));
  });

  it('reject anything but a real YYYY-MM-DD date', () => {
    expect(() => cycleDateStart('2026-9-21')).toThrow('not a valid cycle date');
    expect(() => cycleDateStart('2026-02-30')).toThrow('not a valid cycle date');
    expect(() => cycleDateStart('yesterday')).toThrow('not a valid cycle date');
  });
});

describe('isLate', () => {
  it('allows thirty minutes after the close', () => {
    expect(isLate('2026-09-21', at('2026-09-22T00:30:00Z'))).toBe(false);
    expect(isLate('2026-09-21', at('2026-09-22T00:30:00.001Z'))).toBe(true);
  });
});

describe('isoDate', () => {
  it('formats a time as its UTC date', () => {
    expect(isoDate(at('2026-09-21T23:59:59Z'))).toBe('2026-09-21');
  });
});

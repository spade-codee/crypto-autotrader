import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { checkCandleWindow } from '../../src/engine/candleWindow.js';
import type { Candle } from '../../src/types.js';
import { dailyCandles, lastDay } from '../helpers/candles.js';

const WINDOW = dailyCandles('2026-01-01', Array.from({ length: 130 }, (_, i) => 100 + i));
const NEWEST = lastDay(WINDOW);
const copy = (): Candle[] => WINDOW.map((c) => ({ ...c }));
const reasonOf = (candles: Candle[], expected = NEWEST): string => {
  const check = checkCandleWindow(candles, expected, 125);
  if (check.ok) {
    throw new Error('expected the window to be rejected');
  }
  return check.reason;
};

describe('checkCandleWindow', () => {
  it('accepts a long enough, current, consecutive window', () => {
    expect(checkCandleWindow(WINDOW, NEWEST, 125)).toEqual({ ok: true });
  });

  it('rejects a window that is too short', () => {
    expect(reasonOf(WINDOW.slice(-124))).toContain('at least 125');
  });

  it('rejects an empty window', () => {
    expect(checkCandleWindow([], NEWEST, 0).ok).toBe(false);
  });

  it('rejects a window whose newest candle is not the expected day', () => {
    expect(reasonOf(WINDOW.slice(0, -1))).toContain(`expected ${NEWEST}`);
  });

  it('rejects candles out of order', () => {
    const candles = copy();
    [candles[128], candles[129]] = [candles[129]!, candles[128]!];
    expect(reasonOf(candles)).toContain('out of order');
  });

  it('rejects a repeated candle', () => {
    const candles = copy();
    candles.splice(100, 0, { ...candles[100]! });
    expect(reasonOf(candles)).toContain('out of order or repeated');
  });

  it('rejects a gap', () => {
    const candles = copy();
    candles.splice(100, 1);
    expect(reasonOf(candles)).toContain('missing');
  });

  it.each([
    ['a zero close', (c: Candle) => ({ ...c, close: new Decimal(0), low: new Decimal(0) })],
    ['a negative open', (c: Candle) => ({ ...c, open: new Decimal(-1), low: new Decimal(-1) })],
    ['a NaN high', (c: Candle) => ({ ...c, high: new Decimal(Number.NaN) })],
  ])('rejects %s', (_name, breakCandle) => {
    const candles = copy();
    candles[120] = breakCandle(candles[120]!);
    expect(reasonOf(candles)).toContain('not a positive number');
  });

  it('rejects a high below the close', () => {
    const candles = copy();
    candles[120] = { ...candles[120]!, high: candles[120]!.close.minus(1) };
    expect(reasonOf(candles)).toContain('high and low');
  });

  it('rejects a candle that does not open at midnight UTC', () => {
    const candles = copy();
    candles[120] = { ...candles[120]!, time: candles[120]!.time + 1_000 };
    expect(reasonOf(candles)).toContain('midnight');
  });
});

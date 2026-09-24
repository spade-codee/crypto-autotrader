import Decimal from 'decimal.js';
import type { Candle } from '../../src/types.js';

export const DAY = 86_400_000;

/** Daily candles opening at `firstDay` midnight UTC, one per close, with open = high = low = close. */
export function dailyCandles(firstDay: string, closes: Array<number | string>): Candle[] {
  const start = Date.parse(`${firstDay}T00:00:00Z`);
  return closes.map((close, i) => {
    const price = new Decimal(close);
    return { time: start + i * DAY, open: price, high: price, low: price, close: price, volume: new Decimal(1) };
  });
}

/** `count` daily candles moving steadily up or down from 50,000, ending well clear of their average. */
export function trendingCandles(firstDay: string, count: number, direction: 'up' | 'down'): Candle[] {
  const step = direction === 'up' ? 100 : -100;
  return dailyCandles(
    firstDay,
    Array.from({ length: count }, (_, i) => 50_000 + i * step),
  );
}

/** The UTC date of the last candle. */
export function lastDay(candles: Candle[]): string {
  return new Date(candles[candles.length - 1]!.time).toISOString().slice(0, 10);
}

/** The day after a YYYY-MM-DD date. */
export function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
}

/** A candle at `time` with these prices and a volume of 1. */
export function bar(
  time: number,
  open: number | string,
  high: number | string,
  low: number | string,
  close: number | string,
): Candle {
  return {
    time,
    open: new Decimal(open),
    high: new Decimal(high),
    low: new Decimal(low),
    close: new Decimal(close),
    volume: new Decimal(1),
  };
}
